# Grand Hall T-554 local scope-acceptance runbook

Date: 2026-08-26
Status: **v1 50/98 acceptance stopped; T-561 unified successor available; human review still pending**
Task: T-554
Authority before a qualified reviewer completes this workflow: **none**

This workflow turns complete, qualified human decisions into four derived
scope artifacts and one self-contained local evidence bundle. It does not
decide what belongs to the Grand Hall, author a selection volume, draw a
panorama mask, infer a doorway, or repair source geometry. It also does not
authorize reconstruction, runtime admission, staging, deployment, public
publication, production trust, or generated fill.

**Do not run the preserved v1 `accept` workflow.** Its 50-candidate/98-other
review split is now known to be incomplete and is superseded for acceptance.
T-561 delivered a separately versioned successor with one unified 148-row
human-pending decision surface. The v1 artifacts and hashes remain historical,
authority-none evidence and must not be edited, replaced, or relabelled.
Use [`grand-hall-t554-review-pack-v2-runbook.md`](./grand-hall-t554-review-pack-v2-runbook.md)
for the successor workflow.

The commands are intentionally fail-closed. Any `UNSURE`, an unreviewed one of
the 148 supplied panoramas, rejected MatterPak room 9, unresolved `Window` or
`Mirror` source cleanup handling, an empty or convex volume, an invented source
identity, a missing or changed mask, a changed source JPEG, a malformed mask,
an incomplete interface inventory, or an existing output path stops accepted
bundle creation.

## Stop conditions

Do not run the `accept` command while any of these statements is false:

- a venue owner or authorized domain reviewer has explicitly accepted exact
  MatterPak room 9 as the Grand Hall;
- the reviewer has inspected the source-bound `Window` and `Mirror` cleanup
  handling and accepted each only as scope handling with **no architectural
  authority**;
- the reviewer has personally dispositioned all 148 supplied panorama JPEGs
  through the completed T-561 successor, without using the preserved v1 50/98
  split as eligibility authority;
- the successor keeps agent observations separate from human decisions. An
  agent-positive observation is not `INCLUDE`, and `no Grand Hall pixels
  observed` is not `EXCLUDE` or `measured_empty`;
- all eight exact interface candidates have a human disposition;
- the reviewer has not accepted the diagnostic panorama-to-E57 sequence as
  camera geometry, pose, or correspondence;
- the reviewer has not accepted a T-560 machine content-match candidate as
  camera geometry, pose, room membership, or correspondence authority;
- a qualified operator has authored a source-evidence-derived, non-convex,
  closed selection volume in MatterPak/E57 `CVF` metres;
- a qualified reviewer has inspected and accepted that volume only as an
  invisible selection boundary;
- every included panorama has one reviewed mask on its exact original
  8192x4096 source grid;
- `nativeResolutionHumanReviewCompleted` is `true` in the future accepted
  successor only after that qualified human review. It is currently `false`;
- each reviewed mask is bound in the decision record by its exact SHA-256,
  byte length, included-pixel count, and excluded-pixel count;
- every mask contains only grayscale values `0` and `255`, where `0` means
  included and `255` means excluded;
- no mask, volume, or decision invents a window, doorway, floor, neighbouring
  room, facade, architectural repair, or generated replacement content; and
- all 148 exact source panoramas still exist at their bound byte identities.

If any item is unresolved, keep `finalDecision` as `PENDING`, keep unresolved
results as `UNSURE`, and stop. A reviewer may instead record a coherent
`human_rejected` / `REJECT` outcome. A rejection publishes no accepted bundle
and halts the dependent pipeline. Pending templates and preparation outputs
grant no authority.

## Step 1 - Create a new review workspace

Open PowerShell. Copy and run these lines one at a time:

```powershell
Set-Location 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'
$reviewPack = Join-Path (Get-Location) 'docs\operations\grand-hall-t554-review-pack'
$panoramaRoot = 'F:\downloads (some very important)\TH Panoramic'
$reviewWork = 'D:\grand-hall-t554-human-review'
Test-Path -LiteralPath $reviewWork
```

