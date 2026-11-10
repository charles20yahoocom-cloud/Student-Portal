const fs = require('fs');
const path = require('path');

function runPendingMigrations(db, migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime(\'now\')))');

  const applied = new Set(
    db.prepare('SELECT filename FROM schema_migrations').all().map((row) => row.filename)
  );

  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (!files.length) {
    return;
  }

  const previousForeignKeys = db.pragma('foreign_keys');
  db.pragma('foreign_keys = OFF');

  try {
    const applyMigrations = db.transaction(() => {
      for (const file of files) {
        if (applied.has(file)) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, datetime(\'now\'))').run(file);
        console.log(`✓ Applied migration: ${file}`);
      }
    });

    applyMigrations();
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }

  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    const detail = violations.map((row) => {
      const [table, rowid, parent, fk] = Object.values(row);
      return `${table} row ${rowid} references missing ${parent}.${fk}`;
    }).join('; ');

    throw new Error(`Database migration left invalid foreign keys: ${detail}`);
  }
}

module.exports = { runPendingMigrations };
