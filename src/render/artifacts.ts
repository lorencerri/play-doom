import { createHash } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { config } from '../config.ts';
import { evaluateAchievements } from '../domain/achievements.ts';
import { clearInput, getInput, getInputString, getStoredBatches } from '../domain/input.ts';
import { tokenize, type Filetype } from '../domain/keys.ts';
import { recordNamespaceStats } from '../domain/meta.ts';
import { addSegment, clearSegments, listSegments, nextSeq } from '../domain/segments.ts';
import { getRenderHash, getState, setFlags, setRenderHash } from '../domain/state.ts';
import { recordRun, setStatus } from '../domain/status.ts';
import { logger } from '../logger.ts';
import { overloaded } from '../http/errors.ts';
import { fileExists } from '../http/serve.ts';
import { renderFrame, renderVideo } from './doom.ts';
import { concat } from './ffmpeg.ts';
import { recordRenderFailure, recordRenderSuccess } from './health.ts';
import { enqueue, frameLane, QueueFullError, videoLane } from './queue.ts';
import { sliceScreen } from './screen.ts';

export const paths = {
	frame: (namespace: string, type: string) => `${config.DATA_DIR}/frame_${namespace}.${type}`,
	current: (namespace: string) => `${config.DATA_DIR}/current_${namespace}.mp4`,
	full: (namespace: string) => `${config.DATA_DIR}/full_${namespace}.mp4`,
	combined: (namespace: string) => `${config.DATA_DIR}/combined_${namespace}.mp4`,
	run: (namespace: string) => `${config.DATA_DIR}/run_${namespace}.mp4`,
	segment: (namespace: string, seq: number) => `${config.DATA_DIR}/seg_${namespace}_${seq}.mp4`,
	tmp: (namespace: string, name: string) => `${config.DATA_DIR}/tmp_${name}_${namespace}.mp4`,

	// The death cam and the partial it is renamed from. The `.gif` suffix has to survive
	// on the partial too: ffmpeg picks its muxer from the extension, so a `.part` ending
	// would fail to encode rather than merely look untidy.
	death: (namespace: string) => `${config.DATA_DIR}/death_${namespace}.gif`,
	deathPart: (namespace: string) => `${config.DATA_DIR}/death_${namespace}.part.gif`,
};

// A gif covers the last batch of keys, capped so a 50x idle link doesn't produce a
// 50-frame animation. Carried over exactly — it decides how the README image reads.
export const MAX_GIF_FRAMES = 16;

// Gifs record every other frame, so they cover twice the time for the same size.
export const GIF_NTHFRAME = 2;

/**
 * How many frames a gif must record to be guaranteed non-empty.
 *
 * doomgeneric writes a frame only when `frame_id % nthframe == 0`. Recording a single
 * frame at an odd index therefore writes *nothing*, ffmpeg is handed no input, and the
 * result is a 0-byte gif — which happened to roughly half of all single-key clicks,
 * the README's "Idle Frame" link among them. Recording at least `nthframe` frames
 * guarantees one of them lands on a multiple.
 */
export function gifFrameCount(lastBatch: string): number {
	return Math.max(GIF_NTHFRAME, Math.min(lastBatch.length, MAX_GIF_FRAMES));
}

/**
 * The rendering settings that change what a frame looks like.
 *
 * Folded into the cache key alongside the input, because the input alone is not what
 * determines the output. Caught in production: the bezel was added, and every existing
 * frame stayed on disk unchanged — the buffer had not moved, so the hash still matched
 * and nothing re-rendered. A namespace nobody was actively playing would have served a
 * pre-bezel image indefinitely. Any future setting that alters the picture belongs here.
 */
