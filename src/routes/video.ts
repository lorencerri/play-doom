import { validateNamespace } from '../domain/keys.ts';
import { getState } from '../domain/state.ts';
import { fileExists, serveFile } from '../http/serve.ts';
import { ensureCombinedVideo, ensureCurrentVideo, paths } from '../render/artifacts.ts';

function serveVideo(req: Request, path: string, namespace: string, name: string): Promise<Response> {
	return serveFile(path, 'video/mp4', `${name}_${namespace}.mp4`, {
		disposition: 'inline',
		rangeHeader: req.headers.get('range'),
	});
}

/** The run in progress. */
export async function currentVideoRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	return serveVideo(req, await ensureCurrentVideo(namespace), namespace, 'current');
}

/** Every finished run, concatenated at reset time. */
export async function fullVideoRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const fullPath = paths.full(namespace);

	if (await fileExists(fullPath)) return serveVideo(req, fullPath, namespace, 'full');

	// Nothing archived yet, so fall back to the run in progress. The original built
	// this path without the data directory prefix, so the fallback always ENOENT'd
	// (legacy/src/app.controller.ts:125). It also re-rendered the current video even
	// when the archive existed and the render was about to go unused.
	return serveVideo(req, await ensureCurrentVideo(namespace), namespace, 'current');
}

/** The archive plus the run in progress. */
export async function combinedVideoRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');

	const currentPath = await ensureCurrentVideo(namespace);

	// With no usable archive there is nothing to combine with.
	if (!(await fileExists(paths.full(namespace))) || getState(namespace).full_video_outdated) {
		return serveVideo(req, currentPath, namespace, 'current');
	}

	return serveVideo(req, await ensureCombinedVideo(namespace), namespace, 'combined');
}
