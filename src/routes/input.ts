import { appendBatch, clearInput, getInput, getInputString, getStoredBatches, rewindKeys } from '../domain/input.ts';
import { normalizeInput, tokenize, validateKeys, validateNamespace } from '../domain/keys.ts';
import { recordInputVariant, recordNamespaceStats, recordPlayerAction } from '../domain/meta.ts';
import { incrementStats, setFlags } from '../domain/state.ts';
import { clientAddressOf } from '../http/client.ts';
import { boolParam, intParam, stringParam } from '../http/query.ts';
import { png, redirectTo, text } from '../http/serve.ts';
import { logger } from '../logger.ts';
import { archiveRun, warmFrames } from '../render/artifacts.ts';
import { renderTextImage } from '../render/text-image.ts';

const MAX_REWIND = 1024;

export async function getInputRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);

	const input = getInput(namespace);

	if (!boolParam(url, 'image', false)) {
		if (boolParam(url, 'readable', false)) return Response.json(input);
		return text(normalizeInput(input));
	}

	return png(await renderTextImage(normalizeInput(input)), `input_${namespace}.png`);
}

export async function appendRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);
	const keys = validateKeys(stringParam(url, 'keys'));

	appendBatch(namespace, keys);
	incrementStats({ actions: 1, keysPressed: keys.length });
	recordNamespaceStats(namespace, { actions: 1, keysPressed: keys.length });
	recordInputVariant(keys);
	recordPlayerAction(clientAddressOf(req));
	setFlags(namespace, { current_video_outdated: true, combined_outdated: true });

	logger.info({ namespace, keys: keys.length }, 'input appended');

	// Started, not awaited: the redirect should go out now, and the render races
	// GitHub's image proxy rather than blocking it (plan 1.2).
	warmFrames(namespace);

	return redirectTo(stringParam(url, 'callback')) ?? text(`${keys} appended to ${namespace}`);
}

export async function rewindRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);

	// Documented in the README as `?amount=N` keys, which the original never read —
	// it popped one whole batch instead, so rewinding a 25× move undid all 25.
	const amount = intParam(url, 'amount', 1, 1, MAX_REWIND);
	const removed = rewindKeys(namespace, amount);

	incrementStats({ rewinds: 1 });
	recordNamespaceStats(namespace, { rewinds: 1 });
	recordPlayerAction(clientAddressOf(req));
	if (removed > 0) setFlags(namespace, { current_video_outdated: true, combined_outdated: true });

	logger.info({ namespace, requested: amount, removed }, 'input rewound');

	if (removed > 0) warmFrames(namespace);

	return redirectTo(stringParam(url, 'callback')) ?? text(`rewound ${removed} keys from ${namespace}`);
}

export async function resetRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);

	// Capture before clearing: the archive renders this exact buffer while the next
	// run is already free to start.
	const stored = getStoredBatches(namespace);
	const finishedRun = getInputString(namespace);
	const hadPlay = stored.some((batch) => tokenize(batch).length > 0);

	clearInput(namespace);
	// A reset only counts as a completed run if something was actually played —
	// resetting an already-empty buffer is a no-op, not a run.
	recordNamespaceStats(namespace, { runs: hadPlay ? 1 : 0 });
	recordPlayerAction(clientAddressOf(req));
	setFlags(namespace, { current_video_outdated: true, combined_outdated: true });

	// Queued before the archive on purpose. Both are detached, but they share the
	// per-namespace queue, and archiving re-renders an entire run — putting the
	// cheap opening frame behind it would leave the README stale for as long as
	// that takes.
	warmFrames(namespace);

	if (hadPlay) {
		// Deliberately not awaited — archiving re-renders the whole run and the click
		// should return immediately. The original did the same but let failures throw
		// after the response had been sent, which on Node 16 took the process down
		// (crash cause #2). Here the job owns its errors and only ever reaches the log.
		archiveRun(namespace, finishedRun).catch((err) => {
			logger.error({ namespace, err }, 'run archiving failed');
		});
	}

	logger.info({ namespace, archived: hadPlay }, 'input reset');

	return redirectTo(stringParam(url, 'callback')) ?? text(`${namespace} reset`);
}
