# Performance review — 24 September 2026 (T-629)

Status: two waves verified on branch `claude/cool-tesla-90zlcp`, a
fast-forward of `master`. Blake asked for the best choices for maximum
performance and a push to `master`; this session's permission system refused
that push, so the release waits for Blake. A master push deploys the web app on
Vercel and, because the change touches the API's watched paths, the API on
Railway (see `docs/operations/diary-deploy-checklist.md`); migration 0071 is
applied by the Deploy workflow once CI passes. This session cannot check the
live site: its network policy blocks `venviewer.com` and `api.venviewer.com`.
Numbers below are local lab measurements (production builds, throttled
Chromium, SwiftShader, disposable PostgreSQL 16). They are not field data,
physical-device frame rates or founder acceptance.

Four read-only audits (API/database, React rendering, 3D rendering,
page load/network) ran against `d7eb71b`. Findings were checked against source
before any change. The native Gaussian-splat renderer and its generated data
were excluded: T-627/T-628 own them and public splats are on hold.

## Results

### Page weight (final production build, JS + CSS a route adds beyond the entry)

| Route | Before (gzip) | After (gzip) |
|---|---:|---:|
| Panorama tour `/venues/:slug/twin` | 2,392 KB (633 KB) | 1,200 KB (329 KB) |
| Planner `/plan` | 3,600 KB (1,021 KB) | 3,141 KB (899 KB) |
| Homepage `/` | 694 KB (175 KB) | 243 KB (75 KB) |
| `/fresh`, `/editor` | 635 KB (149 KB) | 141 KB (40 KB) |
| Landing | 623 KB (146 KB) | 64 KB (19 KB) |
| Client event, proposal, supplier pages | 578–580 KB (132–134 KB) | 89–104 KB (25–27 KB) |
| Hallkeeper sheet | 675 KB (164 KB) | 201 KB (60 KB) |
| Diary | 766 KB (188 KB) | 358 KB (99 KB) |
| Day Board | 697 KB (167 KB) | 286 KB (77 KB) |
| Dashboard | 960 KB (230 KB) | 594 KB (154 KB) |
| Craft quiz | 742 KB (178 KB) | 241 KB (66 KB) |
| Deferred Sentry chunk (every page with a DSN) | 437 KB JS (144 KB) | 77 KB JS (26 KB) |

Routes that load the shared contracts fell by 76–305 KB gzip, and the
shared Blueprint and living-hall chunks by 84 and 126 KB. Login, registration,
legal, pricing, leaflet and demo pages were already small and are unchanged.
The entry grows from 280 KB (92 KB gzip) to 307 KB (95 KB gzip) because it now
carries the site's self-hosted `@font-face` rules, which previously arrived as
a separate render-blocking stylesheet from Google.

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

## Second wave — the best invisible choices

