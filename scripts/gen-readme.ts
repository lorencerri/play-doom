/**
 * Prints the README game block to stdout.
 *
 *   bun run scripts/gen-readme.ts --namespace play-doom --callback https://github.com/...
 *
 * The block itself lives in `src/render/embed.ts`, shared with the generator page at
 * `/new`, so the CLI and the web form cannot emit different markup. Splicing the output
 * into a README is the caller's job (`scripts/splice-readme.ts`) — the profile README has
 * been hand-edited, and regenerating it wholesale would undo that.
 */
import { readmeBlock } from '../src/render/embed.ts';

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

console.log(
	readmeBlock({
		api: arg('api', 'https://doom-api-v2.plexidev.org'),
		namespace: arg('namespace', 'play-doom'),
		callback: arg('callback', 'https://github.com/lorencerri/play-doom'),
		stats: process.argv.includes('--stats'),
	}),
);
