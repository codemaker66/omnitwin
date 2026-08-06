# Reception Photo Capture Quality Workbench V0

## Outcome

T-532 adds a usable local pre-registration action to Reconstruction Foundry:
choose the build, held-out and ignored roles for receipt-verified JPEG/PNG
captures, decode the real pixels sequentially, and receive a contact sheet with
capture-quality warnings and explicit retake guidance.

This is a separate workbench and report layer. It is not Source Facts V9, does
not reconstruct the room, and does not claim recovered detail or quality gain.
Cybersecurity, identity attestation, credentials, signing, cloud deployment and
publication are outside this slice.

## Frozen contract

- Report schema: `omnitwin.foundry.photo-capture-quality-report.v0`.
- Protocol: the existing 18-build/12-held-out naming split in
  `docs/reports/reception-room-30-photo-capture-checklist.md`.
- Eligible files: receipt-verified JPEG and PNG only.
- Pixel checks: source megapixels, luminance distribution, shadow/highlight
  clipping, Tenengrad edge energy, mean RGB colour and 64-bit difference hash.
- Integrity checks: complete assignment coverage, protocol-slot coverage,
  duplicate slots, wrong-role slots, unmatched assigned paths, RAW counterpart
  presence and possible within-role/cross-role near duplicates.
- Processing: bounded, sequential and cancellable. The worker re-reads exact
  bytes through one file handle and verifies byte count and SHA-256 against the
  intake receipt before accepting pixels.
- Output: canonical self-digested JSON plus digest-bound 360×240 WebP previews
  retained in memory only. Originals are not modified.

Held-out pixels are decoded only for their own capture-integrity and possible
split-leakage checks. This action does not use them to build, tune or choose a
model.

## Product surface

The loopback app now exposes:

- live 18/12/ignored assignment counts;
- unique accessible role labels for every photo;
- start, status, cancel, report and thumbnail routes bound to the local session,
  request and digest;
- progress with a monotonic run revision so late responses cannot roll the UI
  backward;
- a responsive contact sheet with per-photo metrics, warnings and untouched-
  original guidance;
- explicit missing, duplicate, wrong-role and unmatched-path protocol repair
  lists;
- named filename pairs for possible near duplicates or held-out leakage;
- fail-closed Stop behavior: the app remains open if a worker does not confirm
  settlement.

## Controlled fixture result

The exercised UI used four exact copies of existing repository web photographs,
renamed into two build and two held-out slots. It is implementation evidence,
not the real Reception capture.

The receipt is
`c2fa8ff29d8f1c85cad50c1152ffc7aedcfca8113aba1b20b8d3bcc671c7ca5f`.
The completed report is
`fd961c22a975326f792656682c166c0f0819f67d09e57aefdb391b9bc089c4ac`.
It truthfully reports:

- 2 build, 2 held-out and 0 ignored;
- 16 missing build slots and 10 missing held-out slots;
- 0 unmatched assigned paths and 0 similarity findings;
- 4 retake verdicts because every fixture image is below the frozen 8 MP pilot
  minimum and has no matching RAW counterpart; two also trigger the frozen
  shadow-clipping heuristic;
- `authority:none`, `externalRequests:0` and `originalsModified:false`.

These fixture verdicts say nothing about the actual Reception 30-photo set.

## Verification

- Core package: 62 files passed; 741 tests passed; 1 skipped. Lint, typecheck
  and build passed.
- Local app/CLI package: 39 files passed; 1 skipped; 635 tests passed; 1 todo.
  Lint and typecheck passed.
- Focused photo contract/worker: 8/8.
- Focused browser assets, controller, HTTP and existing lifecycle regression:
  51/51 across five files.
- Desktop in-app Browser: four WebP thumbnails, protocol gaps and retake cards
  rendered without a console warning/error.
- Mobile 390×844: one-column contact cards, no horizontal overflow; client and
  document scroll width both 375 px.
- Fresh-tab recovery: all four submitted roles returned correctly and remained
  locked on the completed run.

Exact evidence and screenshot hashes are in
`docs/reports/reception-room-photo-capture-quality-workbench-v0-evidence-2026-07-18.json`.

## Truth boundary and next real input

`pass` means only that no frozen heuristic fired. `capture_quality_ready` means
ready to attempt a later registration test; it is not registration success,
approval, physical accuracy or release authority. Blur, clipping and colour
outlier labels remain deterministic triage observations requiring human review
of the untouched originals.

To evaluate the real capture, provide an owned local folder containing the 18
build and 12 held-out JPEG/PNG photographs named by the existing checklist,
plus matching untouched RAW files or an explicit capture-session note for each
missing RAW counterpart. No cybersecurity prompt or trusted-access application
is needed for that local continuation.
