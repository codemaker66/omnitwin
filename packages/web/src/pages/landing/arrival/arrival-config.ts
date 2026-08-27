/**
 * Google Map Tiles API key for the Arrival hero. Absent in dev until the key
 * lands in packages/web/.env.local; absence must degrade to the static hero
 * photo, never throw (spec §6). Bracket access per useTwinManifest.ts:26.
 */
export function googleTilesApiKey(): string | null {
  const raw = import.meta.env["VITE_GOOGLE_MAPS_TILES_KEY"];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Google Maps brand-attribution logo, passed as `logoUrl` to
 * `GoogleCloudAuthPlugin` (see GoogleTilesStage.tsx). Google's Map Tiles API
 * Policies require two separate attributions — a text/copyright line (which
 * the plugin already emitted) and this logo credit, sized 16-19dp tall with
 * 10dp/5dp clear space (developers.google.com/maps/documentation/tile/
 * policies, "Display Google Maps attribution", fetched 2026-08-27; see
 * docs/operations/arrival-google-tiles.md Finding 2). Without a non-empty
 * `logoUrl`, `GoogleCloudAuthPlugin.getAttributions()` never pushes the logo
 * credit at all (`if (this.logoUrl)` — node_modules/3d-tiles-renderer/src/
 * core/plugins/GoogleCloudAuthPlugin.js:120-125) — that was the shipped bug.
 *
 * Self-hosted, root-relative — same convention as FRESH_ARMS/
 * FRESH_HERITAGE_ART (packages/web/src/pages/fresh/fresh-copy.ts) and
 * packages/web/public/images/brand/. This is deliberate, not merely
 * convenient: Google does not publish a stable, directly hotlinkable image
 * URL for this mark. Its policies page links only a downloadable archive —
 * https://developers.google.com/static/maps/documentation/images/
 * Google_Maps_Attribution_Assets.zip (confirmed live via HEAD request
 * 2026-08-27: `content-type: application/zip`, `content-disposition:
 * attachment`) — meant to be unpacked and self-hosted by the integrator, not
 * fetched from Google's servers at runtime. (The two illustration images
 * embedded on that same policies page — .../static/maps/images/
 * 02_GMP_Logo_Alternates.jpg and .../03_GMP_Logo_Size_Specs.jpg, both
 * confirmed live, both 100-200KB JPEGs — are documentation spec-sheet
 * graphics with multiple variants and dimension callouts printed on them,
 * NOT a usable production mark; do not repurpose either as this value.)
 * Self-hosting also sidesteps any CSP img-src allowlisting for a third-party
 * host and any dependency on Google's asset CDN being reachable at render
 * time (offline dev, flaky network, or a promotional-video capture session).
 *
 * NEEDS_CONTEXT — the file this path points to has not been added to the
 * repo yet. Downloading and unpacking Google's zip, and picking the
 * color/size variant with sufficient contrast against the Arrival hero's
 * imagery, is a human judgment call (and a file download this agent could
 * not authorize itself) — it still needs to happen, with the chosen asset
 * committed at this exact path, before Task 16 (production key rollout).
 * Do not substitute a hand-drawn or third-party-hosted stand-in for
 * Google's own trademarked mark. Tracked in docs/operations/
 * arrival-google-tiles.md's Deployment checklist.
 */
export const GOOGLE_MAPS_ATTRIBUTION_LOGO_URL = "/images/brand/google-maps-attribution-logo.png";

/**
 * Screen-space error target, in pixels, handed to `<TilesRenderer>` (see
 * GoogleTilesStage.tsx) — the hero's one tile-density lever. Tiles below this
 * level of screen-space error are not rendered, so HIGHER means coarser tiles,
 * fewer of them, cheaper to fetch and cheaper to draw; LOWER means finer and
 * more expensive. The plan names it the first lever to reach for if the flight
 * or the exploded hold misses its frame budget (Task 14, Step 2).
 *
 * WARNING — 12 IS BELOW THE INSTALLED LIBRARY DEFAULT, WHICH IS 16, NOT 6.
 * `TilesRendererBase`'s constructor seeds `this.errorTarget = 16.0` with the
 * JSDoc tag `@default 16` (packages/web/node_modules/3d-tiles-renderer/src/
 * core/renderer/tiles/TilesRendererBase.js:546, version 0.5.2 — the version
 * this package pins). So this value does not sit still: it asks for a third
 * MORE tile detail than passing nothing at all would, which means more tile
 * requests (every one of them billable — docs/operations/
 * arrival-google-tiles.md) and more GPU work per frame. The plan's seed of 12
 * reads as if written against the package's older default of 6, where 12 would
 * indeed have been the coarser, cheaper direction its own note describes.
 *
 * It is kept at the planned value rather than silently "corrected" to a number
 * this agent guessed (Blake Clause) — but it is NOT a neutral seed, and the
 * knob exists precisely so the live gate can set it on evidence: Task 14 Step
 * 2's frame-budget pass needs a real Google Maps API key, which does not exist
 * yet, so no measurement stands behind any number here. If the hero is about
 * to ship and that gate still has not run, raise this to 16 to match the
 * library default rather than leaving an unmeasured 12 in place.
 */
export const ARRIVAL_ERROR_TARGET = 12;

/**
 * How long the tiles may go COMPLETELY SILENT before the hero gives up and
 * falls back to the static photograph (GoogleTilesStage.tsx's stall
 * watchdog). Milliseconds.
 *
 * WHAT IT MEASURES, WHICH IS THE WHOLE REASON THE NUMBER IS DEFENSIBLE. This
 * is NOT "the tileset must finish within 30 s". It is a dead-man's switch:
 * the timer is re-armed by every event that PROVES bytes are still moving —
 * a tileset parsed (`load-tileset`), a tile request actually starting
 * (`tile-download-start`), a tile finishing (`load-model`), the load queue
 * going non-empty (`tiles-load-start`). A slow-but-working connection fires
 * those continuously, so it can never trip this; only genuine silence can.
 * A fixed total deadline was the obvious alternative and was rejected for
 * exactly that reason — it cannot tell "hung" from "slow", so any value
 * generous enough to be safe on poor mobile is too long to be a useful
 * watchdog, and any value short enough to be useful steals the flight from
 * the visitors least able to spare it.
 *
 * WHY 30 SECONDS OF SILENCE. The gaps this must sit above are real ones on a
 * bad mobile link: the session-token round trip plus the root tileset fetch
 * (small JSON, but two serial round trips at 300-600 ms RTT), then per-tile
 * glTF downloads. Google's photorealistic tiles run to a few hundred KB each
 * and occasionally past 1 MB; at a Slow-3G-class 400 Kbps a 1 MB tile is
 * ~20 s wall clock, and downloads run concurrently, so a further
 * download-start or load-model almost always lands well inside the window.
 * 30 s clears that with margin while still bounding the failure: the phase
 * machine can no longer sit in "loading" forever.
 *
 * WHAT A FALSE POSITIVE COSTS, so the trade is stated rather than assumed:
 * the hero fades and the static hero photograph carries the page (spec §6) —
 * the same graceful outcome as a missing key. Nothing breaks, nobody sees an
 * error; a visitor on a link so bad that 30 s passes with no tile progress at
 * all loses a decoration they never asked for. What a MISSED stall costs is
 * worse and silent: no flight, no diagnostic, no fallback, forever — the
 * failure Task 12b independently flagged as this hero's most likely real
 * field report.
 */
export const ARRIVAL_TILES_STALL_MS = 30_000;
