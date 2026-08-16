import type { EarnedAchievement } from '../domain/achievements.ts';
import { panelWidth } from './bezel.ts';
import { escapeXml, FONT, PAD, PALETTE, ROW, text, toPng } from './card.ts';

/**
 * The badge strip.
 *
 * Unearned badges are drawn too, with the condition spelled out, rather than hidden until
 * they fire. A grid of blanks is a to-do list a visitor can act on; a grid that only fills
 * in behind you is a changelog. Since the whole point is to give a returning reader
 * something that has moved, the ones still outstanding are doing as much work as the ones
 * lit up.
 */

const WIDTH = panelWidth();
const COLUMNS = 2;

/** Filled when earned, hollow when not — readable without relying on colour alone. */
function marker(x: number, y: number, earned: boolean): string {
	return earned
		? `<circle cx="${x + 4}" cy="${y + 7}" r="4.5" fill="${PALETTE.good}"/>`
		: `<circle cx="${x + 4}" cy="${y + 7}" r="4" fill="none" stroke="${PALETTE.edge}" stroke-width="1.5"/>`;
}

export function renderAchievementsCard(badges: EarnedAchievement[]): Promise<Buffer> {
	const body: string[] = [];
	const earned = badges.filter((badge) => badge.earnedAt !== undefined).length;

	let y = PAD + 14;
	body.push(text('ACHIEVEMENTS', PAD, y, { size: 15, bold: true }));
	body.push(
		text(`${earned} / ${badges.length}`, WIDTH - PAD, y, {
			// Grey until at least one is earned, so an untouched namespace does not present
			// a green-tinted zero as though it meant something.
			fill: earned > 0 ? PALETTE.good : PALETTE.dim,
			size: 12,
			anchor: 'end',
		}),
	);
	y += 22;

	const columnWidth = (WIDTH - PAD * 2) / COLUMNS;
	const rows = Math.ceil(badges.length / COLUMNS);

	badges.forEach((badge, index) => {
		// Filled down the columns rather than across the rows: the list is ordered roughly
		// easiest to hardest, and reading order should follow that.
		const column = Math.floor(index / rows);
		const row = index % rows;

		const x = PAD + column * columnWidth;
		const rowY = y + row * ROW;
		const isEarned = badge.earnedAt !== undefined;

		body.push(marker(x, rowY, isEarned));
		body.push(
			text(badge.name, x + 16, rowY + 11, {
				fill: isEarned ? PALETTE.ink : PALETTE.dim,
				size: 12,
				bold: isEarned,
			}),
		);

		// The condition sits after the name at a smaller size. Kept on earned badges too:
		// dropping it there would make the two columns ragged as badges fill in, and a
		// reader still has to know what "Untouchable" meant.
		body.push(
			`<text x="${x + columnWidth - 12}" y="${rowY + 11}" fill="${PALETTE.dim}" font-size="9" text-anchor="end" opacity="${isEarned ? 0.55 : 1}">${escapeXml(badge.hint)}</text>`,
		);
	});

	return toPng(WIDTH, y + rows * ROW + PAD - 6, `<g font-family="${FONT}">${body.join('')}</g>`);
}
