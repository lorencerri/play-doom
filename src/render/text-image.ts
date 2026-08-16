import sharp from 'sharp';

// Matches the original `ultimate-text-to-image` settings so the README images keep
// looking the same (legacy/src/app.service.ts:138-146). That package pulls in
// node-canvas, a native build that would need compiling in the image; sharp ships
// prebuilt binaries and renders the same thing through an SVG.
const FONT_SIZE = 12;
const FONT_COLOR = '#C1C2C5';
const BACKGROUND = '#1A1B1E';
const MARGIN = 2;
const MAX_WIDTH = 1920 / 2;

// DejaVu Sans Mono — the font `fonts-dejavu-core` provides in the image — advances
// 0.60205em per glyph. Every character being the same width is what makes laying
// this out without a text-measuring library possible.
const CHAR_WIDTH = FONT_SIZE * 0.60205;
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.35);

/** How many glyphs fit in a canvas of this width, allowing for the margins. */
function charsPerLine(width: number): number {
	return Math.max(1, Math.floor((width - MARGIN * 2) / CHAR_WIDTH));
}

const MAX_CHARS_PER_LINE = charsPerLine(MAX_WIDTH);

function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Wraps on spaces, falling back to a hard break for a single word longer than the line.
 *
 * The original chunked purely by character count, which was invisible at the old
 * content-derived width because nothing ever wrapped. Once the strip was pinned to the
 * panel width it started splitting words down the middle — "Spa / ce" — which reads as
 * broken rather than wrapped.
 */
function wrap(text: string, limit = MAX_CHARS_PER_LINE): string[] {
	const lines: string[] = [];

	for (const paragraph of text.split('\n')) {
		if (paragraph.length <= limit) {
			lines.push(paragraph);
			continue;
		}

		let line = '';
		for (const word of paragraph.split(' ')) {
			// A word that cannot fit on any line has to be broken somewhere.
			if (word.length > limit) {
				if (line) {
					lines.push(line);
					line = '';
				}
				for (let i = 0; i < word.length; i += limit) lines.push(word.slice(i, i + limit));
				continue;
			}

			if (line.length === 0) line = word;
			else if (line.length + 1 + word.length <= limit) line += ` ${word}`;
			else {
				lines.push(line);
				line = word;
			}
		}

		if (line) lines.push(line);
	}

	return lines.length > 0 ? lines : [''];
}

/**
 * @param fixedWidth forces the output width instead of sizing to the text. The README
 *   stacks this under images of a known width, and a strip that changes width with its
 *   contents is what made that stack look like unrelated pieces.
 */
export async function renderTextImage(text: string, fixedWidth?: number): Promise<Buffer> {
	// Wrapping has to follow the canvas: forcing a width while still wrapping at the
	// default meant lines ran past the right edge and were clipped mid-word.
	const lines = wrap(text, fixedWidth === undefined ? MAX_CHARS_PER_LINE : charsPerLine(fixedWidth));
	const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);

	const width = fixedWidth ?? Math.max(1, Math.ceil(MARGIN * 2 + longest * CHAR_WIDTH));
	const height = MARGIN * 2 + LINE_HEIGHT * lines.length;

	const spans = lines
		.map((line, i) => {
			const y = MARGIN + LINE_HEIGHT * i + FONT_SIZE;
			return `<text x="${MARGIN}" y="${y}" xml:space="preserve">${escapeXml(line)}</text>`;
		})
		.join('');

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
		`<rect width="100%" height="100%" fill="${BACKGROUND}"/>` +
		`<g font-family="DejaVu Sans Mono, monospace" font-size="${FONT_SIZE}" fill="${FONT_COLOR}">${spans}</g>` +
		`</svg>`;

	return sharp(Buffer.from(svg)).png().toBuffer();
}
