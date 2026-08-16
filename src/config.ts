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

	// Rendering a *video* is O(the whole run), unlike a frame render which only records
	// the tail — so the 30s frame budget is the wrong bound for it. Measured on the live
	// github run: 2,432 frames encoded at ~79fps, killed at 30.1s having reached frame
	// 2,368, which is what produced the 502s. VIDEO_MAX_FRAMES caps a run at 10,000
	// frames, so ~127s is the worst case and this leaves roughly 2x headroom. Keep it
	// below Bun's idleTimeout (255s) so the render, not the socket, is what times out.
	VIDEO_TIMEOUT_MS: z.coerce.number().int().positive().default(240_000),

	// Concat is stream-copy, so it is bound by disk rather than CPU and scales with
	// the size of the archive, not with how long the run was. Folding the live 623MB
	// `full_github.mp4` measured 11.4s cold on the VPS and grows with every reset, so
	// it needs far more headroom than a render — 30s would eventually kill it midway.
	CONCAT_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),

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

	// Per-client limits on the control links. Every one is a plain GET anyone can click,
	// and each click queues a render. 60/min sustained with a burst of 20 is far above
	// what clicking a README link by hand produces, and far below what it takes to keep
	// the render queue permanently saturated.
	RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
	RATE_LIMIT_BURST: z.coerce.number().int().positive().default(20),

	// Hard cap on renders waiting for a slot. RENDER_CONCURRENCY bounds what runs at
	// once, but the queue behind it was unbounded — sustained clicking grew memory and
	// pushed every other namespace's frame further back.
	RENDER_QUEUE_MAX: z.coerce.number().int().positive().default(64),

	// Upper bound on how long a single run may get. Render cost is ~9.2µs per frame
	// (measured), so this is roughly a second of replay at the ceiling. Real runs sit
	// in the hundreds of frames, so this is ~200x headroom and will never bite normal
	// play — it exists so a buffer cannot be driven to a length that makes every render
	// slow for everyone.
	MAX_BUFFER_TOKENS: z.coerce.number().int().positive().default(100_000),

	// End the run automatically when the player dies, archiving it and starting fresh.
	// Off by default: it changes how the game behaves for everyone clicking the README,
	// which is a decision for whoever owns the profile, not a default worth assuming.
	// Deaths are detected and counted either way.
	AUTO_ARCHIVE_ON_DEATH: z
		.enum(['true', 'false'])
		.default('false')
		.transform((value) => value === 'true'),

	// Keep a short gif of the moments before each death, served at /death/:namespace.
	// On by default, unlike AUTO_ARCHIVE_ON_DEATH: this only records what happened, it
	// does not change how the game behaves for anyone clicking the README.
	DEATH_CAM: z
		.enum(['true', 'false'])
		.default('true')
		.transform((value) => value === 'true'),

	// Recorded frames in that clip. doomgeneric records every other frame (GIF_NTHFRAME),
	// so 32 spans 64 simulated frames — about 1.8s of play at Doom's 35hz tic rate.
	//
	// This number is the only real control over how big the clip gets, and it matters:
	// the image sits on a profile README and is fetched on every view. Measured on the
	// VPS against a barrel explosion, which is the worst case in Doom — a bright,
	// full-screen, fast-changing fireball:
	//
	//   48 frames 1014KB   32 frames 602KB   24 frames 448KB
	//
	// A death without pyrotechnics is far cheaper — the same clip over a mostly static
	// aftermath is 190KB at 48 frames. Two other levers were measured and rejected.
	// Downscaling works (320 wide roughly halves it) but breaks the equal panel widths
	// the README depends on to read as one object, and `GIF_WIDTH` already offers it
	// globally for anyone who wants it. Shrinking the palette barely helps: 256 → 32
	// colours only takes the worst case from 1006KB to 666KB, and 32 colours on an
	// explosion looks it.
	//
	// 32 also keeps a margin over the largest single click the README offers (x25 = 25
	// frames), so the death itself stays inside the window rather than the clip being
	// all aftermath.
	DEATH_CAM_FRAMES: z.coerce.number().int().positive().max(240).default(32),

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

	// Width in pixels of the surround drawn around frame images, or 0 for none. It
	// reads as a screen rather than an image floating in the page, which matters on a
	// README where the frame sits directly against body text. Applies to the gif and
	// png only — the videos are downloads and are left clean.
	FRAME_BORDER: z.coerce.number().int().min(0).max(64).default(12),

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
