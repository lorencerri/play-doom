import { db } from '../db.ts';
import type { RunSummary } from '../render/summary.ts';

/**
 * Where each namespace stands now, and how its finished runs went.
 *
 * Both are fed by the engine's end-of-replay report rather than by anything the API
 * infers, so they cannot drift from what the rendered frame actually shows.
 */

const upsertStatus = db.query<
	never,
	[string, string, number | null, number | null, number | null, number | null, number | null, number | null,
	 number | null, number | null, number | null, number | null, number | null, number | null, number]
>(`
	INSERT INTO namespace_status
		(namespace, state, episode, map, kills, total_kills, items, total_items,
		 secrets, total_secrets, tics, health, dead, frames, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (namespace) DO UPDATE SET
		state = excluded.state, episode = excluded.episode, map = excluded.map,
		kills = excluded.kills, total_kills = excluded.total_kills,
		items = excluded.items, total_items = excluded.total_items,
		secrets = excluded.secrets, total_secrets = excluded.total_secrets,
		tics = excluded.tics, health = excluded.health, dead = excluded.dead,
		frames = excluded.frames, updated_at = excluded.updated_at
`);

// SQLite has no boolean and undefined is not a bindable value; both collapse to NULL.
const num = (value: number | undefined): number | null => value ?? null;
const bool = (value: boolean | undefined): number | null => (value === undefined ? null : value ? 1 : 0);

/**
 * Records the new status and reports whether the player just died.
 *
 * The alive→dead *transition* is what counts, not the dead state: a render happens on
 * every input change, and a png and a gif of the same buffer both report the same
 * death, so counting the state would inflate the total. Comparing against the stored
 * status makes it idempotent — and a rewind back past the death correctly re-arms it.
 */
export function setStatus(namespace: string, summary: RunSummary): boolean {
	const previous = getStatus(namespace);
	const died = summary.dead === true && previous?.dead !== true;

	upsertStatus.run(
		namespace,
		summary.state,
		num(summary.episode),
		num(summary.map),
		num(summary.kills),
		num(summary.totalKills),
		num(summary.items),
		num(summary.totalItems),
		num(summary.secrets),
		num(summary.totalSecrets),
		num(summary.tics),
		num(summary.health),
		bool(summary.dead),
		num(summary.frames),
		Date.now(),
	);

	return died;
}

export type NamespaceStatus = RunSummary & { namespace: string; updatedAt: number };

type StatusRow = {
	namespace: string;
	state: string;
	episode: number | null;
	map: number | null;
	kills: number | null;
	total_kills: number | null;
	items: number | null;
	total_items: number | null;
	secrets: number | null;
	total_secrets: number | null;
	tics: number | null;
	health: number | null;
	dead: number | null;
	frames: number | null;
	updated_at: number;
};

const selectStatus = db.query<StatusRow, [string]>('SELECT * FROM namespace_status WHERE namespace = ?');

function toStatus(row: StatusRow): NamespaceStatus {
	return {
		namespace: row.namespace,
		state: row.state === 'level' ? 'level' : 'menu',
		episode: row.episode ?? undefined,
		map: row.map ?? undefined,
		kills: row.kills ?? undefined,
		totalKills: row.total_kills ?? undefined,
		items: row.items ?? undefined,
		totalItems: row.total_items ?? undefined,
		secrets: row.secrets ?? undefined,
		totalSecrets: row.total_secrets ?? undefined,
		tics: row.tics ?? undefined,
		health: row.health ?? undefined,
		dead: row.dead === null ? undefined : row.dead === 1,
		frames: row.frames ?? undefined,
		updatedAt: row.updated_at,
	};
}

export function getStatus(namespace: string): NamespaceStatus | undefined {
	const row = selectStatus.get(namespace);
	return row ? toStatus(row) : undefined;
}

const insertRun = db.query<
	never,
	[string, number | null, number | null, number | null, number | null, number | null, number | null,
	 number | null, number | null, number | null, number]
>(`
	INSERT INTO run_history
		(namespace, episode, map, kills, total_kills, secrets, tics, health, dead, frames, ended_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function recordRun(namespace: string, summary: RunSummary): void {
	// A run that ended on a menu has no score worth keeping — the counters would be
	// whatever the last level happened to leave behind.
	if (summary.state !== 'level') return;

	insertRun.run(
		namespace,
		num(summary.episode),
		num(summary.map),
		num(summary.kills),
		num(summary.totalKills),
		num(summary.secrets),
		num(summary.tics),
		num(summary.health),
		bool(summary.dead),
		num(summary.frames),
		Date.now(),
	);
}

export type PastRun = {
	episode?: number;
	map?: number;
	kills?: number;
	totalKills?: number;
	secrets?: number;
	tics?: number;
	dead?: boolean;
	frames?: number;
	endedAt: number;
};

type RunRow = {
	episode: number | null;
	map: number | null;
	kills: number | null;
	total_kills: number | null;
	secrets: number | null;
	tics: number | null;
	dead: number | null;
	frames: number | null;
	ended_at: number;
};

function toRun(row: RunRow): PastRun {
	return {
		episode: row.episode ?? undefined,
		map: row.map ?? undefined,
		kills: row.kills ?? undefined,
		totalKills: row.total_kills ?? undefined,
		secrets: row.secrets ?? undefined,
		tics: row.tics ?? undefined,
		dead: row.dead === null ? undefined : row.dead === 1,
		frames: row.frames ?? undefined,
		endedAt: row.ended_at,
	};
}

// `id DESC` is the tiebreaker, not decoration: `ended_at` is a millisecond timestamp,
// and two runs archived inside the same millisecond would otherwise come back in
// whatever order SQLite felt like.
const selectRecent = db.query<RunRow, [string, number]>(`
	SELECT episode, map, kills, total_kills, secrets, tics, dead, frames, ended_at
	FROM run_history WHERE namespace = ? ORDER BY ended_at DESC, id DESC LIMIT ?
`);

export function recentRuns(namespace: string, limit = 10): PastRun[] {
	return selectRecent.all(namespace, limit).map(toRun);
}

/**
 * The best run so far: furthest level first, then most kills, then longest survived.
 * "Furthest" is episode-then-map because Doom's shareware episode is E1 only, but a
 * full WAD would order E2M1 after E1M9.
 */
const selectBest = db.query<RunRow, [string]>(`
	SELECT episode, map, kills, total_kills, secrets, tics, dead, frames, ended_at
	FROM run_history WHERE namespace = ?
	ORDER BY episode DESC, map DESC, kills DESC, tics DESC LIMIT 1
`);

export function bestRun(namespace: string): PastRun | undefined {
	const row = selectBest.get(namespace);
	return row ? toRun(row) : undefined;
}
