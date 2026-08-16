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

// One row per finished run that has not yet been folded into `full_<ns>.mp4`.
//
// Archiving used to concatenate the entire archive on every reset, which is O(all
// history) for O(one run) of new footage — measured at 11.4s and 623MB rewritten for
// `github`, growing with every reset. Runs now land here as their own segment file
// and are folded in only when someone actually asks for the full video.
db.exec(`
	CREATE TABLE IF NOT EXISTS run_segments (
		namespace  TEXT    NOT NULL,
		seq        INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (namespace, seq)
	);
`);

// Where each namespace currently stands, refreshed from the engine's own report on
// every frame render (see render/summary.ts). A replay always runs to the end of the
// input, so its final state is the current state — this costs no extra work.
db.exec(`
	CREATE TABLE IF NOT EXISTS namespace_status (
		namespace     TEXT PRIMARY KEY,
		state         TEXT    NOT NULL,
		episode       INTEGER,
		map           INTEGER,
		kills         INTEGER,
		total_kills   INTEGER,
		items         INTEGER,
		total_items   INTEGER,
		secrets       INTEGER,
		total_secrets INTEGER,
		tics          INTEGER,
		health        INTEGER,
		dead          INTEGER,
		frames        INTEGER,
		updated_at    INTEGER NOT NULL
	);
`);

// One row per finished run, written when a run is archived. Where namespace_status is
// the present, this is the past: what the player had achieved when they hit reset.
db.exec(`
	CREATE TABLE IF NOT EXISTS run_history (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		namespace   TEXT    NOT NULL,
		episode     INTEGER,
		map         INTEGER,
		kills       INTEGER,
		total_kills INTEGER,
		secrets     INTEGER,
		tics        INTEGER,
		health      INTEGER,
		dead        INTEGER,
		frames      INTEGER,
		ended_at    INTEGER NOT NULL
	);
`);

db.exec('CREATE INDEX IF NOT EXISTS run_history_namespace ON run_history (namespace, ended_at DESC);');

// One row per achievement a namespace has earned. Permanent: the primary key makes
// earning idempotent, so re-rendering the same buffer cannot re-award anything, and a
// reset does not take back what was already done.
db.exec(`
	CREATE TABLE IF NOT EXISTS achievements (
		namespace TEXT    NOT NULL,
		id        TEXT    NOT NULL,
		earned_at INTEGER NOT NULL,
		PRIMARY KEY (namespace, id)
	);
`);

// Small key/value side table. Currently holds only the player-id salt, which has to
// outlive restarts — see http/client.ts for why it is generated rather than fixed.
db.exec(`
	CREATE TABLE IF NOT EXISTS meta (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
`);

// One row per distinct player. `id` is a keyed hash of the client address, never the
// address itself, so this counts people without retaining a record of who they were.
db.exec(`
	CREATE TABLE IF NOT EXISTS players (
		id         TEXT PRIMARY KEY,
		first_seen INTEGER NOT NULL,
		last_seen  INTEGER NOT NULL,
		actions    INTEGER NOT NULL DEFAULT 0
	);
`);

// One row per distinct key sequence ever appended. The README publishes a fixed menu
// of control links, so this measures how much of that menu actually gets used, and
// surfaces anything hand-crafted outside it.
db.exec(`
	CREATE TABLE IF NOT EXISTS input_variants (
		keys       TEXT PRIMARY KEY,
		uses       INTEGER NOT NULL DEFAULT 0,
		first_seen INTEGER NOT NULL,
		last_seen  INTEGER NOT NULL
	);
`);

// The `stats` table above is a single global row carried over from the original app.
// This is the same counters split per namespace, plus completed runs, so one busy
// namespace no longer hides every other.
db.exec(`
	CREATE TABLE IF NOT EXISTS namespace_stats (
		namespace    TEXT PRIMARY KEY,
		actions      INTEGER NOT NULL DEFAULT 0,
		keys_pressed INTEGER NOT NULL DEFAULT 0,
		rewinds      INTEGER NOT NULL DEFAULT 0,
		runs         INTEGER NOT NULL DEFAULT 0,
		updated_at   INTEGER NOT NULL
	);
`);

/**
 * Adds a column to an existing table if it is missing.
 *
 * `CREATE TABLE IF NOT EXISTS` silently does nothing when the table already exists, so
 * on any database that has already been deployed a new column in one of the
 * definitions above would never appear — and the first query naming it would throw at
 * runtime rather than at startup. This keeps schema changes additive and idempotent.
 *
 * `table` and `definition` are compile-time literals from this file, never request
 * data; SQLite cannot parameterise DDL.
 */
function ensureColumn(table: string, column: string, definition: string): void {
	const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
	if (columns.some((existing) => existing.name === column)) return;

	db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
	logger.info({ table, column }, 'schema column added');
}

// Added after namespace_stats shipped, so it has to go on by ALTER for anyone who
// already has the table.
ensureColumn('namespace_stats', 'deaths', 'deaths INTEGER NOT NULL DEFAULT 0');

// Autopilot bookkeeping. `last_human_at` has to be distinct from `inputs.created_at`
// because the bot writes input rows too — measuring idleness off the buffer would mean
// the bot's own move counted as activity and it would never run twice.
ensureColumn('namespace_state', 'last_human_at', 'last_human_at INTEGER');
ensureColumn('namespace_state', 'last_bot_at', 'last_bot_at INTEGER');
ensureColumn('namespace_stats', 'bot_actions', 'bot_actions INTEGER NOT NULL DEFAULT 0');

// Seed `last_human_at` for namespaces that existed before the column did.
//
// Without this every pre-existing namespace has NULL and is invisible to the idle scan,
// which is precisely backwards: a namespace nobody has clicked since the deploy is the
// one that most needs the bot. Every input row predating this statement was written by a
// human, so the last one is the honest answer.
//
// Idempotent by the COALESCE — it only ever fills a NULL, so a restart cannot rewrite a
// timestamp that has since been set for real.
db.query<never, [number]>(`
	INSERT INTO namespace_state (namespace, updated_at, last_human_at)
	SELECT namespace, ?, MAX(created_at) FROM inputs GROUP BY namespace
	ON CONFLICT (namespace) DO UPDATE SET
		last_human_at = COALESCE(namespace_state.last_human_at, excluded.last_human_at)
`).run(Date.now());

logger.info({ path: `${config.DATA_DIR}/play-doom.sqlite` }, 'database ready');
