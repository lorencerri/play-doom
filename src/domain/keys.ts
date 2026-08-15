import { badRequest } from '../http/errors.ts';

// The key alphabet is a compatibility surface, not a design choice: every control
// link in the profile README encodes one of these characters, and links already
// posted elsewhere must keep working. Do not add, remove, or remap entries.
//
// Encoding: a keypress is `<char>,` and a bare `,` is one idle frame. So `u,u,`
// is two Up presses and `,,,` is three idle frames.
const KEY_CHARS = 'xelrudaspftynUDLRjk2-7';

const NAMESPACE_RE = /^[a-zA-Z0-9_]+$/;
const KEYS_RE = new RegExp(`^[,${KEY_CHARS}]+$`);

// Splits an input string into individual frame tokens (`u,`, `x,`, or a bare `,`).
const TOKEN_RE = new RegExp(`[${KEY_CHARS}],?|,`, 'g');

// Drops the frame separator after a real key, so `u,` reads as one Up rather than
// Up + Idle when the buffer is rendered for humans.
const TRAILING_SEPARATOR_RE = new RegExp(`(?<=[${KEY_CHARS}]),`, 'g');

// Collapses the result into runs of the same key, for the `[x25]` suffixes.
const RUN_RE = new RegExp(`([,${KEY_CHARS}])\\1*`, 'g');

export const FILETYPES = ['png', 'gif'] as const;
export type Filetype = (typeof FILETYPES)[number];

const KEY_NAMES: Record<string, string> = {
	',': 'Idle',
	x: 'Escape',
	e: 'Enter',
	l: 'Left Arrow',
	r: 'Right Arrow',
	u: 'Up Arrow',
	d: 'Down Arrow',
	a: 'Alt',
	s: 'Shift',
	p: 'Space',
	f: 'Shoot',
	t: 'Toggle Map',
	U: 'Shift + Up Arrow',
	D: 'Shift + Down Arrow',
	L: 'Shift + Left Arrow',
	R: 'Shift + Right Arrow',
	j: 'Strafe Left',
	k: 'Strafe Right',
	y: 'Yes',
	n: 'No',
	'2': 'Item Slot 2',
	'3': 'Item Slot 3',
	'4': 'Item Slot 4',
	'5': 'Item Slot 5',
	'6': 'Item Slot 6',
	'7': 'Item Slot 7',
};

export function validateNamespace(namespace: string): string {
	if (namespace.length === 0) throw badRequest('namespace cannot be empty.');
	if (namespace.length > 32) throw badRequest('namespace cannot be longer than 32 characters.');
	if (!NAMESPACE_RE.test(namespace)) throw badRequest('Invalid characters in namespace.');
	return namespace;
}

export function validateKeys(keys: string): string {
	if (keys.length === 0) throw badRequest('query.keys cannot be empty.');
	if (keys.length > 1024) throw badRequest('query.keys cannot be longer than 1024 characters.');
	if (!KEYS_RE.test(keys)) throw badRequest('Invalid characters in query.keys.');
	return keys;
}

export function validateFiletype(type: string): Filetype {
	if (!(FILETYPES as readonly string[]).includes(type)) throw badRequest('query.type is invalid');
	return type as Filetype;
}

export function tokenize(input: string): string[] {
	return input.match(TOKEN_RE) ?? [];
}

export function convertKeyToName(key: string): string {
	return KEY_NAMES[key] ?? 'Unknown';
}

export function normalizeInput(input: string | string[]): string {
	const joined = Array.isArray(input) ? input.join('') : input;

	const runs = joined.replace(TRAILING_SEPARATOR_RE, '').match(RUN_RE) ?? [];

	return runs
		.map((run) => {
			const key = run.charAt(0);
			return `${convertKeyToName(key)}${run.length > 1 ? ` [x${run.length}]` : ''}`;
		})
		.join(', ');
}
