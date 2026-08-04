# Grand Hall mesh baseline: evidence, design, and the seam it must plug into

**Status:** `DESIGN + EVIDENCE — implementation deliberately not started this session`
**Date:** 2026-07-25
**Scope:** bounded Grand Hall pilot, E57 sweeps 0–48 (sweep 49 human-excluded, T-507)

## 1. What was measured this session

| Finding | Evidence |
|---|---|
| The 49 pilot sweeps are **one room**, not a walk through several | Scanner positions span an axis-aligned 17.97 × 11.33 m with a z-range of only 1.46–1.54 m — constant tripod height, single floor, single cluster at 4 m single-linkage |
| The oversized meshes are **not** multi-room contamination | Follows from the above: the footprint is room-sized; the excess is the scanner seeing *out* |
| The scanner sees far beyond the room | 5-sweep Poisson shakeout bbox 28.52 × 44.01 × 9.24 m; full 49-sweep cached cloud raw extent 58.29 × 53.48 × 12.86 m |
| The appearance layer has the **same** problem | The pre-existing Brush splat's sampled core extent scales to ≈25.6 × 17.0 × 25.9 m — see the Brush discovery note |
| A working cloud now exists | 6,526,772 points at 2 cm, per-sweep normals oriented to each sweep's known origin, cached so the ~7-minute E57 read is paid once |

**Consequence:** the room envelope is not a meshing detail. It is a shared asset that must
crop geometry *and* appearance, and it is the difference between a 44 m artefact and a room.

## 2. The seam this must plug into (discovered, and it changes the design)

The programme **already has** a room-envelope concept, and it is human-first:

- `omnitwin.foundry.room-envelope-review.v0` — a digest-bound review record.
- The operator app draws it: *"Review and mark all three component projections, then choose
  the projection you consider horizontal and draw a simple outline"*, with an explicit
  disclaimer that it establishes *"[no] axes, units, room identity, orientation, physical
  accuracy, registration, rights, or validation independence."*
- `tools/reception-hd/register_potree_e57_fit_envelope.py` **consumes** an accepted review;
  it cannot approve or register a transform.

So the existing envelope is a **human-drawn fit seed that claims nothing**. Therefore:

> **Design rule: the mesh lane must not create a second "room envelope" concept.**
> The measurement described below is a *proposer* that produces candidate surfaces plus
> evidence for a human to review, and a *crop* used for meshing. It must reuse or extend the
> existing review schema rather than mint a rival one, and it must never self-approve.

This is the same machine-proposes/human-reviews shape as the identity gate and the proposed
transform. It is why implementation was not started this session: writing a competing
envelope in the last hour of a long session is precisely the silent divergence this
programme keeps having to repair.

## 3. The chosen mechanism (design panel, four independent proposals + judge)

**Winner: plane detection selected by hole-closed *areal completeness*.**

The discriminator is the point. Candidate bounding surfaces are not chosen by inlier count —
which is what lets a corridor wall glimpsed through a doorway win — but by how completely a
candidate plane fills *its own supported extent*, after morphologically closing holes so that
tall windows and doorways count as the masonry that encloses them.

The separation is structural, not tuned: a real 21 m wall fills ~0.9 of its support region,
while a far wall lit through a 1.2 m doorway fills ~0.02 of the same region, because the door
cone illuminates roughly 2 m² of a ~126 m² region. Roughly a 50× gap, so an acceptance
threshold of 0.60 sits in an empty valley rather than on a knob.

Supporting elements grafted from the runners-up: yaw estimated twice by independent methods
and required to agree; the 49 scanner origins used as an **interiority certificate** (every
origin must lie strictly inside every accepted wall, or the wall is wrong — the one
certificate in this dataset that cannot be faked); and a bounded visibility carve, using the
fact that every point carries the origin it was seen from, kept in reserve for ambiguous axes
and for the navmesh solid.

**Honesty by construction:** dimensions are plane-to-plane distances between refit boundary
planes, never a bounding box of the cropped cloud — so an outward crop margin is structurally
incapable of inflating a measurement.

## 4. Corrections that must be applied before implementation

