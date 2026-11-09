-- Remove seed course offerings that are NOT part of the official BSIT curriculum
-- (IT 111, MATH 101) and align the IT 102 offering with its official title.

-- Keep IT 102 but use the official course title
UPDATE course_offerings
SET course_name = 'Fundamentals of Programming'
WHERE course_code = 'IT 102' AND course_name != 'Fundamentals of Programming';

-- Delete grade + enrollment records tied to the removed courses (FK order: grades -> enrollments -> offerings)
DELETE FROM grades
WHERE enrollment_id IN (
  SELECT e.id FROM enrollments e
  JOIN course_offerings co ON e.offering_id = co.id
  WHERE co.course_code IN ('IT 111', 'MATH 101')
);

DELETE FROM enrollments
WHERE offering_id IN (SELECT id FROM course_offerings WHERE course_code IN ('IT 111', 'MATH 101'));

DELETE FROM course_offerings WHERE course_code IN ('IT 111', 'MATH 101');