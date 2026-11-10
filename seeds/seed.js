require('dotenv').config();
const db = require('../src/config/database');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

async function seed() {
  if (process.env.NODE_ENV === 'production' && process.env.FORCE_SEED !== '1') {
    console.error('Refusing to run seeds in production. Set FORCE_SEED=1 only if you really intend to overwrite demo data.');
    process.exit(1);
  }

  console.log('Seeding PCC Student Portal database...\n');

  // Run migrations
  const migrationPath = path.join(__dirname, '..', 'migrations', '001_initial.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  db.exec(migration);
  console.log('✓ Database schema created');

  // Seed grade scale
  const gradeScale = [
    { letter: 'A+', min: 97, max: 100, points: 4.0, desc: 'Excellent', passing: 1 },
    { letter: 'A', min: 93, max: 96, points: 4.0, desc: 'Excellent', passing: 1 },
    { letter: 'A-', min: 90, max: 92, points: 3.7, desc: 'Very Good', passing: 1 },
    { letter: 'B+', min: 87, max: 89, points: 3.3, desc: 'Very Good', passing: 1 },
    { letter: 'B', min: 83, max: 86, points: 3.0, desc: 'Good', passing: 1 },
    { letter: 'B-', min: 80, max: 82, points: 2.7, desc: 'Good', passing: 1 },
    { letter: 'C+', min: 77, max: 79, points: 2.3, desc: 'Satisfactory', passing: 1 },
    { letter: 'C', min: 73, max: 76, points: 2.0, desc: 'Satisfactory', passing: 1 },
    { letter: 'C-', min: 70, max: 72, points: 1.7, desc: 'Satisfactory', passing: 1 },
    { letter: 'D+', min: 67, max: 69, points: 1.3, desc: 'Passing', passing: 1 },
    { letter: 'D', min: 60, max: 66, points: 1.0, desc: 'Passing', passing: 1 },
    { letter: 'F', min: 0, max: 59, points: 0.0, desc: 'Failed', passing: 0 },
    { letter: 'INC', min: 0, max: 0, points: null, desc: 'Incomplete', passing: 0 },
    { letter: 'DRP', min: 0, max: 0, points: null, desc: 'Dropped', passing: 0 },
    { letter: 'W', min: 0, max: 0, points: null, desc: 'Withdrawn', passing: 0 }
  ];

  const insertGrade = db.prepare(
    'INSERT OR IGNORE INTO grade_scale (letter_grade, min_score, max_score, grade_points, description, is_passing) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const g of gradeScale) {
    insertGrade.run(g.letter, g.min, g.max, g.points, g.desc, g.passing);
  }
  console.log('✓ Grade scale seeded');

  // Seed departments
  const departments = [
    { code: 'IT', name: 'Information Technology' },
    { code: 'HM', name: 'Hospitality Management' },
    { code: 'BA', name: 'Business Administration' },
    { code: 'CRIM', name: 'Criminology' },
    { code: 'ED', name: 'Education' }
  ];

  const insertDept = db.prepare('INSERT OR IGNORE INTO departments (code, name) VALUES (?, ?)');
  for (const dept of departments) {
    insertDept.run(dept.code, dept.name);
  }
  console.log('✓ Departments seeded');

  // Seed programs
  const programs = [
    { code: 'BSIT', name: 'Bachelor of Science in Information Technology', dept: 'IT', units: 140, years: 4 },
    { code: 'BSHM', name: 'Bachelor of Science in Hospitality Management', dept: 'HM', units: 140, years: 4 },
    { code: 'BSBA', name: 'Bachelor of Science in Business Administration', dept: 'BA', units: 140, years: 4 },
    { code: 'BSCRIM', name: 'Bachelor of Science in Criminology', dept: 'CRIM', units: 140, years: 4 },
    { code: 'BSED-ENG', name: 'Bachelor of Secondary Education major in English', dept: 'ED', units: 140, years: 4 },
    { code: 'BSED-MATH', name: 'Bachelor of Secondary Education major in Mathematics', dept: 'ED', units: 140, years: 4 },
    { code: 'BEED', name: 'Bachelor of Elementary Education', dept: 'ED', units: 140, years: 4 }
  ];

  const insertProgram = db.prepare(
    'INSERT OR IGNORE INTO programs (code, name, department_id, total_units, total_years) VALUES (?, ?, (SELECT id FROM departments WHERE code = ?), ?, ?)'
  );
  for (const prog of programs) {
    insertProgram.run(prog.code, prog.name, prog.dept, prog.units, prog.years);
  }
  console.log('✓ Programs seeded');

  // Seed semesters
  const semesters = [
    { name: '1st Semester', sy: '2025-2026', start: '2025-08-01', end: '2025-12-15', active: 1 },
    { name: '2nd Semester', sy: '2025-2026', start: '2026-01-10', end: '2026-05-30', active: 0 },
    { name: 'Summer', sy: '2025-2026', start: '2026-06-15', end: '2026-08-15', active: 0 }
  ];

  const insertSem = db.prepare(
    'INSERT OR IGNORE INTO semesters (name, school_year, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?)'
  );
  for (const sem of semesters) {
    insertSem.run(sem.name, sem.sy, sem.start, sem.end, sem.active);
  }
  console.log('✓ Semesters seeded');

  // Seed curriculum template for BSIT
  const bsitTemplate = db.prepare(
    'INSERT OR IGNORE INTO curriculum_templates (program_code, program_name, total_years, total_semesters) VALUES (?, ?, ?, ?)'
  ).run('BSIT', 'Bachelor of Science in Information Technology', 4, 8);

  const templateId = bsitTemplate.lastInsertRowid;

  if (templateId) {
    const bsitCourses = [
      // Year 1, Semester 1
      { sem: 1, code: 'IT 101', name: 'Introduction to Computing', credits: 3, type: 'major', order: 1 },
      { sem: 1, code: 'IT 102', name: 'Programming 1 (CS1)', credits: 3, type: 'major', order: 2 },
      { sem: 1, code: 'MATH 101', name: 'College Algebra', credits: 3, type: 'gened', order: 3 },
      { sem: 1, code: 'ENG 101', name: 'Communication Arts 1', credits: 3, type: 'gened', order: 4 },
      { sem: 1, code: 'PE 101', name: 'Physical Fitness', credits: 2, type: 'pe', order: 5 },
      { sem: 1, code: 'NSTP 101', name: 'NSTP 1', credits: 3, type: 'nstp', order: 6 },

      // Year 1, Semester 2
      { sem: 2, code: 'IT 111', name: 'Programming 2 (CS2)', credits: 3, type: 'major', order: 1 },
      { sem: 2, code: 'IT 112', name: 'Discrete Mathematics', credits: 3, type: 'major', order: 2 },
      { sem: 2, code: 'MATH 102', name: 'Plane Trigonometry', credits: 3, type: 'gened', order: 3 },
      { sem: 2, code: 'ENG 102', name: 'Communication Arts 2', credits: 3, type: 'gened', order: 4 },
      { sem: 2, code: 'PE 102', name: 'Rhythmic Activities', credits: 2, type: 'pe', order: 5 },
      { sem: 2, code: 'NSTP 102', name: 'NSTP 2', credits: 3, type: 'nstp', order: 6 },

      // Year 2, Semester 3
      { sem: 3, code: 'IT 201', name: 'Data Structures', credits: 3, type: 'major', order: 1 },
      { sem: 3, code: 'IT 202', name: 'Object-Oriented Programming', credits: 3, type: 'major', order: 2 },
      { sem: 3, code: 'MATH 201', name: 'Analytic Geometry', credits: 3, type: 'gened', order: 3 },
      { sem: 3, code: 'SCI 201', name: 'Natural Science 1', credits: 3, type: 'gened', order: 4 },
      { sem: 3, code: 'SOC 201', name: 'Society and Culture', credits: 3, type: 'gened', order: 5 },

      // Year 2, Semester 4
      { sem: 4, code: 'IT 211', name: 'Database Management', credits: 3, type: 'major', order: 1 },
      { sem: 4, code: 'IT 212', name: 'Algorithms and Complexity', credits: 3, type: 'major', order: 2 },
      { sem: 4, code: 'MATH 202', name: 'Linear Algebra', credits: 3, type: 'gened', order: 3 },
      { sem: 4, code: 'SCI 202', name: 'Natural Science 2', credits: 3, type: 'gened', order: 4 },
      { sem: 4, code: 'PHIL 201', name: 'Ethics', credits: 3, type: 'gened', order: 5 },

      // Year 3, Semester 5
      { sem: 5, code: 'IT 301', name: 'Web Development', credits: 3, type: 'major', order: 1 },
      { sem: 5, code: 'IT 302', name: 'Operating Systems', credits: 3, type: 'major', order: 2 },
      { sem: 5, code: 'IT 303', name: 'Computer Networks', credits: 3, type: 'major', order: 3 },
      { sem: 5, code: 'MATH 301', name: 'Statistics and Probability', credits: 3, type: 'gened', order: 4 },
      { sem: 5, code: 'RIZAL', name: 'Life and Works of Rizal', credits: 3, type: 'gened', order: 5 },

      // Year 3, Semester 6
      { sem: 6, code: 'IT 311', name: 'Software Engineering', credits: 3, type: 'major', order: 1 },
      { sem: 6, code: 'IT 312', name: 'Systems Analysis and Design', credits: 3, type: 'major', order: 2 },
      { sem: 6, code: 'IT 313', name: 'Information Security', credits: 3, type: 'major', order: 3 },
      { sem: 6, code: 'IT 314', name: 'Elective 1', credits: 3, type: 'elective', order: 4 },

      // Year 4, Semester 7
      { sem: 7, code: 'IT 401', name: 'Practicum', credits: 6, type: 'major', order: 1 },
      { sem: 7, code: 'IT 402', name: 'Elective 2', credits: 3, type: 'elective', order: 2 },

      // Year 4, Semester 8
      { sem: 8, code: 'IT 411', name: 'Capstone Project', credits: 6, type: 'major', order: 1 }
    ];

    const insertItem = db.prepare(
      'INSERT OR IGNORE INTO curriculum_items (template_id, semester_number, course_code, course_name, credits, course_type, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    for (const course of bsitCourses) {
      insertItem.run(templateId, course.sem, course.code, course.name, course.credits, course.type, course.order);
    }
    console.log('✓ BSIT curriculum template seeded');
  }

  // Create demo accounts (upsert so re-seeding refreshes passwords)
  const upsertUser = db.prepare(`
    INSERT INTO users (email, password_hash, role, full_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      password_hash = excluded.password_hash,
      role = excluded.role,
      full_name = excluded.full_name
  `);

  const DEMO_PASSWORDS = {
    admin: process.env.DEMO_ADMIN_PASSWORD || 'PccAdmin#2026',
    dean: process.env.DEMO_DEAN_PASSWORD || 'PccDean#2026',
    teacher: process.env.DEMO_TEACHER_PASSWORD || 'PccTeacher#2026',
    student: process.env.DEMO_STUDENT_PASSWORD || 'PccStudent#2026'
  };

  const adminPassword = await bcrypt.hash(DEMO_PASSWORDS.admin, 10);
  upsertUser.run('admin@pcc.edu.ph', adminPassword, 'admin', 'System Administrator');
  console.log('✓ Default admin created (admin@pcc.edu.ph)');

  // Create demo dean account
  const deanPassword = await bcrypt.hash(DEMO_PASSWORDS.dean, 10);
  upsertUser.run('dean.it@pcc.edu.ph', deanPassword, 'dean', 'IT Department Dean');
  console.log('✓ Demo dean created (dean.it@pcc.edu.ph)');

  // Create demo faculty/teacher account
  const teacherPassword = await bcrypt.hash(DEMO_PASSWORDS.teacher, 10);
  upsertUser.run('teacher.john@pcc.edu.ph', teacherPassword, 'faculty', 'John M. Castro');
  console.log('✓ Demo teacher created (teacher.john@pcc.edu.ph)');

  // Create demo student account + record
  const studentPassword = await bcrypt.hash(DEMO_PASSWORDS.student, 10);
  upsertUser.run('juan.delacruz@pcc.edu.ph', studentPassword, 'student', 'Juan Dela Cruz');

  const studentUserId = db.prepare('SELECT id FROM users WHERE email = ?').get('juan.delacruz@pcc.edu.ph');
  const studentIns = db.prepare(
    'INSERT OR IGNORE INTO students (user_id, student_no, first_name, last_name, program_code, year_level, section, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(studentUserId.id, '2024-00001', 'Juan', 'Dela Cruz', 'BSIT', 2, 'A', 'active');
  if (studentIns.changes > 0) {
    console.log('✓ Demo student created (juan.delacruz@pcc.edu.ph / student123)');
  }

  // Assign BSIT curriculum to demo student
  const studentRow = db.prepare("SELECT * FROM students WHERE student_no = '2024-00001'").get();
  if (studentRow) {
    const tmpl = db.prepare("SELECT id FROM curriculum_templates WHERE program_code = 'BSIT'").get();
    if (tmpl) {
      db.prepare(
        'INSERT OR IGNORE INTO student_curriculum (student_id, template_id, enrolled_year, current_semester) VALUES (?, ?, ?, ?)'
      ).run(studentRow.id, tmpl.id, 2024, 3);
      console.log('✓ Demo student assigned BSIT curriculum');
    }
  }

  // Seed course offerings for active semester (for grade entry demo)
  const activeSem = db.prepare('SELECT * FROM semesters WHERE is_active = 1').get();
  if (activeSem && studentRow) {
    const offerings = [
      { code: 'IT 102', name: 'Programming 1 (CS1)', section: 'A', credits: 3 },
      { code: 'IT 111', name: 'Programming 2 (CS2)', section: 'A', credits: 3 },
      { code: 'MATH 101', name: 'College Algebra', section: 'A', credits: 3 }
    ];
    const insertOffering = db.prepare(
      'INSERT OR IGNORE INTO course_offerings (course_code, course_name, section, semester_id, credits) VALUES (?, ?, ?, ?, ?)'
    );
    for (const off of offerings) {
      insertOffering.run(off.code, off.name, off.section, activeSem.id, off.credits);
    }
    console.log('✓ Course offerings seeded');

    // Assign demo teacher as instructor to the offerings
    const teacher = db.prepare("SELECT id FROM users WHERE email = 'teacher.john@pcc.edu.ph'").get();
    if (teacher) {
      db.prepare("UPDATE course_offerings SET instructor_id = ? WHERE semester_id = ? AND instructor_id IS NULL")
        .run(teacher.id, activeSem.id);
      console.log('✓ Demo teacher assigned to course offerings');
    }

    // Enroll demo student in the offerings (active semester)
    const enrollStmt = db.prepare(
      'INSERT OR IGNORE INTO enrollments (student_id, offering_id) VALUES (?, (SELECT id FROM course_offerings WHERE course_code = ? AND semester_id = ?))'
    );
    for (const off of offerings) {
      enrollStmt.run(studentRow.id, off.code, activeSem.id);
    }
    console.log('✓ Demo student enrolled in active semester courses');

    // Sample grades for semester 1 (so student can view under a released semester)
    const sem1 = db.prepare("SELECT * FROM semesters WHERE name = '1st Semester' AND is_active = 1").get();
    if (sem1) {
      const insertGrade = db.prepare(`
        INSERT OR IGNORE INTO grades (enrollment_id, student_id, course_code, semester_id, grade_value, grade_points, credits, remarks, encoded_by, is_final)
        VALUES ((SELECT e.id FROM enrollments e JOIN course_offerings co ON e.offering_id = co.id WHERE e.student_id = ? AND co.course_code = ? AND co.semester_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      const gradeMap = [
        { code: 'IT 102', val: '1.00', points: 4.0, credits: 3, remarks: 'Excellent' },
        { code: 'MATH 101', val: '1.50', points: 3.5, credits: 3, remarks: '' }
      ];
      for (const g of gradeMap) {
        insertGrade.run(studentRow.id, g.code, activeSem.id, studentRow.id, g.code, activeSem.id, g.val, g.points, g.credits, g.remarks, 3);
      }
      console.log('✓ Sample grades seeded');

      // Release grades for the active semester so student can see them
      db.prepare(`
        INSERT OR IGNORE INTO grade_releases (course_code, semester_id, release_type, released_at, released_by, status)
        VALUES (NULL, ?, 'manual', datetime('now'), 3, 'released')
      `).run(activeSem.id);
      console.log('✓ Grades released for active semester');
    }
  }

  // Seed notifications for demo student
  if (studentRow) {
    const notifStmt = db.prepare(
      'INSERT OR IGNORE INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)'
    );
    notifStmt.run(studentRow.user_id, 'Welcome to PCC Student Portal!', 'Your account has been created. You can now view your grades and prospectus.', 'welcome');
    notifStmt.run(studentRow.user_id, 'Grades Released', 'Your grades for 1st Semester have been released.', 'grade_release');
    console.log('✓ Demo notifications seeded');
  }

  // Ensure upload directories exist
  const uploadsBase = path.join(__dirname, '..', 'uploads');
  for (const dir of ['profiles', 'temp']) {
    fs.mkdirSync(path.join(uploadsBase, dir), { recursive: true });
  }

  console.log('\n✓ Database seeded successfully!');
  console.log('\nDemo accounts (passwords from DEMO_* env vars, or built-in demo values):');
  console.log('  Admin:  admin@pcc.edu.ph');
  console.log('  Dean:   dean.it@pcc.edu.ph');
  console.log('  Teacher: teacher.john@pcc.edu.ph');
  console.log('  Student: juan.delacruz@pcc.edu.ph');
}

seed().catch(console.error);
