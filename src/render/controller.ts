import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../config.ts';
import { fileExists } from '../http/serve.ts';

/**
 * A clickable NES-style controller for the README.
 *
 * GitHub strips CSS, so a control cannot be shaped or positioned by styling — which is
 * why the previous pad was a cross of separate `<kbd>` caps and read as a toolbar rather
 * than a D-pad. What GitHub does allow is images, and adjacent `<img align="top">` tiles
 * butt together with no seam in either direction, even wrapped in links. (Verified
 * against a rendered README before this was built: without `align="top"` the rows are
 * separated by the image baseline descender, about 4px, which cuts the cross in half.)
 *
 * So the controller is drawn once as an SVG, rasterised, and sliced into a grid whose
 * lines fall on button edges. Each cell becomes an `<a>` if it covers a control and a
 * plain `<img>` if it is body. Runs of adjacent cells sharing a target are merged into
 * one image, which keeps this to ~21 requests rather than ~70.
 *
 * Tiles are generated once into DATA_DIR and served by `/controller/:tile`, rather than
 * committed to the repo: the profile README lives in a different repository, and
 * pointing it at raw.githubusercontent would pin it to a branch that may be deleted.
 * The API is already a hard dependency of that README, so this adds no failure mode.
 */

/** Column widths, in pixels. Boundaries sit on control edges. */
const COLS = [14, 34, 34, 34, 22, 34, 8, 34, 22, 40, 12, 40, 16];
/** Row heights. */
const ROWS = [16, 34, 34, 34, 22];

const WIDTH = COLS.reduce((a, b) => a + b, 0);
const HEIGHT = ROWS.reduce((a, b) => a + b, 0);

const x = (i: number) => COLS.slice(0, i).reduce((a, b) => a + b, 0);
const y = (i: number) => ROWS.slice(0, i).reduce((a, b) => a + b, 0);

/** A control's footprint, in grid cells. Cells not covered are inert body. */
type Region = { id: ControlId; cols: [number, number]; rows: [number, number] };

/**
 * These double as tile filenames, so they are named for what the button *does* rather
 * than for its printed label.
 *
 * The two centre buttons were SELECT and START, which is only meaningful to someone who
 * grew up with the hardware — on a NES, SELECT cycles options and START opens the menu,
 * and neither name says so. They now read MENU and SELECT.
 *
 * `confirm` rather than reusing `select` for the renamed button: the id is a served
 * filename, and pointing `select-r2` at a *different* control would silently rewire
 * anyone holding older markup. Retiring the name means their image 404s, which is a
 * visible break rather than a button that quietly does the wrong thing.
 */
export type ControlId = 'up' | 'down' | 'left' | 'right' | 'menu' | 'confirm' | 'b' | 'a' | 'map';

const REGIONS: Region[] = [
	{ id: 'up', cols: [2, 3], rows: [1, 2] },
	{ id: 'left', cols: [1, 2], rows: [2, 3] },
	{ id: 'right', cols: [3, 4], rows: [2, 3] },
	{ id: 'down', cols: [2, 3], rows: [3, 4] },
	// A wide pill above the two centre buttons, in space the classic layout leaves empty.
	{ id: 'map', cols: [5, 8], rows: [1, 2] },
	{ id: 'menu', cols: [5, 6], rows: [2, 3] },
	{ id: 'confirm', cols: [7, 8], rows: [2, 3] },
	// Down to row 4 so the printed label is part of the target: the labels sit below the
	// circles, and leaving them out made the caption look clickable while doing nothing.
	{ id: 'b', cols: [9, 10], rows: [2, 4] },
	{ id: 'a', cols: [11, 12], rows: [2, 4] },
];

function regionAt(col: number, row: number): Region | undefined {
	return REGIONS.find((r) => col >= r.cols[0] && col < r.cols[1] && row >= r.rows[0] && row < r.rows[1]);
}

const BODY = '#CFCFC6';
const BODY_DARK = '#8E8E86';
const PLASTIC = '#1B1B1B';
const CROSS_HI = '#3A3A3A';
const RED = '#C62B2E';
const RED_DARK = '#6E1214';
const SANS = 'DejaVu Sans, sans-serif';

