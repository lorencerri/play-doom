import sharp from 'sharp';

/**
 * Shared drawing primitives for the PNG panels the README embeds.
 *
 * Both the run status and the global stats are the same kind of picture — a dark
 * panel, a heading, and rows with bars — so the palette and the bar geometry live
 * here rather than being copied. Two copies of a colour table is how the two images
 * end up subtly different shades of grey a few months from now.
 *
 * SVG rendered through sharp, for the same reason as text-image.ts: sharp ships
 * prebuilt binaries, and the alternative (node-canvas) is a native build in the image.
 */

export const PALETTE = {
	bg: '#1A1B1E',
	panel: '#212226',
	edge: '#2E3033',
	ink: '#C1C2C5',
	dim: '#7A7E85',
	good: '#6FA86F',
	warn: '#C9A227',
	bad: '#C8442A',
} as const;

export const FONT = 'DejaVu Sans Mono, monospace';
export const PAD = 16;
export const ROW = 22;

export function escapeXml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function text(
	value: string,
	x: number,
	y: number,
	opts: { fill?: string; size?: number; anchor?: 'start' | 'end'; bold?: boolean } = {},
): string {
	const anchor = opts.anchor === 'end' ? ' text-anchor="end"' : '';
	const weight = opts.bold ? ' font-weight="bold"' : '';
	return `<text x="${x}" y="${y}" fill="${opts.fill ?? PALETTE.ink}" font-size="${opts.size ?? 12}"${anchor}${weight}>${escapeXml(value)}</text>`;
}

export type BarSpec = {
	label: string;
	value: number;
	total: number;
	colour: string;
	caption: string;
	/** Defaults to the ink colour. Set it when the caption itself carries meaning. */
	captionColour?: string;
	labelWidth?: number;
	captionWidth?: number;
};

/** One labelled bar spanning the panel width, with a right-aligned caption. */
export function bar(spec: BarSpec, y: number, width: number): string {
	const labelW = spec.labelWidth ?? 78;
	const captionW = spec.captionWidth ?? 62;
	const trackX = PAD + labelW;
	const trackW = width - trackX - PAD - captionW;

	// A zero total means the level genuinely reports none of that thing. An empty
	// track is the honest picture and it avoids dividing by zero.
	const ratio = spec.total > 0 ? Math.max(0, Math.min(1, spec.value / spec.total)) : 0;
	const fillW = Math.round(trackW * ratio);

	return (
		text(spec.label, PAD, y + 11, { fill: PALETTE.dim }) +
		`<rect x="${trackX}" y="${y + 1}" width="${trackW}" height="12" rx="3" fill="${PALETTE.edge}"/>` +
		(fillW > 0 ? `<rect x="${trackX}" y="${y + 1}" width="${fillW}" height="12" rx="3" fill="${spec.colour}"/>` : '') +
		// The caption carries the colour as well as the bar: at a zero value the fill
		// has nothing to say, and a word like "DEAD" would render in neutral grey.
		text(spec.caption, width - PAD, y + 11, { fill: spec.captionColour ?? PALETTE.ink, anchor: 'end' })
	);
}

/** Wraps drawn content in the panel chrome and rasterises it. */
export function toPng(width: number, height: number, body: string): Promise<Buffer> {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
		`<rect width="100%" height="100%" rx="6" fill="${PALETTE.bg}"/>` +
		`<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${PALETTE.panel}" stroke="${PALETTE.edge}"/>` +
		`<g font-family="${FONT}">${body}</g>` +
		`</svg>`;

	return sharp(Buffer.from(svg)).png().toBuffer();
}
