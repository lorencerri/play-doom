import { validateNamespace } from '../domain/keys.ts';
import { bestRun, getStatus, recentRuns, type PastRun } from '../domain/status.ts';
import { boolParam, intParam } from '../http/query.ts';
import { png } from '../http/serve.ts';
import { renderTextImage } from '../render/text-image.ts';
import { formatTics, levelName } from '../render/summary.ts';

const MAX_RUNS = 25;

function describeRun(run: PastRun): string {
	const level = levelName(run) ?? '??';
	const kills = run.kills === undefined ? '' : ` ${run.kills}${run.totalKills === undefined ? '' : `/${run.totalKills}`} kills`;
	const time = run.tics === undefined ? '' : ` in ${formatTics(run.tics)}`;
	const fate = run.dead ? ' (died)' : '';

	return `${level}${kills}${time}${fate}`;
}

function statusText(namespace: string, runs: PastRun[], best: PastRun | undefined): string {
	const status = getStatus(namespace);
	const lines = ['', `Namespace: ${namespace}`];

	if (!status) {
		lines.push('', 'No frame has been rendered yet.');
		return lines.join('\n');
	}

	if (status.state !== 'level') {
		// Off a level the counters hold whatever the last level left behind, so the
		// engine reports no numbers at all rather than misleading ones.
		lines.push('', 'Currently in a menu or on the title screen.');
	} else {
		lines.push(
			`Level: ${levelName(status) ?? '??'}`,
			`Time: ${status.tics === undefined ? '?' : formatTics(status.tics)}`,
			`Health: ${status.health ?? '?'}${status.dead ? ' (dead)' : ''}`,
			`Kills: ${status.kills ?? '?'}/${status.totalKills ?? '?'}`,
			`Items: ${status.items ?? '?'}/${status.totalItems ?? '?'}`,
			`Secrets: ${status.secrets ?? '?'}/${status.totalSecrets ?? '?'}`,
		);
	}

	if (best) lines.push('', `Best run: ${describeRun(best)}`);

	if (runs.length > 0) {
		lines.push('', 'Recent runs:');
		for (const run of runs) lines.push(`  ${describeRun(run)}`);
	}

	return lines.join('\n');
}

export async function statusRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const url = new URL(req.url);

	const limit = intParam(url, 'runs', 5, 0, MAX_RUNS);
	const runs = recentRuns(namespace, limit);
	const best = bestRun(namespace);

	// JSON by default here, unlike /stats: this endpoint is for reading, and the
	// README embeds it explicitly with ?image=true when it wants a picture.
	if (!boolParam(url, 'image', false)) {
		return Response.json({ namespace, status: getStatus(namespace) ?? null, best: best ?? null, runs });
	}

	return png(await renderTextImage(statusText(namespace, runs, best)), `status_${namespace}.png`);
}
