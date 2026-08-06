# Reception Room Envelope Review and Fit-Seed Workbench V0

## Outcome

T-533 adds the missing local operator step between the exact Reception Potree
V8 diagnostics and a later E57 fit-only experiment. It lets an operator review
all three point projections, choose the projection they consider horizontal,
draw a simple room outline in intrinsic 1024×1024 pixels and produce a
digest-bound `authority:none` review artifact.

This is ordinary local reconstruction-product work. Cybersecurity, identity
attestation, credentials, signing, cloud deployment and publication are not
requirements or blockers for this slice. Purpose-scoped rights, a human room
review, held-back validation and independent survey control remain separate
non-cybersecurity gates.

## Frozen artifact and mapping

- Schema: `omnitwin.foundry.room-envelope-review.v0`.
- Digest domain: `OMNITWIN_FOUNDRY_ROOM_ENVELOPE_REVIEW_V0` plus one NUL byte
  and canonical JSON without `reportSha256`.
- Source binding: exact intake receipt, V8 Source Facts, Potree bundle and all
  three metadata/hierarchy/octree member identities.
- Review binding: one exact preview per canonical component pair, in canonical
  order, with PNG and pixel digests.
- Polygon: 3–64 unique integer vertices in intrinsic `[0,1023]²`; degenerate,
  duplicate and self-intersecting outlines are rejected.
- Mapping: the exact V8 observed-extrema, uniform-fit, 32-pixel-margin and
  vertically inverted raster equation. The artifact records both the operator
  pixel vertices and their inverse-mapped decoder-coordinate vertices.
- Selection evidence: exact included/excluded record counts and selected 3D
  decoder-coordinate bounds, derived by rereading the unchanged 14-byte point
  records.
- Eligibility: only an explicit `accepted_as_fit_seed` decision with at least
  512 selected records can become `eligible_for_fit_only_diagnostic`.

The mapping does not establish units, axis meaning, room identity, handedness,
physical accuracy, completeness or a venue transform. A polygon in the raster
margin may inverse-map outside the observed point extrema; selected point
bounds may not.

## Read-only worker boundary

The worker accepts no browser-supplied source path. It receives the already
inspected local source from the trusted app process, resolves each exact bundle
member below that directory, rejects symlinks/path escape and rereads every
member through a stable file handle. Size and SHA-256 must still match both the
receipt and V7/V8 evidence. Source buffers are wiped after use and the original
files are never modified.

Every point is mapped to the same intrinsic pixel used by the V8 diagnostic.
Boundary pixels count as inside. The worker is cancellable and has a 30-second
local pass limit.

## Real Reception engineering probe

The unchanged real source at
`F:/gaussian splat -- xgrids/model/Reception_Room_2026-06-01-150618/project_data/model`
was replayed through the new worker with an automated full-frame polygon. This
was an engineering probe, not the requested human room outline.

- Receipt: `40ea026b5f70798a19b28a0f20089424128343f1713aba09325b5251bb1d4320`.
- V8 facts: `29da55f12cbe20d519ce33a1901242ca073f06059cb1b5731eb1216b17e4706d`.
- Bundle: `f226739d3f8e94605b8c363a1b135986388b5cf920df0194ff960bfed5940fb2`.
- Review artifact: `1721c64993fe9a90c9c4ef4e1d5b438d5bb65880235bdd747feea4beedfbc209`.
- Records inside/outside: 175,237 / 0.
- Decision/eligibility: `needs_revision` / `not_eligible`.

The canonical artifact is
`docs/reports/reception-room-envelope-review-proposal-v0-2026-07-19.json`.
It deliberately cannot authorize fitting.

## Fit-only E57 boundary

The downstream consumer is a separate action from validation. Its production
adapter may request only the frozen fit scan IDs. Validation scans 131, 134 and
138, frozen test scans 126, 129 and 141, and quarantined scans 122, 123 and 140
remain outside that process. It verifies the review digest, exact Reception
bundle members, decision, eligibility, mapping, polygon and selected counts
before any fit. A crop margin is a consumer input recorded in its own receipt,
not hidden operator-review content.

The consumer may compare proper and mirrored candidates, crop fit samples,
refit and emit either an authority-none diagnostic candidate or an explicit
refusal. It does not create or approve a TransformArtifact and cannot establish
validation success, independent control or physical accuracy.

## Verification

- Core room-review contract and worker: 5/5 focused tests passed.
- Local app/API/UI regression: 66/66 focused tests passed across the room
  review, V8 asset, V8 controller and existing local-app lifecycle files.
- Full core package: 63 files passed; 754 tests passed and 1 skipped.
- Full local-app/CLI package: 43 files passed; 680 tests passed.
- Core and local-app package lint and typecheck passed. The core build passed.
  The local-app package's existing build-only sibling-source `rootDir` problem
  remains, together with an unrelated trusted-Windows helper-bridge build
  error; the normal no-emit typecheck is clean.
- Fit-only Python consumer: 8/8 adversarial tests passed; Python compilation
  passed. The existing combined diagnostic regression passed 12 tests with one
  expected Windows symlink-privilege skip.
- The real proposal matches the exact mounted Reception bundle, then fails the
  accepted-only Python gate as `ROOM_ENVELOPE_REVIEW_NOT_ACCEPTED` before E57
  access or output.
- In-app Browser QA against the real loopback app marked all three exact record-
  density previews, selected components 0–1 as the proposed horizontal plane,
  stored a conservative full-frame review and observed 175,237 inside / 0
  outside, `not_eligible` and `authority:none`. Its session-only review digest
  was `031b9b5cbad49b9e8fd1e16d6c3f34fb73486401db2dd4ee74be819220f9eaab`.
- Desktop 1440×1000 and mobile 390×844 layouts were inspected. At mobile size,
  document `scrollWidth` and `clientWidth` were both 375, and the browser log
  contained zero warnings or errors. The new desktop surface was also compared
  with the accepted V8 diagnostic design capture for typography, cream/teal
  palette, borders, spacing and responsive collapse.
- The local listener closed after the check. Source bytes were not changed.

Browser evidence:

- `docs/reports/evidence/local-foundry-room-envelope-review-v0-desktop-2026-07-19.png`
- `docs/reports/evidence/local-foundry-room-envelope-review-v0-mobile-2026-07-19.png`

No full fit-only run against the 20.5 GB Reception E57 was attempted. That is
deliberately deferred until a human supplies an accepted eligible envelope.

## Current status and operator input

The implementation and real read-only proposal probe are usable, but T-533
remains in progress because no human has drawn and accepted the actual room
envelope. The next required input is approximately 10–20 minutes of operator
review in the local screen: inspect all three projections, identify the
horizontal one, draw the Reception room boundary, enter a reviewer label and
choose **Accept as fit seed** only if the outline is genuinely correct.

That acceptance would permit a separate fit-only diagnostic. It would not
close the later rights, validation, independent-control or qualified transform-
review gates.
