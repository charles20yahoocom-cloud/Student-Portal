# Render Deploy Fix

Status as of the last check:

- Live URL: <https://student-portal-a3w0.onrender.com>
- Dashboard: <https://dashboard.render.com/web/srv-dbor459srm7s73crvrt0>
- `/healthz` returns **503** because the service crashes on boot with:

```
Error: JWT_ACCESS_SECRET is required. Refusing to start with a predictable fallback secret.
```

That error is **not a code bug**. `src/middleware/authenticate.js` refuses to
start with a guessable JWT secret, so the three secrets must exist in the Render
dashboard before the app will boot.

The GitHub repo is up to date and already supports Neon Postgres
(`DATABASE_URL` -> `src/config/database-postgres.js`). Only `render.yaml` is
missing the generated secrets, and the Render dashboard is missing the env vars.

---

## 1. Render -> Environment tab

Service -> **Environment** -> add each row.

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `TRUST_PROXY` | `1` |
| `JWT_ACCESS_SECRET` | `a289686efa7ecbba4e0fefb67c4c1e68cc63a06cacca98aaff28d9a538e257c334635709302d2babeca477f09c29c9b3` |
| `JWT_REFRESH_SECRET` | `da0ba4dacecddfd46c3d1fb151b96da9c2d70020857c03ed4a3da8f95f9f44fd327108fa40ccd65cb601dba4a8c63d4c` |
| `SESSION_SECRET` | `2f691f2fed4cbba7c7d2b6b9c880c1990fb7347aa1aa34706ca45c7107a2bf58f2d0b067bbf7559e182d9bb164818ca9` |
| `DATABASE_URL` | Neon pooled connection string, e.g. `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require` |

Rules:

- **Do not set `PORT`** — Render injects it (usually `10000`). Setting it yourself
  breaks the health check.
- **Do not set `COOKIE_SECURE=false`** on Render. Render is HTTPS, so the
  production default (`Secure` cookies) is correct.
- The three secrets must all be **different** from each other.
- Optional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` for
  password-reset email. Without them password reset is disabled on purpose.
- Optional: `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN` if the AI gateway
  feature is used.

Generate fresh secrets at any time with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run it three times and paste one value per secret.

### Why `DATABASE_URL` matters

The app has two database modes:

| `DATABASE_URL` | Storage | Works on Render? |
|---|---|---|
| set | Neon Postgres | Yes |
| unset | SQLite file | Only with a paid persistent disk mounted at `/opt/render/project/pcc-data` |

With no `DATABASE_URL` and no disk, startup stops with:

```
Render persistent disk is not mounted at /opt/render/project/pcc-data;
refusing to create an ephemeral database.
```

That guard is intentional: on Render's ephemeral filesystem an unpersisted SQLite
file is wiped on every deploy, so students, grades, and accounts would silently
disappear. Either connect Neon (recommended, free) or attach a disk and set:

```
DB_PATH=/opt/render/project/pcc-data/pcc.db
UPLOAD_DIR=/opt/render/project/pcc-data/uploads
```

Note that without a disk, profile photos uploaded to `/opt/render/project/src/uploads`
are lost on each redeploy even when Postgres holds the data.

---

## 2. GitHub -> replace `render.yaml`

Open <https://github.com/charles20yahoocom-cloud/Student-Portal/edit/main/render.yaml>,
select everything, paste the block below, then **Commit changes**.

```yaml
# Render Blueprint for the PCC Student Portal.
# The three session secrets are generated automatically on blueprint sync.
# DATABASE_URL must be set in the Render Dashboard (Neon connection string).
services:
  - type: web
    name: pcc-student-portal
    runtime: node
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /healthz
    envVars:
      - key: NODE_ENV
        value: production
      - key: HOST
        value: 0.0.0.0
      - key: TRUST_PROXY
        value: "1"
      - key: JWT_ACCESS_SECRET
        generateValue: true
      - key: JWT_REFRESH_SECRET
        generateValue: true
      - key: SESSION_SECRET
        generateValue: true
      - key: DATABASE_URL
        sync: false
      - key: NEON_AI_GATEWAY_BASE_URL
        sync: false
      - key: NEON_AI_GATEWAY_TOKEN
        sync: false
      - key: UPLOAD_DIR
        value: /opt/render/project/src/uploads
