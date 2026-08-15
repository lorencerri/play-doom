import { beforeEach, describe, expect, test } from 'bun:test';
import {
	degradedNamespaces,
	recordRenderFailure,
	recordRenderSuccess,
	renderHealth,
	resetRenderHealth,
} from '../src/render/health.ts';

beforeEach(() => resetRenderHealth());

describe('consecutive failure tracking', () => {
	test('counts failures in a row', () => {
		for (let i = 0; i < 3; i++) recordRenderFailure('a', new Error('boom'), false);

		expect(renderHealth()[0]?.consecutiveFailures).toBe(3);
	});

	test('a success clears the streak but keeps the totals', () => {
		recordRenderFailure('a', new Error('boom'), false);
		recordRenderFailure('a', new Error('boom'), false);
		recordRenderSuccess('a');

		const record = renderHealth()[0];
		expect(record?.consecutiveFailures).toBe(0);
		expect(record?.totalFailures).toBe(2);
		expect(record?.totalSuccesses).toBe(1);
	});

	test('keeps the last error message', () => {
		recordRenderFailure('a', new Error('doomgeneric timed out after 30000ms'), false);

		expect(renderHealth()[0]?.lastError).toContain('timed out');
	});

	test('accepts a non-Error throw without losing the detail', () => {
		recordRenderFailure('a', 'disk full', false);

		expect(renderHealth()[0]?.lastError).toBe('disk full');
	});

	test('tracks namespaces independently', () => {
		recordRenderFailure('a', new Error('boom'), false);
		recordRenderSuccess('b');

		expect(renderHealth().find((r) => r.namespace === 'a')?.consecutiveFailures).toBe(1);
		expect(renderHealth().find((r) => r.namespace === 'b')?.consecutiveFailures).toBe(0);
	});
});

describe('degraded reporting', () => {
	test('one failure is not degraded', () => {
		// A single failure is noise — a timeout under load, a transient disk hiccup.
		recordRenderFailure('a', new Error('boom'), false);

		expect(degradedNamespaces()).toEqual([]);
	});

	test('repeated failures for the same namespace are', () => {
		for (let i = 0; i < 3; i++) recordRenderFailure('a', new Error('boom'), false);

		expect(degradedNamespaces().map((r) => r.namespace)).toEqual(['a']);
	});

	test('recovering removes it from the degraded list', () => {
		for (let i = 0; i < 4; i++) recordRenderFailure('a', new Error('boom'), false);
		recordRenderSuccess('a');

		expect(degradedNamespaces()).toEqual([]);
	});

	test('records whether a stale artifact was served', () => {
		recordRenderFailure('a', new Error('boom'), true);

		expect(renderHealth()[0]?.servedStale).toBe(true);
	});

	test('worst namespaces are reported first', () => {
		recordRenderFailure('mild', new Error('boom'), false);
		for (let i = 0; i < 5; i++) recordRenderFailure('bad', new Error('boom'), false);

		expect(renderHealth()[0]?.namespace).toBe('bad');
	});
});

describe('bounded tracking', () => {
	test('does not grow without limit for user-supplied namespaces', () => {
		// Namespaces come from the URL, so an attacker could otherwise mint one entry
		// per request forever.
		for (let i = 0; i < 400; i++) recordRenderFailure(`ns${i}`, new Error('boom'), false);

		expect(renderHealth().length).toBeLessThanOrEqual(256);
	});
});
