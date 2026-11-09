# PCC Student Portal

A capstone web portal for **Passi City College** that lets students view their
grades and official prospectus, deans encode prospectuses and manage sections,
faculty submit grades, and administrators release grades and manage accounts.

Built with Node.js, Express, EJS, Tailwind CSS and SQLite. The front end is
fully self-hosted, so the portal works on a school LAN **with no internet**.

---

## Features

| Role | What they can do |
|------|------------------|
| **Student** | Sign in with password + 2FA, view grades and GPA, view/download/print the one-page official prospectus, manage profile photo |
| **Faculty** | View assigned subjects, enter grades per section, download/upload grade templates |
| **Dean** | Department-scoped dashboard, encode prospectuses, create/delete sections, assign instructors, review grades, view year-level rosters and prospectuses |
| **Administrator** | Everything a dean can do, across all departments, plus release grades and manage staff accounts |

Sessions are independent per role: a student, a faculty member and a dean can be
signed in side by side in the same browser without incognito windows.

---

## Quick start

**Requirements:** Node.js 20+ and npm.

```powershell
cd pcc-student-portal
npm install
Copy-Item .env.example .env
```

Edit `.env` and generate three different secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `SESSION_SECRET` to three
different values. The server refuses to start without `JWT_ACCESS_SECRET`.

Create the database and demo data (development only):

```powershell
npm run seed
npm run demo-data     # optional: 20 extra students + 3 semesters of grades
npm run rotate-demo   # prints new demo passwords once
```

Start the server:

```powershell
npm start
```

Open <http://localhost:3005>. Health check: <http://localhost:3005/healthz>.

> The seed refuses to run when `NODE_ENV=production` unless `FORCE_SEED=1`.
> Never run it against real data.

---

## Portals (separate sessions)

| Door | URL | For |
|------|-----|-----|
| Student | `/login` | Students |
| Instructor | `/instructor` | Faculty |
| Dean / Admin | `/dean` | Deans, registrars, administrators |
| Shared staff | `/staff` | Any staff role |

The three portals use separate cookies (`student_*`, `faculty_*`, `staff_*`), so
logging in on one door never signs out the others.

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run the server |
| `npm run dev` | Run with Node's watch mode |
| `npm run seed` | Create/migrate the dev database and demo accounts |
| `npm run demo-data` | Add 20 BSIT students, six sections per term, three semesters of grades |
| `npm run rotate-demo` | Rotate the well-known demo passwords |
| `npm run backup [folder]` | Consistent SQLite copy + uploads (default `backups/`) |
| `npm run setup-data [-- --migrate]` | Create the persistent ProgramData folder and print the `.env` lines |
| `npm run smoke` | Live smoke test (see below) |
| `npm run vendor-assets` | Re-download Tailwind/fonts (needs internet; only when bumping versions) |

---

## Demo data

`npm run demo-data` adds a defense-ready dataset on top of `npm run seed`:

- 20 BSIT students in sections **A** and **B**, plus the original demo student.
- Six sections in each of three semesters (2024-2025 1st/2nd and the active term).
- Grades for every student across the two completed semesters; the active term is
  partly graded so the faculty grade-entry screen has real work to demo.
- Three students deliberately below the 2.0 GPA threshold, so the dean dashboard
  shows the **Students at Risk** panel.
- One grade release per term, so students can see their transcript.

All 20 demo students share `DEMO_STUDENT_PASSWORD`
(default `PccStudent#2026`). The script is safe to re-run: existing grades are
never overwritten, and it refuses to run when `NODE_ENV=production` unless
`FORCE_DEMO=1`.

---

## Smoke test

`npm run smoke` checks the running server end to end. Unauthenticated checks
always run; role checks run when credentials are supplied through environment
variables (no passwords are stored in the repo).

```powershell
$env:SMOKE_STUDENT_EMAIL='student@example.edu.ph'
$env:SMOKE_STUDENT_PASSWORD='...'
$env:SMOKE_DEAN_EMAIL='dean@example.edu.ph'
$env:SMOKE_DEAN_PASSWORD='...'
$env:SMOKE_STAFF_EMAIL='faculty@example.edu.ph'
$env:SMOKE_STAFF_PASSWORD='...'
$env:SMOKE_ADMIN_EMAIL='admin@example.edu.ph'
$env:SMOKE_ADMIN_PASSWORD='...'
npm run smoke
```