function roundButton(cx: number, cy: number, r: number, label: string): string {
	return (
		`<circle cx="${cx}" cy="${cy + 2}" r="${r}" fill="#00000055"/>` +
		`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${RED}" stroke="${RED_DARK}" stroke-width="2"/>` +
		`<circle cx="${cx}" cy="${cy - r * 0.28}" r="${r * 0.62}" fill="#ffffff" opacity="0.10"/>` +
		// The label sits below the button, as on the real thing. It is free to overflow
		// its column: the tiles butt together seamlessly, so a glyph split across two of
		// them reassembles invisibly.
		`<text x="${cx}" y="${cy + r + 15}" fill="${PLASTIC}" font-family="${SANS}" font-size="11" font-weight="bold" text-anchor="middle">${label}</text>`
	);
}

function pill(col: number, label: string): string {
	const px = x(col) + 3;
	const py = y(2) + 10;
	const pw = COLS[col]! - 6;
	return (
		`<rect x="${px}" y="${py}" width="${pw}" height="12" rx="6" fill="${PLASTIC}"/>` +
		`<text x="${px + pw / 2}" y="${py + 25}" fill="${PLASTIC}" font-family="${SANS}" font-size="9" text-anchor="middle">${label}</text>`
	);
}

/** A wide flat button, for the extra control the classic eight do not cover. */
function bar(fromCol: number, toCol: number, row: number, label: string): string {
	const px = x(fromCol) + 4;
	const pw = x(toCol) - x(fromCol) - 8;
	const py = y(row) + 9;
	return (
		`<rect x="${px}" y="${py}" width="${pw}" height="16" rx="5" fill="${PLASTIC}"/>` +
		`<text x="${px + pw / 2}" y="${py + 12}" fill="${BODY}" font-family="${SANS}" font-size="9" font-weight="bold" text-anchor="middle">${label}</text>`
	);
}

/** The D-pad: one continuous cross, which is the entire reason for doing this in images. */
function dpad(): string {
	const left = x(1);
	const top = y(1);
	const armW = COLS[1]! + COLS[2]! + COLS[3]!;
	const armH = ROWS[1]! + ROWS[2]! + ROWS[3]!;
	const cw = COLS[2]!;
	const ch = ROWS[2]!;

	const arrow = (cx: number, cy: number, dir: 'u' | 'd' | 'l' | 'r') => {
		const s = 6;
		const pts =
			dir === 'u'
				? `${cx},${cy - s} ${cx - s},${cy + s} ${cx + s},${cy + s}`
				: dir === 'd'
					? `${cx},${cy + s} ${cx - s},${cy - s} ${cx + s},${cy - s}`
					: dir === 'l'
						? `${cx - s},${cy} ${cx + s},${cy - s} ${cx + s},${cy + s}`
						: `${cx + s},${cy} ${cx - s},${cy - s} ${cx - s},${cy + s}`;
		return `<polygon points="${pts}" fill="${CROSS_HI}"/>`;
	};

	return (
		// A shadow rather than a slab: a filled panel behind the cross read as something
		// stuck on top of the body instead of sunk into it.
		`<rect x="${left - 5}" y="${top - 5}" width="${armW + 10}" height="${armH + 10}" rx="8" fill="#000000" opacity="0.13"/>` +
		`<rect x="${left}" y="${top + ch}" width="${armW}" height="${ch}" rx="3" fill="${PLASTIC}"/>` +
		`<rect x="${left + cw}" y="${top}" width="${cw}" height="${armH}" rx="3" fill="${PLASTIC}"/>` +
		`<circle cx="${left + cw + cw / 2}" cy="${top + ch + ch / 2}" r="7" fill="${CROSS_HI}"/>` +
		arrow(left + cw + cw / 2, top + ch / 2, 'u') +
		arrow(left + cw + cw / 2, top + armH - ch / 2, 'd') +
		arrow(left + cw / 2, top + ch + ch / 2, 'l') +
		arrow(left + armW - cw / 2, top + ch + ch / 2, 'r')
	);
}

