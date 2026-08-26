# Grand Hall T-554 human review checklist

Status: **historical v1 50/98 decision aid; stopped and superseded for
acceptance; authority none**

This file is a preserved blank decision aid. It is **not** an acceptance
artifact. Do not use it to run T-554 acceptance: T-561 delivered a separately
versioned unified 148-row successor. An unchecked or `UNSURE` item remains
unresolved and grants no authority.

Read the
[local T-554 acceptance runbook](../grand-hall-t554-acceptance-runbook.md) for
the explicit v1 stop condition. The preserved `human-decisions.json` and
`closed-selection-volume.json` template cannot be promoted to acceptance. Do
not treat marks in this Markdown file as machine-readable acceptance.

Reviewer: `____________________________`

Review date/time with timezone: `____________________________`

Knowledge basis (for example, captured the venue / knows the room in person):
`__________________________________________________________________________`

## A. Exact room identity and source cleanup handling

MatterPak room 9 is a source identifier, not a human room-name decision.
Inspect the
[source-bound T-551 room evidence](../grand-hall-room9-source-boundary-evidence-v1.json)
and supplied source OBJ before choosing exactly one result:
`ACCEPT_AS_GRAND_HALL`, `REJECT_AS_GRAND_HALL`, or `UNSURE`.

MatterPak room 9 result: `______________________________________________`

Evidence note:
`__________________________________________________________________________`

Inspect the source-bound cleanup handling for both named artifact classes.
`ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY` accepts only the
scope handling; it does not assert that a real architectural window or mirror
exists. The other results are `REJECT_SOURCE_SCOPE_HANDLING` and `UNSURE`.

| Source cleanup class | Human result | Evidence note |
|---|---|---|
| `Window` |  |  |
| `Mirror` |  |  |

Any rejection or `UNSURE` stops accepted bundle creation.

## B. Historical v1 50-candidate panorama table

This table preserves the old v1 review shape only. A later all-source audit at
the model's 2048x1024 display resolution recorded Grand Hall pixels in every
one of sweeps 001–050. That authority-none agent observation does not decide
whether the whole image is inside the room, which pixels belong, or what a
human must mark. Do not enter formal results in this historical table.

The displayed E57 scan indices are a separate
`sequence_hypothesis_unverified`. They are not part of the JPEG identities and
this checklist cannot accept them as camera correspondence or pose evidence.

The T-561 successor presents all 148 exact identities through one unified
human-decision surface. Every row still remains `UNSURE` and
`nativeResolutionHumanReviewCompleted=false` until qualified human review.

