import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../config.ts';
import { fileExists } from '../http/serve.ts';
import { pictureSize } from './bezel.ts';

/**
 * The game screen, sliced into links you can click.
 *
 * The README has always been a gamepad: a cross of arrows that turn the player a few
 * degrees at a time. This makes the picture itself the control — click the door and the
 * player turns to face it and walks over. That is the whole feature, and the same
 * `align="top"` tiling that built the controller is what makes it possible: GitHub
 * strips CSS, so there is no overlay and no image map, but adjacent tiles butt together
 * with no seam and each one can be its own link.
 *
 * ## The mapping is Doom's own projection, run backwards
 *
 * A renderer turns a world position into a pixel. Everything here is that calculation
 * inverted: given a pixel, what did the player have to be looking at? Doom draws with a
 * 90° horizontal field of view from a focal length of half the view width, and floors
 * with `distance = planeheight * yslope[y]` — so a column's horizontal offset gives an
 * angle, and a row's height below the horizon gives a distance. Those two numbers become
 * a turn and a walk.
 *
 * Every constant below is read from the vendored engine rather than guessed, and each one
 * is cited where it appears. They are compile-time facts about Doom, not preferences: if
 * `vendor/doomreplay` is ever replaced by something with a different field of view or a
 * different status bar, this file is wrong and the aim will be visibly off.
 *
 * ## What it deliberately does not do
 *
 * It does not aim precisely. Eight columns quantise the turn to about 9°, so a click can
 * leave the player a few degrees off — and a walk long enough to be worth taking will
 * usually end against a wall rather than at the spot clicked. That is fine: the point is
 * that a click covers ground in roughly the right direction, which the five-frame D-pad
 * cannot do at any speed.
 */

/**
 * Doom's own geometry, in the 320x200 space the engine draws in.
 *
 * These are mirrored from the vendored source the same way `NATIVE_WIDTH` is in bezel.ts,
 * because the C is otherwise the only side that knows them:
 *
 * - `SBARHEIGHT` (r_main.h) is 32, so the 3D view is the top 168 rows and the status bar
 *   owns the rest. Clicking the ammo counter must not walk anywhere, which is why the
 *   status bar gets its own inert row.
 * - `centery = viewheight / 2` (R_ExecuteSetViewSize) puts the horizon at 84, *not* at the
 *   middle of the picture. Using 100 here would push every distance out by a third.
 * - `VIEWHEIGHT` (p_local.h) is 41: the eye sits that far above the floor, and it is the
 *   numerator of every floor distance.
 * - `FIELDOFVIEW` is 2048 of 8192, i.e. 90°, which makes the focal length exactly half the
 *   view width — the same 160 that `R_InitPlanes` divides by to build `yslope`.
 */
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 200;
const STATUS_BAR_HEIGHT = 32;
const VIEW_HEIGHT = SCREEN_HEIGHT - STATUS_BAR_HEIGHT;
const HORIZON = VIEW_HEIGHT / 2;
const EYE_HEIGHT = 41;
const FOCAL = 160;

/**
 * How far away the floor is at a given row, in map units.
 *
 * `R_MapPlane` computes `distance = planeheight * yslope[y]` with
 * `yslope[y] = (viewwidth / 2) / |y - centery|`, and for a player standing on the floor
 * `planeheight` is the eye height. Rows above the horizon are not floor at all and the
 * result there is negative or infinite, which is why the top band never asks.
 */
function floorDistance(y: number): number {
	return (EYE_HEIGHT * FOCAL) / (y - HORIZON);
}

/** How far off centre a column is aimed, in degrees. The inverse of the same projection. */
function aimAngle(x: number): number {
	return (Math.atan((x - SCREEN_WIDTH / 2) / FOCAL) * 180) / Math.PI;
}

/**
 * Degrees turned per frame of a held arrow key.
 *
 * `angleturn[3] = {640, 1280, 320}` in g_game.c, as a fraction of the 65536-unit circle:
 * 320 units is 1.758° and 640 is 3.516°. The first `SLOWTURNTICS` (6) frames of a turn use
 * the slow value and the rest use the walking one — `turnheld` counts consecutive frames
 * with the key down, which consecutive `l,` tokens produce.
 */
const SLOW_TURN = (320 / 65536) * 360;
const NORMAL_TURN = (640 / 65536) * 360;
const SLOW_TURN_FRAMES = 6;

function turnFrames(degrees: number): number {
	const slowArc = SLOW_TURN * SLOW_TURN_FRAMES;
	if (degrees <= slowArc) return Math.max(1, Math.round(degrees / SLOW_TURN));
	return SLOW_TURN_FRAMES + Math.round((degrees - slowArc) / NORMAL_TURN);
}

