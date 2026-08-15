import { access, constants, mkdir, rm, writeFile } from 'node:fs/promises';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { degradedNamespaces, renderHealth } from '../render/health.ts';
import { queueDepth } from '../render/queue.ts';

type Check = { name: string; ok: boolean; error?: string };

async function checkDb(): Promise<Check> {
	try {
		db.query('SELECT 1').get();
		return { name: 'database', ok: true };
	} catch (err) {
		return { name: 'database', ok: false, error: String(err) };
	}
}

async function checkWad(): Promise<Check> {
	try {
		await access(config.DOOM1_WAD, constants.R_OK);
		return { name: 'doom1.wad', ok: true };
	} catch {
		return { name: 'doom1.wad', ok: false, error: 'not found or unreadable' };
	}
}

async function checkDoomgeneric(): Promise<Check> {
	try {
		await access(config.DOOMGENERIC_BIN, constants.X_OK);
		return { name: 'doomgeneric', ok: true };
	} catch {
		return { name: 'doomgeneric', ok: false, error: 'not found or not executable' };
	}
}

async function checkDataDirWritable(): Promise<Check> {
	const probe = `${config.DATA_DIR}/.health-check-${process.pid}`;
	try {
		await mkdir(config.DATA_DIR, { recursive: true });
		await writeFile(probe, '');
		await rm(probe);
		return { name: 'data_dir_writable', ok: true };
	} catch (err) {
		return { name: 'data_dir_writable', ok: false, error: String(err) };
	}
}

export async function healthRoute(): Promise<Response> {
	const checks = await Promise.all([checkDb(), checkWad(), checkDoomgeneric(), checkDataDirWritable()]);
	const healthy = checks.every((c) => c.ok);

	const degraded = degradedNamespaces();

	// Degraded rendering does not make the process unhealthy: the dependencies are all
	// fine and the app is still serving. It would be wrong to have a supervisor restart
	// on this — a restart cannot fix an input that reproducibly breaks the engine. So it
	// is reported at 200, and only the dependency checks can fail the endpoint.
	return Response.json(
		{
			status: healthy ? 'ok' : 'unhealthy',
			checks,
			render: {
				queue: queueDepth(),
				degraded: degraded.map((record) => ({
					namespace: record.namespace,
					consecutiveFailures: record.consecutiveFailures,
					lastError: record.lastError,
					servedStale: record.servedStale,
				})),
				namespaces: renderHealth().length,
			},
		},
		{ status: healthy ? 200 : 503 },
	);
}
