const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcrypt');
const db = require('../config/database-runtime');
const { requireAuth, requireRole } = require('../middleware/authenticate');

// CSV imports stay in memory: bounded size, no temp files on disk to clean up.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

// All dean routes require auth and dean/admin role
router.use(requireAuth);
router.use(requireRole('dean', 'admin'));

// Department scoping: role 'dean' only sees programs of departments they head
// (departments.hod_user_id). Admin sees everything (null = unscoped).
// A dean heading nothing gets an empty scope (fail closed).
async function deanScope(req) {
  if (req.user.role !== 'dean') return null;
  const deptIds = (await db.prepare('SELECT id FROM departments WHERE hod_user_id = ?').all(req.user.id)).map(r => r.id);
  if (!deptIds.length) return { programCodes: [] };
  const ph = deptIds.map(() => '?').join(',');
  const codes = (await db.prepare(`SELECT code FROM programs WHERE department_id IN (${ph})`).all(...deptIds)).map(r => r.code);
  return { programCodes: codes };
}

// AND-filter fragment for a program-code column (fail-closed on empty scope).
function programFilter(scope, column) {
  if (!scope) return { clause: '', params: [] };
  if (!scope.programCodes.length) return { clause: ' AND 1=0', params: [] };
  const ph = scope.programCodes.map(() => '?').join(',');
  return { clause: ` AND ${column} IN (${ph})`, params: [...scope.programCodes] };
}

function inScope(scope, code) {
  if (!scope) return true;
  return scope.programCodes.includes(code);
}

// Friendly 403 for cross-department tampering (keeps the deny, drops the scare).
function denyCrossDept(res, req) {
  return res.status(403).render('auth/switch-account', {
    layout: false,
    title: 'Switch account - PCC',
    name: req.user.fullName || req.user.email,
    role: req.user.role,
    door: 'Dean / Admin',
    doorPath: '/dean',
    home: '/dean/dashboard',
    note: 'That record belongs to another department.'
  });
}

// Department ids a dean heads (null for unscoped admins, [] when heading none).
async function deanDeptIds(req) {
  if (req.user.role !== 'dean') return null;
  return (await db.prepare('SELECT id FROM departments WHERE hod_user_id = ?').all(req.user.id)).map(r => r.id);
}

// Departments a dean may manage (all departments for admins, fail-closed for deans).
async function departmentsForDean(req) {
  const ids = await deanDeptIds(req);
  if (ids === null) return await db.prepare('SELECT id, code, name FROM departments ORDER BY code').all();
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return await db.prepare(`SELECT id, code, name FROM departments WHERE id IN (${ph}) ORDER BY code`).all(...ids);
}

// Programs a dean may create offerings for (all programs for admins).
async function programsForDean(req) {
  const scope = await deanScope(req);
  if (!scope) return await db.prepare('SELECT code, name, department_id FROM programs ORDER BY code').all();
  if (!scope.programCodes.length) return [];
  const ph = scope.programCodes.map(() => '?').join(',');
  return await db.prepare(`SELECT code, name, department_id FROM programs WHERE code IN (${ph}) ORDER BY code`).all(...scope.programCodes);
}

// Active teachers a dean may assign. Deans see their own departments' teachers
// plus teachers with no department yet (so new hires can be picked up).
async function facultyForDean(req) {
  const base = 'SELECT id, full_name, email, department_id FROM users WHERE role = \'faculty\' AND is_active = 1';
  const ids = await deanDeptIds(req);
  if (ids === null) return await db.prepare(base + ' ORDER BY full_name').all();
  if (!ids.length) return await db.prepare(base + ' AND department_id IS NULL ORDER BY full_name').all();
  const ph = ids.map(() => '?').join(',');
  return await db.prepare(`${base} AND (department_id IN (${ph}) OR department_id IS NULL) ORDER BY full_name`).all(...ids);
}

