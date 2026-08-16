import { config } from '../config.ts';
import { logger } from '../logger.ts';

/** Thrown when the queue is saturated, so callers can serve something stale instead. */
export class QueueFullError extends Error {
	constructor(readonly waiting: number) {
		super(`render queue is full (${waiting} waiting)`);
		this.name = 'QueueFullError';
	}
}

// Global cap on concurrently running renders. Every state change used to spawn a
// doomgeneric immediately with nothing counting them, so a burst of traffic — or
// one profile visit fanning out to several images — spawned unbounded
// subprocesses on a small VPS (crash cause #5).
let active = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
	if (active < config.RENDER_CONCURRENCY) {
		active += 1;
		return Promise.resolve();
	}
	// The slot is handed straight to the next waiter on release, so `active` stays
	// accurate without a decrement/increment race in between.
	return new Promise((resolve) => waiting.push(resolve));
}

function release(): void {
	const next = waiting.shift();
	if (next) next();
	else active -= 1;
}

// One chain per lane, so two jobs that write the same file never run concurrently.
// Different lanes still run in parallel, bounded by the global cap above.
//
// The lane is `<namespace>:frame` or `<namespace>:video`, not the namespace alone.
// Sharing one chain meant a reset — which queues a cheap frame render and an archive
// of the whole finished run — left the frame waiting behind 33 seconds of video
// encoding, and README image requests hung until the proxy gave up. Frames and videos
// write entirely separate files, so serialising them against each other bought nothing.
const chains = new Map<string, Promise<unknown>>();

/** Lane keys. Anything writing `frame_<ns>.*` uses one; anything writing an mp4 the other. */
export const frameLane = (namespace: string): string => `${namespace}:frame`;
export const videoLane = (namespace: string): string => `${namespace}:video`;

export function enqueue<T>(namespace: string, label: string, job: () => Promise<T>): Promise<T> {
	// Refuse before joining the chain rather than after: a job admitted here is
	// committed to run, and the point is to stop the backlog growing at all.
	if (waiting.length >= config.RENDER_QUEUE_MAX) {
		logger.warn({ namespace, label, waiting: waiting.length }, 'render queue full, rejecting');
		return Promise.reject(new QueueFullError(waiting.length));
	}

	const previous = chains.get(namespace) ?? Promise.resolve();

	const queued = previous.then(
		() => runJob(namespace, label, job),
		() => runJob(namespace, label, job), // a failed predecessor must not block the queue
	);

	chains.set(namespace, queued);

	// Drop the map entry once this is the tail, so long-lived processes don't
	// accumulate one promise per namespace ever seen.
	const cleanup = () => {
		if (chains.get(namespace) === queued) chains.delete(namespace);
	};
	queued.then(cleanup, cleanup);

	return queued;
}

async function runJob<T>(namespace: string, label: string, job: () => Promise<T>): Promise<T> {
	await acquire();
	logger.debug({ namespace, label, active }, 'render started');
	try {
		return await job();
	} finally {
		release();
	}
}

/** Exposed for tests and for the health/metrics surface. */
export function queueDepth(): { active: number; waiting: number; namespaces: number } {
	return { active, waiting: waiting.length, namespaces: chains.size };
}
