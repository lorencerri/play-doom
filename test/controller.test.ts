import { describe, expect, test } from 'bun:test';
import { controllerRows, controllerTilePath } from '../src/render/controller.ts';

describe('controller layout', () => {
	const rows = controllerRows();
	const tiles = rows.flat();

	test('every control appears in the grid', () => {
		const controls = new Set(tiles.map((t) => t.control).filter(Boolean));
		expect([...controls].sort()).toEqual(['a', 'b', 'down', 'left', 'map', 'right', 'select', 'start', 'up']);
	});

	test('tile names are unique, since they are also filenames', () => {
		const names = tiles.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test('adjacent cells sharing a control are merged into one tile', () => {
		// Without merging this grid is ~65 tiles, i.e. 65 proxied image requests per
		// page view. The merge is what makes the controller affordable.
		expect(tiles.length).toBeLessThan(30);
	});

	test('no row is empty', () => {
		for (const row of rows) expect(row.length).toBeGreaterThan(0);
	});

	test('a control never appears twice in the same row', () => {
		// Two tiles for one control in a row would mean the merge failed, and the
		// button would render as two pieces with a seam down it.
		for (const row of rows) {
			const controls = row.map((t) => t.control).filter(Boolean);
			expect(new Set(controls).size).toBe(controls.length);
		}
	});
});

describe('tile path resolution', () => {
	test('rejects a name that is not in the layout', async () => {
		// The name reaches a filesystem path, so this is an allowlist rather than
		// sanitisation — the only check that cannot be reasoned around.
		expect(await controllerTilePath('../../etc/passwd')).toBeUndefined();
		expect(await controllerTilePath('nope')).toBeUndefined();
		expect(await controllerTilePath('')).toBeUndefined();
	});

	test('resolves a real tile', async () => {
		const name = controllerRows()[0]![0]!.name;
		expect(await controllerTilePath(name)).toContain(name);
	});
});
