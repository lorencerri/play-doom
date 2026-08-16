import { validateNamespace } from '../domain/keys.ts';
import { badRequest, notFoundError } from '../http/errors.ts';
import { serveFile } from '../http/serve.ts';
import { ensureScreenTiles } from '../render/artifacts.ts';
import { screenTilePath } from '../render/screen.ts';

/**
 * Serves one tile of the clickable game screen.
 *
 * Unlike the controller's tiles these are per-namespace and change with every click, so
 * the render is ensured on the way through rather than generated once at startup. The
 * whole grid asks at the same moment; `sliceScreen` collapses that into one cut.
 *
 * The tile name is checked against the generated layout rather than sanitised — it
 * reaches a filesystem path, and an allowlist is the only check that cannot be reasoned
 * around.
 */
export async function screenRoute(_req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');

	const raw = params.tile ?? '';
	const name = raw.endsWith('.png') ? raw.slice(0, -'.png'.length) : raw;
	if (name.length === 0) throw badRequest('tile is required');

	await ensureScreenTiles(namespace);

	const path = await screenTilePath(namespace, name);
	if (!path) throw notFoundError(`${raw} is not a screen tile`);

	return serveFile(path, 'image/png', `${name}.png`, { disposition: 'inline' });
}
