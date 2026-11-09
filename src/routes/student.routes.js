const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { imageUpload, saveProfileImage, removeProfileImage } = require('../utils/image-upload');

// All student routes require auth and student role
router.use(requireAuth);
router.use(requireRole('student'));

// GET /student/dashboard
router.get('/dashboard', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE user_id = ?').get(req.user.id);

  if (!student) {
    return res.render('error', {
      layout: false,
      title: 'Error',
      message: 'Student profile not found.',
      user: req.user
    });
  }

  // Get recent notifications
  const notifications = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
  ).all(req.user.id);

  const unreadCount = db.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL'
  ).get(req.user.id);

  res.render('student/dashboard', {
    title: 'Dashboard - PCC Student Portal',
    student,
    notifications,
    unreadCount: unreadCount.count,
    user: req.user
  });
});

// GET /student/grades
router.get('/grades', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE user_id = ?').get(req.user.id);

  // Get released semesters (students only see grades on/after release)
  const releasedSemesters = db.prepare(`
    SELECT DISTINCT semester_id FROM grade_releases WHERE status = 'released'
  `).all().map(r => r.semester_id);

  // Get grades only for released semesters
  let grades = [];
  if (releasedSemesters.length > 0) {
    const placeholders = releasedSemesters.map(() => '?').join(',');
    grades = db.prepare(`
      SELECT g.*, s.name as semester_name, s.school_year
      FROM grades g
      JOIN semesters s ON g.semester_id = s.id
      WHERE g.student_id = ? AND g.semester_id IN (${placeholders})
      ORDER BY s.school_year DESC, s.name DESC
    `).all(student.id, ...releasedSemesters);
  }

  res.render('student/grades', {
    title: 'My Grades - PCC Student Portal',
    student,
    grades,
    releasedSemesters,
    user: req.user
  });
});

// GET /student/prospectus
router.get('/prospectus', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE user_id = ?').get(req.user.id);

  // Resolve the student's curriculum template. Fall back to the official
  // program template so every student sees the full prospectus.
  let templateId = null;
  const assigned = db.prepare('SELECT template_id FROM student_curriculum WHERE student_id = ?').get(student.id);
  if (assigned) templateId = assigned.template_id;
  if (!templateId) {
    const tpl = db.prepare(`
      SELECT id FROM curriculum_templates
      WHERE program_code = ?
        AND EXISTS (SELECT 1 FROM curriculum_items ci WHERE ci.template_id = curriculum_templates.id)
      ORDER BY id DESC LIMIT 1
    `).get(student.program_code);
    templateId = tpl ? tpl.id : null;
  }

  const curriculum = templateId ? db.prepare(`
    SELECT * FROM curriculum_items
    WHERE template_id = ?
    ORDER BY semester_number, display_order
  `).all(templateId) : [];

  // Grades keyed by course code (most recent wins)
  const gradeRows = db.prepare('SELECT * FROM grades WHERE student_id = ? ORDER BY encoded_at DESC').all(student.id);
  const grades = {};
  gradeRows.forEach(g => { if (!(g.course_code in grades)) grades[g.course_code] = g; });

  const activeSemester = db.prepare('SELECT * FROM semesters WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();

  res.render('student/prospectus', {
    title: 'My Prospectus - PCC Student Portal',
    student,
    curriculum,
    grades,
    semester: activeSemester || null,
    user: req.user
  });
});

// GET /student/notifications
router.get('/notifications', (req, res) => {
  const notifications = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);

  const unreadCount = db.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL'
  ).get(req.user.id);

  res.render('student/notifications', {
    title: 'Notifications - PCC Student Portal',
    notifications,
    unreadCount: unreadCount.count,
    user: req.user
  });
});

// PUT /student/notifications/:id/read
router.put('/notifications/:id/read', (req, res) => {
  db.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(req.params.id, req.user.id);

  res.json({ success: true });
});

// GET /student/profile
router.get('/profile', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE user_id = ?').get(req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  res.render('student/profile', {
    title: 'My Profile - PCC Student Portal',
    student,
    userDetails: user,
    user: req.user
  });
});

// POST /student/profile/picture
router.post('/profile/picture', (req, res, next) => {
  imageUpload.single('picture')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That photo is too large. Please use an image under 5MB.'
      : 'That photo could not be used. Please choose a JPG, PNG, or WebP image.';
    return res.status(400).json({ error: message });
  });
}, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const row = db.prepare('SELECT profile_picture FROM students WHERE user_id = ?').get(req.user.id);
  if (!row) {
    return res.status(404).json({ error: 'Student profile not found' });
  }

  let filePath;
  try {
    filePath = saveProfileImage(req.file, 'student');
  } catch (err) {
    return res.status(400).json({ error: 'That photo could not be used. Please choose a real JPG, PNG, or WebP image.' });
  }

  db.prepare("UPDATE students SET profile_picture = ?, picture_updated_at = datetime('now') WHERE user_id = ?")
    .run(filePath, req.user.id);

  // Old photo is no longer referenced — remove it from disk.
  if (row.profile_picture && row.profile_picture !== filePath) {
    removeProfileImage(row.profile_picture);
  }

  res.json({ success: true, url: filePath });
});

// DELETE /student/profile/picture
router.delete('/profile/picture', (req, res) => {
  const row = db.prepare('SELECT profile_picture FROM students WHERE user_id = ?').get(req.user.id);
  db.prepare('UPDATE students SET profile_picture = NULL, picture_updated_at = NULL WHERE user_id = ?')
    .run(req.user.id);

  if (row && row.profile_picture) {
    removeProfileImage(row.profile_picture);
  }

  res.json({ success: true });
});

module.exports = router;
