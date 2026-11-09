# PCC Student Portal — Progress Notes
Folder: `C:\Users\charl\OneDrive\Tài liệu\Default Project\pcc-student-portal`

## Run the system (PowerShell)
```powershell
Set-Location "C:\Users\charl\OneDrive\Tài liệu\Default Project\pcc-student-portal"
npm start
```
Open: http://localhost:3005  (PORT is set in `.env` = **3005**; 3000 & 3001 are reserved for other apps)
Stop: `taskkill /F /IM node.exe`

First time / after schema changes: `npm run seed` (re-seeds demo data, applies migrations).

## Demo accounts (password cost 10, verified)
| Role | Email | Password |
|---|---|---|
| Student | juan.delacruz@pcc.edu.ph | student123 |
| Dean (also the admin) | dean.it@pcc.edu.ph | dean123 |
| Teacher | teacher.john@pcc.edu.ph | teacher123 |
| Admin | admin@pcc.edu.ph | admin123 |

## What's built & verified working (before laptop restart)
- Express 5 + better-sqlite3 + EJS + JWT + Helmet + rate-limit + `express-ejs-layouts`. bcrypt cost 10 (cost 12 hangs this machine).
- Auth: login, 2FA (TOTP/QR with manual-secret fallback), logout, role-based redirects (student → /student/dashboard, teacher → /faculty/dashboard, dean/admin → /dean/dashboard, registrar → dean).
- Login page: **role-tab UI** (Students | Teachers | Dean/Admin) instead of quick-login buttons. Tabs switch portal title, email label/placeholder and submit label ("Sign In as X"); only the Student tab shows the "Register as a New Student" card. No demo credentials are hardcoded on the page (accounts still work if typed).
- Student portal: dashboard, grades (released-only), prospectus, notifications, profile (picture upload, 2FA enable).
- Dean portal: dashboard, students, grade entry (class-based batch save + audit log + CSV import + release), reports, **Manage Accounts** using `<span>` style sidebars.
- Faculty/Teacher portal: dashboard showing assigned classes (teacher assigned as instructor on the 3 seeded offerings).

## NEW features just added (code complete, server had NOT been restarted/verified yet when the laptop shut down — run `npm start` to test)
1. **Student self-registration** (`/register`, link on login page):
   - Fields: Student ID no., first/last name, program, year level, section, email, password.
   - New student is created `users.is_active = 0` + `students.status = 'inactive'` → cannot log in until the Dean approves.
   - Dean gets a notification `'New Student Registration'`.
   - Login for a pending student shows: *"Your registration is still pending approval by the Dean."*
   - Success redirect: `/login?registered=1` → shows a blue notice.
