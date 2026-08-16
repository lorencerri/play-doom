import { afterAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../src/config.ts';
import { validateKeys } from '../src/domain/keys.ts';
import { panelWidth, pictureSize } from '../src/render/bezel.ts';
import { readmeBlock } from '../src/render/embed.ts';
import { screenRows, screenTilePath, sliceScreen } from '../src/render/screen.ts';

const picture = pictureSize(config.GIF_WIDTH);
const WIDTH = panelWidth();
const HEIGHT = picture.height + config.FRAME_BORDER * 2;

const tiles = () => screenRows().flat();
const aimTiles = () => tiles().filter((tile) => tile.keys);

describe('the grid geometry', () => {
	test('covers the frame exactly, with no gap and no overlap', () => {
		// The tiles butt together with no seam, so a one-pixel error does not look like a
		// one-pixel error — it shifts everything after it and shears the picture.
		const owner = new Int32Array(WIDTH * HEIGHT).fill(-1);
		const overlaps: string[] = [];

		tiles().forEach((tile, index) => {
			for (let y = tile.top; y < tile.top + tile.height; y++) {
				for (let x = tile.left; x < tile.left + tile.width; x++) {
					const at = y * WIDTH + x;
					if (owner[at] !== -1) overlaps.push(`${tile.name} overlaps ${tiles()[owner[at]!]!.name} at ${x},${y}`);
					owner[at] = index;
				}
			}
		});

		expect(overlaps).toEqual([]);
		expect(owner.indexOf(-1)).toBe(-1);
	});

	test('every row is a full-width strip', () => {
		for (const row of screenRows()) {
			expect(row.reduce((sum, tile) => sum + tile.width, 0)).toBe(WIDTH);
			expect(new Set(row.map((tile) => tile.top)).size).toBe(1);
			expect(new Set(row.map((tile) => tile.height)).size).toBe(1);
		}
	});

	test('names are unique, since they are filenames', () => {
		const names = tiles().map((tile) => tile.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test('the bezel and the status bar are not clickable', () => {
		// Doom's status bar is the bottom 32 of its 200 rows and is not a view of the
		// world, so a click on the ammo counter must not walk anywhere.
		for (const tile of tiles().filter((t) => t.name.startsWith('body-'))) {
			expect(tile.keys).toBeUndefined();
		}

		const status = tiles().find((tile) => tile.name === 'body-status');
		expect(status?.height).toBe(Math.round((picture.height * 32) / 200));
	});
});

describe('what a click does', () => {
	test('the left half turns left and the right half turns right', () => {
		for (const tile of aimTiles()) {
			const column = Number(tile.name.slice(-1));
			expect(tile.keys?.startsWith(column < 4 ? 'l,' : 'r,')).toBe(true);
		}
	});

	test('a click nearer the edge turns further', () => {
		const turn = (name: string) => tiles().find((t) => t.name === name)!.keys!.split('u,')[0]!.length;

		expect(turn('mid-c0')).toBeGreaterThan(turn('mid-c1'));
		expect(turn('mid-c1')).toBeGreaterThan(turn('mid-c2'));
		expect(turn('mid-c2')).toBeGreaterThan(turn('mid-c3'));
	});

	test('a click higher up the screen walks further', () => {
		// The whole mapping in one assertion: the floor recedes as it climbs toward the
		// horizon, so a point drawn higher is a point further away.
		const walk = (name: string) => (tiles().find((t) => t.name === name)!.keys!.match(/u,/g) ?? []).length;

		expect(walk('far-c3')).toBeGreaterThan(walk('mid-c3'));
		expect(walk('mid-c3')).toBeGreaterThan(walk('near-c3'));
	});

	test('mirrored columns agree on how far they turn', () => {
		const turn = (name: string) => tiles().find((t) => t.name === name)!.keys!.split('u,')[0]!.length;

		for (let c = 0; c < 4; c++) expect(turn(`mid-c${c}`)).toBe(turn(`mid-c${7 - c}`));
	});

	test('every link is input the append route will accept', () => {
		// A click is a plain GET at `/input/:ns/append?keys=`, so a tile that generates
		// something the validator rejects is a dead region of the picture.
		for (const tile of aimTiles()) {
			expect(() => validateKeys(tile.keys!)).not.toThrow();
			expect(tile.keys!.length).toBeLessThanOrEqual(1024);
		}
	});
});

describe('slicing a frame', () => {
	const ns = 'test_screen';
	const source = `${config.DATA_DIR}/test_screen_source.png`;

	afterAll(async () => {
		await rm(`${config.DATA_DIR}/screen_${ns}`, { recursive: true, force: true });
		await rm(source, { force: true });
	});

	async function seed(): Promise<void> {
		await sharp({
			create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#204060' },
		})
			.png()
			.toFile(source);
	}

	test('writes every tile at the size the markup expects', async () => {
		await seed();
		await sliceScreen(ns, source);

		for (const tile of tiles()) {
			const meta = await sharp(`${config.DATA_DIR}/screen_${ns}/${tile.name}.png`).metadata();
			expect({ name: tile.name, width: meta.width, height: meta.height }).toEqual({
				name: tile.name,
				width: tile.width,
				height: tile.height,
			});
		}
	});

	test('does not re-cut a frame it has already cut', async () => {
		// Thirty-odd tile requests arrive together on every view of a README, and each one
		// has to guarantee its own tile exists.
		await seed();
		await sliceScreen(ns, source);

		const path = `${config.DATA_DIR}/screen_${ns}/near-c0.png`;
		const before = Bun.file(path).lastModified;

		await sliceScreen(ns, source);

		expect(Bun.file(path).lastModified).toBe(before);
	});

	test('re-cuts once the frame underneath changes', async () => {
		await seed();
		await sliceScreen(ns, source);

		await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#903020' } })
			.png()
			.toFile(source);
		await sliceScreen(ns, source);

		const tile = await sharp(`${config.DATA_DIR}/screen_${ns}/near-c0.png`).raw().toBuffer();
		expect(tile[0]).toBe(0x90);
	});

	test('refuses a tile name that is not in the layout', async () => {
		// The name reaches a filesystem path; an allowlist is the only check that cannot
		// be reasoned around.
		expect(await screenTilePath(ns, '../../../etc/passwd')).toBeUndefined();
		expect(await screenTilePath(ns, 'far-c9')).toBeUndefined();
	});
});

describe('the block', () => {
	const OPTS = { api: 'https://example.test', namespace: 'someone', callback: 'https://github.com/someone' };

	test('embeds every tile the layout defines', () => {
		const block = readmeBlock(OPTS);
		for (const tile of tiles()) {
			expect(block).toContain(`/screen/someone/${tile.name}.png`);
		}
	});

	test('says the picture is clickable, because nothing else does', () => {
		expect(readmeBlock(OPTS)).toContain('click the screen to turn and walk there');
	});

	test('replaces the animated frame rather than sitting beside it', () => {
		// A grid of animated tiles would be thirty gifs each starting its loop whenever it
		// finished loading, so the two cannot share a panel.
		expect(readmeBlock(OPTS)).not.toContain('/frame/someone/?type=.gif');
	});

	test('keeps the animated frame when asked', () => {
		const block = readmeBlock({ ...OPTS, screen: false });

		expect(block).toContain('/frame/someone/?type=.gif');
		expect(block).not.toContain('/screen/someone/');
	});
});
