# Venviewer — project instructions

Use your full engineering judgment to advance the user's actual objective. Own the
work from investigation through implementation and verification. Be ambitious,
resourceful and candid; neither agreement nor procedural activity is evidence.

The product is **Venviewer**. Existing `omnitwin` / `@omnitwin/*` repository and
package names remain valid; do not mass-rename them.

## Authority and current context

These are repository instructions, subordinate to the host's system/developer
instructions and the user's current direction. Within the repo:

1. The user's explicit instructions and recorded current founder amendments take
   precedence over older plans, personas and conventions. Preserve the scope of
   existing authorization, budgets, freezes and ownership.
2. This file is the canonical operating policy.
   [.claude/AI_INTEGRITY_RULES.md](.claude/AI_INTEGRITY_RULES.md) defines the evidence
   and correctness standard; it does not create a second workflow.
3. Accepted, applicable ADRs and current domain requirements constrain production
   implementation unless superseded by current user direction.
   Proposed ADRs, council discussions, old audits and generated designs are inputs
   to judgment, not approvals or permanent technical truth.

At task start, read this file and the integrity rules, then
[GOAL.md](GOAL.md) for current direction and operational constraints. Read the
latest notes, relevant task rows and dependencies, and shepherd protocol in
[docs/state/tasks.md](docs/state/tasks.md). Inspect the actual code, git status,
package manifests and relevant tests before changing them. Load applicable
conventions, ADRs and audits as needed; do not consume every historical document
or persona on every task. Follow additional instructions scoped to edited paths.

The task requested by the user comes first. For open-ended product work, use the
latest GOAL amendments and task state to choose the next unowned slice. Trades
Hall remains the priority; do not start unrelated product ideation. Dated state,
old "next task" numbers, gap audits and benchmark results must be checked against
current evidence. Inspect individual ADR status; index summaries can lag.

## Judgment, autonomy and follow-through

- Define the concrete outcome and acceptance evidence for non-trivial work, then
  proceed. Use plans to manage dependencies, not to make the user dispatch each
  step. No line quotas, prompt-count estimates, one-card-per-session limits or
  compulsory role announcements.
- Investigate uncertainty with available tools, source, documentation and small
  experiments. Do not ask the user to verify an API or run a check you can run.
  Bounded local experiments can test alternatives; keep them distinct from
  adopting a proposed architecture or deploying a production change.
- Challenge assumptions, including old architecture and your own preferred
  approach. For consequential choices, compare credible alternatives against
  the outcome, constraints and evidence. Prefer the least unnecessary complexity
  that meets the ambition; build new technology when evidence justifies it.
- Resolve routine implementation choices and reversible prerequisites yourself.
  Do not silently change product requirements. If a material conflict remains,
  identify the exact rule, the consequence and your recommendation. Ask only for
  a decision or authorization that is actually missing; an explicit instruction
  to change an old decision already authorizes that change.
- Continue independent work while a decision is pending. Persist through
  debugging, review fixes and verification until the authorized objective is
  complete or a concrete external blocker remains. Do not end an incomplete task
  with "ask me to continue" merely because it is large.
- Use available subagents for independent investigation, implementation or review
  when it improves quality or time. Assign bounded ownership, avoid concurrent
  edits to the same files, and integrate and verify their results. More agents
  or agreement between personas is not evidence of correctness.
- Use only tools and agents actually available in this session. Prefer installed
  source/types and version-matched official docs for API details; Context7 is an
  option when available, not a dependency. A missing plugin calls for a supported
  alternative before declaring a blocker.
- Respect the shared working tree. Preserve unrelated changes; isolate work where
  needed. Do not change source underneath a running verification or claim a
  stale/cached agent result describes the current revision.

## Engineering and product invariants

- TypeScript strict; no `any`, fake integrations, shipped skeletons or fabricated
  success. Validate external inputs at runtime. Do not silence type errors with
  unjustified assertions, suppression or weakened configuration.
- Work with the existing stack: React/R3F/drei, Fastify, PostgreSQL/Drizzle,
  Zustand, Vitest, Zod and pnpm workspaces. Read manifests and lockfile for exact
  versions. Spark renders splats, not drei's `<Splat />`; the Three.js runtime
  must meet Spark compatibility (accepted minimum 0.180). Do not casually replace
  core dependencies; evaluate a justified change within the user's scope.
