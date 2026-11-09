// Rich demo data for capstone defenses and UI walkthroughs.
//
//   node seeds/demo-data.js     (or: npm run demo-data)
//
// Adds ~20 BSIT students, six sections per semester, and three semesters of
// grades (two completed + the active semester) so the dean, faculty and student
// screens all have realistic content. A few students are deliberately low so
// the dean's "Students at Risk (GPA < 2.0)" panel is populated.
//
// Safe to re-run: every insert is keyed on a natural unique constraint
// (email, student number, section, enrollment) and existing rows are left
// untouched, so grades edited by hand are never overwritten.
//
// Runs after `npm run seed`. Refuses to run in production unless
// FORCE_DEMO=1 is set.

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../src/config/database');

const DEMO_PASSWORD = process.env.DEMO_STUDENT_PASSWORD || 'PccStudent#2026';

// ── Demo students ────────────────────────────────────────────────────────────
// All are second-year BSIT students in sections A/B. Student numbers start at
// 2024-10001 so they never collide with the hand-made accounts in seed.js.
const STUDENTS = [
  { first: 'Maria Clara', middle: 'D.', last: 'Santos', gender: 'F', dob: '2005-02-14', email: 'maria.santos@pcc.edu.ph' },
  { first: 'Paolo Miguel', middle: 'R.', last: 'Reyes', gender: 'M', dob: '2004-11-03', email: 'paolo.reyes@pcc.edu.ph' },
  { first: 'Angela Mae', middle: 'C.', last: 'Cruz', gender: 'F', dob: '2005-06-21', email: 'angela.cruz@pcc.edu.ph' },
  { first: 'Mark Joseph', middle: 'B.', last: 'Bautista', gender: 'M', dob: '2004-09-17', email: 'mark.bautista@pcc.edu.ph' },
  { first: 'Nicole Anne', middle: 'G.', last: 'Garcia', gender: 'F', dob: '2005-03-08', email: 'nicole.garcia@pcc.edu.ph' },
  { first: 'Kevin John', middle: 'M.', last: 'Mendoza', gender: 'M', dob: '2004-12-29', email: 'kevin.mendoza@pcc.edu.ph' },
  { first: 'Stephanie Rose', middle: 'V.', last: 'Villanueva', gender: 'F', dob: '2005-07-12', email: 'stephanie.villanueva@pcc.edu.ph' },
  { first: 'Christian Paul', middle: 'R.', last: 'Ramos', gender: 'M', dob: '2004-10-05', email: 'christian.ramos@pcc.edu.ph' },
  { first: 'Jasmine Faith', middle: 'A.', last: 'Aquino', gender: 'F', dob: '2005-01-26', email: 'jasmine.aquino@pcc.edu.ph' },
  { first: 'Daniel Louis', middle: 'N.', last: 'Navarro', gender: 'M', dob: '2004-08-30', email: 'daniel.navarro@pcc.edu.ph' },
  { first: 'Patricia Anne', middle: 'C.', last: 'Castillo', gender: 'F', dob: '2005-04-18', email: 'patricia.castillo@pcc.edu.ph' },
  { first: 'Emmanuel James', middle: 'T.', last: 'Torres', gender: 'M', dob: '2004-07-09', email: 'emmanuel.torres@pcc.edu.ph' },
  { first: 'Camille Joy', middle: 'F.', last: 'Flores', gender: 'F', dob: '2005-05-23', email: 'camille.flores@pcc.edu.ph' },
  { first: 'Rafael Antonio', middle: 'D.', last: 'Domingo', gender: 'M', dob: '2004-06-11', email: 'rafael.domingo@pcc.edu.ph' },
  { first: 'Liza Marie', middle: 'S.', last: 'Salvador', gender: 'F', dob: '2005-08-02', email: 'liza.salvador@pcc.edu.ph' },
  { first: 'Bryan Christopher', middle: 'P.', last: 'Pascual', gender: 'M', dob: '2004-05-15', email: 'bryan.pascual@pcc.edu.ph' },
  { first: 'Hannah Grace', middle: 'V.', last: 'Velasco', gender: 'F', dob: '2005-09-27', email: 'hannah.velasco@pcc.edu.ph' },
  { first: 'Marco Paolo', middle: 'S.', last: 'Sandoval', gender: 'M', dob: '2004-04-06', email: 'marco.sandoval@pcc.edu.ph' },
  { first: 'Andrea Nicole', middle: 'F.', last: 'Fernandez', gender: 'F', dob: '2005-10-19', email: 'andrea.fernandez@pcc.edu.ph' },
  { first: 'Joshua David', middle: 'M.', last: 'Mercado', gender: 'M', dob: '2004-03-01', email: 'joshua.mercado@pcc.edu.ph' }
];

