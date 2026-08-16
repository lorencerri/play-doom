import { rm } from 'node:fs/promises';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { logger } from '../logger.ts';
import { listSegments, clearSegments } from './segments.ts';
import { paths } from '../render/artifacts.ts';

/**
 * Reclaims the video of namespaces nobody is playing any more.
 *
 * This exists because of the generator page. One person with one namespace is a rounding
 * error — the live `github` archive is 623MB after four years, and that is fine. Let
 * strangers create namespaces and the same growth arrives once per stranger, forever,
 * with nothing ever releasing it.
 *
 * ## What it deletes, and what it deliberately does not
 *
 * Only the mp4s: `current_`, `full_`, `combined_` and any unfolded `seg_`. Those are all
 * of the size and none of the page. The gif, the png and the death cam stay, so an
 * abandoned profile still renders — a sweep that left broken images on somebody's README
 * would be worse than the disk it saved. The frame is regenerable from the buffer anyway;
 * the death cam is not, and it is ~600KB against hundreds of megabytes of video.
 *
 * The input buffer, the stats, the run history and the achievements are never touched.
 * They are kilobytes, and they are the parts that cannot be rebuilt.
 *
 * ## Why idleness rather than a size cap
 *
 * A rolling byte cap would bound *active* namespaces too, which sounds tidier until you
 * notice what it means: the archive of somebody who is still playing gets truncated from
 * the front, and that footage is not recoverable. Deleting the video of a namespace no
 * human has touched in three months costs nothing anyone will miss, and it leaves
 * everybody who is still playing completely alone however large they grow.
 */

const selectStale = db.query<{ namespace: string }, [number]>(
	'SELECT namespace FROM namespace_state WHERE last_human_at IS NOT NULL AND last_human_at <= ?',
);

export type SweepResult = { namespaces: number; files: number; bytes: number };

/**
 * Deletes the video of every namespace idle for longer than `RETAIN_VIDEO_DAYS`.
 *
 * Idleness is measured off `last_human_at`, the same signal the autopilot uses — so a
 * namespace the bot is keeping alive still counts as abandoned, which is correct. The bot
 * playing to itself for three months is not a reason to keep 600MB of it.
 */
export async function sweepIdleVideo(now = Date.now()): Promise<SweepResult> {
	const cutoff = now - config.RETAIN_VIDEO_DAYS * 86_400_000;
	const result: SweepResult = { namespaces: 0, files: 0, bytes: 0 };

	for (const { namespace } of selectStale.all(cutoff)) {
		const segments = listSegments(namespace);

		const candidates = [
			paths.current(namespace),
			paths.full(namespace),
			paths.combined(namespace),
			...segments.map((seq) => paths.segment(namespace, seq)),
		];

		let removed = 0;
		for (const path of candidates) {
			const file = Bun.file(path);
			if (!(await file.exists())) continue;

			result.bytes += file.size;
			await rm(path, { force: true });
			removed += 1;
		}

		if (removed === 0) continue;

		// The rows have to go with the files. A segment row pointing at a deleted mp4
		// would make the next fold concat a missing input and fail the whole archive.
		if (segments.length > 0) clearSegments(namespace, segments);

		// Everything video-shaped is gone, so nothing on disk is current any more. Left
		// unset, a later request would serve a 404 from a flag that said the file was fine.
		db.query('UPDATE namespace_state SET current_video_outdated = 1, full_video_outdated = 1, combined_outdated = 1 WHERE namespace = ?').run(
			namespace,
		);

		result.namespaces += 1;
		result.files += removed;
	}

	if (result.namespaces > 0) {
		logger.info(
			{ ...result, megabytes: Math.round(result.bytes / 1_048_576), idleDays: config.RETAIN_VIDEO_DAYS },
			'swept idle video',
		);
	}

	return result;
}

/** Once a day is far more often than a 90-day cutoff needs; it is cheap and it self-heals. */
const SWEEP_INTERVAL_MS = 24 * 3600_000;

export function startRetentionSweep(): void {
	if (config.RETAIN_VIDEO_DAYS <= 0) {
		logger.info('video retention sweep disabled');
		return;
	}

	logger.info({ retainDays: config.RETAIN_VIDEO_DAYS }, 'video retention sweep enabled');

	// Once at startup as well as on the interval: a box that restarts daily would
	// otherwise never reach the first tick.
	sweepIdleVideo().catch((err) => logger.error({ err }, 'retention sweep failed'));

	setInterval(() => {
		sweepIdleVideo().catch((err) => logger.error({ err }, 'retention sweep failed'));
	}, SWEEP_INTERVAL_MS).unref();
}
