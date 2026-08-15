import { db } from '../db.ts';
import { tokenize } from './keys.ts';

// Skips the shareware title screen and the difficulty menu so a fresh namespace
// opens on a playable frame instead of a menu. Every run is prefixed with this,
// and it is never stored — it is synthesised on read, so a reset restores it for
// free. Kept byte-identical to the original (legacy/src/app.service.ts:24); a test
// asserts that against the legacy source.
export const BOOTSTRAP_PREFIX = 'x,e,e,e,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,';

type InputRow = { seq: number; keys: string };

const selectBatches = db.query<{ keys: string }, [string]>(
	'SELECT keys FROM inputs WHERE namespace = ? ORDER BY seq ASC',
);

const selectLastBatch = db.query<InputRow, [string]>(
	'SELECT seq, keys FROM inputs WHERE namespace = ? ORDER BY seq DESC LIMIT 1',
);

// One row per click. The old app did read → JSON.parse → push → JSON.stringify →
// write on every keypress, which is O(buffer) per press on a buffer that only ever
// grows. This is an indexed insert regardless of run length (§1.5).
const insertBatch = db.query<never, [string, string, string, number]>(`
	INSERT INTO inputs (namespace, seq, keys, created_at)
	VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM inputs WHERE namespace = ?), ?, ?)
`);

const deleteBatch = db.query<never, [string, number]>('DELETE FROM inputs WHERE namespace = ? AND seq = ?');
const updateBatch = db.query<never, [string, string, number]>('UPDATE inputs SET keys = ? WHERE namespace = ? AND seq = ?');
const deleteAll = db.query<never, [string]>('DELETE FROM inputs WHERE namespace = ?');

/**
 * Reconstructing the buffer is an ordered scan of every row for the namespace, and
 * the callers that need it are the hot ones: the eager render asks for it twice per
 * click (once per frame type), and the frame request asks again. Cache the scan and
 * the joined string, and drop the entry whenever the buffer is written (plan 1.5).
 *
 * Safe because there is exactly one process holding exactly one connection to this
 * database — the same property that fixed crash cause #3. If a second writer ever
 * appears, this cache is the first thing that breaks.
 */
type CachedInput = { batches: string[]; joined: string };

// Bounded so a burst of one-off namespaces cannot grow this without limit; entries
// are cheap to rebuild, so evicting the oldest is enough.
const MAX_CACHED_NAMESPACES = 256;
const cache = new Map<string, CachedInput>();

function readInput(namespace: string): CachedInput {
	const cached = cache.get(namespace);
	if (cached) return cached;

	const batches = selectBatches.all(namespace).map((row) => row.keys);
	const prefixed = batches[0] === 'x,' ? batches : [BOOTSTRAP_PREFIX, ...batches];
	const entry: CachedInput = { batches, joined: prefixed.join('') };

	if (cache.size >= MAX_CACHED_NAMESPACES) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(namespace, entry);

	return entry;
}

function invalidate(namespace: string): void {
	cache.delete(namespace);
}

/** Stored batches only, oldest first — without the bootstrap prefix. */
export function getStoredBatches(namespace: string): string[] {
	// Copied, not shared: callers treat this as their own array, and a mutation
	// reaching the cache would desynchronise it from the table silently.
	return readInput(namespace).batches.slice();
}

/**
 * The whole buffer as one string, exactly as doomgeneric replays it.
 *
 * Equivalent to `getInput(namespace).join('')` but served from the cache, which
 * matters because joining is itself O(run length) and now happens several times per
 * click.
 */
export function getInputString(namespace: string): string {
	return readInput(namespace).joined;
}

/**
 * The full input buffer as doomgeneric should replay it: the bootstrap prefix
 * followed by every stored batch.
 *
 * The original skipped the prefix when the first stored batch was exactly `x,`,
 * on the theory that the run already opened with an Escape. Preserved as-is —
 * live namespaces may depend on it.
 */
export function getInput(namespace: string): string[] {
	const stored = getStoredBatches(namespace);
	if (stored[0] === 'x,') return stored;
	return [BOOTSTRAP_PREFIX, ...stored];
}

export function appendBatch(namespace: string, keys: string): void {
	insertBatch.run(namespace, namespace, keys, Date.now());
	invalidate(namespace);
}

/**
 * Removes `amount` keypresses from the end of the buffer, walking backwards
 * through batches and splitting the last one if it holds more than needed.
 *
 * The original ignored the documented `?amount=N` entirely and popped one whole
 * batch — so rewinding a 25× move undid all 25. Returns how many were actually
 * removed, which is less than `amount` when the buffer runs out.
 */
export function rewindKeys(namespace: string, amount: number): number {
	if (amount <= 0) return 0;

	try {
		return runRewind(namespace, amount);
	} finally {
		// In a finally so a transaction that throws part-way cannot leave the cache
		// describing rows that were rolled back.
		invalidate(namespace);
	}
}

function runRewind(namespace: string, amount: number): number {
	return db.transaction(() => {
		let remaining = amount;

		while (remaining > 0) {
			const row = selectLastBatch.get(namespace);
			if (!row) break;

			const tokens = tokenize(row.keys);

			if (tokens.length <= remaining) {
				deleteBatch.run(namespace, row.seq);
				remaining -= tokens.length;
				// A batch that tokenises to nothing would loop forever otherwise.
				if (tokens.length === 0) continue;
			} else {
				updateBatch.run(tokens.slice(0, tokens.length - remaining).join(''), namespace, row.seq);
				remaining = 0;
			}
		}

		return amount - remaining;
	})();
}

export function clearInput(namespace: string): void {
	deleteAll.run(namespace);
	invalidate(namespace);
}
