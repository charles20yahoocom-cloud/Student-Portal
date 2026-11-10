const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runPendingMigrations } = require('../src/config/migration-runner');
const {
  postgresForeignKeyStatements,
  toPostgresSchemaSql,
  withoutPostgresForeignKeys
} = require('../src/config/sql-compat');

const root = path.join(__dirname, '..');
const sqlite = new Database(':memory:');

try {
  sqlite.pragma('foreign_keys = ON');
  runPendingMigrations(sqlite, path.join(root, 'migrations'));

  const tables = sqlite.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'
    ORDER BY rowid
  `).all();
  const indexes = sqlite.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'index' AND sql IS NOT NULL
    ORDER BY rowid
  `).all();

  const statements = tables.map((table) =>
    toPostgresSchemaSql(withoutPostgresForeignKeys(table.sql))
  );
  statements.push(...tables.flatMap((table) => postgresForeignKeyStatements(sqlite, table)));
  statements.push(...indexes.map((index) => toPostgresSchemaSql(index.sql)));

  const output = path.join(root, 'migrations', 'postgres', 'bootstrap.sql');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${statements.join(';\n\n')};\n`);
  console.log(`Generated ${path.relative(root, output)} from ${tables.length} tables and ${indexes.length} indexes.`);
} finally {
  sqlite.close();
}