// Indexes (0-based) of students with a failing/low profile so the at-risk
// dashboard has something to show.
const AT_RISK = new Set([2, 9, 15]);

// ── Semesters and sections ───────────────────────────────────────────────────
const PAST_SEMESTERS = [
  { name: '1st Semester', school_year: '2024-2025', start: '2024-08-01', end: '2024-12-15' },
  { name: '2nd Semester', school_year: '2024-2025', start: '2025-01-10', end: '2025-05-30' }
];

// Official BSIT curriculum codes for Year 1 (completed) and Year 2, 1st sem
// (active). Six sections per semester keeps the lists readable in a demo.
const TERM_SECTIONS = [
  {
    key: 'past1',
    courses: [
      { code: 'IT 101', name: 'Introduction to Computing', credits: 3 },
      { code: 'IT 102', name: 'Fundamentals of Programming', credits: 3 },
      { code: 'GE 1', name: 'Understanding the Self (with Pop Ed)', credits: 3 },
      { code: 'GE 2', name: 'Purposive Communication', credits: 3 },
      { code: 'GE 3', name: 'Mathematics in the Modern World', credits: 3 },
      { code: 'PATHFIT 1', name: 'Movement Competency Training', credits: 2 }
    ]
  },
  {
    key: 'past2',
    courses: [
      { code: 'IT 103', name: 'Intermediate Programming (Java)', credits: 3 },
      { code: 'HCI 101', name: 'Introduction to Human-Computer Interaction', credits: 3 },
      { code: 'MS 101', name: 'Discrete Mathematics', credits: 3 },
      { code: 'GE 7', name: 'Science, Technology and Society', credits: 3 },
      { code: 'GE 9', name: 'The Life and Works of Rizal', credits: 3 },
      { code: 'PATHFIT 2', name: 'Exercise-Based Fitness Activities', credits: 2 }
    ]
  },
  {
    key: 'current',
    courses: [
      { code: 'WS 201', name: 'Web Systems and Technology', credits: 3 },
      { code: 'IT 204', name: 'Data Structures and Algorithms', credits: 3 },
      { code: 'PF 201', name: 'Object-Oriented Programming', credits: 3 },
      { code: 'MS 202', name: 'Quantitative Methods', credits: 3 },
      { code: 'GE 6', name: 'The Contemporary World', credits: 3 },
      { code: 'IT 205', name: 'Information Management', credits: 3 }
    ]
  }
];

const PROFILES = {
  excellent: [1.00, 1.25, 1.25, 1.50, 1.00, 1.25],
  good: [1.50, 1.75, 2.00, 1.75, 1.50, 2.00],
  average: [2.00, 2.25, 2.50, 2.25, 2.00, 2.50],
  low: [2.75, 3.00, 2.75, 3.25, 3.00, 2.50],
  risk: [3.50, 4.00, 5.00, 3.75, 4.50, 5.00]
};

function profileFor(index) {
  if (AT_RISK.has(index)) return 'risk';
  return ['average', 'good', 'average', 'low', 'excellent', 'average', 'good', 'average', 'low', 'good'][index % 10];
}

function gradeFor(index, term, courseIndex) {
  const values = PROFILES[profileFor(index)];
  const value = values[(courseIndex + term * 2) % values.length];
  return Math.min(5, Math.max(1, value));
}