Optional variables:

- `SMOKE_BASE_URL` — default `http://localhost:3005`
- `SMOKE_PUBLIC=1` — run only the unauthenticated checks

It verifies the health check, self-hosted assets, CSP, private uploads, refresh
rejection, role logins, department/role access, the admin-only grade release,
CSV template download/upload handling, and malformed-JSON handling. Exit code
`1` means something regressed.

---

## Offline / LAN deployment

All CSS, fonts and JavaScript are served from `src/public`:

- `js/tailwind.js` — Tailwind Play CDN 3.4.17 (downloaded, served locally)
- `js/motion-lite.js` — small Web Animations helper for the login animation
- `css/fonts.css` + `fonts/*.woff2` — Inter and Playfair Display

No page makes an external request, so the portal renders correctly without
internet. To run it on the LAN:

1. Set `HOST=0.0.0.0` in `.env`.
2. On plain HTTP, set `COOKIE_SECURE=false` **or** keep `NODE_ENV=development`.
   Cookies are `Secure` automatically in production, and a browser will silently
   drop them over plain HTTP.
3. Allow inbound TCP 3005 on the Private network profile.
4. Open `http://<LAN-IP>:3005` from another device.

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for firewall rules, PM2/NSSM, scheduled
backups, restore steps and troubleshooting.

---

## Project structure

```text
src/
  app.js                 Express app, security headers, startup/shutdown
  config/database.js     SQLite connection + automatic migrations
  middleware/            Authentication, role checks, cookie jars
  routes/                auth, student, faculty, dean, admin, staff profile
  utils/                 image upload, mailer
  views/                 EJS templates (layouts, auth, student, dean, faculty, admin)
  public/                Self-hosted CSS, JS, fonts, images
  database/pcc.db        SQLite database (created on first run)
migrations/              Numbered SQL migrations (run on boot)
seeds/                   Seed, rich demo data, password rotation
scripts/                 backup, smoke test, asset vendoring
uploads/                 Private profile photos (auth required)
```

---

## Security notes

- Profile photos are validated by magic bytes (JPEG/PNG/WebP), stored under
  random names, and served only to signed-in users.
- Password reset is disabled with a "contact the Dean" message until SMTP is
  configured; reset codes are never placed in a URL.
- Access tokens last 15 minutes and refresh silently using an httpOnly refresh
  cookie; refresh re-checks that the account is still active.
- Grade release is administrator-only. Deans can encode grades but cannot
  publish them.
- Department scoping is fail-closed: a dean who heads no department sees nothing.
- Authenticated pages send `Cache-Control: no-store`.
- Login, forgot-password and registration are rate-limited.

A full pre-deployment review lives in
[`../PCC_PORTAL_AUDIT.md`](../PCC_PORTAL_AUDIT.md).

---

## Documentation

| Document | Contents |
|----------|----------|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | LAN setup, firewall, process manager, backups, restore |
| [`../STUDENT_PORTAL_PLAN.md`](../STUDENT_PORTAL_PLAN.md) | Agile delivery plan, sprint increments, feature plan |
| [`../STUDENT_PORTAL_ANALYSIS.md`](../STUDENT_PORTAL_ANALYSIS.md) | Requirements, schema, rules, Agile delivery approach |
| [`../PCC_PORTAL_AUDIT.md`](../PCC_PORTAL_AUDIT.md) | Security findings, P0 fixes, remaining risks |
| [`PROGRESS.md`](PROGRESS.md) | Development log |

---

## Known limitations / next steps

- No CSRF tokens yet — state-changing forms rely on `SameSite=Strict` cookies.
- No automated unit/integration suite yet; `npm run smoke` covers live routes.
- Plain HTTP on the LAN. Public hosting needs HTTPS, `COOKIE_SECURE=true`, and a
  correct `TRUST_PROXY` setting.
- No process manager by default; use PM2 or NSSM for an unattended demo.

---

## License

Academic capstone project — Passi City College. Not for commercial redistribution.