Blake delegated the choices ("Do the best choices for max extreme
performance"). The standing founder mandate
(`docs/plan/16-SUBLIME-EXPERIENCE-AND-AUTONOMY-MANDATE-2026-09-04.md`) rules out
a lower-resolution canvas, blurred motion and visibly simpler furniture, so
every change here had to leave the image and behaviour unchanged. Each was
compared with the previous code by equivalence tests and, for 3D, by exact
RGBA comparisons in headless Chromium (SwiftShader). Six scoped agents did the
work in isolated worktrees; every commit was reviewed, integrated and
re-verified here.

### Measured and rejected
- **Fewer furniture triangles.** Error-bounded simplification removes under 5%
  of triangles at 0.5 mm, because normals and texture seams set the budget.
  Distance-based detail levels reach about 2× only at errors that are sub-pixel
  beyond roughly 20 m. The accepted models have no invisible reduction.
- **Instanced dinner covers.** One draw per part instead of 1,000, but glass,
  rim and cutlery share one per-object depth-sorted transparent list and one
  refraction backdrop: a five-InstancedMesh prototype changed 148–2,082 pixels
  per view (cutlery seen through glasses vanished). Not shipped.
- **Render resolution, MSAA and transmission glass**: unchanged (the mandate).
- **Font preloads**: Chrome treats them as render-blocking; first paint got
  later. Not shipped.
- **Room plans as lossless WebP**: identical pixels and 25% smaller, but the
  re-encode would drop each PNG's C2PA provenance manifest. Kept as PNG.
- **A Neon connect timeout**: in `@neondatabase/serverless` 0.10.4 a stalled
  WebSocket handshake with the pool timeout throws an uncaught TypeError that
  would end the API process. Not shipped; `db/client.ts` records why.

### Planner rendering (CPU and SwiftShader; no GPU in this container)

| Work | Before | After |
|---|---:|---:|
| Dinner covers, 20 tables × 10: geometries / materials | 1,000 / 1,000 | 5 / 5 |
| Select-all drag commit, dressed banquet | ≈24 ms | ≈7 ms |
| Renderer main-thread time per frame, dressed banquet | ≈28 ms | ≈15 ms |
| Drag-step commit, 1,287 items, desktop | 65 ms | 8.1 ms |
| Furniture layer per idle frame | 2.4 ms | ≈0 ms |
| Scene objects, 1,287-item banquet | 10,303 | 2,698 |
| Grand Hall overview, draws per frame | 330 | 115 |
| Grand Hall during a camera gesture, draws per frame | 354 | 115 |

- Dinner covers share one geometry and one material per part (same meshes,
  transforms and draw order) and are memoised: 0 changed pixels in six views.
- Editable furniture draws from pooled instance buffers: only moved items are
  recomposed and uploaded, and idle frames do no instance work. After identical
  drags all 121,680 drawn matrix values equal the previous path.
- Opaque Grand Hall ornaments draw as merged batches per surface and material.
  The original per-mesh tree still draws whenever a surface is blended (camera
  fades, clicked walls, x-ray) and on its first visible frame, so those states
  are pixel-identical. Transparent pieces and pieces flush against another
  material's face stay separate. At rest, 1–41 isolated edge pixels per
  1440 × 900 frame differ through float rounding of the baked vertices. The
  draw counts above were re-measured at the same pose on the integrated branch
  after T-630 made the window glass translucent (124 before it); the first
  measurement, 132 at rest and 145 during gestures, predates the final
  integration.
- The room shells stay mounted across camera gestures instead of being rebuilt
  after every orbit; the drawn shell no longer changes across a gesture (the
  remount changed up to 17 pixels), and ornament fades keep their first-load
  timing (the remount left them one frame behind the walls).
- Name plate textures are shared and kept for 5 s after the last plate
  unmounts, so gestures no longer redraw (150–200 ms each in software) and
  re-upload them.
- Fixed on the way: phantom `template-…` selection at the room origin;
  instanced furniture culled while on screen (culling is off for these
  room-spanning batches); instanced tables and chairs jumping 12 cm ahead of
  their linen and covers during the post-drag settle.

### Loading

| Measure | Before | After |
|---|---:|---:|
| `/diary` page code request starts (declared slow profile) | 2.33 s | 0.69 s |
| `/diary` visible | 3.37 s | 2.42 s |
| `/dashboard` visible | 3.38 s | 2.47 s |
| Returning guest `/plan`, planner shown (150 ms API) | 0.68–1.02 s | 0.39–0.43 s |
| `/` first paint, slow phone / desktop | 598 / 180 ms | 512 / 136 ms |
| `/quiz` intro transferred, desktop / phone | 5.41 / 5.92 MB | 1.38 / 2.11 MB |
| `/quiz` through to the result, desktop / phone | 11.2–11.6 / 11.1–11.8 MB | 7.66 / 8.46 MB |

- Guarded staff pages download their code while the account check runs; they
  still render and fetch only once authorised.
- The planner's tracked-draft lookups run together (the newest matching draft
  is still chosen), a guest's chosen draft is not fetched twice, and the room
  and venue reads start as soon as they are known.
- Fonts are Google Fonts' own files and rules served from this origin, with
  provenance and OFL licences in `packages/web/src/styles/fonts/`; nothing
  third-party stands before first paint. Eleven page states are
  pixel-identical. Browsers Google sent static single-weight fonts (Opera and
  Vivaldi on Windows, Yandex, Edge for Android, Firefox on Windows 7/8.1) now
  get the variable faces, which is the type as designed.
- Quiz crests, the armorial and inventory pictures come from display-sized
  WebP ladders (within 4 levels of exact resamples; sources kept). They differ
  from Chromium's own downscale of the large originals by 33–40 dB, a
  resampling difference rather than lost detail.

### API

| Measure (disposable PostgreSQL 16) | Before | After |
|---|---:|---:|
| Event phase graph, 3 phases of 300-object freezes | 488,824 B | 5,368 B |
| Linked-layout summaries, 5 layouts | 5 requests, 888,815 B | 1 request, 820 B |
| Venue dashboard, bytes read from PostgreSQL | 504,455 B | 4,652 B |
| Guest autosave with a 120 KB thumbnail, bytes read | 167,767 B | 46,827 B |
| Action-log flush, bytes read | 121,515 B | 472 B |

- Rate limiting is per verified user; it was per IP in practice, so an office
  shared 100 requests a minute. Forged and unknown tokens stay per IP. Limited
  requests answer 429 (they answered 500 and were reported as server errors).
- Access checks no longer read stored thumbnail data URLs; responses are
  byte-identical.
- The Diary tray asks for its open enquiries, newest first, for the board's
  venue, and says when more than 50 exist. Platform admins now see only that
  venue's enquiries on a venue's board.
- The web omits phase-snapshot payloads it never reads, batches linked-layout
  summaries (falling back to per-layout reads while an older API is live), and
  the dashboard's totals are computed in SQL.
- Migration 0071 adds `enquiries(configuration_id, created_at)` and
  `proposals(configuration_id)` indexes (additive, `IF NOT EXISTS`); the code
  does not depend on them.
- Pipeline and scenario totals above £1,000,000 no longer make the dashboard
  answer 500 (the single-amount ceiling was applied to sums).

