import { beforeEach, describe, expect, test } from 'bun:test';
import {
	appendBatch,
	clearInput,
	getInput,
	getInputString,
	getStoredBatches,
	rewindKeys,
} from '../src/domain/input.ts';

const ns = 'test_cache';

beforeEach(() => clearInput(ns));

describe('getInputString', () => {
	test('matches getInput().join("") on an empty namespace', () => {
		expect(getInputString(ns)).toBe(getInput(ns).join(''));
	});

	test('matches getInput().join("") after appends', () => {
		appendBatch(ns, 'u,u,');
		appendBatch(ns, 'l,');

		expect(getInputString(ns)).toBe(getInput(ns).join(''));
	});

	test('matches getInput().join("") for the escape-prefixed special case', () => {
		// A buffer whose first batch is exactly `x,` skips the bootstrap prefix, and
		// the cached join has to reproduce that branch rather than always prepending.
		appendBatch(ns, 'x,');
		appendBatch(ns, 'u,');

		expect(getInputString(ns)).toBe(getInput(ns).join(''));
		expect(getInputString(ns).startsWith('x,')).toBe(true);
	});
});

describe('cache invalidation', () => {
	test('append is visible immediately', () => {
		const before = getInputString(ns);
		appendBatch(ns, 'u,');

		expect(getInputString(ns)).not.toBe(before);
		expect(getInputString(ns).endsWith('u,')).toBe(true);
	});

	test('rewind is visible immediately', () => {
		appendBatch(ns, 'u,u,u,');
		// Warm the cache before mutating, so a missing invalidation actually shows.
		getInputString(ns);

		rewindKeys(ns, 1);

		expect(getStoredBatches(ns)).toEqual(['u,u,']);
		expect(getInputString(ns).endsWith('u,u,')).toBe(true);
	});

	test('clear is visible immediately', () => {
		appendBatch(ns, 'u,');
		getInputString(ns);

		clearInput(ns);

		expect(getStoredBatches(ns)).toEqual([]);
		expect(getInputString(ns)).toBe(getInput(ns).join(''));
	});

	test('a rewind of zero leaves the buffer alone', () => {
		appendBatch(ns, 'u,u,');
		const before = getInputString(ns);

		expect(rewindKeys(ns, 0)).toBe(0);
		expect(getInputString(ns)).toBe(before);
	});
});

describe('getStoredBatches', () => {
	test('hands back a copy, not the cached array', () => {
		appendBatch(ns, 'u,');

		const batches = getStoredBatches(ns);
		batches.push('SHOULD NOT PERSIST');

		expect(getStoredBatches(ns)).toEqual(['u,']);
	});
});
