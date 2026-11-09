const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { dbPath, uploadsDir, isRender, legacyDbPaths, legacyUploadsDirs, renderDataDir } = require('./paths');

if (isRender && !fs.existsSync(renderDataDir)) {
  throw new Error(`Render persistent disk is not mounted at ${renderDataDir}; refusing to create ephemeral app data.`);
}

const dbDirPath = path.dirname(dbPath);
if (isRender && !fs.existsSync(dbDirPath)) {
  throw new Error(`Render persistent disk is not mounted at ${dbDirPath}; refusing to create an ephemeral database.`);
}
if (!fs.existsSync(dbDirPath)) {
  fs.mkdirSync(dbDirPath, { recursive: true });
}

if (isRender && !fs.existsSync(dbPath)) {
  const legacyDbPath = legacyDbPaths.find((candidate) => fs.existsSync(candidate));
  if (legacyDbPath) {
    const source = new Database(legacyDbPath, { readonly: true, fileMustExist: true });
    try {
      source.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);
      console.log(`[database] Migrated existing database to the Render persistent disk: ${dbPath}`);
    } finally {
      source.close();
    }
  } else {
    console.warn(`[database] No previous database found to migrate; a new database will be created at ${dbPath}.`);
  }
}

if (isRender && !fs.existsSync(uploadsDir)) {
  const legacyUploadsDir = legacyUploadsDirs.find((candidate) => fs.existsSync(candidate));
  if (legacyUploadsDir) {
    fs.cpSync(legacyUploadsDir, uploadsDir, { recursive: true, errorOnExist: false, force: false });
    console.log(`[database] Migrated existing uploads to the Render persistent disk: ${uploadsDir}`);
  }
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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
