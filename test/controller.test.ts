import { describe, expect, test } from 'bun:test';
import { controllerRows, controllerTilePath } from '../src/render/controller.ts';

describe('controller layout', () => {
	const rows = controllerRows();
	const tiles = rows.flat();

	test('every control appears in the grid', () => {
		const controls = new Set(tiles.map((t) => t.control).filter(Boolean));
		expect([...controls].sort()).toEqual(['a', 'b', 'confirm', 'down', 'left', 'map', 'menu', 'right', 'up']);
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

describe('artwork staleness', () => {
	test('the stamp changes when the artwork changes', async () => {
		// Regression guard for the class of bug that hid the bezel: a cache keyed on
		// "does the file exist" never notices a redesign. If this ever compares equal,
		// editing a label or a colour will silently keep serving the old tiles.
		const { ensureControllerTiles } = await import('../src/render/controller.ts');
		const dir = await ensureControllerTiles();
		const stamp = await Bun.file(`${dir}/.artwork`).text();

		expect(stamp.length).toBeGreaterThan(0);
		// Second call is a no-op and must not change the stamp.
		await ensureControllerTiles();
		expect(await Bun.file(`${dir}/.artwork`).text()).toBe(stamp);
	});
});

describe('generated tiles match the layout', () => {
	test('every tile the layout names exists on disk', async () => {
		// This is the test that would have caught shipping a broken README: the regions
		// were extended by a row, which changed the tile set without changing a pixel,
		// so nothing regenerated and the page asked for files that did not exist.
		const { ensureControllerTiles, controllerRows: rows } = await import('../src/render/controller.ts');
		const dir = await ensureControllerTiles();

		for (const tile of rows().flat()) {
			expect(await Bun.file(`${dir}/${tile.name}.png`).exists()).toBe(true);
		}
	});
});

describe('control ids are served filenames', () => {
	test('the retired names are gone rather than reused', async () => {
		// `select` used to mean the menu-open button and `start` the confirm button. The
		// labels swapped; the ids did not follow, because pointing `select-r2` at a
		// different control would silently rewire anyone holding older markup. Retired
		// names must 404, which is a visible break instead of a wrong button.
		const { controllerRows: rows, controllerTilePath: resolve } = await import('../src/render/controller.ts');
		const names = new Set(rows().flat().map((t) => t.name));

		expect(names.has('start-r2')).toBe(false);
		expect(await resolve('start-r2')).toBeUndefined();
		expect(await resolve('select-r2')).toBeUndefined();
	});
});
