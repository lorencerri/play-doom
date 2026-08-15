import { getMetaStats, type NamespaceStats } from '../domain/meta.ts';
import { getStats } from '../domain/state.ts';
import { getStatus } from '../domain/status.ts';
import { boolParam } from '../http/query.ts';
import { png } from '../http/serve.ts';
import { levelName } from '../render/summary.ts';
import { renderTextImage } from '../render/text-image.ts';

// The stats image is rendered in a monospace font, so columns can be aligned by
// padding alone — see render/text-image.ts for why every glyph is the same width.
const COLUMNS: { header: string; width: number; of: (row: NamespaceStats) => string }[] = [
	{ header: 'Namespace', width: 18, of: (row) => row.namespace },
	{ header: 'Actions', width: 9, of: (row) => String(row.actions) },
	{ header: 'Keys', width: 9, of: (row) => String(row.keysPressed) },
	{ header: 'Rewinds', width: 9, of: (row) => String(row.rewinds) },
	{ header: 'Runs', width: 6, of: (row) => String(row.runs) },
	// Where the namespace actually is right now, straight from the engine's own
	// end-of-replay report rather than anything the API infers.
	{
		header: 'Level',
		width: 8,
		of: (row) => {
			const status = getStatus(row.namespace);
			return (status && levelName(status)) ?? '-';
		},
	},
];

function headerRow(): string {
	return COLUMNS.map((column) =>
		column.header === 'Namespace' ? column.header.padEnd(column.width) : column.header.padStart(column.width),
	).join('');
}

function namespaceRow(row: NamespaceStats): string {
	return COLUMNS.map((column) => {
		const value = column.of(row);
		// The namespace is left-aligned as a label; every count is right-aligned so
		// the digits line up down the column.
		return column.header === 'Namespace' ? value.padEnd(column.width) : value.padStart(column.width);
	})
		.join('')
		.trimEnd();
}

function statsText(stats: ReturnType<typeof getStats>, meta: ReturnType<typeof getMetaStats>): string {
	const lines = [
		'',
		`Actions: ${stats.actions}`,
		`Keys Pressed: ${stats.keysPressed}`,
		`Rewinds: ${stats.rewinds}`,
		`Unique Players: ${meta.uniquePlayers}`,
		`Unique Inputs: ${meta.uniqueInputs}`,
	];

	if (meta.namespaces.length > 0) {
		lines.push('', headerRow(), ...meta.namespaces.map(namespaceRow));
	}

	return lines.join('\n');
}

export async function statsRoute(req: Request): Promise<Response> {
	const stats = getStats();
	const meta = getMetaStats();

	// The README embeds `/stats` with no query string and expects an image.
	if (!boolParam(new URL(req.url), 'image', true)) {
		return Response.json({ ...stats, ...meta });
	}

	return png(await renderTextImage(statsText(stats, meta)), 'stats.png');
}

export function homeRoute(): Response {
	return new Response('https://github.com/lorencerri/play-doom', {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}
