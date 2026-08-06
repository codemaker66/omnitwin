# Reception Room local real-component quality preflight — 2026-07-16

Classification: INTERNAL. The screenshots contain venue imagery and local evidence paths. Do not publish this report or its evidence bundle without the normal redaction and rights review.

## Plain-English result

Yes, computer vision can compare the two Reception Room versions. A development-only review page loaded both candidates through the real Living Hall scene component, placed the same camera in the same six views, and captured lossless images.

The computer found meaningful differences in five views. The ceiling-only view did not contain enough reliable edges for this method, so it was marked **not assessable**, not passed. Running the comparison in the opposite direction produced the same overall result.

This proves that the versions look different. It does **not** prove which one is closer to the real room. That decision needs a trusted photograph or scan registered to the same camera, or a human review backed by such a reference.

## What was tested

The test used the development-only route `/dev/reception-quality-preflight`. The route is hard-coded to two named candidates and six named camera views; it does not accept an arbitrary asset URL.

| Candidate | Four named files loaded | Observed decoded total |
|---|---|---:|
| Quality SOG fine | `0_15_0_0.sog`, `0_1_0_5.sog`, `0_6_0_0.sog`, `0_7_0_0.sog` | 2,002,009 splats |
| Mobile SPZ fine | `0_13_0_0.spz`, `0_3_0_0.spz`, `0_7_0_1.spz`, `0_8_0_0.spz` | 1,978,258 splats |

The page observed all four sources and the expected decoded total for every capture. This does not re-hash the bytes served by the two local file servers, so it must not be described as a new byte-for-byte asset audit.

The six views were `overview`, `timber-left`, `timber-right`, `floor-surface`, `ceiling-moulding`, and `column-skirting`. They reuse the historical feature framings and one optical centre. They do not test an orbit or a moving camera.

## Controlled renderer settings

Every capture used profile `reception-fixed-fine-review-v1`:

- canvas device-pixel-ratio range 1–2; observed effective DPR was approximately 1;
- antialiasing off, high-performance power preference, sRGB output, ACES Filmic tone mapping, exposure 1;
- Spark maximum spherical-harmonic degree 3 and Spark LoD off;
- pre-blur 0, blur 0.3, radial sorting on, zero minimum sort interval;
- the remaining alpha, radius, focal, clipping, transparency, depth, and update settings were explicitly pinned in `reception-viewer-profile.ts` and copied into every sidecar.

These values are a controlled baseline. The test does not prove that pre-blur 0 and blur 0.3 are the best values.

## Capture integrity

The final evidence root is `output/playwright/reception-hd-real-component-2026-07-16`.

- 24 genuine lossless PNG files: two candidates × six views × two repeats;
- every image is 1200×900 RGB;
- 12 JSON sidecars record the route, candidate, renderer settings, exact camera matrices, loaded-source count, decoded splat total, and image hashes;
- all 12 repeat pairs were byte-for-byte identical after 500 ms;
- the seal-time audit reported 15/15 matching recorded environment entries. A fresh 2026-07-16 current-worktree check now finds 13/15: the listed capture/render/CV files still match except `pnpm-lock.yaml` and `packages/web/src/router.tsx`, both changed after the capture. The manifest is a selected capture-critical list, not a complete transitive-module inventory, so this is historical capture evidence rather than proof that today's whole app is bit-reproducible;
- no database, upload, production pointer, protected route, paid compute, or source asset was changed.

An earlier browser screenshot attempt was reported to have produced JPEG bytes despite a `.png` filename. Those discarded bytes and their rejection log/hash were not retained, so that historical incident cannot now be independently reverified. It was excluded from the metric set. What is independently checkable is that the 24 final files have the PNG signature, are 1200×900 eight-bit RGB images, and match their recorded hashes; the strict board renderer also refuses decoded input whose actual format is not PNG. The final run used Chrome DevTools `Page.captureScreenshot` explicitly requested as PNG.

Final receipts:

