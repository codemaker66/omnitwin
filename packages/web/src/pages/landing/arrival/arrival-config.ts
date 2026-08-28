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
 * THE TILES WATCHDOG, AND WHY ITS FIRST VERSION WOULD HAVE KILLED WORKING
 * FLY-INS ON SLOW MOBILE. Both windows below are in milliseconds and are
 * consumed by GoogleTilesStage.tsx.
 *
 * ═══ The mistake, stated plainly, because the fix is only legible against it
 *
 * The first version re-armed on FOUR events and called all four "proof that
 * bytes moved": `load-tileset`, `load-model`, `tiles-load-start` and
 * `tile-download-start`. The last two are not that. Checked against the
 * installed 0.5.2 source rather than against their names:
 *
 *   `tiles-load-start`     — "Fired when tile downloads BEGIN after a period
 *                            of inactivity" (TilesRendererBase.js:269-271,
 *                            dispatched at :1628 the moment the load queue
 *                            goes non-empty). A queue becoming non-empty is
 *                            scheduling. Zero bytes have crossed the wire.
 *   `tile-download-start`  — "Fired when a tile content download BEGINS"
 *                            (:279-284, dispatched at :1654 immediately after
 *                            `fetchData` is INVOKED). Request issued. Again
 *                            zero bytes; the fetch has not even resolved its
 *                            headers.
 *   `load-tileset`         — "Fired when any tileset JSON FINISHES loading"
 *                            (:256-260). A completion.
 *   `load-model`           — "Fired when a tile's renderable content
 *                            (model/scene) IS CREATED" (:286-291). A
 *                            completion.
 *
 * Only the last two are evidence. And the first two are not merely useless —
 * they are actively misleading, because of the concurrency limit:
 * `DEFAULT_DOWNLOAD_QUEUE.maxJobsPerOrigin = 25` (TilesRendererBase.js:334).
 * Every Google tile comes from one origin, so the queue dequeues up to 25 jobs
 * in a single pass and fires 25 `tile-download-start` events within
 * milliseconds of each other — a BURST at t≈0 — and then NOTHING until the
 * first of those 25 downloads actually completes. The old watchdog therefore
 * measured a quantity that is silent for exactly as long as the real thing is,
 * while its comment claimed it "cannot fire on a slow-but-working connection".
 *
 * ═══ The arithmetic, on the same Slow-3G figure the first version cited
 *
 * Slow 3G, as Lighthouse and Puppeteer define it (`PredefinedNetworkConditions
 * ['Slow 3G']`): 500 Kbps nominal × 0.8 = 400 Kbps ⇒ 50,000 B/s aggregate,
 * 2,000 ms RTT.
 *
 *   fair-share throughput per request = 50,000 B/s ÷ 25 concurrent
 *                                     = 2,000 B/s
 *
 * Google photorealistic tiles are "a few hundred KB each and occasionally past
 * 1 MB" — the first version's own words. So the gap between the burst and the
 * first completion is:
 *
 *   400 kB tile:  400,000 B ÷ 2,000 B/s =   200 s
 *   1 MB tile:  1,048,576 B ÷ 2,000 B/s =   524 s   (8 min 44 s)
 *
 * Against the old 30 s window that is 6.7× too early on the median tile and
 * 17.5× too early on the large one. Concurrency does not help here; it is the
 * whole problem. Twenty-five requests sharing one narrow pipe finish LATER
 * than one request would, so the more the library parallelises, the longer the
 * event trace stays silent — the opposite of the first version's assumption
 * that "downloads run concurrently, so a further download-start or load-model
 * almost always lands well inside the window". On a link that is working
 * perfectly and will deliver the hero, the visitor loses it at 30 s. The
 * people the watchdog existed to protect were precisely the people it robbed.
 *
 * ═══ Why a dead-man's switch is still the right instrument
 *
 * Re-armed on completions ONLY, silence-since-last-completion is strictly
 * safer than a fixed total budget of the same magnitude: a link that is
 * genuinely delivering tiles every ~200 s keeps postponing the former forever,
 * while the latter fires on schedule and takes the hero away from a visitor
 * mid-load. The alternative "just remove it" was weighed too — see the last
 * section — and rejected because the bound is what stops the phase machine
 * sitting in "loading" for the life of the tab with no diagnostic anywhere.
 *
 * ═══ Why TWO windows and not one
 *
 * The worst case is not the same before and after the first completion, so one
 * number would have to be the looser of the two everywhere:
 *
 *   BEFORE any completion, the only things outstanding are the session-token
 *   round trip and the root tileset JSON — one or two small SERIAL requests,
 *   not 25 concurrent multi-megabyte ones. On Slow 3G: DNS+TCP+TLS ≈ 3 RTT =
 *   6 s, session token ≈ 1 RTT = 2 s, root tileset ≈ 1 RTT + a few kB ≈ 2-3 s
 *   ⇒ ~11 s, call it 30 s once retransmits and a cold DNS cache are allowed
 *   for. This is also the window that catches the failures the diagnostic was
 *   actually written for — a captive portal, a proxy or an extension
 *   swallowing tile.googleapis.com, a CSP block — every one of which produces
 *   ZERO completions, forever.
 *
 *   AFTER the first completion the 524 s figure above governs.
 *
 * Hence ARRIVAL_TILES_FIRST_CONTACT_MS (below) and ARRIVAL_TILES_STALL_MS.
 * They are one timer with two window sizes, not two mechanisms.
 *
 * ═══ What each failure costs, so the asymmetry is stated rather than assumed
 *
 * A FALSE POSITIVE costs the product: the hero fades and the photograph
 * carries the page (spec §6). The visitor loses the fly-in — the thing this
 * whole feature exists to give them.
 *
 * A MISSED stall costs only telemetry. During "loading" the R3F canvas is
 * transparent (no scene background is set), so the photograph is already
 * carrying the page and the visitor sees exactly what they would have seen
 * anyway; what is lost is the one console line telling a developer which
 * failure it was.
 *
 * The costs are NOT symmetric, so the windows are sized generously and the
 * evidence bar is set high. That is also why removal was not chosen: at these
 * windows the watchdog cannot plausibly rob anyone, and it still converts
 * "loading forever, silently" into "one diagnostic, then the same photograph".
 *
 * 120_000 is the ~30 s worst case above with 4× margin.
 */
