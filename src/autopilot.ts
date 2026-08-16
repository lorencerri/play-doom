import { config } from './config.ts';
import { getActivity, idleNamespaces, recordBotActivity, type ActivityWindow } from './domain/activity.ts';
import { appendBatch, getInputString } from './domain/input.ts';
import { tokenize } from './domain/keys.ts';
import { recordNamespaceStats } from './domain/meta.ts';
import { getStatus } from './domain/status.ts';
import { setFlags } from './domain/state.ts';
import { logger } from './logger.ts';
import { endRun, warmFrames } from './render/artifacts.ts';

/**
 * A bot that plays badly so the game never stops.
 *
 * The failure this fixes is quiet and permanent: a run ends up dead, or wedged against a
 * wall, and because the only way anything moves is somebody clicking a README link, it
 * stays exactly like that forever. The gif on the profile becomes a photograph. A bot
 * that wanders, opens doors, shoots at nothing and resets when it dies is worth more here
 * than a bot that plays well — the point is motion, not progress.
 *
 * It only ever acts on namespaces no *person* has touched for hours, so it cannot take a
 * turn away from someone who is actually playing.
 */

/** Weighted move table. Every entry is a run of one key, which is all Doom needs. */
type Move = { key: string; min: number; max: number; weight: number };

/**
 * Deliberately clumsy, and weighted the way it is for a reason.
 *
 * Forward dominates because a bot that mostly turns spins on the spot and the gif never
 * changes scenery — which is the exact failure this exists to fix, reproduced by the fix.
 * Use is over-represented relative to how often a person presses it because progress in
 * Doom is gated on doors, and a bot that never opens one is stuck in the first room for
 * good. Fire is in partly for motion and partly because shooting a barrel is a fine way
 * to die, and dying resets the run.
 */
const MOVES: Move[] = [
	{ key: 'u', min: 10, max: 25, weight: 42 },
	{ key: 'l', min: 3, max: 12, weight: 14 },
	{ key: 'r', min: 3, max: 12, weight: 14 },
	{ key: 'p', min: 1, max: 3, weight: 12 },
	{ key: 'f', min: 1, max: 4, weight: 9 },
	{ key: 'j', min: 4, max: 10, weight: 4 },
	{ key: 'k', min: 4, max: 10, weight: 4 },
	{ key: ',', min: 5, max: 15, weight: 1 },
];

const TOTAL_WEIGHT = MOVES.reduce((sum, move) => sum + move.weight, 0);

/** How many moves make up one turn. Enough to look like intent, short enough to be cheap. */
const MOVES_PER_TURN = 3;

/** `n` frames of one key. Idle is a bare separator, not a key plus one. */
function repeat(key: string, n: number): string {
	return key === ',' ? ','.repeat(n) : `${key},`.repeat(n);
}

function pick(random: () => number): Move {
	let roll = random() * TOTAL_WEIGHT;
	for (const move of MOVES) {
		roll -= move.weight;
		if (roll < 0) return move;
	}
	// Only reachable on a random() that returns exactly 1, which the contract excludes.
	return MOVES[0]!;
}

/**
 * One turn's worth of input.
 *
 * Takes its randomness as an argument so the policy can be tested against a fixed
 * sequence rather than sampled and hoped about.
 */
export function chooseKeys(random: () => number = Math.random): string {
	let keys = '';

	for (let i = 0; i < MOVES_PER_TURN; i++) {
		const move = pick(random);
		const count = move.min + Math.floor(random() * (move.max - move.min + 1));
		keys += repeat(move.key, count);
	}

	return keys;
}

function window(): ActivityWindow {
	return {
		idleMs: config.AUTOPILOT_IDLE_HOURS * 3600_000,
		intervalMs: config.AUTOPILOT_EVERY_MINUTES * 60_000,
		abandonMs: config.AUTOPILOT_ABANDON_DAYS * 86_400_000,
	};
}

/**
 * Plays one turn for one namespace.
 *
 * Exported for tests and for a manual nudge; the scheduler below is the only production
 * caller. Returns what it did, so a caller can assert on the decision rather than on the
 * side effects.
 */
export async function playTurn(namespace: string, random: () => number = Math.random): Promise<'reset' | 'moved'> {
	// Always mark the attempt, whatever it turns into. Recording this only on the happy
	// path would let a namespace that throws every turn be retried on every scan.
	recordBotActivity(namespace);

	const status = getStatus(namespace);
	const buffered = tokenize(getInputString(namespace)).length;

	// Two ways a run stops being playable: the player is dead, or the buffer has hit the
	// ceiling and nothing more can be appended. Both end the same way — archive it and
	// start again — and this is the whole reason the bot exists, because a dead run left
	// alone stays dead for as long as nobody visits.
	if (status?.dead === true || buffered >= config.MAX_BUFFER_TOKENS) {
		await endRun(namespace);
		recordNamespaceStats(namespace, { botActions: 1 });
		logger.info({ namespace, dead: status?.dead === true, buffered }, 'autopilot ended the run');
		return 'reset';
	}

	// A menu left open swallows movement keys, so back out of it before playing. This is
	// the state a person leaves behind by clicking SELECT and wandering off.
	const keys = status?.state === 'menu' ? 'x,' : chooseKeys(random);

	appendBatch(namespace, keys);
	setFlags(namespace, { current_video_outdated: true, combined_outdated: true });

	// Counted apart from the human totals on purpose. `actions`, `keys_pressed` and the
	// unique-player count are meant to answer "how much have people played this", and
	// folding a tireless bot into them would make that number meaningless within a week.
	recordNamespaceStats(namespace, { botActions: 1 });

	logger.info({ namespace, keys: keys.length }, 'autopilot moved');

	warmFrames(namespace);
	return 'moved';
}

/** One pass over every namespace due a turn. Returns how many it played. */
export async function runOnce(now = Date.now()): Promise<number> {
	const due = idleNamespaces(window(), now);
	if (due.length === 0) return 0;

	// Serially, not in parallel: each turn queues a render, and firing every idle
	// namespace at once would hand the render queue a burst that competes with whoever
	// is actually playing right now on some other namespace.
	for (const namespace of due) {
		try {
			await playTurn(namespace);
		} catch (err) {
			// One namespace failing must not stop the rest. The activity stamp is already
			// written, so a namespace that throws every turn backs off to one attempt per
			// interval rather than spinning.
			logger.warn({ namespace, err }, 'autopilot turn failed');
		}
	}

	return due.length;
}

/** How often to look for namespaces due a turn — not how often any one of them moves. */
const SCAN_INTERVAL_MS = 5 * 60_000;

export function startAutopilot(): void {
	if (!config.AUTOPILOT) return;

	const { idleMs, intervalMs, abandonMs } = window();
	logger.info(
		{ idleHours: idleMs / 3600_000, everyMinutes: intervalMs / 60_000, abandonDays: abandonMs / 86_400_000 },
		'autopilot enabled',
	);

	const timer = setInterval(() => {
		runOnce().catch((err) => logger.error({ err }, 'autopilot scan failed'));
	}, SCAN_INTERVAL_MS);

	// The server keeps the process alive; this should not be the reason it stays up.
	timer.unref();
}

export { getActivity };
