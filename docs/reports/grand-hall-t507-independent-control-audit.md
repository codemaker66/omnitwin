# Grand Hall T-507 independent-control and T-486 preflight audit

**Cutoff:** 2026-07-13  
**Disposition:** `DRAFT / PRIVATE / NOT REGISTRABLE / NOT REVIEW-APPROVABLE`  
**Machine-readable evidence:** `./grand-hall-t507-independent-control-evidence.json`

This report reviews the frozen T-507 Grand Hall evidence, the existing prepared
Trades Hall release, independent-control availability, identity and source
rights, and the exact boundary of an unsigned T-486 dossier. It performs no
evidence registration, review mutation, signing, publication, promotion,
training, paid compute, proprietary payload parsing or source mutation.

## Decision

T-507 has been assembled into a digest-bound, tamper-evident offline preflight
dossier, but complete human evidence re-review remains blocked. The package
omits the full identity-review pixel set while its provenance and reuse rights
remain unresolved. It is not ready for public approval, signing or publication.

The proposed COLMAP-to-E57 similarity transform is a useful diagnostic of a
derived image set, but it is not a reviewed `TransformArtifactV0`, it has no
runtime/public authority, and it has no independent surveyed control. More
importantly, it is not the load-bearing transform for the existing 149-node
release: that release is already E57-native. Registering the T-507 diagnostic
as if it governed the whole release would be false evidence.

Two defensible routes remain:

1. Freeze and review the actual E57/ARF-to-CVF transform used by the 149-node
   release, then create a Scene Authority Map covering every node/region.
2. Classify the Grand Hall nodes, prepare a new bounded Grand-Hall-only release,
   and validate that release against independent control.

Either route creates a new evidence epoch. The existing prepared release and
the current source manifest must not be silently mixed.

## Evidence reviewed

### T-507 frozen evidence

- Output index file SHA-256:
  `5ce95707ed8111df82e32fd7997cbcf862bec2974cf544734f5098cfe0540773`
- Ingest manifest semantic SHA-256:
  `583b4fd025bb00e28a14683c8fcbeee2cb1e0091bdbd968acd1176b9090187c0`
- Identity review semantic SHA-256:
  `11a58296a03d907578c09c37f15dc97ac529e8c785d88e5dc1409d7bfba47ca2`
- Residual report semantic SHA-256:
  `2434f48460351c50923b26675bbf0edb04b7c90c71154e68ac2ec132c7240e4d`
- Transform proposal semantic SHA-256:
  `16f7af7c68c2bcbca620be7f4ed4fe055de0714f3615c68cb65ba7e1bcf694e3`

The user's decision `B` confirms the Grand Hall identity for anchor sweeps 000,
010, 020 and 040 and excludes sweep 049 as adjacent space. It does not classify
every sweep 0–48 or every release node.

### Prepared release audit target

The existing `output/foundry/trades-hall-prepared` epoch contains:

- release digest
  `e3525acfd76bdd89d621c6eefaae8494f9c459e52702d351545f685655a917d8`;
- QA report digest
  `9eb006631370ba228f230018f4b05c9ad95204f681f8faf78e38b54029a8e586`;
- 449 files and 498,035,687 bytes;
- 149 Twin nodes and 349 graph edges;
- all 149 required 512px low-LOD review images;
- no files with the release role `evidence`;
- no room classification (`roomSlug` is null for all nodes).

The prepared epoch records source-manifest digest
`fa00cecb7e4d0ee2088893a923f77c6db7a6082f23a6f59cd0c143976ac30e7d`.
The current source `packages/web/public/twin/trades-hall/manifest.json` has raw
file SHA-256
`5a503e45525433407ca8cbade1fa84fbb83ba7349100fac11743d8f9faae1175`.
The current bytes are not a replacement for the frozen prepared epoch.

### Dossier completeness and confidence boundary

