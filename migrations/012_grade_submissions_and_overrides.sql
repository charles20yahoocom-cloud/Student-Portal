-- Instructor grade submissions (one row per class section) and the dean's
-- per-student prospectus overrides.

CREATE TABLE IF NOT EXISTS grade_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL UNIQUE,
  submitted_by INTEGER NOT NULL,
  submitted_at TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'submitted',
  note TEXT,
  FOREIGN KEY (offering_id) REFERENCES course_offerings(id),
  FOREIGN KEY (submitted_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_grade_submissions_offering ON grade_submissions(offering_id);

CREATE TABLE IF NOT EXISTS prospectus_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  course_code TEXT NOT NULL,
  grade_value TEXT,
  grade_points REAL,
  remarks TEXT,
  updated_by INTEGER NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_id, course_code),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_prospectus_overrides_student ON prospectus_overrides(student_id);

-- Backfill: any class that already has encoded grades counts as submitted so
-- existing data keeps working (and deans do not see blank submission statuses).
INSERT OR IGNORE INTO grade_submissions (offering_id, submitted_by, submitted_at, status)
SELECT e.offering_id, MIN(g.encoded_by), MAX(g.encoded_at), 'submitted'
FROM grades g
JOIN enrollments e ON e.id = g.enrollment_id
GROUP BY e.offering_id;