| Sweep | Source JPEG | Historical v1 hypothesis | Human result | Note |
|---:|---|---|---|---|
| 001 | `sweep_001jpg.jpg` | mixed room-boundary content |  |  |
| 002 | `sweep_002jpg.jpg` | Grand Hall candidate |  |  |
| 003 | `sweep_003jpg.jpg` | Grand Hall candidate |  |  |
| 004 | `sweep_004jpg.jpg` | Grand Hall candidate |  |  |
| 005 | `sweep_005jpg.jpg` | Grand Hall candidate |  |  |
| 006 | `sweep_006jpg.jpg` | Grand Hall candidate |  |  |
| 007 | `sweep_007jpg.jpg` | Grand Hall candidate |  |  |
| 008 | `sweep_008jpg.jpg` | Grand Hall candidate |  |  |
| 009 | `sweep_009jpg.jpg` | Grand Hall candidate |  |  |
| 010 | `sweep_010jpg.jpg` | Grand Hall candidate |  |  |
| 011 | `sweep_011jpg.jpg` | Grand Hall candidate |  |  |
| 012 | `sweep_012jpg.jpg` | Grand Hall candidate |  |  |
| 013 | `sweep_013jpg.jpg` | Grand Hall candidate |  |  |
| 014 | `sweep_014jpg.jpg` | Grand Hall candidate |  |  |
| 015 | `sweep_015jpg.jpg` | Grand Hall candidate |  |  |
| 016 | `sweep_016jpg.jpg` | Grand Hall candidate |  |  |
| 017 | `sweep_017jpg.jpg` | Grand Hall candidate |  |  |
| 018 | `sweep_018jpg.jpg` | mixed room-boundary content |  |  |
| 019 | `sweep_019jpg.jpg` | adjacent-space hypothesis |  |  |
| 020 | `sweep_020jpg.jpg` | Grand Hall candidate |  |  |
| 021 | `sweep_021jpg.jpg` | Grand Hall candidate |  |  |
| 022 | `sweep_022jpg.jpg` | Grand Hall candidate |  |  |
| 023 | `sweep_023jpg.jpg` | Grand Hall candidate |  |  |
| 024 | `sweep_024jpg.jpg` | Grand Hall candidate |  |  |
| 025 | `sweep_025jpg.jpg` | Grand Hall candidate |  |  |
| 026 | `sweep_026jpg.jpg` | Grand Hall candidate |  |  |
| 027 | `sweep_027jpg.jpg` | Grand Hall candidate |  |  |
| 028 | `sweep_028jpg.jpg` | Grand Hall candidate |  |  |
| 029 | `sweep_029jpg.jpg` | Grand Hall candidate |  |  |
| 030 | `sweep_030jpg.jpg` | Grand Hall candidate |  |  |
| 031 | `sweep_031jpg.jpg` | Grand Hall candidate |  |  |
| 032 | `sweep_032jpg.jpg` | Grand Hall candidate |  |  |
| 033 | `sweep_033jpg.jpg` | Grand Hall candidate |  |  |
| 034 | `sweep_034jpg.jpg` | Grand Hall candidate |  |  |
| 035 | `sweep_035jpg.jpg` | Grand Hall candidate |  |  |
| 036 | `sweep_036jpg.jpg` | Grand Hall candidate |  |  |
| 037 | `sweep_037jpg.jpg` | Grand Hall candidate |  |  |
| 038 | `sweep_038jpg.jpg` | Grand Hall candidate |  |  |
| 039 | `sweep_039jpg.jpg` | Grand Hall candidate |  |  |
| 040 | `sweep_040jpg.jpg` | Grand Hall candidate |  |  |
| 041 | `sweep_041jpg.jpg` | Grand Hall candidate |  |  |
| 042 | `sweep_042jpg.jpg` | Grand Hall candidate |  |  |
| 043 | `sweep_043jpg.jpg` | Grand Hall candidate |  |  |
| 044 | `sweep_044jpg.jpg` | Grand Hall candidate |  |  |
| 045 | `sweep_045jpg.jpg` | Grand Hall candidate |  |  |
| 046 | `sweep_046jpg.jpg` | Grand Hall candidate |  |  |
| 047 | `sweep_047jpg.jpg` | Grand Hall candidate |  |  |
| 048 | `sweep_048jpg.jpg` | Grand Hall candidate |  |  |
| 049 | `sweep_049jpg.jpg` | mixed room-boundary content |  |  |
| 050 | `sweep_050jpg.jpg` | adjacent-space hypothesis |  |  |

## C. Historical 98-other panorama table and corrected observation

The 98 other supplied JPEGs were never automatically outside the Grand Hall or
eligible for blanket exclusion. The preserved v1 `human-decisions.json`
contains one exact-identity row for every file, but it cannot now be promoted
to acceptance.

A later all-source audit supersedes that contact-sheet interpretation. At the
model's 2048x1024 display resolution, authority-none agents observed Grand
Hall pixels in sweeps 001–061, 065–075, and 148–149 (74 exact source files),
and observed no Grand Hall pixels in sweeps 062–064, 076–092, and 094–147
(74 exact source files). Numeric sweep 093 is absent from the exact 148-file
inventory, not an unresolved row. The audit recorded zero agent uncertainty
flags, but `nativeResolutionHumanReviewCompleted=false`.

The observation classes are neither human room-membership decisions nor E57
mappings. `Grand Hall pixels observed` is not `INCLUDE`; `no Grand Hall pixels
observed` is not `EXCLUDE` or `measured_empty`. All 148 exact sources remain
human-pending, and the 24 positive observations outside the historical 1–50
group stop and supersede this v1 acceptance path.

For historical reference, the v1 row vocabulary was:

- `EXCLUDE_OUTSIDE_GRAND_HALL` only after confirming that the frame contains no
  Grand Hall evidence;
- `GRAND_HALL_EVIDENCE_FOUND_REVIEW_SET_INCOMPLETE` if the frame contains or
  may contain Grand Hall evidence; or
- `UNSURE` while unresolved.

Do not enter those results in the preserved v1 record. The future unified
successor must capture the authorized human's decisions.

- [x] A completed authority-none T-561 successor exists and binds all 148 exact
  identities; this machine prerequisite is not human acceptance.
- [ ] An authorized human opened and inspected all 148 exact JPEGs individually
  at native 8192x4096 resolution.
- [ ] The successor records `nativeResolutionHumanReviewCompleted=true` only
  after that review, with no unresolved human result.

Until every checkbox can honestly be checked in the future successor, stop. Do
not convert agent observations into `INCLUDE`, `EXCLUDE`, or mask authority.

## D. Exhaustive interface dispositions

Every row must be resolved. Permitted final dispositions are:

- `CLOSE_AT_REVIEWED_GRAND_HALL_PLANE`
- `EXCLUDE_BEYOND_INTERFACE`
- `NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT`
- `UNSURE`

`UNSURE` is not acceptance.

| Interface ID | Adjacent source room | Shared vertices | Human disposition | Note |
|---|---|---:|---|---|
| `matterpak-1-9-0-2` | `matterpak:g000:s002` | 10 |  |  |
| `matterpak-1-9-0-3` | `matterpak:g000:s003` | 2 |  |  |
| `matterpak-1-9-0-4` | `matterpak:g000:s004` | 15 |  |  |
| `matterpak-1-9-1-10` | `matterpak:g001:s010` | 6 |  |  |
| `matterpak-1-9-1-11` | `matterpak:g001:s011` | 6 |  |  |
| `matterpak-1-9-1-12` | `matterpak:g001:s012` | 3 |  |  |
| `matterpak-1-9-1-13` | `matterpak:g001:s013` | 72 |  |  |
| `matterpak-1-9-1-14` | `matterpak:g001:s014` | 62 |  |  |

## E. Later artifact reviews

These cannot be decided yet because the artifacts do not exist.

- [ ] Separately versioned authority-none successor generated; exact room 9,
  `Window`, `Mirror`, all 148 panorama identities, and eight interface
  identities left unchanged. The preserved v1 50/98 template is not used.
- [ ] Exact MatterPak room 9 accepted as the intended Grand Hall.
- [ ] `Window` and `Mirror` source cleanup handling each accepted with no
  architectural authority.
- [ ] Formal `human-decisions.json` matches every qualified human decision above.
- [ ] Non-convex invisible closed selection volume authored and reviewed.
- [ ] Every included 8192×4096 binary panorama mask authored and reviewed.
- [ ] Every mask compared against its exact source JPEG at original resolution.
- [ ] Every reviewed mask is bound by exact SHA-256, byte length,
  included-pixel count, and excluded-pixel count.
- [ ] `bind-masks` preparation output was treated as `PENDING`; a human, not
  the command, set `maskReviewed` after inspecting those exact bytes.
- [ ] No invented windows, doors, floor, neighbouring room, facade, or fill.
- [ ] Local accepted bundle contains preserved formal reviews, exact masks,
  four derived artifacts, and a complete `publication-receipt.json` written
  last.
- [ ] T-555 real LCC/Creator Data output exists.
- [ ] T-557 ARF→CVF transform has non-collinear, source-bound controls and human overlay review.
- [ ] T-557 output-inventory bitset matches exact member order, byte length, popcount, and padding.

Historical v1 T-554 result: `PENDING` (acceptance stopped)

Reviewer signature or recorded identity: `____________________________`

Even a final `ACCEPT` here does not authorize reconstruction, runtime
admission, staging, deployment, publication, or production trust. The local
acceptance gate must independently verify the completed formal JSON, all 148
exact source JPEGs, closed volume, exact mask bindings, and mask bytes. The
self-contained local bundle still retains
`productionTrust: null`, `runtimeAdmissionAuthorized: false`, and
`reconstructionAuthorized: false`.