// GET /dean/dashboard
router.get('/dashboard', async (req, res) => {
  // Get active semester
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();
  const scope = await deanScope(req);

  // Get course offerings for current semester
  const off = programFilter(scope, 'co.program_code');
  const offerings = activeSemester ? await db.prepare(`
    SELECT co.*, 
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = co.id AND e.status = 'enrolled') as enrolled_count,
      (SELECT COUNT(*) FROM enrollments e 
       JOIN grades g ON g.enrollment_id = e.id 
       WHERE e.offering_id = co.id) as graded_count
    FROM course_offerings co
    WHERE co.semester_id = ?${off.clause}
    ORDER BY co.course_code
  `).all(activeSemester.id, ...off.params) : [];

  // Get total students
  const st = programFilter(scope, 'program_code');
  const totalStudents = await db.prepare(
    `SELECT COUNT(*) as count FROM students WHERE status = 'active'${st.clause}`
  ).get(...st.params);

  // Get at-risk students (GPA < 2.0)
  const ar = programFilter(scope, 's.program_code');
  const atRiskStudents = await db.prepare(`
    SELECT s.*, u.full_name,
      AVG(g.grade_points) as avg_gpa
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN grades g ON s.id = g.student_id
    WHERE g.grade_points IS NOT NULL${ar.clause}
    GROUP BY s.id, u.full_name
    HAVING AVG(g.grade_points) < 2.0
    LIMIT 5
  `).all(...ar.params);

  res.render('dean/dashboard', {
    title: 'Dean Dashboard - PCC Student Portal',
    activeSemester,
    offerings,
    totalStudents: totalStudents.count,
    atRiskStudents,
    user: req.user
  });
});

// GET /dean/students
router.get('/students', async (req, res) => {
  const scope = await deanScope(req);
  const f = programFilter(scope, 's.program_code');
  const students = await db.prepare(`
    SELECT s.*, u.full_name, u.email
    FROM students s
    JOIN users u ON s.user_id = u.id
    WHERE s.status = 'active'${f.clause}
    ORDER BY s.student_no
  `).all(...f.params);

  res.render('dean/students', {
    title: 'Students - PCC Student Portal',
    students,
    user: req.user
  });
});

// GET /dean/grade-entry
router.get('/grade-entry', async (req, res) => {
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();
  const scope = await deanScope(req);

  // Get course offerings
  const off = programFilter(scope, 'co.program_code');
  const offerings = activeSemester ? await db.prepare(`
    SELECT co.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = co.id AND e.status = 'enrolled') as enrolled_count
    FROM course_offerings co
    WHERE co.semester_id = ?${off.clause}
    ORDER BY co.course_code
  `).all(activeSemester.id, ...off.params) : [];

  res.render('dean/grade-entry', {
    title: 'Grade Entry - PCC Student Portal',
    activeSemester,
    offerings,
    user: req.user
  });
});

// GET /dean/grade-entry/:offeringId
router.get('/grade-entry/:offeringId', async (req, res) => {
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();
  const offering = await db.prepare('SELECT * FROM course_offerings WHERE id = ?').get(req.params.offeringId);

  if (!offering || !inScope(await deanScope(req), offering.program_code)) {
    return res.redirect('/dean/grade-entry');
  }

  // Get enrolled students with existing grades
  const students = await db.prepare(`
    SELECT e.id as enrollment_id, e.student_id, s.student_no, s.first_name, s.last_name,
      g.id as grade_id, g.grade_value, g.grade_points, g.remarks
    FROM enrollments e
    JOIN students s ON e.student_id = s.id
    LEFT JOIN grades g ON g.enrollment_id = e.id
    WHERE e.offering_id = ? AND e.status = 'enrolled'
    ORDER BY s.last_name, s.first_name
  `).all(req.params.offeringId);

  res.render('dean/grade-entry-form', {
    title: `Grade Entry - ${offering.course_code} - PCC Student Portal`,
    offering,
    students,
    activeSemester,
    user: req.user
  });
});