function remarkFor(value) {
  if (value === 5) return 'Failed';
  if (value >= 4) return 'For remediation';
  return '';
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ensureSemester(semester) {
  db.prepare(`
    INSERT OR IGNORE INTO semesters (name, school_year, start_date, end_date, is_active)
    VALUES (?, ?, ?, ?, 0)
  `).run(semester.name, semester.school_year, semester.start, semester.end);

  return db.prepare('SELECT * FROM semesters WHERE name = ? AND school_year = ?')
    .get(semester.name, semester.school_year);
}

function ensureOffering(semesterId, course, instructorId) {
  db.prepare(`
    INSERT OR IGNORE INTO course_offerings
      (course_code, course_name, section, semester_id, instructor_id, credits, max_enrollment, program_code)
    VALUES (?, ?, 'A', ?, ?, ?, 45, 'BSIT')
  `).run(course.code, course.name, semesterId, instructorId, course.credits);

  const offering = db.prepare(
    'SELECT * FROM course_offerings WHERE course_code = ? AND section = ? AND semester_id = ?'
  ).get(course.code, 'A', semesterId);

  if (offering && !offering.instructor_id && instructorId) {
    db.prepare('UPDATE course_offerings SET instructor_id = ? WHERE id = ?')
      .run(instructorId, offering.id);
    offering.instructor_id = instructorId;
  }

  return offering;
}

function main() {
  if (process.env.NODE_ENV === 'production' && process.env.FORCE_DEMO !== '1') {
    console.error('Refusing to add demo data in production. Set FORCE_DEMO=1 only for a disposable demo database.');
    process.exit(1);
  }

  const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@pcc.edu.ph'").get();
  if (!admin) {
    console.error('Admin account not found. Run `npm run seed` first.');
    process.exit(1);
  }

  const teacher = db.prepare("SELECT id FROM users WHERE email = 'teacher.john@pcc.edu.ph'").get();
  const encoderId = teacher ? teacher.id : admin.id;

  const currentSemester = db.prepare(
    'SELECT * FROM semesters WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get();
  if (!currentSemester) {
    console.error('No active semester. Activate one before adding demo data.');
    process.exit(1);
  }

  const template = db.prepare(
    "SELECT id FROM curriculum_templates WHERE program_code = 'BSIT' ORDER BY id LIMIT 1"
  ).get();
  if (!template) {
    console.error('BSIT curriculum template not found. Run `npm run seed` first.');
    process.exit(1);
  }

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const stats = { students: 0, offerings: 0, enrollments: 0, grades: 0, releases: 0, notifications: 0 };

  const run = db.transaction(() => {
    // 1. Semesters: two completed terms plus the one already active.
    const past1 = ensureSemester(PAST_SEMESTERS[0]);
    const past2 = ensureSemester(PAST_SEMESTERS[1]);
    const semesters = [past1, past2, currentSemester];

    // 2. Offerings for each term.
    const offeringsByTerm = TERM_SECTIONS.map((term, termIndex) => {
      const semester = semesters[termIndex];
      const offerings = term.courses.map((course) => ensureOffering(semester.id, course, teacher ? teacher.id : null));
      stats.offerings += offerings.length;
      return { semester, offerings };
    });

    // 3. Students + user accounts.
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (email, password_hash, role, full_name)
      VALUES (?, ?, 'student', ?)
    `);
    const findUser = db.prepare('SELECT id FROM users WHERE email = ?');
    const insertStudent = db.prepare(`
      INSERT OR IGNORE INTO students
        (user_id, student_no, first_name, middle_name, last_name, gender, date_of_birth,
         program_code, year_level, section, status, enrollment_date, expected_graduation)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'BSIT', 2, ?, 'active', '2024-06-15', '2028-06-30')
    `);
    const findStudent = db.prepare('SELECT * FROM students WHERE student_no = ?');
    const assignCurriculum = db.prepare(`
      INSERT OR IGNORE INTO student_curriculum (student_id, template_id, enrolled_year, current_semester)
      VALUES (?, ?, 2024, 3)
    `);

    const studentRows = [];
    STUDENTS.forEach((student, index) => {
      const fullName = `${student.first} ${student.last}`;
      insertUser.run(student.email, passwordHash, fullName);
      const user = findUser.get(student.email);

      const studentNo = `2024-${String(10001 + index)}`;
      const section = index % 2 === 0 ? 'A' : 'B';
      insertStudent.run(
        user.id, studentNo, student.first, student.middle, student.last,
        student.gender, student.dob, section
      );

      const row = findStudent.get(studentNo);
      assignCurriculum.run(row.id, template.id);
      studentRows.push({ ...row, index });
      if (row) stats.students++;
    });

    // Include the original demo student (Juan) in the same cohorts so his
    // student portal shows a full transcript, not just one subject.
    const juan = db.prepare("SELECT * FROM students WHERE student_no = '2024-00001'").get();
    if (juan && !studentRows.some((s) => s.id === juan.id)) {
      assignCurriculum.run(juan.id, template.id);
      studentRows.push({ ...juan, index: 0 });
    }

    // 4. Enroll every demo student and insert grades.
    const enroll = db.prepare(`
      INSERT OR IGNORE INTO enrollments (student_id, offering_id, status)
      VALUES (?, ?, 'enrolled')
    `);
    const findEnrollment = db.prepare(
      'SELECT * FROM enrollments WHERE student_id = ? AND offering_id = ?'
    );
    const insertGrade = db.prepare(`
      INSERT OR IGNORE INTO grades
        (enrollment_id, student_id, course_code, semester_id, grade_value, grade_points,
         credits, remarks, encoded_by, is_final)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    offeringsByTerm.forEach(({ semester, offerings }, termIndex) => {
      offerings.forEach((offering, courseIndex) => {
        studentRows.forEach((student) => {
          enroll.run(student.id, offering.id);
          const enrollment = findEnrollment.get(student.id, offering.id);
          if (!enrollment) return;
          stats.enrollments++;

          // In the active term leave roughly a third of the rows blank so the
          // faculty grade-entry screen has real work to demonstrate.
          const index = student.index;
          const isCurrent = termIndex === 2;
          const skipCurrent = isCurrent && !AT_RISK.has(index) && (index + courseIndex) % 3 === 0;
          if (skipCurrent) return;

          const value = gradeFor(index, termIndex, courseIndex);
          const gradeValue = value.toFixed(2);
          const gradePoints = +(5 - value).toFixed(2);

          insertGrade.run(
            enrollment.id, student.id, offering.course_code, semester.id,
            gradeValue, gradePoints, offering.credits,
            remarkFor(value), encoderId
          );
          stats.grades++;
        });
      });
    });

    // 5. Release grades for every term so students can see them.
    const hasRelease = db.prepare(
      'SELECT 1 FROM grade_releases WHERE semester_id = ? AND course_code IS NULL'
    );
    const insertRelease = db.prepare(`
      INSERT INTO grade_releases (course_code, semester_id, release_type, released_at, released_by, status)
      VALUES (NULL, ?, 'manual', datetime('now'), ?, 'released')
    `);
    for (const semester of semesters) {
      if (!hasRelease.get(semester.id)) {
        insertRelease.run(semester.id, admin.id);
        stats.releases++;
      }
    }

    // 6. One welcome notification per demo student (never duplicated).
    const hasNotification = db.prepare('SELECT 1 FROM notifications WHERE user_id = ? LIMIT 1');
    const insertNotification = db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, ?, ?, 'welcome')
    `);
    for (const student of studentRows) {
      if (hasNotification.get(student.user_id)) continue;
      insertNotification.run(
        student.user_id,
        'Welcome to PCC Student Portal',
        'Your account is ready. You can view your grades and official prospectus here.'
      );
      stats.notifications++;
    }
  });

  try {
    run();
  } catch (err) {
    console.error('Demo data failed:', err.message);
    process.exit(1);
  }

  console.log('\nDemo data ready.');
  console.log(`  students added/checked : ${stats.students}`);
  console.log(`  sections checked       : ${stats.offerings}`);
  console.log(`  enrollments checked    : ${stats.enrollments}`);
  console.log(`  grades checked         : ${stats.grades}`);
  console.log(`  grade releases added   : ${stats.releases}`);
  console.log(`  notifications added    : ${stats.notifications}`);
  console.log(`\nAll demo students share the password from DEMO_STUDENT_PASSWORD (${DEMO_PASSWORD}).`);
  console.log('At-risk demo students: Angela Mae Cruz, Daniel Louis Navarro, Bryan Christopher Pascual.');

  db.close();
  process.exit(0);
}

main();