| Artifact | SHA-256 |
|---|---|
| `capture-manifest.json` | `e414ee58d64266c59bebfa23485f897c8c3472929853ec3b398e093ae43faf5b` |
| `cv-triage.json` | `9cc0af09bdc25fc004e34f1d0e741611f699145c81bf7e9e6be8befd7c58f15b` |
| Embedded CV report receipt | `55bf71044439e9ce15cb6d069f296a155ba5aa8b33f46b4ed34a87648a9143dc` |
| `pixel-metrics.json` | `d79443a4594d97fab25724acc97772159d41f09f6b0a1cc63e89a0863490caf3` |
| `cv-boards-current/index.json` | `006dddb62557244c49897382d4a893ca1885e15971380848cf52f1f075f80bb3` |
| Embedded board-index receipt | `52cf083c4cf21446defe000385d43dcc7ddd3f849432ff7f578b0908abc5886f` |

The seal-time independent re-verification reported 15/15 environment entries, 24/24 screenshots, 12/12 sidecars, 12/12 repeat pairs, all 12 CV inputs, the CV receipt and manifest binding, and all 12 rendered boards. The fresh current-worktree recheck still matches 24/24 screenshots, 12/12 sidecars and 12/12 repeat pairs, but only 13/15 recorded environment entries: `pnpm-lock.yaml` changed from 282,823 bytes / `a9aa8eb057a98849c1a9f7889c0e2c8a71a4448023c914a0a754680baddb5146` to 285,839 bytes / `767b459e11b52b8bc7fe17d5e5bf69fec3230f02618555e7eefb6aa6c01450c1`, and `packages/web/src/router.tsx` changed from 17,251 bytes / `6eebd7866b2f9f831f70c8c78b7c3cca4461ebfee0f7f43c33ec0ac2959199f8` to 18,038 bytes / `95c6020e9610e8cd6a89f9cbc6c0947544935c0d4a20d577ea9d0d4d1ba3fb0c`. These later changes do not alter the immutable screenshots, but an exact recapture must create a new environment receipt.

## Computer-vision result

The comparison was deliberately run in both directions because neither candidate is trusted physical truth.

| Direction | Review | Not assessable | Clear |
|---|---:|---:|---:|
| Quality as baseline → Mobile as candidate | 5 | 1 | 0 |
| Mobile as baseline → Quality as candidate | 5 | 1 | 0 |

The five assessable views raised missing-edge, extra-edge, nearby-parallel-edge, and gross-pixel-drift warnings. The ceiling view was not assessable because its baseline contained too few reliable edges. Visual inspection of the strict boards confirmed broad floor/ceiling appearance changes and local differences around timber doors, skirting, and columns.

Full-frame pairwise similarity ranges were:

- PSNR: 26.912251–29.773793 dB;
- SSIM: 0.941555–0.961395;
- mean absolute RGB error: 0.025317–0.040604 on normalized 8-bit sRGB values.

These numbers measure similarity between the two renders. A higher edge count, gradient value, PSNR, or SSIM is not automatically more real or more detailed. The metric file uses the canonical images; the separate capture manifest records the 12/12 zero-drift repeat check.

## Capture-era app verification

After an independent test found a renderer-telemetry update loop in the mocked Canvas, the state update was made idempotent and the same checks were rerun:

- focused Living Hall/profile/preflight tests: 59/59 passed;
- production bundle-splitting tests: 13/13 passed;
- TypeScript type-check: passed;
- targeted ESLint: passed;
- production Vite build: passed with a temporary process-only dummy live-format Clerk key used only to satisfy the build guard. The later production-origin hardening also requires a clean HTTPS `VITE_API_URL`; a current validation build must supply both values in the process only and must not write either one to an environment file.

The fresh production bundle contains no development review route, localhost file URL, local candidate ID, local-preflight chunk, or Reception splat file. `dist/splats/reception` is absent. At capture time the public Living Hall decision path still depended on fine-leaf filenames and hashes; the later hardening below moved that reviewed byte-profile receipt set out of the production browser bundle and public response. Separately authenticated administrator preview metadata can still contain exact receipts for private review. No local URLs or splat payload bytes are bundled.

### Runtime delivery safety added after the capture

The visual evidence above is unchanged, but the product delivery boundary was tightened before handoff:

