/**
 * Tracks how rendering is actually going, per namespace.
 *
 * The original app's defining problem was crashing with no explanation — stderr was
 * discarded and nothing counted failures, so there was never anything to point at. Log
 * lines record individual failures; this records the shape of them: which namespace,
 * how many in a row, and what the last one said. A namespace failing repeatedly is a
 * different problem from one render that timed out, and only a counter can tell them
 * apart.
 *
 * In memory rather than in SQLite on purpose. This describes the health of the current
 * process, and a restart genuinely resets it — persisting it would report failures that
 * the running process never saw.
 */

export type RenderHealth = {
	namespace: string;
	consecutiveFailures: number;
	totalFailures: number;
	totalSuccesses: number;
	lastError?: string;
	lastFailureAt?: number;
	lastSuccessAt?: number;
	/** Whether the last request for this namespace was answered with a stale artifact. */
	servedStale: boolean;
};

const health = new Map<string, RenderHealth>();

// Bounds the map: namespaces are user-supplied, so an attacker could otherwise mint
// unbounded entries. Eviction is by least-recently-touched.
const MAX_TRACKED = 256;

function entry(namespace: string): RenderHealth {
	const existing = health.get(namespace);
	if (existing) return existing;

	if (health.size >= MAX_TRACKED) {
		const oldest = [...health.entries()].sort(
			(a, b) => lastTouched(a[1]) - lastTouched(b[1]),
		)[0];
		if (oldest) health.delete(oldest[0]);
	}

	const created: RenderHealth = {
		namespace,
		consecutiveFailures: 0,
		totalFailures: 0,
		totalSuccesses: 0,
		servedStale: false,
	};
	health.set(namespace, created);
	return created;
}

function lastTouched(record: RenderHealth): number {
	return Math.max(record.lastFailureAt ?? 0, record.lastSuccessAt ?? 0);
}

export function recordRenderSuccess(namespace: string): void {
	const record = entry(namespace);
	record.consecutiveFailures = 0;
	record.totalSuccesses += 1;
	record.lastSuccessAt = Date.now();
	record.servedStale = false;
}

export function recordRenderFailure(namespace: string, error: unknown, servedStale: boolean): void {
	const record = entry(namespace);
	record.consecutiveFailures += 1;
	record.totalFailures += 1;
	record.lastFailureAt = Date.now();
	record.lastError = error instanceof Error ? error.message : String(error);
	record.servedStale = servedStale;
}

export function renderHealth(): RenderHealth[] {
	return [...health.values()].sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
}

/**
 * Namespaces failing repeatedly right now.
 *
 * One failure is noise — a timeout under load, a transient disk hiccup. Several in a row
 * for the same namespace means its input reproducibly breaks the engine, which is worth
 * surfacing as degraded rather than leaving in the logs.
 */
export function degradedNamespaces(threshold = 3): RenderHealth[] {
	return renderHealth().filter((record) => record.consecutiveFailures >= threshold);
}

/** Test seam. */
export function resetRenderHealth(): void {
	health.clear();
}