2. **Dean = the admin. Dean creates/manages teacher accounts** at `/dean/accounts`:
   - Pending student approvals table with Approve button (activates user + student, sends notification).
   - Create Teacher Account form (name/email/password → role faculty, immediately active).
   - Staff Accounts list (dean/admin/faculty) with Activate/Deactivate toggles (can't deactivate yourself).
   - "Accounts" nav added to all dean sidebars.
3. Migration tracked in DB: `migrations/002_students_section.sql` adds `section` column to `students` (auto-applied on next boot; `001_initial.sql` already includes it for fresh installs).

## Flaky environment notes
- PowerShell tool here intermittently fails with `ChildProcess.kill` / `spawn EPERM` / timeouts. Long-running background servers are unreliable from the tool; **WMI spawn (`Invoke-CimMethod ... Win32_Process.Create`) is the reliable way**, and it survives session/tool restarts.
- `require('qrcode')` crashes node on this machine → loaded lazily in try/catch.
- `datetime("now")` breaks SQLite (double quotes = column ref) → always use `datetime('now')`.
- bcrypt cost above 10 hangs → keep 10.
- **JS route changes require a server restart** (Node caches required modules); EJS template edits are picked up live on next request.

## Login UI redesign + Motion (latest session work — live & verified)
- Look: **"college × tech"** — dark `#070B17` bg with animated circuit grid + drifting blue/gold orbs; glass card with gold-ringed PCC seal (pulsing glow), "Passi City College" subtitle, gradient sign-in button (gold on hover), mono status footer with **live clock** (`● Secure · 2FA | 14:32:05`).
- Motion.dev (JS lib) added via CDN — `import { animate } from "https://cdn.jsdelivr.net/npm/motion@12.23.7/+esm"` in a `type="module"` script inside `login.ejs`. Entrance animation (card fades/rises, tabs stagger) + tab-switch micro-pulse. NO npm install needed.
- Sizing/scroll: card is `max-w-sm`, compact paddings, **seal + title on one row**; body is `overflow-y-auto` with a `m-auto` flex child so it centers when short and scrolls when tall (earlier `overflow-hidden` + flex-centering was clipping top/bottom).
- CSP now: `scriptSrc` allows `cdn.tailwindcss.com` + `cdn.jsdelivr.net`; **`scriptSrcAttr: ["'unsafe-inline'"]`** (helmet's default `script-src-attr 'none'` was blocking every `onclick=` in the app — tabs/buttons were dead until this was overridden).

## Animated program-banner gallery (latest session work — live & verified)
- 5 circular "program discs" (BSIT, **BSCRIM** (renamed from BSCS), BSBA, BSED, BSHM) with gradient fills, emoji icons + names; entrance via Motion one-shot from bottom-left, then they just hover (NO per-frame rAF loop / parallax / idle-bob — that loop was causing lag, so removed for smoothness + battery).
- **Disc sizing fix (was "long ovals / glitching on top")**: `.banner-card` divs were given no explicit width/height and weren't `position:absolute` → they stretched to full container width in normal flow (ovals) and stacked/overlapped. Now each card is `position:absolute` with `width/height = geo.D`; `recomputeGeo()` runs BEFORE the cards are built, and the resize handler re-applies sizes to the cards too.
- **Desktop layout (final)**: 3 banners on the LEFT of the login box, 2 on the RIGHT. Positions are computed from the **actual measured card width** (`loginCard.offsetWidth`) + a clearance arm (`boxHalf + D*0.55 + 18`), so discs never sit hidden behind the glass card. Banner widths clamped with slight edge bleed; sizes/rot/z vary per disc.
- **Mobile layout**: on phones the card is near-full-width, so banners instead sit **3 across the top / 2 at the bottom** of the stage (still clearly visible). Mobile opacity raised to 0.95 (was 0.4 → they were invisible).
- Login card compacted for a pleasing size on both desktop & mobile: `max-w-[352px]`, `p-5`, smaller seal row, slimmer tabs/inputs/button/footer.

## Philippine numeric grading (latest session work — live & verified)
- Grade encoding switched from letter grades (A/B+/F...) to the **Philippine college scale**: `1.00` (≈100, highest) → `3.00` (=75, passing) → `5.00` (failure); **quarter steps only** (1.00, 1.25, 1.50, ... 4.50, 5.00).
- `src/routes/dean.routes.js` POST `/dean/grades/batch`: replaced the letter→points map with `parsePhGrade()` — validates 1.00–5.00 in quarter steps, stores `grade_value` as `"1.25"` etc., and stores `grade_points = 5 - gradeValue` (4.0-scale equivalent) so **existing GPA / at-risk reports keep working unchanged** (`AVG(grade_points) < 2.0` still means raw grade worse than ~3.00). Invalid values are skipped.
- `src/views/dean/grade-entry-form.ejs`: letter `<select>` → numeric `<input type="number" min=1 max=5 step=0.25>` per student; "Set all to" drop-down now lists PH quarter grades; added a legend line (1.00=100 · 3.00=75 passing · 5.00=fail); client-side validation before save; **legacy letter grades are auto-converted for display** via a `LEGACY` map.
- `seeds/seed.js`: sample grades now `1.00` / `1.50`.
- One-time data migration applied to `src/database/pcc.db`: converted the 2 existing letter grades to numeric + recomputed `grade_points` (remaining letter rows = 0). Migration script was temporary and has been deleted.
- Marks like `INC` / `DRP` are no longer grade options — use the remarks field (or extend later with a status column).

## Server entry point gotcha (IMPORTANT)
- `npm start` runs **`node src/app.js`** — there is **no `src/server.js`** in the repo. Earlier accidental spawns of `src/server.js` produced "cannot find path" / wrong-port banners (once printed port 3999). Always start the real entry from the project dir so `.env` (PORT=3005) loads via `require('dotenv').config()` in `src/app.js`.

## Database path gotcha (IMPORTANT)
- The real DB file is **`src/database/pcc.db`**, NOT the root `database/` folder. `database.js` does `path.join(srcDir, DB_PATH)` → `.env`'s `DB_PATH=./database/pcc.db` lands in `src/database/`. Don't delete/clean the wrong folder — the root `database/` folder is unused.
- DB is in WAL mode → `pcc.db` + `pcc.db-wal` + `pcc.db-shm` live together.

## Incident log (this session)
- **Duplicate register code**: a previous session had left old GET/POST `/register` handlers (different field names: `student_no`, `confirm_password`, etc.) in `auth.routes.js`. My new handlers duplicated them → stray `});` → `SyntaxError: Unexpected token '}'` at startup. Fixed by deleting the stale block.
- **Duplicate migration `002_add_section.sql`** (old, already applied Sep 11) + my new `002_students_section.sql` → boot crash `duplicate column name: section`. Deleted the old file; marked `002_students_section.sql` as applied on the existing DB via `INSERT INTO schema_migrations`.
- **Wiped-looking DB**: after laptop restart the root `database/pcc.db` was 0 bytes — it was a red herring (unused path). Real data (admin/dean/student/teacher + grades) was safe in `src/database/pcc.db`.
- **Fixable bugs found via bad-practice generic error boxes**:
  - `register` notifications insert passed 4 values for 3 `?` placeholders → `RangeError: Too many parameter values were provided`. Removed the extra arg.
  - Dean `create teacher` route used `bcrypt` **without importing it** → `ReferenceError: bcrypt is not defined`. Added `const bcrypt = require('bcrypt')` to `dean.routes.js`.
  - `login.ejs` flashed `success`/`notice`/`error` but some renders didn't pass them → `ReferenceError` → 500. Now guarded with `typeof x !== 'undefined' && x`.

- **Login UI fixes (this latest session)**:
  - **Student login "Invalid email or password" for Gmail addresses with dots** → login used `body('email').normalizeEmail()` which (by default) **strips dots from Gmail local-parts**, so `charles20yahoo.com@gmail.com` was looked up as `charles20yahoocom@gmail.com` → user not found. Removed `normalizeEmail()`, switched the lookup to `WHERE lower(email) = lower(?)`, and normalized register/admin/dean-create to store `trim().toLowerCase()`. (Demo `juan.delacruz@pcc.edu.ph` worked only because it isn't a Gmail address.) Also reset the forgotten password for `charles20yahoo.com@gmail.com` → `student123`.
  - Buttons/tabs dead app-wide → helmet default `script-src-attr 'none'` blocked inline `onclick` handlers. Fixed in `src/app.js` by adding `scriptSrcAttr: ["'unsafe-inline'"]`.
  - Card clipped top/bottom + no scroll → was `overflow-hidden` + flex-centering; fixed with `overflow-y-auto` + `m-auto` child.
  - MacOS-style inline `node -e` one-liners break in this Windows PowerShell (quote/`&` mangling) → write small `.js` check files in `C:\Users\charl\AppData\Local\Temp\opencode\` instead (or redirect output to a `.log` and `Read` it).
  - **Banners rendered as long ovals + glitching at top** → discs had no explicit `width/height` and weren't absolute. Fixed in `login.ejs` `buildCard` (absolute + `geo.D` size) and `recomputeGeo()` moved before card build.
  - **Banners lagging** → old code ran a `requestAnimationFrame` loop every frame incl. idle bob + mouse parallax; replaced with one one-shot Motion entrance (banners then hover statically).
  - **Banners half-hidden behind the login box** → positions were based on an *estimated* card half-width; now measured from `loginCard.offsetWidth` with clearance so all 5 are fully outside the card.
  - **Banners invisible on mobile** → with the card ~full-width, side discs were clamped to x=-16 / off-screen; mobile now uses a 3-top / 2-bottom layout (and mobile opacity 0.4 → 0.95).
  - **Server start quirks**: `node src/server.js` fails (no such file — real entry is `src/app.js` via `npm start`). WMI `cmd /c "cd /d <project> && node src/app.js"` fails on the Vietnamese chars in the path ("filename, directory name, or volume label syntax is incorrect") — use `Start-Process -FilePath node -ArgumentList "src\app.js" -WorkingDirectory "<project>" -WindowStyle Hidden -RedirectStandardOutput boot.log -RedirectStandardError boot.err` (works; hangs the tool wrapper sometimes → poll logs in separate commands).

## Verification checklist for next boot
- [x] `npm start` → GET /login = 200 on http://localhost:3005
- [x] GET /register = 200 (has program dropdown)
- [x] POST /register with new student → 302 & row created (is_active=0)
- [x] Sign in as pending student → shows pending-approval notice
- [x] Dean login → /dean/accounts = 200 → Approve the pending student
- [x] That student now logs in → /student/dashboard
- [x] Dean creates a teacher → appears in Staff list → teacher can log in (→ /faculty/dashboard)
- [x] Login page renders new college×tech UI + Motion animations (status 200; tabs work after `scriptSrcAttr` fix; page scrolls instead of clipping)
- [x] Banner gallery: 5 discs (`position:absolute`, `geo.D` size), one-shot Motion entrance (no per-frame loop → no lag), desktop 3-left/2-right flanking the measured login box, mobile 3-top/2-bottom, BSCRIM disc present
- [x] Login card is compact (`max-w-[352px] p-5`) on desktop and mobile
- [x] PH grading: dean grade-entry form renders numeric inputs (`type=number min=1 max=5 step=0.25`) + legend; batch save skips invalid (`'A'`) and saves valid (`1.00`) → `{"success":true,"saved":1}`; no letter-grade rows remain in DB
- [x] Login card entrance is pure CSS (`.card-in`) so the form shows even if the Motion CDN script fails to load (was `opacity:0` until Motion revealed it)
- [x] Login works for Gmail addresses containing dots (`charles20yahoo.com@gmail.com` / `student123` → 302 `/student/dashboard`); demo student `juan.delacruz@pcc.edu.ph` / `student123` also 302
- Server was running on **http://localhost:3005** when the session ended (entry `src/app.js`, started via Start-Process with -WorkingDirectory).

## Mobile-friendly student portal (nav + layout)
- New `src/views/partials/student-mobile-nav.ejs` → **bottom tab bar** (Home/Grades/Prospectus/Alerts/Profile with icons, notification red-dot badge, `safe-area-inset-bottom` for iPhones, `position:fixed` + `backdrop-blur`, shown only below `md`).
- All 5 student pages now: desktop sidebar hidden on phones (`md:flex md:w-64`), main content `p-4 sm:p-6 md:p-8 pb-24 md:pb-8` (bottom clearance so content isn't covered by the tab bar), and include the mobile nav partial with the right `active` / `unreadCount`.
- Header (`partials/header.ejs`) slimmer on phones (`px-4 sm:px-6`, hides full name below `sm`).
- Grades + Prospectus fail-highlight now numeric (`grade_points < 2` → red) instead of the old letter `'F'` check. Fail = PH grade 4.00/4.25/.../5.00 (not shown: 3.00 = 75% passing).
- `layouts/main.ejs` viewport now `viewport-fit=cover` so the bottom bar respects iPhone home-indicator safe area.
- Verified with HTTP auth (login POST is **`/login`**, NOT `/auth/login` — auth router is mounted at `/`): all 5 student pages return 200 with the bottom nav, responsive sidebar, and `pb-24` clearance. Remember to hard-refresh (Ctrl+F5) and test on your phone.
- Lesson: verification script must hit the **fresh** server process (old instance still binds 3005 until `taskkill /F /IM node.exe`).

## Whole-portal premium redesign — Navy + Gold, glassmorphism
- **Design system lives in `layouts/main.ejs`** (one place → every page):
  - Tailwind palette extended: `navy-950…600` + `gold-400…600`.
  - Body: layered radial gradients (navy tint + gold glow) on a light base, `background-attachment: fixed`.
  - Custom scrollbars (thin, navy/gold), gold `::selection`, antialiased text.
  - `.panel` card (white, hairline border, layered soft shadow) + `.panel-hover` (lift + glow on hover) — replaced `bg-white rounded-xl shadow` everywhere.
  - `.hero` banner (deep navy gradient, gold radial bloom, gold edge bar) — replaced `bg-gradient-to-r from-pcc-blue…` on all 4 dashboards.
  - `main h1` = navy→gold gradient headline text (hero h1 forced white).
  - Sidebar: global `aside.bg-white` → navy gradient, translucent white text, gold active pill, gold avatar ring with navy lettering.
  - Primary `bg-pcc-blue` buttons get a gradient + hover lift + glow; table headers gradient + wider tracking; row hover states; footer gold hairline.
- **`partials/header.ejs`**: navy glass gradient header with gold top accent, gold PCC badge, initials circle avatar, outlined Logout pill.
- **Staff mobile nav**: new `partials/staff-topnav.ejs` — horizontal pill bar (below the sticky header) for phones; staff sidebars now `hidden lg:flex`, main `p-4 sm:p-6 lg:p-8`.
- Applied to all 15 portal views (5 student + 7 dean + 2 admin + 1 faculty) via a scripted find/replace (mechanical swaps, counts logged); verified over HTTP: every student/dean/admin/faculty page 200; grade-entry-form (needs offering id) renders all new classes; login & register 200.
- `GET /dean/prospectus` (no id) correctly 404s (route needs `:studentId`).
- No server restart was needed (EJS-only changes); Cloudflare quick tunnel still up (~`wallet-vid-harmony-dispatched.trycloudflare.com` — changes with each restart).

## Registration photo + selfie (verified end-to-end)
- `auth/register.ejs`: compact navy/gold glass card (`max-w-md`, `p-5 sm:p-7`, `py-2.5` inputs), **Profile Photo** row with **Choose Photo** + **Take Selfie** buttons, 72px circular preview (gold ring), Remove button, type/size hints.
- Selfie = modal with `getUserMedia` front camera (mirrored capture), close cancels tracks; photos downscaled to square 480px JPEG client-side (canvas) and pushed into the hidden `picture` input via `DataTransfer`.
- Backend already supported it: `registerUpload` multer (memory, 5MB, jpg/png/webp) on `POST /register`, `saveProfilePhoto(studentId, req.file)` writes `uploads/profiles/student-<id>.<ext>` + sets `students.profile_picture`. **No route/server changes needed.**
- CSP already OK (`imgSrc` has `blob:`/`data:`; `scriptSrc` `'unsafe-inline'`).
- **E2E test passed**: multipart POST with a PNG → `302 /login?registered=1`, `students.profile_picture = '/uploads/profiles/student-17.png'`, file on disk (70B) → all test rows/file cleaned up afterwards.
- Note: camera works on `localhost` and the **https** Cloudflare tunnel (secure contexts); plain http over LAN would block `getUserMedia`.

## Split front doors: students vs staff login
- **`/login` = students only** — role tabs removed (no Teachers/Dean tabs visible), form sends hidden `portal=student`.
- **`/staff` = direct link for teachers + dean/admin** — same login view with only the `Teachers | Dean/Admin` tabs (default Teachers), hidden `portal=staff`. Not linked from any public page — staff just use the URL.
- `POST /login` reads the `portal` hidden field (`res.locals.portal` so every error render keeps the mode) and **gates by role after password check**: student creds on `/staff` → "Students must sign in through the student portal."; staff creds on `/login` → "Faculty and Dean accounts must sign in through the staff portal." Password check still runs first (no account-existence leak).
- Successful logins unchanged: role-based redirect (`/student/dashboard`, `/faculty/dashboard`, `/dean/dashboard`, `/admin/dashboard`). Register box stays student-only (`showNew`).
- View: `auth/login.ejs` got `<% const portalMode %>` top-level default, conditional tabs block, dynamic `<h1>`, hidden `portal` input, `applyRole('<faculty|student>')` default.
- **Tested (7/7):** `/login` student-only + `/staff` staff tabs render; dean-on-`/login` blocked; student-on-`/staff` blocked; student→`302 /student/dashboard`, dean→`302 /dean/dashboard`, faculty→`302 /faculty/dashboard`.
- Needed a **server restart** (route change): killed PID on :3005, relaunched `node src/app.js` (new PID 22068). Local :3005 = 200.

## Per-role login doors (dean + instructor get their own links)
- **`/login`** → students, **`/instructor`** → teachers, **`/dean`** → dean/admin, **`/staff`** → shared staff (kept working).
- Each door renders the same view with its own `portal` value: single-role doors show **no tabs** (correct title/labels pre-set server-side: `Dean / Admin Portal` / `Faculty Portal`); only `/staff` keeps the `Teachers | Dean/Admin` tabs.
- POST gate is now a map (`doorRoles`): `student:['student']`, `instructor:['faculty']`, `dean:['dean','admin','registrar']`, `staff:[any non-student]`. Wrong door → error naming the right one, e.g. *"This account must sign in through the instructor portal (/instructor)."*
- **Bug caught & fixed in testing**: portal normalization only mapped `staff`→`staff` (everything else → `student`), which made `/dean`/`/instructor` behave as student doors (a student could even log in via `/dean`). Fixed to `['instructor','dean','staff'].includes(...)`.
- **Tested 8/8 after fix**: dean→`302 /dean/dashboard`, faculty→`302 /faculty/dashboard`, admin→`302 /admin/dashboard`, dean via `/staff` still works, student via `/login` still works; faculty↔dean doors swapped → blocked with correct door named; student on `/dean` → blocked.
- Routes: `GET /dean` + `GET /instructor` added to `auth.routes.js` (authRoutes is mounted before deanRoutes, and deanRoutes has no root GET, so no conflict). **Server restarted** (PID 18748).

## Login "Register" box redesign
- Removed the odd `// first_time ?` mono code-comment label from the New Student card on `/login`.
- New look: blue-tinted gradient card, gold hairline ring, bold heading + description, white/blue outline **Register as a New Student →** button that fills blue on hover. Still gated by `newStudentBox` (hidden on staff doors). EJS-only → live without restart; verified on `/login`.

## Student forgot-password with email verification code
- **Flow (students only)**: `/forgot-password` → enter student email → 6-digit code (10 min TTL, SHA-256 hashed at rest) → `/forgot-password/verify` (code + new password ≥8 chars + confirm) → `/login?reset=1` success notice → sign in.
- New `migrations/003_password_resets.sql` (`password_resets` table: user_id, email, code_hash, attempts, used_at, expires_at) — applied automatically on boot (log: `✓ Applied migration: 003_password_resets.sql`).
- New `src/utils/mailer.js` using **nodemailer** (`npm install nodemailer`): reads `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM` from `.env`. **If SMTP is not configured (or send fails), the code is shown on-screen in an amber "Dev mode" notice** — works immediately, add SMTP creds later to switch to real email with no code change.
- Security: wrong-code attempt cap (5), per-email request cap (3 / 15 min), old codes invalidated on resend, generic response for unknown/non-student emails (no account enumeration), `timingSafeEqual` hash compare, password also clears `failed_login_attempts`/`locked_until`.
- `/login` GET now shows "Password updated! Sign in with your new password." on `?reset=1`; faculty/dean see a "contact IT office" hint on step 1.
- Routes in `auth.routes.js`: `GET+POST /forgot-password`, `GET+POST /forgot-password/verify`. **Server restart** (PID 5172).
- **Tested 12/12 end-to-end**: step1/step2 render, dev-mode code issued + shown, wrong code rejected, reset → `302 /login?reset=1`, login with new password → `302 /student/dashboard`, weak password rejected, dean/unknown emails get generic notice, rate cap blocks after 3, password restored + cleanup verified.

## Instructor grade entry (faculty submit grades for their subjects)
- **`GET /faculty/grade-entry`** — subjects held by the logged-in instructor in the active semester, **grouped by subject with one card per section** ("Sec. A · 1 students · 0/1 graded"), matching the "one subject, multiple sections" model. Empty state if none assigned.
- **`GET /faculty/grade-entry/:offeringId`** — grade sheet (PH 1.00–5.00 quarter steps, fill-all, Ctrl+S, Tab navigation) — **ownership enforced**: offering must have `instructor_id = req.user.id`, otherwise `302` back to the list.
- **`POST /faculty/grades/batch`** — same save/audit logic as the dean's endpoint plus guards: 404 unknown offering, **403 if not the offering's instructor**, 400 if not the active semester, and each `enrollmentId` must belong to that offering. Grades recorded with `encoded_by = instructor`, audit row inserted, `grade_points = 5 - raw`.
- Nav: faculty sidebar + staff-topnav now include **Grade Entry**; dashboard table got a **"Submit grades →"** column, graded counter (`x/y`) and Pending/Graded status pills; save button reads **"Submit Grades"**, back link "← Back to My Subjects". Dashboard `graded_count` subquery added to the list SQL.
- New views: `faculty/grade-entry.ejs`, `faculty/grade-entry-form.ejs` (clones of dean's with faculty nav + `/faculty/grades/batch` fetch). Dean's flow untouched.
- **Server restarted** (route change). **Tested**: faculty login → list 200 (subjects + section chips), dashboard links present, sheet 200, submit `{success:true, saved:1}`, fresh insert `encoded_by=16` + audit row, foreign offering → 302 list + 403 on POST, missing offering → 302/404, all test data restored (seeded grade preserved, audit rows back to 2).

## Instructor Excel/CSV grade import (the "send an Excel file" flow)
- **`GET /faculty/grade-entry/:offeringId/template`** — downloads a real **.xlsx** template (`<Course Code> Sec <Section> Grade Template.xlsx`) pre-filled with that section's enrolled students (Student No. / Student Name / Grade / Remarks) plus a second **Instructions** sheet (PH 1.00–5.00 quarter steps, letters allowed, blank = skip).
- **`POST /faculty/grades/import`** — multipart upload (`importUpload`, memory storage, 5 MB cap, fileFilter `.xlsx/.xls/.csv` → in-file JSON 400 for other types). The **validation engine**: reads the first sheet (SheetJS `xlsx`, `{ raw: true }` — required or CSV turns `2024-00001` into the date serial `45292`), finds the header row (regex `student no/#/number/id` + `grade`), then per row: matches **student number against that section's enrolled students** (normalized, so `2024-00001`/`20240001` both work), skips duplicates, unknown students, blank rows and invalid grades — each with a reason and row number; accepts numeric grades **and legacy letters** (`A+/A`=1.00 … `F`=5.00) via shared `parsePhGrade` (now module-level; the batch route uses it too). Saves through the same transaction/upsert/audit path, `encoded_by = instructor`, `grade_points = 5 − raw`.
- **Result report** JSON `{ success, imported, blank, skipped:[{row, studentNo, reason}] }` → the sheet page alerts a summary (first 6 skips + "…and N more") and reloads when anything was imported.
- **Ownership guards mirror grade entry**: 404 unknown offering, **403 foreign instructor**, 400 non-active semester, 400 no active semester / unreadable file.
- UI: grade sheet header now has **"Download Template"** and **"Upload Excel"** (hidden file input → `importGrades()`).
- **Tested**: template 200 with correct xlsx headers + student row; xlsx import `imported:1` with 3 skips correctly labelled (invalid `88`, duplicate, not-enrolled) + exactly 1 audit row (`old 1.00 → new 2.25`, `encoded_by:16`); CSV import `imported:1` (student no. intact, no date mangling); `.txt` → 400 JSON; missing offering → 404; foreign offering → 403; all test data + offering ownership restored.
- Note: the **dean's** pre-existing `POST /dean/grades/import` (`dean.routes.js:216`) is still a stub — it parses CSV but never saves. Can be wired to this engine if wanted.

## Royal blue + gold premium theme (whole-system redesign pass)
- **Palette shift** from flat PCC-blue/navy to deep **royal blue** (`#1E429F` primary, `#0B1747`/`#10215F` chrome) with layered **gold** (`#EFD27A` bright / `#D4AF37` base / `#B8912B` deep). Old `navy-*` Tailwind keys kept as aliases so every existing class picks up the royal look.
- **`layouts/main.ejs` overhaul** (applies to every layout page — student, dean, faculty, admin): Inter body + **Playfair Display** serif for `h1`/`h2`/hero, fine royal+gold guilloché-weave page texture, panels with gold hairline caps + deeper shadows + hover gold borders, royal hero banners with gold glow + sheen sweep, royal sidebar with gold active pills/left bars and gold hairline divider, table heads with gold underlines + royal hover tint, royal-gradient primary buttons with gold-ring hover, royal focus rings / gold hover borders on inputs, gold selection + scrollbar accents, gentle rise-in animation (respects `prefers-reduced-motion`).
- **`header.ejs`**: gold radial crest seal with double gold ring, serif "Passi City College" + letterspaced gold "STUDENT PORTAL" kicker, gold avatar ring, gold-outlined Logout button; staff topnav sticky offset adjusted (68px) + royal-gradient active pill.
- **Standalone pages** (`login`, `register`, `forgot-password`, `2fa-setup`, `2fa-verify`, `error`): same royal palette + Google-Fonts links in tailwind config, gold PCC-crest seals, serif headings. `error.ejs` rewritten as a royal card with gold seal.
- **`app.js` CSP** extended for fonts: `styleSrc += fonts.googleapis.com`, `fontSrc += fonts.gstatic.com + data:`, `connectSrc` for preconnect.
- **Server restarted** (CSP change). **Verified**: login/register/forgot-password, all 4 dashboards, student grades/prospectus, faculty grade-entry + sheet (Download/Upload intact), dean grade-entry — all 200 with new theme markers; custom 404 renders the themed error page.

## Instructor "My Subjects" overview (sidebar item)
- New **"My Subjects"** entry in the faculty sidebar + staff topnav (between Dashboard and Grade Entry).
- **`GET /faculty/subjects`** → `faculty/subjects.ejs`: read-only teaching-load overview for the active semester. Summary cards (**Subjects / Sections / Students / Teaching Load in units**), then each subject as a panel (code, name, units pill, section count in gold) with a per-section table: Section chip, Students, Graded `x/y`, Graded/Pending status pill, and **"Encode grades →"** into the grade sheet. Empty state when nothing is assigned.
- **Refactor**: extracted the duplicated faculty sidebar into **`partials/faculty-sidebar.ejs`** (takes `active` + `user`, nav array with active-state handling) and replaced the inline `<aside>` blocks in `faculty/dashboard.ejs`, `faculty/grade-entry.ejs`, `faculty/grade-entry-form.ejs` — one source of truth for faculty nav. All three staff-topnav `links` arrays now include My Subjects.
- **Server restarted** (route change). **Verified**: `/faculty/subjects` 200 with all subjects/sections + summary; sidebar nav shows My Subjects on dashboard, grade list, and grade sheet (Excel/Template controls intact); student page unaffected.

## Staff (instructor / dean / admin) profile settings
- **Migration `004_staff_profile.sql`**: adds `profile_picture` + `picture_updated_at` to `users` (staff accounts live only in `users`; there is no `faculty` table).
- **`staff-profile.routes.js`** mounted at **`/profile`** for roles `faculty|dean|admin|registrar`:
  - `GET /profile` → account page (name, role, member-since, account id, 2FA status).
  - `POST /profile` → update **full name + email** (validates name/email, blocks email already used by another account); **re-issues JWT cookies** via `generateTokens`/`setTokenCookies` (now exported from `auth.routes.js`) so the header/name updates immediately.
  - `POST /profile/password` → change password (bcrypt; verifies current, min 8 chars, confirm match, must differ from current).
  - `POST /profile/picture` (multer → `uploads/profiles/staff-<id>.<ext>`, JPG/PNG/WebP ≤5 MB) and `DELETE /profile/picture`.
- **View `staff/profile.ejs`** (royal/gold theme): avatar with gold ring + initials fallback, upload/remove photo, Account Information form, Change Password form, right-hand account meta with a **2FA "Set up"** link (`/2fa/setup`) or Enabled badge.
- **Navigation**: header avatar + name now link to the profile (`/student/profile` for students, `/profile` for staff); added a **Profile** item to the faculty sidebar partial, the dean dashboard sidebar, the admin dashboard sidebar, and the staff topnav of the faculty/dean/admin dashboards.
- **Server restarted** (migration applied: `✓ Applied migration: 004_staff_profile.sql`). **Verified 16/16**: faculty `/profile` 200 with all sections; duplicate email blocked; name update persists + new cookies issued + header reflects new name; wrong/mismatch/short password rejected; password change → re-login works; photo upload writes file + DB then delete clears; dean & admin pages 200; **student correctly gets 403** on `/profile`. All test data (name, password, photo) restored.

## Portal-aware redirects (staff never bounced to the student portal)
- **Bug**: logout shoved everyone to `/login` (student portal), and an expired/absent token on any staff route redirected there too — the caller kept landing on the student login page.
- **`src/middleware/authenticate.js`**: added `loginPathFor(req)` — `/dean*`→`/dean`, `/admin*`→`/dean`, `/faculty*`→`/instructor`, `/student*`→`/login`, with a referer fallback (`/profile` honours where you came from). `requireAuth` and `requireRole` (no-user case) now redirect through it instead of hardcoded `/login`.
- **`src/routes/auth.routes.js` logout** (`GET /auth/logout`): decodes the access token to pick the right portal — faculty→`/instructor`, dean/registrar/admin→`/dean`, student→`/login`; falls back to `?from=` when the token is already gone.
- **Server restarted. Verified**: dean logout→`/dean`, faculty logout→`/instructor`, admin logout→`/dean`, student logout→`/login`; no-token `/dean/dashboard`→`/dean`, `/faculty/dashboard`→`/instructor`, `/admin/dashboard`→`/dean`, `/student/dashboard`→`/login`, no-referer `/profile`→`/login`. So refresh-while-expired sends staff back to their own sign-in, and logout keeps them in their portal.

## Dean Year Levels browser (subjects per year + sections per year)
- **Routes** in `dean.routes.js`:
  - `GET /dean/year-levels` — overview: 4 year cards (students + sections counts from `students`), plus per-program curriculum blocks (subjects + units per year). Curriculum source = the newest `curriculum_templates` row per `program_code` that has `curriculum_items`; year derived from `semester_number` (1-2 = Y1 … 7-8 = Y4).
  - `GET /dean/year-levels/:year` — validates 1-4, optional `?program=` selector: **Subjects Required** tables (1st/2nd semester: code, subject, units, semester totals) + **Sections** cards with live student rosters (student no, full name, gender). Sections are matched case-insensitively (`upper(trim(section))`) so `3A`/`3a` merge into one section; students with no section shown under an "Unassigned" card.
- **Views**: `dean/year-levels.ejs` + `dean/year-level-detail.ejs` (royal/gold theme: hero, stat panels, gold-underlined tables; sidebar + staff-topnav consistent with the rest of the dean portal).
- **Nav**: added **Year Levels** to the dean dashboard sidebar + dashboard/students topnavs.
- **Server restarted. Verified**: overview 200 with Year 1-4 cards + BSIT block; `/dean/year-levels/{1..4}?program=BSIT` all 200 with both semester tables + sections panel (real rosters render e.g. `2026-0002`, `2026-00001`); `year=9`/`abc` redirect to `/dean/year-levels`; unauthenticated → `/dean`.

## Official BSIT curriculum loaded
- **Migration `005_official_bsit_curriculum.sql`**: collapsed the 7 duplicate seed BSIT templates into the one canonical template (id 1) and loaded the official **48-course IT sequence** mapped as semester 1-8 (= Year 1-4, 1st/2nd sem):
  - Y1: IT 101/102, GE 1/2/3/10/8, PATHFIT 1, NSTP 1 (ROTC) | IT 103, HCI 101, MS 101, GE 7/9/11/4, PATHFIT 2
  - Y2: WS 201, IT 204, PF 201, MS 202, GE 6, IT 205, GE 12, PATHFIT 3 | IPT 201, PT 201, NET 201, IT 206, GE 5, IM 201, PATHFIT 4
  - Y3: SIA 301, IAS 301, NET 302, SP 301, IT ELECT 1-2 | IAS 302, SA 301, SIA 302, IT ELECT 3-4, CAP 301
  - Y4: CAP 402, IT ELECT 5-6 | OJT 401 (486 hrs)
  - Units: 3-credit lectures, 2-credit PATHFIT, 3-credit NSTP, 6-credit OJT. Obvious typos resolved: 2nd-sem "IAS 301"→**IAS 302**, "SIA 302" name→**System Integration and Architecture 2**.
  - `student_curriculum` for student 1 still points at template id 1, so the prospectus now follows the official curriculum.
- **Server restarted** (migration applied). **Verified**: 1 template + 48 items, per-semester 9/8/8/7/6/6/3/1 (units 26/23/23/20/18/18/9/6); Year 1 shows all 17 courses incl. NSTP 1; OJT 401 only on Year 4; PATHFIT 4 only on Y2 2nd sem; overview shows "Official Curriculum".

## Stray seed courses removed
- **Migration `006_remove_stray_courses.sql`**: deleted the seed `course_offerings` that are NOT in the official BSIT curriculum (**IT 111 "Programming 2 (CS2)"**, **MATH 101 "College Algebra"**) together with their enrollments + grades (FK order: grades → enrollments → offerings); renamed the remaining **IT 102** offering from "Programming 1 (CS1)" to its official title **"Fundamentals of Programming"**. Historical `grade_audit_log` rows were left intact (append-only ledger).
- **Server restarted** (migration applied). **Verified**: only offering left is `IT 102 · Fundamentals of Programming`; grades now reference only IT 102; dean Grade Entry lists only IT 102 and the grade sheet header shows the official title.

## Eye-comfort pass: softer light theme (royal blue + gold kept)
- **Text**: remapped the theme's neutral `gray` scale (Tailwind config) to a warmer, softer palette and set a default `--ink` (#2B3133) body color; deepened the `main h1` gradient and softened hero text (#F6F8FF on a calmer royal gradient).
- **Backgrounds**: dimmed the page base (`--bg-base #E2E8F3`, lower-opacity radial glows), turned `.panel` cards into a muted pearl (`#F6F8FC → #EFF3FA`), and darkened the table head gradient — lower glare, same premium look.
- **Surfaces**: added `main .bg-white` / `main .bg-gray-50` overrides so content cards/tables using raw `bg-white` become pearl; softened the footer and mobile staff topnav to the same surface. Dark sidebar + header unchanged.
- **Verified**: dean dashboard / year-levels / year-level detail / students / reports / grade-entry / accounts all still render with the new palette (no restart needed — view/CSS-only change).

## Champagne (warm ivory) surfaces — no more white
- Switched the light theme off white: page base now warm sand (`--bg-base #E6DCC3`), `.panel` cards champagne (`#F9F3E4 → #F1E7CE`, warm gold-tinted border/shadow), table heads warm (`#F3EAD4 → #E8DCBC`), inputs/`bg-white` content surfaces → `--surface #F7F1E1`, footer + mobile staff topnav cream. Scrollbars re-tinted warm. Dark royal sidebar/header + gold accents unchanged (cream is the complement of royal blue, so gold reads richer).
- **Verified**: dean dashboard / year-levels / detail / students / reports / grade-entry / accounts / prospectus all render with the champagne palette.

## Registration page — compact + profile photo / selfie
- `/register` compact pass: card `max-w-lg → max-w-md`, padding `p-5 sm:p-7`, logo 64→56px, title 2xl→xl, inputs `px-3.5 py-2.5`, form gaps `space-y-3`, side-by-side fields `gap-3` (one short scroll on a phone).
- **Profile photo at registration already worked end-to-end** (multer `registerUpload` memory storage + `saveProfilePhoto` attach after the student row exists). The form already had `enctype="multipart/form-data"` and a `picture` file input, plus client-side UX: circular preview, "Choose Photo" (removes `capture` → gallery/file picker), "Take Selfie" (in-page modal with `getUserMedia` front camera, mirrored capture), "Remove", auto-downscale to a 480px square JPEG, type check (JPG/PNG/WebP) and 5MB limit.
- Verified live: register **with** photo → 302 `/login?registered=1`, row `profile_picture = /uploads/profiles/student-<id>.png`, file on disk, `GET` of the photo 200 `image/png`; **bad file type** (text/plain) → 400 with the friendly "could not be used" message; **no photo** → still registers fine. All test users/rows/photos cleaned up afterwards (back to 10 users / 6 students).
- Note for selfie: `getUserMedia` needs a secure context — works on `localhost` and on the HTTPS Cloudflare tunnel, but a plain `http://192.168.x.x` LAN URL will block the camera.

## Registration photo / selfie capture
- Register form (`auth/register.ejs`) is now `enctype="multipart/form-data"` with a photo row (72px round preview, gold ring):
  - **Choose Photo** → file picker (JPG/PNG/WebP).
  - **Take Selfie** → in-page camera modal via `getUserMedia` (mirrored preview, mirrored capture), falls back to the file picker (with `capture` hint) if the camera is blocked/unavailable.
  - Client-side square crop + downscale to ≤480px JPEG (~small upload); type/size validation with inline hints; Remove button.
- Server (`auth.routes.js` POST /register): `multer` memoryStorage (5MB, jpeg/png/webp) with a friendly error re-render on bad type/size; the transaction now returns the new `student_id` so `saveProfilePhoto()` writes `uploads/profiles/student-<id>.<ext>` and sets `students.profile_picture` + `picture_updated_at` (photo is optional — registration succeeds without it).
- Verified: photo upload 302 → row has `/uploads/profiles/student-13.png` on disk; bad type → 400 friendly message; no photo → 302 with `profile_picture` null. Test rows/files cleaned up after.
- Requires a **server restart** (route change).

## Official CHED-style prospectus (for all IT students)
- **Migration `007_prospectus_fields.sql`**: added `lec_hours`, `lab_hours` (default lec = credit units, lab = 0) and `prerequisite` to `curriculum_items`; populated the official BSIT prerequisites (e.g. IT 103 <- IT 102, PF 201 <- IT 103, NET 302 <- NET 201, CAP 402 <- CAP 301, OJT 401 = None).
- **Prospectus redesigned** to match the official printed form (read from the reference image via Windows.Media.Ocr): PASSI CITY COLLEGE / City of Passi, Iloilo header, program title, "Review and Revised as per CMO #25, s. 2015", student info block (NAME, COURSE/YEAR, SEMESTER, CELLPHONE NO., A.Y., STUDENT NO.), then FIRST-FOURTH YEAR banners each with 1st/2nd Semester tables: **Course No. | Descriptive Title | Final Grade | Hours (Lec/Lab) | Units | Prerequisite**, an **AVERAGE** + units row per semester, a **Total Units** line, and the **"Certified Correct: MYLEN B. PADERES, M.Eng'g - Dean"** sign-off. Includes print CSS (A4, chrome hidden) + a Print button.
- **All IT students**: both student (`/student/prospectus`) and dean (`/dean/prospectus/:id`) routes now **fall back to the official program template** when a student has no `student_curriculum` row, so every BSIT student sees the full 48-course prospectus (grades fill in per student). Grades are keyed by course code (most recent wins); A.Y./Semester come from the active `semesters` row.
- **Server restarted** (migration applied). **Verified**: student prospectus 200 with 8 semester tables, all header/summary/certification markers present, OJT 401 only in Year 4; dean prospectus 200 with the same document (dean login door needs `portal=dean`); fallback query resolves template 1 / 48 items for students 1,10,11,18.

## Prospectus: side-by-side semesters + one-page A4 print
- Each year's **1st and 2nd Semester tables sit side-by-side** (`.year-grid` 2-column; stacks only on phones; forced 2-column in print).
- **Print / Save-as-PDF fits exactly one A4 portrait page** (verified via headless Edge `--print-to-pdf` → `/Count 1`): compact print stylesheet (7pt tables, tight padding, 194mm sheet, 8mm `@page` margins, self-contained `display:grid/flex` so it doesn't depend on the Tailwind CDN), a proven `zoom: 0.7` fallback in `@media print`, plus a `fitProspectusAndPrint()` JS auto-fit (iterative `beforeprint` scale-to-fit with re-measure for text re-wrap; overrides with the largest scale that fits). Print button now calls it; Ctrl+P covered by `beforeprint`/`afterprint`.
- Note: `zoom` in print verified with a controlled test (500mm block: 2 pages → 1 page at `zoom: 0.5`); content measured at ~357mm tall via PDF text-position analysis, hence the 0.7 factor.

## Prospectus: Download PDF (digital copy)
- Gold **Download PDF** button next to Print on both student (`/student/prospectus`) and dean (`/dean/prospectus/:id`) prospectus pages. Uses the `html2pdf.js` bundle (CDN: cdnjs 0.10.1 — verified 200) via `html2canvas` (scale 2) + `jsPDF`: captures the sheet in the compact official style (`print-fit`), fits the image onto **one A4 portrait page** (8mm margins, aspect-preserved, centered), and saves as `Prospectus-<student_no>.pdf`. Button shows "Preparing…" while rendering; friendly alert + fallback to Print if the library can't load or rendering fails.
- **Verified**: both pages 200 with button/CDN/function present; extracted inline JS passes `node --check` for both views (view-only change, no restart needed).

## Student UI: mobile-friendly pass (Android/iOS)
- Already solid: viewport meta (`viewport-fit=cover`), bottom tab bar with `env(safe-area-inset-bottom)`, hidden sidebar on phones, `pb-24` clearance, stacking grids, scrollable tables.
- **Auth**: added `input,select,textarea{font-size:16px}` under 640px on login/register/forgot-password so iOS Safari doesn't auto-zoom on focus (2FA code input already `text-2xl`).
- **Prospectus (student+dean)**: header row now wraps (`flex-wrap gap-3`), Download/Print buttons shrink on phones (`px-3 text-sm`), titles scale (`text-xl/… → sm:text-2xl`); tables already stack + scroll per-semester.
- **Grades**: table cells tightened on phones (`px-3 py-2.5/3`, full padding from `sm:` up).
- **Notifications**: rows use `p-4 sm:p-6`, `gap-3 min-w-0`, date block `shrink-0 whitespace-nowrap` so nothing squeezes off-screen.
- **Verified**: all 5 student pages + login/register/forgot return 200; responsive markers confirmed in rendered HTML (view-only change, no restart needed).

## Prospectus: mobile-friendly tables
- On phones (<640px) each semester table now shows only **Course No. | Descriptive Title | Final Grade | Units** — the Hours (Lec/Lab) and Prerequisite columns hide via `hidden sm:table-cell` (full 7 columns on desktop/print/download). Key cells are `whitespace-nowrap` so rows stay compact.
- Fixed the AVERAGE footer alignment too (was sitting under the wrong headers): now `AVERAGE | avg-grade | (hours) | total-units`, responsive-safe with no colspan tricks.
- Tighter phone spacing: main `p-2`, doc header + student info `px-4/py-3` (full padding from `sm:` up); titles already scale.
- Download PDF on phones force-shows the hidden columns during capture so the digital copy keeps full data.
- **Verified**: both pages 200; marker counts exact (8 sub-rows, 16 colspans, 184 hidden cells = 48 courses × 3 + headers/footers); inline JS passes `node --check` (view-only change, no restart needed).

## Official PCC logo wired in
- Copied the official seal (715×715, 80KB) to `src/public/images/pcc-logo.jpg` (served at `/images/pcc-logo.jpg`).
- Replaced the gold "PCC" placeholder badges with the real logo (`rounded-full object-cover`, gold ring/shadow kept) in: shared `header.ejs` (every portal page), `auth/login.ejs`, `auth/register.ejs`, and the prospectus document header itself (both student + dean views, so print/PDF carry the seal too).
- **Verified**: logo serves 200 `image/jpeg`; header/login/register/prospectus all render 200 with the logo referenced (static + view-only change, no restart needed).

## Portal separation: switch-account screen (no more confusing bounces)
- Problem: opening a door (e.g. `/dean`) while logged in under another role silently bounced to your own dashboard (`/dean` → `/` → `/student/dashboard`) — confusing, felt unsafe. (Data itself was already strict: wrong roles get 403 on every route.)
- Fix: new `auth/switch-account.ejs` interstitial. Visiting any door (`/login`, `/staff`, `/dean`, `/instructor`) with a mismatched session now shows **"You're signed in as X (role) — this is the Y entrance"** with **[Go to my portal]** and **[Sign out & switch to Y]** (`/auth/logout?next=<door>`, whitelisted, lands straight on the wanted door form). Matching-role visits keep the old go-home behavior. Page also lists all three entrances and is mobile-friendly.
- `auth.routes.js`: hoisted `doorRoles`/`homeByRole` + new `doorNames`/`doorPaths` maps and `doorEntrance()` helper (POST /login and POST /2fa/verify now reuse the hoisted maps — same behavior); logout honors whitelisted `?next=`.
- Distributable links: Students `/login`, Teachers `/instructor`, Dean/Admin `/dean` (shared staff door `/staff`).
- **Server restarted** (route change). **Verified**: student→`/dean` = 200 switch screen naming Dean door + next-link; anon→`/dean` = dean form; dean→`/dean` = 302 home; dean→`/login` = switch screen naming Student; `logout?next=/dean` → 302 `/dean`; student+dean logins 302; wrong-door POST still rejected; staff/instructor doors 200.

## Friendly 403: stale tabs after switching accounts
- Cause of the reported "error": one browser holds one login — signing in as student replaces the dean session, so refreshing a leftover dean tab hit the bare 403 "Access Denied" page.
- Fix: `requireRole` in `middleware/authenticate.js` now renders the same `auth/switch-account` screen (still HTTP 403, protection unchanged) with a note like "The page you tried to open needs a Dean / Admin account", plus [Go to my portal] / [Sign out & switch]. View supports the optional `note`.
- **Server restarted** (middleware change). **Verified**: student→`/dean/students` = 403 friendly screen with note, no bare 403 text; dean/faculty/student own pages 200; anon→dean page 302 to door.

## Dual sessions: dean + student stay signed in together (no incognito needed)
- Problem: one shared cookie jar meant the second login always killed the first, so two tabs (student + dean) couldn't coexist — refreshing one bounced or errored.
- Fix: split cookies into two jars — `student_accessToken/_refreshToken` vs `staff_accessToken/_refreshToken`. `authenticate.js` picks the jar by URL (`/student*`+`/login` → student; `/dean*`/`/admin*`/`/faculty*`/`/instructor*`/`/staff*`/`/profile*` → staff; neutral paths try staff then student) and exports `JAR_COOKIES`/`jarForRole`. Login POST writes only its portal's jar (other untouched) and clears legacy `accessToken` names; 2FA verify picks jar by role; staff-profile re-issues into the staff jar; logout clears only the referred jar (via `?next=`/referer/live tokens, legacy `?from=` kept as fallback) so signing out of one portal keeps the other.
- Side effects (all intended): student-only session opening a dean page now gets the dean login form (302) instead of 403 — they can sign in as dean on the spot; same-jar mismatches (faculty→dean pages) still 403 + switch screen.
- **Server restarted** (auth change). **Verified full matrix**: one jar holds both `student_`+`staff_accessToken` after back-to-back logins; student+dean dashboards 200 simultaneously with correct identities, stable across refreshes; student logout (referer) clears only student jar → dean still 200, student 302; full logout clears both; faculty login → staff jar + dashboard 200; faculty→dean page still friendly 403; dean door with student-only session shows the form (no switch screen); no errors in log.

## Triple sessions: instructor gets its own jar too
- Instructors shared the staff jar with deans, so those two still replaced each other. Now three jars: `student_*`, `faculty_*`, `staff_*` (dean/admin/registrar). `jarsForRequest` returns ordered lookups (`/staff` door tries staff→faculty; neutral paths staff→faculty→student); `jarForRole` maps faculty separately; instructor-door logins write the faculty jar; logout handles all three (referer/`?next=`/live-session targeting).
- **Server restarted.** **Verified**: one jar holds all three access tokens; student+faculty+dean dashboards 200 together with correct identities; faculty logout (referer) clears only faculty jar → others stay 200; faculty-only→dean page still friendly 403; no errors.

## Dean nav: Students button removed, Year Levels is the prospectus hub
- Removed the Students nav item everywhere in the dean UI (sidebar + mobile topnav in all 9 dean views). The `/dean/students` route itself still works if opened directly.
- Year Level detail rosters (sections + unassigned) now have a **View Prospectus →** link per student (route selects `s.id`; tables wrapped in `overflow-x-auto` for phones), so the flow is Year Levels → year → section → prospectus.
- Dean prospectus "Back" link now returns to Year Levels.
- **Server restarted** (roster query change). **Verified**: year detail 200 with roster prospectus links carrying IDs; first link opens prospectus 200; no `/dean/students` left in any dean nav; dashboard 200; no errors.

## Premium color pass (no more flat white)
- All in the shared `layouts/main.ejs` theme (view-only, no restart): official prospectus sheet is now premium paper on screen (warm ivory gradient, gold hairline border, layered shadow + gold ring) while **print/PDF output stays pure white paper**; year banners → gold gradient with royal text; roster/section cards → warm gradient + gold-tinted borders + soft shadow; all tables → subtle warm zebra striping + stronger royal hover; AVERAGE footer rows → gold tint.
- **Verified**: dean dashboard/year-levels/year-detail + student dashboard/prospectus all 200 with the new rules present; print-fit/zoom untouched so one-page A4 still holds.

## Richer dashboard background (less "white")
- Deepened the page base from pale sand `#E6DCC3` to a richer bronze-sand `#D9C69C` (gradient stops + royal/gold glows strengthened to match; scrollbar + `--bg-base` updated; dark-ink text contrast stays safe). Lighter champagne panels now pop against it.
- **Verified**: dashboard 200 with the new base present (view-only change, no restart needed). If still seeing the old pale look, hard-refresh the browser (`Ctrl+F5`) — browsers cache the theme aggressively.

## Glassmorphism dashboard boxes
- `.panel` cards are now frosted glass: translucent champagne gradient + `blur(14px) saturate(1.25)`, light glass edge with gold inner hairline and soft top highlight — they pick up the bronze/royal background hues. Graceful fallback (readable gradient) where blur is unsupported; print unaffected (no background graphics).
- **Verified**: dean dashboard 200 with glass rules present, no panel+bg-white conflicts (view-only change, no restart needed).

## Panels deepened (less white reading) + stale-tab note
- Dashboard boxes deepened to a richer champagne (`rgba(247,240,222,.92)` → `rgba(235,219,186,.88)`, stronger gold inner hairline) so they read golden, not white. Audit confirmed no stray white surfaces in-portal (remaining `bg-gray-100`s are hover states; `bg-white`s are all theme-overridden).
- If the portal still looks plain white, the browser tab predates the theme passes — close ALL portal tabs and open a fresh one (the theme ships inline in the HTML, so only a fresh page load carries it). Quick check: dark royal sidebar = new theme; white sidebar = stale tab.

## Boxes go rich gold (unmistakably premium)
- `.panel` cards now wear a rich gold gradient (`#F2D67F → #E7C65E → #D4AF37 → #C39A2E`) with glass blur, gold border and luminous top edge — impossible to read as white, dark-ink text stays readable. Applies to every dashboard box for students, teachers and deans.
- **Verified**: dashboard 200 with gold panels served (view-only change, no restart needed). Needs a fresh tab/load to show (see stale-tab note above).

## Boxes go royal blue (gold was a miss)
- Reworked `.panel` into deep royal (`#1A2F7A → #10215F → #0A163E`) with gold border/hairline — matches sidebar, header and hero. All inner text/borders/rows re-tinted light inside a `@media screen` block (gray scale → soft white, links/royal text → gold, green/red → pastel, dividers → translucent white, zebra/hover → white/gold tints), so print/PDF automatically falls back to dark-on-white and stays readable. Hero print reset added too.
- **Verified**: student dashboard 200 with royal rules served (view-only change, no restart needed; needs page reload to show).

## Boxes final: refined light champagne (user picked)
- Royal reverted (user: "why blue??"). Per user choice, boxes stay soft champagne but with real definition: slightly deeper gradient, strong bronze border + inner ring, deeper layered shadows, and tinted header strips with gold dividers (`.panel > .border-b:first-child`). No more unilateral recolors — ask first.
- **Verified**: dashboard 200 with refined rules served (view-only change, no restart needed; needs page reload to show).

## Outline-style cards (user picked direction: outline + premium)
- Panels now airy outline-glass: translucent fills, crisp bronze outlines with light inner ring, stronger blur — definition through borders rather than fills. Roster cards matched. Buttons kept solid (offered to outline those too if wanted).
- **Verified**: dashboard 200 with outline rules served (view-only change, no restart needed; needs page reload to show).

## Gold borders on boxes (user picked: gold borders)
- Panels now carry a luminous gold border (`rgba(212,175,55,.65)`) with a soft outer gold glow ring, plus a brighter 3px gold top accent bar; roster cards matched with gold borders + faint glow. Definition purely through gold outlines.
- **Verified**: dashboard 200 with gold-border rules served (view-only change, no restart needed; needs page reload to show).

## Softened box borders (too bright)
- Dialed the gold back to muted bronze: softer border + faint glow, slim 2px antique-gold top accent, gentler highlights — premium without the glare.
- **Verified**: dashboard 200 with softened rules served (view-only change, no restart needed; needs page reload to show).

## Prospectus paper sizes: A4 / Short / Long, one page each
- New **Paper** dropdown (A4, Short = US Letter 8.5×11", Long = US Legal 8.5×14") next to Download/Print on both student + dean prospectus; choice remembered per browser (localStorage).
- Print path: JS rewrites `@page size` (Letter/Legal/A4 portrait, 8mm margins) via an appended `pagesize-css` tag, and the iterative one-page auto-fit now measures against the selected size. Download path: jsPDF uses matching `a4`/`letter`/`legal` format with aspect-fit to one page; filename includes size (`Prospectus-<no>-<Size>.pdf`).
- **Verified**: both pages 200 with selector + all markers; extracted inline JS (4811 chars, identical both views) passes `node --check` (view-only change, no restart needed).

## Download PDF fixed (was silently broken)
- Root cause: the `html2pdf.bundle.min.js` loads fine but exposes ONLY `window.html2pdf` — not `window.html2canvas`/`window.jspdf` — so the guard always tripped and users only got the "use Print" alert. Proven via instrumented headless run (`bundleload` fired, globals missing).
- Fix: load `html2canvas 1.4.1` + `jspdf 2.5.1 UMD` separately (both expose the globals the code uses).
- Second fix: html2canvas 1.x throws on Tailwind v3's space/slash `rgb()` syntax (all gray text/borders, shadows). Added an `onclone` sanitizer converting those to comma `rgba()` before parsing.
- Third: download capture now stacks semesters single-column with visible overflow (`dl-capture`) so wide tables can't get scroll-clipped.
- Failure fallback now auto-opens Print (Save as PDF) instead of dead-ending.
- **Verified end-to-end in headless Edge**: capture resolves with full 734×1357 canvas (no clipping, hidden columns restored); sanitizer unit-tested; both pages 200 with new libs + JS `node --check` clean (view-only change, no restart needed). Note: first click needs internet for the CDN libs.

## Download PDF actually fixed (CSP was blocking the CDN)
- User still got "needs internet" with internet on. Root cause #2: Helmet `scriptSrc` allowlists tailwind/jsdelivr but NOT cdnjs → the browser silently blocked the library scripts.
- Fix: vendored `html2canvas 1.4.1` + `jspdf 2.5.1 UMD` into `src/public/js/` and reference them same-origin (`/js/...`) — CSP-clean, and download now works even fully offline on LAN. Guard message updated (no more "needs internet").
- **Proven true-E2E** on the real stack (temp `/e2e_beacon` route, since removed): full capture resolves 734×1357 with all hidden columns restored, no clipping, no throw. Temp route + staged test file removed; server restarted clean (beacon 404, login/prospectus 200).

## IT department logo + PCC seal on the prospectus
- New `src/public/images/it-logo.jpg` (square seal, downsized 2048px/267KB → 512px/58KB for fast loads; serves 200).
- Both prospectus views (student + dean) now flank the header with the PCC seal left + IT logo right, centered college name between — on screen, print, and downloaded PDFs (same-origin, captured by html2canvas).
- **Verified**: both pages 200 with both logos; headless print-to-PDF still exactly 1 page with the taller header (view-only change, no restart needed).

## NSTP 2 added — official total 146 units
- **Migration `009_add_nstp2.sql`**: added missing `NSTP 2 (NSTP 2 (ROTC))`, 3 units, Year 1 2nd Semester (order 9, no prerequisite); set `programs.total_units = 146` for BSIT.
- **Server restarted.** **Verified**: 49 courses / 146 units (sem units 26/26/23/20/18/18/9/6); prospectus shows NSTP 2 and Total Units: 146 (views compute dynamically, no view change needed).

## Multi-department deans (each dean sees only their own department)
- Before: any `dean` account saw ALL students (no scoping); only an IT dean existed; HOD links empty.
- **Migration `008_department_deans.sql`**: `course_offerings.program_code` (+backfill IT 102→BSIT); IT dean (user 3) set as HOD of IT; demo Criminology dean `dean.crim@pcc.edu.ph`/`dean123` heading CRIM.
- **Scoping** (`deanScope`/`programFilter`/`inScope`/`denyCrossDept` in `dean.routes.js`, fail-closed): dashboard, students, grade-entry list/form, batch guard, release notifications, prospectus guard (403 + friendly screen), year-levels overview/detail (incl. `?program=` validation), accounts pending list, approve guard, reports. Toggle hardened: non-admins can only toggle faculty (a dean can no longer deactivate another dean/admin).
- **Admin HOD board** (`/admin/accounts` → Department Heads table + per-department assign/clear forms → `POST /admin/hod`, dean-only validation); account-create POSTs converted to redirect-with-message (GET reads `?success=`/`?error=`).
- **Server restarted.** **Verified**: IT dean unchanged (7 students, BSIT years, prospectus/grade forms 200); Crim dean sees zero students, BSIT prospectus → friendly 403, IT offering form bounces, year pages render empty; admin unscoped (7/7) + HOD board shows both heads; HOD assign+clear round-trip works; Crim→toggle IT dean blocked with user 3 still active; no errors.

## IT dean maroon tech theme
- New `res.locals.deptTheme` middleware (`app.js`): deans heading a department expose it (e.g. `it`); layout `<body>` gains `dept-<code>`.
- `body.dept-it` theme block in `main.ejs`: dusty-rose base with maroon glows + tech grid lines, maroon header/sidebar/hero/button gradients, maroon-gold headings, maroon table/focus accents, pale maroon mobile topnav. Gold kept as secondary. Other roles/departments untouched.
- **Server restarted** (app.js change). **Verified**: IT dean body carries `dept-it` + maroon rules; Crim dean gets unstyled `dept-crim` (default theme); student body has no theme class; no errors.

## Tech background for the IT maroon theme
- Embedded a subtle circuit-board SVG tile (maroon traces + gold node dots + chip square, data-URI) layered into the IT theme's page base, sidebar, and hero banners — technology texture behind everything, print-safe (backgrounds don't print).
- **Verified**: dashboard 200 with the tile served in all 3 spots (view-only change, no restart needed).

## IT students get their own design (binary + wires)
- `deptTheme` now emits full class strings; IT students carry `dept-it dept-it-student` (shared maroon chrome via `dept-it`, plus their own `body.dept-it-student` background: deeper base, binary-digit SVG tile + circuit wires tile, stronger maroon glows). Dean keeps circuit-only `dept-it`.
- **Server restarted** (app.js change). **Verified**: student body has both classes + binary CSS served; dean body has `dept-it` only; no errors.

## Maroon hero title fix (invisible "Dean Dashboard")
- Cause: the new `body.dept-it main h1` gradient-text rule outranked `.hero h1` solid-light, painting dark-maroon gradient text onto the dark maroon hero — unreadable.
- Fix: `body.dept-it .hero h1` restores solid `#F6F8FF` (covers all 3 dean heroes + any future ones; other roles never had the bug).
- **Verified**: dashboard 200 with the fix + title present (view-only change, no restart needed).

## Maroon tech theme extended to IT students
- `deptTheme` middleware now also maps students via `students → programs → departments`, so all BSIT students get the same maroon/gold tech theme (sidebar, header, heroes, buttons, base) as the IT dean. Faculty/admin/other departments unchanged.
- **Server restarted** (app.js change). **Verified**: BSIT student body carries `dept-it` across dashboard/grades/prospectus/profile (all 200); no errors.

## Third seal on the prospectus header (left pair + right seal)
- User supplied a round seal (223x226, red/gold on white, ring text includes "...NG ILOILO"). Saved as `src/public/images/passi-city-seal.png`.
- Header rebuilt as a 3-column grid `grid-cols-[1fr_auto_1fr]`: **IT logo + PCC seal on the left**, school name centered (auto column, so it stays optically centered), **new seal flush right**. Mobile sizes drop to 40px so all three fit on a phone.
- The seal is a photo-style PNG that fills its frame, so `rounded-full` would clip the ring; instead white was converted to alpha (32% of pixels) so it sits cleanly on the cream premium-paper sheet and on white print/PDF.
- Applied identically to `student/prospectus.ejs` and `dean/prospectus.ejs`.
- **Verified** in the in-app browser at 1000px: all 3 images loaded (64x64 each), left group x=313/389, seal x=869 flush right, `headOverflow=0`, `sheetOverflow=0`, title exactly centered in the content box; student 200, dean prospectus 200, image served 200. View-only change, no restart needed.

## Dean -> instructor subject assignments
- New `GET /dean/assignments` page: lists the active semester's course offerings, scoped by `programFilter(deanScope(req), 'co.program_code')`, with the current instructor, enrolled count, and an assigned/unassigned summary.
- Each row has an instructor dropdown of active `role='faculty'` users plus Save. `POST /dean/assignments/:offeringId` sets `course_offerings.instructor_id` (or NULL for "Unassigned"). Cross-department posts are blocked with `inScope` + `denyCrossDept` (friendly 403). Invalid/deactivated instructors are rejected with an error message.
- Faculty have no department column yet, so every active teacher is listed for every dean (noted for a future migration).
- Because the faculty portal already filters on `course_offerings.instructor_id`, an assigned section shows up in that instructor's Subjects / Grade Entry immediately - no other wiring needed.
- "Assignments" nav entry added to the sidebar (icon pages and compact pages) and the mobile top nav on all 9 dean views; new view `src/views/dean/assignments.ejs`.
- **Server restarted** (route change). **Verified**: assignments page 200 (1 section, 0 unassigned); assign to teacher 26 -> 302 success and persists; invalid id -> 302 error; unassign -> amber "Unassigned" state; restore to teacher 16 -> DB back to `instructor_id=16`; Crim dean sees the empty state and a cross-department POST returns 403 "Switch account"; all 10 dean routes still 200; in-app browser shows no horizontal overflow at 1000px. No schema change (column already existed).

## Create/delete sections + faculty departments
- **Migration `010_faculty_departments.sql`**: adds `users.department_id` (FK to departments) + index; existing faculty moved to IT. Applied on boot.
- **Scope helpers** in `dean.routes.js`: `deanDeptIds`, `departmentsForDean`, `programsForDean`, `facultyForDean`. Deans only get faculty from their own departments plus teachers with no department yet (new hires); admins stay unscoped.
- **Add Section** form on `/dean/assignments` (collapsible `<details>`): program (scoped), course code with a datalist of scoped curriculum courses (49 BSIT entries, filtered by program), title/units auto-filled from the code, section, optional max enrollment. `POST /dean/assignments/offerings` (declared before the `:offeringId` route) validates units/limits/unique(code, section, semester) and creates the row unassigned.
- **Delete section**: `POST /dean/assignments/offerings/:id/delete`, only shown when 0 enrolled; also blocks on the server with "N students still enrolled". Cross-department create/delete/assign all hit the friendly 403.
- **Teacher departments**: Create Teacher form now has a required department select; `POST /dean/accounts/faculty/:id/department` moves a teacher, limited to the dean's own departments. Accounts staff list shows each teacher's department and hides other departments' faculty.
- **Verified**: create IT 199 Sec Z 200 -> appears unassigned -> delete 200; duplicate section -> friendly error; deleting enrolled IT 102 -> blocked; Crim dean create/assign/delete on BSIT -> 403; Crim dean sees BSCRIM only; created one IT + one Crim test teacher, confirmed each dean's dropdown only listed its own, then deleted the test data (state restored to 1 offering, 2 IT faculty); admin login still sees all programs; all dean routes 200; in-app browser: datalist 49 options, code "IT 103" auto-filled title/units, no overflow at 1000px.
## Pre-deployment audit (2026-11-04)
- Full source + live review of auth, sessions, uploads, dean/admin scoping, dependencies and operational readiness. Report: `../PCC_PORTAL_AUDIT.md`.
- **Verified critical**: forgot-password leaks the 6-digit code in the redirect URL when SMTP is unset (account takeover); profile upload trusts the filename extension so a spoofed `image/png` upload named `.html` is served as `text/html` on the portal origin (stored XSS); `/auth/refresh` does not exist, so every session dies after 15 minutes.
- **Verified high**: Crim dean deactivated IT faculty 16 (restored); `POST /dean/grades/batch` does not verify enrollment/student pairing; grade release is college-wide; `/uploads` is public with predictable `student-<id>` names.
- **Dependencies**: `npm audit` = 1 critical (proxy-addr), 3 high (body-parser, multer, xlsx), 3 moderate; `npm audit fix` resolves all but `xlsx`.
- **Clean**: all SQL is parameterized; student/faculty ownership checks are consistent; department scoping is fail-closed for reads. Audit test artifacts removed and DB restored (faculty 16 active, student 4 photo null, reset row deleted).

## P0 security fixes (2026-11-04)
- **Password reset** (`auth.routes.js`, `auth/forgot-password.ejs`): `devCode` removed from the redirect and the view. Reset is disabled with a "contact the Dean" message when SMTP is not configured; a failed send invalidates the stored code. Verified: anonymous POST returns 200 with no code in the body or URL.
- **Uploads** (new `src/utils/image-upload.js`, `auth.routes.js`, `student.routes.js`, `staff-profile.routes.js`, `app.js`): in-memory upload, real magic-byte validation for JPEG/PNG/WebP, random filenames, old-file cleanup, 5MB limit. `/uploads` now requires a signed-in session. Verified: HTML bytes sent as `image/png` -> 400, real image -> random URL, delete removes the file, anonymous `/uploads/...` -> 403.
- **Sessions** (`auth.routes.js`, `authenticate.js`, `public/js/session-keepalive.js`, `layouts/main.ejs`): added `GET/POST /auth/refresh`, refresh cookie moved to `/`, `requireAuth` sends expired pages through refresh, refresh re-checks `users.is_active` and token type, 2FA temp tokens are rejected as access tokens, JWT startup fails without `JWT_ACCESS_SECRET`. Verified: no-access-cookie request -> `/auth/refresh?next=...` -> original page 200; keepalive POST -> `{"ok":true}`.
- **Dean authorization** (`dean.routes.js`): faculty toggle scoped with `facultyForDean`; grade batch requires enrollment + student to belong to the offering and active semester, max 200 rows; grade release is admin-only with semester/date validation; CSV import bounded in memory (2MB, 500 rows); section names restricted to `[A-Z0-9-]`. Verified: Crim dean toggling IT faculty -> 403, dean release -> 403, mismatched batch -> `saved: 0`, CSV -> parsed rows.
- **Hardening** (`app.js`, `admin.routes.js`): removed CORS, body parsing before limiters, new 20/15min limiter for forgot-password/register, configurable `TRUST_PROXY`, `Cache-Control: no-store` on dynamic responses, 400/413 for malformed or oversized JSON, admin password minimum raised to 8.
- **Demo credentials** (`seeds/seed.js`, new `seeds/rotate-demo-passwords.js`): seed refuses to run with `NODE_ENV=production` unless `FORCE_SEED=1`; demo passwords rotated in the live DB (shared with the user separately, not written to the repo). Old passwords now fail.
- **Verified**: all five doors log in, student/dean/admin/teacher dashboards 200, no server errors, old credentials rejected.

## LAN deployment prep (2026-11-04)
- **Cookie switch** (`auth.routes.js`): `cookieSecure()` now honours `COOKIE_SECURE=true|false`; defaults to Secure only in production. This lets a plain-HTTP LAN demo run with production settings without silently dropping login cookies.
- **Server lifecycle** (`app.js`): `HOST` env (default `0.0.0.0`), `/healthz` JSON + SQLite check, clean `SIGINT`/`SIGTERM` shutdown (closes SQLite, releases the port), startup error logging, friendlier banner listing local/bind/health URLs.
- **Backups** (`scripts/backup-db.js`, `npm run backup [folder]`): consistent `VACUUM INTO` copy of SQLite plus a manual recursive copy of `uploads/`. (Avoided `fs.cpSync`, which crashed Node on the OneDrive folder in testing.)
- **Docs/config**: `DEPLOYMENT.md` covers LAN setup, firewall rule, IP discovery, doors, PM2/NSSM, Task Scheduler backups, restore, public-hosting notes and troubleshooting. `.env.example` documents every variable. `package.json` gained `rotate-demo` and `backup` scripts.
- **Verified**: `/healthz` -> `{"status":"ok","db":"ok"}`; backup -> DB + uploads with exit 0; production + `COOKIE_SECURE=false` login sets cookies without `Secure` and with `Path=/`; main server still 200 after the test.



## SDLC documentation reframed as Agile (2026-11-04)
- `../STUDENT_PORTAL_PLAN.md`: added a full "Agile Delivery Plan (Scrum)" section (roles, ceremonies, artifacts, Definition of Done, sprint increments 0-6, review checklist) and replaced the old sequential "Implementation Phases". Footer is now a living backlog instead of "Plan Finalized".
- `../STUDENT_PORTAL_ANALYSIS.md`: added a Methodology note under the Executive Summary and replaced "Implementation Phases" with "Agile Delivery Approach (Scrum)" including a sprint table. Status is now a living analysis rather than "Ready for System Design".
- Both docs now describe iterative-incremental delivery, continuous security, and per-sprint re-prioritisation. No code changes; server untouched.

## Offline assets, smoke test, README (2026-11-04)
- **Offline front end**: added `scripts/vendor-assets.js` (Tailwind Play CDN 3.4.17 + 11 Inter/Playfair woff2 files). All 8 EJS heads now load `/js/tailwind.js`, `/css/fonts.css`; no page references `cdn.tailwindcss.com`, `fonts.googleapis.com`, or `cdn.jsdelivr.net`.
- **Login animation**: replaced the Motion CDN import with local `src/public/js/motion-lite.js` (small Web Animations wrapper supporting the x/y/rotate/scale/opacity usage).
- **CSP** (`app.js`): removed all CDN origins, added `object-src 'none'` and `base-uri 'self'`. Helmet's `upgrade-insecure-requests` is now disabled on plain HTTP so LAN assets are not rewritten to `https://`; enabled when `COOKIE_SECURE=true` or production HTTPS.
- **Smoke test** (`scripts/smoke.js`, `npm run smoke`): 24 live checks (health, local assets, CSP, anon upload 403, anon refresh 401, no reset code, student/dean/faculty/admin logins, role isolation, dean release 403, malformed JSON 400). Credentials come from `SMOKE_*` env vars; `SMOKE_PUBLIC=1` runs only public checks. Result: **24 passed, 0 failed**.
- **README.md**: setup, doors, scripts, smoke usage, offline/LAN notes, project structure, security summary, docs links, limitations.
- **Verified**: assets served with correct MIME types, no external references in rendered login/student/dean pages, CSP on HTTP has no `upgrade-insecure-requests`, no server errors. Server restarted and `/healthz` 200.

## Rich demo data + CSV grade templates (2026-11-07)
- **`seeds/demo-data.js`** (`npm run demo-data`): adds 20 BSIT students in sections A/B, six sections in each of three semesters (2024-2025 1st/2nd + active term), 378 enrollments and 300+ grades. The active term is partly graded so faculty grade entry has work to demo. Three students (Angela Mae Cruz, Daniel Louis Navarro, Bryan Christopher Pascual) have a GPA of 0.71, so the dean dashboard's "Students at Risk" panel is populated. Grade releases are added for every term so students can see a multi-semester transcript.
- **Idempotent**: every insert is keyed on a natural unique constraint; re-running adds nothing and never overwrites manually edited grades. Refuses production unless `FORCE_DEMO=1`.
- **`seeds/rotate-demo-passwords.js`** now also rotates the 20 demo section students, so the shared class password can be changed in one place.
- **CSV templates**: removed the `xlsx` dependency. `GET /faculty/grade-entry/:id/template` now returns `text/csv` with a UTF-8 BOM and RFC-4180 quoting; `POST /faculty/grades/import` uses a small local CSV parser (quoted fields, CRLF, BOM). Upload filter accepts `.csv` only. Faculty grade-entry UI says "Download CSV Template" / "Upload CSV" and documents the blank-row rule.
- **Dependencies**: removed unused `cors`, ran `npm audit fix`. `npm audit --omit=dev` now reports **0 vulnerabilities** (was 1 critical + 3 high + 3 moderate).
- **Smoke test**: 27 checks now, including CSV template download (correct content type + header) and rejection of a non-CSV upload. Result: **27 passed, 0 failed**.
- **Verified live**: Juan's grade page shows 2024-2025 and 2025-2026 semesters; dean dashboard lists the three at-risk students; faculty subjects list WS 201 / IT 204; CSV import updated a real grade (`2.25`, 2.75 points) with remarks; no server errors.

## Login password toggle + install-friendly DB path (2026-11-09)
- **Show/hide password** (`auth/login.ejs`): added an eye button inside the password field. It toggles `type="password"`/`type="text"`, swaps eye/eye-off icons, and updates `aria-label`, `aria-pressed` and `title` for screen readers. Works on every entrance because all portals share the same login view (`/login`, `/staff`, etc.). Verified in the browser: `password` -> `text` -> `password`, labels/icons update.
- **Absolute `DB_PATH`** (`src/config/database.js`): relative values still resolve inside `src/`, while absolute paths are now used as-is. An installed/LAN server can set e.g. `DB_PATH=C:\ProgramData\PCCPortal\data\pcc.db` so updates and reinstalls never overwrite the database. `npm run backup` follows the resolved path automatically.
- **Docs**: `.env.example` and `DEPLOYMENT.md` explain the persistent data folder and why browser `localStorage` is not suitable (per-browser, not shared between students/teachers/deans).
