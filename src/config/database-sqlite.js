const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runPendingMigrations } = require('./migration-runner');
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
runPendingMigrations(db, migrationsDir);

module.exports = db;