// POST /dean/grades/batch
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
  if (!inScope(await deanScope(req), offering.program_code)) {
    return res.status(403).json({ error: 'Outside your department' });
  }
  if (Number(offering.semester_id) !== Number(activeSemester.id)) {
    return res.status(400).json({ error: 'That section does not belong to the active semester' });
  }
  if (!Array.isArray(grades) || grades.length === 0) {
    return res.status(400).json({ error: 'No grades submitted' });
  }
  if (grades.length > 200) {
    return res.status(400).json({ error: 'Too many grades in one batch (200 max)' });
  }

  // Philippine numeric grading: 1.00 (≈100, highest) → 3.00 (=75, passing) → 5.00 (failure)
  // Quarter increments: 1.00, 1.25, 1.50, ... 4.50, 5.00 (marks like INC/DRP handled as remarks)
  function parsePhGrade(input) {
    const raw = parseFloat(input);
    if (isNaN(raw)) return null;
    if (raw < 1 || raw > 5) return null;
    if (Math.round(raw * 4) !== raw * 4) return null; // must be a quarter step
    return {
      gradeValue: raw.toFixed(2),
      gradePoints: +(5 - raw).toFixed(2) // convert to 4.0-scale so GPA/at-risk reports keep working
    };
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
    let saved = 0;
    for (const grade of grades) {
      if (!grade || typeof grade !== 'object') continue;
      const parsed = grade.gradeValue ? parsePhGrade(grade.gradeValue) : null;
      if (!parsed) continue;

      // The enrollment must belong to this section AND this student. This stops
      // a crafted POST from writing grades into another section or student.
      const enrollment = await db.prepare(`
        SELECT id, student_id FROM enrollments
        WHERE id = ? AND offering_id = ? AND student_id = ?
      `).get(grade.enrollmentId, offering.id, grade.studentId);
      if (!enrollment) continue;

      // Get old grade for audit
      const oldGrade = await db.prepare('SELECT grade_value FROM grades WHERE enrollment_id = ?').get(enrollment.id);

      await insertGrade.run(
        enrollment.id,
        enrollment.student_id,
        offering.course_code,
        activeSemester.id,
        parsed.gradeValue,
        parsed.gradePoints,
        offering.credits,
        String(grade.remarks || '').slice(0, 120),
        req.user.id
      );

      // Audit log
      await insertAudit.run(
        enrollment.student_id,
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
    res.json({ success: true, saved });
  } catch (err) {
    console.error('Batch grade save error:', err);
    res.status(500).json({ error: 'Failed to save grades' });
  }
});

// POST /dean/grades/import
router.post('/grades/import', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That CSV is too large. Please use a file under 2MB.'
      : 'That file could not be read.';
    return res.status(400).json({ error: message });
  });
}, (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Simple CSV parser without dependencies
  function parseCSV(content) {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length && rows.length < 500; i++) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = (values[idx] || '').trim();
      });
      rows.push(row);
    }
    return rows;
  }

  try {
    const content = req.file.buffer.toString('utf8');
    const results = parseCSV(content);
    return res.json({
      success: true,
      message: `Parsed ${results.length} records (preview only)`,
      records: results
    });
  } catch (err) {
    console.error('CSV import error:', err);
    return res.status(400).json({ error: 'Failed to parse CSV file' });
  }
});

// POST /dean/grades/release
// Releasing grades affects every student in the college, so only an admin may
// do it (deans can encode grades but not publish them).
router.post('/grades/release', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an administrator can release grades' });
  }

  const semesterId = parseInt(req.body.semesterId, 10);
  const releaseType = req.body.releaseType === 'scheduled' ? 'scheduled' : 'manual';
  const scheduledAt = String(req.body.scheduledAt || '').trim();

  if (!Number.isInteger(semesterId)) {
    return res.status(400).json({ error: 'Choose a valid semester' });
  }
  const semester = await db.prepare('SELECT id FROM semesters WHERE id = ?').get(semesterId);
  if (!semester) {
    return res.status(400).json({ error: 'Choose a valid semester' });
  }
  if (releaseType === 'scheduled') {
    const when = scheduledAt ? new Date(scheduledAt) : null;
    if (!when || Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: 'Choose a valid schedule date and time' });
    }
  }

  try {
    if (releaseType === 'scheduled') {
      await db.prepare(`
        INSERT INTO grade_releases (semester_id, release_type, scheduled_at, released_by, status)
        VALUES (?, 'scheduled', ?, ?, 'scheduled')
      `).run(semesterId, scheduledAt, req.user.id);
    } else {
      await db.prepare(`
        INSERT INTO grade_releases (semester_id, release_type, released_at, released_by, status)
        VALUES (?, 'manual', datetime('now'), ?, 'released')
      `).run(semesterId, req.user.id);

      // Create notifications for all active students
      await db.prepare(`
        INSERT INTO notifications (user_id, title, message, type)
        SELECT s.user_id, 'Grades Released', 'Your grades for this semester have been released!', 'grade_release'
        FROM students s WHERE s.status = 'active'
      `).run();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Grade release error:', err);
    res.status(500).json({ error: 'Failed to release grades' });
  }
});

