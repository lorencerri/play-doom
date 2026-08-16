import type { MetaStats, NamespaceStats } from '../domain/meta.ts';
import type { Stats } from '../domain/state.ts';
import { panelWidth } from './bezel.ts';
import { bar, PAD, PALETTE, ROW, text, toPng } from './card.ts';

/**
 * The global stats panel.
 *
 * The plain text version was an aligned table, which is fine for reading but says
 * nothing about proportion — one namespace with 24,000 actions and one with 2 looked
 * like two rows. Bars scaled to the busiest namespace make the shape of the data the
 * first thing you see, and the live level turns the table from a history of clicks
 * into something that says where each game currently is.
 */

// Matches the framed screen and the run card, so all three share an edge.
const WIDTH = panelWidth();

/** Thousands separators: these run to six figures and are unreadable without them. */
const n = (value: number): string => value.toLocaleString('en-US');

function summaryRow(label: string, value: string, x: number, y: number): string {
	return text(label, x, y, { fill: PALETTE.dim, size: 11 }) + text(value, x, y + 15, { size: 14, bold: true });
}

export function renderStatsCard(
	stats: Stats,
	meta: MetaStats,
	levelOf: (namespace: string) => string | undefined,
): Promise<Buffer> {
	const body: string[] = [];
	let y = PAD + 14;

	body.push(text('PLAY DOOM', PAD, y, { size: 15, bold: true }));
	body.push(text(`${n(meta.uniquePlayers)} players · ${n(meta.uniqueInputs)} distinct inputs`, WIDTH - PAD, y, { fill: PALETTE.dim, size: 11, anchor: 'end' }));
	y += 24;

	// Four headline numbers across the top, evenly spaced.
	const cols = [
		['ACTIONS', n(stats.actions)],
		['KEYS PRESSED', n(stats.keysPressed)],
		['REWINDS', n(stats.rewinds)],
		['RUNS', n(meta.namespaces.reduce((sum, ns) => sum + ns.runs, 0))],
	] as const;

	const colW = (WIDTH - PAD * 2) / cols.length;
	cols.forEach(([label, value], i) => body.push(summaryRow(label, value, PAD + colW * i, y)));
	y += 44;

	if (meta.namespaces.length > 0) {
		body.push(text('NAMESPACE', PAD, y + 11, { fill: PALETTE.dim, size: 11 }));
		body.push(text('ACTIONS', WIDTH - PAD, y + 11, { fill: PALETTE.dim, size: 11, anchor: 'end' }));
		y += 18;

		// Bars are relative to the busiest namespace, not to any absolute scale — the
		// question this answers is "which of these is actually being played".
		const busiest = Math.max(...meta.namespaces.map((ns) => ns.actions), 1);

		for (const ns of meta.namespaces.slice(0, 8)) {
			const level = levelOf(ns.namespace);
			body.push(
				bar(
					{
						label: ns.namespace.length > 12 ? `${ns.namespace.slice(0, 11)}…` : ns.namespace,
						value: ns.actions,
						total: busiest,
						colour: PALETTE.good,
						caption: n(ns.actions),
						labelWidth: 104,
						captionWidth: 54,
					},
					y,
					WIDTH,
				),
			);
			// The live level sits just under the bar rather than in a column of its own:
			// it is context for the row, not a number to compare across rows. Autopilot
			// turns ride along on the same line — they belong next to the level because
			// they explain why it moved, and keeping them out of the bar is the point:
			// the bar answers "how much have people played this".
			const note = [level, ns.botActions > 0 ? `${n(ns.botActions)} by autopilot` : undefined]
				.filter(Boolean)
				.join(' · ');

			if (note) body.push(text(note, PAD + 104, y + 24, { fill: PALETTE.dim, size: 10 }));
			y += note ? ROW + 12 : ROW;
		}

		if (meta.namespaces.length > 8) {
			body.push(text(`+${meta.namespaces.length - 8} more`, PAD, y + 11, { fill: PALETTE.dim, size: 11 }));
			y += ROW;
		}
	}

	return toPng(WIDTH, y + PAD - 4, body.join(''));
}

export type { NamespaceStats };
