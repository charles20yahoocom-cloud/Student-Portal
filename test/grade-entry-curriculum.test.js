const test = require('node:test');
const assert = require('node:assert/strict');
const { groupGradeEntryByYear } = require('../src/utils/grade-entry-curriculum');

test('groups every curriculum subject by year and attaches matching active sections', () => {
  const curriculum = [
    { program_code: 'BSIT', program_name: 'Information Technology', semester_number: 1, course_code: 'IT 101', course_name: 'Computing' },
    { program_code: 'BSIT', program_name: 'Information Technology', semester_number: 3, course_code: 'IT 201', course_name: 'Systems' }
  ];
  const offerings = [
    { id: 1, program_code: 'BSIT', course_code: 'IT 201', course_name: 'Systems', section: 'A' },
    { id: 2, program_code: 'BSIT', course_code: 'IT 999', course_name: 'Elective', section: 'B' }
  ];

  const groups = groupGradeEntryByYear(curriculum, offerings);

  assert.deepEqual(groups.map(group => [group.programCode, group.year]), [
    ['BSIT', 1],
    ['BSIT', 2],
    [null, null]
  ]);
  assert.equal(groups[0].subjects[0].sections.length, 0);
  assert.deepEqual(groups[1].subjects[0].sections.map(section => section.id), [1]);
  assert.deepEqual(groups[2].subjects[0].sections.map(section => section.id), [2]);
});

test('only maps an offering without a program when its curriculum course is unambiguous', () => {
  const curriculum = [
    { program_code: 'BSIT', program_name: 'Information Technology', semester_number: 1, course_code: 'GE 1', course_name: 'Self' },
    { program_code: 'BSBA', program_name: 'Business', semester_number: 1, course_code: 'GE 1', course_name: 'Self' }
  ];
  const offerings = [
    { id: 1, program_code: null, course_code: 'GE 1', course_name: 'Self', section: 'A' }
  ];

  const groups = groupGradeEntryByYear(curriculum, offerings);

  assert.equal(groups[0].subjects[0].sections.length, 0);
  assert.equal(groups[1].subjects[0].sections.length, 0);
  assert.equal(groups.at(-1).year, null);
});
