import { validateFiletype, validateNamespace } from '../domain/keys.ts';
import { stringParam } from '../http/query.ts';
import { serveFile } from '../http/serve.ts';
import { ensureFrame } from '../render/artifacts.ts';

export async function frameRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);

	// The README links `?type=.gif`, with the dot.
	const requested = stringParam(url, 'type', 'png');
	const type = validateFiletype(requested.startsWith('.') ? requested.slice(1) : requested);

	// Normally a no-op by the time this runs: the click that changed the buffer
	// already started this render (plan 1.2). It stays here as the fallback for a
	// cold namespace, a failed eager render, or EAGER_RENDER being off.
	const outputPath = await ensureFrame(namespace, type);

	return serveFile(outputPath, `image/${type}`, `frame_${namespace}.${type}`);
}
