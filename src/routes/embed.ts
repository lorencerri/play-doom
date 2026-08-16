import { getStoredBatches } from '../domain/input.ts';
import { validateNamespace } from '../domain/keys.ts';
import { badRequest } from '../http/errors.ts';
import { stringParam } from '../http/query.ts';
import { readmeBlock } from '../render/embed.ts';

/**
 * The generator: pick a namespace, get markup to paste into your own README.
 *
 * The namespace system always supported this — every `/input/<name>` call creates one on
 * first use — but nothing said so, so in practice there was exactly one player. This is
 * the page that turns a personal toy into something other people can put on a profile.
 *
 * The block itself comes from `render/embed.ts`, the same function the CLI uses, so the
 * page cannot drift from what generated Loren's README.
 */

/**
 * The origin to bake into the generated links.
 *
 * Taken from the request rather than from configuration, so the markup a reader copies
 * points at the host that served it — including through the proxy, which is the only
 * address anyone can actually reach. Hard-coding this is how a self-hosted copy ends up
 * generating links to somebody else's server.
 */
function originOf(req: Request): string {
	const url = new URL(req.url);
	const forwardedHost = req.headers.get('x-forwarded-host');
	const forwardedProto = req.headers.get('x-forwarded-proto');

	const host = forwardedHost ?? url.host;
	const protocol = forwardedProto ? `${forwardedProto}:` : url.protocol;

	return `${protocol}//${host}`;
}

/**
 * Validates the return address a click sends the reader back to.
 *
 * Re-serialised through `URL` rather than passed through, which normalises it and
 * percent-encodes anything exotic. Non-http(s) is refused for the same reason
 * `redirectTo` refuses it: the value ends up in a link somebody else will click, and
 * `javascript:` there is an XSS vector aimed at that person, not at us.
 */
function validateCallback(raw: string): string {
	if (raw.length === 0) throw badRequest('callback is required — it is where a click sends the reader back.');
	if (raw.length > 512) throw badRequest('callback is too long.');

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw badRequest('callback must be an absolute URL, e.g. https://github.com/you/you');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw badRequest('callback must be http or https.');
	}

	return url.toString();
}

/** Plain-text markdown for a namespace. The page fetches this; anything can. */
export function embedRoute(req: Request): Response {
	const url = new URL(req.url);
	const namespace = validateNamespace(stringParam(url, 'namespace', 'doom'));
	const callback = validateCallback(stringParam(url, 'callback', ''));

	const block = readmeBlock({ api: originOf(req), namespace, callback });

	return new Response(block, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
	});
}

/**
 * Whether a namespace is already being played.
 *
 * There is no reservation and there is no owner — that is the premise of the whole thing,
 * not an omission. What this can honestly say is whether somebody is already there, so a
 * reader picking `doom` finds out before publishing that they have joined a game rather
 * than started one.
 */
export function namespaceCheckRoute(req: Request): Response {
	const url = new URL(req.url);
	const namespace = validateNamespace(stringParam(url, 'namespace', 'doom'));
	const batches = getStoredBatches(namespace);

	return Response.json(
		{ namespace, inUse: batches.length > 0, batches: batches.length },
		{ headers: { 'Cache-Control': 'no-store' } },
	);
}

const escape = (value: string): string =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The page.
 *
 * Server-rendered shell, one inline script, no dependencies — it has to work from a
 * strict origin with nothing fetched from anywhere else, and it is a form with two fields.
 * The markup itself is always built on the server so there is exactly one implementation
 * of the block.
 */