- Retain venue tenancy, authorization, provenance and claim-safety boundaries.
  Prototype data and approximations must be identifiable. A visual match,
  passing test or review opinion is not operational certification.
- **All loading and working UI uses**
  `packages/web/src/components/shared/Activity.tsx`. Read
  [.claude/conventions/loading-and-working-motion.md](.claude/conventions/loading-and-working-motion.md)
  before changing any visible asynchronous flow. Preserve real state/progress,
  accessible status and reduced motion across all sessions and worktrees.
- **Beauty and Burke's sublime remain required**, together with clear agency,
  accessibility and correct behavior. Read
  [.claude/conventions/product-experience.md](.claude/conventions/product-experience.md)
  for the preserved founder brief and rejection history. Old dark/glass/palette
  prescriptions do not define acceptance. Blake judges aesthetics; tests and
  generated proposals cannot stand in for his verdict.
- Keep the founder's current cross-device quality, performance and reconstruction
  targets. Demonstrate them on the relevant scene, data and devices; a weaker
  result must not be relabelled as satisfying the target.
- Gaussian training follows the current Linux/RunPod programme and accepted
  environment decision. Confirm current inputs, executable path and spend
  authorization from GOAL and the active programme; old hardware names or prices
  are not permanent requirements.
- Local edits do not imply deployment. Observe current freeze, production-data,
  paid-compute and publication constraints. Never expose secrets. If committing,
  use explicit pathspecs and inspect the staged diff; never stage everything.

## Verification and communication

Use existing tests and add meaningful regression coverage for changed behavior.
Reproduce bugs before the fix where practical. Run the affected tests and required
lint/typecheck/build checks for the changed packages and dependency impact. Test
real boundaries for auth, tenancy, persistence, concurrency and external contracts.
For UI behavior and presentation, inspect the actual rendered flow with an
available browser and keep useful visual evidence. Mocks do not prove a live
integration; emulation does not prove physical-device performance.

Scale verification to the risk. Documentation-only edits need link, consistency
and diff checks, not a full application build. A small change does not require
a test for every helper or multiple ceremonial reviews. Broaden checks for shared
contracts, migration/security risk or failures; once appropriate checks pass,
finish rather than repeat them without a reason. Report existing failures without
hiding them or taking on unrelated repairs.

Keep progress updates concise and useful: findings, decisions, meaningful blockers
and next verification. Finish with the outcome, evidence and material limitations,
including local versus deployed status. No mandatory handoff template or empty
sections. If work is externally blocked, name what remains and exactly what would
unblock it. Preserve a concise resumption note for long work; use available
context continuation instead of making the user re-prompt each chunk.

## Durable project knowledge

