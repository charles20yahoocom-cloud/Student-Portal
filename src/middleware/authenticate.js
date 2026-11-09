const jwt = require('jsonwebtoken');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
if (!ACCESS_SECRET) {
  throw new Error('JWT_ACCESS_SECRET is required. Refusing to start with a predictable fallback secret.');
}

// Triple cookie jars so the student portal, the instructor portal and the
// dean/admin portal keep independent sessions side-by-side in one browser.
// A login on one door never signs out the other two.
const JAR_COOKIES = {
  student: { access: 'student_accessToken', refresh: 'student_refreshToken' },
  faculty: { access: 'faculty_accessToken', refresh: 'faculty_refreshToken' },
  staff: { access: 'staff_accessToken', refresh: 'staff_refreshToken' }
};

// Ordered jar lookup per request path. Neutral paths (/, /2fa/*, /auth/*,
// /register, …) fall back to staff-then-faculty-then-student order.
function jarsForRequest(req) {
  const url = String(req.originalUrl || req.path || '').split('?')[0];
  if (url === '/login' || url.startsWith('/student')) return ['student'];
  if (url === '/instructor' || url.startsWith('/faculty')) return ['faculty'];
  if (url === '/staff' || url === '/dean' ||
      url.startsWith('/dean') || url.startsWith('/admin') ||
      url.startsWith('/profile')) return ['staff', 'faculty'];
  return ['staff', 'faculty', 'student'];
}

function jarForRole(role) {
  return role === 'student' ? 'student' : role === 'faculty' ? 'faculty' : 'staff';
}

function readSession(req) {
  const order = jarsForRequest(req);
  for (const j of order) {
    const token = req.cookies?.[JAR_COOKIES[j].access];
    if (!token) continue;
    try {
      const payload = jwt.verify(token, ACCESS_SECRET);
      // Refresh tokens and half-finished 2FA tokens must never act as access tokens.
      if (payload.type === 'refresh' || payload.step === '2fa') continue;
      return { user: payload, jar: j };
    } catch (err) { /* expired/invalid → try the next jar */ }
  }
  return { user: null, jar: order[0] || null };
}

// Is there a refresh cookie for a jar that matches this request path?
function hasRefreshToken(req) {
  return jarsForRequest(req).some((j) => Boolean(req.cookies?.[JAR_COOKIES[j].refresh]));
}

// Send an unauthenticated visitor to the refresh endpoint when we still hold a
// usable refresh cookie; otherwise to the correct login door.
function unauthResponse(req, res) {
  if (req.method === 'GET' && hasRefreshToken(req)) {
    const next = encodeURIComponent(req.originalUrl || req.path || '/');
    return res.redirect(`/auth/refresh?next=${next}`);
  }
  return res.redirect(loginPathFor(req));
}

// Middleware to authenticate JWT token (optional - attaches user if token exists)
function authenticateToken(req, res, next) {
  const { user, jar } = readSession(req);
  req.user = user;
  req.sessionJar = jar;

  next();
}

// Pick the correct login door for a request so staff never land on the student portal
function loginPathFor(req) {
  const url = String(req.originalUrl || req.path || '').split('?')[0];
  if (url.startsWith('/dean')) return '/dean';
  if (url.startsWith('/admin')) return '/dean';
  if (url.startsWith('/faculty')) return '/instructor';
  if (url.startsWith('/student')) return '/login';
  const ref = String(req.get('referer') || '');
  if (ref.includes('/faculty')) return '/instructor';
  if (ref.includes('/dean') || ref.includes('/admin')) return '/dean';
  return '/login';
}

// Middleware that requires authentication
function requireAuth(req, res, next) {
  if (!req.user) {
    return unauthResponse(req, res);
  }
  next();
}

// Middleware for role-based access
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return unauthResponse(req, res);
    }
    if (!roles.includes(req.user.role)) {
      // Friendly switch-account screen (still a 403) instead of a bare error
      // page — e.g. a stale tab after signing in under another account.
      const door = roles.includes('student')
        ? { name: 'Student', path: '/login', home: '/student/dashboard' }
        : roles.includes('faculty')
          ? { name: 'Instructor', path: '/instructor', home: '/faculty/dashboard' }
          : { name: 'Dean / Admin', path: '/dean', home: '/dean/dashboard' };
      const ownHome = {
        student: '/student/dashboard',
        faculty: '/faculty/dashboard',
        dean: '/dean/dashboard',
        admin: '/admin/dashboard',
        registrar: '/dean/dashboard'
      }[req.user.role] || '/';
      return res.status(403).render('auth/switch-account', {
        layout: false,
        title: 'Switch account - PCC',
        name: req.user.fullName || req.user.email,
        role: req.user.role,
        door: door.name,
        doorPath: door.path,
        home: ownHome,
        note: 'The page you tried to open needs a ' + door.name + ' account.'
      });
    }
    next();
  };
}

module.exports = { authenticateToken, requireAuth, requireRole, JAR_COOKIES, jarsForRequest, jarForRole };
