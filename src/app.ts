import { logger } from './logger.ts';
import { healthRoute } from './routes/health.ts';

export type RouteHandler = (req: Request) => Response | Promise<Response>;

// Wraps every handler with request logging and an error boundary. Nothing a route
// throws should ever kill the process — the old app's crash cause #2 was exactly
// that: an unhandled rejection after the response was already sent. Every failure
// here is caught, logged with a stack trace, and turned into a 500.
function wrap(name: string, handler: RouteHandler): RouteHandler {
	return async (req) => {
		const start = performance.now();
		try {
			const res = await handler(req);
			logger.info(
				{ route: name, method: req.method, status: res.status, ms: Math.round(performance.now() - start) },
				'request',
			);
			return res;
		} catch (err) {
			logger.error({ route: name, method: req.method, err }, 'request failed');
			return Response.json({ error: 'internal server error' }, { status: 500 });
		}
	};
}

// Route table grows in phase 2 (frame, input, video, stats). Kept as a plain object
// of web-standard (req) => Response handlers so the app stays portable off Bun.serve
// if it ever needs to be — see memory: only this file and index.ts touch Bun-specific APIs.
export const routes = {
	'/health': { GET: wrap('health', healthRoute) },
};

export function notFound(): Response {
	return Response.json({ error: 'not found' }, { status: 404 });
}
