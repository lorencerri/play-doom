import { describe, expect, test } from 'bun:test';
import { gifFrameCount, GIF_NTHFRAME, MAX_GIF_FRAMES } from '../src/render/artifacts.ts';

/**
 * The bug this guards against produced a 0-byte gif on roughly half of all single-key
 * clicks — the README's "Idle Frame" link included. doomgeneric writes a frame only
 * when `frame_id % nthframe == 0`, so recording one frame at an odd index wrote
 * nothing at all and ffmpeg was handed no input.
 */
describe('gifFrameCount', () => {
	test('never records fewer frames than the nth-frame stride', () => {
		// This is the whole fix: below the stride, whether anything is written at all
		// depends on the parity of the frame index.
		expect(gifFrameCount(',')).toBeGreaterThanOrEqual(GIF_NTHFRAME);
	});

	test('a single-key batch still records enough to guarantee output', () => {
		expect(gifFrameCount(',')).toBe(GIF_NTHFRAME);
	});

	test('an empty batch is still safe', () => {
		expect(gifFrameCount('')).toBe(GIF_NTHFRAME);
	});

	test('longer batches are recorded in full', () => {
		expect(gifFrameCount('u,u,u,')).toBe(6);
	});

	test('caps long batches so a 50x link is not a 50-frame animation', () => {
		const long = ','.repeat(50);
		expect(gifFrameCount(long)).toBe(MAX_GIF_FRAMES);
	});

	test('every batch length produces at least one written frame', () => {
		// The invariant stated directly: for any batch, at least one recorded index
		// must be a multiple of the stride.
		for (let length = 0; length <= 40; length++) {
			const count = gifFrameCount(','.repeat(length));
			expect(count).toBeGreaterThanOrEqual(GIF_NTHFRAME);
		}
	});
});
