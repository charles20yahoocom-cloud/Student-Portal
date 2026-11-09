-- Official prospectus fields on curriculum items: lecture/lab hours + prerequisite.
ALTER TABLE curriculum_items ADD COLUMN lec_hours INTEGER;
ALTER TABLE curriculum_items ADD COLUMN lab_hours INTEGER;
ALTER TABLE curriculum_items ADD COLUMN prerequisite TEXT;

-- Default hours: lecture = credit units, lab = 0 (adjust per course later if needed)
UPDATE curriculum_items SET lec_hours = credits, lab_hours = 0;

-- Prerequisites as per the official prospectus (blank = None)
UPDATE curriculum_items SET prerequisite = 'IT 102' WHERE course_code = 'IT 103';
UPDATE curriculum_items SET prerequisite = 'IT 103' WHERE course_code = 'WS 201';
UPDATE curriculum_items SET prerequisite = 'IT 103' WHERE course_code = 'IT 204';
UPDATE curriculum_items SET prerequisite = 'IT 103' WHERE course_code = 'PF 201';
UPDATE curriculum_items SET prerequisite = 'MS 101' WHERE course_code = 'MS 202';
UPDATE curriculum_items SET prerequisite = 'IT 103' WHERE course_code = 'IT 205';
UPDATE curriculum_items SET prerequisite = 'PF 201' WHERE course_code = 'IPT 201';
UPDATE curriculum_items SET prerequisite = 'IT 103' WHERE course_code = 'PT 201';
UPDATE curriculum_items SET prerequisite = 'IT 205' WHERE course_code = 'NET 201';
UPDATE curriculum_items SET prerequisite = 'IT 103' WHERE course_code = 'IT 206';
UPDATE curriculum_items SET prerequisite = 'IT 205' WHERE course_code = 'IM 201';
UPDATE curriculum_items SET prerequisite = '3rd Year Standing' WHERE course_code = 'SP 301';
UPDATE curriculum_items SET prerequisite = 'IPT 201' WHERE course_code = 'SIA 301';
UPDATE curriculum_items SET prerequisite = 'IM 201' WHERE course_code = 'IAS 301';
UPDATE curriculum_items SET prerequisite = 'NET 201' WHERE course_code = 'NET 302';
UPDATE curriculum_items SET prerequisite = 'IM 201' WHERE course_code = 'IT ELECT 2';
UPDATE curriculum_items SET prerequisite = '3rd Year Standing' WHERE course_code = 'CAP 301';
UPDATE curriculum_items SET prerequisite = 'IAS 301' WHERE course_code = 'IAS 302';
UPDATE curriculum_items SET prerequisite = 'SIA 301' WHERE course_code = 'SA 301';
UPDATE curriculum_items SET prerequisite = 'SIA 301' WHERE course_code = 'SIA 302';
UPDATE curriculum_items SET prerequisite = 'IT 206' WHERE course_code = 'IT ELECT 4';
UPDATE curriculum_items SET prerequisite = 'CAP 301' WHERE course_code = 'CAP 402';
UPDATE curriculum_items SET prerequisite = '4th Year Standing' WHERE course_code = 'IT ELECT 5';