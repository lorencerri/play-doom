import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { schema } from '../src/config.ts';
import { paths } from '../src/render/artifacts.ts';
import { renderNoDeathCard } from '../src/render/death-card.ts';
import { deathRoute } from '../src/routes/death.ts';

const ns = 'test_deathcam';
const params = { namespace: ns };

function get(path: string): Request {
	return new Request(`http://localhost:6677${path}`);
}

// Enough of a GIF header to be recognisable; the route serves bytes, it does not decode.
const FAKE_GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

afterEach(async () => {
	await rm(paths.death(ns), { force: true });
	await rm(paths.deathPart(ns), { force: true });
});

describe('artifact paths', () => {
	test('the partial keeps the .gif extension', () => {
		// ffmpeg picks its muxer from the output extension, so a `.part` suffix would
		// fail the encode outright rather than just looking untidy.
		expect(paths.deathPart(ns).endsWith('.gif')).toBe(true);
		expect(paths.death(ns).endsWith('.gif')).toBe(true);
		expect(paths.deathPart(ns)).not.toBe(paths.death(ns));
	});
});

describe('GET /death/:namespace', () => {
	test('serves a placeholder card before anything has died', async () => {
		const res = await deathRoute(get(`/death/${ns}`), params);

		// A README embeds fixed markup fetched on every profile view, so this endpoint
		// must answer with an image from the very first request — a 404 here would put a
		// broken image on the profile until the first death.
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');

		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(Array.from(bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
	});

	test('serves the clip once one exists', async () => {
		await Bun.write(paths.death(ns), FAKE_GIF);

		const res = await deathRoute(get(`/death/${ns}`), params);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/gif');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(FAKE_GIF);
	});

	test('does not serve a partial that is still being written', async () => {
		await Bun.write(paths.deathPart(ns), FAKE_GIF);

		const res = await deathRoute(get(`/death/${ns}`), params);

		// The clip is renamed into place when complete. Until then the served path does
		// not exist, and the placeholder is the correct answer.
		expect(res.headers.get('content-type')).toBe('image/png');
	});

	test('rejects a namespace that could escape the data directory', () => {
		expect(deathRoute(get('/death/x'), { namespace: '../../etc/passwd' })).rejects.toThrow(
			'Invalid characters in namespace.',
		);
	});
});

describe('the placeholder card', () => {
	test('is rendered once and reused', async () => {
		// It has no inputs, so re-rasterising it on every profile view would be waste.
		const first = await renderNoDeathCard();
		expect(await renderNoDeathCard()).toBe(first);
	});
});

describe('death cam configuration', () => {
	test('records by default', () => {
		// Unlike AUTO_ARCHIVE_ON_DEATH this only observes, so it does not need the
		// profile owner's opt-in.
		expect(schema.parse({}).DEATH_CAM).toBe(true);
		expect(schema.parse({ DEATH_CAM: 'false' }).DEATH_CAM).toBe(false);
	});

	test('caps the clip length', () => {
		// This gif is fetched on every profile view and bytes scale with frames.
		expect(schema.parse({}).DEATH_CAM_FRAMES).toBe(96);
		expect(schema.safeParse({ DEATH_CAM_FRAMES: '1000' }).success).toBe(false);
		expect(schema.safeParse({ DEATH_CAM_FRAMES: '0' }).success).toBe(false);
	});

	test('the window outlasts the largest single click', () => {
		// The README's biggest control appends 25 frames. Recording every other frame
		// means the window spans 2x this many, so a death anywhere in that click is
		// still inside the clip rather than the clip being all aftermath.
		expect(schema.parse({}).DEATH_CAM_FRAMES * 2).toBeGreaterThan(25);
	});
});