/**
 * Walking, simulated rather than solved.
 *
 * `P_PlayerThink` calls `P_Thrust(player, angle, cmd->forwardmove * 2048)` with
 * `forwardmove[0] = 0x19`, and `P_XYMovement` moves by the momentum and then scales it by
 * `FRICTION` (0xe800). So speed ramps toward a terminal 8.33 units per frame and the first
 * few frames cover much less ground — enough that a closed-form estimate is wrong by ten
 * frames' worth of travel. Stepping the recurrence is exact, costs nothing, and reads as
 * what the engine does.
 *
 * Running is not used even though it is twice as fast. Shift is a *separate* key that has
 * to be held on every frame of the move, so a run is `su,su,su,…`, and the README's input
 * history renders that as an alternating list of eighty single presses instead of one
 * "Up Arrow [x40]". (Note that the `U`/`D`/`L`/`R` shortcuts the README's RUN row uses are
 * not handled by doomreplay's parser at all — see i_main.c — so those links have never
 * done anything. Unrelated bug, mentioned here so this comment is not read as the reason.)
 */
const THRUST = (25 * 2048) / 65536;
const FRICTION = 0xe800 / 65536;

/**
 * Longest walk a single click may buy.
 *
 * Not a physics limit — a cap on how committal one click is. Every frame appended here is
 * a frame every future render of this run has to replay, and the far band's honest answer
 * is over five hundred units and climbing toward infinity at the horizon. 58 frames covers
 * 403 units, about a large room, and keeps a click to roughly 1.7 seconds of play.
 */
const MAX_WALK_FRAMES = 58;

function walkFrames(distance: number): number {
	let speed = 0;
	let travelled = 0;

	for (let frame = 1; frame <= MAX_WALK_FRAMES; frame++) {
		speed += THRUST;
		travelled += speed;
		speed *= FRICTION;
		if (travelled >= distance) return frame;
	}

	return MAX_WALK_FRAMES;
}

/**
 * The three bands the view splits into, by their edges in Doom's 200-row space.
 *
 * Distance falls away so steeply near the horizon that even bands are useless: the top
 * half of the floor covers everything from twenty metres to the sky. So a band aims at the
 * middle of its *floor* portion — for the top band, which reaches above the horizon, that
 * is the sliver just under it — and the cap absorbs the rest.
 *
 * Three rather than six because every tile is an image GitHub's proxy fetches on every
 * view of the README, and the columns are where the value is: the turn is what the D-pad
 * cannot do, the walk is a bonus.
 */
const BANDS = [
	{ id: 'far', from: 0, to: 110 },
	{ id: 'mid', from: 110, to: 140 },
	{ id: 'near', from: 140, to: VIEW_HEIGHT },
] as const;

