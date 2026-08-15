import { notFound, routes } from './app.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { logger } from './logger.ts';

const server = Bun.serve({
	port: config.PORT,
	routes,
	fetch: notFound,
	error(err) {
		logger.error({ err }, 'unhandled server error');
		return Response.json({ error: 'internal server error' }, { status: 500 });
	},
});

logger.info({ port: server.port }, 'play-doom listening');

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
