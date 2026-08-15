import { notFoundError } from './errors.ts';

/**
 * Cache-defeating headers, carried over verbatim. GitHub's image proxy caches
 * aggressively, and a cached frame means clicking a control appears to do
 * nothing — so the expired `Expires` date stays.
 */
export function uncachedHeaders(
	contentType: string,
	filename: string,
	disposition: 'inline' | 'attachment',
): Record<string, string> {
	return {
		'Content-Type': contentType,
		'Content-Disposition': `${disposition}; filename="${filename}"`,
		'Cache-Control': 'no-cache,max-age=0',
		Expires: 'Sun, 06 Jul 2014 07:27:43 GMT',
	};
}

export async function fileExists(path: string): Promise<boolean> {
	return Bun.file(path).exists();
}

type ByteRange = { start: number; end: number };

/**
 * Single-range parser. Multi-range requests return undefined and get the whole
 * file, which is a legal response — no client in this app's path sends them.
 */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | undefined {
	if (!header?.startsWith('bytes=')) return undefined;

	const spec = header.slice('bytes='.length);
	if (spec.includes(',')) return undefined;

	const [startRaw = '', endRaw = ''] = spec.split('-');

	// `bytes=-500` means the last 500 bytes.
	if (startRaw === '') {
		const suffix = Number.parseInt(endRaw, 10);
		if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}

	const start = Number.parseInt(startRaw, 10);
	if (!Number.isFinite(start) || start < 0) return 'unsatisfiable';
	if (start >= size) return 'unsatisfiable';

	const end = endRaw === '' ? size - 1 : Number.parseInt(endRaw, 10);
	if (!Number.isFinite(end) || end < start) return 'unsatisfiable';

	return { start, end: Math.min(end, size - 1) };
}

/**
 * Serves a file straight off disk, streamed.
 *
 * This is crash cause #1 deleted: the old path called `fs.readFile` on the whole
 * mp4 purely to learn its `byteLength`, threw the buffer away, and then opened a
 * separate read stream. `full_*.mp4` is every run ever recorded for a namespace
 * and grows without bound, so a single request for a large archive could
 * allocate hundreds of megabytes and take the process out. Nothing here reads
 * the bytes into the process — `Bun.file().slice()` is a lazy handle.
 */
export async function serveFile(
	path: string,
	contentType: string,
	filename: string,
	options: { disposition?: 'inline' | 'attachment'; rangeHeader?: string | null } = {},
): Promise<Response> {
	const file = Bun.file(path);
	if (!(await file.exists())) throw notFoundError(`${filename} is not available`);

	const size = file.size;
	const headers = new Headers(uncachedHeaders(contentType, filename, options.disposition ?? 'attachment'));
	headers.set('Accept-Ranges', 'bytes');

	const range = parseRange(options.rangeHeader ?? null, size);

	if (range === 'unsatisfiable') {
		headers.set('Content-Range', `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}

	if (range) {
		headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
		headers.set('Content-Length', String(range.end - range.start + 1));
		return new Response(file.slice(range.start, range.end + 1), { status: 206, headers });
	}

	headers.set('Content-Length', String(size));
	return new Response(file, { status: 200, headers });
}

/**
 * The control links pass `?callback=` so a click lands back on the profile page.
 *
 * Anything is accepted except non-http(s) schemes: the value lands in a
 * `Location` header, and `javascript:` or `data:` there is an XSS vector for
 * anyone who can get a crafted link clicked. The original passed it through
 * unchecked.
 */
export function redirectTo(callback: string): Response | undefined {
	if (callback.length === 0) return undefined;

	let url: URL;
	try {
		url = new URL(callback);
	} catch {
		return undefined;
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

	return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

export function text(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export function png(body: Buffer, filename: string): Response {
	return new Response(body, { headers: uncachedHeaders('image/png', filename, 'attachment') });
}