/** Splits a width into `n` integer columns that sum exactly to it. */
function split(total: number, n: number): number[] {
	const base = Math.floor(total / n);
	const extra = total - base * n;
	return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

const COLUMNS = 8;

export type ScreenTile = {
	name: string;
	/** Crop of the rendered frame this tile shows. */
	left: number;
	top: number;
	width: number;
	height: number;
	/** Input to append when clicked. Absent on the bezel and the status bar. */
	keys?: string;
	title?: string;
};

const repeat = (key: string, n: number) => `${key},`.repeat(n);

/**
 * The grid, row by row, with crops and links resolved.
 *
 * Exported whole so the markup and the slicing come from one description — the same rule
 * the controller learned the hard way, when extending a region changed which tiles existed
 * without changing a pixel and the README asked for files that had never been written.
 */
export function screenRows(): ScreenTile[][] {
	const picture = pictureSize(config.GIF_WIDTH);
	const border = config.FRAME_BORDER;

	// Doom's rows scaled into whatever the picture was rendered at, so this survives
	// GIF_WIDTH being turned on without the bands sliding off the floor.
	const toPixels = (y: number) => Math.round((y * picture.height) / SCREEN_HEIGHT);
	const columns = split(picture.width, COLUMNS);
	const columnLeft = columns.map((_, i) => columns.slice(0, i).reduce((a, b) => a + b, 0));

	const rows: ScreenTile[][] = [];
	const full = picture.width + border * 2;

	/**
	 * One inert strip: bezel or status bar. A single tile rather than a run of them —
	 * there is nothing clickable in it to break it up.
	 */
	const strip = (name: string, top: number, height: number): ScreenTile[][] =>
		height > 0 ? [[{ name, left: 0, top, width: full, height }]] : [];

	rows.push(...strip('body-top', 0, border));

	for (const band of BANDS) {
		const top = border + toPixels(band.from);
		const height = toPixels(band.to) - toPixels(band.from);

		// The aim point: the middle of the part of this band that is actually floor.
		const distance = floorDistance((Math.max(band.from, HORIZON) + band.to) / 2);
		const walk = walkFrames(distance);

		const cells: ScreenTile[] = [];
		if (border > 0) cells.push({ name: `body-${band.id}-l`, left: 0, top, width: border, height });

		for (let c = 0; c < COLUMNS; c++) {
			const centre = columnLeft[c]! + columns[c]! / 2;
			// Back into Doom's 320-wide space, where the projection constants live.
			const degrees = aimAngle((centre * SCREEN_WIDTH) / picture.width);
			const turn = turnFrames(Math.abs(degrees));
			const side = degrees < 0 ? 'l' : 'r';

			cells.push({
				name: `${band.id}-c${c}`,
				left: border + columnLeft[c]!,
				top,
				width: columns[c]!,
				height,
				keys: repeat(side, turn) + repeat('u', walk),
				title: `Turn ${Math.round(Math.abs(degrees))}° ${side === 'l' ? 'left' : 'right'}, then walk ${walk} frames`,
			});
		}

		if (border > 0) {
			cells.push({ name: `body-${band.id}-r`, left: border + picture.width, top, width: border, height });
		}

		rows.push(cells);
	}

	rows.push(...strip('body-status', border + toPixels(VIEW_HEIGHT), picture.height - toPixels(VIEW_HEIGHT)));
	rows.push(...strip('body-bottom', border + picture.height, border));

	return rows;
}

const dir = (namespace: string) => `${config.DATA_DIR}/screen_${namespace}`;
const stampPath = (namespace: string) => `${dir(namespace)}/.frame`;

/**
 * What the tiles on disk were cut from.
 *
 * Taken from the source file rather than from the input hash `ensureFrame` gates on, so
 * this module needs to know nothing about how a frame is rendered — if the png on disk is
 * the one the tiles came from, the tiles are current, whatever caused it to be written.
 */
function stampOf(sourcePng: string): string {
	const file = Bun.file(sourcePng);
	return `${file.size}:${file.lastModified}:${Bun.hash(JSON.stringify(screenRows())).toString(16)}`;
}

/**
 * One slice per source frame, however many tiles ask for it at once.
 *
 * GitHub's proxy fetches all thirty-odd tiles of a grid at the same moment, and each
 * request arrives at a route that has to guarantee its own tile exists. Without this the
 * first view of a new frame would re-cut the whole grid thirty times over.
 */
const inFlight = new Map<string, Promise<void>>();

export async function sliceScreen(namespace: string, sourcePng: string): Promise<void> {
	const existing = inFlight.get(namespace);

	// Re-entered rather than returning the job that was already running: a click can land
	// while a grid is being cut, and the slice this caller waited on would then be of the
	// frame before theirs. The second pass is free when nothing moved, because `cutTiles`
	// checks the stamp first, and it re-enters here so the waiters still collapse to one
	// cut rather than thirty.
	if (existing) {
		await existing;
		return sliceScreen(namespace, sourcePng);
	}

	const job = cutTiles(namespace, sourcePng).finally(() => inFlight.delete(namespace));
	inFlight.set(namespace, job);
	return job;
}

async function cutTiles(namespace: string, sourcePng: string): Promise<void> {
	const stamp = stampOf(sourcePng);
	const target = dir(namespace);

	const current = Bun.file(stampPath(namespace));
	if ((await current.exists()) && (await current.text()) === stamp) return;

	await mkdir(target, { recursive: true });

	// Decoded once into raw pixels, then cropped from that. Handing sharp the png buffer
	// per tile would decode the whole frame thirty-three times for one grid, on a path
	// that runs after every click.
	const { data, info } = await sharp(sourcePng).raw().toBuffer({ resolveWithObject: true });

	for (const tile of screenRows().flat()) {
		await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
			.extract({ left: tile.left, top: tile.top, width: tile.width, height: tile.height })
			.png()
			.toFile(`${target}/${tile.name}.png`);
	}

	// Written last, so a crash part-way through leaves the stamp stale and the next
	// request re-cuts rather than trusting a half-written grid.
	await Bun.write(stampPath(namespace), stamp);
}

/**
 * Resolves a requested tile to a path, rejecting anything not in the layout.
 *
 * An allowlist rather than sanitising, for the same reason the controller uses one: the
 * name reaches a filesystem path, and "this is one of the tiles we generate" is the only
 * check that cannot be reasoned around.
 */
export async function screenTilePath(namespace: string, name: string): Promise<string | undefined> {
	const known = screenRows()
		.flat()
		.some((tile) => tile.name === name);
	if (!known) return undefined;

	const path = `${dir(namespace)}/${name}.png`;
	return (await fileExists(path)) ? path : undefined;
}
