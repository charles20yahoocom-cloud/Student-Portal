require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const {
  postgresForeignKeyStatements,
  toPostgresSchemaSql,
  withoutPostgresForeignKeys
} = require('../src/config/sql-compat');

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function orderedTables(source, tables) {
  const names = new Set(tables.map((table) => table.name));
  const dependencies = new Map(tables.map((table) => [
    table.name,
    new Set(source.pragma(`foreign_key_list(${quoteIdentifier(table.name)})`)
      .map((foreignKey) => foreignKey.table)
      .filter((name) => names.has(name)))
  ]));
  const ordered = [];
  const remaining = new Set(names);

  while (remaining.size) {
    const ready = [...remaining].filter((name) =>
      [...dependencies.get(name)].every((dependency) => !remaining.has(dependency))
    );
    if (!ready.length) throw new Error('SQLite schema has cyclic foreign-key dependencies.');
    ready.forEach((name) => {
      remaining.delete(name);
      ordered.push(tables.find((table) => table.name === name));
    });
  }
  return ordered;
}

function assertMigratedSource(source) {
  const integrity = source.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);

  const violations = source.pragma('foreign_key_check');
  if (violations.length) {
    throw new Error(`SQLite has ${violations.length} foreign-key violations; refusing to import.`);
  }

  const applied = new Set(source.prepare('SELECT filename FROM schema_migrations').all().map((row) => row.filename));
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const required = fs.readdirSync(migrationsDir).filter((filename) => filename.endsWith('.sql'));
  const missing = required.filter((filename) => !applied.has(filename));
  if (missing.length) {
    throw new Error(`SQLite source is missing migrations: ${missing.join(', ')}`);
  }
}

async function importDatabase(sourcePath, databaseUrl) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({
    connectionString: databaseUrl,
    ...(new URL(databaseUrl).hostname.endsWith('.neon.tech')
      ? { ssl: { rejectUnauthorized: true } }
      : {}),
    max: 1,
    connectionTimeoutMillis: 10000,
    application_name: 'pcc-student-portal-data-import'
  });
  let client;

  try {
    assertMigratedSource(source);

    const existing = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    if (existing.rowCount) {
      throw new Error(
        `Neon database is not empty (${existing.rows.map((row) => row.table_name).join(', ')}); refusing to overwrite or merge data.`
      );
    }

    const tables = source.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY rowid
    `).all();
    const unsupported = source.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE type IN ('view', 'trigger')
    `).all();
    if (unsupported.length) {
      throw new Error(`Source contains unsupported schema objects: ${unsupported.map((row) => row.name).join(', ')}`);
    }

    const indexes = source.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'index' AND sql IS NOT NULL
      ORDER BY rowid
    `).all();

    client = await pool.connect();
    await client.query('BEGIN');

    for (const table of tables) {
      const ddl = toPostgresSchemaSql(withoutPostgresForeignKeys(table.sql));
      if (/\bAUTOINCREMENT\b|\bdatetime\s*\(/i.test(ddl)) {
        throw new Error(`Could not safely translate SQLite schema for ${table.name}.`);
      }
      await client.query(ddl);
    }

    const counts = [];
    for (const table of tables) {
      const columns = source.pragma(`table_info(${quoteIdentifier(table.name)})`).map((column) => column.name);
      const rows = source.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).iterate();
      const columnList = columns.map(quoteIdentifier).join(', ');
      const rowWidth = columns.length;
      const batchSize = Math.max(1, Math.floor(60000 / rowWidth));
      let batch = [];
      let count = 0;

      async function flush() {
        if (!batch.length) return;
        const values = [];
        const tuples = batch.map((row, rowIndex) => {
          const placeholders = columns.map((_column, columnIndex) => {
            values.push(row[columns[columnIndex]]);
            return `$${rowIndex * rowWidth + columnIndex + 1}`;
          });
          return `(${placeholders.join(', ')})`;
        });
        await client.query(
          `INSERT INTO ${quoteIdentifier(table.name)} (${columnList}) VALUES ${tuples.join(', ')}`,
          values
        );
        batch = [];
      }

      for (const row of rows) {
        batch.push(row);
        count++;
        if (batch.length >= batchSize) await flush();
      }
      await flush();
      counts.push({ table: table.name, count });

      const idColumn = source.pragma(`table_info(${quoteIdentifier(table.name)})`)
        .find((column) => column.name === 'id' && column.pk === 1);
      if (idColumn && /\bid\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/i.test(table.sql)) {
        const max = await client.query(`SELECT MAX(id) AS max_id FROM ${quoteIdentifier(table.name)}`);
        if (max.rows[0].max_id !== null) {
          const sequence = await client.query('SELECT pg_get_serial_sequence($1, $2) AS name', [
            `public.${table.name}`,
            'id'
          ]);
          if (!sequence.rows[0].name) throw new Error(`Could not resolve identity sequence for ${table.name}.`);
          await client.query('SELECT setval($1, $2, true)', [sequence.rows[0].name, max.rows[0].max_id]);
        }
      }
    }

    for (const table of tables) {
      for (const statement of postgresForeignKeyStatements(source, table)) {
        await client.query(statement);
      }
    }

    for (const index of indexes) {
      const ddl = toPostgresSchemaSql(index.sql);
      await client.query(ddl);
    }

    for (const { table, count } of counts) {
      const result = await client.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
      if (Number(result.rows[0].count) !== count) {
        throw new Error(`Row count mismatch for ${table}: SQLite=${count}, PostgreSQL=${result.rows[0].count}`);
      }
    }

    await client.query('COMMIT');
    return counts;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Import rollback failed:', rollbackError.message);
      }
    }
    throw error;
  } finally {
    if (client) client.release();
    source.close();
    await pool.end();
  }
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    throw new Error('Usage: npm run migrate:postgres -- <verified-sqlite-backup.db>');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL in the environment to the empty Neon database. Do not pass credentials as command-line arguments.');
  }

  const counts = await importDatabase(path.resolve(sourcePath), process.env.DATABASE_URL);
  console.log(`Imported ${counts.reduce((sum, table) => sum + table.count, 0)} rows across ${counts.length} tables.`);
  for (const table of counts) console.log(`${table.table}: ${table.count}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('PostgreSQL import failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { assertMigratedSource, importDatabase, orderedTables };
