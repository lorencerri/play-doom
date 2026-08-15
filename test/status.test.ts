import { beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../src/db.ts';
import { bestRun, getStatus, recentRuns, recordRun, setStatus } from '../src/domain/status.ts';
import type { RunSummary } from '../src/render/summary.ts';

const ns = 'test_status';

const alive: RunSummary = { state: 'level', episode: 1, map: 1, kills: 3, totalKills: 6, health: 100, dead: false };
const dead: RunSummary = { ...alive, health: 0, dead: true };

beforeEach(() => {
	db.query('DELETE FROM namespace_status WHERE namespace = ?').run(ns);
	db.query('DELETE FROM run_history WHERE namespace = ?').run(ns);
});

describe('setStatus death detection', () => {
	test('reports the alive to dead transition', () => {
		expect(setStatus(ns, alive)).toBe(false);
		expect(setStatus(ns, dead)).toBe(true);
	});

	test('does not report a death twice for the same one', () => {
		// A png and a gif of the same buffer both report the same death, and any
		// re-render would too. Counting the state rather than the transition would
		// inflate the total every time.
		setStatus(ns, alive);
		expect(setStatus(ns, dead)).toBe(true);
		expect(setStatus(ns, dead)).toBe(false);
	});

	test('re-arms after a rewind back to being alive', () => {
		setStatus(ns, dead);
		setStatus(ns, alive);
		expect(setStatus(ns, dead)).toBe(true);
	});

	test('counts a death seen on the very first render of a namespace', () => {
		expect(setStatus(ns, dead)).toBe(true);
	});

	test('a menu summary is not a death', () => {
		expect(setStatus(ns, { state: 'menu', frames: 12 })).toBe(false);
	});
});

describe('status round-trip', () => {
	test('stores and returns the engine values', () => {
		setStatus(ns, alive);

		const status = getStatus(ns);
		expect(status?.state).toBe('level');
		expect(status?.kills).toBe(3);
		expect(status?.totalKills).toBe(6);
		expect(status?.dead).toBe(false);
	});

	test('absent fields come back undefined, not null or NaN', () => {
		setStatus(ns, { state: 'menu' });

		const status = getStatus(ns);
		expect(status?.episode).toBeUndefined();
		expect(status?.kills).toBeUndefined();
	});

	test('is undefined for a namespace that has never rendered', () => {
		expect(getStatus('test_status_never')).toBeUndefined();
	});
});

describe('run history', () => {
	test('does not record a run that ended on a menu', () => {
		// The counters there hold whatever the last level left behind.
		recordRun(ns, { state: 'menu', frames: 40 });
		expect(recentRuns(ns)).toEqual([]);
	});

	test('returns finished runs most recent first', () => {
		recordRun(ns, { ...alive, map: 1 });
		recordRun(ns, { ...alive, map: 2 });

		expect(recentRuns(ns).map((run) => run.map)).toEqual([2, 1]);
	});

	test('ranks the best run by furthest level, then kills', () => {
		recordRun(ns, { state: 'level', episode: 1, map: 3, kills: 1 });
		recordRun(ns, { state: 'level', episode: 1, map: 1, kills: 40 });

		// Getting further matters more than a high score on an early level.
		expect(bestRun(ns)?.map).toBe(3);
	});

	test('breaks a level tie on kills', () => {
		recordRun(ns, { state: 'level', episode: 1, map: 2, kills: 5 });
		recordRun(ns, { state: 'level', episode: 1, map: 2, kills: 9 });

		expect(bestRun(ns)?.kills).toBe(9);
	});

	test('has no best run before anything is recorded', () => {
		expect(bestRun(ns)).toBeUndefined();
	});
});