- the exact reviewed byte-profile receipts for Reception asset IDs, original filenames, byte hashes, storage identities, hierarchy hash, and composition decision now remain in a server-only matcher and are absent from the public response and production bundle. These receipts prove byte membership, not anonymous presentation eligibility;
- the Quality SOG and Mobile SPZ byte profiles are both structurally blocked from anonymous presentation. Their immutable byte memberships are reviewed, but neither has an exact reviewed immutable presentation contract, so the public Living Hall currently receives neither profile and no anonymous member URL;
- the detailed legacy `runtime-packages/latest` response and direct asset-ID streams are platform-administrator-only; ordinary authenticated clients and planners cannot cross venue boundaries through them, and the legacy browser resolver now returns fallback instead of issuing unusable URL-mode requests;
- the older raw external-URL single-visual endpoint is retired for every room and always returns the safe fallback. A future presentation contract must bind the exact group transform, the exact camera policy and route, and the renderer-profile digest. The browser must receive and apply those reviewed values exactly instead of combining reviewed bytes with local presentation defaults;
- anonymous member URLs are built only from the clean, production-required `PUBLIC_API_ORIGIN`, never a request `Host`/forwarded-host header, and the Living Hall rejects a response whose origin differs from its configured API origin;
- reviewed member objects must live in a dedicated private R2 bucket reached with dedicated runtime-profile credentials. That configuration has no public-URL field, must be distinct from legacy upload and Foundry buckets, and has no fallback to their credentials or storage;
- any future public profile metadata and every member-byte request must independently require the room showcase switch, an exact reviewed byte identity plus its exact reviewed presentation contract, published state, human-reviewed public QA, and its linked signed transform;
- QA and transform rows must name the exact same package, venue, and room being released. `approved_public` is valid only when every required QA check is present and has status `passed`; `failed`, `blocked`, `not_checked`, or `requires_human_review` on any required check fails closed. The QA record binds the exact transform-content SHA-256, and transform-artifact and QA-record IDs are immutable: only byte-for-byte/field-for-field retries may reuse an ID;
- every cache miss reads the complete private object and verifies its registered byte count and SHA-256 before caching or returning bytes; a changed, truncated, oversized, or substituted object fails closed. A per-process verified-byte LRU is limited to 64 MiB, 16 entries and five minutes, and single-flight shares one identical-content verification without sharing authorization. Cached or newly read bytes are still subject to a fresh package/QA/transform/member authorization immediately before send;
- each API process permits two active verified-response buffers and a FIFO queue of at most 16 waiters. A waiter can be cancelled, waits at most five minutes, and otherwise receives HTTP 429 with `Retry-After: 1`. Each member is limited to 16 MiB and each upstream fetch to 30 seconds. A separate absolute 180-second response/transfer deadline aborts upstream work and destroys a stalled response. A slot is released only after both handler work has settled and Node reports—or the deadline forces—the response to finish or close;
- the anonymous member route is limited to 24 requests per minute per client IP. This process/route limit is not a substitute for edge rate limiting or WAF controls against distributed traffic;
- authenticated exact-package preview can still receive a server-reviewed Quality or Mobile byte-profile label and protected streams; this does not make either profile anonymously presentable. Its byte route now registers disconnect handling before the database/package lookup, so a client that leaves during lookup cannot later acquire or strand a verified-transfer slot. Its administrator-only metadata remains separate from the public Living Hall contract, and the production browser bundle no longer contains the private allowlist constants.

Reception's `publicShowcaseEnabled` setting remains `false`; independently, both reviewed byte profiles are also presentation-ineligible, so the public profile response is `null` and every anonymous member request returns no bytes. This is a local code hardening result only: no immutable presentation contract, migration, deployment, registration, public pointer, QA approval, transform approval, storage provisioning/copy, or release state was created. External activation additionally requires reviewing and binding the exact group transform, camera policy/route and renderer-profile digest; making the browser apply them exactly; provisioning the dedicated private bucket and least-privilege credentials; copying and byte-verifying the exact reviewed objects; proving direct anonymous/public bucket access is denied; and installing edge rate-limit/WAF controls before the showcase switch can be considered.

## What remains before a quality decision

1. Register a held-out real photograph or independently trusted scan to the same camera, then score both candidates against it.
2. Add spatially different near, middle, far, and orbit views; record a moving-camera sequence instead of only still frames.
3. Measure load time, frame rate, visual settling, and GPU memory on named desktop and mobile devices.
4. After separate approval for migrations, registration, deployment, and authenticated streaming, repeat the same evidence protocol through the protected product route.
5. Treat any blur/pre-blur alternative as a new controlled candidate and rerun the same cameras; do not tune by eye on the acceptance images.

Until those steps are complete, the correct decision is: **computer vision verified a real pairwise difference, but no physically supported quality winner exists.**
