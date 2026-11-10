// Command-line seed and backup utilities remain explicitly SQLite-only.
// The web app uses database-runtime, which selects Neon when DATABASE_URL is set.
module.exports = require('./database-sqlite');