// GET /dean/prospectus/:studentId
router.get('/prospectus/:studentId', async (req, res) => {
  const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.studentId);

  if (!student) {
    return res.redirect('/dean/students');
  }

  if (!inScope(await deanScope(req), student.program_code)) {
    return denyCrossDept(res, req);
  }

  // Grades keyed by course code (most recent wins)
  const gradeRows = await db.prepare(`
    SELECT g.*, s.name as semester_name, s.school_year
    FROM grades g
    JOIN semesters s ON g.semester_id = s.id
    WHERE g.student_id = ?
    ORDER BY g.encoded_at DESC
  `).all(student.id);
  const grades = {};
  gradeRows.forEach(g => { if (!(g.course_code in grades)) grades[g.course_code] = g; });

  // Resolve the student's curriculum template; fall back to the official
  // program template so every student shows the full prospectus.
  let templateId = null;
  const assigned = await db.prepare('SELECT template_id FROM student_curriculum WHERE student_id = ?').get(student.id);
  if (assigned) templateId = assigned.template_id;
  if (!templateId) {
    const tpl = await db.prepare(`
      SELECT id FROM curriculum_templates
      WHERE program_code = ?
        AND EXISTS (SELECT 1 FROM curriculum_items ci WHERE ci.template_id = curriculum_templates.id)
      ORDER BY id DESC LIMIT 1
    `).get(student.program_code);
    templateId = tpl ? tpl.id : null;
  }

  const curriculum = templateId ? await db.prepare(`
    SELECT * FROM curriculum_items
    WHERE template_id = ?
    ORDER BY semester_number, display_order
  `).all(templateId) : [];

  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();

  res.render('dean/prospectus', {
    title: `Prospectus - ${student.first_name} ${student.last_name} - PCC Student Portal`,
    student,
    grades,
    curriculum,
    semester: activeSemester || null,
    user: req.user
  });
});

// GET /dean/year-levels (browse every year level: subjects + sections)
router.get('/year-levels', async (req, res) => {
  const scope = await deanScope(req);
  const tp = programFilter(scope, 't.program_code');
  const templates = await db.prepare(`
    SELECT t.program_code, t.program_name, t.id as template_id
    FROM curriculum_templates t
    WHERE t.id = (SELECT MAX(id) FROM curriculum_templates c WHERE c.program_code = t.program_code)
      AND EXISTS (SELECT 1 FROM curriculum_items ci WHERE ci.template_id = t.id)${tp.clause}
    ORDER BY t.program_code
  `).all(...tp.params);

  const yearStats = [1, 2, 3, 4].map(async year => {
    const sc = programFilter(scope, 'program_code');
    const sc2 = programFilter(scope, 'program_code');
    return {
      year,
      student_count: (await db.prepare(
        `SELECT COUNT(*) c FROM students WHERE status = 'active' AND year_level = ?${sc.clause}`
      ).get(year, ...sc.params)).c,
      section_count: (await db.prepare(`
        SELECT COUNT(DISTINCT upper(trim(section))) c FROM students
        WHERE status = 'active' AND year_level = ? AND section IS NOT NULL AND trim(section) <> ''${sc2.clause}
      `).get(year, ...sc2.params)).c
    };
  });

  const programs = templates.map(t => ({
    program_code: t.program_code,
    program_name: t.program_name,
    years: [1, 2, 3, 4].map(async year => {
      const stat = await db.prepare(`
        SELECT COUNT(*) as subjects, COALESCE(SUM(credits), 0) as units
        FROM curriculum_items WHERE template_id = ? AND semester_number IN (?, ?)
      `).get(t.template_id, year * 2 - 1, year * 2);
      return { year, subjects: stat.subjects, units: stat.units };
    })
  }));

  res.render('dean/year-levels', {
    title: 'Year Levels - PCC Student Portal',
    yearStats,
    programs,
    user: req.user
  });
});

