/**
 * Generates the README game block.
 *
 * This lives in the repo rather than in someone's scratch directory because it is
 * load-bearing: the block is ~50 links whose URLs are 140 characters each, it is the
 * game's only interface, and a typo in one is a broken control. It also has to agree
 * with `src/render/controller.ts` about the tile grid, so it imports that layout rather
 * than restating it.
 *
 *   bun run scripts/gen-readme.ts --namespace play-doom --callback https://github.com/...
 *
 * Prints the block to stdout; splicing it into a README is the caller's job, because the
 * profile README has been hand-edited and regenerating it wholesale would undo that.
 */
import { controllerRows, type ControlId } from '../src/render/controller.ts';

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const API = arg('api', 'https://doom-api-v2.plexidev.org');
const NS = arg('namespace', 'play-doom');
const CB = arg('callback', 'https://github.com/lorencerri/play-doom');

const rep = (key: string, n: number) => `${key},`.repeat(n);
const append = (keys: string) => `${API}/input/${NS}/append?keys=${keys}&callback=${CB}`;
const gap = '&nbsp;&nbsp;';

/**
 * What each control on the moulded pad does.
 *
 * The D-pad steps five frames: one frame barely turns the player. Single-frame nudges
 * live in the row underneath, where they are still visible without being the primary
 * way to move.
 */
const CONTROLS: Record<ControlId, { href: string; title: string }> = {
	up: { href: append(rep('u', 5)), title: 'Forward' },
	down: { href: append(rep('d', 5)), title: 'Back' },
	left: { href: append(rep('l', 5)), title: 'Turn left' },
	right: { href: append(rep('r', 5)), title: 'Turn right' },
	map: { href: append('t,'), title: 'MAP — toggle the automap' },
	select: { href: append('x,'), title: 'SELECT — open or close the menu' },
	start: { href: append('e,'), title: 'START — confirm a menu choice' },
	b: { href: append('p,'), title: 'USE — open doors, flip switches' },
	a: { href: append(rep('f', 5)), title: 'FIRE — shoot' },
};

/**
 * `align="top"` is load-bearing, not decoration: without it each row of tiles sits on
 * the text baseline and the descender leaves a ~4px gap that cuts the D-pad in half.
 * There must also be no whitespace between the tags, for the same reason.
 */
function controller(): string {
	const rows = controllerRows().map((row) =>
		row
			.map((tile) => {
				const img = `<img align="top" src="${API}/controller/${tile.name}.png" />`;
				if (!tile.control) return img;
				const { href, title } = CONTROLS[tile.control];
				return `<a href="${href}" title="${title}">${img}</a>`;
			})
			.join(''),
	);

	return ['<p align="center">', ...rows.map((r, i) => `${r}${i < rows.length - 1 ? '<br />' : ''}`), '</p>'].join('\n');
}

/** Key caps for what the moulded pad cannot carry: single-frame nudges and fire once. */
const key = (label: string, keys: string, title: string) =>
	`<a href="${append(keys)}" title="${title}"><kbd> ${label} </kbd></a>`;

const plain = (label: string, path: string, title: string) =>
	`<a href="${API}/${path}?callback=${CB}" title="${title}"><kbd> ${label} </kbd></a>`;

const fine = [
	'<p align="center">',
	// The moulded pad moves five frames per press; this row is the single-press version
	// of the same controls. "one frame at a time" described the implementation rather
	// than what the reader is choosing between.
	'  <sub>single presses</sub><br />',
	`  ${key('&#9664;', 'l,', 'Turn left one frame')}${gap}${key('&#9650;', 'u,', 'Forward one frame')}${gap}` +
		`${key('&#9660;', 'd,', 'Back one frame')}${gap}${key('&#9654;', 'r,', 'Turn right one frame')}${gap}` +
		`${key('fire', 'f,', 'Shoot once')}${gap}${key('wait', ',', 'Wait one frame')}`,
	'</p>',
].join('\n');

