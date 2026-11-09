-- Give faculty accounts a home department so deans only see their own teachers.
ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id);

-- Existing teachers all belong to the IT department (the only department with teachers so far).
UPDATE users SET department_id = (SELECT id FROM departments WHERE code = 'IT')
WHERE role = 'faculty' AND department_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