Two adversarial reviewers returned 29 findings, 10 of them HIGH, several against the winning
plan's own headline claims. The load-bearing ones:

1. **The 50× separation claim is only true with the right denominator.** Computed against the
   wall's own area it holds; against a "scanner footprint dilated 3 m" support region — which
   is what the plan actually specified for the first pass — it does not. Bootstrap each
   candidate's support extent from its *own* 2nd–98th percentile supported span.
2. **Refit each candidate before testing it.** The plan tested candidates against an
   unrefined global-yaw plane and refit only after acceptance, so a small yaw error corrupts
   the accept/reject decision itself.
3. **Take the mask top from the measured ceiling**, not a hardcoded 6.0 m — on a Georgian
   wall the band above the window heads is the most areally complete masonry there is, and a
   6 m cap discards it in a ~7 m room. Seed the top row as well as the bottom.
4. **Measure the occupancy tolerance, don't assume it.** 3 cm is a modern-construction
   flatness budget silently applied to 230-year-old lath-and-plaster; derive it from the
   robust σ of the inlier residuals (`max(0.03, 3σ)`) and report the wall's flatness.
5. **A colonnade can be filled into a "solid wall".** Bottom-row seeding plus hole-closing
   turns any set of floor-standing elements tied together at the top into an enclosed grid.
   Guard with an outboard-mass test: real mass standing behind a candidate disqualifies it.
6. **The convexity refusal gate double-counts.** It totals both leakage the pipeline is
   *supposed* to remove and real architecture a convex prism would amputate; only the second
   justifies refusal. Bucket removed points by whether their own sweep's ray passed through a
   known opening.
7. **Yaw disagreement should report, not halt** — the pipeline elsewhere insists on measuring
   non-parallelism rather than refusing it.

## 5. Refusal states are first-class

The design's most important property is that it can decline. `WALL_NOT_FOUND`,
`NON_CONVEX_REFUSED`, `MIRROR_AMBIGUOUS`, `WALL_DISPUTED`, `CEILING_AMBIGUOUS`, and an
overall `UNMEASURABLE` with a reason string — a room-dimension metric that cannot be measured
honestly emits no number at all. Mirrors get two independent tests that must agree, because a
mirror manufactures a dense, correctly-oriented virtual room that passes every local plane
test and can double a dimension.

## 6. The integrity firewall

The published 21 × 10 × 7 m figures are a **check, never an input**. Enforced technically, not
by promise:

- measurement and comparison live in separate modules, with no import path from the first to
  the second;
- a **published-swap test** patches the published constants to something else entirely and
  asserts the measured output is byte-identical;
- synthetic test fixtures are deliberately **20.37 × 9.62 × 6.85 m**, so an estimator that has
  absorbed the published figures — by tuned constant, by snapping, or by an author's memory —
  fails visibly;
- the run ledger records every parameter revision, so a delta that shrinks toward the
  published figure across revisions is legible as a review finding;
- reporting reads only frozen, hashed measurements and prints the honest form:
  `measured 20.412 ± 0.031 m, published 21 m, delta −0.588 m`, never rounding a measurement
  to a convenient number.

## 7. Phase-1 slice for the next session

Shippable without the visibility carve, the mirror adjudication, or the dome work:
load the cached cloud → floor plane and up axis (gated by the *measured* 1.46–1.54 m tripod
height, a capture fact rather than a brochure figure) → yaw twice → candidate enumeration →
areal completeness with the corrected denominator → selection → interiority certificate →
plane-to-plane measurement with uncertainty → `measured.json` + receipt, proposed for human
review through the existing envelope-review seam.

Then, and only then, the mesh: screened Poisson on in-envelope points, clipped to the
accepted half-spaces — which is the direct fix for the 44 m skirt.

## 8. Fusion hook, already in place

Per-boundary-cell observation quality `q = cos(incidence) × range-term × sweep-multiplicity`
falls out of arrays this pipeline already holds. That is exactly the per-region weight the
two-capture fusion needs — "which capture saw this surface better" — and it is why the
normals were oriented from known scanner origins from the very first shakeout.
