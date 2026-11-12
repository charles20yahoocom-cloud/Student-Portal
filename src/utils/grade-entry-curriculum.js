function groupGradeEntryByYear(curriculumRows, offerings) {
  const programsByCourse = new Map();
  for (const item of curriculumRows) {
    if (!programsByCourse.has(item.course_code)) programsByCourse.set(item.course_code, new Set());
    programsByCourse.get(item.course_code).add(item.program_code);
  }

  const groups = new Map();
  const matchedOfferingIds = new Set();
  for (const item of curriculumRows) {
    const year = Math.ceil(item.semester_number / 2);
    const key = `${item.program_code}:${year}`;
    if (!groups.has(key)) {
      groups.set(key, {
        programCode: item.program_code,
        programName: item.program_name,
        year,
        subjects: []
      });
    }

    const subjectOfferings = offerings.filter(offering =>
      offering.course_code === item.course_code &&
      (offering.program_code === item.program_code ||
        (!offering.program_code && programsByCourse.get(item.course_code).size === 1))
    );
    subjectOfferings.forEach(offering => matchedOfferingIds.add(offering.id));
    groups.get(key).subjects.push({
      courseCode: item.course_code,
      courseName: item.course_name,
      sections: subjectOfferings
    });
  }

  const unmatchedOfferings = offerings.filter(offering => !matchedOfferingIds.has(offering.id));
  if (unmatchedOfferings.length) {
    const subjects = new Map();
    for (const offering of unmatchedOfferings) {
      if (!subjects.has(offering.course_code)) {
        subjects.set(offering.course_code, {
          courseCode: offering.course_code,
          courseName: offering.course_name,
          sections: []
        });
      }
      subjects.get(offering.course_code).sections.push(offering);
    }
    groups.set('other', {
      programCode: null,
      programName: 'Other active offerings',
      year: null,
      subjects: [...subjects.values()]
    });
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      subjects: group.subjects.sort((a, b) => a.courseCode.localeCompare(b.courseCode))
    }))
    .sort((a, b) => {
      if (a.year === null && b.year === null) return 0;
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return a.programCode.localeCompare(b.programCode) || a.year - b.year;
    });
}

module.exports = { groupGradeEntryByYear };
