const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/database');
const { requireAuth, requireRole, jarForRole } = require('../middleware/authenticate');
const { generateTokens, setTokenCookies } = require('./auth.routes');
const { imageUpload, saveProfileImage, removeProfileImage } = require('../utils/image-upload');

const STAFF_ROLES = ['faculty', 'dean', 'admin', 'registrar'];

const HOME_BY_ROLE = {
  faculty: '/faculty/dashboard',
  dean: '/dean/dashboard',
  registrar: '/dean/dashboard',
  admin: '/admin/dashboard'
};

const ROLE_LABELS = {
  faculty: 'Instructor',
  dean: 'Dean',
  registrar: 'Registrar',
  admin: 'Administrator'
};

router.use(requireAuth);
router.use(requireRole(...STAFF_ROLES));

// GET /profile
router.get('/', (req, res) => {
  const userDetails = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!userDetails) {
    return res.redirect('/login');
  }

  res.render('staff/profile', {
    title: 'Profile Settings - PCC Student Portal',
    userDetails,
    roleLabel: ROLE_LABELS[userDetails.role] || userDetails.role,
    home: HOME_BY_ROLE[userDetails.role] || '/',
    saved: req.query.saved === '1',
    pwSaved: req.query.pw === '1',
    error: req.query.error || null,
    user: req.user
  });
});

// POST /profile — update name + email
router.post('/', (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!fullName) {
    return res.redirect('/profile?error=' + encodeURIComponent('Full name is required.'));
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.redirect('/profile?error=' + encodeURIComponent('Please enter a valid email address.'));
  }

  const taken = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id != ?').get(email, req.user.id);
  if (taken) {
    return res.redirect('/profile?error=' + encodeURIComponent('That email is already used by another account.'));
  }

  db.prepare("UPDATE users SET full_name = ?, email = ?, updated_at = datetime('now') WHERE id = ?")
    .run(fullName, email, req.user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { accessToken, refreshToken } = generateTokens(updated);
  setTokenCookies(res, accessToken, refreshToken, jarForRole(updated.role));

  res.redirect('/profile?saved=1');
});

// POST /profile/password
router.post('/password', async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const confirm = String(req.body.confirm_password || '');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!(await bcrypt.compare(current, user.password_hash))) {
    return res.redirect('/profile?error=' + encodeURIComponent('Your current password is incorrect.'));
  }
  if (next.length < 8) {
    return res.redirect('/profile?error=' + encodeURIComponent('New password must be at least 8 characters.'));
  }
  if (next !== confirm) {
    return res.redirect('/profile?error=' + encodeURIComponent('New password and confirmation do not match.'));
  }
  if (next === current) {
    return res.redirect('/profile?error=' + encodeURIComponent('New password must be different from the current one.'));
  }

  const passwordHash = await bcrypt.hash(next, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(passwordHash, req.user.id);

  res.redirect('/profile?pw=1');
});

// POST /profile/picture
router.post('/picture', (req, res, next) => {
  imageUpload.single('picture')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That photo is too large. Please use an image under 5MB.'
      : 'That photo could not be used. Please choose a JPG, PNG, or WebP image.';
    return res.status(400).json({ error: message });
  });
}, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded. Use a JPG, PNG, or WebP file.' });
  }

  const row = db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.user.id);
  let filePath;
  try {
    filePath = saveProfileImage(req.file, `staff-${req.user.id}`);
  } catch (err) {
    return res.status(400).json({ error: 'That photo could not be used. Please choose a real JPG, PNG, or WebP image.' });
  }

  db.prepare("UPDATE users SET profile_picture = ?, picture_updated_at = datetime('now') WHERE id = ?")
    .run(filePath, req.user.id);

  if (row && row.profile_picture && row.profile_picture !== filePath) {
    removeProfileImage(row.profile_picture);
  }

  res.json({ success: true, url: filePath });
});

// DELETE /profile/picture
router.delete('/picture', (req, res) => {
  const row = db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.user.id);
  db.prepare('UPDATE users SET profile_picture = NULL, picture_updated_at = NULL WHERE id = ?')
    .run(req.user.id);

  if (row && row.profile_picture) {
    removeProfileImage(row.profile_picture);
  }

  res.json({ success: true });
});

module.exports = router;
