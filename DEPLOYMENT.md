# PCC Student Portal - Deployment Guide

This guide covers the **LAN demo first** path, with notes for public hosting later.
Everything runs from the project root unless stated otherwise.

## Neon PostgreSQL on Render

The app continues to use SQLite for local development. When `DATABASE_URL` is
set, it uses Neon PostgreSQL for application reads and writes. Keep the Neon
connection string in Render's environment-variable dashboard as a secret; do
not commit it, put it in this guide, or share it in chat. The Render Blueprint
declares `DATABASE_URL` as a secret value that must be supplied in the dashboard.

On its first start against a truly empty PostgreSQL database, the app creates
the current schema and migration ledger atomically. The bootstrap creates all
tables first, then adds foreign keys so the existing users/departments
relationship is supported. Existing databases with tables but no migration
ledger are rejected rather than modified.

The app's Neon config also enables the branch-scoped AI Gateway. Its backend
client reads `NEON_AI_GATEWAY_BASE_URL` and `NEON_AI_GATEWAY_TOKEN`; the portal
does not currently expose an AI feature to students or staff. To verify both
Neon services after importing the database, run `npm run smoke:neon` with the
three variables available in the environment. The smoke check runs a read-only
PostgreSQL query and a short AI completion (which uses AI Gateway credits).
Copy the variables from the locally pulled environment into Render's
environment-variable dashboard; local `.env` files are not deployed to Render.

### Preserve and import existing records

Do not point the running service at a new, empty Neon database. First obtain a
verified, consistent SQLite backup of the current production database. A local
development database is not proof of the current production data. If the old
Render instance restarted without a disk, its previous ephemeral data may
already be unrecoverable; restore a known backup before continuing.

Create a new, empty Neon database, then set its connection string in the
environment of the machine doing the import (not in command arguments or source
files). Run the import against the verified SQLite backup:

```powershell
$env:DATABASE_URL = Read-Host "Neon PostgreSQL connection string"
npm run migrate:postgres -- "C:\path\to\verified-production-backup.db"
Remove-Item Env:DATABASE_URL
```

The importer refuses to proceed if the SQLite integrity/foreign-key checks fail,
the source migrations are incomplete, or the Neon database already contains
tables. It creates the schema from the backed-up database, copies all tables
and indexes in foreign-key order, preserves IDs, resets identity sequences, and
checks the row count of every imported table before committing. A failed import
rolls back; it does not merge or overwrite a non-empty Neon database.

Only after the import succeeds, set `DATABASE_URL` as a secret on the Render
service and deploy. Set `NEON_AI_GATEWAY_BASE_URL` and
`NEON_AI_GATEWAY_TOKEN` there as well if the app will use the gateway. Startup
verifies the imported schema and refuses to serve traffic if required
PostgreSQL migrations are missing. Future schema changes need a matching SQL
migration under `migrations/postgres/`.

Profile photos are files, not database rows. The Blueprint currently writes
them under Render's application filesystem, which is ephemeral; they can be
lost on deploy/restart. Use a persistent disk or object-storage integration if
those files must survive. This does not affect the student/account/grade data
stored in Neon.

## 1. What you need

- Node.js 20 or newer (the app uses `fs.cpSync` and modern SQLite bindings).
- A Windows PC that will stay on during the demo.
- The project folder, including `migrations/`, `seeds/`, `src/`, and `uploads/`.
- A stable LAN IP for the demo PC (DHCP reservation recommended).

## 2. First-time setup

```powershell
cd "C:\path\to\pcc-student-portal"
npm install
Copy-Item .env.example .env
```

Open `.env` and set:

- `PORT=3005`
- `HOST=0.0.0.0` (listen on the LAN, not just localhost)
- `NODE_ENV=development` for the LAN demo
- `DB_PATH=./database/pcc.db` (resolved inside `src/`, so the real file is `src/database/pcc.db`)
  - **Installed/LAN server:** point this at an absolute path outside the app folder,
    e.g. `DB_PATH=C:\ProgramData\PCCPortal\data\pcc.db`. The portal is a SQLite
    app, so the database is a single local file on the *host* PC; it survives
    updates and reinstalls as long as it lives outside the project directory.
    Back it up with `npm run backup`. Browser `localStorage` is **not** suitable:
    it is per-browser and would give every student, teacher, and dean a different
    disconnected copy of the data.
  - With `NODE_ENV=production` and no `DB_PATH`, the app defaults to
    `%ProgramData%\PCCPortal\data\pcc.db` automatically. If it finds an older
    in-project database and the ProgramData file does not exist yet, it keeps
    using the old one and prints a warning so no data is silently orphaned.
- `UPLOAD_DIR=./uploads` (profile photos). Installed servers can point this at
  `C:\ProgramData\PCCPortal\data\uploads`, or leave it unset in production to get
  that path automatically. `npm run backup` copies the resolved folder.
- Three different random secrets. Generate them with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `src/app.js` refuses to start if `JWT_ACCESS_SECRET` is missing. Do not keep the
> placeholder values from `.env.example`.

### Persistent data folder for installed copies

On a fresh install you can let the defaults do the work, or run:

```powershell
npm run setup-data                 # creates C:\ProgramData\PCCPortal\data and prints the .env lines
npm run setup-data -- --migrate    # also copies the current DB + uploads (stop the server first)
```