export function newRoute(req: Request): Response {
	const origin = escape(originOf(req));

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Add Doom to your README</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem;
    background: #1A1B1E; color: #C1C2C5;
    font: 15px/1.6 ui-monospace, "DejaVu Sans Mono", monospace;
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .35rem; color: #fff; letter-spacing: .01em; }
  p.lede { margin: 0 0 2rem; color: #7A7E85; font-size: .9rem; }
  label { display: block; margin: 1.25rem 0 .35rem; font-size: .8rem; color: #7A7E85; text-transform: uppercase; letter-spacing: .06em; }
  input, textarea {
    width: 100%; box-sizing: border-box; padding: .6rem .7rem;
    background: #212226; color: #C1C2C5; border: 1px solid #2E3033; border-radius: 6px;
    font: inherit; font-size: .88rem;
  }
  input:focus, textarea:focus { outline: none; border-color: #6FA86F; }
  textarea { height: 15rem; resize: vertical; white-space: pre; overflow-wrap: normal; overflow-x: auto; }
  .hint { font-size: .78rem; color: #7A7E85; margin: .4rem 0 0; min-height: 1.2rem; }
  .hint.warn { color: #C9A227; }
  .hint.bad { color: #C8442A; }
  .row { display: flex; gap: .6rem; align-items: center; margin: 1.5rem 0 .5rem; flex-wrap: wrap; }
  button {
    background: #6FA86F; color: #10120f; border: 0; border-radius: 6px;
    padding: .55rem 1.1rem; font: inherit; font-weight: 700; cursor: pointer;
  }
  button.ghost { background: #2E3033; color: #C1C2C5; font-weight: 400; }
  button:disabled { opacity: .5; cursor: default; }
  footer { margin-top: 3rem; font-size: .78rem; color: #7A7E85; }
  a { color: #6FA86F; }
</style>
</head>
<body>
<main>
  <h1>Add Doom to your README</h1>
  <p class="lede">One shared game per namespace. Everyone who clicks your README plays the same run &mdash; including you.</p>

  <label for="ns">Namespace</label>
  <!--
    Deliberately empty. Prefilling "doom" meant the explanation below was overwritten by
    an availability check before anyone could read it, and it pointed every visitor at
    the same obvious name — two strangers would have landed in one game without meaning
    to. An empty field shows what a namespace *is*, then answers availability once they
    have chosen.
  -->
  <input id="ns" value="" placeholder="your-username" spellcheck="false" autocapitalize="off" autocomplete="off" />
  <p class="hint" id="nsHint">Each namespace is its own game. Pick something unique &mdash; your username works well.</p>

  <label for="cb">Send clicks back to</label>
  <input id="cb" value="https://github.com/" spellcheck="false" autocapitalize="off" autocomplete="off" />
  <p class="hint" id="cbHint">The page a reader returns to after pressing a control &mdash; usually your profile or repo.</p>

  <div class="row">
    <button id="go">Generate</button>
    <button id="copy" class="ghost" disabled>Copy</button>
    <span class="hint" id="status"></span>
  </div>

  <textarea id="out" readonly placeholder="Your markup appears here."></textarea>

  <footer>
    Paste it into <code>README.md</code>. Nothing is registered and nobody owns a namespace &mdash;
    if someone is already using the name you pick, you join their game.
    Video for namespaces nobody has played in a long while is cleaned up; the game itself is not.
    <br /><br />
    <a href="https://github.com/lorencerri/play-doom">source</a>
  </footer>
</main>
<script>
  var origin = "${origin}";
  var ns = document.getElementById('ns');
  var cb = document.getElementById('cb');
  var out = document.getElementById('out');
  var go = document.getElementById('go');
  var copy = document.getElementById('copy');
  var status = document.getElementById('status');
  var nsHint = document.getElementById('nsHint');

  var VALID = /^[a-zA-Z0-9_-]{1,32}$/;
  var EXPLAIN = 'Each namespace is its own game. Pick something unique — your username works well.';

  function checkName() {
    var value = ns.value.trim();
    if (value === '') {
      // Back to the explanation rather than an error: an empty field is where somebody
      // starts, not something they got wrong.
      nsHint.className = 'hint';
      nsHint.textContent = EXPLAIN;
      return;
    }
    if (!VALID.test(value)) {
      nsHint.className = 'hint bad';
      nsHint.textContent = 'Letters, numbers, hyphens and underscores only, up to 32 characters.';
      return;
    }
    fetch(origin + '/embed/check?namespace=' + encodeURIComponent(value))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.inUse) {
          nsHint.className = 'hint warn';
          nsHint.textContent = '"' + value + '" already has a game running. Pick another name, unless you mean to join it.';
        } else {
          nsHint.className = 'hint';
          nsHint.textContent = '"' + value + '" is free — you would be starting a new game.';
        }
      })
      .catch(function () {
        nsHint.className = 'hint';
        nsHint.textContent = '';
      });
  }

  var timer;
  ns.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(checkName, 300); });

  go.addEventListener('click', function () {
    status.textContent = '';

    // Guarded here as well as on the server: with the field empty the server would fall
    // back to its own default namespace and hand back markup for a game the reader never
    // chose, which is worse than an error.
    if (ns.value.trim() === '') {
      ns.focus();
      status.textContent = 'Pick a namespace first.';
      return;
    }

    var url = origin + '/embed?namespace=' + encodeURIComponent(ns.value.trim()) +
              '&callback=' + encodeURIComponent(cb.value.trim());

    fetch(url).then(function (r) {
      return r.text().then(function (body) {
        if (!r.ok) {
          try { body = JSON.parse(body).error; } catch (e) {}
          throw new Error(body);
        }
        return body;
      });
    }).then(function (markup) {
      out.value = markup;
      copy.disabled = false;
      status.textContent = markup.split('\\n').length + ' lines ready.';
    }).catch(function (err) {
      out.value = '';
      copy.disabled = true;
      status.textContent = err.message;
    });
  });

  copy.addEventListener('click', function () {
    out.select();
    // execCommand rather than the clipboard API: this page is often opened over a
    // context the async API refuses, and a copy button that silently does nothing is
    // worse than a deprecated one that works.
    try { document.execCommand('copy'); status.textContent = 'Copied.'; }
    catch (e) { status.textContent = 'Select the text and copy it.'; }
  });

  checkName();
</script>
</body>
</html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
	});
}
