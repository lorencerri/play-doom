import { config } from '../config.ts';
import { encoderEnv } from './encoding.ts';
import { run } from './exec.ts';
import { parseRunSummary, type RunSummary } from './summary.ts';

// Frame renders replay at 20fps; videos at the engine's native 35. Both numbers
// are carried over from the original and affect how the gif reads on the README.
const FRAME_FRAMERATE = 20;
const VIDEO_FRAMERATE = 35;

// doomgeneric stops after this many recorded frames. A run long enough to hit it
// would be truncated, but 10000 frames is ~5 minutes of replay — same as before.
const VIDEO_MAX_FRAMES = 10_000;

type FrameOptions = {
	/** How many frames from the end of the run to record. */
	nrecord: number;
	/** Record every nth frame — 2 for gifs, so they cover twice the time. */
	nthframe: number;
	outputPath: string;
	input: string;
};

function doomArgs(opts: { nrecord: number; nthframe: number; framerate: number; outputPath: string; input: string }): string[] {
	// argv, not a shell string — `input` is user-supplied and used to go through /bin/sh.
	return [
		'-iwad', config.DOOM1_WAD,
		'-nrecord', String(opts.nrecord),
		'-nthframe', String(opts.nthframe),
		'-framerate', String(opts.framerate),
		'-render_frame',
		// Bare flag, so it must be omitted entirely rather than passed as `false`.
		...(config.FRAME_STATUS_OVERLAY ? ['-render_status'] : []),
		'-output', opts.outputPath,
		'-input', opts.input,
	];
}

/**
 * Both renders return the engine's end-of-replay summary when it reported one.
 *
 * A replay always runs to the end of the input, so the state it finishes in is the
 * namespace's current state — the summary is a by-product of work already being done,
 * not an extra pass. `undefined` means the engine printed nothing parseable, which
 * callers treat as "no update" rather than an error: a missing statistic must never
 * fail a render that otherwise produced a good frame.
 */
export async function renderFrame(opts: FrameOptions): Promise<RunSummary | undefined> {
	const stdout = await run(
		config.DOOMGENERIC_BIN,
		doomArgs({ ...opts, framerate: FRAME_FRAMERATE }),
		`doomgeneric frame → ${opts.outputPath}`,
		encoderEnv(),
	);

	return parseRunSummary(stdout);
}

export async function renderVideo(input: string, outputPath: string): Promise<RunSummary | undefined> {
	const stdout = await run(
		config.DOOMGENERIC_BIN,
		doomArgs({ nrecord: VIDEO_MAX_FRAMES, nthframe: 1, framerate: VIDEO_FRAMERATE, outputPath, input }),
		`doomgeneric video → ${outputPath}`,
		encoderEnv(),
		// A video re-encodes the entire run, so it needs its own budget — see the note
		// on VIDEO_TIMEOUT_MS. The frame budget killed this mid-encode.
		config.VIDEO_TIMEOUT_MS,
	);

	return parseRunSummary(stdout);
}
