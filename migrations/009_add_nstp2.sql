-- NSTP 2 (ROTC) was missing from Year 1, 2nd Semester. 3 units like NSTP 1.
INSERT INTO curriculum_items (template_id, semester_number, course_code, course_name, credits, course_type, display_order, lec_hours, lab_hours, prerequisite)
VALUES (1, 2, 'NSTP 2', 'NSTP 2 (ROTC)', 3, 'regular', 9, 3, 0, NULL);

-- Official program total is 146 units.
UPDATE programs SET total_units = 146 WHERE code = 'BSIT';