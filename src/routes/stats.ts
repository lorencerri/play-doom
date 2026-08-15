import { getStats } from '../domain/state.ts';
import { boolParam } from '../http/query.ts';
import { png } from '../http/serve.ts';
import { renderTextImage } from '../render/text-image.ts';

export async function statsRoute(req: Request): Promise<Response> {
	const stats = getStats();

	// The README embeds `/stats` with no query string and expects an image.
	if (!boolParam(new URL(req.url), 'image', true)) return Response.json(stats);

	const text = `\nActions: ${stats.actions}\nRewinds: ${stats.rewinds}\nKeys Pressed: ${stats.keysPressed}`;

	return png(await renderTextImage(text), 'stats.png');
}

export function homeRoute(): Response {
	return new Response('https://github.com/lorencerri/play-doom', {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}
