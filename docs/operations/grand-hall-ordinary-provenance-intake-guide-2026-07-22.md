# Grand Hall ordinary provenance intake guide

**Status:** blank completion pack; authority none; unsigned
**Purpose:** collect the three human-supplied records still needed before an
evidence-complete Grand Hall review can be prepared. These files do not alter
the existing T-486 r2 preflight and do not approve, sign or publish anything.

## Files

1. `grand-hall-source-processing-rights-intake-template-v0.json`
   records source- and purpose-specific decisions for Matterport exports,
   XGRIDS exports and venue or commissioned media.
2. `grand-hall-venue-review-and-release-scope-intake-template-v0.json`
   records who reviewed the room, their basis of venue authority, the exact
   evidence they reviewed and either the whole-release or bounded-Grand-Hall
   scope.
3. `grand-hall-independent-survey-control-intake-template-v0.json`
   predeclares eight fit-control slots and six blind-check slots with the
   observation, instrument, uncertainty and byte-identity fields needed for a
   later independent residual report.

## How to complete the pack

1. Copy each required template to a new dated filename. Keep the templates
   unchanged.
2. Replace every applicable `null` and empty record in the dated copy. Only the
   three completion booleans listed below may change. Do not use a blank string
   as an answer.
3. Use stable local record references and `sha256:` values to identify the
   exact agreement, permission, asset, observation bundle, field book, target
   photograph and evidence inventory being described.
4. Keep `authority` as `none`. A completed intake copy is evidence supplied for
   later review; it is not itself an approval or release decision.
5. Return the three completed copies together with every supporting record they
   cite. Do not place source images or agreements into a public location.

## Source-processing rights

Complete one decision independently for every purpose field. Each source
family separately records local processing, derivative creation, derivative
internal use, derivative commercial use, public display, public twin
publication, original-source redistribution, derived-output redistribution,
cloud processing and model training. Do not infer one decision from another.
`not_applicable` requires a written reason. If model training is not wanted,
use `not_requested`; this avoids making an optional use a condition of the
geometry and visual-review work. Official exports and their underlying
captured content must each have a recorded basis; a software licence or
readable file format is not a source-content permission.

## Venue reviewer and release scope

Choose exactly one scope:

- `whole_release`: bind one exact frozen 149-node inventory and classify every
  node in it; or
- `bounded_grand_hall_release`: bind that same exact inventory, list every
  included and excluded node, describe the boundary and classify every
  included node.

Both routes use only `canonicalFrozenReleaseNodeInventory`. The review subject
and the chosen scope may not cite a second inventory identity. Bind the venue
authority record and the review completion record by both stable record
reference and `sha256:` value.

For the bounded option, the included and excluded lists must contain unique
IDs, be disjoint and have a union exactly equal to the cited 149-node
inventory. Engineering recomputes the two counts, the empty intersection, the
149-node union and the empty missing and unexpected lists before setting
`allReleaseNodesPartitioned` to true.

The recommended preparation route is `bounded_grand_hall_release`, because the
existing 149-node release has no room classification and the T-507 similarity
diagnostic is not its governing transform. The reviewer must provide their
name, organisation, role, relationship to the venue, basis of venue authority
and knowledge basis. The review must cite one exact evidence index and one
exact node or sweep inventory.

The existing phase-1 operator reviews remain useful context. They do not fill
the blank venue-review template, choose the release scope or classify every
node in that scope.

## Independent survey controls

The eight fit controls estimate the candidate transform. The six blind checks
remain outside that fit and test the frozen result without refitting. Before
fitting, freeze one plan ID, plan record, digest, time, both frame IDs, exact
fit and blind slot lists, and an explicit assignment for every slot to its
`pointPairId`, physical `targetId`, source observation identity and applicable
independent-survey observation or sealed-custody-member identity. Freeze the
transform method, weighting policy and outlier policy in the same record. The
dated copy must reproduce those frozen assignments exactly; targets or point
pairs may not be added, removed or swapped after fitting begins. Record why
the survey is independent and cite its supporting record.
Capture sources derived from the reconstruction under test are explicitly
ineligible as independent survey control.

Keep the blind independent-survey coordinates in a separately held sealed
bundle until the fit result is frozen. The pre-fit record stores the sealed
bundle identity and custody facts without exposing its coordinates. After the
fit result is frozen, record the fit-result identity and release time, then
populate the blind point pairs without changing the frozen plan or sealed
bundle identities.

Every control needs a deterministic point pair: source-side frame ID,
coordinates, observation record and digest; independent-survey frame ID,
coordinates, uncertainty or covariance, observation record and digest; and a
point-pair evidence record and digest. It also needs a target ID and
description, instrument record, operator or surveyor, observation time and
target-photo digest. The later report—not this intake—must calculate residual
vectors, horizontal and vertical components, mean, median, RMSE, p95, maximum,
scale and rotation sensitivity, leave-one-out sensitivity and spatial-strata
results.

## Immutable booleans

Every `guardrails.*` boolean is immutable `false` in the templates and in every
completed copy. `unsigned` is fixed `true`. Each survey slot's `usedForFit`
value is fixed by its declared role: `true` for the eight fit slots and `false`
for the six blind slots. No one completing the pack may change those values.

The only mutable booleans in the entire pack are:

- `releaseScopeDecision.wholeRelease.allNodesClassified`
- `releaseScopeDecision.boundedGrandHallRelease.allIncludedNodesClassified`
- `releaseScopeDecision.boundedGrandHallRelease.partitionValidation.allReleaseNodesPartitioned`

They begin `false` and may become `true` only when engineering verifies the
exact cited inventory, node decisions and partition evidence. No other boolean
may be changed.

## Boundary

Completing these templates does not create a T-486 review input, review a
transform, complete a Scene Authority Map, authorize source processing, alter
the frozen r2 dossier, or request publication. Engineering must validate the
completed copies and cited records before preparing a new, separately named,
unsigned review preflight.
