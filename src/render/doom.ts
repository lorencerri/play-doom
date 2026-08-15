import { config } from '../config.ts';
import { encoderEnv } from './encoding.ts';
import { run } from './exec.ts';

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

export async function renderFrame(opts: FrameOptions): Promise<void> {
	await run(
		config.DOOMGENERIC_BIN,
		doomArgs({ ...opts, framerate: FRAME_FRAMERATE }),
		`doomgeneric frame → ${opts.outputPath}`,
		encoderEnv(),
	);
}

export async function renderVideo(input: string, outputPath: string): Promise<void> {
	await run(
		config.DOOMGENERIC_BIN,
		doomArgs({ nrecord: VIDEO_MAX_FRAMES, nthframe: 1, framerate: VIDEO_FRAMERATE, outputPath, input }),
		`doomgeneric video → ${outputPath}`,
		encoderEnv(),
	);
}
