import { describe, expect, test } from 'bun:test';
import { RateLimiter } from '../src/http/rate-limit.ts';

/** Controllable clock, so none of this has to wait on real time. */
function clock(start = 1_000_000) {
	let now = start;
	return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
	test('allows a full burst back to back', () => {
		const limiter = new RateLimiter(5, 60, clock().now);

		for (let i = 0; i < 5; i++) expect(limiter.take('a').allowed).toBe(true);
	});

	test('refuses once the burst is spent', () => {
		const limiter = new RateLimiter(3, 60, clock().now);

		for (let i = 0; i < 3; i++) limiter.take('a');
		expect(limiter.take('a').allowed).toBe(false);
	});

	test('refills continuously rather than on a window boundary', () => {
		// The failure mode of fixed windows is punishing a steady clicker who happens
		// to arrive just after a reset. At 60/min one token comes back each second.
		const time = clock();
		const limiter = new RateLimiter(2, 60, time.now);

		limiter.take('a');
		limiter.take('a');
		expect(limiter.take('a').allowed).toBe(false);

		time.advance(1000);
		expect(limiter.take('a').allowed).toBe(true);
	});

	test('never refills past the burst size', () => {
		const time = clock();
		const limiter = new RateLimiter(2, 60, time.now);

		time.advance(60 * 60_000); // an hour of idling
		expect(limiter.take('a').allowed).toBe(true);
		expect(limiter.take('a').allowed).toBe(true);
		expect(limiter.take('a').allowed).toBe(false);
	});

	test('keeps clients independent', () => {
		const limiter = new RateLimiter(1, 60, clock().now);

		expect(limiter.take('a').allowed).toBe(true);
		expect(limiter.take('a').allowed).toBe(false);
		expect(limiter.take('b').allowed).toBe(true);
	});

	test('reports a usable retry-after', () => {
		const limiter = new RateLimiter(1, 60, clock().now);

		limiter.take('a');
		const denied = limiter.take('a');

		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
	});

	test('does not double-count elapsed time across denied calls', () => {
		// A denied call still advances the bucket's clock. If it did not, the same
		// elapsed milliseconds would be credited again on the next call and the
		// limiter would leak capacity under sustained hammering.
		const time = clock();
		const limiter = new RateLimiter(1, 60, time.now);

		limiter.take('a');
		time.advance(500);
		expect(limiter.take('a').allowed).toBe(false);
		time.advance(400);

		// 900ms total — still short of the 1000ms a token costs.
		expect(limiter.take('a').allowed).toBe(false);

		time.advance(200);
		expect(limiter.take('a').allowed).toBe(true);
	});
});

describe('sweep', () => {
	test('forgets clients whose buckets have been full and idle', () => {
		const time = clock();
		const limiter = new RateLimiter(5, 60, time.now);

		limiter.take('a');
		expect(limiter.size).toBe(1);

		time.advance(20 * 60_000);
		expect(limiter.sweep()).toBe(1);
		expect(limiter.size).toBe(0);
	});

	test('keeps clients that are still rate limited', () => {
		const time = clock();
		const limiter = new RateLimiter(2, 60, time.now);

		limiter.take('a');
		limiter.take('a');

		// Dropping this bucket would hand back a full one and defeat the limit.
		time.advance(20 * 60_000);
		limiter.take('a');
		expect(limiter.sweep()).toBe(0);
		expect(limiter.size).toBe(1);
	});

	test('forgetting a full bucket changes nothing observable', () => {
		const time = clock();
		const limiter = new RateLimiter(3, 60, time.now);

		limiter.take('a');
		time.advance(20 * 60_000);
		limiter.sweep();

		for (let i = 0; i < 3; i++) expect(limiter.take('a').allowed).toBe(true);
	});
});
