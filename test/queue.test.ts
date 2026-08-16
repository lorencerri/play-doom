import { describe, expect, test } from 'bun:test';
import { config } from '../src/config.ts';
import { enqueue, frameLane, queueDepth, videoLane } from '../src/render/queue.ts';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe('render queue', () => {
	test('never runs more than RENDER_CONCURRENCY jobs at once', async () => {
		// A traffic burst used to spawn one doomgeneric per request with nothing
		// counting them, which is what put the box under memory pressure.
		let running = 0;
		let peak = 0;

		const jobs = Array.from({ length: 8 }, (_, i) =>
			enqueue(`peak_ns_${i}`, 'test', async () => {
				running += 1;
				peak = Math.max(peak, running);
				await Bun.sleep(10);
				running -= 1;
			}),
		);

		await Promise.all(jobs);

		expect(peak).toBeLessThanOrEqual(config.RENDER_CONCURRENCY);
		expect(peak).toBeGreaterThan(0);
	});

	test('serialises jobs within one namespace', async () => {
		const order: string[] = [];

		const first = enqueue('serial_ns', 'first', async () => {
			order.push('first:start');
			await Bun.sleep(20);
			order.push('first:end');
		});

		const second = enqueue('serial_ns', 'second', async () => {
			order.push('second:start');
		});

		await Promise.all([first, second]);

		expect(order).toEqual(['first:start', 'first:end', 'second:start']);
	});

	test('a failed job does not block the ones behind it', async () => {
		const failing = enqueue('failure_ns', 'boom', async () => {
			throw new Error('render failed');
		});

		expect(failing).rejects.toThrow('render failed');
		await failing.catch(() => {});

		await expect(enqueue('failure_ns', 'after', async () => 'ok')).resolves.toBe('ok');
	});

	test('releases every slot and forgets idle namespaces', async () => {
		await enqueue('cleanup_ns', 'test', async () => {});
		// Chains are dropped once drained, otherwise a long-lived process accumulates
		// one promise per namespace it has ever seen.
		await Bun.sleep(1);

		const depth = queueDepth();
		expect(depth.active).toBe(0);
		expect(depth.waiting).toBe(0);
		expect(depth.namespaces).toBe(0);
	});
});

describe('lanes', () => {
	test('frames and videos for one namespace do not block each other', async () => {
		// The reset bug: a cheap frame render sat behind a whole run's video encode
		// because both used the namespace as the chain key, and README image requests
		// hung until the proxy gave up.
		const order: string[] = [];
		let releaseVideo!: () => void;
		const videoBlocked = new Promise<void>((resolve) => (releaseVideo = resolve));

		const video = enqueue(videoLane('ns'), 'video', async () => {
			order.push('video:start');
			await videoBlocked;
			order.push('video:end');
		});

		const frame = enqueue(frameLane('ns'), 'frame', async () => {
			order.push('frame');
		});

		await frame;
		expect(order).toContain('frame');
		expect(order).not.toContain('video:end');

		releaseVideo();
		await video;
	});

	test('two jobs in the same lane still serialise', async () => {
		const order: string[] = [];
		const first = enqueue(frameLane('ns2'), 'a', async () => {
			await Bun.sleep(5);
			order.push('a');
		});
		const second = enqueue(frameLane('ns2'), 'b', async () => {
			order.push('b');
		});

		await Promise.all([first, second]);
		expect(order).toEqual(['a', 'b']);
	});
});
