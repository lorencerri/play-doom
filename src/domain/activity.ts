import { db } from '../db.ts';

/**
 * When each namespace was last touched by a person, and when the autopilot last moved.
 *
 * These are deliberately not derived from `inputs.created_at`. The bot appends input rows
 * like anyone else, so "time of the newest batch" would count the bot's own move as
 * activity: it would run once, see fresh input, and never run again. Separating the two
 * is what makes "idle" mean *nobody is playing* rather than *nothing has happened*.
 */

const ensureState = db.query<never, [string, number]>(
	'INSERT OR IGNORE INTO namespace_state (namespace, updated_at) VALUES (?, ?)',
);

const touchHuman = db.query<never, [number, number, string]>(
	'UPDATE namespace_state SET last_human_at = ?, updated_at = ? WHERE namespace = ?',
);

const touchBot = db.query<never, [number, string]>('UPDATE namespace_state SET last_bot_at = ? WHERE namespace = ?');

/**
 * Records that a person just did something to this namespace.
 *
 * Called from every human-facing control — append, rewind and reset alike. Rewind and
 * reset count: somebody watching the game is somebody the bot should not interrupt, even
 * when what they did removed input rather than adding it.
 */
export function recordHumanActivity(namespace: string): void {
	const now = Date.now();
	ensureState.run(namespace, now);
	touchHuman.run(now, now, namespace);
}

export function recordBotActivity(namespace: string): void {
	const now = Date.now();
	ensureState.run(namespace, now);
	touchBot.run(now, namespace);
}

export type ActivityWindow = {
	/** How long since a person touched it before the bot may play. */
	idleMs: number;
	/** Minimum gap between the bot's own moves. */
	intervalMs: number;
	/** Stop playing a namespace nobody has touched in this long. */
	abandonMs: number;
};

/**
 * Namespaces the autopilot should move right now.
 *
 * The abandon bound is the one that keeps this affordable. Without it every namespace
 * ever created is played forever, and each move costs a render — so the cost of the
 * feature would grow with the number of namespaces that have *ever* existed rather than
 * with the number anyone still visits. A profile that has not been clicked in a month is
 * not being read either.
 */
const selectIdle = db.query<{ namespace: string }, [number, number, number]>(`
	SELECT namespace FROM namespace_state
	WHERE last_human_at IS NOT NULL
	  AND last_human_at <= ?
	  AND last_human_at >= ?
	  AND (last_bot_at IS NULL OR last_bot_at <= ?)
	ORDER BY last_human_at ASC
`);

export function idleNamespaces(window: ActivityWindow, now = Date.now()): string[] {
	return selectIdle
		.all(now - window.idleMs, now - window.abandonMs, now - window.intervalMs)
		.map((row) => row.namespace);
}

export type Activity = { lastHumanAt?: number; lastBotAt?: number };

const selectActivity = db.query<{ last_human_at: number | null; last_bot_at: number | null }, [string]>(
	'SELECT last_human_at, last_bot_at FROM namespace_state WHERE namespace = ?',
);

export function getActivity(namespace: string): Activity {
	const row = selectActivity.get(namespace);
	return { lastHumanAt: row?.last_human_at ?? undefined, lastBotAt: row?.last_bot_at ?? undefined };
}
