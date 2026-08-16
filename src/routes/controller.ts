import { controllerTilePath } from '../render/controller.ts';
import { badRequest, notFoundError } from '../http/errors.ts';
import { serveFile } from '../http/serve.ts';

/**
 * Serves one tile of the README controller.
 *
 * The tile name is checked against the generated layout rather than sanitised, so a
 * request can only ever resolve to a file this module produced — the name reaches a
 * filesystem path, and an allowlist is the only check that cannot be reasoned around.
 */
export async function controllerRoute(_req: Request, params: Record<string, string>): Promise<Response> {
	const raw = params.tile ?? '';
	const name = raw.endsWith('.png') ? raw.slice(0, -'.png'.length) : raw;

	if (name.length === 0) throw badRequest('tile is required');

	const path = await controllerTilePath(name);
	if (!path) throw notFoundError(`${raw} is not a controller tile`);

	return serveFile(path, 'image/png', `${name}.png`, { disposition: 'inline' });
}
