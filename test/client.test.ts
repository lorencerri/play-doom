import { describe, expect, test } from 'bun:test';
import { newSalt, playerId, resolveClientAddress } from '../src/http/client.ts';

function request(headers: Record<string, string>): Request {
	return new Request('https://doom-api.plexidev.org/input/github/append?keys=u,', { headers });
}

describe('resolveClientAddress', () => {
	test('prefers CF-Connecting-IP, because X-Real-IP is the Cloudflare edge', () => {
		const req = request({
			'cf-connecting-ip': '203.0.113.7',
			'x-forwarded-for': '203.0.113.7, 172.70.34.1',
			'x-real-ip': '172.70.34.1',
		});

		expect(resolveClientAddress(req, '127.0.0.1', true)).toBe('203.0.113.7');
	});

	test('falls back to the first entry of the X-Forwarded-For chain', () => {
		const req = request({ 'x-forwarded-for': '203.0.113.7, 172.70.34.1, 10.0.0.2' });
		expect(resolveClientAddress(req, '127.0.0.1', true)).toBe('203.0.113.7');
	});

	test('tolerates a chain without spaces', () => {
		const req = request({ 'x-forwarded-for': '203.0.113.7,172.70.34.1' });
		expect(resolveClientAddress(req, undefined, true)).toBe('203.0.113.7');
	});

	test('falls back to the socket peer when no proxy headers are present', () => {
		expect(resolveClientAddress(request({}), '198.51.100.4', true)).toBe('198.51.100.4');
	});

	test('ignores proxy headers entirely when the proxy is not trusted', () => {
		const req = request({ 'cf-connecting-ip': '203.0.113.7' });
		expect(resolveClientAddress(req, '198.51.100.4', false)).toBe('198.51.100.4');
	});

	test('is undefined when there is nothing to go on', () => {
		expect(resolveClientAddress(request({}), undefined, true)).toBeUndefined();
	});

	test('skips a present-but-empty header rather than returning an empty address', () => {
		const req = request({ 'cf-connecting-ip': '', 'x-forwarded-for': '203.0.113.7' });
		expect(resolveClientAddress(req, undefined, true)).toBe('203.0.113.7');
	});
});

describe('playerId', () => {
	const salt = newSalt();

	test('is stable for the same address and salt', () => {
		expect(playerId('203.0.113.7', salt)).toBe(playerId('203.0.113.7', salt));
	});

	test('differs between addresses', () => {
		expect(playerId('203.0.113.7', salt)).not.toBe(playerId('203.0.113.8', salt));
	});

	test('differs between installs, so ids cannot be correlated across deployments', () => {
		expect(playerId('203.0.113.7', salt)).not.toBe(playerId('203.0.113.7', newSalt()));
	});

	test('does not contain the address it was derived from', () => {
		expect(playerId('203.0.113.7', salt)).not.toContain('203.0.113.7');
	});

	test('is a fixed-length hex id', () => {
		expect(playerId('203.0.113.7', salt)).toMatch(/^[0-9a-f]{32}$/);
	});
});
