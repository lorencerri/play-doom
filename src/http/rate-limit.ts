/**
 * Token-bucket rate limiting, keyed on the pseudonymous player id.
 *
 * Every control link in the profile README is a plain GET that anyone can click, and
 * each click queues a render. Nothing stopped one client from issuing them as fast as
 * it could: `RENDER_CONCURRENCY` bounds how many renders run at once, but the queue
 * behind it was unbounded, so sustained clicking grew memory and pushed everyone
 * else's frame further back.
 *
 * A bucket refills continuously rather than resetting on a window boundary, so a
 * normal player clicking steadily is never punished for arriving just after a reset —
 * the failure mode of fixed windows.
 */

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

type Bucket = { tokens: number; updatedAt: number };

export class RateLimiter {
	private readonly buckets = new Map<string, Bucket>();

	/**
	 * @param capacity   burst size — how many clicks are allowed back to back
	 * @param perMinute  sustained rate the bucket refills at
	 * @param now        injectable clock; the default is the real one
	 */
	constructor(
		private readonly capacity: number,
		private readonly perMinute: number,
		private readonly now: () => number = Date.now,
	) {}

	take(key: string): RateLimitResult {
		const now = this.now();
		const refillPerMs = this.perMinute / 60_000;

		const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
		const refilled = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);

		if (refilled < 1) {
			// Not consumed, but the clock still advances — otherwise the elapsed time
			// since the last refill would be counted twice on the next call.
			this.buckets.set(key, { tokens: refilled, updatedAt: now });
			return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - refilled) / refillPerMs / 1000)) };
		}

		this.buckets.set(key, { tokens: refilled - 1, updatedAt: now });
		return { allowed: true, retryAfterSeconds: 0 };
	}

	/**
	 * Drops buckets that have sat full for a while.
	 *
	 * Without this the map is itself an unbounded resource — one entry per distinct
	 * client forever, which is the same leak the limiter exists to prevent. A full
	 * bucket is indistinguishable from a fresh one, so forgetting it changes nothing.
	 */
	sweep(idleMs = 10 * 60_000): number {
		const now = this.now();
		let removed = 0;

		for (const [key, bucket] of this.buckets) {
			const refilled = bucket.tokens + (now - bucket.updatedAt) * (this.perMinute / 60_000);
			if (refilled >= this.capacity && now - bucket.updatedAt > idleMs) {
				this.buckets.delete(key);
				removed += 1;
			}
		}

		return removed;
	}

	get size(): number {
		return this.buckets.size;
	}
}