## Remaining opportunities (ranked by expected impact)

1. **Furniture downloads.** Lossless meshopt compression saves 20–40% of each
   model and high-precision quantisation 41–70% (the bar: 12.1 → 3.7 MB) with
   no visible change, but it needs new asset versions, a registration
   migration and a check that harvesting handles quantised attributes.
2. **Device measurements.** No GPU was available: the planner results above
   are CPU and SwiftShader figures, and
   `packages/web/scripts/frame-budget-pass.mjs` still loads an empty room. A
   default banquet, a dressed banquet and a drag trace on the declared devices
   would measure the 60 fps target.
3. **Diary real-time fan-out**: every change makes every client refetch the
   calendar and enquiries.
4. **The homepage still ships the generated splat tile list** (45 KB gzip) to
   print eight labels and footprints; owned by the splat tasks.
5. **Smaller page items**: `/` also loads Inter because `RoomsHomePage` sits in
   `cockpitImport`; `/trades-house/leaflet` frames a page that still loads
   Google Fonts and full-size crests; `/demo` downloads 1.4–1.5 MP images for
   hidden slides; `WallTogglePanel`'s 313 KB image is never rendered.
6. **Signed-in planners** opening a claimed `/plan/<id>` first send a public
   request that returns 404; changing the endpoint is a product decision.
7. **A Neon driver upgrade** would allow a bounded connection timeout.
8. **Layout revision retention**: every save stores a full revision with no
   retention rule (a data-retention decision).

## Defects found in passing

Fixed: the quiz crash when Google Fonts was unreachable; `roomPosterUrl("__proto__")`
returning `Object.prototype`; the Diary tray showing the 20 least recently
updated enquiries of any state; phantom `template-…` selection; instanced
furniture culled while on screen; instanced furniture running ahead of its
linen and covers in the post-drag settle; rate-limited requests answering 500;
the dashboard answering 500 once a venue's quotes summed past £1,000,000.
Fixed afterwards at Blake's request: the window glass drawn opaque at rest
(T-630), a clicked-away wall replaying its disassembly after every camera
gesture (T-631), and the dashboard's Enquiries list showing only the 20 least
recently updated enquiries (T-632: newest first, paged, with a count and
migration 0072).

Not fixed (need a decision or are outside this change):
- At 390 px the dashboard's Enquiries page scrolls sideways by 152 px: the
  status tab row does not wrap (pre-existing, found during T-632).
- Frieze figures and the underlight strip run across the window openings,
  between the daylight backing and the glass, so they show through the glass
  (at rest since T-630, during fades before it). Clearing them from the
  openings changes the ornaments, so it is Blake's call.
- drei's bundled `index.cjs.js` carries an unpatched `setUpdateRange`; only the
  test environment loads it.

## Verification

On the integrated branch after both waves:

- Web: 514 test files (6,621 tests, 16 existing skips); workspace lint and
  typecheck (`pnpm -r lint`, `pnpm -r typecheck`) and the E2E typecheck;
  production build of every package (`pnpm build`). New regression tests fail
  against the previous code.
- Types: 100 test files (2,240 tests).
- API: unit suite (176 files, 2,960 tests; the 15 database-gated files run
  separately); `test:platform-db` (73 tests, including the batch-save
  comparison and the hot-path byte measurements) and `test:event-access-db`
  (53) on fully migrated disposable PostgreSQL 16; `pnpm audit` reports no
  known vulnerabilities.
- Production build, all 23 main routes loaded in Chromium: no module or
  runtime errors.
- Browser, first wave: homepage phone/desktop measurements above; quiz with
  Google Fonts blocked; hero preload and `srcset` as rendered.
- Production build in `vite preview` with mocked APIs (the E2E auth bypass
  build flag, Chromium with SwiftShader), so the `three`/`three-webgpu` split is
  exercised. Planner, tour, hallkeeper, quiz, landing, pricing and navigation
  specs: 105 of 109 pass and 1 is skipped on the final build. The 3 failures
  (`plan-room-resolve` cases A2) fail identically on the `master` build in this
  container. The first wave's run (98 of 109) also lost cases to this
  container's blocked Google font requests, which self-hosting removes.
- 3D equivalence: the second wave's pixel comparisons and equivalence tests
  are summarised in its section above; each was run against the previous
  implementation.

## Limits

- Not released: the push to `master` was refused by this session's permission
  system. After the push, CI is the first evidence; its required GPU job needs
  the operator workstation described in `.github/gpu/README.md`, and the
  Deploy workflow applies migration 0071 only after CI passes. Web and API
  deploy independently on that push; the web tolerates the previous API while
  the new one rolls out.
- No live check: this session's network policy blocks `venviewer.com` and
  `api.venviewer.com`, and the tools available cannot read Vercel or Railway
  deployment status.
- `CLERK_JWT_KEY` is optional and not set by this change. Compression was
  verified in-process, not through Railway.
- No GPU was available: 3D results are CPU, scene-inspection and SwiftShader
  measurements, not device frame times.