The final line must print `False`. If it prints `True`, choose a different new
path. Then create the parent directory:

```powershell
New-Item -ItemType Directory -Path $reviewWork | Out-Null
$templateOut = Join-Path $reviewWork 'pending-template'
Test-Path -LiteralPath $templateOut
```

The final line must again print `False`. The tooling requires the parent to
exist, but it refuses to replace the output path itself.

### Create the separate all-source panorama review supplement

The verifier-bound evidence payloads in the checked-in
`grand-hall-t554-review-pack` are immutable. A real, authority-none supplement
for the other 98 source panoramas is checked in at the sibling path below. Its
eight files comprise seven review pages plus one manifest. It has already
passed exact regeneration against the supplied 148-file source directory:

```powershell
$inventoryReview = Join-Path (Get-Location) 'docs\operations\grand-hall-t554-panorama-inventory-review'
Test-Path -LiteralPath $inventoryReview
```

The final line should print `True`. Recheck it without writing anything:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-panorama-inventory-review -- --check --panorama-root "$panoramaRoot" --candidate-review-pack (Join-Path $reviewPack 'panoramas') --output "$inventoryReview"
```

The result must report `checked_exact_regeneration`, 98 source records,
`pageCount: 7`, `outputFileCount: 8`, `authority: "none"`, and
`exactRegenerationVerified: true`. Its manifest digest is
`sha256:fd1c53ef54db0ab3c34d1fc879ce22ce9a8c9947bc7aca1ade311ebe77d468a0`.
It does not change eligibility, infer room membership, or accept a panorama.

A later all-source audit supersedes that contact-sheet interpretation. At the
model's 2048x1024 display resolution, authority-none agents observed Grand Hall pixels in
sweeps 001–061, 065–075, and 148–149 (74 exact source files), and observed no
Grand Hall pixels in sweeps 062–064, 076–092, and 094–147 (74 exact source
files). Numeric sweep 093 is absent from the exact 148-file inventory; it is
not an unresolved source. The agent audit flagged no classification
uncertainty, but it did not complete native 8192x4096 human inspection:
`nativeResolutionHumanReviewCompleted=false`. These observations have
`authority: none`; they are not final venue-owner decisions, pixel masks,
camera-location classifications, or E57 scan mappings.

The finding permanently stops the preserved v1 50/98 acceptance path. Do not
continue from this supplement to v1 masks or `accept`. Wait for the separately
versioned T-561 successor, then have an authorized venue reviewer inspect all
148 exact originals and every included source's exact native-grid mask.

To exercise generation itself, use a different absent sibling under
`$reviewWork`; never overwrite the checked-in supplement or place output
inside `$reviewPack`.

## Step 2 - Generate blank, authority-none templates

Run:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-acceptance -- template --review-pack "$reviewPack" --out "$templateOut"
```

The preserved v1 command writes only:

- `human-decisions.json` - exact room 9, `Window`, `Mirror`, the historical 50
  candidate panorama rows, 98 other panorama rows, and eight interface rows,
  all unresolved; and
- `closed-selection-volume.json` - an empty, human-pending volume review.

The result must report `state: "generated_human_pending_template"`,
`finalDecision: "PENDING"`, and `authority: "none"`. Template generation is
not acceptance and creates no geometry or mask. This historical v1 template
cannot be promoted to acceptance after the T-561 finding.

An exact generated copy is also checked in at
[`grand-hall-t554-acceptance-template`](./grand-hall-t554-acceptance-template/).
It binds review-pack digest
`sha256:8a6bef9c3b9e5c27e4c1f62994d7d8d01a82b4afee9515d39f2513c36dcac3aa`.
Use the command above for a fresh working copy; do not edit the checked-in
template.

Create separate working files so the blank template remains intact:

```powershell
$reviewed = Join-Path $reviewWork 'reviewed'
$maskRoot = Join-Path $reviewed 'masks'
New-Item -ItemType Directory -Path $reviewed | Out-Null
New-Item -ItemType Directory -Path $maskRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $templateOut 'human-decisions.json') -Destination (Join-Path $reviewed 'human-decisions-pre-bind.json')
Copy-Item -LiteralPath (Join-Path $templateOut 'closed-selection-volume.json') -Destination (Join-Path $reviewed 'closed-selection-volume.json')
```

