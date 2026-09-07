# Elaine showcase / demo — 7 September 2026

Blake requested an impressive display-only website/presentation/PDF at venviewer.com/demo, covering Trades Hall, Venviewer operations and the business vision.

## Delivered source

Eight responsive presentation chapters, authentic existing public venue photography and crest, captured venue inset, local dinner/conference/reception illustration, synthetic diary, explicitly scripted future conversational planning, setup-sheet example, qualitative business case and a venue-exploration link. Keyboard chapter navigation, full-screen controls and an eight-page downloadable landscape PDF. No new dependencies, authentication requirements, API calls or venue-data mutation.

Room and layout examples are illustrative. Future AI assistance is labelled product vision and scripted example. No invented financial, performance, adoption or conversion metrics. Existing source photography is reused from public/images/venue and the founder-supplied crest from public/images/venues; the inset uses existing tour-door-1800.webp captured output. Programmatic room arrangements are explanatory diagrams, not surveyed geometry or approved plans.

## Qualification

- Five focused Vitest cases pass: navigation limits, local layout selection, scripted scope, unique SVG IDs and PDF links.
- Changed page passes strict standalone TypeScript and affected ESLint (with router).
- Actual Chromium checks at 1440x900 and 390x844: all 16 chapter views show decoded images without horizontal overflow, zero page errors and zero write requests. Keyboard Home/End bounds and layout change verified.
- Eight-page 960x540pt PDF exported from print CSS, rendered with Poppler and visually reviewed. Print layout specificity, theme contrast and duplicate SVG IDs corrected. All print sections measure 1280x720 CSS px.
- Independent source/content/accessibility review completed. Founder aesthetic acceptance and physical device performance are not claimed.
- Full local web typecheck/build initially blocked by borrowed dependencies resolving @omnitwin/types to stale venviewer-demo-spark-teardown output. This is an environment limitation, not a passing full gate. Coordinated release must verify with its current private dependency graph before publication. First build also detected a copied development Clerk key; later build uses the real public production key derived from venviewer.com and the production API origin. No private key is stored in source.

Evidence retained at D:/claude/venviewer-elaine-showcase-20260907/output/playwright/verification.json, chapter PNGs and output/pdf. PDF public asset is packages/web/public/demo/venviewer-elaine-showcase.pdf. Source and final release evidence follow in the session log.

## Production delivery and live verification — 18:46 UTC

The production release is `7f2a701b4dade7d9d6048a82511ffa83cf4ff821`, containing showcase commit `0a4bc509a4171b6311d94179f25f9119c8562bee`. Vercel Production succeeded (receipt `6314446074`, reported by the release owner), and venviewer.com serves the new index-MYrlSuOu.js entry. The release's private dependency graph resolved the earlier local stale-types limitation. The full production build receipt records exit 0 with clean unchanged source, production API origin and E2E bypass disabled. Release coordination reports 934 selected web regressions and applicable lint/type/build gates passed.

Fresh public Chromium verification passed all eight chapters at 1440x900 and 390x844 (16 views): every image decoded, no horizontal overflow, zero page errors and zero write requests. Home/End bounds and layout selection work. A second actual in-app browser verified public /demo, Present/Exit full screen and reception selection, then restored the welcome chapter.

The public PDF returned HTTP 200 application/pdf, 4,442,916 bytes. Download SHA-256 `9d1bf556322be375adddd9411d137ffc124d907ba48912594e20387200ccfbe7` equals the reviewed eight-page 960x540pt source deck byte for byte. Public routes:

- https://venviewer.com/demo
- https://venviewer.com/demo/venviewer-elaine-showcase.pdf

Live evidence: `D:/claude/venviewer-elaine-showcase-20260907/output/playwright/live-verification.json`, live-prefixed chapter PNGs, `live-download.pdf`. The demonstration page is delivered and verified live; founder aesthetic acceptance and measured physical-device performance remain unclaimed.
