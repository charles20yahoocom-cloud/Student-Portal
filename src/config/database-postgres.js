const { AsyncLocalStorage } = require('async_hooks');
const { Pool, types } = require('pg');
const { toPostgresSql } = require('./sql-compat');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL mode.');
}

const parsedUrl = new URL(databaseUrl);
const isNeon = /\.(?:neon\.tech|neon\.database)$/i.test(parsedUrl.hostname);
if (isNeon) {
  const url = parsedUrl;
  url.searchParams.delete('sslmode');
  url.searchParams.delete('ssl');
  url.searchParams.delete('uselibpqcompat');
}
const connectionString = parsedUrl.toString();

types.setTypeParser(20, (value) => Number(value));

const pool = new Pool({
  connectionString,
  ...(isNeon ? { ssl: { rejectUnauthorized: true } } : {}),
  max: Number.parseInt(process.env.PG_POOL_MAX || '5', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  application_name: 'pcc-student-portal'
});
const transactionContext = new AsyncLocalStorage();

function appendReturningId(sql) {
  if (!/^\s*INSERT\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return sql;
  return sql.replace(/;\s*$/, '') + ' RETURNING id';
}

async function execute(sql, params = [], mode = 'all') {
  const query = toPostgresSql(sql);
  const normalized = mode === 'run' ? appendReturningId(query) : query;
  const context = transactionContext.getStore();
  const result = await (context ? context.query(normalized, params) : pool.query(normalized, params));

  if (mode === 'get') return result.rows[0];
  if (mode === 'all') return result.rows;
  return {
    changes: result.rowCount,
    lastInsertRowid: result.rows[0] ? result.rows[0].id : undefined
  };
}

const db = {
  isPostgres: true,

  prepare(sql) {
    return {
      get: (...params) => execute(sql, params, 'get'),
      all: (...params) => execute(sql, params, 'all'),
      run: (...params) => execute(sql, params, 'run')
    };
  },

  transaction(callback) {
    return async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await transactionContext.run(client, callback);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('PostgreSQL rollback failed:', rollbackError.message);
        }
        throw error;
      } finally {
        client.release();
      }
    };
  },

  async initialize() {
    await pool.query('SELECT 1');
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
    const postgresMigrationsDir = path.join(migrationsDir, 'postgres');
    const requiredMigrations = fs.readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    const tableCheck = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const hasMigrationTable = tableCheck.rows.some((row) => row.table_name === 'schema_migrations');

    if (!hasMigrationTable) {
      const existingTables = tableCheck.rows.map((row) => row.table_name);
      if (existingTables.length) {
        throw new Error(
          `PostgreSQL database has tables but no schema_migrations record (${existingTables.join(', ')}); refusing to modify an untracked schema.`
        );
      }

      const bootstrapPath = path.join(postgresMigrationsDir, 'bootstrap.sql');
      if (!fs.existsSync(bootstrapPath)) {
        throw new Error('Missing PostgreSQL bootstrap schema; run npm run generate:postgres-baseline before deploying.');
      }

      await db.transaction(async () => {
        const client = transactionContext.getStore();
        await client.query(`
          CREATE TABLE schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP::text
          )
        `);
        await client.query(fs.readFileSync(bootstrapPath, 'utf8'));
        for (const filename of requiredMigrations) {
          await client.query(
            'INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, CURRENT_TIMESTAMP::text)',
            [filename]
          );
        }
      })();
      console.log(`Initialized empty PostgreSQL database from ${path.relative(migrationsDir, bootstrapPath)}.`);
      return;
    }

    const applied = await pool.query('SELECT filename FROM schema_migrations');
    const appliedNames = new Set(applied.rows.map((row) => row.filename));
    const pending = requiredMigrations.filter((filename) => !appliedNames.has(filename));

    for (const filename of pending) {
      const migrationPath = path.join(postgresMigrationsDir, filename);
      if (!fs.existsSync(migrationPath)) {
        throw new Error(`Missing PostgreSQL migration ${filename}; add it before deploying this schema change.`);
      }
      await db.transaction(async () => {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await transactionContext.getStore().query(sql);
        await transactionContext.getStore().query(
          "INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, CURRENT_TIMESTAMP::text)",
          [filename]
        );
      })();
      console.log(`Applied PostgreSQL migration: ${filename}`);
    }
  },

  async close() {
    await pool.end();
  }
};

module.exports = db;
