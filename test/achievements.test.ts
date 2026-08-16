import { beforeEach, describe, expect, test } from 'bun:test';
import { ACHIEVEMENTS, earnedCount, evaluateAchievements, listAchievements } from '../src/domain/achievements.ts';
import { db } from '../src/db.ts';
import { renderAchievementsCard } from '../src/render/achievements-card.ts';
import { achievementsRoute } from '../src/routes/achievements.ts';
import type { RunSummary } from '../src/render/summary.ts';

const ns = 'test_ach';
const params = { namespace: ns };

const onLevel = (over: Partial<RunSummary> = {}): RunSummary => ({ state: 'level', ...over });

beforeEach(() => {
	db.query('DELETE FROM achievements WHERE namespace = ?').run(ns);
});

describe('the badge set', () => {
	test('ids are unique and stable-looking', () => {
		// The id is the primary key of an earned row, so renaming one silently un-earns it
		// for every namespace that had it.
		const ids = ACHIEVEMENTS.map((a) => a.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*[a-z]$/);
	});

	test('every badge explains itself', () => {
		for (const badge of ACHIEVEMENTS) {
			expect(badge.name.length).toBeGreaterThan(0);
			expect(badge.hint.length).toBeGreaterThan(0);
		}
	});

	test('none of them fire on an untouched run', () => {
		// A fresh namespace should show ten things to aim at, not free points.
		const fresh = onLevel({ kills: 0, secrets: 0, items: 0, map: 1, tics: 0, health: 100, dead: false });
		expect(evaluateAchievements(ns, fresh)).toEqual([]);
	});
});

describe('earning', () => {
	test('awards what the summary satisfies', () => {
		const earned = evaluateAchievements(ns, onLevel({ kills: 1, health: 100 }));
		expect(earned).toContain('first-blood');
	});

	test('is idempotent, so re-rendering cannot re-award', () => {
		// A png and a gif of the same buffer both produce the same summary, and every
		// click re-renders — without the primary key this would insert on every one.
		const summary = onLevel({ kills: 5, totalKills: 5 });

		const first = evaluateAchievements(ns, summary);
		expect(first.length).toBeGreaterThan(0);
		expect(evaluateAchievements(ns, summary)).toEqual([]);
		expect(earnedCount(ns)).toBe(first.length);
	});

	test('survives a reset', () => {
		// Badges are a property of the namespace, not of the run in progress.
		evaluateAchievements(ns, onLevel({ kills: 1 }));
		db.query('DELETE FROM inputs WHERE namespace = ?').run(ns);
		expect(earnedCount(ns)).toBe(1);
	});

	test('ignores a summary from a menu', () => {
		// The counters on a menu are whatever the last level left behind, which would
		// award badges for a level the player is no longer on.
		expect(evaluateAchievements(ns, { state: 'menu', kills: 9, secrets: 9, map: 9 })).toEqual([]);
		expect(earnedCount(ns)).toBe(0);
	});

	test('does not hand out completion badges for a level with none of that thing', () => {
		// 0 === 0 is the trap: a level with no secrets would otherwise award
		// Completionist the moment you arrived on it.
		const barren = onLevel({ secrets: 0, totalSecrets: 0, items: 0, totalItems: 0, kills: 0, totalKills: 0 });

		const earned = evaluateAchievements(ns, barren);
		expect(earned).not.toContain('completionist');
		expect(earned).not.toContain('pack-rat');
		expect(earned).not.toContain('clean-sweep');
	});

	test('untouchable needs both the kills and the health', () => {
		expect(evaluateAchievements(ns, onLevel({ kills: 3, health: 99 }))).not.toContain('untouchable');
		expect(evaluateAchievements(ns, onLevel({ kills: 2, health: 100 }))).not.toContain('untouchable');
		expect(evaluateAchievements(ns, onLevel({ kills: 3, health: 100 }))).toContain('untouchable');
	});

	test('survivor is five minutes of tics, not frames', () => {
		// Doom runs at 35 tics per second; reading this as frames would award it in a
		// third of the time.
		expect(evaluateAchievements(ns, onLevel({ tics: 35 * 60 * 5 - 1 }))).not.toContain('survivor');
		expect(evaluateAchievements(ns, onLevel({ tics: 35 * 60 * 5 }))).toContain('survivor');
	});
});

describe('listing', () => {
	test('returns every badge, earned or not, in a stable order', () => {
		evaluateAchievements(ns, onLevel({ kills: 1 }));
		const listed = listAchievements(ns);

		expect(listed.length).toBe(ACHIEVEMENTS.length);
		expect(listed.map((b) => b.id)).toEqual(ACHIEVEMENTS.map((b) => b.id));
		expect(listed.find((b) => b.id === 'first-blood')?.earnedAt).toBeGreaterThan(0);
		expect(listed.find((b) => b.id === 'delver')?.earnedAt).toBeUndefined();
	});
});

describe('GET /achievements/:namespace', () => {
	function get(path: string): Request {
		return new Request(`http://localhost:6677${path}`);
	}

	test('renders a PNG by default', async () => {
		const res = await achievementsRoute(get(`/achievements/${ns}`), params);

		expect(res.headers.get('content-type')).toBe('image/png');
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(Array.from(bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
	});

	test('reports progress as JSON with ?image=false', async () => {
		evaluateAchievements(ns, onLevel({ kills: 1 }));

		const res = await achievementsRoute(get(`/achievements/${ns}?image=false`), params);
		const body = (await res.json()) as { earned: number; total: number; achievements: { id: string }[] };

		expect(body.earned).toBe(1);
		expect(body.total).toBe(ACHIEVEMENTS.length);
		expect(body.achievements.length).toBe(ACHIEVEMENTS.length);
	});

	test('rejects a namespace that could escape the data directory', () => {
		expect(achievementsRoute(get('/achievements/x'), { namespace: '../etc' })).rejects.toThrow(
			'Invalid characters in namespace.',
		);
	});

	test('renders for a namespace with nothing earned', async () => {
		// The README embeds this on the first page view, before anyone has played.
		expect((await renderAchievementsCard(listAchievements('test_ach_empty'))).length).toBeGreaterThan(0);
	});
});
