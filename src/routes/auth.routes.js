const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const otplib = require('otplib');
const { body, validationResult } = require('express-validator');
const db = require('../config/database-runtime');
const { requireAuth, JAR_COOKIES, jarForRole } = require('../middleware/authenticate');
const { sendMail, smtpConfigured } = require('../utils/mailer');
const { imageUpload, saveProfileImage } = require('../utils/image-upload');
const registrationPrograms = require('../config/registration-programs');

// Profile photo upload during registration (kept in memory, written after the student row exists)
const registerUpload = imageUpload;
const registrationProgramOptions = registrationPrograms.map(({ code, name }) => ({ code, name }));

let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (qrErr) {
  console.warn('qrcode module unavailable:', qrErr.message);
}

async function generateQRDataUrl(otpauthUrl) {
  if (!QRCode) return null;
  try {
    return await QRCode.toDataURL(otpauthUrl);
  } catch (err) {
    console.warn('QR code generation failed:', err.message);
    return null;
  }
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// otplib v13 dropped the `authenticator` helper object in favour of top-level
// functions (generateSecret / generateURI / verify), and `verify` became async
// and returns { valid } instead of a boolean. Keep one small adapter so the 2FA
// routes work on either major version and stay readable.
const otplibAuthenticator = otplib.authenticator;
const totp = {
  generateSecret() {
    return otplibAuthenticator ? otplibAuthenticator.generateSecret() : otplib.generateSecret();
  },
  keyuri(account, issuer, secret) {
    return otplibAuthenticator
      ? otplibAuthenticator.keyuri(account, issuer, secret)
      : otplib.generateURI({ issuer, label: account, secret });
  },
  async verify({ token, secret }) {
    if (!secret) return false;
    const code = String(token || '').trim();
    if (!/^\d{6}$/.test(code)) return false;
    if (otplibAuthenticator) {
      return Boolean(otplibAuthenticator.verify({ token: code, secret }));
    }
    const result = await otplib.verify({ secret, token: code });
    return Boolean(result && result.valid);
  }
};

// Cookies are Secure by default in production. A plain-HTTP LAN deployment can
// set COOKIE_SECURE=false; public hosting must leave it true behind HTTPS.
function cookieSecure() {
  const flag = String(process.env.COOKIE_SECURE || '').trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

// Generate tokens
function generateTokens(user) {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
    ACCESS_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}

// Set token cookies (dual jars: 'student' vs 'staff' — see authenticate.js)
function setTokenCookies(res, accessToken, refreshToken, jar) {
  const names = JAR_COOKIES[jar] || JAR_COOKIES.staff;
  res.cookie(names.access, accessToken, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  res.cookie(names.refresh, refreshToken, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  // Remove the older path-scoped refresh cookie so only one copy is sent.
  res.clearCookie(names.refresh, { path: '/auth/refresh' });
}

// Clear the pre-dual-jar cookie names (one-time hygiene for existing browsers)
function clearLegacyCookies(res) {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.clearCookie('refreshToken', { path: '/auth/refresh' });
}

// Front-door maps: which roles each entrance accepts, where each role lives,
// and the display name of each entrance.
const doorRoles = {
  student: ['student'],
  instructor: ['faculty'],
  dean: ['dean', 'admin', 'registrar'],
  staff: ['faculty', 'dean', 'admin', 'registrar'] // shared staff door (any non-student)
};
const homeByRole = {
  student: '/student/dashboard',
  faculty: '/faculty/dashboard',
  dean: '/dean/dashboard',
  admin: '/admin/dashboard',
  registrar: '/dean/dashboard'
};
const doorNames = {
  student: 'Student',
  instructor: 'Instructor',
  dean: 'Dean / Admin',
  staff: 'Staff'
};
const doorPaths = {
  student: '/login',
  instructor: '/instructor',
  dean: '/dean',
  staff: '/staff'
};

// Handle a logged-in visitor at a login door. Matching role → send home.
// Wrong role → clear switch-account screen (no more silent confusing bounce).
// Returns true when the response was handled, false when the caller should
// render the login form.
function doorEntrance(req, res, portal) {
  if (!req.user) return false;
  if ((doorRoles[portal] || []).includes(req.user.role)) {
    res.redirect('/');
    return true;
  }
  res.render('auth/switch-account', {
    layout: false,
    title: 'Switch account - PCC',
    name: req.user.fullName || req.user.email,
    role: req.user.role,
    door: doorNames[portal] || portal,
    doorPath: doorPaths[portal] || '/login',
    home: homeByRole[req.user.role] || '/'
  });
  return true;
}

// GET /login (students only — staff use GET /staff)
router.get('/login', (req, res) => {
  if (doorEntrance(req, res, 'student')) return;
  res.render('auth/login', {
    layout: false,
    title: 'Login - PCC Student Portal',
    error: null,
    notice: req.query.registered
      ? 'Registration submitted! The Dean will approve your account before you can sign in.'
      : (req.query.reset ? 'Password updated! Sign in with your new password.' : null),
    portal: 'student',
    user: null
  });
});

// GET /staff (direct-link entrance for teachers + dean/admin)
router.get('/staff', (req, res) => {
  if (doorEntrance(req, res, 'staff')) return;
  res.render('auth/login', {
    layout: false,
    title: 'Staff Login - PCC',
    error: null,
    notice: null,
    portal: 'staff',
    user: null
  });
});

// GET /dean (direct-link entrance for dean / admin)
router.get('/dean', (req, res) => {
  if (doorEntrance(req, res, 'dean')) return;
  res.render('auth/login', {
    layout: false,
    title: 'Dean / Admin Login - PCC',
    error: null,
    notice: null,
    portal: 'dean',
    user: null
  });
});

// GET /instructor (direct-link entrance for teachers)
router.get('/instructor', (req, res) => {
  if (doorEntrance(req, res, 'instructor')) return;
  res.render('auth/login', {
    layout: false,
    title: 'Instructor Login - PCC',
    error: null,
    notice: null,
    portal: 'instructor',
    user: null
  });
});

// GET /forgot-password (students)
router.get('/forgot-password', (req, res) => {
  if (req.user) {
    return res.redirect('/');
  }
  renderForgot(res, {
    step: 1,
    email: '',
    error: null,
    notice: null,
    sent: false
  });
});

function renderForgot(res, props) {
  res.render('auth/forgot-password', {
    layout: false,
    title: 'Forgot Password - PCC Student Portal',
    user: null,
    ...props
  });
}

function hashResetCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

const RESET_TTL_MINUTES = 10;
const RESET_MAX_ATTEMPTS = 5;
const RESET_MAX_REQUESTS = 3;

const FORGOT_GENERIC_NOTICE = 'If that student email is registered, a 6-digit verification code has been sent. The code expires in 10 minutes.';

// POST /forgot-password — issue an email verification code
router.post('/forgot-password', async (req, res) => {
  if (req.user) {
    return res.redirect('/');
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const renderStep1 = (props) => renderForgot(res, {
    step: 1,
    email,
    error: null,
    notice: null,
    sent: false,
    ...props
  });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return renderStep1({ error: 'Please enter a valid email address.' });
  }

  // Without an SMTP server we cannot deliver a code. Do not create one and do
  // not reveal it in the URL — direct the student to a human instead.
  if (!smtpConfigured()) {
    return renderStep1({
      error: 'Password reset by email is not available yet. Please contact the Dean or the administrator to reset your password.'
    });
  }

  const user = await db.prepare("SELECT id, email FROM users WHERE lower(email) = ? AND role = 'student'").get(email);
  if (!user) {
    return renderStep1({ notice: FORGOT_GENERIC_NOTICE });
  }

  const recent = (await db.prepare(`SELECT COUNT(*) AS c FROM password_resets WHERE email = ? AND created_at > datetime('now', '-15 minutes')`).get(email)).c;
  if (recent >= RESET_MAX_REQUESTS) {
    return renderStep1({ error: 'Too many code requests for this email. Please wait 15 minutes and try again.' });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE email = ? AND used_at IS NULL").run(email);
  await db.prepare(`INSERT INTO password_resets (user_id, email, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', ?))`)
    .run(user.id, email, hashResetCode(code), `+${RESET_TTL_MINUTES} minutes`);

  const mail = await sendMail({
    to: user.email,
    subject: 'Your PCC Student Portal verification code',
    text: [
      'Your verification code is:',
      '',
      `    ${code}`,
      '',
      `It expires in ${RESET_TTL_MINUTES} minutes.`,
      'If you did not request this, you can ignore this email.'
    ].join('\n')
  });

  if (!mail.sent) {
    // Invalidate the code we just stored so a failed delivery cannot be replayed.
    await db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE email = ? AND used_at IS NULL").run(email);
    console.error('Password reset email could not be sent:', mail.reason || 'unknown');
    return renderStep1({
      error: 'We could not send the verification email right now. Please try again later or contact the Dean.'
    });
  }

  return res.redirect(`/forgot-password/verify?email=${encodeURIComponent(email)}&sent=1`);
});

// GET /forgot-password/verify — code + new password form
router.get('/forgot-password/verify', (req, res) => {
  if (req.user) {
    return res.redirect('/');
  }
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) {
    return res.redirect('/forgot-password');
  }
  renderForgot(res, {
    step: 2,
    email,
    error: null,
    notice: null,
    sent: req.query.sent === '1'
  });
});

// POST /forgot-password/verify — check the code, set the new password
router.post('/forgot-password/verify', [
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('Enter the 6-digit code.').bail().isNumeric().withMessage('Enter the 6-digit code.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  body('confirm').custom((v, { req }) => v === req.body.password).withMessage('Passwords do not match.')
], async (req, res) => {
  if (req.user) {
    return res.redirect('/');
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const renderStep2 = (props) => renderForgot(res, {
    step: 2,
    email,
    error: null,
    notice: null,
    sent: true,
    ...props
  });

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return renderStep2({ error: errors.array()[0].msg });
  }

  const invalidCode = () => renderStep2({ error: 'Invalid or expired verification code. Request a new one.' });

  const reset = await db.prepare(`
    SELECT * FROM password_resets
    WHERE email = ? AND used_at IS NULL AND expires_at > datetime('now')
    ORDER BY id DESC
    LIMIT 1
  `).get(email);

  if (!reset) {
    return invalidCode();
  }

  if (reset.attempts >= RESET_MAX_ATTEMPTS) {
    await db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(reset.id);
    return renderStep2({ error: 'Too many wrong attempts. Please request a new code.' });
  }

  const matches = crypto.timingSafeEqual(
    Buffer.from(hashResetCode(req.body.code), 'hex'),
    Buffer.from(reset.code_hash, 'hex')
  );
  if (!matches) {
    await db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(reset.id);
    return invalidCode();
  }

  const passwordHash = await bcrypt.hash(req.body.password, 10);
  await db.prepare("UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(passwordHash, reset.user_id);
  await db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE email = ? AND used_at IS NULL").run(email);

  return res.redirect('/login?reset=1');
});

// GET /register
router.get('/register', (req, res) => {
  if (req.user) {
    return res.redirect('/');
  }
  const programs = registrationProgramOptions;
  res.render('auth/register', {
    layout: false,
    title: 'Register - PCC Student Portal',
    programs,
    error: null,
    form: null,
    user: null
  });
});

// POST /register
router.post('/register', (req, res, next) => {
  registerUpload.single('picture')(req, res, (err) => {
    if (!err) return next();
    const programs = registrationProgramOptions;
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That photo is too large. Please use an image under 5MB.'
      : 'That photo could not be used. Please choose a JPG, PNG, or WebP image.';
    return res.status(400).render('auth/register', {
      layout: false,
      title: 'Register - PCC Student Portal',
      programs,
      error: message,
      form: req.body && Object.keys(req.body).length ? req.body : null,
      user: null
    });
  });
}, [
  body('studentNo').notEmpty().withMessage('Student ID is required'),
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('programCode').notEmpty().withMessage('Program is required'),
  body('yearLevel').isInt({ min: 1, max: 4 }).withMessage('Invalid year level'),
  body('section').notEmpty().withMessage('Section is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], async (req, res) => {
  const programs = registrationProgramOptions;
  const renderError = (error) => res.render('auth/register', {
    layout: false,
    title: 'Register - PCC Student Portal',
    programs,
    error,
    form: req.body,
    user: null
  });

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return renderError(errors.array()[0].msg);
  }

  const { studentNo, firstName, lastName, programCode, yearLevel, section, password } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();

  try {
    // Check duplicates
    const emailExists = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (emailExists) {
      return renderError('An account with this email already exists.');
    }
    const noExists = await db.prepare('SELECT id FROM students WHERE student_no = ?').get(studentNo);
    if (noExists) {
      return renderError('This Student ID number is already registered.');
    }
    const program = registrationPrograms.find((candidate) => candidate.code === programCode);
    if (!program) {
      return renderError('Invalid program selected.');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const createUser = await db.transaction(async () => {
      await db.prepare('INSERT OR IGNORE INTO departments (code, name) VALUES (?, ?)')
        .run(program.departmentCode, program.departmentName);
      await db.prepare(`
        INSERT OR IGNORE INTO programs (code, name, department_id, total_units, total_years)
        VALUES (?, ?, (SELECT id FROM departments WHERE code = ?), ?, 4)
      `).run(program.code, program.name, program.departmentCode, program.totalUnits);

      // is_active = 0 until Dean approves
      const result = await db.prepare(`
        INSERT INTO users (email, password_hash, role, full_name, is_active)
        VALUES (?, ?, 'student', ?, 0)
      `).run(email, passwordHash, `${firstName} ${lastName}`);

      const studentResult = await db.prepare(`
        INSERT INTO students (user_id, student_no, first_name, last_name, program_code, year_level, section, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'inactive')
      `).run(result.lastInsertRowid, studentNo, firstName, lastName, programCode, yearLevel, section);

      // Notify the dean of a pending registration
      const deans = await db.prepare("SELECT id FROM users WHERE role IN ('dean', 'admin')").all();
      for (const d of deans) {
        await db.prepare(`INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'registration')`)
          .run(d.id, 'New Student Registration', `${firstName} ${lastName} (${studentNo}) registered and is awaiting your approval.`);
      }

      return studentResult.lastInsertRowid;
    });

    const studentId = await createUser();

    // Attach the optional registration photo (JPEG/PNG/WebP, <=5MB)
    if (req.file) {
      try {
        const photoUrl = saveProfileImage(req.file, 'student');
        await db.prepare("UPDATE students SET profile_picture = ?, picture_updated_at = datetime('now') WHERE id = ?")
          .run(photoUrl, studentId);
      } catch (photoErr) {
        console.error('Could not save registration photo:', photoErr.message);
      }
    }

    return res.redirect('/login?registered=1');
  } catch (err) {
    console.error('Registration error:', err);
    return renderError('An error occurred. Please try again.');
  }
});

// POST /login
router.post('/login', [
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  // Which front door was used? /login = students, /instructor = teachers, /dean = dean/admin, /staff = shared staff
  const portal = ['instructor', 'dean', 'staff'].includes(req.body.portal) ? req.body.portal : 'student';
  res.locals.portal = portal;
  if (!errors.isEmpty()) {
    return res.render('auth/login', {
      layout: false,
      title: 'Login - PCC Student Portal',
      error: 'Please provide valid email and password.',
      user: null
    });
  }

  const { email, password } = req.body;

  try {
    // Find user (any active flag so we can distinguish pending accounts)
    const user = await db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);

    if (!user) {
      return res.render('auth/login', {
        layout: false,
        title: 'Login - PCC Student Portal',
        error: 'Invalid email or password.',
        notice: null,
        user: null
      });
    }

    // Pending dean approval
    if (user.role === 'student' && !user.is_active) {
      return res.render('auth/login', {
        layout: false,
        title: 'Login - PCC Student Portal',
        error: null,
        notice: 'Your registration is still pending approval by the Dean.',
        user: null
      });
    }

    if (!user.is_active) {
      return res.render('auth/login', {
        layout: false,
        title: 'Login - PCC Student Portal',
        error: 'This account is deactivated. Please contact the Dean.',
        notice: null,
        user: null
      });
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.render('auth/login', {
        layout: false,
        title: 'Login - PCC Student Portal',
        error: 'Account is temporarily locked. Please try again later.',
        notice: null,
        user: null
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      // Increment failed attempts
      const attempts = user.failed_login_attempts + 1;
      if (attempts >= 5) {
        await db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = datetime("now", "+30 minutes") WHERE id = ?').run(user.id);
      } else {
        await db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(attempts, user.id);
      }

      return res.render('auth/login', {
        layout: false,
        title: 'Login - PCC Student Portal',
        error: 'Invalid email or password.',
        user: null
      });
    }

    // Reset failed attempts
    await db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = datetime('now') WHERE id = ?").run(user.id);

    // Front-door gating: each portal field only accepts its own roles
    if (!(doorRoles[portal] || []).includes(user.role)) {
      const where = {
        student: 'student portal (/login)',
        faculty: 'instructor portal (/instructor)',
        dean: 'dean portal (/dean)',
        admin: 'dean portal (/dean)',
        registrar: 'dean portal (/dean)'
      }[user.role] || 'main portal';
      return res.render('auth/login', {
        layout: false,
        title: 'Login - PCC Student Portal',
        error: `This account must sign in through the ${where}.`,
        notice: null,
        user: null
      });
    }

    // Check if 2FA is enabled
    if (user.totp_enabled) {
      // Create temporary token for 2FA verification
      const tempToken = jwt.sign(
        { id: user.id, step: '2fa' },
        ACCESS_SECRET,
        { expiresIn: '5m' }
      );

      res.cookie('tempToken', tempToken, {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: 'strict',
        maxAge: 5 * 60 * 1000
      });

      return res.redirect('/2fa/verify');
    }

    // Generate tokens and login (own jar — the other portals' sessions are untouched)
    const { accessToken, refreshToken } = generateTokens(user);
    const jar = portal === 'student' ? 'student' : portal === 'instructor' ? 'faculty' : 'staff';
    setTokenCookies(res, accessToken, refreshToken, jar);
    clearLegacyCookies(res);

    // Redirect based on role
    return res.redirect(homeByRole[user.role] || '/dean/dashboard');

  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', {
      layout: false,
      title: 'Login - PCC Student Portal',
      error: 'An error occurred. Please try again.',
      user: null
    });
  }
});

// GET /2fa/setup
router.get('/2fa/setup', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (user.totp_enabled) {
    return res.render('auth/2fa-setup', {
      layout: false,
      title: '2FA Setup - PCC Student Portal',
      qrCode: null,
      secret: null,
      message: '2FA is already enabled.',
      user: req.user
    });
  }

  // Generate new secret
  const secret = totp.generateSecret();
  const otpauth = totp.keyuri(user.email, 'PCC Student Portal', secret);

  // Store secret temporarily (not yet enabled)
  await db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.id);

  // Generate QR code (graceful fallback if QR rendering is unavailable)
  const qrDataUrl = await generateQRDataUrl(otpauth);

  res.render('auth/2fa-setup', {
    layout: false,
    title: '2FA Setup - PCC Student Portal',
    qrCode: qrDataUrl,
    secret: secret,
    message: null,
    user: req.user
  });
});

// POST /2fa/verify-setup
router.post('/2fa/verify-setup', requireAuth, [
  body('code').isLength({ min: 6, max: 6 })
], async (req, res) => {
  const { code } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  const isValid = await totp.verify({ token: code, secret: user.totp_secret });

  if (!isValid) {
    const qrDataUrl = await generateQRDataUrl(totp.keyuri(user.email, 'PCC Student Portal', user.totp_secret));
    return res.render('auth/2fa-setup', {
      layout: false,
      title: '2FA Setup - PCC Student Portal',
      qrCode: qrDataUrl,
      secret: user.totp_secret,
      message: 'Invalid code. Please try again.',
      user: req.user
    });
  }

  // Enable 2FA
  await db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);

  res.render('auth/2fa-setup', {
    layout: false,
    title: '2FA Setup - PCC Student Portal',
    qrCode: null,
    secret: null,
    message: '2FA has been enabled successfully!',
    user: req.user
  });
});

// GET /2fa/verify (during login)
router.get('/2fa/verify', (req, res) => {
  const tempToken = req.cookies?.tempToken;
  if (!tempToken) {
    return res.redirect('/login');
  }

  res.render('auth/2fa-verify', {
    layout: false,
    title: '2FA Verification - PCC Student Portal',
    error: null,
    user: null
  });
});

// POST /2fa/verify (during login)
router.post('/2fa/verify', [
  body('code').isLength({ min: 6, max: 6 })
], async (req, res) => {
  const tempToken = req.cookies?.tempToken;
  if (!tempToken) {
    return res.redirect('/login');
  }

  try {
    const payload = jwt.verify(tempToken, ACCESS_SECRET);
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND totp_enabled = 1').get(payload.id);

    if (!user) {
      return res.redirect('/login');
    }

    const isValid = await totp.verify({ token: req.body.code, secret: user.totp_secret });

    if (!isValid) {
      return res.render('auth/2fa-verify', {
        layout: false,
        title: '2FA Verification - PCC Student Portal',
        error: 'Invalid code. Please try again.',
        user: null
      });
    }

    // Clear temp token and generate full tokens
    res.clearCookie('tempToken');

    const { accessToken, refreshToken } = generateTokens(user);
    setTokenCookies(res, accessToken, refreshToken, jarForRole(user.role));

    // Update last login
    await db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    // Redirect based on role
    return res.redirect(homeByRole[user.role] || '/dean/dashboard');

  } catch (err) {
    console.error('2FA verify error:', err);
    return res.redirect('/login');
  }
});

// ---------------------------------------------------------------------------
// Silent session refresh
// ---------------------------------------------------------------------------
// Access tokens last 15 minutes. When one expires the browser still holds the
// 7-day refresh cookie, so pages redirect here instead of kicking the user out.
function safeNextPath(value) {
  const raw = String(value || '/').split('?')[0];
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  return raw;
}

function jarsForNext(next) {
  if (next.startsWith('/student')) return ['student'];
  if (next.startsWith('/faculty')) return ['faculty'];
  if (next.startsWith('/dean') || next.startsWith('/admin') || next.startsWith('/profile')) {
    return ['staff', 'faculty'];
  }
  return ['staff', 'faculty', 'student'];
}

function loginDoorForPath(next) {
  if (next.startsWith('/student')) return '/login';
  if (next.startsWith('/faculty')) return '/instructor';
  if (next.startsWith('/dean') || next.startsWith('/admin') || next.startsWith('/profile')) return '/dean';
  return '/login';
}

async function findRefreshSession(req, next) {
  for (const jar of jarsForNext(next)) {
    const token = req.cookies?.[JAR_COOKIES[jar].refresh];
    if (!token) continue;
    try {
      const payload = jwt.verify(token, REFRESH_SECRET);
      if (payload.type !== 'refresh' || payload.step) continue;
      const user = await db.prepare('SELECT id, email, role, full_name, is_active FROM users WHERE id = ?').get(payload.id);
      if (!user || !user.is_active) continue;
      return { jar, user };
    } catch (err) { /* expired/invalid → try the next jar */ }
  }
  return null;
}

function issueRefreshedCookies(res, session) {
  const { accessToken, refreshToken } = generateTokens(session.user);
  setTokenCookies(res, accessToken, refreshToken, session.jar);
}

// GET /auth/refresh?next=/student/dashboard — used when a page notices the
// access token is gone; refreshes, then sends the browser back.
router.get('/auth/refresh', async (req, res) => {
  const next = safeNextPath(req.query.next);
  const session = await findRefreshSession(req, next);
  if (!session) {
    return res.redirect(loginDoorForPath(next));
  }
  issueRefreshedCookies(res, session);
  return res.redirect(next);
});

// POST /auth/refresh — background keep-alive from the page.
router.post('/auth/refresh', async (req, res) => {
  const next = safeNextPath(req.body && req.body.next ? req.body.next : req.query.next);
  const session = await findRefreshSession(req, next);
  if (!session) {
    return res.status(401).json({ ok: false });
  }
  issueRefreshedCookies(res, session);
  return res.json({ ok: true });
});

// GET /auth/logout — clears only the session(s) this logout refers to, so the
// other portal can stay signed in.
router.get('/auth/logout', (req, res) => {
  const cookies = req.cookies || {};
  const decode = (name) => {
    try { return jwt.verify(cookies[name], ACCESS_SECRET); } catch (err) { return null; }
  };
  const staffUser = decode(JAR_COOKIES.staff.access);
  const facultyUser = decode(JAR_COOKIES.faculty.access);
  const studentUser = decode(JAR_COOKIES.student.access);
  const legacyUser = decode('accessToken');

  const next = String(req.query.next || '').split('?')[0];
  const doorJar = (door) => (door === '/login' ? 'student' : door === '/instructor' ? 'faculty' : 'staff');

  // Which jar(s) does this logout refer to?
  let jars;
  if (['/login', '/staff', '/dean', '/instructor'].includes(next)) {
    jars = [doorJar(next)];
  } else {
    let refPath = '';
    try { refPath = new URL(req.get('referer') || '', 'http://x').pathname; } catch (err) { refPath = ''; }
    if (refPath === '/login' || refPath.startsWith('/student')) jars = ['student'];
    else if (refPath === '/instructor' || refPath.startsWith('/faculty')) jars = ['faculty'];
    else if (refPath === '/staff' || refPath === '/dean' ||
             refPath.startsWith('/dean') || refPath.startsWith('/admin') ||
             refPath.startsWith('/profile')) jars = ['staff'];
    else {
      const live = ['staff', 'faculty', 'student'].filter((j) =>
        j === 'staff' ? staffUser : j === 'faculty' ? facultyUser : studentUser);
      jars = live.length > 0 ? live : ['staff', 'faculty', 'student'];
    }
  }

  // Where to land: explicit ?next= wins, else the cleared session's door,
  // else the legacy ?from=, else the student door.
  let target = '/login';
  if (['/login', '/staff', '/dean', '/instructor'].includes(next)) {
    target = next;
  } else {
    const u = (jars.includes('staff') && staffUser) ? staffUser
      : (jars.includes('faculty') && facultyUser) ? facultyUser
      : (jars.includes('student') && studentUser) ? studentUser
      : (staffUser || facultyUser || studentUser || legacyUser);
    if (u) {
      target = u.role === 'student' ? '/login'
        : u.role === 'faculty' ? '/instructor' : '/dean';
    } else {
      const from = String(req.query.from || '').toLowerCase();
      if (['dean', 'staff', 'admin'].includes(from)) target = '/dean';
      else if (['instructor', 'faculty'].includes(from)) target = '/instructor';
    }
  }

  clearLegacyCookies(res);
  res.clearCookie('tempToken');
  for (const j of jars) {
    res.clearCookie(JAR_COOKIES[j].access);
    res.clearCookie(JAR_COOKIES[j].refresh);
    res.clearCookie(JAR_COOKIES[j].refresh, { path: '/auth/refresh' });
  }
  res.redirect(target);
});

module.exports = router;
module.exports.generateTokens = generateTokens;
module.exports.setTokenCookies = setTokenCookies;
