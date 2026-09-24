# Performance review — 24 September 2026 (T-629)

Status: implemented and verified on branch `claude/cool-tesla-90zlcp`; not
deployed and not live-verified. Numbers below are local lab measurements
(production builds, throttled Chromium, disposable PostgreSQL 16). They are not
field data, physical-device frame rates or founder acceptance.

Four read-only audits (API/database, React rendering, 3D rendering,
page load/network) ran against `d7eb71b`. Findings were checked against source
before any change. The native Gaussian-splat renderer and its generated data
were excluded: T-627/T-628 own them and public splats are on hold.

## Results

### Page weight (production build, JS + CSS a route adds beyond the entry)

| Route | Before (gzip) | After (gzip) |
|---|---:|---:|
| Panorama tour `/venues/:slug/twin` | 2,392 KB (633 KB) | 1,199 KB (329 KB) |
| Planner `/plan` | 3,600 KB (1,021 KB) | 3,136 KB (894 KB) |
| Homepage `/` | 694 KB (175 KB) | 243 KB (75 KB) |
| `/fresh`, `/editor` | 635 KB (149 KB) | 140 KB (39 KB) |
| Landing | 623 KB (146 KB) | 64 KB (19 KB) |
| Client event, proposal, supplier pages | 578–580 KB (132–134 KB) | 89–104 KB (25–27 KB) |
| Hallkeeper sheet | 675 KB (164 KB) | 200 KB (59 KB) |
| Diary | 766 KB (188 KB) | 357 KB (99 KB) |
| Day Board | 697 KB (167 KB) | 285 KB (77 KB) |
| Dashboard | 960 KB (230 KB) | 593 KB (154 KB) |
| Craft quiz | 742 KB (178 KB) | 241 KB (66 KB) |
| Deferred Sentry chunk (every page with a DSN) | 437 KB JS (144 KB) | 77 KB JS (26 KB) |

Routes that load the shared contracts fell by 76–305 KB gzip, and the
shared Blueprint and living-hall chunks by 84 and 126 KB. Login, registration,
legal, pricing, leaflet and demo pages were already small and are unchanged, as
is the entry (281 KB, 93 KB gzip).

### Homepage in a browser (same local server, two runs each, consistent)

| Profile | Largest paint | Transferred |
|---|---:|---:|
| Phone: 390 × 844 at 3×, 1.6 Mbps, 150 ms, 4× CPU | 24.9 s → 5.1 s | 7.34 MB → 0.97 MB |
| Desktop: 1440 × 900, 10 Mbps, 40 ms | 4.6 s → 0.81 s | 11.7 MB → 0.79 MB |

First contentful paint was unchanged (≈0.5 s phone, ≈0.16 s desktop). The
harness serves HTTP/1.1, where the hero shares bandwidth equally with the rail
cards; production HTTP/2 prioritisation should do at least as well.

### Planner drags (Node 22 in this container, 1,287-item banquet)

On desktop the planner re-runs its placement-rule sweep and grouped-chair
counts on every pointer move of a drag. Both compared every item with every
other item.

| Work per pointer move | Before | After |
|---|---:|---:|
| Placement-rule sweep (overlap and room bounds) | 209.6 ms | 1.45 ms |
| Grouped-chair counts | 27.3 ms | 0.25 ms |
| Select-all drag: expanding groups | 22 ms | 0.7 ms |
| Select-all drag: surface heights | 29.5 ms | 0.25 ms |

These time the pure functions, not browser frames; this container runs the old
sweep about 1.6× slower than the audit measured, so the ratios carry over
rather than the absolute numbers. A single-table drag's surface pass is
unchanged (0.59 vs 0.60 ms), as is the lean single-selection sweep.

### API (disposable PostgreSQL 16, real handlers and migrations)

- A 150-object planner save issued **158 SQL statements; it now issues 11**,
  independent of layout size (3 and 150 objects measure the same).
- An already-linked sign-in resolves with **one** statement instead of a
  transaction with an advisory lock, row locks, up to two invitation lookups
  and a commit. It no longer queues behind account linking: the new test
  resolves while another transaction holds that lock (the old path blocked).
- Browser preflights for authenticated calls are cached for 2 hours instead of
  about 5 seconds.
- Large JSON is compressed (brotli quality 4, else gzip). The API audit's
  synthetic layouts compress about 6× (300 objects: 133 KB → 21 KB) and diary
  calendars about 7×. Railway's edge forwards encoded bodies but does not
  compress API responses itself.

## What changed

