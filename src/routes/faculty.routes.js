const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../config/database-runtime');
const { requireAuth, requireRole } = require('../middleware/authenticate');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.csv$/i.test(file.originalname || '');
    if (!ok) req.fileValidationError = 'Only .csv files are allowed. Download the CSV template above and fill it in.';
    cb(null, ok);
  }
});

// Minimal CSV helpers so grade templates need no spreadsheet library.
function csvField(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const LEGACY_LETTERS = {
  'A+': '1.00', 'A': '1.00', 'A-': '1.25',
  'B+': '1.50', 'B': '1.75', 'B-': '2.00',
  'C+': '2.25', 'C': '2.50', 'C-': '2.75',
  'D+': '3.00', 'D': '3.00', 'D-': '3.25',
  'F': '5.00'
};

function parsePhGrade(input) {
  let value = String(input).trim();
  if (LEGACY_LETTERS[value.toUpperCase()]) {
    value = LEGACY_LETTERS[value.toUpperCase()];
  }
  const raw = Math.round(parseFloat(value) * 100) / 100;
  if (isNaN(raw)) return null;
  if (raw < 1 || raw > 5) return null;
  if (Math.round(raw * 4) !== raw * 4) return null;
  return {
    gradeValue: raw.toFixed(2),
    gradePoints: +(5 - raw).toFixed(2)
  };
}

function normalizeStudentNo(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Record the instructor's submission for a class (one row per offering) and
// tell the deans who own the program that the grades are ready for review.
// Deans are notified on the first submission only, not on every re-save.
async function recordGradeSubmission(offering, user, submittedCount) {
  const previous = await db.prepare('SELECT status FROM grade_submissions WHERE offering_id = ?').get(offering.id);

  await db.prepare(`
    INSERT INTO grade_submissions (offering_id, submitted_by, submitted_at, status)
    VALUES (?, ?, datetime('now'), 'submitted')
    ON CONFLICT(offering_id) DO UPDATE SET
      submitted_by = excluded.submitted_by,
      submitted_at = excluded.submitted_at,
      status = 'submitted'
  `).run(offering.id, user.id);

  if (previous && previous.status === 'submitted') return;

  const deans = offering.program_code
    ? await db.prepare(`
        SELECT DISTINCT u.id
        FROM users u
        JOIN departments d ON d.hod_user_id = u.id
        JOIN programs p ON p.department_id = d.id
        WHERE p.code = ? AND u.role = 'dean' AND u.is_active = 1
      `).all(offering.program_code)
    : await db.prepare("SELECT id FROM users WHERE role = 'dean' AND is_active = 1").all();

  const message = `${offering.course_code} Sec. ${offering.section} - ${submittedCount} grade(s) submitted by ${user.fullName || 'the instructor'}.`;
  for (const dean of deans) {
    await db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Grades Submitted', ?, 'grade_submission')")
      .run(dean.id, message);
  }
}

// All faculty routes require auth and faculty role
router.use(requireAuth);
router.use(requireRole('faculty'));

// GET /faculty/dashboard
router.get('/dashboard', async (req, res) => {
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();

  // Classes assigned to this teacher for the active semester
  const classes = activeSemester ? await db.prepare(`
    SELECT co.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = co.id AND e.status = 'enrolled') as enrolled_count,
      (SELECT COUNT(*) FROM enrollments e
        JOIN grades g ON g.enrollment_id = e.id
        WHERE e.offering_id = co.id) as graded_count
    FROM course_offerings co
    WHERE co.instructor_id = ? AND co.semester_id = ?
    ORDER BY co.course_code
  `).all(req.user.id, activeSemester.id) : [];

  // Students in this teacher's classes
  const teacherStudents = await db.prepare(`
    SELECT DISTINCT s.id, s.student_no, s.first_name, s.last_name, s.program_code, s.year_level
    FROM students s
    JOIN enrollments e ON e.student_id = s.id
    JOIN course_offerings co ON e.offering_id = co.id
    WHERE co.instructor_id = ?
    ORDER BY s.last_name, s.first_name
  `).all(req.user.id);

  res.render('faculty/dashboard', {
    title: 'Teacher Dashboard - PCC Student Portal',
    activeSemester,
    classes,
    teacherStudents,
    user: req.user
  });
});

// GET /faculty/subjects — read-only overview of the subjects/sections this instructor handles
router.get('/subjects', async (req, res) => {
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();

  const offerings = activeSemester ? await db.prepare(`
    SELECT co.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = co.id AND e.status = 'enrolled') as enrolled_count,
      (SELECT COUNT(*) FROM enrollments e
        JOIN grades g ON g.enrollment_id = e.id
        WHERE e.offering_id = co.id) as graded_count
    FROM course_offerings co
    WHERE co.instructor_id = ? AND co.semester_id = ?
    ORDER BY co.course_code, co.section
  `).all(req.user.id, activeSemester.id) : [];

  res.render('faculty/subjects', {
    title: 'My Subjects - PCC Student Portal',
    activeSemester,
    offerings,
    user: req.user
  });
});

// GET /faculty/grade-entry — subjects/sections held by this instructor
router.get('/grade-entry', async (req, res) => {
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();

  const offerings = activeSemester ? await db.prepare(`
    SELECT co.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = co.id AND e.status = 'enrolled') as enrolled_count,
      (SELECT COUNT(*) FROM enrollments e
        JOIN grades g ON g.enrollment_id = e.id
        WHERE e.offering_id = co.id) as graded_count,
      (SELECT gs.status FROM grade_submissions gs WHERE gs.offering_id = co.id) as submission_status,
      (SELECT gs.submitted_at FROM grade_submissions gs WHERE gs.offering_id = co.id) as submitted_at
    FROM course_offerings co
    WHERE co.instructor_id = ? AND co.semester_id = ?
    ORDER BY co.course_code, co.section
  `).all(req.user.id, activeSemester.id) : [];

  res.render('faculty/grade-entry', {
    title: 'Grade Entry - PCC Student Portal',
    activeSemester,
    offerings,
    user: req.user
  });
});

// GET /faculty/grade-entry/:offeringId — grade sheet for one section
router.get('/grade-entry/:offeringId', async (req, res) => {
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();
  const offering = await db.prepare('SELECT * FROM course_offerings WHERE id = ?').get(req.params.offeringId);

  if (!offering || offering.instructor_id !== req.user.id) {
    return res.redirect('/faculty/grade-entry');
  }

  const students = await db.prepare(`
    SELECT e.id as enrollment_id, e.student_id, s.student_no, s.first_name, s.last_name,
      g.id as grade_id, g.grade_value, g.grade_points, g.remarks
    FROM enrollments e
    JOIN students s ON e.student_id = s.id
    LEFT JOIN grades g ON g.enrollment_id = e.id
    WHERE e.offering_id = ? AND e.status = 'enrolled'
    ORDER BY s.last_name, s.first_name
  `).all(req.params.offeringId);

  const submission = await db.prepare(`
    SELECT gs.*, u.full_name as submitted_by_name
    FROM grade_submissions gs
    JOIN users u ON u.id = gs.submitted_by
    WHERE gs.offering_id = ?
  `).get(offering.id);

  res.render('faculty/grade-entry-form', {
    title: `Grade Entry - ${offering.course_code} - PCC Student Portal`,
    offering,
    students,
    submission,
    activeSemester,
    user: req.user
  });
});

// POST /faculty/grades/batch — submit grades for the instructor's own class
router.post('/grades/batch', async (req, res) => {
  const { offeringId, grades } = req.body;
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();

  if (!activeSemester) {
    return res.status(400).json({ error: 'No active semester' });
  }

  const offering = await db.prepare('SELECT * FROM course_offerings WHERE id = ?').get(offeringId);
  if (!offering) {
    return res.status(404).json({ error: 'Course offering not found' });
  }
  if (offering.instructor_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only submit grades for your own classes.' });
  }
  if (offering.semester_id !== activeSemester.id) {
    return res.status(400).json({ error: 'This class is not part of the active semester.' });
  }

  const insertGrade = db.prepare(`
    INSERT INTO grades (enrollment_id, student_id, course_code, semester_id, grade_value, grade_points, credits, remarks, encoded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(enrollment_id) DO UPDATE SET
      grade_value = excluded.grade_value,
      grade_points = excluded.grade_points,
      remarks = excluded.remarks,
      modified_at = datetime('now')
  `);

  const insertAudit = db.prepare(`
    INSERT INTO grade_audit_log (student_id, course_code, semester_id, old_grade, new_grade, encoded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const ownEnrollment = db.prepare(`
    SELECT id FROM enrollments WHERE id = ? AND offering_id = ?
  `);

  const transaction = await db.transaction(async () => {
    let saved = 0;
    for (const grade of (Array.isArray(grades) ? grades : [])) {
      const parsed = grade.gradeValue ? parsePhGrade(grade.gradeValue) : null;
      if (!parsed) continue;
      if (!(await ownEnrollment.get(grade.enrollmentId, offering.id))) continue;

      const oldGrade = await db.prepare('SELECT grade_value FROM grades WHERE enrollment_id = ?').get(grade.enrollmentId);

      await insertGrade.run(
        grade.enrollmentId,
        grade.studentId,
        offering.course_code,
        activeSemester.id,
        parsed.gradeValue,
        parsed.gradePoints,
        offering.credits,
        grade.remarks || '',
        req.user.id
      );

      await insertAudit.run(
        grade.studentId,
        offering.course_code,
        activeSemester.id,
        oldGrade?.grade_value || null,
        parsed.gradeValue,
        req.user.id
      );

      saved++;
    }
    return saved;
  });

  try {
    const saved = await transaction();
    try {
      await recordGradeSubmission(offering, req.user, saved);
    } catch (recordErr) {
      console.error('Grade submission record failed:', recordErr.message);
    }
    res.json({ success: true, saved });
  } catch (err) {
    console.error('Batch grade save error:', err);
    res.status(500).json({ error: 'Failed to save grades' });
  }
});

// GET /faculty/grade-entry/:offeringId/template — CSV template pre-filled with the section's students
router.get('/grade-entry/:offeringId/template', async (req, res) => {
  const offering = await db.prepare('SELECT * FROM course_offerings WHERE id = ?').get(req.params.offeringId);

  if (!offering || offering.instructor_id !== req.user.id) {
    return res.redirect('/faculty/grade-entry');
  }

  const students = await db.prepare(`
    SELECT s.student_no, s.first_name, s.last_name
    FROM enrollments e
    JOIN students s ON e.student_id = s.id
    WHERE e.offering_id = ? AND e.status = 'enrolled'
    ORDER BY s.last_name, s.first_name
  `).all(offering.id);

  const rows = [
    ['Student No.', 'Student Name', 'Grade', 'Remarks'],
    ...students.map(s => [s.student_no, `${s.last_name}, ${s.first_name}`, '', ''])
  ];
  // BOM so Excel opens UTF-8 names correctly.
  const csv = '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
  const filename = `${offering.course_code} Sec ${offering.section} Grade Template.csv`
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, '');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// POST /faculty/grades/import — validate a CSV file and save the grades
router.post('/grades/import', importUpload.single('file'), async (req, res) => {
  if (req.fileValidationError) {
    return res.status(400).json({ error: req.fileValidationError });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();
  if (!activeSemester) {
    return res.status(400).json({ error: 'No active semester' });
  }

  const offering = await db.prepare('SELECT * FROM course_offerings WHERE id = ?').get(req.body.offeringId);
  if (!offering) {
    return res.status(404).json({ error: 'Course offering not found' });
  }
  if (offering.instructor_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only import grades for your own classes.' });
  }
  if (offering.semester_id !== activeSemester.id) {
    return res.status(400).json({ error: 'This class is not part of the active semester.' });
  }

  let grid;
  try {
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    grid = parseCsv(text).filter(row => row.some(cell => String(cell).trim() !== ''));
  } catch (err) {
    return res.status(400).json({ error: 'Could not read the file. Use a valid CSV file.' });
  }
  if (grid.length === 0) {
    return res.status(400).json({ error: 'The CSV file is empty.' });
  }

  let headerRow = -1;
  let cols = { studentNo: -1, grade: -1, remarks: -1 };
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const cells = (grid[i] || []).map(c => String(c).trim());
    const studentNo = cells.findIndex(c => /student\s*(no\.?|#|number|id)/i.test(c));
    const grade = cells.findIndex(c => /^grades?$/i.test(c));
    if (studentNo !== -1 && grade !== -1) {
      headerRow = i;
      cols = { studentNo, grade, remarks: cells.findIndex(c => /^remarks?$/i.test(c)) };
      break;
    }
  }
  if (headerRow === -1) {
    return res.status(400).json({ error: 'Could not find "Student No." and "Grade" column headers in the file.' });
  }

  const enrolled = new Map(
    (await db.prepare(`
      SELECT e.id as enrollment_id, s.id as student_id, s.student_no
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      WHERE e.offering_id = ? AND e.status = 'enrolled'
    `).all(offering.id)).map(r => [normalizeStudentNo(r.student_no), r])
  );

  const skipped = [];
  const seen = new Set();
  const toSave = [];
  let blank = 0;

  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    const rowNumber = i + 1;
    const studentNo = String(row[cols.studentNo] ?? '').trim();
    const gradeCell = String(row[cols.grade] ?? '').trim();
    const remarks = cols.remarks >= 0 ? String(row[cols.remarks] ?? '').trim() : '';

    if (!studentNo && !gradeCell) continue;
    if (!studentNo) {
      skipped.push({ row: rowNumber, studentNo: '', reason: 'Missing student number' });
      continue;
    }

    const key = normalizeStudentNo(studentNo);
    if (seen.has(key)) {
      skipped.push({ row: rowNumber, studentNo, reason: 'Duplicate row (already counted)' });
      continue;
    }

    const match = enrolled.get(key);
    if (!match) {
      skipped.push({ row: rowNumber, studentNo, reason: 'Not enrolled in this section' });
      continue;
    }

    if (!gradeCell) {
      blank++;
      continue;
    }

    const parsed = parsePhGrade(gradeCell);
    if (!parsed) {
      skipped.push({ row: rowNumber, studentNo, reason: `Invalid grade "${gradeCell}" - use 1.00-5.00 in quarter steps` });
      continue;
    }

    seen.add(key);
    toSave.push({ ...match, gradeValue: parsed.gradeValue, gradePoints: parsed.gradePoints, remarks });
  }

  const insertGrade = db.prepare(`
    INSERT INTO grades (enrollment_id, student_id, course_code, semester_id, grade_value, grade_points, credits, remarks, encoded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(enrollment_id) DO UPDATE SET
      grade_value = excluded.grade_value,
      grade_points = excluded.grade_points,
      remarks = excluded.remarks,
      modified_at = datetime('now')
  `);

  const insertAudit = db.prepare(`
    INSERT INTO grade_audit_log (student_id, course_code, semester_id, old_grade, new_grade, encoded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = await db.transaction(async () => {
    for (const g of toSave) {
      const oldGrade = await db.prepare('SELECT grade_value FROM grades WHERE enrollment_id = ?').get(g.enrollment_id);
      await insertGrade.run(g.enrollment_id, g.student_id, offering.course_code, activeSemester.id, g.gradeValue, g.gradePoints, offering.credits, g.remarks, req.user.id);
      await insertAudit.run(g.student_id, offering.course_code, activeSemester.id, oldGrade?.grade_value || null, g.gradeValue, req.user.id);
    }
    return toSave.length;
  });

  try {
    const imported = await transaction();
    try {
      await recordGradeSubmission(offering, req.user, imported);
    } catch (recordErr) {
      console.error('Grade submission record failed:', recordErr.message);
    }
    res.json({ success: true, imported, skipped, blank });
  } catch (err) {
    console.error('Grade import error:', err);
    res.status(500).json({ error: 'Failed to save imported grades' });
  }
});

module.exports = router;