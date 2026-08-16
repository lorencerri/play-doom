/**
 * Credits the pre-rewrite counters to one namespace.
 *
 *   bun run scripts/backfill-namespace-stats.ts github          # preview
 *   bun run scripts/backfill-namespace-stats.ts github --apply  # write
 *
 * ## Why this exists
 *
 * `/stats` shows a global headline of ~24,000 actions above per-namespace bars summing
 * to ~20, which reads as a bug. It is not: the global `stats` row was migrated wholesale
 * from the old quick.db, while `namespace_stats` is new in the rewrite and started at
 * zero on deployment day. Both are written on the same line of the same request
 * (`routes/input.ts`), so they only ever diverged by history.
 *
 * The old app kept a single global counter and never attributed anything to a namespace,
 * so the real per-namespace history does not exist anywhere and cannot be recovered. This
 * script does not reconstruct it — it **assumes** every untracked action belongs to one
 * namespace, which is Loren's stated call for this deployment (the profile README was the
 * only namespace with meaningful traffic before the rewrite). The result is an attribution,
 * not a measurement.
 *
 * ## Why it is safe to run twice
 *
 * The credit is computed as `global − sum(per-namespace)`, not as a stored constant. Once
 * applied, that difference is zero, so a second run is a no-op rather than a double count.
 * A negative difference means the per-namespace tables have overtaken the global ones,
 * which should be impossible; the script refuses rather than subtracting.
 */

import { getMetaStats, recordNamespaceStats } from '../src/domain/meta.ts';
import { getStats } from '../src/domain/state.ts';
import { validateNamespace } from '../src/domain/keys.ts';

const [target, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');

if (!target) {
	console.error('usage: bun run scripts/backfill-namespace-stats.ts <namespace> [--apply]');
	process.exit(1);
}

// The same validation the HTTP routes use, so this cannot create a namespace the app
// would then refuse to serve. It signals by throwing, being written for a request handler.
try {
	validateNamespace(target);
} catch {
	console.error(`invalid namespace: ${target}`);
	process.exit(1);
}

const global = getStats();
const meta = getMetaStats();

const tracked = meta.namespaces.reduce(
	(sum, ns) => ({
		actions: sum.actions + ns.actions,
		keysPressed: sum.keysPressed + ns.keysPressed,
		rewinds: sum.rewinds + ns.rewinds,
	}),
	{ actions: 0, keysPressed: 0, rewinds: 0 },
);

const credit = {
	actions: global.actions - tracked.actions,
	keysPressed: global.keysPressed - tracked.keysPressed,
	rewinds: global.rewinds - tracked.rewinds,
};

const n = (value: number) => value.toLocaleString('en-US').padStart(9);

console.log(`                   actions      keys   rewinds`);
console.log(`  global          ${n(global.actions)} ${n(global.keysPressed)} ${n(global.rewinds)}`);
console.log(`  tracked         ${n(tracked.actions)} ${n(tracked.keysPressed)} ${n(tracked.rewinds)}`);
console.log(`  credit          ${n(credit.actions)} ${n(credit.keysPressed)} ${n(credit.rewinds)}  -> ${target}`);
console.log('');

const negative = Object.entries(credit).filter(([, value]) => value < 0);
if (negative.length > 0) {
	console.error(`refusing to run: per-namespace totals exceed the global ones (${negative.map(([k, v]) => `${k}=${v}`).join(', ')}).`);
	console.error('that should be impossible; investigate before writing.');
	process.exit(1);
}

if (credit.actions === 0 && credit.keysPressed === 0 && credit.rewinds === 0) {
	console.log('Nothing to credit — the two already agree. (Already applied?)');
	process.exit(0);
}

if (!apply) {
	console.log('Dry run. Re-run with --apply to write.');
	process.exit(0);
}

recordNamespaceStats(target, credit);

const after = getMetaStats().namespaces.find((ns) => ns.namespace === target);
console.log(`${target}: ${after?.actions.toLocaleString('en-US')} actions, ${after?.keysPressed.toLocaleString('en-US')} keys, ${after?.rewinds.toLocaleString('en-US')} rewinds`);
