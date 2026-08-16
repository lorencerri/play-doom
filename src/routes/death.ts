import { validateNamespace } from '../domain/keys.ts';
import { fileExists, png, serveFile } from '../http/serve.ts';
import { paths } from '../render/artifacts.ts';
import { renderNoDeathCard } from '../render/death-card.ts';

/**
 * The death cam: a gif of the moments before the most recent death.
 *
 * Read-only. The clip is written by the render that detects the death (see
 * `captureDeathCam`), never on demand — a request for it must not be able to start a
 * replay, or a page view could trigger work proportional to the run.
 *
 * Always answers with an image. The README's `<img>` is fixed markup that GitHub's proxy
 * fetches on every profile view, so a namespace with no death yet gets a placeholder card
 * rather than a 404 and a permanently broken image.
 */
export async function deathRoute(_req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const path = paths.death(namespace);

	if (await fileExists(path)) {
		return serveFile(path, 'image/gif', `death_${namespace}.gif`);
	}

	return png(await renderNoDeathCard(), `death_${namespace}.png`);
}
