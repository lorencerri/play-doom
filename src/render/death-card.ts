import { panelWidth } from './bezel.ts';
import { PAD, PALETTE, text, toPng } from './card.ts';

/**
 * The placeholder served by `/death/:namespace` when there is no clip yet.
 *
 * A README embeds a fixed `<img>`, so the endpoint has to answer with a picture on the
 * very first page view — before anyone has played, let alone died. Returning 404 there
 * would put a broken-image icon on the profile permanently until the first death, which
 * is the one outcome this must not do.
 *
 * Sized to `panelWidth()` like the status and stats panels, so the column of images down
 * the README keeps a single edge.
 */

const WIDTH = panelWidth();
const HEIGHT = 56;

// The card has no inputs — same bytes every time — so it is rendered once and kept.
// Every other panel varies with the namespace and is rasterised per request.
let cached: Buffer | undefined;

export async function renderNoDeathCard(): Promise<Buffer> {
	if (cached) return cached;

	// Deliberately unheaded. The README labels this image "latest death" directly above
	// it, and a panel repeating that under the caption looks like a mistake. What the
	// placeholder has to say is only that nothing has happened yet.
	const body =
		text('no deaths yet', PAD, 24, { size: 13 }) +
		text('the last few seconds before a death show up here', PAD, 42, { fill: PALETTE.dim, size: 11 });

	cached = await toPng(WIDTH, HEIGHT, body);
	return cached;
}
