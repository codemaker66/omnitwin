# Google Photorealistic 3D Tiles — licensing, pricing, and ops runbook

Date: 2026-08-27
Status: STOP-GATE research complete — code-level gap FIXED 2026-08-27 (Task 15b); **PARTIALLY BLOCKED** — two narrower, well-scoped items remain, neither a code defect (see below)
Owner: Venviewer engineering / operations
Scope: the Arrival homepage hero (`packages/web/src/pages/landing/arrival/`) and the Task 17 marketing-video capture that depends on it.
Research method: primary sources only (Google's own developer docs, policy pages, and pricing pages), fetched 2026-08-27. Every quote below is short and attributed; where the terms were genuinely ambiguous for our case, that is stated rather than resolved in our favor.

## STOP-GATE — read this first

**Update, 2026-08-27 (Task 15b): the code-level gap described below is FIXED and tested. Two narrower items remain before the page is actually visually compliant — neither is a code defect. See "Remaining before ship" at the end of this section before treating this as closed.**

Google's Map Tiles API Policies require two separate things: a **data attribution** (per-tile copyright text) and a **brand attribution** (the actual Google Maps logo image, sized 16–19dp tall). Our renderer previously only emitted the first one. Verified directly in the installed library source, not inferred:

- `packages/web/src/pages/landing/arrival/GoogleTilesStage.tsx` constructed the plugin as `new GoogleCloudAuthPlugin({ apiToken })` — no `logoUrl` was passed.
- `GoogleCloudAuthPlugin`'s constructor (`node_modules/.../3d-tiles-renderer/src/core/plugins/GoogleCloudAuthPlugin.js:25`) defaults `logoUrl = null`, and `getAttributions()` (same file, lines 120–125) only pushes the logo credit `if ( this.logoUrl )`.
- Since `logoUrl` was never supplied, that branch never ran, in any phase. `TilesAttributionOverlay` (the component we render) is a generic surface that draws whatever `tiles.getAttributions()` returns — it renders faithfully, but there was nothing logo-shaped to render.

Net effect, as shipped before this fix: the page showed the small text credit line (bottom-left, per-tile copyright strings) but **never showed the Google Maps logo**, in flight, arrived, or exploded phase.

This was always a **code-level gap, not a legal prohibition on the feature** — commercial use and promotional video capture are both permitted (Findings 1 and 3).

**Fixed, 2026-08-27:** `GoogleTilesStage.tsx`'s `authArgs` — the same `useMemo`'d, `[apiToken]`-keyed tuple the Task 4 review already hardened against per-render reconstruction (see that file's header comment) — now passes `logoUrl: GOOGLE_MAPS_ATTRIBUTION_LOGO_URL`, a new constant exported from `arrival-config.ts`. `logoUrl` is therefore non-empty, so `getAttributions()`'s `if ( this.logoUrl )` branch now runs and pushes a `type: 'image'` attribution, which `TilesAttributionOverlay` renders as an `<img>` exactly like any other image-type attribution (`node_modules/.../3d-tiles-renderer/src/r3f/components/TilesAttributionOverlay.jsx:100-104`). Covered by a new failing-first test in `GoogleTilesStage.test.tsx` ("passes a non-empty, same-origin logoUrl to the Google auth plugin"); the pre-existing args-identity/memoization regression test (guarding against the Task 4 double-construction bug) still passes unchanged.

**Remaining before ship — stated plainly, not softened:**

1. **The literal asset file does not exist in this repo yet.** `GOOGLE_MAPS_ATTRIBUTION_LOGO_URL` points at `/images/brand/google-maps-attribution-logo.png` — a path, not yet a committed file. Google does not publish a stable, directly-hotlinkable image URL for this mark: its policies page links only a downloadable archive, `https://developers.google.com/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip` (re-confirmed live 2026-08-27 via HEAD request: `content-type: application/zip`, `content-disposition: attachment`, ~91KB — a real file, but not an image). The two images actually embedded inline on that same page — `.../static/maps/images/02_GMP_Logo_Alternates.jpg` (~186KB) and `.../03_GMP_Logo_Size_Specs.jpg` (~122KB), both confirmed live — are documentation spec-sheet graphics with multiple logo variants and dimension callouts printed on them, not a usable production mark; do not mistake either for a fix. Someone needs to download the zip, choose the color/size variant with sufficient contrast against the Arrival hero's imagery (16–19dp tall per policy), and commit it at that exact path — a design judgment call and a file download this session could not make or authorize on its own. Until that file exists, the path 404s — a broken-image icon, not Google's logo, and arguably its own compliance failure (see Finding 2's "Residual gap" for full detail).
2. **Whether the live tileset's data attribution is actually non-empty is still unverified** — unchanged by this update, still blocked on `VITE_GOOGLE_MAPS_TILES_KEY` landing (Tasks 6/8/11). **Nearest realistic trigger, named explicitly:** the first person to actually see the consequence of item 1 is not Blake at a Task 16/17 launch review — it is whoever sets `VITE_GOOGLE_MAPS_TILES_KEY` in ANY environment (local `packages/web/.env.local`, a preview deployment, anywhere) to unblock Tasks 6/8/11's live visual checks, if they do it before the asset in item 1 is committed. `TilesAttributionOverlay.jsx:100-104` renders `<img src={ att.value } />` for the logo attribution with no `onError`, no `alt`, and no conditional — so the moment a key is live and tiles are visible, a browser broken-image icon WILL render bottom-left, in every phase. **This is expected and already known — it is not a new bug to chase down, it is exactly item 1 above.** The asset should land at `packages/web/public/images/brand/google-maps-attribution-logo.png` before, or together with, whichever key goes live first anywhere, including local dev — not only before the formal Task 16 production rollout.

**Do not deploy the production key (Task 16) or record the marketing video (Task 17) until item 1 has a real committed asset AND item 2 has been visually confirmed, or Blake explicitly accepts the residual risk.**

Secondary, non-blocking items Blake should still see before Task 17:
- Any promotional video containing this Content is capped at **30 seconds**, must exclude Street View, and must carry a burned-in "for promotional purposes only" label (Finding 3).
- Photorealistic 3D Tiles is billed, real money, from session 1,001 in any calendar month (Finding 4) — small, but not zero, and worth a budget alert.

## What the feature does, and the kill-switch

The Arrival homepage hero (`packages/web/src/pages/landing/arrival/`) renders live **Google Photorealistic 3D Tiles** inside the site's own React Three Fiber canvas, using `3d-tiles-renderer@0.5.2` (NASA-AMMOS) — specifically its `GoogleCloudAuthPlugin` (session-token auth + per-tile attribution collection) and `TilesAttributionOverlay` (rendered unconditionally, in every phase; no prop hides it — see `GoogleTilesStage.tsx:116-121`). The camera flies a scripted rail from high over Glasgow down to Trades Hall (85 Glassford Street); the site's own captured mesh then crossfades in over Google's tile geometry, and the building explodes into labeled storeys linking to `/tour` and `/plan`.

**Kill-switch:** `googleTilesApiKey()` (`arrival-config.ts`) reads `import.meta.env["VITE_GOOGLE_MAPS_TILES_KEY"]`. If it is absent or blank, `ArrivalHero` calls `useArrivalStore.getState().fail("no-key")`, which sets `phase: "fallback"` (`arrival-store.ts:47-49`), and `ArrivalHero` renders `null` in that phase (`ArrivalHero.tsx:228-230`) — the static hero photo underneath simply carries the page, with no other code change. **Caveat:** `VITE_…` is a Vite build-time env var (`import.meta.env`, baked into the bundle at build time, per `vite-env.d.ts`), not read at runtime — removing it from Vercel's environment only takes effect on the **next deployment**, it does not flip an already-running production build live.

**Stall watchdog (added by the robustness wave; redesigned in review round 2):** every tiles failure the library can *name* arrives as a `load-error` event and is already handled. A request that simply never answers is the exception — no `tiles-load-end` (nothing finished), no `load-error` (nothing failed) — and before this the phase machine sat in `loading` forever: no flight, no fallback, no diagnostic. `GoogleTilesStage`'s wiring effect runs a **dead-man's switch** that measures silence and takes the same `fail("tiles")` fallback as everything else, writing one plain-English `console.error` on the way — the static hero photo carries the page.

It is re-armed **only by completions** — `load-tileset` ("any tileset JSON finishes loading") and `load-model` ("a tile's renderable content is created"). It is deliberately **not** re-armed by `tiles-load-start` or `tile-download-start`, which fire when a request is *scheduled* or *issued*, before a single byte has come back. The first version of this watchdog treated all four as evidence and would have killed working fly-ins on slow mobile: the library runs **25 downloads per origin** (`DEFAULT_DOWNLOAD_QUEUE.maxJobsPerOrigin = 25`), so those 25 `tile-download-start` events arrive in one burst and then nothing until the first download *completes* — at Slow-3G fair share (50,000 B/s ÷ 25 = 2,000 B/s per request) a 1 MB tile takes **524 s**, seventeen times the old 30 s window. Full arithmetic in `arrival-config.ts`.

Two windows, one timer, both in `arrival-config.ts`:

| window | constant | value | governs |
| --- | --- | --- | --- |
| before any completion | `ARRIVAL_TILES_FIRST_CONTACT_MS` | 120 s | session token + root tileset — small, serial, ~11 s on Slow 3G, so 4×+ margin |
| between completions | `ARRIVAL_TILES_STALL_MS` | 900 s | up to 25 concurrent tile downloads — 524 s worst case, so 1.7× margin |

It is disarmed permanently once the tiles report ready (a slow patch mid-flight never takes the flight away), and no timer outlives the failure or the unmount. The windows are long on purpose: a false positive costs a real visitor the fly-in, while a missed stall costs only the diagnostic — during `loading` the canvas is transparent and the photograph is already carrying the page — so the asymmetry is resolved in the visitor's favour.

Operationally: if you see that line, the request is *pending*, not rejected. The message distinguishes the two cases — "never answered" (nothing at all arrived: check the Network panel for an outstanding `tile.googleapis.com` request; hung connection, captive portal or proxy, extension or CSP block) versus "delivered some content and then went silent" (the route demonstrably works, so look for a link too slow to finish a tile). A wrong, revoked or over-quota key does **not** look like either; it answers immediately and produces the key-specific diagnostic instead.

## Findings

### 1. Commercial use on a marketing homepage

**Permitted.** Two Google documents matter here, and they route to different products:

- Google's own **Geo Guidelines** page — the consumer-facing rules for screenshotting/embedding Google Earth/Maps without an API relationship — explicitly redirects our exact case away from itself: *"For commercial uses where our mapping products are used for revenue-generating purposes, such as integrating Google Maps or Street View into a mobile or web app, use Google Maps Platform instead"* (about.google/brand-resource-center/products-and-services/geo-guidelines/, fetched 2026-08-27). A venue-booking product's web app integrating Google's tiles for revenue-generating purposes is precisely this case — we are already on the correct track (a billed Map Tiles API key), not the consumer-embed track.
- That same Geo Guidelines page is also where the well-known **"real estate promotional video"** restriction lives — but it is scoped by name to *"Google Earth or Earth Studio content (or Google Maps satellite view imagery)"* used outside an API relationship (e.g., screen-capturing Google Earth for a company video), not to the Map Tiles API / Photorealistic 3D Tiles product. It is not part of the Map Tiles API Policies (developers.google.com/maps/documentation/tile/policies, fetched 2026-08-27), which is the document that actually governs our licensed use, and that document has no business-type or industry carve-out at all — its restrictions are use-pattern-based (attribution, caching, non-visualization uses; see below), not sector-based.

**Judgment call, not a guess:** the routing statement above is Google's own text, not our inference of convenience — but this is exactly the kind of boundary Google support could speak to with more authority than a docs page. If Blake wants zero ambiguity before a high-stakes launch, this is the one worth a support ticket. Otherwise: treat commercial use as clear.

### 2. Attribution

**Two required components** (developers.google.com/maps/documentation/tile/policies, "Display Google Maps attribution", fetched 2026-08-27):

- **Data attribution** — *"aggregate, sort, and display in a line, all attributions for displayed tiles; usually along the bottom."* Sourced from each tile's `asset.copyright` field.
- **Brand attribution** — the Google Maps logo itself, with hard sizing rules: *"Minimum logo height: 16dp… Maximum logo height: 19dp"*, *"10dp on left, right and top, 5dp on the bottom"* clear space, sufficient contrast, and an accessibility label reading "Google Maps". Google publishes a ready-made asset kit for this: `/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip` (linked from the same page). The policy is explicit that third-party (non-Cesium) renderers are not exempt: *"you must not overlap or obscure the Google logo with any other logo, such as the renderer's logo."*
- Google's own guide for building a **custom renderer integration** (developers.google.com/maps/documentation/tile/use-renderer, fetched 2026-08-27) walks through extracting the `copyright` field for data attribution, but does not itself hand you a logo URL — the logo requirement is real but its wiring is left to the integrator, which is exactly where our gap happened.

**Audit of the shipped page, as of 2026-08-26: did NOT comply.** See the STOP-GATE section above for the source-verified reason (`logoUrl` never passed to `GoogleCloudAuthPlugin`). Two supporting facts, both still accurate as history:

- `TilesAttributionOverlay.jsx` (`node_modules/.../3d-tiles-renderer/src/r3f/components/TilesAttributionOverlay.jsx:88-112`) is a faithful-but-generic renderer: it draws a `<div>` for each `type: 'string'` attribution and an `<img>` for each `type: 'image'` one, in a bottom-left overlay at 10px/75%-opacity. It is correctly wired and correctly unconditional (per the file header comment in `GoogleTilesStage.tsx`) — the gap was upstream of it, in what got fed in.
- Whether the *data* half is actually non-empty in production (i.e., whether Google's live Trades Hall tileset returns a populated `asset.copyright` string) is **still unverified today** — the plan ledger notes the live visual gate is blocked on `VITE_GOOGLE_MAPS_TILES_KEY` landing in `packages/web/.env.local` (Task 6/8/11 are all blocked on this), so nobody has yet seen the overlay render against real tiles. Confirm both halves — logo present, copyright line non-empty — in the same visual pass once the key exists. **Before that key lands anywhere, see the STOP-GATE's "Remaining before ship" item 2: setting it before the logo asset is committed will show a broken-image icon, not a missing logo — expected, not a new bug.**

**Fixed in code, 2026-08-27 (Task 15b):** `GoogleTilesStage.tsx` now passes `logoUrl: GOOGLE_MAPS_ATTRIBUTION_LOGO_URL` inside the existing `useMemo`'d `authArgs` tuple, still keyed on `[apiToken]` alone (the constant is module-scope, imported from `arrival-config.ts`, so it can never be a reason for that memo to recompute — see that file's header comment for why adding it to the dep array would misrepresent what actually varies). This was additive to the existing, correctly-built plumbing, exactly as anticipated — not a rewrite. Regression-tested: `GoogleTilesStage.test.tsx` now asserts the plugin receives this exact, non-empty, same-origin `logoUrl`, and the pre-existing args-identity test (guarding the Task 4 double-construction/billable-session bug) still passes.

**Residual gap — the asset file itself, NOT yet resolved:** `GOOGLE_MAPS_ATTRIBUTION_LOGO_URL` (`arrival-config.ts`) is the root-relative path `/images/brand/google-maps-attribution-logo.png` — self-hosted, matching the repo's existing convention for other brand marks (`FRESH_ARMS` / `FRESH_HERITAGE_ART` in `packages/web/src/pages/fresh/fresh-copy.ts`, backed by `packages/web/public/images/brand/`). No file exists at that path yet. This is deliberate self-hosting, not an oversight: Google does not publish a stable, directly-hotlinkable single-image URL for this mark. Re-verified 2026-08-27 — its policies page links only a downloadable archive, `https://developers.google.com/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip` (confirmed live via HEAD request: `content-type: application/zip`, `content-disposition: attachment`, ~91KB). The two images actually embedded inline on that page — `.../static/maps/images/02_GMP_Logo_Alternates.jpg` (~186KB, confirmed live) and `.../03_GMP_Logo_Size_Specs.jpg` (~122KB, confirmed live) — are documentation spec-sheet graphics carrying multiple color variants and dimension callouts, not a usable production mark; neither should ever be substituted in as this value. Someone needs to download the zip, choose the variant sized 16–19dp tall with sufficient contrast against the Arrival hero's imagery, and commit it at that exact path — a design judgment call, and a file download, that this session could not make or authorize on its own (downloading files requires the user's explicit go-ahead). Until that file is committed, the path 404s at runtime — a broken-image icon, not Google's logo. **This applies the moment any key exists anywhere, not only in production** — see the STOP-GATE's "Remaining before ship" item 2 for who hits this first and why it's expected.

**Follow-up, not attempted here — the accessibility label:** Google's own policy quote above requires *"an accessibility label reading 'Google Maps'"* on the logo credit. The installed library has no field to carry one on this path: `GoogleCloudAuthPlugin.js`'s image-type attribution object is constructed as exactly `{ value: '', type: 'image', collapsible: false }` (its `_logoAttribution`, set in the constructor) — no `alt`/label field exists in that contract — and `TilesAttributionOverlay.jsx:100-104` renders it as `<img src={ att.value } />` with no `alt` attribute at all. There is no hook in the installed 0.5.2 source to thread an accessible name through this path today. Fixing this would mean either patching/wrapping the rendered `<img>` ourselves (e.g. a `generateAttributions` override) or a change upstream in the library — deliberately not attempted in Task 15b, which was scoped to the `logoUrl` wiring only. Tracked as an open accessibility gap; address it at the same time the real asset lands (see Deployment checklist).

### 3. Video capture (gates Task 17)

**Permitted, tightly conditioned.** Full clause, Map Tiles API Policies, "Video creation featuring Map Tiles API" / "Promotional Videos" (developers.google.com/maps/documentation/tile/policies, fetched 2026-08-27):

- Must not include Street View imagery.
- Must be **no more than 30 seconds** in length.
- Must be about the capabilities of the application.
- Must be clearly marked **"for promotional purposes only"** and comply with the attribution display guidelines (Finding 2 — meaning a video recorded before the logo fix inherits the same non-compliance).
- May not be resold separately, or as part of the software/application/user experience.
- Google may request takedown, and *"You are responsible to comply with all requests to takedown the Promotional Video."*

**Unclear — needs confirmation from Google or Blake's own risk call:** the clause says "the promotional video must be no more than 30 seconds" without explicitly distinguishing "the whole deliverable" from "the segment that contains this Content." If Task 17's video is meant to be longer than 30 seconds overall (e.g., a 60–90 second brand piece), the conservative reading — recommended here — is that any single video asset containing footage of the Google-tiles-powered hero must itself be ≤30 seconds, or the tiles/mesh-crossfade segment must be cut into its own separate ≤30-second asset. Do not assume the more permissive "just the segment counts" reading without checking; this is exactly the kind of ambiguity the brief asked to flag rather than resolve favorably.

Action items for Task 17: hard 30-second cap on any cut containing the tiles hero; burn in the "for promotional purposes only" label; ship it only after Finding 2's logo fix has landed IN CODE **and** the real asset file is committed **and** a live visual check has confirmed the logo actually renders (the code fix alone is not enough — recording against a key with no asset committed would capture a broken-image icon, not compliant attribution; see Finding 2's "Residual gap" and the STOP-GATE); do not license or sell the video separately from the product.

### 4. Pricing

**SKU:** "Map Tiles API: Photorealistic 3D Tiles" (Enterprise tier), SKU `C6E1-98B2-DBD0` (developers.google.com/maps/billing-and-pricing/pricing, fetched 2026-08-27). Launch stage: **General Availability since October 2023** (mapsplatform.google.com blog, "…now in GA", fetched 2026-08-27) — this is fully billed production infrastructure, not a free preview.

**Billable unit** (developers.google.com/maps/documentation/tile/usage-and-billing, fetched 2026-08-27): *"Only root tileset queries are billable"* for Photorealistic 3D Tiles. Session token requests, viewport-information requests, and the renderer's own follow-on tile requests are free. *"Timed session tokens allow for up to three hours of renderer tile requests from a single root tileset request."* Daily quota: 10,000 root tileset queries per project per day (raisable on request) — worth watching if the marketing video drives a traffic spike; past it, `GoogleTilesStage` fails the same way a bad key would (`fail("tiles")` → static-photo fallback), not an outage, but a silent loss of the hero on your biggest traffic day.

**Rate card** (per 1,000 root tileset requests, cumulative monthly volume):

| Monthly volume | Price / 1,000 |
|---|---|
| Free tier | 1,000 events/month at $0 |
| Up to 100,000 | $6.00 |
| 100,001 – 500,000 | $5.10 |
| 500,001 – 1,000,000 | $4.20 |
| 1,000,001 – 5,000,000 | $3.30 |
| 5,000,000+ | $2.40 |

**Estimated cost per 1,000 homepage sessions — assumptions shown:**

- One "session" = one page load where the hero mounts, authenticates, and requests the root tileset. Verified from code: `GoogleCloudAuthPlugin` is constructed once per mount with stable args (`authArgs` is `useMemo`'d on `[apiToken]`; `REORIENTATION_ARGS` is module-scope — see `GoogleTilesStage.tsx:52-61` header comment, which documents this was a real bug caught and fixed during Task 4 review, since unstable args identity would reconstruct the plugin, and a fresh Google session, on every render). `GoogleTilesStage` stays mounted through loading → flight → arrived → exploded (it only unmounts into `fallback`), so ordinary in-page interaction (skip, explode, reassemble) does **not** generate extra root-tileset requests.
- No cross-reload session persistence: `GoogleCloudAuth.js` (the plugin's auth helper) has no `localStorage`/`sessionStorage` usage (grepped the installed package — none found), so a page reload is a new mount and a new billable request. That means the estimate is sensitive to how many of your "1,000 sessions" are reloads/revisits versus single page loads.
- **Central estimate: 1 root-tileset request per session.** Range: **0.8–2.0x** to cover (a) visitors for whom the hero never mounts at all — no key configured in that environment, WebGL unsupported, a context-loss before first tile load — which pulls the ratio below 1, against (b) reload-heavy or revisit-heavy traffic (someone re-watching the flight, QA poking at it, a bounce-and-return counted as one analytics "session"), which pushes it above 1.
- **Cost, at the $6.00/1,000 entry tier (covers up to ~100,000 cumulative monthly sessions at the 1x assumption):**
  - First 1,000 sessions of any calendar month, site-wide: **$0** (inside the free tier).
  - Each subsequent batch of 1,000 sessions: **≈$6.00 central estimate, range ≈$4.80–$12.00** across the 0.8–2.0x assumption.
  - At sustained high volume (>1,000,000 monthly sessions), the marginal rate falls to $3.30–$2.40/1,000, so cost per incremental 1,000 sessions drops proportionally — not the headline number for a launch, but relevant if this becomes durably popular.

This is a small number in absolute terms, but it is **not zero**, and it recurs monthly and scales with traffic — put a GCP budget alert on the project before Task 16, not after.

### 5. Key restriction guidance

Google's own guidance (developers.google.com/maps/api-key-best-practices, developers.google.com/maps/api-security-best-practices, developers.google.com/maps/documentation/tile/get-api-key — all fetched 2026-08-27):

- For a **browser-exposed key** (this is one — the tile requests originate client-side, from `GoogleCloudAuthPlugin` running inside the user's browser), the applicable restriction is **"Websites (HTTP referrers)"**: *"Specify one or more referrer websites… You can use wildcard characters to authorize all subdomains."* IP-address restriction is Google's guidance for **server-side** keys and does not fit a purely client-side integration like this one.
- Separately, apply an **API restriction**: *"Restrict your API key to only the APIs you are using it for"* — scope this key to the Map Tiles API alone, nothing else.
- **Caveat, stated plainly, not buried:** Google's own docs warn that *"Web service API keys are not expected to be publicly exposed to unauthorized users"* in the first place, and that browsers *"strip the path from cross-origin requests"* for referrer purposes — meaning a referrer restriction narrows where the key can be *used from*, it does not hide the key. Anyone can read it out of the page's network requests or bundled JS. Google's stronger mitigations for this (native SDKs, a secure server-side proxy) don't fit a client-side WebGL tile renderer, so referrer + API restriction is the practical ceiling here — not a secret, a leash.

## Production key-restriction checklist (Blake / Task 16 to execute)

- [ ] Confirm the GCP project's Map Tiles API key is dedicated to this use (not shared with other Maps Platform integrations on the same project, so a future incident on one surface can't silently affect the other's quota/billing).
- [ ] Application restriction: **Websites (HTTP referrers)** — add `https://venviewer.com/*` (and any subdomains actually served, e.g. `https://*.venviewer.com/*` only if genuinely needed) plus the local dev origins in use (e.g. `http://localhost:5173/*`).
- [ ] API restriction: limit the key to **Map Tiles API** only.
- [ ] Set a GCP budget alert on the project (Finding 4 — this is billed, real usage from session 1,001/month).
- [ ] Confirm the 10,000/day root-tileset quota is enough for expected traffic; file a quota-increase request ahead of any expected spike (e.g., the marketing video going out).
- [ ] Set `VITE_GOOGLE_MAPS_TILES_KEY` in Vercel's environment (Production, and Preview/Development if the team wants the live hero in previews) — remember this needs a **new deployment** to take effect, it is not a live toggle.
- [ ] Confirm the key is never committed to the repo (matches existing convention: `packages/web/.env.local`, gitignored).

## Attribution audit result

**Does the shipped page comply with Google's attribution requirements? Not yet fully — the code-level defect is fixed as of 2026-08-27 (Task 15b); two narrower, non-code items remain.**

- Data attribution (per-tile copyright text): plumbing is correctly built and unconditional (`TilesAttributionOverlay` inside every phase, per `GoogleTilesStage.tsx`'s own header comment), but whether Google's live tileset actually returns non-empty `asset.copyright` for the Trades Hall area is unverified — no one has seen it render against real tiles yet (blocked on the API key, same blocker as Tasks 6/8/11 per the plan ledger — and whoever sets that key first, anywhere, before the logo asset lands is the one who will see a broken-image icon instead of the logo; see the STOP-GATE's item 2). **Unchanged by this update.**
- Brand attribution (Google Maps logo): the code that suppressed it is **fixed** — `GoogleCloudAuthPlugin` is now constructed with a non-empty `logoUrl` (`GOOGLE_MAPS_ATTRIBUTION_LOGO_URL`, defined in `arrival-config.ts`, wired into the existing memoized `authArgs` tuple in `GoogleTilesStage.tsx`), so the logo-credit branch in `getAttributions()` (`GoogleCloudAuthPlugin.js:120-125`) now executes — verified by a passing test (`GoogleTilesStage.test.tsx`) asserting the plugin receives exactly that value. **What is NOT yet verified:** no file has been committed at the path that constant points to (`packages/web/public/images/brand/google-maps-attribution-logo.png` — see Finding 2's "Residual gap"), so the actual rendered result — a real, correctly-sized Google Maps logo, as opposed to a broken-image icon — has not been, and cannot yet be, visually confirmed.
- Verdict: **code path fixed and tested; full visual compliance NOT YET verified.** Two independent, already-tracked items remain: (1) the logo asset file — new, purely human-actionable, no further code required; (2) the live data-attribution check — pre-existing, blocked on the API key. Do not read this section as "ship it" — see the STOP-GATE section's "Remaining before ship" and the Deployment checklist below for the exact remaining steps.

## Deployment checklist (Task 16 executes — one item below is already done, in code only; see its note)

- [x] Finding 2's `logoUrl` fix is implemented and unit-tested (Task 15b, 2026-08-27 — `GoogleTilesStage.tsx` + `arrival-config.ts`, see Finding 2). NOT yet human-code-reviewed or merged to `master` — landed on the `worktree-arrival-hero` branch.
- [ ] The actual Google Maps attribution logo asset file is downloaded from Google's official kit, the correctly dp-sized/high-contrast variant is chosen, and it is committed at `packages/web/public/images/brand/google-maps-attribution-logo.png` (the path `GOOGLE_MAPS_ATTRIBUTION_LOGO_URL` already points to — see Finding 2's "Residual gap"). Blocking: without this file, the logo credit 404s instead of rendering.
- [ ] Live visual check against real tiles (once the key exists AND the asset file above is committed): logo visible at correct size/contrast, data-attribution line non-empty, neither obscures the other.
- [ ] Key-restriction checklist above fully ticked.
- [ ] GCP budget alert configured and tested.
- [ ] Vercel production env var set; fresh deployment confirmed live (not just saved in the dashboard).
- [ ] Fallback drill: temporarily unset the key in a preview deployment, confirm the static photo carries the page with no console errors (spec §6 behavior, currently blocked from live verification per the plan ledger's Task 6 note).
- [ ] Task 17 marketing video: recorded only after the logo asset file is committed AND the live visual check above has confirmed it actually renders (not merely after the code fix — see Finding 3's Action items); ≤30 seconds for any cut containing the tiles hero; "for promotional purposes only" label burned in; not resold or licensed separately.
- [ ] (Non-blocking, tracked for later — does not gate Tasks 16/17) Once the asset lands: close the accessibility gap on the rendered logo `<img>` — Google's policy requires an accessible label reading "Google Maps", but neither the installed library's attribution contract (`{ value, type, collapsible }`) nor its renderer (`TilesAttributionOverlay.jsx:100-104`) carries one today. Needs a real fix (wrapper/override or an upstream library change), deliberately not attempted in Task 15b — see Finding 2's accessibility follow-up note.

## Sources (fetched 2026-08-27)

| # | Source | URL |
|---|---|---|
| 1 | Map Tiles API Policies (attribution, promotional videos, caching, geodata overlays) | developers.google.com/maps/documentation/tile/policies |
| 2 | Photorealistic 3D Tiles (renderer requirements) | developers.google.com/maps/documentation/tile/3d-tiles |
| 3 | Work with a 3D Tiles renderer (custom-renderer attribution guidance) | developers.google.com/maps/documentation/tile/use-renderer |
| 4 | Map Tiles API Usage and Billing (session/root-tileset billing semantics) | developers.google.com/maps/documentation/tile/usage-and-billing |
| 5 | Google Maps Platform core services pricing list | developers.google.com/maps/billing-and-pricing/pricing |
| 6 | API key best practices (HTTP referrer vs IP, exposure warning) | developers.google.com/maps/api-key-best-practices |
| 7 | API security best practices | developers.google.com/maps/api-security-best-practices |
| 8 | Set up the Map Tiles API (key setup) | developers.google.com/maps/documentation/tile/get-api-key |
| 9 | Geo Guidelines (commercial-use routing statement, real estate/Earth Studio scope) | about.google/brand-resource-center/products-and-services/geo-guidelines/ |
| 10 | "Build immersive maps at scale… now in GA" | mapsplatform.google.com/resources/blog/build-immersive-maps-at-scale-with-photorealistic-3d-2d-and-street-view-tiles-now-in-ga/ |
| 11 | Google Maps Platform Terms of Service (general — could not be fully retrieved, see note) | cloud.google.com/maps-platform/terms |
| 12 | Google Maps Platform Service Specific Terms (general — could not be fully retrieved, see note) | cloud.google.com/maps-platform/terms/maps-service-terms |

**Note on sources 11–12:** both full Terms-of-Service documents exceeded the fetch tool's content limit and returned truncated. Everything cited above instead comes from Google's API-specific documentation pages (sources 1–9), which are the operative, product-specific policy layer and are consistent with the general ToS's attribution clause (Section 3, per secondary confirmation) rather than superseding it. Recommend Blake or counsel skim the full ToS directly in a browser before a high-stakes launch decision, since this session could not read it end to end.
