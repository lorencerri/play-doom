import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { schema } from '../src/config.ts';
import { db } from '../src/db.ts';
import { appendBatch, clearInput } from '../src/domain/input.ts';
import { addSegment, listSegments } from '../src/domain/segments.ts';
import { sweepIdleVideo } from '../src/domain/retention.ts';
import { readmeBlock } from '../src/render/embed.ts';
import { controllerRows } from '../src/render/controller.ts';
import { paths } from '../src/render/artifacts.ts';
import { embedRoute, namespaceCheckRoute, newRoute } from '../src/routes/embed.ts';

const OPTS = { api: 'https://example.test', namespace: 'someone', callback: 'https://github.com/someone/someone' };

function get(path: string): Request {
	return new Request(`https://doom.test${path}`);
}

describe('the generated block', () => {
	test('points every control at the requested namespace', () => {
		const block = readmeBlock(OPTS);

		// A block that mixes namespaces is the failure mode that matters: the reader
		// publishes it and their controls quietly drive somebody else's game.
		expect(block).toContain('/input/someone/append');
		expect(block).not.toMatch(/\/input\/(?!someone\/)[a-z-]+\//);
	});

	test('names every tile the layout defines', () => {
		// The markup and the raster geometry have drifted apart in production before —
		// extending a button's region changed which tiles exist without changing a pixel,
		// and the README asked for files that had never been written.
		const block = readmeBlock(OPTS);
		for (const tile of controllerRows().flat()) {
			expect(block).toContain(`/controller/${tile.name}.png`);
		}
	});

	test('escapes a callback that would break out of the href', () => {
		// The real vector, and the reason `&` is escaped rather than just quotes.
		// `new URL().toString()` percent-encodes `"`, `<` and `>` — but *not* `&`. So a
		// callback carrying the literal text `&quot;` survives normalisation intact, and
		// an unescaped `&` lets the HTML parser decode it back into a real quote, ending
		// the attribute and turning the rest into attributes on somebody else's link.
		//
		// This only became reachable when strangers started supplying the callback.
		const hostile = new URL('https://evil.test/?x=&quot; onmouseover=alert(1) y=&quot;').toString();
		expect(hostile).toContain('&quot;');

		const block = readmeBlock({ ...OPTS, callback: hostile });

		// Escaped to `&amp;quot;`, which renders as inert text rather than a quote.
		expect(block).not.toMatch(/href="[^"]*&quot;/);
		expect(block).toContain('&amp;quot;');
	});

	test('escapes a callback carrying a raw quote', () => {
		const block = readmeBlock({ ...OPTS, callback: 'https://evil.test/"><script>alert(1)</script>' });

		expect(block).not.toContain('<script>alert(1)</script>');
	});

	test('tolerates a trailing slash on the api origin', () => {
		expect(readmeBlock({ ...OPTS, api: 'https://example.test/' })).not.toContain('example.test//');
	});

	test('promotes the generator by default and can be told not to', () => {
		expect(readmeBlock(OPTS)).toContain('add to your own GitHub README');
		expect(readmeBlock({ ...OPTS, promote: false })).not.toContain('add to your own GitHub README');
	});

	test('only Loren gets the global stats panel', () => {
		expect(readmeBlock(OPTS)).not.toContain('/stats"');
		expect(readmeBlock({ ...OPTS, stats: true })).toContain('/stats"');
	});
});

describe('GET /embed', () => {
	test('builds markup against the requesting origin', () => {
		// Hard-coding the origin is how a self-hosted copy generates links to somebody
		// else's server.
		const res = embedRoute(get('/embed?namespace=mine&callback=https%3A%2F%2Fgithub.com%2Fa%2Fb'));
		expect(res.headers.get('content-type')).toContain('text/plain');
	});

	test('bakes in the proxy host rather than the internal one', async () => {
		const req = new Request('http://127.0.0.1:6677/embed?namespace=mine&callback=https%3A%2F%2Fgithub.com%2Fa', {
			headers: { 'x-forwarded-host': 'doom-api.example.org', 'x-forwarded-proto': 'https' },
		});

		const body = await embedRoute(req).text();
		expect(body).toContain('https://doom-api.example.org/input/mine/append');
		expect(body).not.toContain('127.0.0.1');
	});

	test('refuses a javascript: callback', () => {
		// The value lands in a link somebody else will click; this is an XSS aimed at the
		// reader, not at us.
		expect(() => embedRoute(get('/embed?namespace=a&callback=javascript%3Aalert(1)'))).toThrow(
			'callback must be http or https.',
		);
	});

	test('requires a callback rather than guessing one', () => {
		expect(() => embedRoute(get('/embed?namespace=a'))).toThrow('callback is required');
	});

	test('rejects a namespace that could escape the data directory', () => {
		expect(() => embedRoute(get('/embed?namespace=..%2F..%2Fetc&callback=https%3A%2F%2Fa.test'))).toThrow(
			'Invalid characters in namespace.',
		);
	});
});