Add the printed `DB_PATH` and `UPLOAD_DIR` lines to `.env`, then start the portal.
Keep that folder out of the app directory so replacing the app never deletes data.

### Plain HTTP on the LAN

Cookies are `Secure` automatically when `NODE_ENV=production`. If you run the
LAN demo on plain HTTP with production settings, login will appear to succeed but
the browser will discard the cookies. Pick one:

- keep `NODE_ENV=development` for the LAN demo, or
- keep `NODE_ENV=production` and add `COOKIE_SECURE=false`.

Never use `COOKIE_SECURE=false` on a public site.

## 3. Database and demo accounts

The database is created and migrated automatically on first start. To create a
fresh development database:

```powershell
npm run seed
```

The seed refuses to run when `NODE_ENV=production` unless you explicitly set
`FORCE_SEED=1`. Do not run it against real data.

Rotate the well-known demo passwords before letting anyone else log in:

```powershell
npm run rotate-demo
```

It prints the new passwords once; share them only with the people who need them.
It only touches the known demo emails, never real accounts.

## 4. Start the server

```powershell
npm start
```

You should see:

```text
  PCC Student Portal - Passi City College
  ---------------------------------------
  Local:    http://localhost:3005
  Bind:     0.0.0.0:3005
  Health:   http://localhost:3005/healthz
```

Check it locally:

```powershell
curl.exe http://localhost:3005/healthz
```

Expected: `{"status":"ok","db":"ok","uptime":...}`.

## 5. Open it to the LAN

1. Find the PC's LAN address:

```powershell
ipconfig
```

Look for the IPv4 address on the school network (for example `192.168.1.50`).

2. Allow inbound TCP 3005 on the **Private** network profile:

```powershell
New-NetFirewallRule -DisplayName "PCC Portal 3005" `
  -Direction Inbound -Protocol TCP -LocalPort 3005 `
  -Action Allow -Profile Private
```

3. From another device on the same network, open:

```text
http://192.168.1.50:3005
```

If it does not load, confirm both devices are on the same subnet, the firewall
rule is enabled, and the server is still running.

### Doors (separate sessions)

| Portal | URL |
|--------|-----|
| Students | `http://<LAN-IP>:3005/login` |
| Instructors | `http://<LAN-IP>:3005/instructor` |
| Dean / Admin | `http://<LAN-IP>:3005/dean` |
| Shared staff door | `http://<LAN-IP>:3005/staff` |

The three portals use separate cookies, so a student, a teacher, and a dean can
stay signed in side by side in the same browser.

## 6. Keep it running

`npm start` stops when the terminal closes. For a demo, use one of:

**PM2 (simple)**

```powershell
npm install -g pm2
pm2 start src/app.js --name pcc-portal
pm2 save
pm2 startup
```

**NSSM (Windows service)**

```powershell
nssm install PCCPortal "C:\Program Files\nodejs\node.exe" "src/app.js"
nssm set PCCPortal AppDirectory "C:\path\to\pcc-student-portal"
nssm start PCCPortal
```

The server handles `SIGINT`/`SIGTERM` and closes SQLite cleanly, and exposes
`/healthz` for a monitor or process manager.

## 7. Backups

Run a backup before any demo or data change:

```powershell
npm run backup
```

It writes a consistent SQLite copy plus the uploaded profile photos to
`backups/`. To choose another drive:

```powershell
npm run backup D:\PCC-Backups
```

Schedule it daily with Task Scheduler (action: `npm run backup`, start in the
project folder). Keep copies off the demo PC.

### Restore

1. Stop the server.
2. Copy the chosen `backups/pcc-*.db` over `src/database/pcc.db`.
3. Copy `backups/uploads-*/` over the `uploads/` folder if you also need photos.
4. Start the server again.

## 8. Before public hosting (later)

- Put the app behind HTTPS. Caddy, IIS with ARR, or nginx all work.
- Set `NODE_ENV=production`, `COOKIE_SECURE=true`, and `TRUST_PROXY` to the
  correct number of proxy hops.
- Expose only 443/80 publicly; keep 3005 bound to localhost or the proxy.
- Set up SMTP so password reset works (otherwise it intentionally disables
  itself with a "contact the Dean" message).
- Move backups off the server, test a restore, and add uptime monitoring for
  `/healthz`.
- Run `npm audit` and plan the `xlsx` replacement; see `../PCC_PORTAL_AUDIT.md`.
- Re-run `npm run rotate-demo` if the demo database is reused.

## 9. Troubleshooting

| Symptom | Check |
|---------|-------|
| Login bounces back to the form | `NODE_ENV=production` on plain HTTP, or a stale `.env`; set `COOKIE_SECURE=false` for LAN HTTP |
| Other devices cannot connect | Firewall rule, `HOST=0.0.0.0`, same subnet, correct IP |
| "JWT_ACCESS_SECRET is required" | Copy `.env.example` to `.env` and fill in the secrets |
| Password reset says "not available" | SMTP is not configured; that is intentional |
| Uploaded photo returns 403 | You are signed out; uploads are private now |
| `EADDRINUSE` on start | Another copy is already running on port 3005 |
| Database locked | Too many server instances; run one process and use `busy_timeout` (already enabled) |
