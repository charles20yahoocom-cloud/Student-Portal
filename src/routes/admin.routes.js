const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/database-runtime');
const { requireAuth, requireRole } = require('../middleware/authenticate');

// All admin routes require admin role
router.use(requireAuth);
router.use(requireRole('admin'));

// GET /admin/dashboard
router.get('/dashboard', async (req, res) => {
  const totalStudents = (await db.prepare('SELECT COUNT(*) as count FROM students').get()).count;
  const totalFaculty = (await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'faculty'").get()).count;
  const totalDean = (await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'dean'").get()).count;
  const totalAdmins = (await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get()).count;

  const recentStudents = await db.prepare(`
    SELECT s.*, u.email, u.created_at as joined_at
    FROM students s JOIN users u ON u.id = s.user_id
    WHERE u.role = 'student'
    ORDER BY s.id DESC LIMIT 8
  `).all();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard - PCC Student Portal',
    totalStudents,
    totalFaculty,
    totalDean,
    totalAdmins,
    recentStudents,
    user: req.user
  });
});

// GET /admin/accounts (staff list + create form)
router.get('/accounts', async (req, res) => {
  const staff = await db.prepare(`
    SELECT id, email, full_name, role, is_active, last_login, created_at
    FROM users
    WHERE role IN ('dean', 'faculty', 'registrar', 'admin')
    ORDER BY role, full_name
  `).all();

  const departments = await db.prepare(`
    SELECT d.*, u.full_name AS hod_name
    FROM departments d
    LEFT JOIN users u ON d.hod_user_id = u.id
    ORDER BY d.code
  `).all();

  const deans = await db.prepare(`
    SELECT id, full_name, email FROM users
    WHERE role = 'dean' AND is_active = 1
    ORDER BY full_name
  `).all();

  res.render('admin/accounts', {
    title: 'Staff Accounts - PCC Student Portal',
    staff,
    departments,
    deans,
    error: req.query.error || null,
    success: req.query.success || null,
    user: req.user
  });
});

// POST /admin/accounts (create dean/faculty/registrar account)
router.post('/accounts', async (req, res) => {
  const { full_name, role, password } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!email || !full_name || !role || !password) {
    return res.redirect('/admin/accounts?error=' + encodeURIComponent('Please complete all fields.'));
  }

  const allowedRoles = ['dean', 'faculty', 'registrar'];
  if (!allowedRoles.includes(role)) {
    return res.redirect('/admin/accounts?error=' + encodeURIComponent('Invalid role selected.'));
  }

  if (password.length < 8) {
    return res.redirect('/admin/accounts?error=' + encodeURIComponent('Password must be at least 8 characters.'));
  }

  try {
    const emailExists = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (emailExists) {
      return res.redirect('/admin/accounts?error=' + encodeURIComponent('An account with that email already exists.'));
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.prepare(
      'INSERT INTO users (email, password_hash, role, full_name, is_active) VALUES (?, ?, ?, ?, 1)'
    ).run(email, passwordHash, role, full_name);

    return res.redirect('/admin/accounts?success=' + encodeURIComponent('Account created successfully!'));
  } catch (err) {
    console.error('Create staff account error:', err);
    return res.redirect('/admin/accounts?error=' + encodeURIComponent('An error occurred. Please try again.'));
  }
});

// POST /admin/accounts/:id/toggle (activate / deactivate)
router.post('/accounts/:id/toggle', async (req, res) => {
  const account = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (account && account.role !== 'admin') {
    await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(account.is_active ? 0 : 1, account.id);
  }
  res.redirect('/admin/accounts');
});

// POST /admin/hod (assign or clear a department head — dean accounts only)
router.post('/hod', async (req, res) => {
  const departmentId = parseInt(req.body.department_id, 10);
  const userId = req.body.user_id ? parseInt(req.body.user_id, 10) : null;

  const dept = await db.prepare('SELECT * FROM departments WHERE id = ?').get(departmentId);
  if (!dept) {
    return res.redirect('/admin/accounts?error=' + encodeURIComponent('Department not found.'));
  }
  if (userId) {
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!u || u.role !== 'dean') {
      return res.redirect('/admin/accounts?error=' + encodeURIComponent('Department head must be a dean account.'));
    }
  }
  await db.prepare('UPDATE departments SET hod_user_id = ? WHERE id = ?').run(userId, departmentId);
  res.redirect('/admin/accounts?success=' + encodeURIComponent(`Head updated for ${dept.code}.`));
});

module.exports = router;