The exact prepared-epoch `manifest.json` was recovered from the local
`output/worktrees/twin-dollhouse-fix` distribution tree. Its SHA-256 is
`fa00cecb7e4d0ee2088893a923f77c6db7a6082f23a6f59cd0c143976ac30e7d`,
matching the release manifest. The offline preflight includes those bytes with
the exact prepared release manifest, QA report and preparation record. A
reviewer can therefore re-inspect the 149-node scope, 349 edges, null room
classification and recorded capture/frame metadata from one digest-bound tree.

That prepared source manifest declares `tier: "ops-grade-2cm"` while independent
surveyed control is absent. The current, different source manifest repeats the
same tier. It is unsupported for public or operational reliance. The selected
release route must downgrade or reissue its confidence claim until a frozen,
load-bearing transform passes independent control and human review.

The dossier includes a composite identity overview for access-restricted
internal context. It does not include the 30 original cubefaces, five complete
six-face sheets, the known-reference sheet, or `identity-gate-evidence.json`.
Those materials remain withheld pending a documented rights decision. The
composite cannot reproduce or validate the original per-face hashes, so
offline evidence review is explicitly blocked rather than complete.

“Tamper-evident” here means every included byte is digest-bound and mutation is
detectable. The local NTFS directory is not WORM or content-addressed storage
and must not be described as physically immutable.

## Transform and residual finding

The proposed 0–48 transform reports scale `1.7362021512269856`, candidate RMSE
10.60 mm and frozen five-sweep holdout RMSE 5.76 mm. Those are same-lineage
internal consistency measurements. The COLMAP images and E57 scan centres share
the same Matterport/E57 export lineage, so the holdout is not independent
survey validation.

### Cubeface-centre contradiction

The six virtual cubefaces for a physical panorama sweep should share one camera
centre. They do not:

| Diagnostic | Candidate 0–48 |
|---|---:|
| Registered face cameras | 230 of 294 expected |
| Sweeps with all six registered | 0 of 49 |
| Mean distance from sweep mean | 11.06 mm |
| Median | 9.52 mm |
| P95 | 21.19 mm |
| Maximum | 95.68 mm (sweep 0, `up`) |
| Faces above 10 mm | 105 |
| Faces above 20 mm | 15 |

The next largest sweep maxima are 40.48 mm at sweep 40, 27.73 mm at sweep 2,
26.56 mm at sweep 5 and 25.91 mm at sweep 27. Averaging each sweep to one point
hides this pose inconsistency. It does not, by itself, prove that the similarity
transform is wrong; it does invalidate any unqualified interpretation of the
5.76 mm holdout as survey accuracy and requires rig-aware reprocessing plus
aggregation sensitivity.

### Leave-one-sweep-out sensitivity

Across sweeps 0–48, leave-one-out prediction gives RMSE 11.29 mm, P95 18.07 mm
and maximum 49.81 mm at sweep 0. Fitted scale spans 194.87 ppm and the largest
rotation change is 0.01618 degrees. This remains same-lineage sensitivity, not
independent validation.

## Independent-control search

No usable independent Grand Hall control was found locally.

| Candidate | Decision |
|---|---|
| Matterport E57, panoramas, OBJ/GLB, COLMAP and derived clouds | Same lineage; reject as independent control |
| `F:/E57/th.nwc` | Unknown provenance; no datum, surveyor, uncertainty or sidecar |
| XGRIDS `control_points.csv` | Empty |
| XGRIDS GNSS rows | Zero/status-0 and from the wrong room |
| Existing RealityCapture/ICP matrices | Derived from Matterport assets |
| Official floor plan | Sanity check only; no title block, datum, tolerance or control points |

