import type { PastRun } from '../domain/status.ts';
import { bar, PAD, PALETTE, ROW, text, toPng } from './card.ts';
import { formatTics, levelName, type RunSummary } from './summary.ts';

/**
 * The "this run" panel the README embeds.
 *
 * The plain text version listed six `Label: value` lines, which is readable but makes
 * every number look equally important and gives no sense of *progress* — "Kills: 2/6"
 * and "Items: 0/37" read the same at a glance despite being very different states.
 * Bars turn those into something judgeable without reading, which is what an image in
 * a README is for.
 */

const WIDTH = 460;

/** Health colour tracks the number, so a dying run is obvious without reading it. */
function healthColour(health: number | undefined): string {
	if (health === undefined) return PALETTE.dim;
	if (health <= 35) return PALETTE.bad;
	if (health <= 70) return PALETTE.warn;
	return PALETTE.good;
}

export type StatusCardInput = {
	namespace: string;
	status?: RunSummary;
	best?: PastRun;
	runs: PastRun[];
};

export function renderStatusCard(input: StatusCardInput): Promise<Buffer> {
	const { namespace, status, best } = input;
	const onLevel = status?.state === 'level';

	const body: string[] = [];
	let y = PAD + 30;

	if (!status) {
		body.push(text('Nothing rendered yet — press a control.', PAD, y + 11, { fill: PALETTE.dim }));
		y += ROW;
	} else if (!onLevel) {
		// Off a level the engine reports no counters, because they would be the previous
		// level's. Saying so beats drawing four empty bars.
		body.push(text('In a menu or on the title screen.', PAD, y + 11, { fill: PALETTE.dim }));
		y += ROW;
	} else {
		const health = status.health;
		body.push(
			bar(
				{
					label: 'HEALTH',
					value: Math.max(0, health ?? 0),
					total: 100,
					colour: healthColour(health),
					caption: status.dead ? 'DEAD' : String(health ?? '?'),
					captionColour: healthColour(health),
				},
				y,
				WIDTH,
			),
		);
		y += ROW;

		for (const [label, value, total] of [
			['KILLS', status.kills, status.totalKills],
			['ITEMS', status.items, status.totalItems],
			['SECRETS', status.secrets, status.totalSecrets],
		] as const) {
			body.push(
				bar(
					{
						label,
						value: value ?? 0,
						total: total ?? 0,
						colour: PALETTE.good,
						caption: `${value ?? 0}/${total ?? 0}`,
					},
					y,
					WIDTH,
				),
			);
			y += ROW;
		}
	}

	if (best) {
		y += 6;
		const kills = best.kills === undefined ? '' : ` · ${best.kills}${best.totalKills ? `/${best.totalKills}` : ''} kills`;
		const time = best.tics === undefined ? '' : ` · ${formatTics(best.tics)}`;
		body.push(text('BEST', PAD, y + 11, { fill: PALETTE.dim }));
		body.push(text(`${levelName(best) ?? '??'}${kills}${time}`, PAD + 78, y + 11));
		y += ROW;
	}

	const title = onLevel ? (levelName(status) ?? namespace) : namespace;
	const clock = onLevel && status?.tics !== undefined ? formatTics(status.tics) : '';

	const header =
		text(title, PAD, PAD + 14, { size: 16, bold: true }) +
		text(clock, WIDTH - PAD, PAD + 14, { fill: PALETTE.dim, size: 13, anchor: 'end' });

	return toPng(WIDTH, y + PAD, header + body.join(''));
}
