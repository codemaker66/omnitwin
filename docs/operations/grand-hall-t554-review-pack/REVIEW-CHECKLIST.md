# Grand Hall T-554 human review checklist

This file is a blank decision aid. It is **not** an acceptance artifact. An
unchecked or `UNSURE` item remains unresolved and grants no authority.

After using this aid, follow the
[local T-554 acceptance runbook](../grand-hall-t554-acceptance-runbook.md).
The formal human record is the generated `human-decisions.json`; the accepted
volume is reviewed separately in `closed-selection-volume.json`. Do not treat
marks in this Markdown file as machine-readable acceptance.

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

## B. Current 50-candidate panorama membership

The current image-content hypothesis is only a visual aid: source panorama
sweeps 001, 018, and 049 appear to contain mixed Grand Hall and adjacent-space
content; sweeps 019 and 050 appear adjacent; the remaining source panoramas
appear consistent with the Grand Hall. The reviewer may overturn all of it.

The displayed E57 scan indices are a separate
`sequence_hypothesis_unverified`. They are not part of the JPEG identities and
this checklist cannot accept them as camera correspondence or pose evidence.

Use exactly one result per row: `INCLUDE`, `EXCLUDE`, or `UNSURE`.

| Sweep | Source JPEG | Current image-content hypothesis | Human result | Note |
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

## C. Remaining 98 panorama dispositions

The 98 other supplied JPEGs are not automatically outside the Grand Hall and
are not eligible for blanket exclusion. The generated formal
`human-decisions.json` contains one exact-identity row for every file.

The checked-in, source-bound review supplement currently shows clear possible
Grand Hall evidence in sweeps 051–075. That observation has **not** been
human-accepted, but it already prevents a blanket outside-room exclusion and
keeps the current 50-image review set incomplete. Review those exact originals
first and stop for a rebuilt T-550/review pack if the authorized reviewer
confirms what the review pages show.

Open every exact JPEG and record one result per formal row:

- `EXCLUDE_OUTSIDE_GRAND_HALL` only after confirming that the frame contains no
  Grand Hall evidence;
- `GRAND_HALL_EVIDENCE_FOUND_REVIEW_SET_INCOMPLETE` if the frame contains or
  may contain Grand Hall evidence; or
- `UNSURE` while unresolved.

- [ ] All 98 exact JPEGs were opened and inspected individually.
- [ ] All 98 formal rows have evidence notes and no `UNSURE` remains.
- [ ] No possible Grand Hall evidence was found outside the current 50-image
  candidate set.

If the final checkbox cannot honestly be checked, stop. Mark the affected rows
`GRAND_HALL_EVIDENCE_FOUND_REVIEW_SET_INCOMPLETE` and rebuild the review set;
do not force them to `EXCLUDE_OUTSIDE_GRAND_HALL`.

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

- [ ] Authority-none JSON templates generated; exact room 9, `Window`,
  `Mirror`, 50 candidate panoramas, 98 remaining panoramas, and eight interface
  identities left unchanged.
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

Final T-554 result: `PENDING / ACCEPT / REJECT`

Reviewer signature or recorded identity: `____________________________`

Even a final `ACCEPT` here does not authorize reconstruction, runtime
admission, staging, deployment, publication, or production trust. The local
acceptance gate must independently verify the completed formal JSON, all 148
exact source JPEGs, closed volume, exact mask bindings, and mask bytes. The
self-contained local bundle still retains
`productionTrust: null`, `runtimeAdmissionAuthorized: false`, and
`reconstructionAuthorized: false`.
