import { describe, expect, test } from 'bun:test';
import {
	convertKeyToName,
	normalizeInput,
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

	test('rejects empty, overlong, and out-of-alphabet names', () => {
		expect(() => validateNamespace('')).toThrow(HttpError);
		expect(() => validateNamespace('a'.repeat(33))).toThrow(HttpError);
		expect(() => validateNamespace('has-dash')).toThrow(HttpError);
		// A namespace lands in a file path, so traversal must not survive validation.
		expect(() => validateNamespace('../../etc/passwd')).toThrow(HttpError);
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
