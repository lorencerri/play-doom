import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { config } from '../config.ts';
import { run } from './exec.ts';

/**
 * Stream-copy concat of finished runs. `-c copy` keeps this cheap — no re-encode.
 *
 * The list file is per-namespace. The original wrote every concat through one
 * shared `data/files.txt`, so two namespaces archiving at the same moment could
 * read each other's list and splice the wrong runs together.
 */
export async function concat(namespace: string, inputs: string[], outputPath: string): Promise<void> {
	const listPath = `${config.DATA_DIR}/files_${namespace}.txt`;

	// Paths in a concat list resolve relative to the list file, and all of these
	// live alongside it in DATA_DIR.
	const list = inputs.map((input) => `file '${basename(input)}'`).join('\n');
	await writeFile(listPath, `${list}\n`, 'utf8');

	await run(
		config.FFMPEG_BIN,
		['-f', 'concat', '-safe', '0', '-i', listPath, '-y', '-c', 'copy', outputPath],
		`ffmpeg concat → ${outputPath}`,
		undefined,
		config.CONCAT_TIMEOUT_MS,
	);
}
