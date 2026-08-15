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

/** Stored batches only, oldest first — without the bootstrap prefix. */
export function getStoredBatches(namespace: string): string[] {
	return selectBatches.all(namespace).map((row) => row.keys);
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
}
