import { config } from '../config.ts';

/**
 * Encoder settings for doomgeneric.
 *
 * doomgeneric pipes raw BGRA frames into an ffmpeg it starts itself, and until the
 * phase 3 patch the arguments for that ffmpeg were compiled into
 * `vendor/doomreplay/doomgeneric/doomgeneric_dr.c`. It now reads them from
 * `DR_FFMPEG_ARGS_{MP4,GIF,PNG}`, falling back to the original strings when unset —
 * so an old binary with a new API still runs, it just encodes the old way.
 *
 * These are *output-side* arguments: they sit between ffmpeg's `-i -` and the
 * output path. Input framerate and frame size stay owned by the C, which is the
 * only side that knows them.
 *
 * ## Shell quoting
 *
 * The C builds one string and hands it to `popen`, i.e. to `/bin/sh`. A gif
 * filtergraph contains `;` and `[` `]`, which a shell would happily interpret, so
 * the filter argument is wrapped in double quotes here. `shellArg` enforces that
 * the values which need quoting cannot contain anything that escapes them.
 */

/**
 * Wraps a value in double quotes, rejecting characters that would break out of
 * them. Nothing here is user-supplied — these strings are built from config — but
 * the failure mode of getting it wrong is a mangled shell command, so it is checked
 * rather than assumed.
 */
export function shellArg(value: string): string {
	if (/["$`\\\n]/.test(value)) {
		throw new Error(`ffmpeg argument is not safe to quote: ${value}`);
	}
	return `"${value}"`;
}

/**
 * The gif filtergraph: generate a palette from the clip, then apply it.
 *
 * The original encoded with `-pix_fmt bgr8`, a fixed 3-3-2 RGB palette — every
 * frame written in full against colours that mostly are not in the frame. That is
 * what made the README gif 850KB. `stats_mode=diff` weights the palette toward
 * what actually moves, and `diff_mode=rectangle` lets the encoder rewrite only the
 * changed rectangle per frame instead of the whole canvas.
 *
 * Both passes run over one piped input, so ffmpeg buffers the clip to generate the
 * palette before applying it. That is fine at the sizes involved — a frame gif is
 * capped at 16 frames (routes/frame.ts), about 16MB of raw BGRA.
 */
export function gifFilterComplex(gifWidth: number): string {
	const chain: string[] = [];

	// Native render is 640x400 (a 2x upscale of Doom's 320x200). Downscaling is a
	// straight 4x cut in pixels through encode and transfer, but it also halves the
	// overlay text doomgeneric draws, so it is off by default until it has been
	// eyeballed against the README. Plan 1.3.
	if (gifWidth > 0) chain.push(`scale=${gifWidth}:-1:flags=lanczos`);

	chain.push('split[a][b]');

	return [
		chain.join(','),
		'[a]palettegen=stats_mode=diff[p]',
		'[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
	].join(';');
}

export type EncoderOptions = {
	ffmpegBin: string;
	gifWidth: number;
	mp4Preset: string;
	mp4Crf: number;
};

/**
 * Environment for a doomgeneric process. Every entry drops the `-threads 1` the
 * original hardcoded — it serialised encoding onto one core while the render queue
 * was already bounding concurrency at a higher level (plan 1.3, 1.4).
 *
 * Takes its settings as an argument rather than reading `config` directly so the
 * produced command fragments can be asserted against without a live environment.
 */
export function buildEncoderEnv(opts: EncoderOptions): Record<string, string> {
	return {
		DR_FFMPEG_BIN: opts.ffmpegBin,

		// h264 with no preset and no -crf meant ffmpeg's defaults (medium, crf 23) on
		// a single thread, for videos up to 10000 frames long. Plan 1.4.
		DR_FFMPEG_ARGS_MP4: [
			'-vcodec h264',
			`-preset ${opts.mp4Preset}`,
			`-crf ${opts.mp4Crf}`,
			'-pix_fmt yuv420p',
		].join(' '),

		// `-loop -1` is preserved deliberately: in ffmpeg's gif muxer that disables
		// looping, which is what the freeze frames doomgeneric appends are for.
		DR_FFMPEG_ARGS_GIF: `-filter_complex ${shellArg(gifFilterComplex(opts.gifWidth))} -loop -1`,

		DR_FFMPEG_ARGS_PNG: '-pix_fmt rgb24',
	};
}

export function encoderEnv(): Record<string, string> {
	return buildEncoderEnv({
		ffmpegBin: config.FFMPEG_BIN,
		gifWidth: config.GIF_WIDTH,
		mp4Preset: config.MP4_PRESET,
		mp4Crf: config.MP4_CRF,
	});
}