function controllerSvg(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="10" fill="${BODY}" stroke="#55554F"/>
<rect x="0" y="${HEIGHT - 16}" width="${WIDTH}" height="15" fill="${BODY_DARK}"/>
<rect x="12" y="${HEIGHT - 12}" width="${WIDTH - 24}" height="4" rx="2" fill="${RED_DARK}"/>
<rect x="${x(5) - 6}" y="${y(2) - 4}" width="${x(8) - x(5) + 12}" height="${ROWS[2]!}" rx="6" fill="#000000" opacity="0.10"/>
<rect x="${x(9) - 8}" y="${y(1)}" width="${x(12) - x(9) + 16}" height="${ROWS[1]! + ROWS[2]! + 6}" rx="10" fill="#7E2326"/>
${dpad()}
${bar(5, 8, 1, 'MAP')}
${pill(5, 'MENU')}
${pill(7, 'SELECT')}
${roundButton(x(9) + COLS[9]! / 2, y(2) + ROWS[2]! / 2, 17, 'USE')}
${roundButton(x(11) + COLS[11]! / 2, y(2) + ROWS[2]! / 2, 17, 'FIRE')}
<rect x="10" y="6" width="${WIDTH - 20}" height="2" fill="#ffffff" opacity="0.25"/>
</svg>`;
}

export type Tile = { name: string; control?: ControlId };

/**
 * The tile grid, row by row, with adjacent same-target cells merged.
 *
 * Exported so the README generator emits markup matching exactly what is rasterised —
 * one source of truth for the geometry, rather than a layout duplicated in two places
 * that can drift.
 */
export function controllerRows(): Tile[][] {
	const rows: Tile[][] = [];

	for (let r = 0; r < ROWS.length; r++) {
		const cells: Tile[] = [];
		let c = 0;

		while (c < COLS.length) {
			const region = regionAt(c, r);
			let span = 1;
			while (c + span < COLS.length && regionAt(c + span, r)?.id === region?.id) span++;

			cells.push({
				name: region ? `${region.id}-r${r}` : `body-${r}-${c}`,
				...(region ? { control: region.id } : {}),
			});
			c += span;
		}

		rows.push(cells);
	}

	return rows;
}

const dir = () => `${config.DATA_DIR}/controller`;
const stampPath = () => `${dir()}/.artwork`;

/**
 * Regenerates whenever the artwork changes, not just when the tiles are missing.
 *
 * Keying a cache on "does the file exist" is how the bezel shipped and never appeared:
 * the inputs had not moved, so nothing re-rendered and every frame stayed on the old
 * design. Hashing the SVG means editing a colour or a label is enough to invalidate.
 */
async function currentStamp(): Promise<string | undefined> {
	const file = Bun.file(stampPath());
	return (await file.exists()) ? file.text() : undefined;
}

/** Generates the tiles if they are missing or out of date, and returns the directory. */
export async function ensureControllerTiles(): Promise<string> {
	const svg = controllerSvg();

	// Hashes the grid as well as the artwork. Hashing only the SVG shipped a live
	// break: extending the USE/FIRE regions by a row changed which tiles exist without
	// changing a pixel, so the stamp matched, nothing regenerated, and the README asked
	// for tiles that had never been written. The cache key has to cover everything the
	// output depends on, and the tile *set* is part of the output.
	const stamp = Bun.hash(`${svg}\0${JSON.stringify(controllerRows())}`).toString(16);

	if ((await currentStamp()) === stamp && (await fileExists(`${dir()}/body-0-0.png`))) return dir();

	await mkdir(dir(), { recursive: true });
	const full = await sharp(Buffer.from(svg)).png().toBuffer();

	for (let r = 0; r < ROWS.length; r++) {
		let c = 0;
		for (const tile of controllerRows()[r]!) {
			// Recompute the span from the merged tile so the crop matches the markup.
			let span = 1;
			const region = regionAt(c, r);
			while (c + span < COLS.length && regionAt(c + span, r)?.id === region?.id) span++;

			await sharp(full)
				.extract({
					left: x(c),
					top: y(r),
					width: COLS.slice(c, c + span).reduce((a, b) => a + b, 0),
					height: ROWS[r]!,
				})
				.png()
				.toFile(`${dir()}/${tile.name}.png`);

			c += span;
		}
	}

	// Written last, so a crash partway through leaves the stamp stale and the next
	// start retries rather than trusting a half-written set of tiles.
	await Bun.write(stampPath(), stamp);

	return dir();
}

/** Resolves a requested tile name to a path, rejecting anything not in the layout. */
export async function controllerTilePath(name: string): Promise<string | undefined> {
	const known = controllerRows()
		.flat()
		.some((tile) => tile.name === name);
	if (!known) return undefined;

	await ensureControllerTiles();
	return `${dir()}/${name}.png`;
}