// GET /dean/year-levels/:year (subjects required + sections for one year level)
router.get('/year-levels/:year', async (req, res) => {
  const year = parseInt(req.params.year, 10);
  if (isNaN(year) || year < 1 || year > 4) {
    return res.redirect('/dean/year-levels');
  }

  const programCode = String(req.query.program || '').toUpperCase();
  const scope = await deanScope(req);

  const ap = programFilter(scope, 't.program_code');
  const allPrograms = await db.prepare(`
    SELECT DISTINCT t.program_code FROM curriculum_templates t
    WHERE t.id = (SELECT MAX(id) FROM curriculum_templates c WHERE c.program_code = t.program_code)
      AND EXISTS (SELECT 1 FROM curriculum_items ci WHERE ci.template_id = t.id)${ap.clause}
    ORDER BY t.program_code
  `).all(...ap.params);

  const activeTemplate = allPrograms.find(p => p.program_code === programCode) || allPrograms[0];
  const active = activeTemplate
    ? await db.prepare('SELECT * FROM curriculum_templates WHERE program_code = ? ORDER BY id DESC LIMIT 1').get(activeTemplate.program_code)
    : null;

  const sem1 = active ? await db.prepare(`
    SELECT course_code, course_name, credits, course_type FROM curriculum_items
    WHERE template_id = ? AND semester_number = ? ORDER BY display_order, course_code
  `).all(active.id, year * 2 - 1) : [];

  const sem2 = active ? await db.prepare(`
    SELECT course_code, course_name, credits, course_type FROM curriculum_items
    WHERE template_id = ? AND semester_number = ? ORDER BY display_order, course_code
  `).all(active.id, year * 2) : [];

  const ys = programFilter(scope, 'program_code');
  const ys2 = programFilter(scope, 'program_code');
  const yearStat = {
    student_count: (await db.prepare(
      `SELECT COUNT(*) c FROM students WHERE status = 'active' AND year_level = ?${ys.clause}`
    ).get(year, ...ys.params)).c,
    section_count: (await db.prepare(`
      SELECT COUNT(DISTINCT upper(trim(section))) c FROM students
      WHERE status = 'active' AND year_level = ? AND section IS NOT NULL AND trim(section) <> ''${ys2.clause}
    `).get(year, ...ys2.params)).c
  };

  const sec = programFilter(scope, 'program_code');
  const sections = await db.prepare(`
    SELECT upper(trim(section)) as section, COUNT(*) as student_count
    FROM students
    WHERE status = 'active' AND year_level = ? AND section IS NOT NULL AND trim(section) <> ''${sec.clause}
    GROUP BY upper(trim(section))
    ORDER BY upper(trim(section))
  `).all(year, ...sec.params);

  const sectionsWithRosters = sections.map(async s => {
    const rs = programFilter(scope, 's.program_code');
    return {
      ...s,
      students: await db.prepare(`
        SELECT s.id, s.student_no, s.first_name, s.middle_name, s.last_name, s.gender, u.full_name
        FROM students s
        JOIN users u ON s.user_id = u.id
        WHERE s.status = 'active' AND s.year_level = ?
          AND upper(trim(s.section)) = ?${rs.clause}
        ORDER BY s.last_name, s.first_name
      `).all(year, s.section, ...rs.params)
    };
  });

  const un = programFilter(scope, 'program_code');
  const un2 = programFilter(scope, 's.program_code');
  const unassigned = (await db.prepare(`
    SELECT COUNT(*) c FROM students
    WHERE status = 'active' AND year_level = ? AND (section IS NULL OR trim(section) = '')${un.clause}
  `).get(year, ...un.params)).c;

  const unassignedStudents = await db.prepare(`
    SELECT s.id, s.student_no, u.full_name, s.gender
    FROM students s
    JOIN users u ON s.user_id = u.id
    WHERE s.status = 'active' AND s.year_level = ?
      AND (s.section IS NULL OR trim(s.section) = '')${un2.clause}
    ORDER BY s.last_name, s.first_name
  `).all(year, ...un2.params);

  res.render('dean/year-level-detail', {
    title: `Year ${year} - PCC Student Portal`,
    year,
    programs: allPrograms,
    activeProgram: active ? active.program_code : null,
    programName: active ? active.program_name : null,
    sem1,
    sem2,
    yearStat,
    sections: sectionsWithRosters,
    unassigned,
    unassignedStudents,
    user: req.user
  });
});

// GET /dean/assignments - assign course sections to instructors
router.get('/assignments', async (req, res) => {
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();
  const scope = await deanScope(req);
  const f = programFilter(scope, 'co.program_code');

  const offerings = activeSemester ? await db.prepare(`
    SELECT co.*,
      u.full_name AS instructor_name,
      u.email AS instructor_email,
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id = co.id AND e.status = 'enrolled') as enrolled_count
    FROM course_offerings co
    LEFT JOIN users u ON u.id = co.instructor_id
    WHERE co.semester_id = ?${f.clause}
    ORDER BY co.program_code, co.course_code, co.section
  `).all(activeSemester.id, ...f.params) : [];

  // Teachers in scope (deans: own departments + unassigned; admins: all).
  const faculty = await facultyForDean(req);
  const programs = await programsForDean(req);
  const departments = await departmentsForDean(req);

  // Curriculum suggestions for the "Add Section" form.
  let curriculumCourses = [];
  if (programs.length) {
    const ph = programs.map(() => '?').join(',');
    curriculumCourses = await db.prepare(`
      SELECT DISTINCT ci.course_code AS code, ci.course_name AS name, ci.credits, ct.program_code
      FROM curriculum_items ci
      JOIN curriculum_templates ct ON ct.id = ci.template_id
      WHERE ct.is_active = 1 AND ct.program_code IN (${ph})
      ORDER BY ci.course_code
    `).all(...programs.map(p => p.code));
  }

  res.render('dean/assignments', {
    title: 'Subject Assignments - PCC Student Portal',
    activeSemester,
    offerings,
    faculty,
    programs,
    departments,
    curriculumCourses,
    error: req.query.error || null,
    success: req.query.success || null,
    user: req.user
  });
});

