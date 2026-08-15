/**
 * One-shot migration from the old quick.db file into the rebuild's schema.
 *
 *   bun run scripts/migrate-quickdb.ts <path-to-json.sqlite>          # preview
 *   bun run scripts/migrate-quickdb.ts <path-to-json.sqlite> --apply  # write
 *
 * Writes into whatever `DATA_DIR` points at, via the app's own connection — so the
 * destination is the same database the app opens, with the same schema and PRAGMAs.
 *
 * ## What moves, and what deliberately does not
 *
 * `input_<ns>` is the only thing that is genuinely irreplaceable, and it becomes one
 * `inputs` row per batch. The video-staleness flags move because they describe mp4s
 * that already exist on disk.
 *
 * The MD5 render hashes do **not** move. They are a cache, and the old app hashed a
 * different string than this one does (it also shared a single hash between the png
 * and the gif — the bug `render_cache` exists to fix). Importing them could mark a
 * stale frame as current, which is exactly the failure the hash gate is there to
 * prevent. Dropping them costs one render per namespace.
 *
 * Artifact filenames are unchanged between the two versions — `frame_<ns>.gif`,
 * `current_<ns>.mp4`, `full_<ns>.mp4`, `combined_<ns>.mp4` all match `render/
 * artifacts.ts`. Nothing on disk needs to move.
 */

import { Database } from 'bun:sqlite';
import { db } from '../src/db.ts';

type OldRow = { ID: string; json: string };

const [source, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');

if (!source) {
	console.error('usage: bun run scripts/migrate-quickdb.ts <path-to-json.sqlite> [--apply]');
	process.exit(1);
}

// Read-only: this file belongs to the service that is still running.
const old = new Database(source, { readonly: true });

const rows = old.query<OldRow, []>('SELECT ID, json FROM json').all();

function decode(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/** Splits `input_my_ns` into its prefix and namespace, longest prefix first. */
function match(id: string, prefix: string): string | null {
	return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

type Plan = {
	inputs: Map<string, string[]>;
	flags: Map<string, Partial<Record<'current_video_outdated' | 'full_video_outdated' | 'combined_outdated', boolean>>>;
	stats: { actions: number; keysPressed: number; rewinds: number } | null;
	skipped: string[];
};

const plan: Plan = { inputs: new Map(), flags: new Map(), stats: null, skipped: [] };

const FLAG_KEYS = [
	['currentVideoOutdated_', 'current_video_outdated'],
	['fullVideoOutdated_', 'full_video_outdated'],
	['combinedOutdated_', 'combined_outdated'],
] as const;

for (const row of rows) {
	const value = decode(row.json);

	if (row.ID === 'stats' && value && typeof value === 'object') {
		const s = value as Record<string, unknown>;
		plan.stats = {
			actions: Number(s.actions ?? 0),
			keysPressed: Number(s.keysPressed ?? 0),
			rewinds: Number(s.rewinds ?? 0),
		};
		continue;
	}

	const namespace = match(row.ID, 'input_');
	if (namespace !== null) {
		if (!Array.isArray(value)) {
			plan.skipped.push(`${row.ID} (expected an array, got ${typeof value})`);
			continue;
		}
		plan.inputs.set(
			namespace,
			value.map((batch) => String(batch)),
		);
		continue;
	}

	let matchedFlag = false;
	for (const [prefix, column] of FLAG_KEYS) {
		const ns = match(row.ID, prefix);
		if (ns === null) continue;
		plan.flags.set(ns, { ...plan.flags.get(ns), [column]: value === true });
		matchedFlag = true;
		break;
	}
	if (matchedFlag) continue;

	// Everything else is a hash we are deliberately dropping, or a key from a schema
	// older than the one this migration targets (`input` held a single-namespace map
	// before the `input_<ns>` split). Reported rather than silently ignored.
	plan.skipped.push(row.ID);
}

console.log(`source: ${source} (${rows.length} rows)`);
console.log('');

for (const [namespace, batches] of [...plan.inputs].sort()) {
	const joined = batches.join('');
	const frames = joined.length === 0 ? 0 : (joined.match(/,/g)?.length ?? 0);
	console.log(`  input   ${namespace.padEnd(16)} ${String(batches.length).padStart(4)} batches  ${String(frames).padStart(5)} frames`);
}
for (const [namespace, f] of [...plan.flags].sort()) {
	console.log(`  flags   ${namespace.padEnd(16)} ${JSON.stringify(f)}`);
}
if (plan.stats) console.log(`  stats   ${JSON.stringify(plan.stats)}`);

console.log('');
console.log(`  skipped ${plan.skipped.length} keys (render hashes and pre-split keys):`);
for (const id of plan.skipped) console.log(`            ${id}`);
console.log('');

if (!apply) {
	console.log('Dry run. Re-run with --apply to write.');
	process.exit(0);
}

// Refuse to write over a namespace that already has input, so re-running this after
// the new app has taken traffic cannot silently duplicate or reorder a live buffer.
const existing = db
	.query<{ namespace: string }, []>('SELECT DISTINCT namespace FROM inputs')
	.all()
	.map((row) => row.namespace);

const collisions = existing.filter((namespace) => plan.inputs.has(namespace));
if (collisions.length > 0) {
	console.error(`refusing to run: these namespaces already have input rows: ${collisions.join(', ')}`);
	console.error('clear them first, or migrate into an empty data directory.');
	process.exit(1);
}

const insertBatch = db.query<never, [string, number, string, number]>(
	'INSERT INTO inputs (namespace, seq, keys, created_at) VALUES (?, ?, ?, ?)',
);
const ensureState = db.query<never, [string, number]>(
	'INSERT OR IGNORE INTO namespace_state (namespace, updated_at) VALUES (?, ?)',
);

db.transaction(() => {
	const now = Date.now();

	for (const [namespace, batches] of plan.inputs) {
		batches.forEach((keys, index) => insertBatch.run(namespace, index + 1, keys, now));
	}

	for (const [namespace, f] of plan.flags) {
		ensureState.run(namespace, now);

		const entries = Object.entries(f);
		if (entries.length === 0) continue;

		// Column names come from FLAG_KEYS above, never from the source data.
		const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
		db.query(`UPDATE namespace_state SET ${assignments}, updated_at = ? WHERE namespace = ?`).run(
			...entries.map(([, value]) => (value ? 1 : 0)),
			now,
			namespace,
		);
	}

	if (plan.stats) {
		db.query<never, [number, number, number]>(
			'UPDATE stats SET actions = ?, keys_pressed = ?, rewinds = ? WHERE id = 1',
		).run(plan.stats.actions, plan.stats.keysPressed, plan.stats.rewinds);
	}
})();

console.log('Applied.');
