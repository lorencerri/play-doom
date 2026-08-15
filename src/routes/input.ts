import { config } from '../config.ts';
import { appendBatch, getInput, getInputString, rewindKeys } from '../domain/input.ts';
import { normalizeInput, summarizeInput, tokenize, validateKeys, validateNamespace } from '../domain/keys.ts';
import { pseudonymousId, recordInputVariant, recordNamespaceStats, recordPlayerAction } from '../domain/meta.ts';
import { incrementStats, setFlags } from '../domain/state.ts';
import { clientAddressOf } from '../http/client.ts';
import { conflict, tooManyRequests } from '../http/errors.ts';
import { boolParam, intParam, stringParam } from '../http/query.ts';
import { RateLimiter } from '../http/rate-limit.ts';
import { png, redirectTo, text } from '../http/serve.ts';
import { logger } from '../logger.ts';
import { endRun, warmFrames } from '../render/artifacts.ts';
import { renderTextImage } from '../render/text-image.ts';

const MAX_REWIND = 1024;

// How many key groups the history image shows. A run of a few hundred actions renders
// as a strip thousands of pixels wide otherwise, which GitHub scales down to an
// illegible smear — and the recent end is the part anyone actually reads.
const DEFAULT_HISTORY_GROUPS = 12;

// Keyed on the pseudonymous player id, not the raw address — the same identity the
// unique-player count uses, so no additional information about the client is retained.
// Clients with no resolvable address share one bucket: that is only reachable when the
// proxy headers are absent, and sharing is the conservative choice.
const limiter = new RateLimiter(config.RATE_LIMIT_BURST, config.RATE_LIMIT_PER_MINUTE);

// Buckets accumulate one entry per distinct client, which would be the same unbounded
// growth the limiter exists to prevent. Full buckets are indistinguishable from fresh
// ones, so dropping them is free.
setInterval(() => limiter.sweep(), 5 * 60_000).unref();

function enforceRateLimit(req: Request, route: string): void {
	const address = clientAddressOf(req);
	const key = address ? pseudonymousId(address) : 'anonymous';

	const result = limiter.take(key);
	if (result.allowed) return;

	logger.warn({ route, retryAfter: result.retryAfterSeconds }, 'rate limited');
	throw tooManyRequests(`Too many requests. Try again in ${result.retryAfterSeconds}s.`);
}

/** Enforces the ceiling on how long one run may get. */
function enforceBufferCap(namespace: string, incoming: number): void {
	const current = tokenize(getInputString(namespace)).length;
	if (current + incoming <= config.MAX_BUFFER_TOKENS) return;

	logger.warn({ namespace, current, incoming }, 'buffer cap reached');
	throw conflict(
		`This run has reached its ${config.MAX_BUFFER_TOKENS}-frame limit. Reset the game to start a new one.`,
	);
}

export async function getInputRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);

	const input = getInput(namespace);

	if (!boolParam(url, 'image', false)) {
		if (boolParam(url, 'readable', false)) return Response.json(input);
		// The text form is for reading programmatically, so it stays complete.
		return text(normalizeInput(input));
	}

	// The image is the one embedded in the README, where an unbounded strip is the
	// problem. `?groups=` overrides for anyone who wants the lot.
	const groups = intParam(url, 'groups', DEFAULT_HISTORY_GROUPS, 1, 1000);

	return png(await renderTextImage(summarizeInput(input, groups)), `input_${namespace}.png`);
}

export async function appendRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);
	const keys = validateKeys(stringParam(url, 'keys'));

	enforceRateLimit(req, 'input.append');
	enforceBufferCap(namespace, tokenize(keys).length);

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

	enforceRateLimit(req, 'input.rewind');

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

	enforceRateLimit(req, 'input.reset');

	// The clear/archive half is shared with AUTO_ARCHIVE_ON_DEATH, so a run ends the
	// same way whether a player clicked reset or the engine reported a death.
	const hadPlay = await endRun(namespace);
	recordPlayerAction(clientAddressOf(req));

	logger.info({ namespace, archived: hadPlay }, 'input reset');

	return redirectTo(stringParam(url, 'callback')) ?? text(`${namespace} reset`);
}
