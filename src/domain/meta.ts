import { db } from '../db.ts';
import { newSalt, playerId } from '../http/client.ts';

/**
 * The meta counters behind `/stats`: how many distinct people have played, how many
 * distinct control sequences they have used, and the same per namespace.
 *
 * Everything here is best-effort bookkeeping around the actual game. A failure to
 * record a statistic must never fail the click that triggered it, so the callers in
 * routes/input.ts treat these as fire-and-forget.
 */

const selectMeta = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?');
const insertMeta = db.query<never, [string, string]>('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)');

/**
 * Read-or-create the salt that pseudonymises client addresses. Generated on first
 * use rather than configured, so a fresh install is private by default with no
 * setup step. `INSERT OR IGNORE` then re-select makes two racing workers agree.
 */
function playerSalt(): string {
	const existing = selectMeta.get('player_salt');
	if (existing) return existing.value;

	insertMeta.run('player_salt', newSalt());
	return selectMeta.get('player_salt')!.value;
}

const upsertPlayer = db.query<never, [string, number, number]>(`
	INSERT INTO players (id, first_seen, last_seen, actions) VALUES (?, ?, ?, 1)
	ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, actions = actions + 1
`);

/**
 * Counts one action by whoever is at `address`, without storing the address.
 *
 * Callers pass the address of a real click. Image requests must never reach here:
 * GitHub proxies README images through Camo, so `/frame` traffic is a handful of
 * GitHub servers rather than visitors, and counting it would report Camo's fleet
 * size instead of the player count.
 */
export function recordPlayerAction(address: string | undefined): void {
	if (!address) return;

	const now = Date.now();
	upsertPlayer.run(playerId(address, playerSalt()), now, now);
}

const upsertVariant = db.query<never, [string, number, number]>(`
	INSERT INTO input_variants (keys, uses, first_seen, last_seen) VALUES (?, 1, ?, ?)
	ON CONFLICT (keys) DO UPDATE SET uses = uses + 1, last_seen = excluded.last_seen
`);

/** Longer than any README control link; anything past this is not a distinct "input". */
const MAX_VARIANT_LENGTH = 256;

export function recordInputVariant(keys: string): void {
	if (!keys || keys.length > MAX_VARIANT_LENGTH) return;

	const now = Date.now();
	upsertVariant.run(keys, now, now);
}

export type NamespaceDelta = {
	actions?: number;
	keysPressed?: number;
	rewinds?: number;
	runs?: number;
};

const upsertNamespaceStats = db.query<never, [string, number, number, number, number, number, number]>(`
	INSERT INTO namespace_stats (namespace, actions, keys_pressed, rewinds, runs, updated_at)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT (namespace) DO UPDATE SET
		actions      = actions + excluded.actions,
		keys_pressed = keys_pressed + excluded.keys_pressed,
		rewinds      = rewinds + excluded.rewinds,
		runs         = runs + excluded.runs,
		updated_at   = ?
`);

export function recordNamespaceStats(namespace: string, delta: NamespaceDelta): void {
	const now = Date.now();
	upsertNamespaceStats.run(
		namespace,
		delta.actions ?? 0,
		delta.keysPressed ?? 0,
		delta.rewinds ?? 0,
		delta.runs ?? 0,
		now,
		now,
	);
}

export type NamespaceStats = {
	namespace: string;
	actions: number;
	keysPressed: number;
	rewinds: number;
	runs: number;
};

export type MetaStats = {
	uniquePlayers: number;
	uniqueInputs: number;
	namespaces: NamespaceStats[];
	topInputs: { keys: string; uses: number }[];
};

const countPlayers = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM players');
const countVariants = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM input_variants');

const selectNamespaces = db.query<
	{ namespace: string; actions: number; keys_pressed: number; rewinds: number; runs: number },
	[]
>('SELECT namespace, actions, keys_pressed, rewinds, runs FROM namespace_stats ORDER BY actions DESC');

const selectTopVariants = db.query<{ keys: string; uses: number }, [number]>(
	'SELECT keys, uses FROM input_variants ORDER BY uses DESC LIMIT ?',
);

export function getMetaStats(topInputs = 5): MetaStats {
	return {
		uniquePlayers: countPlayers.get()?.n ?? 0,
		uniqueInputs: countVariants.get()?.n ?? 0,
		namespaces: selectNamespaces.all().map((row) => ({
			namespace: row.namespace,
			actions: row.actions,
			keysPressed: row.keys_pressed,
			rewinds: row.rewinds,
			runs: row.runs,
		})),
		topInputs: selectTopVariants.all(topInputs),
	};
}
