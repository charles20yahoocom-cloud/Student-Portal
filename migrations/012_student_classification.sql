-- Track regular or irregular academic standing independently from enrollment status.
ALTER TABLE students ADD COLUMN classification TEXT NOT NULL DEFAULT 'regular'
  CHECK(classification IN ('regular', 'irregular'));
