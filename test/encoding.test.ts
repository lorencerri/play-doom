import { describe, expect, test } from 'bun:test';
import { buildEncoderEnv, gifFilterComplex, shellArg } from '../src/render/encoding.ts';

const opts = { ffmpegBin: 'ffmpeg', gifWidth: 0, mp4Preset: 'veryfast', mp4Crf: 23 };

describe('shellArg', () => {
	test('quotes a filtergraph', () => {
		expect(shellArg('split[a][b];[a]palettegen[p]')).toBe('"split[a][b];[a]palettegen[p]"');
	});

	test.each(['say "hi"', 'cost $HOME', 'a`b`c', 'a\\b', 'a\nb'])('rejects %j', (value) => {
		// These values reach a shell through popen in doomgeneric_dr.c. Quoting them
		// is what keeps `;` and `[` in the filtergraph from being interpreted, so a
		// value that could escape the quotes has to fail loudly rather than produce a
		// subtly wrong command line.
		expect(() => shellArg(value)).toThrow('not safe to quote');
	});
});

describe('gifFilterComplex', () => {
	test('is a two-pass palette pipeline', () => {
		const filter = gifFilterComplex(0);

		// The point of plan 1.3: generate a palette from the clip and apply it,
		// instead of the fixed 3-3-2 palette `-pix_fmt bgr8` gave.
		expect(filter).toContain('palettegen=stats_mode=diff');
		expect(filter).toContain('paletteuse=');
		expect(filter).toContain('diff_mode=rectangle');
	});

	test('does not scale at width 0', () => {
		// Anchored: a bare `scale=` also matches paletteuse's `bayer_scale=`.
		expect(gifFilterComplex(0)).not.toMatch(/(^|,)scale=/);
		expect(gifFilterComplex(0).startsWith('split[a][b];')).toBe(true);
	});

	test('scales before splitting when a width is set', () => {
		const filter = gifFilterComplex(320);

		// Order matters: scaling has to happen before the split, or the palette is
		// generated from pixels that never reach the output.
		expect(filter.startsWith('scale=320:-1:flags=lanczos,split[a][b];')).toBe(true);
	});

	test('feeds palettegen and paletteuse from the same split', () => {
		const filter = gifFilterComplex(0);

		expect(filter).toContain('split[a][b]');
		expect(filter).toContain('[a]palettegen');
		expect(filter).toContain('[b][p]paletteuse');
	});
});

describe('buildEncoderEnv', () => {
	test('sets every variable the patched doomgeneric reads', () => {
		expect(Object.keys(buildEncoderEnv(opts)).sort()).toEqual([
			'DR_FFMPEG_ARGS_GIF',
			'DR_FFMPEG_ARGS_MP4',
			'DR_FFMPEG_ARGS_PNG',
			'DR_FFMPEG_BIN',
		]);
	});

	test('drops -threads 1 everywhere', () => {
		// The original hardcoded it in all three encoders, pinning ffmpeg to one core
		// while render/queue.ts was already capping concurrency a level up.
		for (const value of Object.values(buildEncoderEnv(opts))) {
			expect(value).not.toContain('-threads');
		}
	});

	test('gives mp4 an explicit preset and crf', () => {
		const env = buildEncoderEnv({ ...opts, mp4Preset: 'faster', mp4Crf: 28 });

		expect(env.DR_FFMPEG_ARGS_MP4).toBe('-vcodec h264 -preset faster -crf 28 -pix_fmt yuv420p');
	});

	test('keeps the gif non-looping', () => {
		// `-loop -1` disables looping in ffmpeg's gif muxer. doomgeneric appends freeze
		// frames at the end of a clip, which only reads correctly if it does not loop.
		expect(buildEncoderEnv(opts).DR_FFMPEG_ARGS_GIF).toContain('-loop -1');
	});

	test('no longer encodes the gif with the fixed bgr8 palette', () => {
		expect(buildEncoderEnv(opts).DR_FFMPEG_ARGS_GIF).not.toContain('bgr8');
	});

	test('quotes the gif filtergraph', () => {
		const gif = buildEncoderEnv(opts).DR_FFMPEG_ARGS_GIF;

		// Unquoted, the `;` separating filter chains would end the shell command that
		// doomgeneric hands to popen.
		expect(gif).toMatch(/-filter_complex "[^"]+"/);
		expect(gif).toContain(';');
	});
});
