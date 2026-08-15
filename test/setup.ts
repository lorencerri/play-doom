// Runs before any test module imports config.ts, so the suite never touches the
// real data directory or the live database.
process.env.DATA_DIR = './data/.test';
process.env.LOG_LEVEL = 'silent';
