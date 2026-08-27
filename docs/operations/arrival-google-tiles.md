# Google Photorealistic 3D Tiles — licensing, pricing, and ops runbook

Date: 2026-08-27
Status: STOP-GATE research complete — **BLOCKED** (one verified, narrow, fixable gap; see below)
Owner: Venviewer engineering / operations
Scope: the Arrival homepage hero (`packages/web/src/pages/landing/arrival/`) and the Task 17 marketing-video capture that depends on it.
Research method: primary sources only (Google's own developer docs, policy pages, and pricing pages), fetched 2026-08-27. Every quote below is short and attributed; where the terms were genuinely ambiguous for our case, that is stated rather than resolved in our favor.

## STOP-GATE — read this first

**BLOCKED, narrowly: the shipped page does not emit Google's required brand/logo attribution.**

Google's Map Tiles API Policies require two separate things: a **data attribution** (per-tile copyright text) and a **brand attribution** (the actual Google Maps logo image, sized 16–19dp tall). Our renderer only emits the first one. Verified directly in the installed library source, not inferred:

- `packages/web/src/pages/landing/arrival/GoogleTilesStage.tsx` constructs the plugin as `new GoogleCloudAuthPlugin({ apiToken })` — no `logoUrl` is passed.
- `GoogleCloudAuthPlugin`'s constructor (`node_modules/.../3d-tiles-renderer/src/core/plugins/GoogleCloudAuthPlugin.js:25`) defaults `logoUrl = null`, and `getAttributions()` (same file, lines 120–125) only pushes the logo credit `if ( this.logoUrl )`.
- Since `logoUrl` is never supplied, that branch never runs, in any phase. `TilesAttributionOverlay` (the component we render) is a generic surface that draws whatever `tiles.getAttributions()` returns — it renders faithfully, but there is nothing logo-shaped to render.

Net effect: the page shows the small text credit line (bottom-left, per-tile copyright strings) but **never shows the Google Maps logo**, in flight, arrived, or exploded phase. That is a requirement the shipped page does not currently meet (Finding 2 below has full detail and the fix).

This is a **code-level gap, not a legal prohibition on the feature** — commercial use and promotional video capture are both permitted (Findings 1 and 3). The fix is small (pass a `logoUrl` pointing at Google's own attribution-asset kit into the existing plugin constructor) but it is a real gap and per the Blake Clause it is reported as one, not softened. **Do not deploy the production key (Task 16) or record the marketing video (Task 17) until this is fixed or Blake explicitly accepts the risk.**

Secondary, non-blocking items Blake should still see before Task 17:
- Any promotional video containing this Content is capped at **30 seconds**, must exclude Street View, and must carry a burned-in "for promotional purposes only" label (Finding 3).
- Photorealistic 3D Tiles is billed, real money, from session 1,001 in any calendar month (Finding 4) — small, but not zero, and worth a budget alert.

## What the feature does, and the kill-switch

The Arrival homepage hero (`packages/web/src/pages/landing/arrival/`) renders live **Google Photorealistic 3D Tiles** inside the site's own React Three Fiber canvas, using `3d-tiles-renderer@0.5.2` (NASA-AMMOS) — specifically its `GoogleCloudAuthPlugin` (session-token auth + per-tile attribution collection) and `TilesAttributionOverlay` (rendered unconditionally, in every phase; no prop hides it — see `GoogleTilesStage.tsx:116-121`). The camera flies a scripted rail from high over Glasgow down to Trades Hall (85 Glassford Street); the site's own captured mesh then crossfades in over Google's tile geometry, and the building explodes into labeled storeys linking to `/tour` and `/plan`.

**Kill-switch:** `googleTilesApiKey()` (`arrival-config.ts`) reads `import.meta.env["VITE_GOOGLE_MAPS_TILES_KEY"]`. If it is absent or blank, `ArrivalHero` calls `useArrivalStore.getState().fail("no-key")`, which sets `phase: "fallback"` (`arrival-store.ts:47-49`), and `ArrivalHero` renders `null` in that phase (`ArrivalHero.tsx:228-230`) — the static hero photo underneath simply carries the page, with no other code change. **Caveat:** `VITE_…` is a Vite build-time env var (`import.meta.env`, baked into the bundle at build time, per `vite-env.d.ts`), not read at runtime — removing it from Vercel's environment only takes effect on the **next deployment**, it does not flip an already-running production build live.

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

**Audit of the shipped page: does NOT comply.** See the STOP-GATE section above for the source-verified reason (`logoUrl` never passed to `GoogleCloudAuthPlugin`). Two supporting facts:

- `TilesAttributionOverlay.jsx` (`node_modules/.../3d-tiles-renderer/src/r3f/components/TilesAttributionOverlay.jsx:88-112`) is a faithful-but-generic renderer: it draws a `<div>` for each `type: 'string'` attribution and an `<img>` for each `type: 'image'` one, in a bottom-left overlay at 10px/75%-opacity. It is correctly wired and correctly unconditional (per the file header comment in `GoogleTilesStage.tsx`) — the gap is upstream of it, in what gets fed in.
- Whether the *data* half is actually non-empty in production (i.e., whether Google's live Trades Hall tileset returns a populated `asset.copyright` string) is **unverified** — the plan ledger notes the live visual gate is blocked on `VITE_GOOGLE_MAPS_TILES_KEY` landing in `packages/web/.env.local` (Task 6/8/11 are all blocked on this), so nobody has yet seen the overlay render against real tiles. Confirm both halves — logo present, copyright line non-empty — in the same visual pass once the key exists.

**Fix path:** pass `logoUrl` (pointing at an asset derived from Google's kit above, sized per the dp rules) into the existing `GoogleCloudAuthPlugin` constructor call in `GoogleTilesStage.tsx`. This is additive to the existing, correctly-built plumbing — not a rewrite.

### 3. Video capture (gates Task 17)

**Permitted, tightly conditioned.** Full clause, Map Tiles API Policies, "Video creation featuring Map Tiles API" / "Promotional Videos" (developers.google.com/maps/documentation/tile/policies, fetched 2026-08-27):

- Must not include Street View imagery.
- Must be **no more than 30 seconds** in length.
- Must be about the capabilities of the application.
- Must be clearly marked **"for promotional purposes only"** and comply with the attribution display guidelines (Finding 2 — meaning a video recorded before the logo fix inherits the same non-compliance).
- May not be resold separately, or as part of the software/application/user experience.
- Google may request takedown, and *"You are responsible to comply with all requests to takedown the Promotional Video."*

**Unclear — needs confirmation from Google or Blake's own risk call:** the clause says "the promotional video must be no more than 30 seconds" without explicitly distinguishing "the whole deliverable" from "the segment that contains this Content." If Task 17's video is meant to be longer than 30 seconds overall (e.g., a 60–90 second brand piece), the conservative reading — recommended here — is that any single video asset containing footage of the Google-tiles-powered hero must itself be ≤30 seconds, or the tiles/mesh-crossfade segment must be cut into its own separate ≤30-second asset. Do not assume the more permissive "just the segment counts" reading without checking; this is exactly the kind of ambiguity the brief asked to flag rather than resolve favorably.

Action items for Task 17: hard 30-second cap on any cut containing the tiles hero; burn in the "for promotional purposes only" label; ship it only after Finding 2's logo fix lands (so the recorded attribution is actually compliant); do not license or sell the video separately from the product.

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

**Does the shipped page comply with Google's attribution requirements? No.**

- Data attribution (per-tile copyright text): plumbing is correctly built and unconditional (`TilesAttributionOverlay` inside every phase, per `GoogleTilesStage.tsx`'s own header comment), but whether Google's live tileset actually returns non-empty `asset.copyright` for the Trades Hall area is unverified — no one has seen it render against real tiles yet (blocked on the API key, same blocker as Tasks 6/8/11 per the plan ledger).
- Brand attribution (Google Maps logo): **absent in all phases**, verified by reading the installed library source — `GoogleCloudAuthPlugin` is constructed without `logoUrl` (`GoogleTilesStage.tsx`), so the logo-credit branch in `getAttributions()` (`GoogleCloudAuthPlugin.js:120-125`) never executes.
- Verdict: **non-compliant as shipped**, for a known reason, with a known fix (Finding 2). This is the STOP-GATE.

## Deployment checklist (unticked — Task 16 executes)

- [ ] Finding 2's `logoUrl` fix is implemented, code-reviewed, and merged.
- [ ] Live visual check against real tiles (once the key exists): logo visible at correct size/contrast, data-attribution line non-empty, neither obscures the other.
- [ ] Key-restriction checklist above fully ticked.
- [ ] GCP budget alert configured and tested.
- [ ] Vercel production env var set; fresh deployment confirmed live (not just saved in the dashboard).
- [ ] Fallback drill: temporarily unset the key in a preview deployment, confirm the static photo carries the page with no console errors (spec §6 behavior, currently blocked from live verification per the plan ledger's Task 6 note).
- [ ] Task 17 marketing video: recorded only after the two items above are live; ≤30 seconds for any cut containing the tiles hero; "for promotional purposes only" label burned in; not resold or licensed separately.

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
