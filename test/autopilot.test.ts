import { beforeEach, describe, expect, test } from 'bun:test';
import { chooseKeys, playTurn, runOnce } from '../src/autopilot.ts';
import { schema } from '../src/config.ts';
import { getActivity, idleNamespaces, recordBotActivity, recordHumanActivity } from '../src/domain/activity.ts';
import { clearInput, getStoredBatches } from '../src/domain/input.ts';
import { getMetaStats } from '../src/domain/meta.ts';
import { tokenize, validateKeys } from '../src/domain/keys.ts';
import { db } from '../src/db.ts';

const HOUR = 3600_000;
const DAY = 86_400_000;

const WINDOW = { idleMs: 24 * HOUR, intervalMs: HOUR, abandonMs: 30 * DAY };

/** A random() that walks a fixed sequence, so the policy is examined rather than sampled. */
function sequence(values: number[]): () => number {
	let i = 0;
	return () => values[i++ % values.length]!;
}

function setActivity(namespace: string, human: number | null, bot: number | null): void {
	db.query('INSERT OR IGNORE INTO namespace_state (namespace, updated_at) VALUES (?, ?)').run(namespace, Date.now());
	db.query('UPDATE namespace_state SET last_human_at = ?, last_bot_at = ? WHERE namespace = ?').run(
		human,
		bot,
		namespace,
	);
}

describe('the move policy', () => {
	test('only ever emits keys the input validator accepts', () => {
		// The bot writes straight to the buffer, bypassing the HTTP validation every human
		// keypress goes through. A typo in the move table would put input in the database
		// that no replay can parse.
		for (let i = 0; i < 200; i++) {
			expect(() => validateKeys(chooseKeys())).not.toThrow();
		}
	});

	test('emits whole frames, never a dangling key', () => {
		for (let i = 0; i < 100; i++) {
			const keys = chooseKeys();
			expect(tokenize(keys).join('')).toBe(keys);
		}
	});

	test('idle frames are bare separators, not doubled', () => {
		// `,` is a whole frame on its own. Repeating it through the general `${key},` form
		// would emit two separators per frame and wait twice as long as intended — the
		// same bug the README's "wait xN" links had.
		//
		// 0.999 lands on the last row of the move table (idle) and 0 takes its minimum,
		// so three moves of five idle frames is exactly fifteen separators.
		const keys = chooseKeys(sequence([0.999, 0]));

		expect(keys).toBe(','.repeat(15));
		expect(tokenize(keys).length).toBe(15);
	});

	test('walks forward far more than it turns', () => {
		// A bot that mostly turns spins on the spot, and the gif never changes scenery —
		// which is the exact failure this feature exists to fix.
		let forward = 0;
		let turning = 0;

		for (let i = 0; i < 2000; i++) {
			const keys = chooseKeys();
			forward += (keys.match(/u/g) ?? []).length;
			turning += (keys.match(/[lr]/g) ?? []).length;
		}

		expect(forward).toBeGreaterThan(turning);
	});
});

describe('idle selection', () => {
	beforeEach(() => {
		db.query('DELETE FROM namespace_state WHERE namespace LIKE ?').run('test_ap%');
	});

	test('ignores a namespace a person is still playing', () => {
		setActivity('test_ap_live', Date.now() - HOUR, null);
		expect(idleNamespaces(WINDOW)).not.toContain('test_ap_live');
	});

	test('picks up a namespace nobody has touched for a day', () => {
		setActivity('test_ap_idle', Date.now() - 25 * HOUR, null);
		expect(idleNamespaces(WINDOW)).toContain('test_ap_idle');
	});

	test('gives up on a namespace nobody has touched in a month', () => {
		// Otherwise every namespace ever created is played forever, and the cost of the
		// feature grows with how many existed rather than how many are still read.
		setActivity('test_ap_dead', Date.now() - 40 * DAY, null);
		expect(idleNamespaces(WINDOW)).not.toContain('test_ap_dead');
	});

	test('waits out the interval between its own turns', () => {
		setActivity('test_ap_recent', Date.now() - 25 * HOUR, Date.now() - 5 * 60_000);
		expect(idleNamespaces(WINDOW)).not.toContain('test_ap_recent');

		setActivity('test_ap_recent', Date.now() - 25 * HOUR, Date.now() - 2 * HOUR);
		expect(idleNamespaces(WINDOW)).toContain('test_ap_recent');
	});

	test('never plays a namespace no person has ever touched', () => {
		setActivity('test_ap_virgin', null, null);
		expect(idleNamespaces(WINDOW)).not.toContain('test_ap_virgin');
	});
});

