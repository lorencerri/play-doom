/**
 * Parses the `DR_SUMMARY` line doomgeneric prints when a replay ends.
 *
 * Every render replays the whole run to reach the current frame, so its final state
 * *is* the namespace's current state — which makes this the cheapest possible source
 * of "what level is github on right now". See DR_PrintSummary in doomgeneric_dr.c.
 *
 * The engine prints plenty of other things to stdout ("Terminating ..", per-1000-frame
 * speed reports, the ffmpeg command line), so this looks for the marker rather than
 * assuming a position, and takes the last match in case a future change emits more
 * than one.
 */

export type RunSummary = {
	/** `level` when the replay ended in play; `menu` on a title screen or intermission. */
	state: 'level' | 'menu';
	episode?: number;
	map?: number;
	kills?: number;
	totalKills?: number;
	items?: number;
	totalItems?: number;
	secrets?: number;
	totalSecrets?: number;
	/** Level time in tics. Doom runs at 35 tics per second. */
	tics?: number;
	health?: number;
	dead?: boolean;
	frames?: number;
};

const MARKER = 'DR_SUMMARY ';

// The C side writes snake-free lowercase keys; this maps them onto the camelCase
// shape the rest of the app uses. Anything not listed is ignored rather than
// rejected, so adding a field to the C does not break an older parser.
const NUMERIC_FIELDS: Record<string, keyof RunSummary> = {
	episode: 'episode',
	map: 'map',
	kills: 'kills',
	totalkills: 'totalKills',
	items: 'items',
	totalitems: 'totalItems',
	secrets: 'secrets',
	totalsecrets: 'totalSecrets',
	tics: 'tics',
	health: 'health',
	frames: 'frames',
};

export function parseRunSummary(stdout: string): RunSummary | undefined {
	const line = stdout
		.split('\n')
		.filter((candidate) => candidate.includes(MARKER))
		.pop();

	if (!line) return undefined;

	const fields = new Map<string, string>();
	for (const pair of line.slice(line.indexOf(MARKER) + MARKER.length).trim().split(/\s+/)) {
		const eq = pair.indexOf('=');
		if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
	}

	const state = fields.get('state');
	if (state !== 'level' && state !== 'menu') return undefined;

	const summary: RunSummary = { state };

	for (const [key, target] of Object.entries(NUMERIC_FIELDS)) {
		const raw = fields.get(key);
		if (raw === undefined) continue;

		const value = Number.parseInt(raw, 10);
		// A malformed field is dropped rather than stored as NaN, which would
		// propagate into the database and out through the API as null.
		if (Number.isFinite(value)) (summary[target] as number) = value;
	}

	const dead = fields.get('dead');
	if (dead !== undefined) summary.dead = dead === '1';

	return summary;
}

/** `E1M1`, or undefined off a level. */
export function levelName(summary: Pick<RunSummary, 'episode' | 'map'>): string | undefined {
	if (summary.episode === undefined || summary.map === undefined) return undefined;
	return `E${summary.episode}M${summary.map}`;
}

/** Level time as `m:ss`. Doom's tic rate is 35hz. */
export function formatTics(tics: number): string {
	const seconds = Math.floor(tics / 35);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
