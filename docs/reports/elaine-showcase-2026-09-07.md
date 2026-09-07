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
