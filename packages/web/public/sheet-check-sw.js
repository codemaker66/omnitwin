/* ---------------------------------------------------------------------------
 * Sheet check — the offline answer.
 *
 * Registered by /sheet-check (src/pages/SheetCheckPage.tsx) with the scope
 * "/sheet-check", so it sees nothing else on the site. When a phone that has
 * opened a sheet check before scans another with no signal (a cellar, a back
 * stair), the browser cannot reach the site at all; this worker answers that
 * navigation itself:
 *
 *   "Can't check: no signal. Your copy is v7, printed 17 Oct 06:02."
 *
 * Everything it says comes from the scanned link, which the paper printed
 * about itself. It caches nothing, so it can never show a stale answer, and
 * it inserts only values that match strict patterns (no markup from a link).
 * The wording mirrors packages/types/src/sheet-paper-check.ts
 * (describePaperClaim) and the colours are the house tokens'
 * literal values (src/styles/house-tokens.css), because offline there is no
 * stylesheet to load.
 * ------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[1-9]\d{0,4}$/;
const FINGERPRINT = /^[0-9a-f]{16}$/;
const PRINTED = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-17T06:02" → "17 Oct 06:02", or null. */
function formatPrinted(value) {
  if (value === null || !PRINTED.test(value)) return null;
  return `${String(Number(value.slice(8, 10)))} ${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(11, 16)}`;
}

/** The paper's own claim, in the same words the page uses; null when the link is not a sheet check. */
function describeClaim(params) {
  const printed = formatPrinted(params.get("p"));
  const s = params.get("s");
  const v = params.get("v");
  const h = params.get("h");
  if (s !== null && UUID.test(s) && v !== null && VERSION.test(v) && h !== null && FINGERPRINT.test(h)) {
    return printed === null ? `Your copy is v${v}.` : `Your copy is v${v}, printed ${printed}.`;
  }
  const c = params.get("c");
  if (c !== null && UUID.test(c)) {
    return printed === null ? "Your copy is a draft." : `Your copy is a draft, printed ${printed}.`;
  }
  return null;
}

function offlinePage(url) {
  const claim = describeClaim(url.searchParams);
  const headline = claim === null ? "This link is not a sheet check." : "Can't check: no signal.";
  const lede = claim === null
    ? "Scan the code at the foot of a printed hallkeeper sheet, or ask the duty manager."
    : claim;
  const next = claim === null ? "" : "<p class=\"next\">Try again when you have signal, or ask the duty manager.</p>"
    + "<button type=\"button\" onclick=\"location.reload()\">Try again</button>";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sheet check · Venviewer</title>
<style>
  html, body { margin: 0; }
  body { min-height: 100vh; display: grid; place-items: center; padding: 32px 16px 48px; box-sizing: border-box;
    background: #819087; color: #14302a; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  main { width: min(34rem, 100%); box-sizing: border-box; padding: 28px 24px 22px 28px; background: #f2eddd;
    border-left: 6px solid #8e9992; border-radius: 4px; box-shadow: 0 10px 24px #14302a2e; }
  .overline { margin: 0 0 20px; font-size: .75rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #42584e; }
  h1 { margin: 0 0 10px; font-family: Newsreader, Georgia, "Times New Roman", serif; font-weight: 500;
    font-size: clamp(1.875rem, 7.5vw, 2.5rem); line-height: 1.08; }
  .lede { margin: 0 0 14px; font-size: 1.0625rem; line-height: 1.5; }
  .next { margin: 0; padding-top: 14px; border-top: 1px solid #d9d4c2; font-size: .9375rem; line-height: 1.45; color: #42584e; }
  button { margin-top: 18px; min-height: 44px; padding: 0 20px; border: 0; border-radius: 3px; background: #264337;
    color: #f2eee1; font: 600 1rem/1 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
  button:focus-visible { outline: 2px solid #14302a; outline-offset: 2px; }
  .note { margin: 22px 0 0; font-size: .8125rem; line-height: 1.45; color: #42584e; }
</style>
</head>
<body>
<main aria-labelledby="overline">
  <p id="overline" class="overline">Hallkeeper sheet check</p>
  <div aria-live="polite"><h1>${headline}</h1><p class="lede">${lede}</p>${next}</div>
  <p class="note">This check says only whether a printed copy is current. It shows nothing from the sheet itself.</p>
</main>
<script>addEventListener("online", function () { location.reload(); });</script>
</body>
</html>`;
}

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/sheet-check")) return;
  event.respondWith(fetch(request).catch(() => new Response(offlinePage(url), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  })));
});
