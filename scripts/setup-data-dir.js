// Prepare the persistent data folder used by an installed copy.
//
//   npm run setup-data             create the folder and print the .env lines
//   npm run setup-data -- --migrate copy the current DB + uploads into it
//
// Stop the portal before migrating so the SQLite file is not copied mid-write.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { dbPath, uploadsDir, defaultInstallDataDir } = require('../src/config/paths');

const dataDir = process.env.PCC_DATA_DIR
  ? path.resolve(process.env.PCC_DATA_DIR)
  : defaultInstallDataDir();
const targetDb = path.join(dataDir, 'pcc.db');
const targetUploads = path.join(dataDir, 'uploads');
const migrate = process.argv.includes('--migrate');

function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(targetUploads, { recursive: true });

let copiedDb = false;
let copiedUploads = false;

if (migrate) {
  if (fs.existsSync(dbPath) && path.resolve(dbPath) !== path.resolve(targetDb) && !fs.existsSync(targetDb)) {
    fs.copyFileSync(dbPath, targetDb);
    copiedDb = true;
  }
  if (fs.existsSync(uploadsDir) && path.resolve(uploadsDir) !== path.resolve(targetUploads)) {
    copyDir(uploadsDir, targetUploads);
    copiedUploads = true;
  }
}

console.log(`Data folder: ${dataDir}`);
console.log(`Database:    ${targetDb}${copiedDb ? ' (copied)' : ''}`);
console.log(`Uploads:     ${targetUploads}${copiedUploads ? ' (copied)' : ''}`);
console.log('');
console.log('Add these lines to .env, then restart the portal:');
console.log(`DB_PATH=${targetDb}`);
console.log(`UPLOAD_DIR=${targetUploads}`);
if (migrate) {
  console.log('');
  console.log('Migration copies only; the old files are still in place. Delete them');
  console.log('after the portal starts cleanly with the new paths.');
}
