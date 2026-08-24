# Claude → Codex: Grand Hall handoff and proposed sequence (2026-08-24)

From: the Claude session that reviewed your universal-foundry work (29-agent
deep review, adversarial verification, results summarised below).
To: the Codex session continuing on `codex/universal-foundry`.
Arbiter: Blake. If you disagree with anything here, say so with evidence —
Blake decides. This note asks for your explicit agreement or counter-proposal;
it is not an order.

Companion document: `docs/strategy/grand-hall-visual-canonical-directive.md`
(Blake's directive, amended). Read that first; this note is what one agent
wants the other to know, peer to peer.

---

## 1. Things that happened outside your thread — you need these

**1.1 I committed your worktree.** Your 104 uncommitted files (~25k lines) in
`C:/Users/blake/omnitwin2-universal-foundry` are now commit
`2ba77de2 wip(foundry): commit the universal-foundry working state` on your
branch. Nothing was edited — committed exactly as found, no review implied. I
did this because the only copy sat on a 96%-full disk, never pushed. Please do
not be surprised by it, do not reset it away, and do not squash it into
oblivion without keeping its content. Backups exist independently:
`F:/omnitwin2-backups/universal-foundry-uncommitted-2026-08-24.tgz` and a
verified `universal-foundry-branch-2026-08-24.bundle`.

**1.2 Master moved 112 commits while you worked.** Your branch forked
2026-07-20 at `8b9dd430`. Since then, on master:

- `43be45c0` — the scene is now **true metres** (`RENDER_SCALE = 1.0`). Your
  branch still has 2.0. Every eye-height/collision/boundary number differs by
  2× on X/Z between your world and master's.
- `a82ef463` — generated furniture proxies for the **whole placeable
  catalogue** (17 factories). Your `TimelinePreviewFurniture` imports
  `FurnitureProxy` / `InstancedFurnitureLayer`, both rewritten there.
- `d5faa397` — the web test suite now **fails any unstubbed fetch to any
  loopback address** (happy-dom's default origin is `localhost:3000`; the old
  guard only caught 3001). Web tests you wrote that fetch relative URLs
  without stubs will now fail loudly rather than flake.
- `0062_quiz_runs` — a migration now occupies the number your `0062` uses;
  your `0063` and the evidence-graph branch's 0064–0067 compound the
  renumbering.

**1.3 Verified traps in your path.** Each checked directly on disk, not
inferred:

- `info/poses.json` in every LCC2 variant is **one 2,561,254-byte line**;
  `FOUNDRY_CALIBRATION_TRAJECTORY_LINE_MAX_BYTES` is 1,048,576. The only
  splat→E57 registration key on disk is unreadable until that cap is raised
  or the parse streams.
- Your SOG gateway pins `Grand_Hall_Small.lcc2` (sha256 `f4ba054a…`) and
  **refuses** `C:/GRAND_HALL_BIG_MODEL_VARIATIONS` at the manifest-name check.
  The Small dataset's on-disk location is recorded nowhere in the repo. You
  are the only party who knows where it is.
- drei render-target effects corrupt Spark's splat sorting (verified with
  `ContactShadows`: the floor exploded into unsorted blobs). Same family as
  the repo's "never drei `<Splat/>`" rule. Grounding shadows must cost no
  extra render pass.
- `SparkSplatLayer` callbacks must be identity-stable (`useCallback` with `[]`
  deps) or every tile disposes and refetches — see
  `.claude/gotchas/spark-splat-layer-callback-identity.md`.
- Your registration schema self-validates with bit-exact `===` re-solve of
  floating-point math. It has only ever run on Windows. The repo's own history
  says Windows-green ≠ Linux-green; a proposal compiled here may fail parse on
  CI. Worth a deliberate tolerance decision, not an accident.
- The rights gates you built are doing their job: 310 `requires_review` stamps
  and `vendor_or_opaque_package` lanes will keep printing "blocked" regardless
  of the directive's §1 prose, until an owner-authority record exists that the
  readiness logic actually reads.

**1.4 What I deliberately did not do:** no push (Blake's call), no rebase of
your branch (yours to do deliberately), no worktree pruning (Codex worktrees
`7215` and `84aa` hold unmerged API work that exists nowhere else — do not
clean them either).

---

## 2. Proposed sequence — do you agree?

In dependency order. S1–S2 are minutes; S3 is the risky one; S4–S6 are the
real work.

- **S1. Keep `2ba77de2`; commit small increments from now on.** Never again
  hold >100 files uncommitted on this branch.
- **S2. Record where `Grand_Hall_Small.lcc2` lives** (path + sha256) in
  `docs/operations/`, so the one rendering dataset stops being findable only
  from your session memory.
- **S3. Bring true metres into your branch before any human-scale/structural
  work.** Either rebase onto master (resolving 0062/0063 renumbering,
  `CockpitBottom`/dock conflicts, and the `TimelinePreviewFurniture` imports
  against `a82ef463`), or — if you judge the full rebase too risky in one
  pass — cherry-pick `43be45c0` and `a82ef463` first and schedule the full
  reconciliation as its own task. Building eye-height and collision at
  `RENDER_SCALE 2.0` produces numbers that are wrong on arrival.
- **S4. Lift the calibration line cap and parse `poses.json`** (streaming or
  raised bound, with a receipt). This unlocks splat→E57 registration —
  everything in Phase 2 of the directive gates on it.
- **S5. Build the fixed-camera lineage harness** pointed at the right data:
  the Small dataset the runtime actually serves, plus the 9
  `scans_BIG_MODEL_TH_GH_*` variants as lineage-A/Phase-4 baselines. No
  generative polish before this locates where quality is lost.
- **S6. Continue viewer beautification on the compositor contract**, extending
  ADR-009/010/012/013 rather than adding a parallel schema, and add the
  code-level owner-authority record so the rights gates can clear through the
  evidence chain.
- **S7. Report using the directive's §12 return format**, and answer §3 below
  explicitly.

---

## 3. Questions I want you to answer directly

1. **Do you agree with S1–S7 and their order?** If not, which steps would you
   reorder, replace or reject — and on what evidence?
2. **Rebase or cherry-pick for S3?** You know your branch's internals best;
   I've verified the collision list, but you may know a safer path.
3. **Where is `Grand_Hall_Small.lcc2` on disk?** (Answer by doing S2.)
4. **Is anything in §1 factually wrong?** I verified each claim directly, but
   you wrote this code; if my reading of your gateway, caps or schemas is
   mistaken anywhere, correct me with file:line.
5. **The bit-exact `===` re-solve (§1.3):** deliberate, or an oversight to fix
   before CI runs on Linux?

Disagreement backed by evidence is more useful to Blake than compliance.
Write your answers into your §12 return; Blake arbitrates anything we
disagree on.

— Claude (Fable 5), 2026-08-24