// POST /dean/assignments/offerings - create a course section for the active semester
// (declared before /assignments/:offeringId so "offerings" is not read as an id)
router.post('/assignments/offerings', async (req, res) => {
  const activeSemester = await db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();
  if (!activeSemester) {
    return res.redirect('/dean/assignments?error=' + encodeURIComponent('Activate a semester before adding sections.'));
  }

  const code = String(req.body.course_code || '').trim().toUpperCase();
  const name = String(req.body.course_name || '').trim();
  const section = String(req.body.section || '').trim().toUpperCase();
  const program = String(req.body.program_code || '').trim();
  const credits = parseInt(req.body.credits, 10);
  const maxRaw = String(req.body.max_enrollment || '').trim();
  const maxEnrollment = maxRaw ? parseInt(maxRaw, 10) : null;

  const fail = (msg) => res.redirect('/dean/assignments?error=' + encodeURIComponent(msg));

  if (!code || !name || !section || !program) {
    return fail('Please fill in course code, course title, section and program.');
  }
  if (code.length > 20 || !/^[A-Z0-9 .&\/-]+$/.test(code)) {
    return fail('Course code may only contain letters, numbers, spaces, dots, dashes, "&" or "/".');
  }
  if (name.length > 120) {
    return fail('Course title is too long (120 characters max).');
  }
  if (section.length > 10) {
    return fail('Section name is too long (10 characters max).');
  }
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(section)) {
    return fail('Section may only contain letters, numbers and dashes.');
  }
  if (!Number.isInteger(credits) || credits < 1 || credits > 12) {
    return fail('Units must be a whole number from 1 to 12.');
  }
  if (maxEnrollment !== null && (!Number.isInteger(maxEnrollment) || maxEnrollment < 1 || maxEnrollment > 500)) {
    return fail('Max enrollment must be a whole number from 1 to 500.');
  }
  if (!inScope(await deanScope(req), program)) {
    return denyCrossDept(res, req);
  }

  try {
    await db.prepare(`
      INSERT INTO course_offerings (course_code, course_name, section, semester_id, instructor_id, credits, max_enrollment, program_code)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(code, name, section, activeSemester.id, credits, maxEnrollment, program);
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) {
      return fail(`${code} Sec. ${section} already exists for ${activeSemester.name}, ${activeSemester.school_year}.`);
    }
    console.error('Create offering error:', err);
    return fail('Could not create that section.');
  }

  res.redirect('/dean/assignments?success=' + encodeURIComponent(`${code} Sec. ${section} added. Assign an instructor below.`));
});

// POST /dean/assignments/offerings/:id/delete - remove an empty section
router.post('/assignments/offerings/:id/delete', async (req, res) => {
  const offering = await db.prepare('SELECT * FROM course_offerings WHERE id = ?').get(req.params.id);
  if (!offering) {
    return res.redirect('/dean/assignments?error=' + encodeURIComponent('Course section not found.'));
  }
  if (!inScope(await deanScope(req), offering.program_code)) {
    return denyCrossDept(res, req);
  }

  const enrolled = (await db.prepare("SELECT COUNT(*) as count FROM enrollments WHERE offering_id = ? AND status = 'enrolled'").get(offering.id)).count;
  if (enrolled > 0) {
    return res.redirect('/dean/assignments?error=' + encodeURIComponent(
      `Cannot delete ${offering.course_code} Sec. ${offering.section}: ${enrolled} student${enrolled === 1 ? ' is' : 's are'} still enrolled.`
    ));
  }

  await db.prepare('DELETE FROM course_offerings WHERE id = ?').run(offering.id);
  res.redirect('/dean/assignments?success=' + encodeURIComponent(`${offering.course_code} Sec. ${offering.section} deleted.`));
});

// POST /dean/assignments/:offeringId - set or clear the instructor for a section
router.post('/assignments/:offeringId', async (req, res) => {
  const offering = await db.prepare('SELECT * FROM course_offerings WHERE id = ?').get(req.params.offeringId);
  if (!offering) {
    return res.redirect('/dean/assignments?error=' + encodeURIComponent('Course section not found.'));
  }
  if (!inScope(await deanScope(req), offering.program_code)) {
    return denyCrossDept(res, req);
  }

  const raw = String(req.body.instructor_id || '').trim();
  let instructor = null;
  if (raw) {
    instructor = await db.prepare("SELECT id, full_name, is_active, department_id FROM users WHERE id = ? AND role = 'faculty'").get(raw);
    if (!instructor) {
      return res.redirect('/dean/assignments?error=' + encodeURIComponent('Choose a valid instructor.'));
    }
    if (!instructor.is_active) {
      return res.redirect('/dean/assignments?error=' + encodeURIComponent('That instructor account is deactivated.'));
    }
    if (!(await facultyForDean(req)).some(f => f.id === instructor.id)) {
      return res.redirect('/dean/assignments?error=' + encodeURIComponent('That instructor belongs to another department.'));
    }
  }

  await db.prepare('UPDATE course_offerings SET instructor_id = ? WHERE id = ?')
    .run(instructor ? instructor.id : null, offering.id);

  const label = `${offering.course_code} Sec. ${offering.section}`;
  const success = instructor
    ? `${label} assigned to ${instructor.full_name}.`
    : `${label} is now unassigned.`;
  res.redirect('/dean/assignments?success=' + encodeURIComponent(success));
});

// GET /dean/accounts
router.get('/accounts', async (req, res) => {
  // Students awaiting approval (role student + is_active 0)
  const ps = programFilter(await deanScope(req), 's.program_code');
  const pendingStudents = await db.prepare(`
    SELECT s.id as student_id, s.student_no, s.first_name, s.last_name, s.program_code, s.year_level, s.section,
      u.id as user_id, u.email, u.created_at
    FROM users u
    JOIN students s ON s.user_id = u.id
    WHERE u.role = 'student' AND u.is_active = 0${ps.clause}
    ORDER BY u.created_at DESC
  `).all(...ps.params);

  // Staff accounts: deans see their own department's teachers (plus unassigned ones)
  // and the usual dean/admin accounts; admins see everyone.
  const departments = await departmentsForDean(req);
  const deptIds = await deanDeptIds(req);
  let staff;
  if (deptIds === null) {
    staff = await db.prepare(`
      SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at,
        u.department_id, d.code AS department_code, d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.role IN ('dean', 'admin', 'faculty')
      ORDER BY u.role, u.full_name
    `).all();
  } else {
    const ph = deptIds.map(() => '?').join(',');
    const facultyClause = deptIds.length
      ? `(u.role = 'faculty' AND (u.department_id IS NULL OR u.department_id IN (${ph})))`
      : "(u.role = 'faculty' AND u.department_id IS NULL)";
    staff = await db.prepare(`
      SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at,
        u.department_id, d.code AS department_code, d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${facultyClause} OR u.role IN ('dean', 'admin')
      ORDER BY u.role, u.full_name
    `).all(...deptIds);
  }

  res.render('dean/accounts', {
    title: 'Manage Accounts - PCC Student Portal',
    pendingStudents,
    staff,
    departments,
    error: req.query.error || null,
    success: req.query.success || null,
    user: req.user
  });
});

// POST /dean/accounts/teachers
router.post('/accounts/teachers', async (req, res) => {
  const { name, password } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();
  const rawDept = String(req.body.department_id || '').trim();
  const departmentId = rawDept ? parseInt(rawDept, 10) : null;
  const allowedDepts = (await departmentsForDean(req)).map(d => d.id);

  if (!name || !email || !password || password.length < 8) {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('Please fill all fields. Password must be at least 8 characters.'));
  }
  if (departmentId !== null && !allowedDepts.includes(departmentId)) {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('Choose a department within your scope.'));
  }
  if (departmentId === null && req.user.role === 'dean') {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('Please choose the teacher\'s department.'));
  }

  try {
    const exists = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (exists) {
      return res.redirect('/dean/accounts?error=' + encodeURIComponent('An account with this email already exists.'));
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.prepare(`
      INSERT INTO users (email, password_hash, role, full_name, is_active, department_id)
      VALUES (?, ?, 'faculty', ?, 1, ?)
    `).run(email, passwordHash, name, departmentId);

    res.redirect('/dean/accounts?success=' + encodeURIComponent(`Teacher account for ${name} created.`));
  } catch (err) {
    console.error('Create teacher error:', err);
    res.redirect('/dean/accounts?error=' + encodeURIComponent('Failed to create teacher account.'));
  }
});

// POST /dean/accounts/faculty/:id/department - move a teacher into a department
router.post('/accounts/faculty/:id/department', async (req, res) => {
  const target = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'faculty'").get(req.params.id);
  if (!target) {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('Teacher account not found.'));
  }

  const rawDept = String(req.body.department_id || '').trim();
  const departmentId = rawDept ? parseInt(rawDept, 10) : null;
  const allowedDepts = (await departmentsForDean(req)).map(d => d.id);

  if (departmentId !== null && !allowedDepts.includes(departmentId)) {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('That department is outside your scope.'));
  }
  if (req.user.role === 'dean') {
    if (target.department_id !== null && !allowedDepts.includes(target.department_id)) {
      return res.redirect('/dean/accounts?error=' + encodeURIComponent('That teacher belongs to another department.'));
    }
    if (departmentId === null) {
      return res.redirect('/dean/accounts?error=' + encodeURIComponent('Choose one of your departments for this teacher.'));
    }
  }

  await db.prepare('UPDATE users SET department_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(departmentId, target.id);
  const dept = departmentId ? await db.prepare('SELECT code FROM departments WHERE id = ?').get(departmentId) : null;
  res.redirect('/dean/accounts?success=' + encodeURIComponent(
    dept ? `${target.full_name} is now in ${dept.code}.` : `${target.full_name} is now unassigned.`
  ));
});

// POST /dean/accounts/students/:studentId/approve
router.post('/accounts/students/:studentId/approve', async (req, res) => {
  const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.studentId);
  if (!student) {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('Student not found.'));
  }
  if (!inScope(await deanScope(req), student.program_code)) {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('Outside your department.'));
  }

  const update = await db.transaction(async () => {
    await db.prepare('UPDATE students SET status = ? WHERE id = ?').run('active', student.id);
    await db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(student.user_id);
    await db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, 'Registration Approved', 'Your registration has been approved by the Dean. You can now sign in.', 'registration')
    `).run(student.user_id);
  });

  await update();

  res.redirect('/dean/accounts?success=' + encodeURIComponent(`Student ${student.student_no} approved.`));
});

