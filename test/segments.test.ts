import { beforeEach, describe, expect, test } from 'bun:test';
import { addSegment, clearSegments, listSegments, nextSeq } from '../src/domain/segments.ts';

const ns = 'test_segments';
const other = 'test_segments_other';

beforeEach(() => {
	clearSegments(ns, listSegments(ns));
	clearSegments(other, listSegments(other));
});

describe('nextSeq', () => {
	test('starts at zero for a namespace with nothing pending', () => {
		expect(nextSeq(ns)).toBe(0);
	});

	test('advances past the highest recorded segment', () => {
		addSegment(ns, nextSeq(ns));
		expect(nextSeq(ns)).toBe(1);

		addSegment(ns, nextSeq(ns));
		expect(nextSeq(ns)).toBe(2);
	});

	test('restarts once the pending segments are folded away', () => {
		addSegment(ns, 0);
		addSegment(ns, 1);
		clearSegments(ns, [0, 1]);

		// The segment files are deleted at the same time, so reusing the numbers is
		// safe — they order one pending batch, they are not permanent run ids.
		expect(nextSeq(ns)).toBe(0);
	});

	test('is independent per namespace', () => {
		addSegment(ns, 0);
		addSegment(ns, 1);

		expect(nextSeq(other)).toBe(0);
	});
});

describe('listSegments', () => {
	test('returns segments in the order they were recorded', () => {
		for (const seq of [0, 1, 2]) addSegment(ns, seq);

		// Order is what makes the archive chronological; a fold concatenates in
		// exactly this sequence.
		expect(listSegments(ns)).toEqual([0, 1, 2]);
	});

	test('is empty for an untouched namespace', () => {
		expect(listSegments(ns)).toEqual([]);
	});

	test('does not leak segments across namespaces', () => {
		addSegment(ns, 0);
		addSegment(other, 0);

		expect(listSegments(ns)).toEqual([0]);
		expect(listSegments(other)).toEqual([0]);
	});
});

describe('clearSegments', () => {
	test('removes only the sequences it was given', () => {
		for (const seq of [0, 1, 2]) addSegment(ns, seq);

		// The case this protects: a run archived while a fold is in flight must not be
		// dropped just because it appeared after the fold listed its inputs.
		clearSegments(ns, [0, 1]);

		expect(listSegments(ns)).toEqual([2]);
	});

	test('leaves other namespaces alone', () => {
		addSegment(ns, 0);
		addSegment(other, 0);

		clearSegments(ns, [0]);

		expect(listSegments(ns)).toEqual([]);
		expect(listSegments(other)).toEqual([0]);
	});

	test('is a no-op for an empty list', () => {
		addSegment(ns, 0);
		clearSegments(ns, []);

		expect(listSegments(ns)).toEqual([0]);
	});
});