describe('human activity holds the bot off', () => {
	test('a rewind counts as attention, not just an append', () => {
		// Somebody watching the game is somebody the bot should not interrupt, even when
		// what they did removed input rather than adding it.
		setActivity('test_ap_rewound', Date.now() - 25 * HOUR, null);
		expect(idleNamespaces(WINDOW)).toContain('test_ap_rewound');

		recordHumanActivity('test_ap_rewound');
		expect(idleNamespaces(WINDOW)).not.toContain('test_ap_rewound');
	});

	test('the bot marking itself does not look like a person', () => {
		recordBotActivity('test_ap_botonly');
		expect(getActivity('test_ap_botonly').lastHumanAt).toBeUndefined();
		expect(getActivity('test_ap_botonly').lastBotAt).toBeGreaterThan(0);
	});
});

describe('taking a turn', () => {
	const ns = 'test_ap_turn';

	beforeEach(() => {
		clearInput(ns);
		db.query('DELETE FROM namespace_status WHERE namespace = ?').run(ns);
		db.query('DELETE FROM namespace_stats WHERE namespace = ?').run(ns);
	});

	test('appends playable input and stamps itself', async () => {
		expect(await playTurn(ns, sequence([0.1, 0.5]))).toBe('moved');

		const batches = getStoredBatches(ns);
		expect(batches.length).toBe(1);
		expect(() => validateKeys(batches[0]!)).not.toThrow();
		expect(getActivity(ns).lastBotAt).toBeGreaterThan(0);
	});

	test('its turns are counted apart from what people did', async () => {
		await playTurn(ns, sequence([0.1, 0.5]));

		const stats = getMetaStats().namespaces.find((row) => row.namespace === ns);

		// Folding a tireless bot into `actions` would make "how much have people played
		// this" meaningless within a week.
		expect(stats?.botActions).toBe(1);
		expect(stats?.actions).toBe(0);
		expect(stats?.keysPressed).toBe(0);
	});

	test('backs out of a menu instead of walking into it', async () => {
		// An open menu swallows movement keys, which is the state a person leaves behind
		// by clicking SELECT and wandering off.
		db.query(
			'INSERT INTO namespace_status (namespace, state, updated_at) VALUES (?, ?, ?) ON CONFLICT (namespace) DO UPDATE SET state = excluded.state',
		).run(ns, 'menu', Date.now());

		await playTurn(ns);
		expect(getStoredBatches(ns)).toEqual(['x,']);
	});

	test('does not count a turn it never took', async () => {
		// Nothing is due, so nothing should move.
		db.query('DELETE FROM namespace_state WHERE namespace LIKE ?').run('test_ap%');
		expect(await runOnce()).toBe(0);
	});
});

describe('autopilot configuration', () => {
	test('is off unless asked for', () => {
		// It visibly changes what the game does on somebody's profile, which is the
		// profile owner's call — same reasoning as AUTO_ARCHIVE_ON_DEATH.
		expect(schema.parse({}).AUTOPILOT).toBe(false);
		expect(schema.parse({ AUTOPILOT: 'true' }).AUTOPILOT).toBe(true);
	});

	test('idles for a day and gives up after a month', () => {
		const parsed = schema.parse({});
		expect(parsed.AUTOPILOT_IDLE_HOURS).toBe(24);
		expect(parsed.AUTOPILOT_EVERY_MINUTES).toBe(60);
		expect(parsed.AUTOPILOT_ABANDON_DAYS).toBe(30);
	});

	test('the abandon bound must outlast the idle wait', () => {
		// Inverted, nothing would ever be eligible: every namespace would cross the
		// abandon line before it crossed the idle one.
		const parsed = schema.parse({});
		expect(parsed.AUTOPILOT_ABANDON_DAYS * 24).toBeGreaterThan(parsed.AUTOPILOT_IDLE_HOURS);
	});
});
