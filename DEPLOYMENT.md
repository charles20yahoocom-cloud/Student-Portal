# PCC Student Portal - Deployment Guide

This guide covers the **LAN demo first** path, with notes for public hosting later.
Everything runs from the project root unless stated otherwise.

## Render database persistence

Student, instructor, dean, and admin records are stored together in the server's
SQLite database, not in browser storage. On Render, the database and uploaded
profile photos must live under the persistent disk mount. Configure the service
disk to mount at `/opt/render/project/pcc-data` and set:

```text
PCC_DATA_DIR=/opt/render/project/pcc-data
DB_PATH=/opt/render/project/pcc-data/pcc.db
UPLOAD_DIR=/opt/render/project/pcc-data/uploads
```

The app detects the previous relative `DB_PATH` setting and makes a consistent
SQLite snapshot onto the persistent disk on startup if the destination database
does not exist. It refuses to start if the configured Render disk mount is
missing rather than silently creating another temporary database. Keep the
persistent disk attached and back up the SQLite file regularly.

If Render has already discarded the old temporary database during a restart or
deployment, it cannot be recovered from the new empty database; restore a
backup before directing the service at it.

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
