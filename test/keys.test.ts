import { describe, expect, test } from 'bun:test';
import {
	convertKeyToName,
	normalizeInput,
	summarizeInput,
	tokenize,
	validateFiletype,
	validateKeys,
	validateNamespace,
} from '../src/domain/keys.ts';
import { HttpError } from '../src/http/errors.ts';

describe('validateNamespace', () => {
	test('accepts the alphabet the README uses', () => {
		expect(validateNamespace('github')).toBe('github');
		expect(validateNamespace('test_NS_123')).toBe('test_NS_123');
	});

	test('accepts hyphens, so a namespace can be named after its repo', () => {
		expect(validateNamespace('play-doom')).toBe('play-doom');
	});

	test('rejects empty, overlong, and out-of-alphabet names', () => {
		expect(() => validateNamespace('')).toThrow(HttpError);
		expect(() => validateNamespace('a'.repeat(33))).toThrow(HttpError);
		expect(() => validateNamespace('has space')).toThrow(HttpError);
		expect(() => validateNamespace('has.dot')).toThrow(HttpError);
	});

	test('still refuses anything that could escape the data directory', () => {
		// A namespace lands in a file path, so traversal must not survive validation.
		// Allowing hyphens must not have widened this.
		expect(() => validateNamespace('../../etc/passwd')).toThrow(HttpError);
		expect(() => validateNamespace('..')).toThrow(HttpError);
		expect(() => validateNamespace('a/b')).toThrow(HttpError);
		expect(() => validateNamespace('a\\b')).toThrow(HttpError);
	});
});

describe('validateKeys', () => {
	test('accepts every key in the alphabet', () => {
		expect(validateKeys(',xelrudaspftynUDLRjk234567')).toBeTruthy();
	});

	test('rejects empty, overlong, and unknown keys', () => {
		expect(() => validateKeys('')).toThrow(HttpError);
		expect(() => validateKeys(','.repeat(1025))).toThrow(HttpError);
		expect(() => validateKeys('u,z,')).toThrow(HttpError);
		// The buffer used to be interpolated into a shell string.
		expect(() => validateKeys('u,; rm -rf /')).toThrow(HttpError);
	});
});

describe('validateFiletype', () => {
	test('allows png and gif only', () => {
		expect(validateFiletype('png')).toBe('png');
		expect(validateFiletype('gif')).toBe('gif');
		expect(() => validateFiletype('mp4')).toThrow(HttpError);
	});
});

describe('tokenize', () => {
	test('treats <key>, as one press and a bare comma as one idle frame', () => {
		expect(tokenize('u,u,u,')).toEqual(['u,', 'u,', 'u,']);
		expect(tokenize(',,,')).toEqual([',', ',', ',']);
		expect(tokenize('x,e,,,')).toEqual(['x,', 'e,', ',', ',']);
		expect(tokenize('')).toEqual([]);
	});

	test('handles a trailing key with no separator', () => {
		expect(tokenize('u,u')).toEqual(['u,', 'u']);
	});
});

describe('normalizeInput', () => {
	test('names single keys', () => {
		expect(normalizeInput('u,')).toBe('Up Arrow');
		expect(normalizeInput('f,')).toBe('Shoot');
	});

	test('collapses runs into [xN]', () => {
		expect(normalizeInput('u,u,u,')).toBe('Up Arrow [x3]');
		expect(normalizeInput(',,,')).toBe('Idle [x3]');
	});

	test('joins mixed sequences in order', () => {
		expect(normalizeInput('x,e,,,f,f,')).toBe('Escape, Enter, Idle [x2], Shoot [x2]');
	});

	test('accepts the batch array form the buffer is stored in', () => {
		expect(normalizeInput(['u,u,', 'f,'])).toBe('Up Arrow [x2], Shoot');
	});

	test('is empty for an empty buffer', () => {
		expect(normalizeInput('')).toBe('');
	});
});

describe('convertKeyToName', () => {
	test('covers the whole alphabet with no Unknowns', () => {
		for (const key of ',xelrudaspftynUDLRjk234567') {
			expect(convertKeyToName(key)).not.toBe('Unknown');
		}
	});

	test('falls back for anything else', () => {
		expect(convertKeyToName('z')).toBe('Unknown');
	});
});

describe('summarizeInput', () => {
	const long = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'u,' : 'f,')).join('');

	test('returns a short history unchanged', () => {
		expect(summarizeInput('u,f,', 12)).toBe(normalizeInput('u,f,'));
	});

	test('keeps the most recent groups, which is what anyone reads', () => {
		// The prefix is joined to the first kept group by a space, not a comma, so
		// four groups split into four parts.
		expect(summarizeInput(long, 4).split(', ').length).toBe(4);
		expect(normalizeInput(long).split(', ').length).toBe(40);
	});

	test('says how much it dropped rather than truncating silently', () => {
		expect(summarizeInput(long, 4)).toMatch(/^\(\+\d+ earlier\) /);
	});

	test('ends on the newest action', () => {
		expect(summarizeInput('u,u,f,', 1)).toContain('Shoot');
	});

	test('handles an empty buffer', () => {
		expect(summarizeInput('', 12)).toBe('');
	});
});
