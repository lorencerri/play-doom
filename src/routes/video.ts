import { validateNamespace } from '../domain/keys.ts';
import { serveFile } from '../http/serve.ts';
import { ensureCombinedVideo, ensureCurrentVideo, ensureFullVideo } from '../render/artifacts.ts';

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

/**
 * Every finished run. Runs are archived as individual segments, so this is where any
 * that are still pending get folded into the archive — see `ensureFullVideo`.
 */
export async function fullVideoRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');

	const fullPath = await ensureFullVideo(namespace);
	if (fullPath) return serveVideo(req, fullPath, namespace, 'full');

	// Nothing archived yet, so fall back to the run in progress. The original built
	// this path without the data directory prefix, so the fallback always ENOENT'd
	// (legacy/src/app.controller.ts:125). It also re-rendered the current video even
	// when the archive existed and the render was about to go unused.
	return serveVideo(req, await ensureCurrentVideo(namespace), namespace, 'current');
}

/** The archive plus the run in progress. */
export async function combinedVideoRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');

	// Fold first: the combined video is the archive plus the current run, and any
	// segment not yet merged is part of "the archive".
	const fullPath = await ensureFullVideo(namespace);
	const currentPath = await ensureCurrentVideo(namespace);

	// With no usable archive there is nothing to combine with.
	if (!fullPath) return serveVideo(req, currentPath, namespace, 'current');

	return serveVideo(req, await ensureCombinedVideo(namespace), namespace, 'combined');
}
