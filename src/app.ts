import { HttpError } from './http/errors.ts';
import { logger } from './logger.ts';
import { frameRoute } from './routes/frame.ts';
import { healthRoute } from './routes/health.ts';
import { appendRoute, getInputRoute, resetRoute, rewindRoute } from './routes/input.ts';
import { homeRoute, statsRoute } from './routes/stats.ts';
import { combinedVideoRoute, currentVideoRoute, fullVideoRoute } from './routes/video.ts';

// Handlers are plain web-standard functions taking (Request, params) so the app
// stays portable off Bun.serve — only this file and index.ts know it exists.
export type RouteHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;

function paramsOf(req: Request): Record<string, string> {
	return (req as Request & { params?: Record<string, string> }).params ?? {};
}

// Wraps every handler with request logging and an error boundary. Nothing a route
// throws should ever kill the process — the old app's crash cause #2 was exactly
// that: an unhandled rejection after the response was already sent. Validation
// failures become 4xx; everything else is logged with a stack trace and becomes a
// 500, because an unexpected throw is a bug worth seeing in journalctl.
function wrap(name: string, handler: RouteHandler): RouteHandler {
	return async (req) => {
		const start = performance.now();
		try {
			const res = await handler(req, paramsOf(req));
			logger.info(
				{ route: name, method: req.method, status: res.status, ms: Math.round(performance.now() - start) },
				'request',
			);
			return res;
		} catch (err) {
			if (err instanceof HttpError) {
				logger.warn({ route: name, status: err.status, message: err.message }, 'request rejected');
				return Response.json({ error: err.message }, { status: err.status });
			}

			logger.error({ route: name, method: req.method, err }, 'request failed');
			return Response.json({ error: 'internal server error' }, { status: 500 });
		}
	};
}

// Several of the links already published in the profile README carry a trailing
// slash (`/frame/github/?type=.gif`, `/input/github/rewind/?callback=...`), which
// does not match the same pattern without one. Registering both keeps those links
// working rather than redirecting them — a redirect would put an extra round trip
// on the image path every profile view.
function withTrailingSlash(table: Record<string, RouteHandler>): Record<string, { GET: RouteHandler }> {
	const expanded: Record<string, { GET: RouteHandler }> = {};

	for (const [path, handler] of Object.entries(table)) {
		expanded[path] = { GET: handler };
		if (path !== '/') expanded[`${path}/`] = { GET: handler };
	}

	return expanded;
}

export const routes = withTrailingSlash({
	'/': wrap('home', homeRoute),
	'/health': wrap('health', healthRoute),
	'/stats': wrap('stats', statsRoute),

	'/frame/:namespace': wrap('frame', frameRoute),

	'/input/:namespace': wrap('input.get', getInputRoute),
	'/input/:namespace/append': wrap('input.append', appendRoute),
	'/input/:namespace/rewind': wrap('input.rewind', rewindRoute),
	'/input/:namespace/reset': wrap('input.reset', resetRoute),

	'/video/:namespace/current': wrap('video.current', currentVideoRoute),
	'/video/:namespace/full': wrap('video.full', fullVideoRoute),
	'/video/:namespace/combined': wrap('video.combined', combinedVideoRoute),
});

export function notFound(): Response {
	return Response.json({ error: 'not found' }, { status: 404 });
}