The official venue floor-plan image states 21 m × 10.5 m, while the current
[rooms page](https://www.tradeshallglasgow.co.uk/rooms/) states 21 m × 10 m ×
7 m. The 0.5 m width conflict alone disqualifies the web plan as precision
control without survey provenance.

### Minimum independent acquisition

Use at least eight fit controls and six blind checks, distributed in three
dimensions across the perimeter, long/short spans, multiple heights and
non-coplanar heritage features. This is an engineering intake recommendation,
not a claim that the current evidence meets a surveying standard.

Record:

- surveyor/operator, instrument make/model/serial and calibration state;
- date, datum/frame, units and uncertainty/covariance;
- raw observation and field-book hashes;
- target identifiers, photographs and immutable coordinate observations;
- predeclared fit versus blind-check roles.

Fit only on the fit controls. Apply the frozen transform to blind checks without
refitting. Report residual vectors, horizontal/vertical components,
mean/median/RMSE/P95/maximum, scale, leave-one-out sensitivity, spatial strata
and appropriate surface overlap/distance. A flat-wall or ICP-only comparison is
not a substitute for independent control.

## Identity and rights gates

The exact local `Grand-Hall-scaled-opt.jpg` matches the
[venue-hosted image](https://www.tradeshallglasgow.co.uk/siteimages/weddings/grand-hall-scaled-opt.jpg).
The local floor plan likewise matches the hosted venue asset. The current
[venue terms](https://tradeshallglasgow.co.uk/terms-and-conditions/) state that
site material is owned or licensed by Trades Hall, restrict downloaded/extracted
material to personal use, and restrict separate image use. These files require
written permission or replacement with cleared references before reuse in a
commercial/public dossier. `grand-hall-room.jpg` has unknown origin, and the
documented conversion of the user-supplied `grand-hall-dark.jpg` does not itself
establish source rights.

The current [Matterport Terms of Use](https://matterport.com/terms-of-use)
prohibit commercial AI/ML training using Matterport Data. Account-specific E57
processing, derivative, redistribution and publication rights still require the
governing customer/order/Platform Subscription Agreement and a written legal
decision. This report is a technical rights screen, not legal advice.

An external identity attestation must come from an authenticated venue-authority
reviewer and bind the exact evidence digest, all cited image hashes, decision B,
confirmed/excluded roles, reviewer identity/authority, knowledge basis and time.
The previous thread reply cannot be upgraded retroactively into a signed or
platform-authenticated attestation.

## T-486 contract delta

The present T-507 proposal uses `COLMAP_WORLD` and `E57_GLOBAL`; those are not
the controlled `TransformArtifactV0` frame enums. Renaming them is not a fix.
The real frame chain and release consumption must be demonstrated.

Public T-486 approval requires, at minimum:

1. a registered release UUID bound to the frozen release epoch;
2. immutable visual evidence for the intended scope;
3. a human-reviewed `TransformArtifactV0` that is load-bearing for the release;
4. independent control and sensitivity evidence;
5. a `SceneAuthorityMapV0` covering every node/region in scope;
6. resolved identity/reference and source-processing rights;
7. a qualified review using the existing online T-486 flow.

Only after the latest persisted review is evidence-complete and approved may
the server issue byte-bound signing material. This offline dossier deliberately
contains none of the online review, signature, attestation, publication or
promotion fields.

## Owner actions

| Owner | Required action | Completion evidence |
|---|---|---|
| Blake / venue / legal | Supply governing Matterport agreement and written reference-image permissions | dated, scoped rights decisions bound to asset hashes and purposes |
| Surveyor / venue | Supply independent Grand Hall fit and blind controls | immutable observation bundle with uncertainty and provenance |
| Authenticated venue reviewer | Attest identity and classify all nodes in the chosen scope | authenticated, digest-bound decision |
| Qualified transform reviewer | Review frame semantics, external validation and sensitivity | accepted `TransformArtifactV0` or explicit rejection |
| Foundry owner | Choose whole-release or bounded-Grand-Hall route | frozen release epoch and complete Scene Authority Map |
| Engineering | Register evidence only after the preceding gates close | T-486 contract validation report |

Until those actions are complete, public approval, signing, publication and
model training remain blocked.