## Step 3 - Historical v1 decision instructions; do not use for acceptance

The instructions below document the preserved v1 format only. They cannot
produce an accepted result. The T-561 successor must replace the split
candidate/non-candidate structure with one unified 148-row human decision
surface before qualified review resumes.

Use the [review pack](./grand-hall-t554-review-pack/README.md), its
[blank checklist](./grand-hall-t554-review-pack/REVIEW-CHECKLIST.md), the 148
exact source JPEGs, and the
[bound T-551 source evidence](./grand-hall-room9-source-boundary-evidence-v1.json)
as review aids. Inspect the supplied source OBJ as needed. If these materials
are insufficient to judge room identity or cleanup handling, stop and request
a better evidence view. The formal record is `human-decisions-pre-bind.json`;
the Markdown checklist is not an acceptance artifact.

Do not edit copied identities, hashes, byte lengths, dimensions, sweep
numbers, interface identities, source-vertex hashes, or bounds.

The authorized human reviewer must:

1. Review MatterPak room 9 itself. Use `ACCEPT_AS_GRAND_HALL` only if it is the
   intended room, and write a concrete evidence note. Otherwise use
   `REJECT_AS_GRAND_HALL` and stop.
2. Review the exact source handling labelled `Window` and `Mirror`. For each,
   use `ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY` only when the
   evidence supports it. The class label is not proof that a real window or
   mirror exists. Write a concrete evidence note. Use
   `REJECT_SOURCE_SCOPE_HANDLING` and stop if the evidence does not support it.
3. Inspect each of the 50 candidate panoramas and resolve it as `INCLUDE` or
   `EXCLUDE`. No `UNSURE` may remain for acceptance.
4. Inspect each of the 98 `nonCandidatePanoramaDecisions` entries against its
   exact JPEG. Use `EXCLUDE_OUTSIDE_GRAND_HALL` only after confirming that
   frame contains no Grand Hall evidence. If any might contain Grand Hall
   evidence, use `GRAND_HALL_EVIDENCE_FOUND_REVIEW_SET_INCOMPLETE` and stop so
   the review set can be corrected. Never force that frame into an exclusion.
5. Classify an included candidate as `grand_hall_core` or
   `grand_hall_portal_threshold`. Give it one unique forward-slash-relative
   PNG filename, record applicable reason codes, and write a concrete note.
   Leave `reviewedMaskBinding` as `null` and `maskReviewed` as `false` until
   Step 6 binds and the human visually reviews the exact mask bytes.
6. Classify a whole-frame candidate exclusion only as
   `adjacent_room_or_outside_grand_hall`; do not attach a mask to it.
7. Resolve every interface with exactly one of
   `CLOSE_AT_REVIEWED_GRAND_HALL_PLANE`, `EXCLUDE_BEYOND_INTERFACE`, or
   `NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT`. Write a concrete evidence note.
   Shared topology alone is not proof of a doorway.
8. Keep `geometricCameraAuthority` as `none`, `generatedFillPermitted` as
   `false`, `reviewState` as `human_pending`, `finalDecision` as `PENDING`, and
   `reviewer` as `null` during preparation.

Permitted mask reason codes are:

- `adjacent_room_pixels`
- `portal_beyond_grand_hall_plane`
- `facade_or_exterior_pixels`
- `capture_artifact_outside_verified_room`
- `unverified_or_unknown_pixels`

An all-zero mask is valid when human review finds every pixel belongs to the
Grand Hall. It has no exclusion reason. If the whole frame is outside the Grand
Hall, use `EXCLUDE`; do not submit an all-255 included mask.

## Step 4 - Author and review the invisible closed volume

The command cannot derive trustworthy volume coordinates. A qualified human
or geometry operator must derive them from reviewed MatterPak/E57 evidence and
record them in the working `closed-selection-volume.json`.

