-- Ensure student registration options exist even when demo seeding is skipped.
INSERT OR IGNORE INTO departments (code, name) VALUES
  ('IT', 'Information Technology'),
  ('HM', 'Hospitality Management'),
  ('BA', 'Business Administration'),
  ('CRIM', 'Criminology'),
  ('ED', 'Education');

INSERT OR IGNORE INTO programs (code, name, department_id, total_units, total_years) VALUES
  ('BSIT', 'Bachelor of Science in Information Technology', (SELECT id FROM departments WHERE code = 'IT'), 146, 4),
  ('BSHM', 'Bachelor of Science in Hospitality Management', (SELECT id FROM departments WHERE code = 'HM'), 140, 4),
  ('BSCRIM', 'Bachelor of Science in Criminology', (SELECT id FROM departments WHERE code = 'CRIM'), 140, 4),
  ('BSBA', 'Bachelor of Science in Business Administration', (SELECT id FROM departments WHERE code = 'BA'), 140, 4),
  ('BSED-ENG', 'Bachelor of Secondary Education major in English', (SELECT id FROM departments WHERE code = 'ED'), 140, 4),
  ('BSED-MATH', 'Bachelor of Secondary Education major in Mathematics', (SELECT id FROM departments WHERE code = 'ED'), 140, 4),
  ('BEED', 'Bachelor of Elementary Education', (SELECT id FROM departments WHERE code = 'ED'), 140, 4);