- Keep active task status and evidence current using the
  [shepherd protocol](docs/state/tasks.md#shepherd-protocol). Record meaningful
  completed work, decisions and blockers in `docs/sessions/YYYY-MM-DD.md`.
- Architecture decisions live in `docs/architecture/adr/`; accepted records are
  historical artifacts. Record a revision or superseding decision rather than
  rewriting history. Separate proposed choices from adopted ones.
- Use [docs/strategy/authority-map.md](docs/strategy/authority-map.md) for domain
  ownership. Existing `cockpit*` names stay; current product language uses
  Floor/House/Diary where applicable. Build cards are scoped briefs, not fixed
  session limits or proof of present implementation.
- Operational records live in `state/`; diagrams in `docs/diagrams/` are views of
  source records. Update diagrams affected by your change, not every diagram.
- Keep this core small. Put a learned, evidence-backed trap in a specific
  convention/gotcha with a clear "Read this when" trigger. Update or replace stale
  guidance instead of appending another universal prohibition. Memories, if
  available, are retrieval aids and must be checked against current source.
- [.claude/SQUAD_PROTOCOL.md](.claude/SQUAD_PROTOCOL.md) and the squad/council files
  offer optional review lenses. Load only useful ones or those the user requests.
  Names such as Architect and Mr. Computer confer no authority or credentials and
  do not limit the agent's general reasoning or ability to cross disciplines.

## Specific Gotchas & Conventions — Load When Triggered

- `.claude/conventions/loading-and-working-motion.md`
  Read this when: adding or changing any user-visible loading, saving,
  searching, uploading, exporting or other asynchronous working state.

These triggers are routing aids. Load relevant references and follow additional
ones when task evidence makes them useful; avoid unrelated bulk reads.

- `.claude/conventions/product-experience.md`
  Read this when: designing, implementing or reviewing a visible surface,
  interaction, motion or visual target.

- `.claude/gotchas/spark-vs-drei-splat.md`
  Read this when: rendering a Gaussian splat (`.ply`, `.spz`, `.splat`
  file), modifying any 3D scene component that displays splats, or
  seeing drei's `Splat` component imported anywhere in this repo.

- `.claude/gotchas/windows-v8-heap.md`
  Read this when: adding or modifying a `vitest.config.ts`, writing a
  new `typecheck` script, or seeing `MemoryExhaustion` / OOM errors
  during `tsc --noEmit`, `vitest run`, or `pnpm -r run …` on Windows.

- `.claude/gotchas/zod-passthrough-inference.md`
  Read this when: writing or modifying a Zod schema that combines
  `.passthrough()` with `.default()` or `.nullable()` members, passing
  a schema as the generic argument to a `ZodType<T>`-typed client
  helper (e.g. `api.get<T>(path, schema)`), or debugging cascading
  `objectInputType vs objectOutputType is not assignable` errors at
  the api client boundary.

- `.claude/gotchas/spark-splat-layer-callback-identity.md`
  Read this when: passing `onLoad`/`onError` to `SparkSplatLayer`,
  wiring a splat scene's progress to React state, or debugging a splat
  scene that reaches its "loaded" state but renders a blank canvas
  (especially when it works on localhost and fails deployed).

- `.claude/gotchas/splat-camera-and-capture.md`
  Read this when: building or tuning a camera over a Gaussian splat,
  capturing stills of a splat scene offline, or deciding where to put a
  viewer inside a captured room.

- `.claude/gotchas/dockerfile-arg-scope.md`
  Read this when: editing the Dockerfile, changing the pnpm or Node version
  the API image uses, or a Railway build fails inside pnpm install with an
  error the pinned pnpm cannot produce.

- `.claude/gotchas/xgrids-lcc2-lod-levels-are-copies.md`
  Read this when: loading, staging, counting, or budgeting XGRIDS LCC2 splat
  tiles, adding a room to the walk or planner, or explaining why an on-screen
  splat count disagrees with the XGRIDS build report.

- `.claude/gotchas/pycolmap-windows-traps.md`
  Read this when: calling pycolmap (feature extraction, matching,
  triangulation, `Database`) on this Windows machine, building or
  reading a COLMAP `database.db`, or writing a `sparse/0` model COLMAP
  must load next to a database.

- `.claude/gotchas/browser-pane-splat-streaming.md`
  Read this when: verifying any splat route in the embedded Browser pane, or
  reading a black splat canvas or a stuck "Streaming the room" pill there as
  evidence about the site.

- `.claude/gotchas/interior-camera-pose-identity.md`
  Read this when: passing `spawn`/`bounds` to `InteriorCamera`, adding state
  or a poller to the walk page or scene, or reading a report that the walk
  "rubberbands" or snaps back to its start after a drag, wheel or key.

- `.claude/gotchas/spark-invisible-splat-load.md`
  Read this when: hiding a Spark splat layer to reveal it later (a level swap,
  a cross-fade, a preloaded tier), setting `visible={false}` or `opacity={0}`
  on a SparkSplatLayer, or seeing a splat scene render as unsorted colour
  blobs that a camera move repairs one tile at a time.

- `.claude/gotchas/spark-render-target-effects.md`
  Read this when: adding any effect that renders the scene to an
  off-screen target (drei `ContactShadows`, `Environment` probes,
  `useFBO`, EffectComposer passes) into a scene containing a Spark
  splat, or debugging a splat scene whose floor erupts into unsorted
  colour blobs after an unrelated visual addition.
