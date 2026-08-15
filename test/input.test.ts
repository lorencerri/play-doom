import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	BOOTSTRAP_PREFIX,
	appendBatch,
	clearInput,
	getInput,
	getStoredBatches,
	rewindKeys,
} from '../src/domain/input.ts';

const ns = 'test_input';

beforeEach(() => clearInput(ns));

describe('bootstrap prefix', () => {
	test('is byte-identical to the one live namespaces were built with', () => {
		// Every stored run replays on top of this. Changing it by even one idle frame
		// desynchronises every namespace on the live box, so it is pinned against the
		// original source rather than transcribed and hoped for.
		const legacy = readFileSync('legacy/src/app.service.ts', 'utf8');
		const match = legacy.match(/return \['(x,[^']+)'\]/);

		expect(match?.[1]).toBe(BOOTSTRAP_PREFIX);
	});

	test('is prepended to an empty buffer', () => {
		expect(getInput(ns)).toEqual([BOOTSTRAP_PREFIX]);
	});

	test('is prepended to stored batches', () => {
		appendBatch(ns, 'u,');
		expect(getInput(ns)).toEqual([BOOTSTRAP_PREFIX, 'u,']);
	});

	test('is skipped when the run already opens with an Escape', () => {
		appendBatch(ns, 'x,');
		expect(getInput(ns)).toEqual(['x,']);
	});
});

describe('appendBatch', () => {
	test('keeps batches in click order', () => {
		appendBatch(ns, 'u,');
		appendBatch(ns, 'f,f,');
		appendBatch(ns, ',');

		expect(getStoredBatches(ns)).toEqual(['u,', 'f,f,', ',']);
	});

	test('isolates namespaces from each other', () => {
		appendBatch(ns, 'u,');
		appendBatch('test_input_other', 'd,');

		expect(getStoredBatches(ns)).toEqual(['u,']);
		clearInput('test_input_other');
	});
});

describe('rewindKeys', () => {
	test('removes a single key by default, not the whole batch', () => {
		// The original popped the entire batch, so rewinding after a 25x link undid
		// all 25 presses.
		appendBatch(ns, 'u,u,u,u,u,');

		expect(rewindKeys(ns, 1)).toBe(1);
		expect(getStoredBatches(ns)).toEqual(['u,u,u,u,']);
	});

	test('splits the tail batch when it holds more than requested', () => {
		appendBatch(ns, 'u,u,u,u,u,');

		expect(rewindKeys(ns, 3)).toBe(3);
		expect(getStoredBatches(ns)).toEqual(['u,u,']);
	});

	test('walks backwards across batch boundaries', () => {
		appendBatch(ns, 'u,u,');
		appendBatch(ns, 'f,f,f,');

		expect(rewindKeys(ns, 4)).toBe(4);
		expect(getStoredBatches(ns)).toEqual(['u,']);
	});

	test('drops a batch consumed exactly', () => {
		appendBatch(ns, 'u,u,');
		appendBatch(ns, 'f,f,');

		expect(rewindKeys(ns, 2)).toBe(2);
		expect(getStoredBatches(ns)).toEqual(['u,u,']);
	});

	test('stops at an empty buffer and reports what it removed', () => {
		appendBatch(ns, 'u,u,');

		expect(rewindKeys(ns, 10)).toBe(2);
		expect(getStoredBatches(ns)).toEqual([]);
		// The bootstrap prefix is synthesised, so a rewind can never eat the menu skip.
		expect(getInput(ns)).toEqual([BOOTSTRAP_PREFIX]);
	});

	test('is a no-op for zero or negative amounts', () => {
		appendBatch(ns, 'u,');

		expect(rewindKeys(ns, 0)).toBe(0);
		expect(rewindKeys(ns, -5)).toBe(0);
		expect(getStoredBatches(ns)).toEqual(['u,']);
	});
});

describe('clearInput', () => {
	test('empties the buffer and restarts numbering', () => {
		appendBatch(ns, 'u,');
		clearInput(ns);
		appendBatch(ns, 'd,');

		expect(getStoredBatches(ns)).toEqual(['d,']);
	});
});