Only edit the human-review fields, `footprintXY`, `zMin`, `zMax`, and the note.
The footprint must be a simple, non-self-intersecting, counter-clockwise,
non-convex polygon in `CVF` metres. Do not repeat the first vertex at the end,
do not repeat any vertex, and retain at least one reviewed reflex vertex.
`zMax` must be greater than `zMin`.

Keep all fixed safety fields unchanged:

- `geometryRole: "non_rendered_selection_volume"`
- `rendered: false`
- `collisionGeometry: false`
- `exportedAsArchitecture: false`
- `generatedGeometryCreated: false`

After the qualified reviewer inspects the final volume against source
evidence, set its reviewer record, `reviewState` to `human_accepted`, and
`finalDecision` to `ACCEPT`. The volume remains a selection tool, not a wall,
floor, cap, collision mesh, or architectural export.

## Step 5 - Prepare exact panorama masks

Create one PNG under `$maskRoot` for every candidate marked `INCLUDE`, and no
PNG for any whole-frame exclusion. The relative path must exactly match that
candidate's `maskFileName`. The mask directory must contain only those masks.

Every mask must be:

- exactly 8192x4096 pixels on the original equirectangular grid;
- 8-bit, one-channel grayscale PNG with no alpha;
- binary: only `0` for included and `255` for excluded;
- not cropped, resized, resampled, rotated, seam-shifted, or reprojected;
- stripped of colour profiles, EXIF orientation, and ancillary metadata; and
- visually inspected against the exact bound source JPEG at original
  resolution.

Excluded and unknown pixels remain transparent or unknown downstream. Never
inpaint, generatively replace, colour-grade, or fill them.

## Step 6 - Historical v1 mask binding; do not run for acceptance

The preparation command validates the exact mask inventory and PNG pixels,
then copies each included mask's SHA-256, byte length, included-pixel count,
and excluded-pixel count into `human-decisions.json` inside a **new**
no-replace output directory. It does not perform human review and deliberately
leaves `maskReviewed: false`, `reviewState: "human_pending"`, and
`finalDecision: "PENDING"`.

```powershell
$preBindDecisions = Join-Path $reviewed 'human-decisions-pre-bind.json'
$boundOut = Join-Path $reviewed 'mask-bound-pending'
Test-Path -LiteralPath $boundOut
```

The final line must print `False`. Then run:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-acceptance -- bind-masks --decisions "$preBindDecisions" --mask-root "$maskRoot" --out "$boundOut"
```

The result must report
`state: "exact_mask_evidence_bound_human_review_still_pending"`,
`authority: "none"`, and `finalDecision: "PENDING"`. If no candidate is
resolved as `INCLUDE`, stop and investigate the membership review rather than
inventing a mask.

For every included panorama, the authorized human must now open the exact mask
file represented by that binding beside the exact source JPEG at original
resolution. Only after that visual check, copy the bound pending document to a
new final file, set each included row's `maskReviewed` to `true`, add the
reviewer record, and set `reviewState` to `human_accepted` and `finalDecision`
to `ACCEPT`.

```powershell
$boundDecisions = Join-Path $boundOut 'human-decisions.json'
$decisions = Join-Path $reviewed 'human-decisions.json'
Test-Path -LiteralPath $decisions
Copy-Item -LiteralPath $boundDecisions -Destination $decisions
```

The `Test-Path` line must print `False` before the copy. Do not recompress,
replace, rename, or edit a mask after binding. If any mask changes, rerun
`bind-masks` into a fresh output directory and repeat the visual review. Do not
guess or hand-copy a hash, byte length, or pixel count.

## Step 7 - Preserved v1 acceptance gate; do not run

The command below is retained for historical reproducibility only. Its v1
50/98 inputs are superseded, so running it cannot satisfy T-554. No T-561
successor command or final artifact hash is documented yet.

Set the final paths and choose a new output directory:

```powershell
$volume = Join-Path $reviewed 'closed-selection-volume.json'
$acceptedOut = Join-Path $reviewWork 'accepted-scope-v1'
Test-Path -LiteralPath $acceptedOut
```

The final line must print `False`. The output must not overlap the review pack,
panorama root, decisions file, volume file, or mask root. Then run:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-acceptance -- accept --review-pack "$reviewPack" --panorama-root "$panoramaRoot" --decisions "$decisions" --volume "$volume" --mask-root "$maskRoot" --out "$acceptedOut"
```