// POST /dean/accounts/:id/toggle (activate/deactivate staff)
router.post('/accounts/:id/toggle', async (req, res) => {
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('Account not found.'));
  }
  if (target.id === req.user.id) {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('You cannot deactivate your own account.'));
  }
  if (req.user.role !== 'admin' && target.role !== 'faculty') {
    return res.redirect('/dean/accounts?error=' + encodeURIComponent('Only administrators can change that account.'));
  }
  if (req.user.role !== 'admin' && !(await facultyForDean(req)).some(f => f.id === target.id)) {
    return denyCrossDept(res, req);
  }

  let name = target.full_name;
  let successMsg;

  if (target.is_active) {
    await db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(target.id);
    if (target.role === 'student') {
      await db.prepare("UPDATE students SET status = 'inactive' WHERE user_id = ?").run(target.id);
    }
    successMsg = `${name} deactivated.`;
  } else {
    await db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(target.id);
    if (target.role === 'student') {
      await db.prepare("UPDATE students SET status = 'active' WHERE user_id = ?").run(target.id);
    }
    successMsg = `${name} activated.`;
  }

  res.redirect('/dean/accounts?success=' + encodeURIComponent(successMsg));
});

// GET /dean/reports
router.get('/reports', async (req, res) => {
  // GPA statistics
  const rp = programFilter(await deanScope(req), 'program_code');
  const gpaStats = await db.prepare(`
    SELECT 
      program_code,
      COUNT(*) as student_count,
      AVG(avg_gpa) as avg_gpa
    FROM (
      SELECT s.id, s.program_code, AVG(g.grade_points) as avg_gpa
      FROM students s
      JOIN grades g ON s.id = g.student_id
      WHERE g.grade_points IS NOT NULL
      GROUP BY s.id
    )
    WHERE 1=1${rp.clause}
    GROUP BY program_code
  `).all(...rp.params);

  res.render('dean/reports', {
    title: 'Reports - PCC Student Portal',
    gpaStats,
    user: req.user
  });
});

module.exports = router;
