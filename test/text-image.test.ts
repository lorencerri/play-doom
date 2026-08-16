import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { renderTextImage } from '../src/render/text-image.ts';

const LONG =
	'Left Arrow [x30], Space, Up Arrow [x25], Idle [x150], Space, Idle [x50], Space, Up Arrow [x50], Idle [x25]';

describe('renderTextImage', () => {
	test('honours a fixed width', async () => {
		const meta = await sharp(await renderTextImage(LONG, 664)).metadata();
		expect(meta.width).toBe(664);
	});

	test('wraps to the fixed width instead of overflowing it', async () => {
		// The bug this guards against: forcing the width while still wrapping at the
		// default meant lines ran past the right edge and were clipped mid-word on the
		// README. A narrower canvas must therefore produce a taller image.
		const narrow = await sharp(await renderTextImage(LONG, 300)).metadata();
		const wide = await sharp(await renderTextImage(LONG, 664)).metadata();

		expect(narrow.width).toBe(300);
		expect(narrow.height!).toBeGreaterThan(wide.height!);
	});

	test('sizes to the text when no width is given', async () => {
		const meta = await sharp(await renderTextImage('short')).metadata();
		expect(meta.width!).toBeLessThan(120);
	});

	test('renders an empty string without failing', async () => {
		const meta = await sharp(await renderTextImage('', 664)).metadata();
		expect(meta.width).toBe(664);
	});
});
