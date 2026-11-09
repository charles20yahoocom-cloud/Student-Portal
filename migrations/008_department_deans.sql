-- Multi-department deans: scope deans to their own departments.
-- 1) Offerings carry a program so dean lists/sheets can be scoped.
ALTER TABLE course_offerings ADD COLUMN program_code TEXT;
UPDATE course_offerings SET program_code = 'BSIT' WHERE course_code = 'IT 102';

-- 2) Link the existing IT dean (user id 3) as head of the IT department.
UPDATE departments SET hod_user_id = 3 WHERE code = 'IT';

-- 3) Demo Criminology dean (password: dean123) heading the CRIM department.
INSERT INTO users (email, password_hash, role, full_name, is_active)
VALUES ('dean.crim@pcc.edu.ph', '$2b$10$qV.owQjWR6DC9dMDTGEdjepQ.6Kzu6jI3Uc0IIoa/X68a0900RmtS', 'dean', 'Criminology Dean', 1);
UPDATE departments SET hod_user_id = (SELECT id FROM users WHERE email = 'dean.crim@pcc.edu.ph') WHERE code = 'CRIM';