const caption = (label: string) => `  <sub><b>${label}</b></sub><br />`;
const speeds = (label: string, k: string) =>
	`  <sub>${label}</sub>${gap}${key('x1', rep(k, 1), `${label} x1`)}${gap}${key('x5', rep(k, 5), `${label} x5`)}${gap}${key('x25', rep(k, 25), `${label} x25`)}<br />`;

const details = [
	'<details align="center">',
	'<summary><b>All controls</b></summary>',
	'<p align="center">',
	'  <br />',
	caption('MOVEMENT'),
	speeds('forward', 'u'),
	speeds('back', 'd'),
	speeds('left', 'l'),
	speeds('right', 'r'),
	speeds('wait', ','),
	'  <br />',
	caption('STRAFE'),
	`  ${key('&#9664; strafe', rep('j', 5), 'Strafe left')}${gap}${key('strafe &#9654;', rep('k', 5), 'Strafe right')}<br />`,
	'  <br />',
	caption('RUN'),
	`  ${key('&#9650;', 'U,', 'Run forward')}${gap}${key('&#9660;', 'D,', 'Run back')}${gap}${key('&#9664;', 'L,', 'Run left')}${gap}${key('&#9654;', 'R,', 'Run right')}${gap}${key('Shift', 's,', 'Shift')}${gap}${key('Alt', 'a,', 'Alt')}<br />`,
	'  <br />',
	caption('WEAPONS'),
	`  ${[2, 3, 4, 5, 6, 7].map((n) => key(String(n), `${n},`, `Weapon ${n}`)).join(gap)}<br />`,
	'  <br />',
	caption('FIRE'),
	`  ${key('once', 'f,', 'Shoot once')}${gap}${key('x5', rep('f', 5), 'Shoot x5')}${gap}${key('x25', rep('f', 25), 'Shoot x25')}<br />`,
	'  <br />',
	caption('MENUS'),
	`  ${key('Escape', 'x,', 'Escape')}${gap}${key('Enter', 'e,', 'Enter')}${gap}${key('Yes', 'y,', 'Yes')}${gap}${key('No', 'n,', 'No')}<br />`,
	'  <br />',
	caption('WAIT'),
	`  ${key('x10', rep(',', 10), 'Wait x10')}${gap}${key('x25', rep(',', 25), 'Wait x25')}${gap}${key('x50', rep(',', 50), 'Wait x50')}`,
	'</p>',
	'</details>',
].join('\n');

const showStats = process.argv.includes('--stats');

const block = [
	'<h3 align="center">Play Doom</h3>',
	'',
	'<p align="center">',
	`  <sub>anyone can play &mdash; every click moves the same shared game &nbsp;·&nbsp; <a href="https://github.com/lorencerri/play-doom">source</a></sub>`,
	'</p>',
	'',
	'<p align="center">',
	`  <img src="${API}/frame/${NS}/?type=.gif" alt="the current frame" />`,
	'</p>',
	'',
	controller(),
	'',
	fine,
	'',
	'<p align="center">',
	`  ${plain('&#8630; Undo', `input/${NS}/rewind`, 'Take back the last key')}${gap}${plain('Reset', `input/${NS}/reset`, 'Abandon this run and start over')}`,
	'</p>',
	'',
	'<p align="center">',
	`  <img src="${API}/status/${NS}?image=true" alt="live game state and run history" />`,
	'</p>',
	'',
	'<p align="center">',
	`  <img src="${API}/input/${NS}?image=true" alt="input history" />`,
	'</p>',
	'',
	'<p align="center">',
	`  <a href="${API}/video/${NS}/current">this run</a> &nbsp;·&nbsp;`,
	`  <a href="${API}/video/${NS}/full">every finished run</a> &nbsp;·&nbsp;`,
	`  <a href="${API}/video/${NS}/combined">everything</a>`,
	'</p>',
	'',
	details,
	...(showStats
		? ['', '<p align="center">', `  <img src="${API}/stats" alt="global play-doom statistics" />`, '</p>']
		: []),
].join('\n');

console.log(block);