### Web bundles
- `@omnitwin/types` declares `"sideEffects": false`; a test fails if any module
  gains top-level side effects. The Trades Hall room slugs moved into a
  schema-free module the barrel exports directly, so pages that only need the
  list no longer pull `asset-version` schemas through a re-export.
- Sentry loads through a local module that re-exports `init`, `withScope` and
  `captureException` by name. The namespace import had kept Replay, Feedback,
  profiling and AI-tracing integrations.
- The GDTF/MVR archive reader (zip.js, ≈230 KB of source) loads when a file is
  chosen, not with the planner.
- `three.webgpu`, TSL and the native splat addon stack are their own vendor
  chunk. The WebGL panorama tour no longer downloads them; NativeCanvas
  surfaces load both chunks as before.

### Images, caching and fonts
- The homepage hero and room cards, and the hallkeeper room thumbnails, use
  display-sized WebP ladders of the same supplied photographs (existing venue
  ladders where they exist; five new sets at quality 80, checked at 1:1). The
  hero has `fetchpriority="high"` and an early, path-guarded preload in
  `index.html` that a test keeps identical to the rendered `srcset`.
- The Trades Hall crest shown at 32–60 CSS px is a 21 KB WebP instead of the
  997 KB PNG (the PNG remains the source of record).
- `vercel.json` caches versioned furniture models and hash-named voice clips
  immutably; other public images get one hour plus a week of background
  revalidation. HTML is never cached. A test walks every published file.
- The craft quiz requests its fonts with an injected stylesheet. Its CSS
  `@import` made the whole route fail (“Unable to preload CSS”) whenever Google
  Fonts was unreachable; reproduced in Chromium before, renders after.

### Planner and Diary responsiveness
- Marquee frames with unchanged membership, and drags reporting no guides, no
  longer notify every selection subscriber; the editor store is written only
  when the primary selection changes.
- The layers panel subscribes to what it lists (id, catalogue, label, group), so
  moving furniture no longer rebuilds and re-renders it every frame. The
  toolbox, command deck and save/review panels select flags, labels and counts
  instead of whole arrays and history objects.
- Wall click planes are hidden (three raycasts hidden meshes), removing a sorted
  transparent draw per wall every frame. Wall fades rebuild a material only when
  its blending changes. The Grand Hall parquet and dome textures persist across
  camera gestures instead of being regenerated after every orbit.
- The placement-rule sweep checks each item against nearby furniture through
  a 1 m grid instead of against every item, and group members and grouped
  chair counts come from one pass over the layout. A property test runs
  verbatim copies of the old functions against 500 seeded layouts (up to 300
  items: banquets, theatre rows, tiled stages, touching and duplicated
  furniture, dangling groups, duplicate ids, non-finite poses) and requires
  identical results; thirteen deliberately broken variants all fail it.
- Dragging a large selection no longer rescans the layout per item: groups
  are expanded from one lookup and surfaces are searched among stationary
  items only (the scan already skipped moving ones).
- Diary (separate commit): memoised overview built from a per-render index,
  palette-owned search, stable drag handlers, memoised lanes and blocks, and a
  self-positioning enquiry chip. Its happy-dom benchmark: overview re-render
  33.7 → 0.05 ms, palette keystroke 30 → 1 ms, drag move within a slot
  12.3 → 0.07 ms, overview renders per remote change 5 → 1; screenshots
  byte-identical before and after.

### API
- Lock-free fast path in `getUserByClerkId` for linked accounts with no pending
  invitation; everything else takes the unchanged locking transaction.
- Optional `CLERK_JWT_KEY` makes session-token verification local instead of a
  periodic JWKS fetch (documented in the env examples; not set by this change).
- CORS `maxAge: 7200`; `@fastify/compress` 9.2.0 for JSON and text, request
  decompression off, binary asset routes opted out explicitly (mime-db would
  otherwise treat `application/octet-stream` as compressible).
- Neon pool keeps idle connections for 60 s instead of 10 s (idle clients do not
  keep a Neon compute awake; still inside its 5-minute scale-to-zero window).
- Planner batch saves (authenticated and guest) update every listed object with
  one `UPDATE … FROM jsonb_to_recordset` and delete omitted ones in one
  statement. A PostgreSQL test compares results and stored rows against the old
  per-object writes, including rounding, null metadata, foreign ids and repeated
  ids, and checks the coordinate-write trigger still fires.

## Opportunities not taken here (ranked by expected impact)

1. **Default planner furniture is film-grade geometry.** The default chair and
   table are ≈50k triangles each with uncompressed GLBs (1–12 MB per model); a
   20-table banquet draws ≈11.6M triangles per frame. Planner-grade simplified
   models plus meshopt/quantisation would cut GPU work and downloads by an order
   of magnitude. Needs visual acceptance of the simplified models.
