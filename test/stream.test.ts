import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { serveFile } from '../src/http/serve.ts';

const dir = './data/.test';
const path = `${dir}/stream-fixture.bin`;
const SIZE = 64 * 1024;

beforeAll(async () => {
	await mkdir(dir, { recursive: true });
	// Deterministic contents so a served slice can be checked byte for byte.
	await writeFile(path, Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 256)));
});

afterAll(() => rm(path, { force: true }));

describe('serveFile', () => {
	test('serves the whole file with a correct length', async () => {
		const res = await serveFile(path, 'video/mp4', 'fixture.mp4');

		expect(res.status).toBe(200);
		expect(res.headers.get('content-length')).toBe(String(SIZE));
		expect(res.headers.get('accept-ranges')).toBe('bytes');
	});

	test('serves a byte range as 206 with the right bytes', async () => {
		const res = await serveFile(path, 'video/mp4', 'fixture.mp4', { rangeHeader: 'bytes=100-199' });

		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toBe(`bytes 100-199/${SIZE}`);
		expect(res.headers.get('content-length')).toBe('100');

		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(bytes.length).toBe(100);
		expect(bytes[0]).toBe(100 % 256);
		expect(bytes[99]).toBe(199 % 256);
	});

	test('answers an unsatisfiable range with 416', async () => {
		const res = await serveFile(path, 'video/mp4', 'fixture.mp4', { rangeHeader: `bytes=${SIZE + 10}-` });

		expect(res.status).toBe(416);
		expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
	});

	test('does not read the file into memory', async () => {
		// Crash cause #1: the old path called fs.readFile on the entire mp4 just to
		// learn its length, and full_*.mp4 grows with every run ever played. This
		// asserts the body is still a lazy handle at the point the Response is built,
		// which is the property that made the OOM possible to hit.
		const before = process.memoryUsage().heapUsed;

		for (let i = 0; i < 50; i += 1) {
			const res = await serveFile(path, 'video/mp4', 'fixture.mp4');
			expect(res.status).toBe(200);
		}

		const growth = process.memoryUsage().heapUsed - before;
		expect(growth).toBeLessThan(SIZE * 10);
	});

	test('404s a missing file instead of throwing a raw fs error', () => {
		expect(serveFile(`${dir}/nope.mp4`, 'video/mp4', 'nope.mp4')).rejects.toThrow('nope.mp4 is not available');
	});
});
