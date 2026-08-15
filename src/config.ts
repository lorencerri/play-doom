import { z } from 'zod';
// keys.ts pulls in only http/errors.ts, which imports nothing — no cycle back here.
import { FILETYPES } from './domain/keys.ts';

// Exported so the parsing rules can be tested against arbitrary environments.
// `config` itself is parsed once from Bun.env at import time and cannot be varied.
export const schema = z.object({
	PORT: z.coerce.number().int().positive().default(6677),
	DATA_DIR: z.string().default('./data'),
	LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

	// Paths baked into the Docker image; overridable for local dev.
	DOOMGENERIC_BIN: z.string().default('./vendor/doomreplay/doomgeneric/doomgeneric'),
	DOOM1_WAD: z.string().default('./vendor/doomreplay/doom1.wad'),
	FFMPEG_BIN: z.string().default('ffmpeg'),

	// Global cap on concurrently running doomgeneric/ffmpeg subprocesses (§1.5 render/queue.ts).
	RENDER_CONCURRENCY: z.coerce.number().int().positive().default(2),
	RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

	// Start rendering the frame when the key is appended rather than when the image
	// is requested, so GitHub's image proxy hits a file that already exists (§1.2).
	// Turn off to put rendering back on the request path.
	EAGER_RENDER: z
		.enum(['true', 'false'])
		.default('true')
		.transform((value) => value === 'true'),

	// Which frame types the eager render actually produces. The profile README only
	// ever fetches `?type=.gif`, but warming both types put two doomgeneric runs and
	// two ffmpeg starts on every click — and because they share the per-namespace
	// mutex, the gif waited behind a png nobody asked for. Measured on the VPS: the
	// gif request following an append went from ~510ms to ~320ms by dropping png here.
	//
	// This only changes what is rendered *ahead* of the request. `/frame/:ns` with no
	// type still serves a png; it just renders on demand, as it did before §1.2.
	EAGER_FRAME_TYPES: z
		.string()
		.default('gif')
		.transform((value) =>
			value
				.split(',')
				.map((type) => type.trim())
				.filter((type) => type.length > 0),
		)
		.pipe(z.array(z.enum(FILETYPES))),

	// Whether to believe the client-address headers the proxy sets. True is correct
	// for this deployment (Cloudflare → nginx → app, app reachable only through it).
	// Set false if the app is ever exposed directly, where those headers would be
	// attacker-supplied and would let anyone inflate the unique-player count.
	TRUST_PROXY: z
		.enum(['true', 'false'])
		.default('true')
		.transform((value) => value === 'true'),

	// Draw level, elapsed time and kill/item/secret progress under the frame counter.
	// Doom's status bar already covers health, ammo and armour, so this adds only what
	// a frame otherwise cannot show. Off puts the overlay back to just `F:<n> I:<keys>`.
	FRAME_STATUS_OVERLAY: z
		.enum(['true', 'false'])
		.default('true')
		.transform((value) => value === 'true'),

	// Downscale width for the gif, or 0 to keep doomgeneric's native 640x400. 320
	// gives Doom's true resolution and roughly a quarter of the pixels, at the cost
	// of halving the overlay text (§1.3) — worth eyeballing before switching on.
	GIF_WIDTH: z.coerce.number().int().min(0).default(0),

	MP4_PRESET: z
		.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'])
		.default('veryfast'),
	MP4_CRF: z.coerce.number().int().min(0).max(51).default(23),
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
