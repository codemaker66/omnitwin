# The Living Hall — landing page design plan v2 (approved)

**Date:** 2026-07-09 · **Status:** P0 in progress · **Supersedes:** the Rite (`/landing`), the spotlight (`/`) as the target landing direction.

## The claim

**A landing page that IS the product, running live on the real room.** The actual captured hall as a real-time scene, dressed for your evening by the actual planner engine, in the browser. Every prior concept failed by faking spatial experience with flat images; this one runs on the assets and engine only Venviewer has.

## Art direction — "a quantity surveyor's gold ink on captured truth"

- **Captured truth is photoreal**: the splat, one captured lighting state, untouched. No relighting (splats bake radiance; dawn/night grading would be synthesis).
- **Everything Venviewer adds is hand-drafted gold ink**: hairline vectors, survey-annotation type, plotter-pen restraint. Desaturated heritage gold (~#C9A86A), strict bloom threshold, no volumetric glow, no flares, no sparkle. Ink, not hologram.
- **Gold = authored plan facts. Cyan = simulated/derived outputs, exclusively.** Two-line legend on the page. This is Truth Mode as art direction.
- Typography: Newsreader display (tuned optical sizes) under audition against one characterful open/Fontshare grotesk for chrome; Geist demoted from display (Vercel identity). Best-by-merit, zero-license budget (decision #5: "make the best, by whatever means necessary").

## Experience — four stations, one persistent frame

Native document scroll ONLY (no hijack — keyboard/space/PageDown intact). Camera on an authored spline mapped to scroll progress. Persistent hairline header from first paint: venue name · Check a date · Enquire · act-index dots (real `<nav>`, deep-linkable anchors). Every act skippable.

1. **Arrival** (cold open, ~1.5vh): fade into the real room at eye height; first gold-ink chair draws itself in within ~3s of first scroll.
2. **The Dressing** (the set-piece): visitor picks *wedding · dinner · conference* (owns the goal — real Zeigarnik; corporate lane). One table dressed completely at intimate eye height, then a slow rising crane to ~4m as density grows (legibility). ≤12 objects animating in frame. Numbers tick from the capacity engine, never hardcoded. Storyboarded before code.
3. **The Turn & The Proof**: rise to a high interior corner (never exit the capture hull), crossfade to the planner's view of the same geometry. Visitor moves one table — pointer OR keyboard (focusable entry button, arrow keys; WCAG 2.5.7). The table persists (planner opens with it; enquiry attaches it). Provenance block renders mechanically from `state/capture_log.json` records — no record, no seal. Language: "capture record", never "certified".
4. **The Rooms & The Threshold**: gold hand-drafted architectural section of the building (extruded from real floor polygons — NOT a Matterport-style dollhouse), rooms as lit panorama apertures. Per room: engine-derived capacities + sanctioned disclosure + pricing signal + Explore (twin walk) + Plan here. Close: the dressed hall from the head table; ONE adaptive primary CTA (sandbox-engaged → "Continue with your table"; else → "Speak with the events team"); date-check widget fail-closed.

## Tiers (capability × motion preference, independent axes)

One semantic HTML document (four `<section>`s, full narration prose, real forms) is the source of truth for ALL tiers — authored first, 3D layers on top.

- **Tier S** desktop: full splat + live gold ink. In-page motion + sound toggles persisted; reduced-motion on any tier = still-station crossfades, pointer effects direct (per `feedback_reduced_motion_pointer`).
- **Tier B** phones (the flagship — 70–85% of wedding traffic): pre-rendered per-act scroll-scrub video from the real capture + its own interactive moment (tap-to-place a table on the 2D floor polygon, live capacity math client-side). Per-tier copy matrix: video tier never claims "drag it".
- **Tier C** reduced-everything/scrapers: the designed print edition = the semantic document styled. Authored FIRST for copy (SEO/LLM claims surface).

Budgets: poster LCP < 1.0s · CLS 0 · INP < 100ms · shell < 250KB (3D chunk preloaded on first gesture) · hero splat ≤ 25MB at accepted quality (P0 measures) · velocity-gated rendering · worker decode · depth-only prepass from the room mesh so real architecture occludes gold ink.

## Panel critique record (2026-07-03, 12 agents)

design-taste 6.5 · graphics-eng 6 · conversion 5.5 · claim-safety 6 · veteran-skeptic 6 · a11y 4. All confirmed criticals addressed in v2 (this document). Open risks: eye-height dolly quality on LCC captures (P0 graded-flythrough gate); Spark streaming behavior (contested — P0 measures); iOS scrub performance (P0 prototype); 8–12 week honest timeline, minimum-viable narrative (Arrival + Dressing + Threshold) ~wk 4–5. Venue Page Factory architecture (acts as data-driven modules per room) is a P0 commitment — venue #2 must not cost a rebuild.

## Decisions log (Blake, 2026-07-09)

1. **Hero room:** Reception Room now; Grand Hall pending AWS compute negotiation (41GB xbin, ~165GB-RAM Lixel job).
2. **Pricing signal — publish real rates.** Exclusive wedding use of Trades Hall, up to 180 guests:
   - **2026:** Wedding Breakfast & Evening Reception £2,800 · Twilight Wedding £1,800 · Evening Reception £1,500
   - **2027/28:** Ceremony only £650 · Wedding Breakfast & Evening Reception £2,900 · Twilight Wedding £2,000 · Evening Reception £1,800
3. **Capacities confirmed** (client-supplied, matches tradeshallglasgow.co.uk): Grand Hall 250/80/180/250 (theatre/classroom/dinner/reception) · Saloon 80/40/60/80 · Robert Adam 80/40/60/150 · Reception Room 80/35/60/100 · North Gallery 40/18/40/40 · South Gallery 40/18/40/40.
4. Dressing look: chosen from codebase photography (candlelit set).
5. Fonts: best by merit, no license budget assumed.
6. R2/CDN: deferred to P4.

## Asset reality (verified on disk 2026-07-09)

- **Reception Room runtime SOG exists**: `F:/VENVIEWER -- TH PROJECT SPLAT OUTPUTS/lcc2-result/data/3dgs/` — 7 tiles, ~63MB total, 2,002,122 splats (report.json), plus per-tile collision PLYs, env.sog, poses.json, and `New folder (2)/mesh-files/Reception Room.obj` (644KB room mesh — depth-prepass candidate). Open question: Spark 2.0.0 ingestion of LCC `.sog` container (fallback path: LCC Studio PLY export → @playcanvas/splat-transform → web SOGS).
- **Raw xbin captures exist for ALL rooms** (XGRIDS PortalCam): Grand Hall 41GB (2026-05-31), Saloon 29GB (2026-05-29), Robert Adam 14GB (2026-05-29), Reception 8.7GB (2026-06-01), DC Room 8.9GB, North/South Gallery ~5GB each, Lady Convenor 3.3GB.
- Reception build record: scanned 908s, built 2026-06-08 (04:12:57), quality 3, walkSpeed 0.52 m/s.

## P0 exit gates

1. Semantic Living Hall document at `/living-hall` with venue-truth data modules (capacities, pricing) under claim-guard tests. ✅ when merged.
2. Reception SOG loading in Spark measured: bytes at accepted quality, streaming behavior, splat count, fps; graded dolly flythrough with artifact map. Go/no-go on the LCC container.
3. Tier B scrub prototype exercised on a real phone (needs Blake's device for the final check).
4. Grand Hall processing go/no-go (blocked on AWS — Blake).
