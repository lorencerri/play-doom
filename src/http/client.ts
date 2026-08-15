import { createHmac, randomBytes } from 'node:crypto';

/**
 * Working out who is on the other end of a request, given the deployment is
 * Cloudflare → nginx → app.
 *
 * `X-Real-IP` is the obvious-looking header and it is the wrong one here: nginx
 * sets it to `$remote_addr`, which behind Cloudflare is the Cloudflare edge, so
 * every visitor would collapse into a handful of edge addresses. Cloudflare puts
 * the true client in `CF-Connecting-IP` and also prepends it to `X-Forwarded-For`,
 * so those two are the only trustworthy sources — in that order.
 */
const CLIENT_HEADERS = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip'] as const;

/**
 * Resolves the client address from proxy headers, falling back to the socket peer.
 *
 * These headers are attacker-controlled in general. That is acceptable here because
 * the only thing they feed is a vanity counter, and in production nothing can reach
 * the app except through the proxy chain — it binds a published port that only nginx
 * talks to. `trustProxy: false` ignores them entirely for direct-exposure setups.
 */
export function resolveClientAddress(
	req: Request,
	socketAddress: string | undefined,
	trustProxy: boolean,
): string | undefined {
	if (trustProxy) {
		for (const header of CLIENT_HEADERS) {
			const raw = req.headers.get(header);
			if (!raw) continue;

			// X-Forwarded-For is a chain, "client, proxy1, proxy2". The client is the
			// first entry; every later one is infrastructure we added ourselves.
			const first = raw.split(',')[0]?.trim();
			if (first) return first;
		}
	}

	return socketAddress || undefined;
}

/**
 * Stable pseudonymous id for a client address.
 *
 * The address itself is never stored. Counting unique players needs only a stable
 * key, and a keyed hash gives that without keeping a log of who visited: the output
 * cannot be reversed to an address without the salt, and cannot be cross-referenced
 * against any other system's data at all. The salt is generated once per install and
 * persisted, because a per-boot salt would make every restart look like a fresh
 * population of players.
 */
export function playerId(address: string, salt: string): string {
	// 128 bits of a keyed hash: collision-free at any plausible number of players,
	// and short enough to keep the table small.
	return createHmac('sha256', salt).update(address).digest('hex').slice(0, 32);
}

export function newSalt(): string {
	return randomBytes(32).toString('hex');
}

/**
 * The resolved address is stashed on the request by the router, because only Bun's
 * server object exposes the socket peer and handlers take (request, params). Kept
 * here rather than in app.ts so routes can read it without importing the router
 * that imports them.
 */
type AddressedRequest = Request & { clientAddress?: string };

export function setClientAddress(req: Request, address: string | undefined): void {
	(req as AddressedRequest).clientAddress = address;
}

export function clientAddressOf(req: Request): string | undefined {
	return (req as AddressedRequest).clientAddress;
}
