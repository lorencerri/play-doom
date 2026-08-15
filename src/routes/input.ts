import { appendBatch, clearInput, getInput, getStoredBatches, rewindKeys } from '../domain/input.ts';
import { normalizeInput, tokenize, validateKeys, validateNamespace } from '../domain/keys.ts';
import { incrementStats, setFlags } from '../domain/state.ts';
import { boolParam, intParam, stringParam } from '../http/query.ts';
import { png, redirectTo, text } from '../http/serve.ts';
import { logger } from '../logger.ts';
import { archiveRun } from '../render/artifacts.ts';
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
	setFlags(namespace, { current_video_outdated: true, combined_outdated: true });

	logger.info({ namespace, keys: keys.length }, 'input appended');

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
	if (removed > 0) setFlags(namespace, { current_video_outdated: true, combined_outdated: true });

	logger.info({ namespace, requested: amount, removed }, 'input rewound');

	return redirectTo(stringParam(url, 'callback')) ?? text(`rewound ${removed} keys from ${namespace}`);
}

export async function resetRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);

	// Capture before clearing: the archive renders this exact buffer while the next
	// run is already free to start.
	const stored = getStoredBatches(namespace);
	const finishedRun = getInput(namespace).join('');
	const hadPlay = stored.some((batch) => tokenize(batch).length > 0);

	clearInput(namespace);
	setFlags(namespace, { current_video_outdated: true, combined_outdated: true });

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