2. **Dinner place settings are not instanced**: +1,000 transparent draws for a
   dressed 20-table banquet, with 200 transmission materials each forcing a
   framebuffer copy. Instancing and shared materials are invisible; replacing
   transmission glass is a visual decision.
3. **Planner render resolution is the raw device pixel ratio with 4× MSAA into a
   half-float target** (≈180 MB of targets on a 3× phone). This was chosen after
   blurred captures; changing it needs Blake's decision and side-by-side checks
   on the declared devices.
4. **Grand Hall ornaments cost ≈369 draws**; merging static meshes per material
   would bring that to tens.
5. **Editable furniture uses drei `<Instances>`**, recomposing every matrix every
   frame and adding one scene object per item. The existing `DirectInstanceBatch`
   path would remove that and also fix the culling bug below.
6. **Camera gestures swap to a lean room shell and back**, remounting walls, dome
   and features after every orbit (textures are now kept). Keeping the detailed
   shell is likely better on desktop; measure on the declared devices first.
7. **Name plates redraw a 1600 × 880 canvas each** when remounted after a gesture.
8. **Staff pages wait for Clerk and `/auth/me` before downloading their own
   code**; starting the page import when the route matches saves an estimated
   1–1.5 s on slow links.
9. **Planner start-up is a serial chain of API calls with repeats**
   (venues → spaces → up to five config checks → draft), then re-fetches.
10. **The homepage still ships the generated splat tile list** (45 KB gzip) to
    print eight labels and footprints; a generated summary would do. Owned by
    the splat tasks.
11. **Fonts**: the Google Fonts stylesheet is render-blocking with full variable
    axes; self-hosted, subset files with one or two preloads would help, and
    the homepage also triggers the cockpit fonts.
12. **API**: the phase graph returns every snapshot's full layout; linked-layout
    summaries are fetched one configuration at a time; hot paths `SELECT *`
    data-URL thumbnails; the rate limiter keys by IP because `request.user` is
    not set at `onRequest` (a venue team shares 100 requests/min); every diary
    change makes every client refetch the calendar and enquiries; the venue
    dashboard aggregates whole tables in JavaScript; the pool has no connection
    timeout; `enquiries.configuration_id` and `proposals.configuration_id` lack
    indexes. Layout revisions are stored in full on every save with no retention
    rule (a data-retention decision).
13. **Heavy images elsewhere**: quiz crests are 3.15 MB of PNG shown at 35–58 px;
    inventory pictures are 0.75–0.86 MB lossless WebP; room plans are 0.7–1.2 MB
    PNG.
14. **Measurement gap**: `scripts/frame-budget-pass.mjs` loads an empty room, so
    it never measures the furnished-scene 60 fps target. A default banquet, a
    dressed banquet and a drag trace would give device numbers for items 1–7.

## Defects found in passing

Fixed here: the quiz crash above, and `roomPosterUrl("__proto__")` returning
`Object.prototype` instead of a URL.

Not fixed (outside this change):
- The Diary's enquiry tray requests enquiries without a status; the API returns
  the 20 least recently updated, so new pending enquiries can be missing once a
  venue has more than 20.
- Clicking empty floor near the room centre can select a phantom
  `template-<catalogueId>` item: hidden instancing templates at the origin are
  hit by the selection raycast and accepted by `findFurnitureItemId`.
- Instanced furniture keeps a bounding sphere computed once; items added far
  from the first ones can be frustum-culled while on screen.

## Verification

- Web, on the integrated branch: 492 test files (6,462 tests, 16 existing
  skips); source and E2E typecheck; lint on all 61 changed source files;
  production build (route sizes above). New regression tests fail against the
  previous code.
- Types: 100 test files (2,239 tests), lint and typecheck.
- API: unit suite (174 files, 2,942 tests; the 14 database-gated files run
  separately) and lint; `test:platform-db` (65 tests, including the new
  batch-save comparison) and `test:event-access-db` (53) on fully migrated
  disposable PostgreSQL 16; onboarding suite (31) on its isolated database.
- Browser: homepage phone/desktop measurements above; quiz with Google Fonts
  blocked; hero preload and `srcset` served as rendered.

## Limits

- Not deployed. Web deploys from `master` on Vercel and the API only by
  `railway up`; this session may push only its own branch, and its network
  policy blocks `venviewer.com`, so no live check was possible.
- The API change needs its own deploy (no migration). `CLERK_JWT_KEY` is
  optional. Compression was verified in-process, not through Railway.
- No GPU was available: 3D changes are verified by scene inspection and CPU
  tests, not frame timing.
