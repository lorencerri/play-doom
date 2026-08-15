import { describe, expect, test } from 'bun:test';
import { formatTics, levelName, parseRunSummary } from '../src/render/summary.ts';

// What doomgeneric actually prints around the summary — the marker has to be found in
// this, not at a fixed position.
const REAL_STDOUT = [
	"Starting ffmpeg process: 'ffmpeg -nostats  -y -f rawvideo -framerate 20 -s 640x400 ...'",
	'frame = 1000, speed = 2841.00 frames/sec',
	'Writing 0 freeze frames ..',
	'DR_SUMMARY state=level episode=1 map=1 kills=2 totalkills=6 items=0 totalitems=37 secrets=0 totalsecrets=3 tics=455 health=100 dead=0 frames=494',
	'Terminating ..',
].join('\n');

describe('parseRunSummary', () => {
	test('pulls the summary out of real engine output', () => {
		expect(parseRunSummary(REAL_STDOUT)).toEqual({
			state: 'level',
			episode: 1,
			map: 1,
			kills: 2,
			totalKills: 6,
			items: 0,
			totalItems: 37,
			secrets: 0,
			totalSecrets: 3,
			tics: 455,
			health: 100,
			dead: false,
			frames: 494,
		});
	});

	test('reads the death flag', () => {
		const summary = parseRunSummary('DR_SUMMARY state=level episode=1 map=2 health=0 dead=1');
		expect(summary?.dead).toBe(true);
		expect(summary?.health).toBe(0);
	});

	test('reports a menu without inventing counters', () => {
		// Off a level those globals hold the previous level's values, so the engine
		// sends none — the parser must not fabricate them either.
		const summary = parseRunSummary('DR_SUMMARY state=menu frames=12');
		expect(summary).toEqual({ state: 'menu', frames: 12 });
	});

	test('takes the last summary when more than one is present', () => {
		const stdout = ['DR_SUMMARY state=level map=1', 'noise', 'DR_SUMMARY state=level map=9'].join('\n');
		expect(parseRunSummary(stdout)?.map).toBe(9);
	});

	test('is undefined when the engine printed no summary', () => {
		expect(parseRunSummary('Terminating ..\nframe = 1000')).toBeUndefined();
	});

	test('is undefined on an unrecognised state rather than guessing', () => {
		expect(parseRunSummary('DR_SUMMARY state=wat map=1')).toBeUndefined();
	});

	test('drops a malformed number instead of storing NaN', () => {
		// NaN would survive into SQLite and come back out of the API as null, with no
		// hint that the engine said something unparseable.
		const summary = parseRunSummary('DR_SUMMARY state=level map=abc kills=3');
		expect(summary?.map).toBeUndefined();
		expect(summary?.kills).toBe(3);
	});

	test('ignores unknown fields, so adding one in C does not break an old parser', () => {
		const summary = parseRunSummary('DR_SUMMARY state=level map=1 newfield=7');
		expect(summary).toEqual({ state: 'level', map: 1 });
	});

	test('tolerates trailing whitespace and carriage returns', () => {
		expect(parseRunSummary('DR_SUMMARY state=level map=3  \r\n')?.map).toBe(3);
	});
});

describe('levelName', () => {
	test('formats episode and map', () => {
		expect(levelName({ episode: 1, map: 3 })).toBe('E1M3');
	});

	test('is undefined when either half is missing', () => {
		expect(levelName({ episode: 1 })).toBeUndefined();
		expect(levelName({})).toBeUndefined();
	});
});

describe('formatTics', () => {
	test('converts at Doom 35hz tic rate', () => {
		expect(formatTics(35)).toBe('0:01');
		expect(formatTics(455)).toBe('0:13');
		expect(formatTics(35 * 61)).toBe('1:01');
	});

	test('pads seconds to two digits', () => {
		expect(formatTics(35 * 125)).toBe('2:05');
	});

	test('handles zero', () => {
		expect(formatTics(0)).toBe('0:00');
	});
});