describe('GET /embed/check', () => {
	const ns = 'test_embed_check';

	afterEach(() => clearInput(ns));

	test('reports a free name as free', async () => {
		const body = (await namespaceCheckRoute(get(`/embed/check?namespace=${ns}`)).json()) as { inUse: boolean };
		expect(body.inUse).toBe(false);
	});

	test('reports a name somebody is already playing', async () => {
		// Nothing is reserved and nobody owns a namespace, so the honest thing this can
		// say is whether a reader is about to join a game rather than start one.
		appendBatch(ns, 'u,');

		const body = (await namespaceCheckRoute(get(`/embed/check?namespace=${ns}`)).json()) as { inUse: boolean };
		expect(body.inUse).toBe(true);
	});
});

describe('GET /new', () => {
	test('serves a self-contained page', async () => {
		const html = await newRoute(get('/new')).text();

		// A strict origin blocks anything fetched from elsewhere, so the page has to carry
		// its own styles and script.
		expect(html).toContain('<!doctype html>');
		expect(html).not.toMatch(/<(script|link)[^>]+(src|href)="https?:\/\/(?!doom\.test)/);
	});

	test('tells the page its own origin', async () => {
		const html = await newRoute(get('/new')).text();
		expect(html).toContain('var origin = "https://doom.test"');
	});
});

describe('idle video retention', () => {
	const ns = 'test_retain';

	afterEach(async () => {
		db.query('DELETE FROM namespace_state WHERE namespace = ?').run(ns);
		db.query('DELETE FROM run_segments WHERE namespace = ?').run(ns);
		for (const path of [paths.current(ns), paths.full(ns), paths.combined(ns), paths.frame(ns, 'gif'), paths.death(ns)]) {
			await rm(path, { force: true });
		}
		await rm(paths.segment(ns, 0), { force: true });
	});

	async function seed(lastHumanAt: number): Promise<void> {
		db.query('INSERT OR IGNORE INTO namespace_state (namespace, updated_at) VALUES (?, ?)').run(ns, Date.now());
		db.query('UPDATE namespace_state SET last_human_at = ? WHERE namespace = ?').run(lastHumanAt, ns);

		await Bun.write(paths.current(ns), 'video');
		await Bun.write(paths.full(ns), 'video');
		await Bun.write(paths.combined(ns), 'video');
		await Bun.write(paths.segment(ns, 0), 'video');
		addSegment(ns, 0);

		await Bun.write(paths.frame(ns, 'gif'), 'gif');
		await Bun.write(paths.death(ns), 'gif');
	}

	test('leaves a namespace somebody is still playing completely alone', async () => {
		await seed(Date.now() - 3 * 86_400_000);

		await sweepIdleVideo();

		expect(await Bun.file(paths.full(ns)).exists()).toBe(true);
	});

	test('reclaims the video of an abandoned one', async () => {
		await seed(Date.now() - 200 * 86_400_000);

		const result = await sweepIdleVideo();

		expect(result.namespaces).toBe(1);
		expect(await Bun.file(paths.current(ns)).exists()).toBe(false);
		expect(await Bun.file(paths.full(ns)).exists()).toBe(false);
		expect(await Bun.file(paths.combined(ns)).exists()).toBe(false);
		expect(await Bun.file(paths.segment(ns, 0)).exists()).toBe(false);
	});

	test('keeps the images, so an abandoned README still renders', async () => {
		// A sweep that left broken images on somebody's profile would be worse than the
		// disk it saved. The death cam in particular cannot be regenerated.
		await seed(Date.now() - 200 * 86_400_000);

		await sweepIdleVideo();

		expect(await Bun.file(paths.frame(ns, 'gif')).exists()).toBe(true);
		expect(await Bun.file(paths.death(ns)).exists()).toBe(true);
	});

	test('clears the segment rows with the files', async () => {
		// A row pointing at a deleted mp4 would make the next fold concat a missing input
		// and fail the whole archive.
		await seed(Date.now() - 200 * 86_400_000);

		await sweepIdleVideo();

		expect(listSegments(ns)).toEqual([]);
	});

	test('marks the videos as needing a rebuild', async () => {
		await seed(Date.now() - 200 * 86_400_000);

		await sweepIdleVideo();

		const row = db
			.query<{ full_video_outdated: number }, [string]>(
				'SELECT full_video_outdated FROM namespace_state WHERE namespace = ?',
			)
			.get(ns);

		expect(row?.full_video_outdated).toBe(1);
	});
});

describe('retention configuration', () => {
	test('sweeps after three months by default', () => {
		expect(schema.parse({}).RETAIN_VIDEO_DAYS).toBe(90);
	});

	test('zero disables it', () => {
		expect(schema.parse({ RETAIN_VIDEO_DAYS: '0' }).RETAIN_VIDEO_DAYS).toBe(0);
	});
});

describe('block ordering', () => {
	test('the input log sits above the latest death', () => {
		// Status and the input log both describe the run in progress, so they belong
		// together; achievements and the last death are retrospective and follow.
		const block = readmeBlock(OPTS);
		const at = (needle: string) => block.indexOf(needle);

		expect(at('/status/')).toBeLessThan(at('?image=true'));
		expect(at('?image=true')).toBeLessThan(at('/achievements/'));
		expect(at('/achievements/')).toBeLessThan(at('/death/'));
	});

	test('the death panel says what it is', () => {
		// "latest death" says what the picture is; "death cam" was a name for a feature
		// nobody had asked about.
		const block = readmeBlock(OPTS);

		expect(block).toContain('<sub>latest death</sub>');
		expect(block).not.toContain('death cam');
	});
});
