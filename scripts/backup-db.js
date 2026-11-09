// Create a consistent SQLite backup plus a copy of uploaded profile photos.
// Usage:
//   node scripts/backup-db.js
//   node scripts/backup-db.js D:\Backups\pcc
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const db = require('../src/config/database');
const { uploadsDir } = require('../src/config/paths');

// Manual recursive copy: fs.cpSync crashed Node on the OneDrive-hosted project
// folder in testing, so walk the tree ourselves.
function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

async function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'backups');

  fs.mkdirSync(dir, { recursive: true });

  const dbSource = path.resolve(db.name);
  const dbDest = path.join(dir, `pcc-${stamp}.db`);

  // VACUUM INTO produces a consistent copy without blocking readers and avoids
  // a native crash seen with better-sqlite3's async backup on Windows.
  db.exec(`VACUUM INTO '${dbDest.replace(/'/g, "''")}'`);

  const uploadsSource = uploadsDir;
  let uploadsDest = null;
  if (fs.existsSync(uploadsSource)) {
    uploadsDest = path.join(dir, `uploads-${stamp}`);
    copyDir(uploadsSource, uploadsDest);
  }

  const size = (fs.statSync(dbDest).size / 1024).toFixed(1);
  console.log(`Database: ${dbSource}`);
  console.log(`Backup:   ${dbDest} (${size} KB)`);
  if (uploadsDest) console.log(`Uploads:  ${uploadsDest}`);

  db.close();
}

backup().catch((err) => {
  console.error('Backup failed:', err);
  try { db.close(); } catch (e) { /* ignore */ }
  process.exit(1);
});
