const FALSEY = new Set(['', '0', 'false', 'no', 'off']);

/**
 * Query flags in the original were raw Express strings, so `?image=false` was the
 * truthy string `"false"`. Links in the wild only ever pass `true`, so treating
 * the obvious negatives as false is safe and stops the confusing case.
 */
export function boolParam(url: URL, name: string, fallback: boolean): boolean {
	const raw = url.searchParams.get(name);
	if (raw === null) return fallback;
	return !FALSEY.has(raw.toLowerCase());
}

export function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
	const raw = url.searchParams.get(name);
	if (raw === null) return fallback;

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed)) return fallback;

	return Math.min(max, Math.max(min, parsed));
}

export function stringParam(url: URL, name: string, fallback = ''): string {
	return url.searchParams.get(name) ?? fallback;
}
