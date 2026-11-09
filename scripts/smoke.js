#!/usr/bin/env node
// Post-deploy smoke test for the PCC Student Portal.
//
//   npm run smoke
//
// Unauthenticated checks always run. Role checks run only when the matching
// credentials are present in the environment (so no passwords live in the repo):
//
//   SMOKE_STUDENT_EMAIL / SMOKE_STUDENT_PASSWORD
//   SMOKE_DEAN_EMAIL    / SMOKE_DEAN_PASSWORD
//   SMOKE_STAFF_EMAIL   / SMOKE_STAFF_PASSWORD     (faculty / instructor)
//   SMOKE_ADMIN_EMAIL   / SMOKE_ADMIN_PASSWORD
//
// Optional:
//   SMOKE_BASE_URL   default http://localhost:3005
//   SMOKE_PUBLIC=1   skip every authenticated check
//
// Exit code 0 = all checks passed, 1 = at least one failure.

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:3005').replace(/\/$/, '');
const PUBLIC_ONLY = process.env.SMOKE_PUBLIC === '1';
const TIMEOUT_MS = 10000;

let passed = 0;
let failed = 0;
let skipped = 0;

function log(ok, name, detail) {
  if (ok === 'skip') {
    skipped++;
    console.log(`  SKIP  ${name}${detail ? ` (${detail})` : ''}`);
    return;
  }
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function createJar() {
  return new Map();
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function storeCookies(jar, response) {
  let headers = [];
  if (typeof response.headers.getSetCookie === 'function') {
    headers = response.headers.getSetCookie();
  } else {
    const raw = response.headers.get('set-cookie');
    if (raw) headers = [raw];
  }

  for (const header of headers) {
    const [pair] = header.split(';');
    const equals = pair.indexOf('=');
    if (equals < 0) continue;

    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    const expired = /max-age=0/i.test(header) || /expires=thu, 01 jan 1970/i.test(header);

    if (expired || value === '') jar.delete(name);
    else jar.set(name, value);
  }
}

async function request(jar, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const cookies = cookieHeader(jar);
  if (cookies) headers.Cookie = cookies;

  const response = await fetch(BASE + path, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  storeCookies(jar, response);
  const text = await response.text();
  return { status: response.status, location: response.headers.get('location'), headers: response.headers, text };
}

async function login(jar, email, password, portal) {
  const body = new URLSearchParams({ email, password, portal }).toString();
  return request(jar, '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
}

function credentials(prefix) {
  const email = process.env[`SMOKE_${prefix}_EMAIL`];
  const password = process.env[`SMOKE_${prefix}_PASSWORD`];
  return email && password ? { email, password } : null;
}

async function check(name, fn) {
  try {
    const result = await fn();
    log(result === true ? true : false, name, result === true ? '' : String(result));
  } catch (err) {
    log(false, name, err.message);
  }
}

function expectStatus(response, wanted, label) {
  const expected = Array.isArray(wanted) ? wanted : [wanted];
  if (!expected.includes(response.status)) {
    return `${label || 'status'} ${response.status} (wanted ${expected.join('/')})`;
  }
  return true;
}

async function main() {
  console.log(`\nPCC Student Portal smoke test -> ${BASE}\n`);

  const anon = createJar();

  await check('health check returns ok', async () => {
    const res = await request(anon, '/healthz');
    const status = expectStatus(res, 200, 'health');
    if (status !== true) return status;
    const json = JSON.parse(res.text);
    return json.status === 'ok' && json.db === 'ok' ? true : `unexpected body ${res.text}`;
  });

  await check('login page renders with local assets', async () => {
    const res = await request(anon, '/login');
    const status = expectStatus(res, 200, 'login');
    if (status !== true) return status;
    if (!res.text.includes('/js/tailwind.js')) return 'login page does not load /js/tailwind.js';
    if (!res.text.includes('/css/fonts.css')) return 'login page does not load /css/fonts.css';
    if (res.text.includes('cdn.tailwindcss.com')) return 'login page still references the Tailwind CDN';
    if (res.text.includes('fonts.googleapis.com')) return 'login page still references Google Fonts';
    return true;
  });

  await check('vendored CSS/JS/font assets are served', async () => {
    for (const path of ['/js/tailwind.js', '/css/fonts.css', '/js/motion-lite.js']) {
      const res = await request(anon, path);
      if (res.status !== 200) return `${path} -> ${res.status}`;
    }
    return true;
  });

  await check('CSP no longer allows CDN origins', async () => {
    const res = await request(anon, '/login');
    const csp = res.headers.get('content-security-policy') || '';
    if (csp.includes('cdn.tailwindcss.com') || csp.includes('fonts.googleapis.com')) {
      return 'CSP still lists a CDN origin';
    }
    return true;
  });

  await check('anonymous uploads are blocked', async () => {
    const res = await request(anon, '/uploads/profiles/smoke-anon-probe.jpg');
    return expectStatus(res, 403, 'uploads');
  });

  await check('anonymous refresh is rejected', async () => {
    const res = await request(anon, '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    return expectStatus(res, 401, 'refresh');
  });

  await check('password reset never exposes a code', async () => {
    const res = await request(anon, '/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'smoke-test@pcc.edu.ph' }).toString()
    });
    if (res.text.includes('devCode')) return 'response still contains devCode';
    return true;
  });

  if (PUBLIC_ONLY) {
    log('skip', 'authenticated role checks', 'SMOKE_PUBLIC=1');
  } else {
    const student = credentials('STUDENT');
    const dean = credentials('DEAN');
    const staff = credentials('STAFF');
    const admin = credentials('ADMIN');

    if (!student) {
      log('skip', 'student checks', 'set SMOKE_STUDENT_EMAIL/PASSWORD');
    } else {
      const jar = createJar();
      const res = await login(jar, student.email, student.password, 'student');
      if (res.status !== 302) {
        log(false, 'student login', `status ${res.status}`);
      } else {
        log(true, 'student login');
        for (const path of ['/student/dashboard', '/student/grades', '/student/prospectus', '/student/profile']) {
          await check(`student ${path}`, async () => expectStatus(await request(jar, path), 200));
        }
        await check('student cannot open the dean door', async () => {
          const page = await request(jar, '/dean/dashboard');
          return [302, 403].includes(page.status) ? true : `status ${page.status}`;
        });
        await check('signed-in student can reach private uploads', async () => {
          const page = await request(jar, '/uploads/profiles/smoke-probe.jpg');
          return page.status !== 403 ? true : 'uploads still returned 403';
        });
      }
    }

    if (!dean) {
      log('skip', 'dean checks', 'set SMOKE_DEAN_EMAIL/PASSWORD');
    } else {
      const jar = createJar();
      const res = await login(jar, dean.email, dean.password, 'dean');
      if (res.status !== 302) {
        log(false, 'dean login', `status ${res.status}`);
      } else {
        log(true, 'dean login');
        for (const path of ['/dean/dashboard', '/dean/year-levels', '/dean/assignments']) {
          await check(`dean ${path}`, async () => expectStatus(await request(jar, path), 200));
        }
        await check('dean cannot release grades', async () => {
          const page = await request(jar, '/dean/grades/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ semesterId: 1, releaseType: 'manual' })
          });
          return expectStatus(page, 403, 'release');
        });
        await check('malformed JSON is rejected', async () => {
          const page = await request(jar, '/dean/grades/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{bad json'
          });
          return expectStatus(page, 400, 'malformed json');
        });
      }
    }

    if (!staff) {
      log('skip', 'faculty checks', 'set SMOKE_STAFF_EMAIL/PASSWORD');
    } else {
      const jar = createJar();
      const res = await login(jar, staff.email, staff.password, 'instructor');
      if (res.status !== 302) {
        log(false, 'faculty login', `status ${res.status}`);
      } else {
        log(true, 'faculty login');
        await check('faculty /faculty/dashboard', async () => expectStatus(await request(jar, '/faculty/dashboard'), 200));
        await check('faculty grade-entry page renders', async () => expectStatus(await request(jar, '/faculty/grade-entry'), 200));
        await check('faculty CSV template downloads', async () => {
          const page = await request(jar, '/faculty/grade-entry');
          const formLink = page.text.match(/href="\/faculty\/grade-entry\/(\d+)"/);
          if (!formLink) return 'no grade-entry section link on the grade-entry page';
          const form = await request(jar, `/faculty/grade-entry/${formLink[1]}`);
          const status = expectStatus(form, 200, 'grade-entry form');
          if (status !== true) return status;
          const match = form.text.match(/\/faculty\/grade-entry\/(\d+)\/template/);
          if (!match) return 'no template link on the grade-entry form';
          const template = await request(jar, match[0]);
          const templateStatus = expectStatus(template, 200, 'template');
          if (templateStatus !== true) return templateStatus;
          const type = template.headers.get('content-type') || '';
          if (!type.includes('text/csv')) return `content-type ${type}`;
          if (!template.text.includes('Student No.')) return 'template has no Student No. header';
          return true;
        });
        await check('faculty upload rejects non-CSV files', async () => {
          const form = new FormData();
          form.append('offeringId', '1');
          form.append('file', new Blob(['not a csv'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'grades.xlsx');
          const response = await request(jar, '/faculty/grades/import', { method: 'POST', body: form });
          return expectStatus(response, 400, 'xlsx upload');
        });
      }
    }

    if (!admin) {
      log('skip', 'admin checks', 'set SMOKE_ADMIN_EMAIL/PASSWORD');
    } else {
      const jar = createJar();
      const res = await login(jar, admin.email, admin.password, 'dean');
      if (res.status !== 302) {
        log(false, 'admin login', `status ${res.status}`);
      } else {
        log(true, 'admin login');
        await check('admin /admin/dashboard', async () => expectStatus(await request(jar, '/admin/dashboard'), 200));
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err.message);
  process.exit(1);
});
