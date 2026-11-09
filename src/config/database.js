const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { dbPath } = require('./paths');

const dbDirPath = path.dirname(dbPath);
if (!fs.existsSync(dbDirPath)) {
  fs.mkdirSync(dbDirPath, { recursive: true });
}

const db = new Database(dbPath);

// SQLite pragmas for performance and safety
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -20000');
db.pragma('temp_store = MEMORY');

// Run pending migrations (tracks applied files in schema_migrations)
const migrationsDir = path.join(__dirname, '..', '..', 'migrations');

if (fs.existsSync(migrationsDir)) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime(\'now\')))');
  const applied = new Set(
    db.prepare('SELECT filename FROM schema_migrations').all().map((r) => r.filename)
  );

  const runMigrations = db.transaction(() => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, datetime(\'now\'))').run(file);
      console.log(`✓ Applied migration: ${file}`);
    }
  });

  runMigrations();
}

module.exports = db;
