import { controllerRows, type ControlId } from './controller.ts';

/**
 * The README game block: ~60 links, every one of them a control.
 *
 * This was a script under `scripts/` for as long as the only README that mattered was
 * Loren's. It moved here when the generator page shipped, because the page and the CLI
 * have to emit byte-identical markup — two copies of a 60-link block is how one of them
 * ends up with a control that quietly points at the wrong namespace.
 *
 * It reads the tile grid from `controller.ts` rather than restating it, for the same
 * reason: the markup and the raster geometry cannot be allowed to drift. That has already
 * broken production once, when extending a button's region changed which tiles exist
 * without changing a pixel.
 */

export type EmbedOptions = {
	/** Origin the generated links point at, without a trailing slash. */
	api: string;
	namespace: string;
	/** Where a click returns the reader to. */
	callback: string;
	/** Append the global stats panel. Only Loren's profile uses this. */
	stats?: boolean;
	/** Link to the generator. Off for the generator's own preview, which is already there. */
	promote?: boolean;
};

/**
 * `n` frames of one key.
 *
 * Idle is a bare separator rather than a key plus one, so repeating `,` through the
 * general form gives `,,` per frame and waits twice as long as the label claims — which
 * is what "wait x10" in the details block had been doing.
 */
const rep = (key: string, n: number) => (key === ',' ? ','.repeat(n) : `${key},`.repeat(n));

const gap = '&nbsp;&nbsp;';

/**
 * Everything below goes into an HTML attribute in somebody's README, and `callback` is
 * whatever the generator's caller typed. A bare `"` would end the attribute and let the
 * rest be read as markup.
 */
function attr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function readmeBlock(options: EmbedOptions): string {
	const { api, namespace, callback, stats = false, promote = true } = options;

	const API = api.replace(/\/+$/, '');
	const append = (keys: string) => attr(`${API}/input/${namespace}/append?keys=${keys}&callback=${callback}`);

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
	const controller = (): string => {
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

		return ['<p align="center">', ...rows.map((r, i) => `${r}${i < rows.length - 1 ? '<br />' : ''}`), '</p>'].join(
			'\n',
		);
	};

	/** Key caps for what the moulded pad cannot carry. */
	const key = (label: string, keys: string, title: string) =>
		`<a href="${append(keys)}" title="${title}"><kbd> ${label} </kbd></a>`;

	const plain = (label: string, path: string, title: string) =>
		`<a href="${attr(`${API}/${path}?callback=${callback}`)}" title="${title}"><kbd> ${label} </kbd></a>`;

	/**
	 * The same six controls at a speed the moulded pad cannot carry.
	 *
	 * The pad moves five frames per press, which is the right default — one frame barely
	 * turns the player — but crossing a room five frames at a time is tedious, so the row
	 * is repeated at 1x and 25x.
	 */
	const speedRow = (label: string, times: number): string[] => {
		const suffix = times === 1 ? '' : ` x${times}`;
		const cap = (glyph: string, k: string, name: string) => key(glyph, rep(k, times), `${name}${suffix}`);

		return [
			`  <sub>${label}</sub><br />`,
			`  ${cap('&#9664;', 'l', 'Turn left')}${gap}${cap('&#9650;', 'u', 'Forward')}${gap}` +
				`${cap('&#9660;', 'd', 'Back')}${gap}${cap('&#9654;', 'r', 'Turn right')}${gap}` +
				`${cap('fire', 'f', 'Shoot')}${gap}${cap('wait', ',', 'Wait')}<br />`,
		];
	};

	const fine = [
		'<p align="center">',
		...speedRow('single presses', 1),
		'  <br />',
		...speedRow('x25 presses', 25),
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

	return [
		'<h3 align="center">Play Doom</h3>',
		'',
		'<p align="center">',
		'  <sub>anyone can play &mdash; every click moves the same shared game &nbsp;·&nbsp; ' +
			'<a href="https://github.com/lorencerri/play-doom">source</a></sub>' +
			(promote ? '<br />' : ''),
		// Directly under the tagline, which is where somebody who has just realised this is
		// a real game will look for how to get one.
		...(promote ? [`  <sub><a href="${API}/new">add to your own GitHub README</a></sub>`] : []),
		'</p>',
		'',
		'<p align="center">',
		`  <img src="${API}/frame/${namespace}/?type=.gif" alt="the current frame" />`,
		'</p>',
		'',
		controller(),
		'',
		fine,
		'',
		'<p align="center">',
		`  ${plain('&#8630; Undo', `input/${namespace}/rewind`, 'Take back the last key')}${gap}${plain('Reset', `input/${namespace}/reset`, 'Abandon this run and start over')}`,
		'</p>',
		'',
		'<p align="center">',
		`  <img src="${API}/status/${namespace}?image=true" alt="live game state and run history" />`,
		'</p>',
		'',
		// The run in progress, then the history. Status and the input log both describe
		// what is happening right now, so they sit together; achievements and the last
		// death are retrospective and follow.
		'<p align="center">',
		`  <img src="${API}/input/${namespace}?image=true" alt="input history" />`,
		'</p>',
		'',
		'<p align="center">',
		`  <img src="${API}/achievements/${namespace}" alt="achievements earned in this namespace" />`,
		'</p>',
		'',
		// Labelled, because on its own it is an unannounced gif of Doom sitting directly
		// under a live gif of Doom. "latest death" rather than "death cam": the first says
		// what the picture is, the second is a name for a feature nobody asked about. The
		// endpoint always answers with a picture — a placeholder card until something dies
		// — so this is safe before the first death.
		'<p align="center">',
		'  <sub>latest death</sub><br />',
		`  <img src="${API}/death/${namespace}" alt="the last few seconds before the most recent death" />`,
		'</p>',
		'',
		'<p align="center">',
		`  <a href="${API}/video/${namespace}/current">this run</a> &nbsp;·&nbsp;`,
		`  <a href="${API}/video/${namespace}/full">every finished run</a> &nbsp;·&nbsp;`,
		`  <a href="${API}/video/${namespace}/combined">everything</a>`,
		'</p>',
		'',
		details,
		...(stats ? ['', '<p align="center">', `  <img src="${API}/stats" alt="global play-doom statistics" />`, '</p>'] : []),
	].join('\n');
}
