import { createHash } from 'node:crypto';
import { getInput } from '../domain/input.ts';
import { validateFiletype, validateNamespace } from '../domain/keys.ts';
import { getRenderHash, setRenderHash } from '../domain/state.ts';
import { stringParam } from '../http/query.ts';
import { fileExists, serveFile } from '../http/serve.ts';
import { renderFrame } from '../render/doom.ts';
import { paths } from '../render/artifacts.ts';
import { enqueue } from '../render/queue.ts';

// A gif covers the last batch of keys, capped so a 50× idle link doesn't produce a
// 50-frame animation. Carried over exactly — it decides how the README image reads.
const MAX_GIF_FRAMES = 16;

export async function frameRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);

	// The README links `?type=.gif`, with the dot.
	const requested = stringParam(url, 'type', 'png');
	const type = validateFiletype(requested.startsWith('.') ? requested.slice(1) : requested);

	const input = getInput(namespace);
	const hash = createHash('md5').update(input.join('')).digest('hex');

	const artifact = `frame.${type}`;
	const outputPath = paths.frame(namespace, type);

	// The hash gate: unchanged input means the file on disk is still correct, and
	// this becomes a plain static read. The `fileExists` half is new — the original
	// trusted the hash alone and would happily serve a file that had been deleted.
	if (getRenderHash(namespace, artifact) !== hash || !(await fileExists(outputPath))) {
		await enqueue(namespace, `frame:${type}`, async () => {
			if (getRenderHash(namespace, artifact) === hash && (await fileExists(outputPath))) return;

			const lastBatch = input[input.length - 1] ?? '';

			await renderFrame({
				nrecord: type === 'png' ? 1 : Math.min(lastBatch.length, MAX_GIF_FRAMES),
				nthframe: type === 'png' ? 1 : 2,
				outputPath,
				input: input.join(''),
			});

			setRenderHash(namespace, artifact, hash);
		});
	}

	return serveFile(outputPath, `image/${type}`, `frame_${namespace}.${type}`);
}