The command re-verifies the immutable review pack, hashes and fully decodes all
148 exact source JPEGs, hashes and decodes every required mask, compares every
mask to its human-reviewed hash/length/count binding, checks all formal human
decisions and the reviewed closed volume, and reserves a new no-replace output
directory.

A complete local bundle contains:

- `room-membership.json`
- `interface-decisions.json`
- `closed-selection-volume.json`
- `panorama-mask-set.json`
- `review-pack.json`
- `review/human-decisions.json`
- `review/closed-selection-volume-review.json`
- every exact reviewed mask PNG at its bound relative path; and
- `publication-receipt.json`, written last.

This is receipt-last, no-replace local output, not a claim of filesystem-wide
atomicity. An interrupted output may exist with only some payloads. It grants
no authority unless `publication-receipt.json` exists, reports a `state` of
`"complete"`, and inventories the preserved payloads. Never reuse or overwrite
an incomplete or complete output path.

`interface-decisions.json` retains the legacy-named portal-decision schema, but
the file and review language remain neutral: the eight source interfaces are
not presumed to be doors or portals.

The command result and receipt must still report:

- `productionTrust: null`
- `runtimeAdmissionAuthorized: false`
- `reconstructionAuthorized: false`

`authority: "human_accepted"` applies only to the reviewed T-554 scope
evidence. It does not turn the unverified panorama-to-E57 sequence hypothesis
or any T-560 machine candidate into camera geometry or correspondence,
authorize an LCC run, create a T-557 transform/output mask, admit a T-556
candidate, or permit staging.

## If a command stops

Do not edit source identities, digests, dimensions, decoded pixel counts, or
safety fields merely to make an error disappear. Correct the underlying human
input or mask, choose a fresh output path, and run the appropriate preparation
or acceptance command again. Preserve failed inputs when failure could indicate
source drift.

Common safe outcomes are:

- `UNSURE` or `PENDING`: finish qualified human review;
- `REJECT`: stop the dependent pipeline; do not run `accept`;
- room 9 or cleanup rejection: investigate the source evidence and stop;
- `GRAND_HALL_EVIDENCE_FOUND_REVIEW_SET_INCOMPLETE`: rebuild the panorama
  review set before acceptance;
- source JPEG mismatch: stop and investigate the supplied source root;
- mask binding mismatch: preserve the changed file, bind a fresh copy, and
  repeat human review;
- mask format or pixel mismatch: regenerate from the exact source grid without
  resampling or metadata;
- invalid volume: have the geometry reviewer correct and re-review it;
- output exists: choose a new output path; never overwrite evidence;
- output without `publication-receipt.json`: treat it as incomplete, preserve
  it for inspection, and choose a new output path; and
- path overlap, link, or identity-change error: move the working evidence to
  separate ordinary files/directories and investigate the filesystem state.

If the CLI says the bundle may already be committed but its terminal JSON could
not be printed, inspect the named output. The receipt, not terminal display, is
the local completion marker.

## What happens after a genuine successor T-554 acceptance

This section applies only after genuine human acceptance through the completed
authority-none T-561 successor. The
preserved v1 50/98 command cannot produce a genuine acceptance.

Stop after preserving the self-contained local bundle and reported digests.
T-554 acceptance still does not authorize staging or runtime use.

T-555 separately requires eligible hardware and reviewed LCC Creator Data /
NVIDIA nCore settings. T-557 then requires real inspectable LCC output, a
human-reviewed ARF-to-CVF registration, and a bit-exact mask against the exact
ordered output inventory. T-556 owns the source-faithful candidate bake-off,
and T-558 must byte-verify and cross-bind all concrete evidence through the
API/intake admission boundary before any non-null trust root can be considered.

No API key, cloud credential, Railway environment, R2 bucket, database, Clerk
token, browser session, or deployment permission is needed or used in this
local T-554 workflow.
