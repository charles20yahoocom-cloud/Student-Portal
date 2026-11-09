require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const { authenticateToken } = require('./middleware/authenticate');
const { uploadsDir, dbPath } = require('./config/paths');

// Import routes
const authRoutes = require('./routes/auth.routes');
const studentRoutes = require('./routes/student.routes');
const deanRoutes = require('./routes/dean.routes');
const facultyRoutes = require('./routes/faculty.routes');
const adminRoutes = require('./routes/admin.routes');
const staffProfileRoutes = require('./routes/staff-profile.routes');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Helmet adds `upgrade-insecure-requests` by default. On a plain-HTTP LAN that
// would rewrite the portal's own asset requests to https:// and break the demo,
// so keep it only when the deployment is actually served over HTTPS.
const HTTPS_DEPLOYMENT = process.env.COOKIE_SECURE === 'true' ||
  (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');

// Security middleware. All front-end assets are self-hosted so the LAN demo
// works without internet and the CSP no longer needs any CDN origins.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: HTTPS_DEPLOYMENT ? [] : null,
    }
  }
}));

// Rate limiting (body parsing must come first so limiters can key safely).
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.'
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later.'
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.'
});

// Behind a reverse proxy, set TRUST_PROXY (e.g. "loopback" or "1") explicitly.
// TRUST_PROXY=false disables proxy header trust entirely.
if (String(process.env.TRUST_PROXY).toLowerCase() === 'false') {
  app.set('trust proxy', false);
} else {
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
}

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/', limiter);
app.use('/login', loginLimiter);
app.use(['/forgot-password', '/register'], authLimiter);

// Cookies
app.use(cookieParser(process.env.SESSION_SECRET));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Uploaded profile pictures are private: serve them only to a signed-in user.
app.use('/uploads', authenticateToken, (req, res, next) => {
  if (!req.user) return res.status(403).end();
  next();
}, express.static(uploadsDir));

// EJS template engine
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');

// Global middleware for user data
app.use(authenticateToken);

// Authenticated pages must not be cached (back button after logout, shared PCs).
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Department theme flag (e.g. IT dean + IT students get the maroon tech theme).
// IT students layer an extra `dept-it-student` class for their own
// binary-and-wires background. Available in views as `deptTheme`.
const db = require('./config/database');

// Lightweight liveness/readiness probe for a process manager or uptime monitor.
app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.json({ status: 'ok', db: 'ok', uptime: Math.round(process.uptime()) });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({ status: 'error', db: 'unavailable' });
  }
});

app.use((req, res, next) => {
  res.locals.deptTheme = null;
  if (req.user) {
    try {
      let code = null;
      if (req.user.role === 'dean') {
        const row = db.prepare('SELECT code FROM departments WHERE hod_user_id = ? LIMIT 1').get(req.user.id);
        if (row && row.code) code = String(row.code).toLowerCase();
      } else if (req.user.role === 'student') {
        const row = db.prepare(`
          SELECT d.code FROM students s
          JOIN programs p ON s.program_code = p.code
          JOIN departments d ON p.department_id = d.id
          WHERE s.user_id = ? LIMIT 1
        `).get(req.user.id);
        if (row && row.code) code = String(row.code).toLowerCase();
      }
      if (code === 'it') {
        res.locals.deptTheme = req.user.role === 'dean' ? 'dept-it' : 'dept-it dept-it-student';
      } else if (code) {
        res.locals.deptTheme = 'dept-' + code;
      }
    } catch (err) { /* theming must never break a request */ }
  }
  next();
});

// Routes
app.get('/', (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }
  if (req.user.role === 'student') {
    return res.redirect('/student/dashboard');
  }
  if (req.user.role === 'faculty') {
    return res.redirect('/faculty/dashboard');
  }
  if (req.user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  if (req.user.role === 'dean' || req.user.role === 'registrar') {
    return res.redirect('/dean/dashboard');
  }
  res.redirect('/login');
});

app.use('/', authRoutes);
app.use('/profile', staffProfileRoutes);
app.use('/student', studentRoutes);
app.use('/dean', deanRoutes);
app.use('/faculty', facultyRoutes);
app.use('/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    layout: false,
    title: '404 - Not Found',
    message: 'The page you are looking for does not exist.',
    user: req.user || null
  });
});

// Error handler
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    const status = err.type === 'entity.too.large' ? 413 : 400;
    if (req.is('application/json') || String(req.path).startsWith('/dean/grades/')) {
      return res.status(status).json({ error: status === 413 ? 'Request body is too large' : 'Invalid JSON body' });
    }
    return res.status(status).render('error', {
      layout: false,
      title: `${status} - Bad Request`,
      message: status === 413 ? 'That request was too large.' : 'That request could not be read.',
      user: req.user || null
    });
  }
  console.error('Server Error:', err);
  res.status(500).render('error', {
    layout: false,
    title: '500 - Server Error',
    message: 'Something went wrong. Please try again later.',
    user: req.user || null
  });
});

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`
  PCC Student Portal - Passi City College
  ---------------------------------------
  Local:    http://localhost:${PORT}
  Bind:     ${HOST}:${PORT}
  Env:      ${process.env.NODE_ENV || 'development'}
  Database: ${dbPath}
  Uploads:  ${uploadsDir}
  Health:   http://localhost:${PORT}/healthz
  `);
});

server.on('error', (err) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});

// Close cleanly so SQLite checkpoints its WAL and the port is released.
function shutdown(signal) {
  console.log(`${signal} received - shutting down...`);
  server.close(() => {
    try { db.close(); } catch (err) { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
