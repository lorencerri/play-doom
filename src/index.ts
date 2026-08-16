import { notFound, routes } from './app.ts';
import { startAutopilot } from './autopilot.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { startRetentionSweep } from './domain/retention.ts';
import { logger } from './logger.ts';

const server = Bun.serve({
	port: config.PORT,

	// Bun defaults to a 10 second idle timeout, which silently closed the socket on
	// every video request: rendering a run is O(its length) and takes tens of seconds,
	// so the client saw a 502 from nginx ("upstream prematurely closed connection")
	// while the render was still working. 255 is Bun's maximum, and it is deliberately
	// above VIDEO_TIMEOUT_MS so the render is what gives up first — with an error that
	// says so — rather than the connection dying underneath a job that would have
	// finished.
	idleTimeout: 255,
	// The table is built from portable (Request, params) handlers; Bun's own Routes
	// type is generic over each literal path pattern and can't infer through that
	// indirection. This cast is the one place the two representations meet.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	routes: routes as any,
	fetch: notFound,
	error(err) {
		logger.error({ err }, 'unhandled server error');
		return Response.json({ error: 'internal server error' }, { status: 500 });
	},
});

logger.info({ port: server.port }, 'play-doom listening');

// Started here rather than in app.ts so importing the route table — which every route
// test does — never starts a timer that plays somebody's game, or deletes their video.
startAutopilot();
startRetentionSweep();

// A crash with no trace was the original problem (§ Diagnosed crash causes). These
// two are the backstop: if something escapes every route's try/catch, log the full
// error *before* exiting, so the supervisor's restart comes with a record in
// journalctl instead of silence.
process.on('unhandledRejection', (reason) => {
	logger.fatal({ err: reason }, 'unhandled rejection');
	process.exit(1);
});

process.on('uncaughtException', (err) => {
	logger.fatal({ err }, 'uncaught exception');
	process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;

	logger.info({ signal }, 'shutting down');

	// Stop accepting new connections but let in-flight requests finish.
	await server.stop();
	db.close();

	logger.info('shutdown complete');
	process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
