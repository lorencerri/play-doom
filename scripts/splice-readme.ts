/**
 * Replaces only the game block of a README, leaving everything else byte-for-byte.
 *
 *   bun run scripts/gen-readme.ts --namespace github --callback https://github.com/x --stats > block.md
 *   bun run scripts/splice-readme.ts /path/to/README.md block.md
 *
 * Deliberately not "regenerate the whole file". The profile README at
 * github.com/lorencerri/lorencerri has been hand-edited — the `## END_GAME ##` marker and
 * the top header line were both removed by its owner — and regenerating from a saved copy
 * silently reinstated them once. The block is located by its own boundaries and anything
 * outside is copied through untouched; the END_GAME marker is stripped unless the target
 * already had one.
 */
const target = process.argv[2];
const blockFile = process.argv[3];

if (!target || !blockFile) {
	console.error('usage: bun run scripts/splice-readme.ts <README.md> <block.md>');
	process.exit(1);
}

const current = await Bun.file(target).text();
const generated = (await Bun.file(blockFile).text()).trimEnd();

const lines = current.split(/\r?\n/);

// The block starts at its own heading and runs to the first section after it.
const start = lines.findIndex((l) => l.includes('<h3 align="center">Play Doom</h3>') || l.includes('**Play Doom!'));
const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l) && !l.includes('END_GAME'));

if (start < 0 || end < 0) {
	console.error(`could not locate the game block (start=${start}, end=${end})`);
	process.exit(1);
}

const hadMarker = lines.slice(start, end).some((l) => l.includes('END_GAME'));

let block = generated;
if (hadMarker) block += '\n\n**## END_GAME ##**';

const before = lines.slice(0, start).join('\n').trimEnd();
const after = lines.slice(end).join('\n');

await Bun.write(target, `${before}${before ? '\n\n' : ''}${block}\n\n${after}`);

console.error(`replaced lines ${start}-${end - 1}; kept ${start} above and ${lines.length - end} below; marker ${hadMarker ? 'kept' : 'absent'}`);
