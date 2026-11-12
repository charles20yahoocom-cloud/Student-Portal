const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runPendingMigrations } = require('../src/config/migration-runner');

function tempMigrationsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pcc-migrations-'));
}

test('temporarily disables foreign key checks while applying migrations and rejects broken foreign keys afterward', () => {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY);');
  db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));');

  const migrationsDir = tempMigrationsDir();
  fs.writeFileSync(path.join(migrationsDir, '001_legacy.sql'), 'INSERT INTO child (id, parent_id) VALUES (1, 99);');

  assert.throws(() => runPendingMigrations(db, migrationsDir), /invalid foreign keys/i);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

  db.close();
});

test('keeps existing valid foreign keys intact when applying a clean migration set', () => {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY);');
  db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));');

  const migrationsDir = tempMigrationsDir();
  fs.writeFileSync(path.join(migrationsDir, '001_valid.sql'), 'INSERT INTO parent (id) VALUES (1);\nINSERT INTO child (id, parent_id) VALUES (1, 1);');

  assert.doesNotThrow(() => runPendingMigrations(db, migrationsDir));
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

  db.close();
});

test('student classification migration defaults existing students to regular and rejects invalid values', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE students (id INTEGER PRIMARY KEY); INSERT INTO students (id) VALUES (1);');

  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '012_student_classification.sql'),
    'utf8'
  );
  db.exec(migration);

  assert.equal(db.prepare('SELECT classification FROM students WHERE id = 1').get().classification, 'regular');
  assert.throws(
    () => db.prepare("UPDATE students SET classification = 'probation' WHERE id = 1").run(),
    /CHECK constraint failed/
  );

  db.close();
});