export const ARRIVAL_TILES_FIRST_CONTACT_MS = 120_000;

/**
 * Silence BETWEEN completions, once the tiles have proved they can deliver
 * something. Milliseconds. See ARRIVAL_TILES_FIRST_CONTACT_MS above for the
 * full derivation; the short version is that 25 concurrent downloads sharing a
 * 50,000 B/s link deliver their first 1 MB tile after 524 s, so any window
 * below ~9 minutes fires on a connection that is working.
 *
 * 900_000 is that 524 s worst case with 1.7× margin — headroom for HTTP/2
 * flow-control that shares less evenly than fair-share arithmetic assumes, and
 * for a tile at the top of Google's size range arriving while the link is at
 * the bottom of its. Fifteen minutes is a long time to call a "watchdog", and
 * that is the honest length: the value of the bound here is the diagnostic and
 * the terminated phase machine, not a snappy recovery, because there is no
 * recovery to be snappy about — the photograph was carrying the page the whole
 * time.
 *
 * Rejected on the way here: raising the evidence rate by lowering
 * `downloadQueue.maxJobsPerOrigin` (fewer concurrent downloads ⇒ each finishes
 * sooner ⇒ completions arrive more often ⇒ a tighter window would be safe).
 * It would work, and it is a real option if this window ever becomes a
 * problem, but `DEFAULT_DOWNLOAD_QUEUE` is a module-level singleton shared by
 * every TilesRenderer instance, and changing tile-load concurrency is a
 * performance decision that needs measuring against a live key (the same gate
 * ARRIVAL_ERROR_TARGET above is waiting on). Making it as a side effect of a
 * watchdog fix would be exactly the unmeasured knob that comment warns about.
 */
export const ARRIVAL_TILES_STALL_MS = 900_000;

/**
 * THE BEAT BETWEEN LANDING AND LEAVING, when there is nothing to hand off to.
 * Milliseconds; consumed by ArrivalHero.
 *
 * ═══ The dead end this closes
 *
 * With a Google key configured but the twin bundle unhosted — TODAY'S
 * PRODUCTION SHAPE, since packages/web/public/twin is gitignored and Vercel's
 * SPA rewrite answers the missing manifest with index.html — the fly-in used
 * to end and simply STAY there. HallHandoff self-gates to null (no manifest,
 * no mesh), so no dollhouse ever appeared; "Open the Hall" is gated on the
 * same fact, so no invitation appeared either; "Skip the flight" exists only
 * during flight, and "Close" only while exploded. The result was a canvas of
 * Google photogrammetry parked permanently over `img.fr-hero-photo` with not
 * one control on it — the visitor left looking at a melty approximation of
 * the building instead of the venue photograph the whole page is built
 * around, and no way back to it short of reloading.
 *
 * ═══ What happens instead, and why this shape
 *
 * The flight still runs (it is good, and it works on Google's tiles alone),
 * the camera holds its landed pose for this long, and then the hero dissolves
 * through the ordinary spec §6 fade back to the photograph — fail("no-twin"),
 * the same exit every other arrival failure takes. Nobody has to find a
 * control, which means it works identically for keyboard, AT and pointer
 * visitors, and there is no new button to be buried under .fr-hero-panel (see
 * arrival.css's --arrival-panel-clearance for how that goes).
 *
 * 2_000 is a beat, not a wait: long enough for the landing to read as an
 * arrival that RESOLVED rather than a canvas that glitched out, short enough
 * that nobody sits studying Google's roof. The 300 ms opacity fade in
 * arrival.css runs after it, so the whole tail is ~2.3 s. It is not derived
 * from a measurement — there is nothing here to measure — it is a
 * presentation choice, stated as one.
 *
 * The moment the twin bundle IS hosted this constant stops being reachable:
 * `dollhouseReady` goes true, the reveal happens, and the arrival ends where
 * it was always meant to.
 */
export const ARRIVAL_NO_TWIN_HOLD_MS = 2_000;