function renderFingerprint(): string {
	return [
		config.GIF_WIDTH,
		config.FRAME_BORDER,
		config.FRAME_STATUS_OVERLAY ? 'overlay' : 'plain',
	].join(':');
}

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
	const hash = createHash('md5').update(joined).update('\0').update(renderFingerprint()).digest('hex');

	const artifact = `frame.${type}`;
	const outputPath = paths.frame(namespace, type);

	const hashMatches = () => getRenderHash(namespace, artifact) === hash;
	const current = async () => hashMatches() && (await fileExists(outputPath));

	// The hash check is deliberately synchronous, and only a *match* falls through to
	// the async existence check. Awaiting unconditionally yielded the event loop before
	// this job reached the queue, which let `endRun` — which calls warmFrames and then
	// archiveRun — register the archive first. The frame then sat behind a whole run's
	// video encode, and README image requests hung for ~30s after every reset.
	if (hashMatches() && (await fileExists(outputPath))) return outputPath;

	try {
		await enqueue(frameLane(namespace), `frame:${type}`, async () => {
			// Re-check inside the queue: an eager render kicked off by the click and a
			// lazy one from the image request routinely race, and the loser should not
			// redo the work it was waiting on.
			if (await current()) return;

			const lastBatch = input[input.length - 1] ?? '';

			const summary = await renderFrame({
				nrecord: type === 'png' ? 1 : gifFrameCount(lastBatch),
				nthframe: type === 'png' ? 1 : GIF_NTHFRAME,
				outputPath,
				input: joined,
			});

			// An empty artifact is a failed render that reported success. doomgeneric
			// exits 0 even when it hands ffmpeg no frames, and marking that fresh would
			// cache a broken image behind the hash gate until the next input change.
			const size = Bun.file(outputPath).size;
			if (size === 0) throw new Error(`render produced an empty ${type} for ${namespace}`);

			// The replay just ran to the end of the buffer, so its final state is this
			// namespace's current state — recording it here costs nothing extra.
			//
			// `joined` is handed on rather than re-read: it is the input this replay
			// actually ran, so the death cam is a clip of the death just detected.
			if (summary) {
				if (setStatus(namespace, summary)) onDeath(namespace, joined);

				// Same report, a few comparisons, and at most one insert per badge ever.
				const earned = evaluateAchievements(namespace, summary);
				if (earned.length > 0) logger.info({ namespace, earned }, 'achievements earned');
			}

			setRenderHash(namespace, artifact, hash);
		});
		recordRenderSuccess(namespace);
	} catch (err) {
		// Any failed render, not just a saturated queue: a timed-out doomgeneric, an
		// ffmpeg that died, a full disk. In every case a previously rendered frame is
		// stale only by what arrived since, which beats a broken image on a profile
		// README that thousands of page views will hit.
		const stale = await fileExists(outputPath);
		recordRenderFailure(namespace, err, stale);

		if (stale) {
			logger.warn({ namespace, type, err }, 'render failed, serving the previous frame');
			return outputPath;
		}

		// Nothing usable on disk, so the caller has to hear about it. A saturated queue
		// is explicitly retryable; anything else is a genuine fault.
		if (err instanceof QueueFullError) throw overloaded('too many renders in progress, try again shortly');
		throw err;
	}

	return outputPath;
}

/**
 * Records a gif of the moments before a death.
 *
 * `input` is the exact buffer the render that detected the death replayed, passed down
 * rather than re-read: `AUTO_ARCHIVE_ON_DEATH` clears the buffer moments later, and a
 * clip of the *next* run's opening frames would be worse than no clip at all.
 *
 * ## Why this re-renders instead of trimming a video
 *
 * The obvious cheap path is `ffmpeg -sseof` on the tail of an mp4 that already exists.
 * It is not actually cheaper, and it does not work here.
 *
 * Not cheaper: this clip takes ~0.6–1.4s (measured on the VPS), and nearly all of that is
 * the gif palette pipeline over 48 frames — which a trim pays in full, because it has to
 * encode the same gif from the same number of frames. What trimming avoids is doomgeneric
 * startup plus the replay itself, ~50ms of the total: `DR_NeedRender` already skips
 * rendering every frame before the recorded tail, so simulating a live-length run costs
 * about 3ms. It buys a rounding error and adds a dependency on a second artifact.
 *
 * Does not work: the only video guaranteed to end at the death is the archive segment, and
 * `AUTO_ARCHIVE_ON_DEATH` is off by default, so on the live deployment no such file is
 * written until someone resets — by which point the tail is whatever they did after dying.
 *
 * Detached on purpose. This runs inside the frame lane, so awaiting a job on that same
 * lane would deadlock; and a failed clip must never fail the frame render that noticed
 * the death, which is on the README's critical path.
 */
function captureDeathCam(namespace: string, input: string): void {
	if (!config.DEATH_CAM) return;

	queueMicrotask(() => {
		enqueue(frameLane(namespace), 'frame:death', async () => {
			const partPath = paths.deathPart(namespace);

			await renderFrame({
				nrecord: config.DEATH_CAM_FRAMES,
				nthframe: GIF_NTHFRAME,
				outputPath: partPath,
				input,
			});

			// Same guard as the frame path: doomgeneric exits 0 having handed ffmpeg no
			// frames, and an empty gif would replace a good clip from an earlier death.
			if (Bun.file(partPath).size === 0) throw new Error(`death cam produced an empty gif for ${namespace}`);

			// Renamed into place rather than written there. This file is embedded in a
			// README and fetched constantly, so encoding straight to the served path
			// would hand somebody a half-written gif.
			await rename(partPath, paths.death(namespace));
			logger.info({ namespace }, 'death cam recorded');
		}).catch((err) => {
			logger.warn({ namespace, err }, 'death cam render failed');
			rm(paths.deathPart(namespace), { force: true }).catch(() => {});
		});
	});
}