```

What changed and why:

| Change | Reason |
|---|---|
| `generateValue: true` on the three secrets | Render creates strong secrets on first blueprint sync instead of leaving them unset |
| `TRUST_PROXY: "1"` (was `loopback`) | Render terminates TLS at exactly one proxy hop; `loopback` makes Express ignore `X-Forwarded-*` |
| `npm ci && npm run build` | `npm run build` syntax-checks every JS file and compiles every EJS template before the deploy goes live |
| `DATABASE_URL`, gateway keys | `sync: false` means "ask for the value in the dashboard", never commit real credentials |

The existing Render service was created manually (the deploy log shows
`npm install`, not `npm ci`), so this file documents the intended config but does
**not** reconfigure the running service. The dashboard values from step 1 are what
actually fix the crash. Use **New -> Blueprint** if you want Render to manage the
service from this file.

---

## 3. First successful deploy

The Postgres schema is created automatically on boot, but the tables start empty.
Open Render -> **Shell** and run once:

```bash
npm run migrate:postgres
```

That copies the demo data from the committed SQLite file (users, courses,
enrollments, grades) into Neon. Without it the login page renders but every
attempt says *Invalid email or password*.

Do **not** run `npm run seed` in production — it is blocked unless `FORCE_SEED=1`,
because it would reset real data.

---

## 4. Stop publishing the database and a student photo

`.gitignore` lists them, but they were committed before those rules existed, so
they are still tracked in the public repo:

- `src/database/pcc.db` — password hashes and student records
- `src/database/pcc.db-wal` — same data, write-ahead log
- `src/database/pcc.db-shm`
- `uploads/profiles/student-18.jpg` — a real student photo

Remove them from tracking without deleting your local copies:

```bash
git rm --cached src/database/pcc.db src/database/pcc.db-wal src/database/pcc.db-shm uploads/profiles/student-18.jpg
git commit -m "Stop tracking local database and student uploads"
git push
```

Or delete each file through its GitHub page (trash icon -> commit). The demo
passwords that were publicly visible in `PROGRESS.md` should be rotated too, with
`npm run rotate-demo` aimed at the Neon database.

---

## 5. Verify the deploy

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://student-portal-a3w0.onrender.com/healthz
```

Expected: `200` with body `{"status":"ok","db":"ok",...}`. Then check, in order:

1. `/login` renders with its own CSS (no console errors about blocked assets).
2. Student login: `juan.delacruz@pcc.edu.ph` / `PccStudent#2026`
3. Dean login: `dean.it@pcc.edu.ph` / `PccDean#2026`
4. Faculty login: `teacher.john@pcc.edu.ph` / `PccTeacher#2026`
5. Admin login: `admin@pcc.edu.ph` / `PccAdmin#2026`
6. `/student/prospectus` -> Download PDF and Print both work.

If logins fail after a successful boot, `npm run migrate:postgres` (step 3) is
almost always the missing piece.

---

## Troubleshooting matrix

| Symptom | Cause | Fix |
|---|---|---|
| `JWT_ACCESS_SECRET is required` | secret missing in dashboard | step 1 |
| `Render persistent disk is not mounted` | no `DATABASE_URL`, no disk | set `DATABASE_URL`, or attach a disk + `DB_PATH` |
| `PostgreSQL database has tables but no schema_migrations` | leftover/foreign schema in Neon | point `DATABASE_URL` at a new empty Neon branch, then redeploy |
| 503 on `/healthz` while logs look fine | `PORT` was set manually | delete the `PORT` variable |
| Login succeeds, then immediately logs out | `COOKIE_SECURE` mismatch or `TRUST_PROXY` wrong | remove `COOKIE_SECURE`, set `TRUST_PROXY=1` |
| Login page unstyled | static assets blocked | check `NODE_ENV=production` and that Helmet is not adding `upgrade-insecure-requests` on plain HTTP (LAN only) |
| `Invalid email or password` for every account | empty database | step 3 |
| Photos vanish after redeploy | uploads live on ephemeral disk | attach a disk and set `UPLOAD_DIR` |

---

## Local development is unaffected

On your PC (`NODE_ENV=development`) the app still uses `src/database/pcc.db` and
`./uploads`, and still runs at <http://localhost:3005>. Nothing in this document
changes the local demo. For an installed server copy, keep data outside the app
folder:

```powershell
npm run setup-data -- --migrate
```

Then put the printed `DB_PATH` and `UPLOAD_DIR` lines into `.env`.
