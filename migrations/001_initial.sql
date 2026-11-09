-- PCC Student Portal Database Schema
-- Version: 1.0

-- Users table (authentication)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student', 'dean', 'admin', 'faculty', 'registrar')),
  full_name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  totp_secret TEXT,
  totp_enabled INTEGER DEFAULT 0,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Students table
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  student_no TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  gender TEXT CHECK(gender IN ('M', 'F', 'Other')),
  date_of_birth TEXT,
  program_code TEXT NOT NULL,
  year_level INTEGER NOT NULL CHECK(year_level BETWEEN 1 AND 4),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'graduated', 'dropped', 'suspended')),
  profile_picture TEXT,
  picture_updated_at TEXT,
  enrollment_date TEXT,
  expected_graduation TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Departments table
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  hod_user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (hod_user_id) REFERENCES users(id)
);

-- Semesters table
CREATE TABLE IF NOT EXISTS semesters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  school_year TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER DEFAULT 0,
  grade_encoding_deadline TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, school_year)
);

-- Programs table
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  department_id INTEGER NOT NULL,
  total_units INTEGER NOT NULL,
  total_years INTEGER DEFAULT 4,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- Curriculum templates
CREATE TABLE IF NOT EXISTS curriculum_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_code TEXT NOT NULL,
  program_name TEXT NOT NULL,
  total_years INTEGER DEFAULT 4,
  total_semesters INTEGER DEFAULT 8,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Template courses per semester
CREATE TABLE IF NOT EXISTS curriculum_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  semester_number INTEGER NOT NULL CHECK(semester_number BETWEEN 1 AND 8),
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  course_type TEXT DEFAULT 'regular',
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES curriculum_templates(id),
  UNIQUE(template_id, course_code)
);

-- Student curriculum assignment
CREATE TABLE IF NOT EXISTS student_curriculum (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  enrolled_year INTEGER NOT NULL,
  current_semester INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (template_id) REFERENCES curriculum_templates(id),
  UNIQUE(student_id, template_id)
);

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  department_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- Course offerings (sections per semester)
CREATE TABLE IF NOT EXISTS course_offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  section TEXT NOT NULL,
  semester_id INTEGER NOT NULL,
  instructor_id INTEGER,
  credits INTEGER NOT NULL,
  max_enrollment INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (semester_id) REFERENCES semesters(id),
  FOREIGN KEY (instructor_id) REFERENCES users(id),
  UNIQUE(course_code, section, semester_id)
);

-- Enrollments
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  offering_id INTEGER NOT NULL,
  enrolled_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'enrolled' CHECK(status IN ('enrolled', 'dropped', 'completed')),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (offering_id) REFERENCES course_offerings(id),
  UNIQUE(student_id, offering_id)
);

-- Grades
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  course_code TEXT NOT NULL,
  semester_id INTEGER NOT NULL,
  grade_value TEXT,
  grade_points REAL,
  credits INTEGER NOT NULL,
  remarks TEXT,
  encoded_by INTEGER NOT NULL,
  encoded_at TEXT DEFAULT (datetime('now')),
  modified_at TEXT,
  is_final INTEGER DEFAULT 0,
  FOREIGN KEY (enrollment_id) REFERENCES enrollments(id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (semester_id) REFERENCES semesters(id),
  FOREIGN KEY (encoded_by) REFERENCES users(id),
  UNIQUE(enrollment_id)
);

-- Grade scale
CREATE TABLE IF NOT EXISTS grade_scale (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  letter_grade TEXT NOT NULL UNIQUE,
  min_score REAL NOT NULL,
  max_score REAL NOT NULL,
  grade_points REAL NOT NULL,
  description TEXT,
  is_passing INTEGER DEFAULT 1
);

-- Grade releases
CREATE TABLE IF NOT EXISTS grade_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT,
  semester_id INTEGER NOT NULL,
  release_type TEXT NOT NULL CHECK(release_type IN ('scheduled', 'manual')),
  scheduled_at TEXT,
  released_at TEXT,
  released_by INTEGER,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'released')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (semester_id) REFERENCES semesters(id),
  FOREIGN KEY (released_by) REFERENCES users(id)
);

-- Prospectus entries
CREATE TABLE IF NOT EXISTS prospectus_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  semester_id INTEGER NOT NULL,
  planned_grade TEXT,
  actual_grade TEXT,
  status TEXT DEFAULT 'planned' CHECK(status IN ('planned', 'enrolled', 'completed')),
  encoded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (course_id) REFERENCES courses(id),
  FOREIGN KEY (semester_id) REFERENCES semesters(id),
  FOREIGN KEY (encoded_by) REFERENCES users(id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Backup codes for 2FA recovery
CREATE TABLE IF NOT EXISTS backup_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Grade audit trail
CREATE TABLE IF NOT EXISTS grade_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  course_code TEXT NOT NULL,
  semester_id INTEGER NOT NULL,
  old_grade TEXT,
  new_grade TEXT NOT NULL,
  encoded_by INTEGER NOT NULL,
  encoded_at TEXT DEFAULT (datetime('now')),
  reason TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (semester_id) REFERENCES semesters(id),
  FOREIGN KEY (encoded_by) REFERENCES users(id)
);

-- Transcripts
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  request_date TEXT DEFAULT (datetime('now')),
  issued_date TEXT,
  issued_by INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'rejected')),
  purpose TEXT,
  copies INTEGER DEFAULT 1,
  verification_code TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (issued_by) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_students_program ON students(program_code);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_offering ON enrollments(offering_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_semester ON grades(semester_id);
CREATE INDEX IF NOT EXISTS idx_grades_enrollment ON grades(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_student ON transcripts(student_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_template ON curriculum_items(template_id);
CREATE INDEX IF NOT EXISTS idx_student_curriculum_student ON student_curriculum(student_id);
