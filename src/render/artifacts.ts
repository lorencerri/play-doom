import { createHash } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { config } from '../config.ts';
import { getInput, getInputString } from '../domain/input.ts';
import type { Filetype } from '../domain/keys.ts';
import { addSegment, clearSegments, listSegments, nextSeq } from '../domain/segments.ts';
import { getRenderHash, getState, setFlags, setRenderHash } from '../domain/state.ts';
import { logger } from '../logger.ts';
import { fileExists } from '../http/serve.ts';
import { renderFrame, renderVideo } from './doom.ts';
import { concat } from './ffmpeg.ts';
import { enqueue } from './queue.ts';

export const paths = {
	frame: (namespace: string, type: string) => `${config.DATA_DIR}/frame_${namespace}.${type}`,
	current: (namespace: string) => `${config.DATA_DIR}/current_${namespace}.mp4`,
	full: (namespace: string) => `${config.DATA_DIR}/full_${namespace}.mp4`,
	combined: (namespace: string) => `${config.DATA_DIR}/combined_${namespace}.mp4`,
	run: (namespace: string) => `${config.DATA_DIR}/run_${namespace}.mp4`,
	segment: (namespace: string, seq: number) => `${config.DATA_DIR}/seg_${namespace}_${seq}.mp4`,
	tmp: (namespace: string, name: string) => `${config.DATA_DIR}/tmp_${name}_${namespace}.mp4`,
};

// A gif covers the last batch of keys, capped so a 50x idle link doesn't produce a
// 50-frame animation. Carried over exactly — it decides how the README image reads.
const MAX_GIF_FRAMES = 16;

/**
 * Renders `frame_<ns>.<type>` if the input buffer has moved since it was last made,
 * and returns the path either way.
 *
 * The hash gate is the correctness check: identical input means the file on disk is
 * still the right answer. The `fileExists` half is new — the original trusted the
 * hash alone and would serve a file that had been deleted underneath it.
 */
export async function ensureFrame(namespace: string, type: Filetype): Promise<string> {
	// `getInput` is still needed for the last batch specifically: on an untouched
	// namespace it is the bootstrap prefix, and the gif length depends on that.
	const input = getInput(namespace);
	const joined = getInputString(namespace);
	const hash = createHash('md5').update(joined).digest('hex');

	const artifact = `frame.${type}`;
	const outputPath = paths.frame(namespace, type);

	const current = async () => getRenderHash(namespace, artifact) === hash && (await fileExists(outputPath));

	if (await current()) return outputPath;

	await enqueue(namespace, `frame:${type}`, async () => {
		// Re-check inside the queue: an eager render kicked off by the click and a
		// lazy one from the image request routinely race, and the loser should not
		// redo the work it was waiting on.
		if (await current()) return;

		const lastBatch = input[input.length - 1] ?? '';

		await renderFrame({
			nrecord: type === 'png' ? 1 : Math.min(lastBatch.length, MAX_GIF_FRAMES),
			nthframe: type === 'png' ? 1 : 2,
			outputPath,
			input: joined,
		});

		setRenderHash(namespace, artifact, hash);
	});

	return outputPath;
}

/**
 * Starts rendering the frame types listed in `EAGER_FRAME_TYPES` without waiting for
 * the result (plan 1.2).
 *
 * Rendering used to begin when GitHub's image proxy fetched the frame, which put a
 * full doomgeneric replay plus an encode on the viewer's critical path. Starting it
 * when the key is appended means the proxy usually finds a finished file, and the
 * click returns its redirect immediately either way.
 *
 * It warms one type rather than all of them because these jobs contend: they take
 * the same per-namespace mutex, so warming a png the README never requests simply
 * delays the gif it does. Types left out are not disabled, only deferred to
 * `ensureFrame` on the request that actually wants them.
 *
 * Errors terminate here on purpose. This is detached work behind an already-sent
 * response; the lazy path in `ensureFrame` will retry on the next request, and an
 * unhandled rejection from a detached job is what took the old process down
 * (crash cause #2).
 */
export function warmFrames(namespace: string): void {
	if (!config.EAGER_RENDER) return;

	for (const type of config.EAGER_FRAME_TYPES) {
		ensureFrame(namespace, type).catch((err) => {
			logger.warn({ namespace, type, err }, 'eager frame render failed');
		});
	}
}

