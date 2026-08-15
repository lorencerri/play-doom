import sharp from 'sharp';
import type { PastRun } from '../domain/status.ts';
import { formatTics, levelName, type RunSummary } from './summary.ts';

/**
 * Renders the "this run" panel the README embeds.
 *
 * The plain text version listed six `Label: value` lines, which is readable but makes
 * every number look equally important and gives no sense of *progress* — "Kills: 2/6"
 * and "Items: 0/37" read the same at a glance despite being very different states.
 * Bars turn those into something you can judge without reading, which is what a README
 * image is for.
 *
 * Built as an SVG for the same reason as text-image.ts: sharp ships prebuilt binaries
 * and the alternative (node-canvas) is a native build in the image.
 */

const WIDTH = 460;
const PAD = 16;
const LINE = 22;

const BG = '#1A1B1E';
const PANEL = '#212226';
const EDGE = '#2E3033';
const INK = '#C1C2C5';
const DIM = '#7A7E85';

// Doom's own palette: the status bar is red on grey, so the accent follows it.
const GOOD = '#6FA86F';
const WARN = '#C9A227';
const BAD = '#C8442A';

const FONT = 'DejaVu Sans Mono, monospace';

function escapeXml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Health colour tracks the number, so a dying run is obvious without reading it. */
function healthColour(health: number | undefined): string {
	if (health === undefined) return DIM;
	if (health <= 0) return BAD;
	if (health <= 35) return BAD;
	if (health <= 70) return WARN;
	return GOOD;
}

type Bar = { label: string; value: number; total: number; colour: string; caption: string; captionColour?: string };

function bar(b: Bar, y: number): string {
	const trackX = PAD + 78;
	const trackW = WIDTH - trackX - PAD - 62;
	// A zero total means the level reports no items/secrets at all; an empty track is
	// the honest picture, and it avoids dividing by zero.
	const ratio = b.total > 0 ? Math.max(0, Math.min(1, b.value / b.total)) : 0;
	const fillW = Math.round(trackW * ratio);

	return (
		`<text x="${PAD}" y="${y + 11}" fill="${DIM}" font-size="12">${escapeXml(b.label)}</text>` +
		`<rect x="${trackX}" y="${y + 1}" width="${trackW}" height="12" rx="3" fill="${EDGE}"/>` +
		(fillW > 0 ? `<rect x="${trackX}" y="${y + 1}" width="${fillW}" height="12" rx="3" fill="${b.colour}"/>` : '') +
		// The caption carries the colour too, not just the fill: at zero health the bar
		// is empty, so the fill has nothing to say and "DEAD" would render as neutral
		// grey — the one state that should be impossible to miss.
		`<text x="${WIDTH - PAD}" y="${y + 11}" fill="${b.captionColour ?? INK}" font-size="12" text-anchor="end">${escapeXml(b.caption)}</text>`
	);
}

export type StatusCardInput = {
	namespace: string;
	status?: RunSummary;
	best?: PastRun;
	runs: PastRun[];
};

export async function renderStatusCard(input: StatusCardInput): Promise<Buffer> {
	const { namespace, status, best } = input;
	const onLevel = status?.state === 'level';

	const rows: string[] = [];
	let y = PAD + 30;

	if (!status) {
		rows.push(`<text x="${PAD}" y="${y + 11}" fill="${DIM}" font-size="12">Nothing rendered yet — press a control.</text>`);
		y += LINE;
	} else if (!onLevel) {
		// Off a level the engine reports no counters, because they would be the previous
		// level's. Saying so beats drawing six empty bars.
		rows.push(`<text x="${PAD}" y="${y + 11}" fill="${DIM}" font-size="12">In a menu or on the title screen.</text>`);
		y += LINE;
	} else {
		const health = status.health;
		rows.push(
			bar(
				{
					label: 'HEALTH',
					value: Math.max(0, health ?? 0),
					total: 100,
					colour: healthColour(health),
					caption: status.dead ? 'DEAD' : `${health ?? '?'}`,
					captionColour: healthColour(health),
				},
				y,
			),
		);
		y += LINE;

		for (const [label, value, total] of [
			['KILLS', status.kills, status.totalKills],
			['ITEMS', status.items, status.totalItems],
			['SECRETS', status.secrets, status.totalSecrets],
		] as const) {
			rows.push(
				bar(
					{
						label,
						value: value ?? 0,
						total: total ?? 0,
						colour: GOOD,
						caption: `${value ?? 0}/${total ?? 0}`,
					},
					y,
				),
			);
			y += LINE;
		}
	}

	if (best) {
		y += 6;
		const kills = best.kills === undefined ? '' : ` · ${best.kills}${best.totalKills ? `/${best.totalKills}` : ''} kills`;
		const time = best.tics === undefined ? '' : ` · ${formatTics(best.tics)}`;
		rows.push(
			`<text x="${PAD}" y="${y + 11}" fill="${DIM}" font-size="12">BEST</text>` +
				`<text x="${PAD + 78}" y="${y + 11}" fill="${INK}" font-size="12">${escapeXml(`${levelName(best) ?? '??'}${kills}${time}`)}</text>`,
		);
		y += LINE;
	}

	const height = y + PAD;

	const title = onLevel ? (levelName(status) ?? namespace) : namespace;
	const clock = onLevel && status?.tics !== undefined ? formatTics(status.tics) : '';

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">` +
		`<rect width="100%" height="100%" rx="6" fill="${BG}"/>` +
		`<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="6" fill="${PANEL}" stroke="${EDGE}"/>` +
		`<g font-family="${FONT}">` +
		`<text x="${PAD}" y="${PAD + 14}" fill="${INK}" font-size="16" font-weight="bold">${escapeXml(title)}</text>` +
		`<text x="${WIDTH - PAD}" y="${PAD + 14}" fill="${DIM}" font-size="13" text-anchor="end">${escapeXml(clock)}</text>` +
		rows.join('') +
		`</g></svg>`;

	return sharp(Buffer.from(svg)).png().toBuffer();
}
