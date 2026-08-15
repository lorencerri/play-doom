import { db } from '../db.ts';

/**
 * Finished runs waiting to be folded into a namespace's archive.
 *
 * Every write here happens inside the per-namespace render queue, so reads and the
 * writes that follow them are serialised for a given namespace — `nextSeq` then
 * `addSegment` cannot interleave with another archive of the same namespace.
 */

const selectMaxSeq = db.query<{ seq: number | null }, [string]>(
	'SELECT MAX(seq) AS seq FROM run_segments WHERE namespace = ?',
);

const insertSegment = db.query<never, [string, number, number]>(
	'INSERT INTO run_segments (namespace, seq, created_at) VALUES (?, ?, ?)',
);

const selectSegments = db.query<{ seq: number }, [string]>(
	'SELECT seq FROM run_segments WHERE namespace = ? ORDER BY seq ASC',
);

const deleteSegment = db.query<never, [string, number]>('DELETE FROM run_segments WHERE namespace = ? AND seq = ?');

/**
 * Sequence numbers restart from zero once an archive is folded, because the segment
 * files are deleted at the same time. They order runs within one pending batch; they
 * are not a permanent run id.
 */
export function nextSeq(namespace: string): number {
	const max = selectMaxSeq.get(namespace)?.seq;
	return max === null || max === undefined ? 0 : max + 1;
}

export function addSegment(namespace: string, seq: number): void {
	insertSegment.run(namespace, seq, Date.now());
}

export function listSegments(namespace: string): number[] {
	return selectSegments.all(namespace).map((row) => row.seq);
}

/**
 * Clears exactly the segments that were folded, by sequence number, rather than
 * everything for the namespace — so a run archived while a fold was in flight is
 * never dropped without being merged.
 */
export function clearSegments(namespace: string, seqs: number[]): void {
	for (const seq of seqs) deleteSegment.run(namespace, seq);
}
