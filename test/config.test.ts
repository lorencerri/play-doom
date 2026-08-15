import { describe, expect, test } from 'bun:test';
import { schema } from '../src/config.ts';

function parse(env: Record<string, string>) {
	const result = schema.safeParse(env);
	if (!result.success) throw new Error(JSON.stringify(result.error.flatten().fieldErrors));
	return result.data;
}

describe('EAGER_FRAME_TYPES', () => {
	test('warms only the gif by default', () => {
		// The profile README fetches `?type=.gif` and nothing else. Warming the png
		// too made every click run doomgeneric and ffmpeg twice, and because both
		// jobs take the same per-namespace mutex the gif queued behind the png.
		expect(parse({}).EAGER_FRAME_TYPES).toEqual(['gif']);
	});

	test('accepts a comma-separated list', () => {
		expect(parse({ EAGER_FRAME_TYPES: 'png,gif' }).EAGER_FRAME_TYPES).toEqual(['png', 'gif']);
	});

	test('tolerates whitespace and trailing separators', () => {
		expect(parse({ EAGER_FRAME_TYPES: ' gif , png ,' }).EAGER_FRAME_TYPES).toEqual(['gif', 'png']);
	});

	test('warms nothing when empty', () => {
		// Distinct from EAGER_RENDER=false only in intent; both put rendering back on
		// the request path, which is what the app did before plan 1.2.
		expect(parse({ EAGER_FRAME_TYPES: '' }).EAGER_FRAME_TYPES).toEqual([]);
	});

	test('rejects a type that is not a real filetype', () => {
		// Config is validated at boot precisely so a typo fails the container start
		// rather than silently disabling the warm path.
		expect(() => parse({ EAGER_FRAME_TYPES: 'jpeg' })).toThrow();
	});
});
