import { listAchievements } from '../domain/achievements.ts';
import { validateNamespace } from '../domain/keys.ts';
import { boolParam } from '../http/query.ts';
import { png } from '../http/serve.ts';
import { renderAchievementsCard } from '../render/achievements-card.ts';

/**
 * The badge strip for a namespace, as a PNG by default because that is what a README can
 * embed. `?image=false` returns the same thing as JSON.
 *
 * Read-only, like `/death` and unlike `/frame`: badges are awarded by the render that
 * produced the summary, never by somebody looking at them. A page view must not be able
 * to start work proportional to the run.
 */
export async function achievementsRoute(req: Request, params: Record<string, string>): Promise<Response> {
	const namespace = validateNamespace(params.namespace ?? '');
	const badges = listAchievements(namespace);

	if (!boolParam(new URL(req.url), 'image', true)) {
		return Response.json({
			namespace,
			earned: badges.filter((badge) => badge.earnedAt !== undefined).length,
			total: badges.length,
			achievements: badges.map(({ id, name, hint, earnedAt }) => ({ id, name, hint, earnedAt: earnedAt ?? null })),
		});
	}

	return png(await renderAchievementsCard(badges), `achievements_${namespace}.png`);
}
