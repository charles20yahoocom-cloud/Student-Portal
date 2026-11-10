if (process.env.DATABASE_URL) {
  module.exports = require('./database-postgres');
} else {
  const { AsyncLocalStorage } = require('async_hooks');
  const sqlite = require('./database-sqlite');

  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();

  function withLock(callback) {
    const result = queue.then(callback, callback);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function execute(statement, method, params) {
    if (context.getStore()) return statement[method](...params);
    return withLock(() => statement[method](...params));
  }

  module.exports = {
    isPostgres: false,

    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        get: (...params) => execute(statement, 'get', params),
        all: (...params) => execute(statement, 'all', params),
        run: (...params) => execute(statement, 'run', params)
      };
    },

    transaction(callback) {
      return () => withLock(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const result = await context.run(true, callback);
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      });
    },

    async initialize() {},

    async close() {
      await withLock(() => sqlite.close());
    }
  };
}
