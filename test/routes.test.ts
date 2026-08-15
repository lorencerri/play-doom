import { beforeEach, describe, expect, test } from 'bun:test';
import { clearInput, getStoredBatches } from '../src/domain/input.ts';
import { getStats } from '../src/domain/state.ts';
import { appendRoute, getInputRoute, resetRoute, rewindRoute } from '../src/routes/input.ts';
import { homeRoute, statsRoute } from '../src/routes/stats.ts';

// Handlers are plain (Request, params) functions, so they are callable directly —
// no server, no ports, no framework test harness.
const ns = 'test_routes';
const params = { namespace: ns };

function get(path: string): Request {
	return new Request(`http://localhost:6677${path}`);
}

beforeEach(() => clearInput(ns));

describe('GET /', () => {
	test('points at the repository', async () => {
		const res = homeRoute();
		expect(await res.text()).toBe('https://github.com/lorencerri/play-doom');
	});
});

describe('GET /input/:namespace', () => {
	test('renders the buffer as readable text', async () => {
		await appendRoute(get(`/input/${ns}/append?keys=u,u,`), params);

		const res = await getInputRoute(get(`/input/${ns}`), params);

		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Up Arrow [x2]');
	});

	test('returns raw batches with ?readable', async () => {
		await appendRoute(get(`/input/${ns}/append?keys=u,`), params);

		const res = await getInputRoute(get(`/input/${ns}?readable=true`), params);

		expect(await res.json()).toBeArray();
	});

	test('returns a PNG with ?image=true', async () => {
		const res = await getInputRoute(get(`/input/${ns}?image=true`), params);

		expect(res.headers.get('content-type')).toBe('image/png');
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(Array.from(bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
	});

	test('rejects an invalid namespace', () => {
		expect(getInputRoute(get('/input/bad-ns'), { namespace: 'bad-ns' })).rejects.toThrow(
			'Invalid characters in namespace.',
		);
	});
});

describe('GET /input/:namespace/append', () => {
	test('stores the batch and reports it', async () => {
		const res = await appendRoute(get(`/input/${ns}/append?keys=u,u,`), params);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe(`u,u, appended to ${ns}`);
		expect(getStoredBatches(ns)).toEqual(['u,u,']);
	});

	test('redirects when a callback is given', async () => {
		const res = await appendRoute(
			get(`/input/${ns}/append?keys=u,&callback=https://github.com/lorencerri`),
			params,
		);

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://github.com/lorencerri');
	});

	test('counts the press in the global stats', async () => {
		const before = getStats();
		await appendRoute(get(`/input/${ns}/append?keys=u,u,`), params);
		const after = getStats();

		expect(after.actions).toBe(before.actions + 1);
		expect(after.keysPressed).toBe(before.keysPressed + 4);
	});

	test('rejects keys outside the alphabet', () => {
		expect(appendRoute(get(`/input/${ns}/append?keys=z,`), params)).rejects.toThrow(
			'Invalid characters in query.keys.',
		);
	});

	test('rejects an empty batch', () => {
		expect(appendRoute(get(`/input/${ns}/append`), params)).rejects.toThrow('query.keys cannot be empty.');
	});
});

describe('GET /input/:namespace/rewind', () => {
	test('removes one key by default', async () => {
		await appendRoute(get(`/input/${ns}/append?keys=u,u,u,`), params);

		const res = await rewindRoute(get(`/input/${ns}/rewind`), params);

		expect(await res.text()).toBe(`rewound 1 keys from ${ns}`);
		expect(getStoredBatches(ns)).toEqual(['u,u,']);
	});

	test('honours ?amount=N', async () => {
		await appendRoute(get(`/input/${ns}/append?keys=u,u,u,u,u,`), params);

		await rewindRoute(get(`/input/${ns}/rewind?amount=3`), params);

		expect(getStoredBatches(ns)).toEqual(['u,u,']);
	});

	test('survives a rewind past the start of the buffer', async () => {
		const res = await rewindRoute(get(`/input/${ns}/rewind?amount=50`), params);

		expect(res.status).toBe(200);
		expect(getStoredBatches(ns)).toEqual([]);
	});

	test('ignores a non-numeric amount', async () => {
		await appendRoute(get(`/input/${ns}/append?keys=u,u,`), params);

		await rewindRoute(get(`/input/${ns}/rewind?amount=abc`), params);

		expect(getStoredBatches(ns)).toEqual(['u,']);
	});
});

describe('GET /input/:namespace/reset', () => {
	test('clears the buffer and responds immediately', async () => {
		await appendRoute(get(`/input/${ns}/append?keys=u,`), params);

		const res = await resetRoute(get(`/input/${ns}/reset`), params);

		expect(await res.text()).toBe(`${ns} reset`);
		expect(getStoredBatches(ns)).toEqual([]);
	});

	test('redirects when a callback is given', async () => {
		const res = await resetRoute(get(`/input/${ns}/reset?callback=https://github.com/lorencerri`), params);

		expect(res.status).toBe(302);
	});

	test('is a no-op on an untouched namespace', async () => {
		const res = await resetRoute(get(`/input/${ns}/reset`), params);
		expect(res.status).toBe(200);
	});
});

describe('GET /stats', () => {
	test('returns an image by default, matching the README embed', async () => {
		const res = await statsRoute(get('/stats'));
		expect(res.headers.get('content-type')).toBe('image/png');
	});

	test('returns JSON with ?image=false', async () => {
		const res = await statsRoute(get('/stats?image=false'));

		expect(await res.json()).toMatchObject({
			actions: expect.any(Number),
			rewinds: expect.any(Number),
			keysPressed: expect.any(Number),
		});
	});
});