/**
 * Called once per death, on the alive→dead transition rather than per dead frame.
 *
 * Ending the run automatically is opt-in. It changes how the game behaves for everyone
 * clicking the README — a run that would have been continued past the death screen now
 * ends — and that is the profile owner's call. Counting the death is not: it happened
 * either way.
 */
function onDeath(namespace: string, input: string): void {
	recordNamespaceStats(namespace, { deaths: 1 });
	logger.info({ namespace }, 'player died');

	captureDeathCam(namespace, input);

	if (!config.AUTO_ARCHIVE_ON_DEATH) return;

	// Deferred rather than awaited: this runs inside the namespace's render queue, and
	// archiving takes the same queue — awaiting it here would deadlock.
	queueMicrotask(() => {
		endRun(namespace).catch((err) => logger.error({ namespace, err }, 'auto-archive on death failed'));
	});
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

	// The clickable grid is cut from the png, so warming it is tied to the png already
	// being warmed rather than to a switch of its own. A README that still embeds the gif
	// pays nothing for a feature it does not use; one built around the grid gets it ahead
	// of the proxy by setting `EAGER_FRAME_TYPES=png`.
	if (config.EAGER_FRAME_TYPES.includes('png')) {
		ensureScreenTiles(namespace).catch((err) => {
			logger.warn({ namespace, err }, 'eager screen slice failed');
		});
	}
}

/**
 * Cuts the current frame into the grid of clickable tiles the README embeds.
 *
 * Lazy by default: the first tile request renders the png and slices it, and the other
 * thirty-odd requests of the same grid arrive while that is still running and wait on it.
 * That is the pre-eager-render behaviour, and it is the right default here — the cost only
 * lands on namespaces whose README actually asks for tiles.
 */
export async function ensureScreenTiles(namespace: string): Promise<void> {
	await sliceScreen(namespace, await ensureFrame(namespace, 'png'));
}

/** Renders `current_<ns>.mp4` if the buffer has moved since it was last made. */
export async function ensureCurrentVideo(namespace: string): Promise<string> {
	const path = paths.current(namespace);

	if (!getState(namespace).current_video_outdated && (await fileExists(path))) return path;

	await enqueue(videoLane(namespace), 'video:current', async () => {
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

	await enqueue(videoLane(namespace), 'video:fold', async () => {
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

	await enqueue(videoLane(namespace), 'video:combined', async () => {
		if (!getState(namespace).combined_outdated && (await fileExists(path))) return;

		await concat(namespace, [paths.full(namespace), paths.current(namespace)], path);
		setFlags(namespace, { combined_outdated: false });
	});

	return path;
}

/**
 * Ends the current run: clears the buffer, starts the next one, and archives what was
 * played. Returns whether there was anything to archive.
 *
 * Shared by the reset control and by `AUTO_ARCHIVE_ON_DEATH`, so a run ends the same
 * way however it ended. The buffer is captured before it is cleared, so a click landing
 * mid-archive starts the next run without corrupting this one.
 */
export async function endRun(namespace: string): Promise<boolean> {
	const stored = getStoredBatches(namespace);
	const finishedRun = getInputString(namespace);
	const hadPlay = stored.some((batch) => tokenize(batch).length > 0);

	clearInput(namespace);
	setFlags(namespace, { current_video_outdated: true, combined_outdated: true });
	recordNamespaceStats(namespace, { runs: hadPlay ? 1 : 0 });

	// Queued before the archive, and now actually so: frames and videos run in separate
	// lanes, and `ensureFrame` reaches the queue without awaiting first. Both were
	// needed — with either one missing, a reset left the README image hanging behind a
	// full run's video encode.
	warmFrames(namespace);

	if (hadPlay) {
		// Deliberately not awaited: archiving re-renders the whole run and the click
		// should return immediately. The job owns its errors, because an unhandled
		// rejection from detached work after the response was sent is what took the
		// old process down (crash cause #2).
		archiveRun(namespace, finishedRun).catch((err) => {
			logger.error({ namespace, err }, 'run archiving failed');
		});
	}

	return hadPlay;
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
	await enqueue(videoLane(namespace), 'video:archive', async () => {
		const seq = nextSeq(namespace);
		const segmentPath = paths.segment(namespace, seq);

		const summary = await renderVideo(input, segmentPath);

		// How the run that just ended actually went. This is the only moment it can be
		// captured: the buffer is already cleared, so nothing later can replay it.
		if (summary) recordRun(namespace, summary);

		// Recorded only after a successful render, so a failed one leaves no row
		// pointing at a partial file — the orphan is overwritten by the next attempt,
		// which reuses this sequence number.
		addSegment(namespace, seq);

		setFlags(namespace, { full_video_outdated: true, combined_outdated: true });
		logger.info({ namespace, seq }, 'run archived as segment');
	});
}
