-- Official BSIT curriculum (IT Department)
-- Collapse the duplicate seed BSIT templates into one canonical template (id 1)
-- and load the official 48-course sequence (semester 1-8 = Year 1-4, 1st/2nd sem).

DELETE FROM curriculum_items WHERE template_id IN (SELECT id FROM curriculum_templates WHERE program_code = 'BSIT');
DELETE FROM curriculum_templates WHERE program_code = 'BSIT' AND id <> 1;

UPDATE curriculum_templates
SET program_name = 'Bachelor of Science in Information Technology - Official Curriculum'
WHERE id = 1;

INSERT INTO curriculum_items (template_id, semester_number, course_code, course_name, credits, course_type, display_order) VALUES
  -- Year 1, 1st Semester
  (1, 1, 'IT 101',      'Introduction to Computing',                               3, 'regular', 1),
  (1, 1, 'IT 102',      'Fundamentals of Programming',                             3, 'regular', 2),
  (1, 1, 'GE 1',        'Understanding the Self (with Pop Ed)',                    3, 'regular', 3),
  (1, 1, 'GE 2',        'Purposive Communication',                                 3, 'regular', 4),
  (1, 1, 'GE 3',        'Mathematics in the Modern World',                         3, 'regular', 5),
  (1, 1, 'GE 10',       'Living in the IT Era',                                    3, 'regular', 6),
  (1, 1, 'GE 8',        'Ethics with GAD',                                         3, 'regular', 7),
  (1, 1, 'PATHFIT 1',   'Movement Competency Training',                            2, 'regular', 8),
  (1, 1, 'NSTP 1',      'NSTP 1 (ROTC)',                                           3, 'regular', 9),
  -- Year 1, 2nd Semester
  (1, 2, 'IT 103',      'Intermediate Programming (Java)',                         3, 'regular', 1),
  (1, 2, 'HCI 101',     'Introduction to Human-Computer Interaction',              3, 'regular', 2),
  (1, 2, 'MS 101',      'Discrete Mathematics',                                    3, 'regular', 3),
  (1, 2, 'GE 7',        'Science, Technology and Society (with Env. Climate Change)', 3, 'regular', 4),
  (1, 2, 'GE 9',        'The Life and Works of Rizal',                             3, 'regular', 5),
  (1, 2, 'GE 11',       'The Entrepreneurial Mind',                                3, 'regular', 6),
  (1, 2, 'GE 4',        'Readings in Philippine History',                          3, 'regular', 7),
  (1, 2, 'PATHFIT 2',   'Exercise-Based Fitness Activities',                       2, 'regular', 8),
  -- Year 2, 1st Semester
  (1, 3, 'WS 201',      'Web Systems and Technology',                              3, 'regular', 1),
  (1, 3, 'IT 204',      'Data Structures and Algorithms',                          3, 'regular', 2),
  (1, 3, 'PF 201',      'Object-Oriented Programming',                             3, 'regular', 3),
  (1, 3, 'MS 202',      'Quantitative Methods',                                    3, 'regular', 4),
  (1, 3, 'GE 6',        'The Contemporary World',                                  3, 'regular', 5),
  (1, 3, 'IT 205',      'Information Management',                                  3, 'regular', 6),
  (1, 3, 'GE 12',       'Reading Visual Arts',                                     3, 'regular', 7),
  (1, 3, 'PATHFIT 3',   'Fundamental Dance Steps',                                 2, 'regular', 8),
  -- Year 2, 2nd Semester
  (1, 4, 'IPT 201',     'Integrative Programming and Technology',                  3, 'regular', 1),
  (1, 4, 'PT 201',      'Platform Technologies',                                   3, 'regular', 2),
  (1, 4, 'NET 201',     'Networking 1',                                            3, 'regular', 3),
  (1, 4, 'IT 206',      'Application Development and Emerging Technologies',       3, 'regular', 4),
  (1, 4, 'GE 5',        'Art Appreciation',                                        3, 'regular', 5),
  (1, 4, 'IM 201',      'Fundamentals of Database Systems',                        3, 'regular', 6),
  (1, 4, 'PATHFIT 4',   'Recreational Activities',                                 2, 'regular', 7),
  -- Year 3, 1st Semester
  (1, 5, 'SIA 301',     'System Integration and Architecture 1',                   3, 'regular', 1),
  (1, 5, 'IAS 301',     'Information Assurance and Security 1',                    3, 'regular', 2),
  (1, 5, 'NET 302',     'Networking 2',                                            3, 'regular', 3),
  (1, 5, 'SP 301',      'Social and Professional Issues',                          3, 'regular', 4),
  (1, 5, 'IT ELECT 1',  'System Analysis and Design',                              3, 'elective', 5),
  (1, 5, 'IT ELECT 2',  'Advanced Database Systems',                               3, 'elective', 6),
  -- Year 3, 2nd Semester
  (1, 6, 'IAS 302',     'Information Assurance and Security 2',                    3, 'regular', 1),
  (1, 6, 'SA 301',      'System Administration and Maintenance',                   3, 'regular', 2),
  (1, 6, 'SIA 302',     'System Integration and Architecture 2',                   3, 'regular', 3),
  (1, 6, 'IT ELECT 3',  'Web Application Development',                             3, 'elective', 4),
  (1, 6, 'IT ELECT 4',  'Mobile Application Development',                          3, 'elective', 5),
  (1, 6, 'CAP 301',     'Capstone Project 1',                                      3, 'regular', 6),
  -- Year 4, 1st Semester
  (1, 7, 'CAP 402',     'Capstone Project 2',                                      3, 'regular', 1),
  (1, 7, 'IT ELECT 5',  'Data Analysis',                                           3, 'elective', 2),
  (1, 7, 'IT ELECT 6',  'Network Technologies with IoT',                           3, 'elective', 3),
  -- Year 4, 2nd Semester
  (1, 8, 'OJT 401',     'Practicum / On-the-Job Training (486 hours)',             6, 'regular', 1);