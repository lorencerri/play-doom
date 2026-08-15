import { z } from 'zod';

const schema = z.object({
	PORT: z.coerce.number().int().positive().default(6677),
	DATA_DIR: z.string().default('./data'),
	LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

	// Paths baked into the Docker image; overridable for local dev.
	DOOMGENERIC_BIN: z.string().default('./doomreplay/doomgeneric/doomgeneric'),
	DOOM1_WAD: z.string().default('./doomreplay/doom1.wad'),
	FFMPEG_BIN: z.string().default('ffmpeg'),

	// Global cap on concurrently running doomgeneric/ffmpeg subprocesses (§1.5 render/queue.ts).
	RENDER_CONCURRENCY: z.coerce.number().int().positive().default(2),
	RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type Config = z.infer<typeof schema>;

function loadConfig(): Config {
	const result = schema.safeParse(Bun.env);
	if (!result.success) {
		console.error('Invalid environment configuration:');
		console.error(result.error.flatten().fieldErrors);
		process.exit(1);
	}
	return result.data;
}

export const config = loadConfig();
