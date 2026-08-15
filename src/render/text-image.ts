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

const MAX_CHARS_PER_LINE = Math.max(1, Math.floor((MAX_WIDTH - MARGIN * 2) / CHAR_WIDTH));

function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function wrap(text: string): string[] {
	const lines: string[] = [];

	for (const paragraph of text.split('\n')) {
		if (paragraph.length <= MAX_CHARS_PER_LINE) {
			lines.push(paragraph);
			continue;
		}
		for (let i = 0; i < paragraph.length; i += MAX_CHARS_PER_LINE) {
			lines.push(paragraph.slice(i, i + MAX_CHARS_PER_LINE));
		}
	}

	return lines.length > 0 ? lines : [''];
}

export async function renderTextImage(text: string): Promise<Buffer> {
	const lines = wrap(text);
	const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);

	const width = Math.max(1, Math.ceil(MARGIN * 2 + longest * CHAR_WIDTH));
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