/** Renders `current_<ns>.mp4` if the buffer has moved since it was last made. */
export async function ensureCurrentVideo(namespace: string): Promise<string> {
	const path = paths.current(namespace);

	if (!getState(namespace).current_video_outdated && (await fileExists(path))) return path;

	await enqueue(namespace, 'video:current', async () => {
		// Re-check inside the queue: several requests can arrive while one render is
		// already running, and they would otherwise each redo the same work.
		if (!getState(namespace).current_video_outdated && (await fileExists(path))) return;

		await renderVideo(getInputString(namespace), path);
		setFlags(namespace, { current_video_outdated: false });
	});

	return path;
}

/**
 * Folds any pending run segments into `full_<ns>.mp4` and returns it, or undefined
 * when the namespace has nothing archived at all.
 *
 * This is where the cost of archiving now lives. `archiveRun` writes one segment and
 * stops; the expensive whole-archive concat happens here, on the rare request for the
 * full video, instead of on every reset. An existing `full_<ns>.mp4` is folded in as
 * the first input, so archives written by the previous scheme carry over untouched.
 */
export async function ensureFullVideo(namespace: string): Promise<string | undefined> {
	const fullPath = paths.full(namespace);

	const settled = async () => (listSegments(namespace).length === 0 ? await fileExists(fullPath) : false);
	if (await settled()) return fullPath;

	await enqueue(namespace, 'video:fold', async () => {
		// Re-read inside the queue: an archive that was queued behind this request
		// may have added a segment, and concurrent readers should not fold twice.
		const segments = listSegments(namespace);
		if (segments.length === 0) return;

		const segmentPaths = segments.map((seq) => paths.segment(namespace, seq));
		const hasArchive = await fileExists(fullPath);

		if (!hasArchive && segmentPaths.length === 1) {
			// First run for this namespace: the segment already is the whole archive.
			await rename(segmentPaths[0]!, fullPath);
		} else {
			// Never concat straight onto fullPath — it is one of the inputs, and a
			// failure partway through would leave the archive truncated.
			const merged = paths.tmp(namespace, 'full');
			await concat(namespace, hasArchive ? [fullPath, ...segmentPaths] : segmentPaths, merged);
			await rename(merged, fullPath);
			await Promise.all(segmentPaths.map((path) => rm(path, { force: true })));
		}

		clearSegments(namespace, segments);
		setFlags(namespace, { full_video_outdated: false });
		logger.info({ namespace, segments: segments.length }, 'archive folded');
	});

	return (await fileExists(fullPath)) ? fullPath : undefined;
}

/** Rebuilds `combined_<ns>.mp4` from the archive plus the run in progress. */
export async function ensureCombinedVideo(namespace: string): Promise<string> {
	const path = paths.combined(namespace);

	if (!getState(namespace).combined_outdated && (await fileExists(path))) return path;

	await enqueue(namespace, 'video:combined', async () => {
		if (!getState(namespace).combined_outdated && (await fileExists(path))) return;

		await concat(namespace, [paths.full(namespace), paths.current(namespace)], path);
		setFlags(namespace, { combined_outdated: false });
	});

	return path;
}

/**
 * Renders the finished run and parks it as a segment for later folding.
 *
 * `input` is captured by the caller before the buffer is cleared, so a click that
 * lands during the render starts the next run without corrupting this one. Each run
 * gets its own segment file rather than reusing `current_<ns>.mp4`, which the
 * original renamed out from under whatever the new run had started writing there.
 *
 * This deliberately does *not* merge into the archive. Merging is O(everything ever
 * recorded) for O(one run) of new footage: on the live `github` namespace that meant
 * rewriting 623MB and 11.4s of disk on every reset, against a 30s subprocess timeout
 * that the archive would eventually outgrow. `ensureFullVideo` does the merge when
 * the full video is actually asked for.
 */
export async function archiveRun(namespace: string, input: string): Promise<void> {
	await enqueue(namespace, 'video:archive', async () => {
		const seq = nextSeq(namespace);
		const segmentPath = paths.segment(namespace, seq);

		await renderVideo(input, segmentPath);

		// Recorded only after a successful render, so a failed one leaves no row
		// pointing at a partial file — the orphan is overwritten by the next attempt,
		// which reuses this sequence number.
		addSegment(namespace, seq);

		setFlags(namespace, { full_video_outdated: true, combined_outdated: true });
		logger.info({ namespace, seq }, 'run archived as segment');
	});
}
