// Central on-disk locations for data that must survive an app update.
//
// Development keeps everything inside the project folder (src/database/pcc.db
// and ./uploads). An installed production copy defaults to a persistent folder
// under ProgramData (Windows) so replacing the app does not erase data.
//
// Both can be overridden explicitly:
//   DB_PATH    absolute path, or relative to src/ (legacy behaviour)
//   UPLOAD_DIR absolute path, or relative to the project folder
const path = require('path');
const os = require('os');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..', '..');
const srcDir = path.join(__dirname, '..');
const isProduction = process.env.NODE_ENV === 'production';

function defaultInstallDataDir() {
  if (process.platform === 'win32') {
    const programData = process.env.ProgramData || path.join(process.env.SystemDrive || 'C:', 'ProgramData');
    return path.join(programData, 'PCCPortal', 'data');
  }
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'pcc-portal');
}

function resolveFromProject(value) {
  return path.isAbsolute(value) ? value : path.join(projectRoot, value);
}

function resolveFromSrc(value) {
  return path.isAbsolute(value) ? value : path.join(srcDir, value);
}

function hasFiles(dir) {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch (err) {
    return false;
  }
}

// Database ---------------------------------------------------------------
const legacyDbPath = path.join(srcDir, 'database', 'pcc.db');
const installDbPath = path.join(defaultInstallDataDir(), 'pcc.db');

let dbPath;
if (process.env.DB_PATH) {
  dbPath = resolveFromSrc(process.env.DB_PATH);
} else if (isProduction) {
  // If a production install is upgraded from the old in-project layout, keep
  // using its existing database instead of silently starting with an empty one.
  const keepLegacy = !fs.existsSync(installDbPath) && fs.existsSync(legacyDbPath);
  dbPath = keepLegacy ? legacyDbPath : installDbPath;
  if (keepLegacy) {
    console.warn(`[config] Using existing database: ${legacyDbPath}`);
    console.warn(`[config] Set DB_PATH to migrate it to ${installDbPath} when convenient.`);
  }
} else {
  dbPath = legacyDbPath;
}

// Uploads ----------------------------------------------------------------
const legacyUploadsDir = path.join(projectRoot, 'uploads');
const installUploadsDir = path.join(defaultInstallDataDir(), 'uploads');

let uploadsDir;
if (process.env.UPLOAD_DIR) {
  uploadsDir = resolveFromProject(process.env.UPLOAD_DIR);
} else if (isProduction) {
  const keepLegacy = !hasFiles(installUploadsDir) && hasFiles(legacyUploadsDir);
  uploadsDir = keepLegacy ? legacyUploadsDir : installUploadsDir;
} else {
  uploadsDir = legacyUploadsDir;
}

module.exports = {
  projectRoot,
  isProduction,
  dbPath,
  uploadsDir,
  profileDir: path.join(uploadsDir, 'profiles'),
  defaultInstallDataDir,
};
