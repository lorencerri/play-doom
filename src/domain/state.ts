import { db } from '../db.ts';

export type VideoFlag = 'current_video_outdated' | 'full_video_outdated' | 'combined_outdated';

export type NamespaceState = {
	current_video_outdated: boolean;
	full_video_outdated: boolean;
	combined_outdated: boolean;
};

type StateRow = { current_video_outdated: number; full_video_outdated: number; combined_outdated: number };

const selectState = db.query<StateRow, [string]>(
	'SELECT current_video_outdated, full_video_outdated, combined_outdated FROM namespace_state WHERE namespace = ?',
);

const ensureState = db.query<never, [string, number]>(
	'INSERT OR IGNORE INTO namespace_state (namespace, updated_at) VALUES (?, ?)',
);

export function getState(namespace: string): NamespaceState {
	const row = selectState.get(namespace);
	return {
		current_video_outdated: Boolean(row?.current_video_outdated),
		full_video_outdated: Boolean(row?.full_video_outdated),
		combined_outdated: Boolean(row?.combined_outdated),
	};
}

export function setFlags(namespace: string, flags: Partial<Record<VideoFlag, boolean>>): void {
	const entries = Object.entries(flags) as [VideoFlag, boolean][];
	if (entries.length === 0) return;

	ensureState.run(namespace, Date.now());

	// Column names come from the VideoFlag union, never from request data.
	const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
	const values = entries.map(([, value]) => (value ? 1 : 0));

	db.query(`UPDATE namespace_state SET ${assignments}, updated_at = ? WHERE namespace = ?`).run(
		...values,
		Date.now(),
		namespace,
	);
}

const selectHash = db.query<{ input_hash: string }, [string, string]>(
	'SELECT input_hash FROM render_cache WHERE namespace = ? AND artifact = ?',
);

const upsertHash = db.query<never, [string, string, string, number]>(`
	INSERT INTO render_cache (namespace, artifact, input_hash, updated_at) VALUES (?, ?, ?, ?)
	ON CONFLICT (namespace, artifact) DO UPDATE SET input_hash = excluded.input_hash, updated_at = excluded.updated_at
`);

export function getRenderHash(namespace: string, artifact: string): string | undefined {
	return selectHash.get(namespace, artifact)?.input_hash;
}

export function setRenderHash(namespace: string, artifact: string, hash: string): void {
	upsertHash.run(namespace, artifact, hash, Date.now());
}

export type Stats = { actions: number; keysPressed: number; rewinds: number };

const selectStats = db.query<{ actions: number; keys_pressed: number; rewinds: number }, []>(
	'SELECT actions, keys_pressed, rewinds FROM stats WHERE id = 1',
);

const bumpStats = db.query<never, [number, number, number]>(
	'UPDATE stats SET actions = actions + ?, keys_pressed = keys_pressed + ?, rewinds = rewinds + ? WHERE id = 1',
);

export function getStats(): Stats {
	const row = selectStats.get();
	return {
		actions: row?.actions ?? 0,
		keysPressed: row?.keys_pressed ?? 0,
		rewinds: row?.rewinds ?? 0,
	};
}

export function incrementStats(delta: Partial<Stats>): void {
	bumpStats.run(delta.actions ?? 0, delta.keysPressed ?? 0, delta.rewinds ?? 0);
}
