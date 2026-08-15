import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { config } from './config.ts';
import { logger } from './logger.ts';

mkdirSync(config.DATA_DIR, { recursive: true });

// Single connection for the whole process — the old app opened one QuickDB handle
// per module (controller + service), which meant two independent SQLite connections
// fighting over one file under concurrent writes (SQLITE_BUSY crashes). Never open
// a second one; import `db` from here everywhere.
export const db = new Database(`${config.DATA_DIR}/play-doom.sqlite`, { create: true });

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
	CREATE TABLE IF NOT EXISTS inputs (
		namespace  TEXT    NOT NULL,
		seq        INTEGER NOT NULL,
		keys       TEXT    NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (namespace, seq)
	);
`);

db.exec(`
	CREATE TABLE IF NOT EXISTS namespace_state (
		namespace              TEXT PRIMARY KEY,
		current_video_outdated INTEGER NOT NULL DEFAULT 0,
		full_video_outdated    INTEGER NOT NULL DEFAULT 0,
		combined_outdated      INTEGER NOT NULL DEFAULT 0,
		updated_at             INTEGER NOT NULL
	);
`);

// The MD5 gate that decides whether a rendered artifact is still current. The old
// app kept a single `inputHash_<ns>` key shared by the png and the gif, so
// rendering one marked the other fresh and a request for the second could serve a
// stale file — or a missing one. Keyed per artifact here.
db.exec(`
	CREATE TABLE IF NOT EXISTS render_cache (
		namespace  TEXT    NOT NULL,
		artifact   TEXT    NOT NULL,
		input_hash TEXT    NOT NULL,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (namespace, artifact)
	);
`);

// Single-row table: global counters, matching the original db.get('stats') shape.
db.exec(`
	CREATE TABLE IF NOT EXISTS stats (
		id           INTEGER PRIMARY KEY CHECK (id = 1),
		actions      INTEGER NOT NULL DEFAULT 0,
		keys_pressed INTEGER NOT NULL DEFAULT 0,
		rewinds      INTEGER NOT NULL DEFAULT 0
	);
`);
db.exec(`INSERT OR IGNORE INTO stats (id) VALUES (1);`);

logger.info({ path: `${config.DATA_DIR}/play-doom.sqlite` }, 'database ready');
