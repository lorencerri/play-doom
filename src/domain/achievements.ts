import { db } from '../db.ts';
import type { RunSummary } from '../render/summary.ts';

/**
 * Badges a namespace has earned, evaluated from the engine's own end-of-replay report.
 *
 * The whole set is decided by data that already arrives on every render, so this costs a
 * handful of comparisons and — at most once per condition, ever — one insert. No extra
 * replay, no new engine work, nothing to keep in sync with the C.
 *
 * What they are actually for: a profile README that a visitor has seen before shows the
 * same controls and, if nobody has played, very nearly the same picture. A row of badges
 * is the part that can have visibly changed since last time, and it gives a passer-by
 * something to aim at rather than just something to click.
 */

/** Doom runs at 35 tics per second. */
const TICS_PER_MINUTE = 35 * 60;

export type Achievement = {
	id: string;
	name: string;
	/** Shown while unearned, so the badge reads as a goal rather than a mystery. */
	hint: string;
	earned: (summary: RunSummary) => boolean;
};

const n = (value: number | undefined): number => value ?? 0;

/**
 * Ordered easiest to hardest, which is also the order they are drawn.
 *
 * Every condition is a property of a *single* end-of-replay report. That constraint is
 * deliberate: an achievement that needed history would have to be recomputed against
 * runs that were archived before it existed, and the honest answer for those is
 * unknowable. Anything added here should stay answerable from one summary.
 */
export const ACHIEVEMENTS: Achievement[] = [
	{ id: 'first-blood', name: 'First Blood', hint: 'kill something', earned: (s) => n(s.kills) >= 1 },
	{ id: 'rest-in-peace', name: 'Rest In Peace', hint: 'die', earned: (s) => s.dead === true },
	{ id: 'secret-found', name: 'Secret Found', hint: 'find a hidden area', earned: (s) => n(s.secrets) >= 1 },
	{
		id: 'way-out',
		name: 'Way Out',
		hint: 'finish E1M1',
		// The shareware episode is E1 only, so a map past the first means a level was
		// cleared — there is no exit to anywhere else.
		earned: (s) => n(s.map) >= 2,
	},
	{
		id: 'untouchable',
		name: 'Untouchable',
		hint: 'kill three without taking a scratch',
		earned: (s) => n(s.kills) >= 3 && s.health === 100,
	},
	{
		id: 'survivor',
		name: 'Survivor',
		hint: 'spend five minutes on one level',
		earned: (s) => n(s.tics) >= 5 * TICS_PER_MINUTE,
	},
	{ id: 'delver', name: 'Delver', hint: 'reach E1M4', earned: (s) => n(s.map) >= 4 },
	{
		id: 'clean-sweep',
		name: 'Clean Sweep',
		hint: 'kill everything on a level',
		earned: (s) => n(s.totalKills) > 0 && s.kills === s.totalKills,
	},
	{
		id: 'pack-rat',
		name: 'Pack Rat',
		hint: 'collect every item on a level',
		earned: (s) => n(s.totalItems) > 0 && s.items === s.totalItems,
	},
	{
		id: 'completionist',
		name: 'Completionist',
		hint: 'find every secret on a level',
		earned: (s) => n(s.totalSecrets) > 0 && s.secrets === s.totalSecrets,
	},
];

const insertEarned = db.query<never, [string, string, number]>(
	'INSERT OR IGNORE INTO achievements (namespace, id, earned_at) VALUES (?, ?, ?)',
);

const selectEarned = db.query<{ id: string; earned_at: number }, [string]>(
	'SELECT id, earned_at FROM achievements WHERE namespace = ?',
);

/**
 * Awards anything the summary has just satisfied, and returns only what was *newly*
 * earned — so a caller can log or announce it without re-announcing on every render.
 *
 * A summary from a menu is ignored. The counters there are whatever the last level left
 * behind, which would hand out badges for a level the player is no longer on. Same
 * reasoning as `recordRun`.
 */
export function evaluateAchievements(namespace: string, summary: RunSummary, now = Date.now()): string[] {
	if (summary.state !== 'level') return [];

	const already = new Set(selectEarned.all(namespace).map((row) => row.id));
	const fresh: string[] = [];

	for (const achievement of ACHIEVEMENTS) {
		if (already.has(achievement.id) || !achievement.earned(summary)) continue;

		insertEarned.run(namespace, achievement.id, now);
		fresh.push(achievement.id);
	}

	return fresh;
}

export type EarnedAchievement = Achievement & { earnedAt?: number };

/** Every badge, earned or not, in display order. */
export function listAchievements(namespace: string): EarnedAchievement[] {
	const earned = new Map(selectEarned.all(namespace).map((row) => [row.id, row.earned_at]));
	return ACHIEVEMENTS.map((achievement) => ({ ...achievement, earnedAt: earned.get(achievement.id) }));
}

export function earnedCount(namespace: string): number {
	return selectEarned.all(namespace).length;
}
