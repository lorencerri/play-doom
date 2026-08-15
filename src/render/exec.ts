import { config } from '../config.ts';
import { logger } from '../logger.ts';

export class SubprocessError extends Error {
	constructor(
		message: string,
		readonly bin: string,
		readonly exitCode: number | null,
		readonly stderr: string,
	) {
		super(message);
		this.name = 'SubprocessError';
	}
}

/**
 * Runs a subprocess and rejects unless it exits 0.
 *
 * The old `execWithCallback` resolved `""` on both `exit` and `close` and never
 * looked at the exit code, so a doomgeneric that segfaulted or an ffmpeg that
 * failed to open its input reported success — the caller then served a stale or
 * nonexistent file (crash cause #4). stderr was discarded, which is why the box
 * had nothing to explain itself with.
 *
 * Also takes argv as an array rather than a shell string: the old version
 * interpolated the namespace and the raw key buffer into a string handed to
 * `exec`, i.e. to `/bin/sh`.
 */
export async function run(bin: string, args: string[], label: string): Promise<void> {
	const start = performance.now();
	let timedOut = false;

	// Spawn itself throws rather than resolving when the binary is missing, which is
	// the likeliest failure on a fresh box — surface it as the same error type as a
	// non-zero exit so callers have one thing to handle.
	let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
	try {
		proc = Bun.spawn([bin, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
	} catch (err) {
		logger.error({ label, bin, err }, 'subprocess failed to spawn');
		throw new SubprocessError(`${label} could not start: ${String(err)}`, bin, null, '');
	}

	// A hung render used to leak a process forever; nothing bounded them.
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill('SIGKILL');
	}, config.RENDER_TIMEOUT_MS);

	let stderr = '';
	try {
		[stderr] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	} finally {
		clearTimeout(timer);
	}

	const ms = Math.round(performance.now() - start);
	const tail = stderr.trim().split('\n').slice(-20).join('\n');

	if (timedOut) {
		logger.error({ label, bin, ms, stderr: tail }, 'subprocess timed out');
		throw new SubprocessError(`${label} timed out after ${config.RENDER_TIMEOUT_MS}ms`, bin, null, tail);
	}

	if (proc.exitCode !== 0) {
		logger.error({ label, bin, exitCode: proc.exitCode, ms, stderr: tail }, 'subprocess failed');
		throw new SubprocessError(`${label} exited with code ${proc.exitCode}`, bin, proc.exitCode, tail);
	}

	logger.debug({ label, bin, ms }, 'subprocess completed');
}
