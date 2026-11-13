// Curriculum helpers shared by the dean and faculty portals.
// Curriculum items store a semester number (1-8); the year level is the
// semester's place in a four-year program, e.g. semesters 3-4 are Year 2.

function yearForSemester(semesterNumber) {
  const semester = Number(semesterNumber);
  if (!Number.isFinite(semester) || semester <= 0) return null;
  return Math.ceil(semester / 2);
}

// Build a "PROGRAM|COURSE CODE" -> year level lookup from curriculum rows.
function courseYearMap(rows) {
  const map = {};
  for (const row of rows || []) {
    if (!row || !row.program_code || !row.course_code) continue;
    const key = `${row.program_code}|${row.course_code}`;
    const year = yearForSemester(row.semester_number);
    if (year == null) continue;
    if (!(key in map)) map[key] = year;
  }
  return map;
}

function yearLevelFor(map, programCode, courseCode) {
  return (map && map[`${programCode}|${courseCode}`]) || null;
}

// Annotate offerings in place so views can show "Year 2 · Section A".
function attachYearLevels(offerings, map) {
  for (const offering of offerings || []) {
    offering.year_level = yearLevelFor(map, offering.program_code, offering.course_code);
  }
  return offerings;
}

module.exports = { yearForSemester, courseYearMap, yearLevelFor, attachYearLevels };
