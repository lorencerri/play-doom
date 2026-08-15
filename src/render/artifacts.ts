import { rename, rm } from 'node:fs/promises';
import { config } from '../config.ts';
import { getInput } from '../domain/input.ts';
import { getState, setFlags } from '../domain/state.ts';
import { logger } from '../logger.ts';
import { fileExists } from '../http/serve.ts';
import { renderVideo } from './doom.ts';
import { concat } from './ffmpeg.ts';
import { enqueue } from './queue.ts';

export const paths = {
	frame: (namespace: string, type: string) => `${config.DATA_DIR}/frame_${namespace}.${type}`,
	current: (namespace: string) => `${config.DATA_DIR}/current_${namespace}.mp4`,
	full: (namespace: string) => `${config.DATA_DIR}/full_${namespace}.mp4`,
	combined: (namespace: string) => `${config.DATA_DIR}/combined_${namespace}.mp4`,
	run: (namespace: string) => `${config.DATA_DIR}/run_${namespace}.mp4`,
	tmp: (namespace: string, name: string) => `${config.DATA_DIR}/tmp_${name}_${namespace}.mp4`,
};

/** Renders `current_<ns>.mp4` if the buffer has moved since it was last made. */
export async function ensureCurrentVideo(namespace: string): Promise<string> {
	const path = paths.current(namespace);

	if (!getState(namespace).current_video_outdated && (await fileExists(path))) return path;

	await enqueue(namespace, 'video:current', async () => {
		// Re-check inside the queue: several requests can arrive while one render is
		// already running, and they would otherwise each redo the same work.
		if (!getState(namespace).current_video_outdated && (await fileExists(path))) return;

		await renderVideo(getInput(namespace).join(''), path);
		setFlags(namespace, { current_video_outdated: false });
	});

	return path;
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
 * Renders the finished run and appends it to the namespace's archive.
 *
 * `input` is captured by the caller before the buffer is cleared, so a click that
 * lands during the render starts the next run without corrupting this one. The
 * render goes to its own `run_<ns>.mp4` rather than reusing `current_<ns>.mp4`,
 * which the original renamed out from under whatever the new run had started
 * writing there.
 */
export async function archiveRun(namespace: string, input: string): Promise<void> {
	await enqueue(namespace, 'video:archive', async () => {
		const runPath = paths.run(namespace);
		const fullPath = paths.full(namespace);

		await renderVideo(input, runPath);

		if (await fileExists(fullPath)) {
			const merged = paths.tmp(namespace, 'full');
			await concat(namespace, [fullPath, runPath], merged);
			await rename(merged, fullPath);
			await rm(runPath, { force: true });
		} else {
			await rename(runPath, fullPath);
		}

		setFlags(namespace, { full_video_outdated: false, combined_outdated: true });
		logger.info({ namespace }, 'run archived');
	});
}
