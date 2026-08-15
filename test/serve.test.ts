import { describe, expect, test } from 'bun:test';
import { parseRange, redirectTo, uncachedHeaders } from '../src/http/serve.ts';

describe('parseRange', () => {
	const size = 1000;

	test('ignores a missing or non-byte range', () => {
		expect(parseRange(null, size)).toBeUndefined();
		expect(parseRange('items=0-10', size)).toBeUndefined();
	});

	test('parses a closed range', () => {
		expect(parseRange('bytes=0-499', size)).toEqual({ start: 0, end: 499 });
	});

	test('parses an open-ended range', () => {
		expect(parseRange('bytes=500-', size)).toEqual({ start: 500, end: 999 });
	});

	test('parses a suffix range', () => {
		expect(parseRange('bytes=-100', size)).toEqual({ start: 900, end: 999 });
	});

	test('clamps an end past the file', () => {
		expect(parseRange('bytes=900-99999', size)).toEqual({ start: 900, end: 999 });
	});

	test('reports unsatisfiable ranges', () => {
		expect(parseRange('bytes=1000-', size)).toBe('unsatisfiable');
		expect(parseRange('bytes=500-100', size)).toBe('unsatisfiable');
		expect(parseRange('bytes=-0', size)).toBe('unsatisfiable');
	});

	test('falls back to the whole file for multi-range requests', () => {
		expect(parseRange('bytes=0-99,200-299', size)).toBeUndefined();
	});
});

describe('redirectTo', () => {
	test('redirects to the callback the control links pass', () => {
		const res = redirectTo('https://github.com/lorencerri');

		expect(res?.status).toBe(302);
		expect(res?.headers.get('location')).toBe('https://github.com/lorencerri');
	});

	test('allows plain http', () => {
		expect(redirectTo('http://example.com/')?.status).toBe(302);
	});

	test('ignores an absent callback so the caller falls back to a text response', () => {
		expect(redirectTo('')).toBeUndefined();
	});

	test('refuses script and data URLs', () => {
		// These would otherwise land in a Location header, which is an XSS vector for
		// anyone who can get a crafted link clicked.
		expect(redirectTo('javascript:alert(1)')).toBeUndefined();
		expect(redirectTo('data:text/html,<script>alert(1)</script>')).toBeUndefined();
		expect(redirectTo('not a url')).toBeUndefined();
	});
});

describe('uncachedHeaders', () => {
	test("defeats GitHub's image proxy cache", () => {
		const headers = uncachedHeaders('image/gif', 'frame_github.gif', 'attachment');

		expect(headers['Cache-Control']).toBe('no-cache,max-age=0');
		expect(headers.Expires).toBe('Sun, 06 Jul 2014 07:27:43 GMT');
		expect(headers['Content-Disposition']).toBe('attachment; filename="frame_github.gif"');
	});
});
