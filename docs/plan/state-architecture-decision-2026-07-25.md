<!-- Produced by a 12-agent design programme (4 audits, 3 competing architectures,
3 adversarial judges, 1 novel-capability proposal, 1 synthesis). Every claim was
checked against the files; eight corrections to the inputs are recorded inside. -->

# Store Consolidation, the Five Features, and One New Capability — Decision

**Date:** 2026-07-25 · **Status:** decided, ready to execute · **Branch context:** `feature/diary-p0-slice-3`, 469 dirty files across 4+ parallel lanes

Every fact below was checked against the files, not inherited from the audits. Where an audit or proposal was wrong, I say so and give the line. Eight such corrections are in §6.

---

## 0. What I verified before deciding

| Claim | Verdict |
|---|---|
| zustand `5.0.3`, React `18.3.1`, **zero** `useShallow` uses in `packages/web/src` | confirmed |
| 469 dirty files / 114 in `packages/web` / **2** in `packages/web/src/stores` (both untracked, timeline lane) | confirmed |
| `editor-store.ts`, `placement-store.ts`, `selection-store.ts`, `EditorBridge.tsx`, `SelectionSystem.tsx`, `packages/types/src/action.ts` — all **clean** | confirmed |
| The five gate suites pass **now**: 5 files, **110** tests, 5.03s | confirmed by running them |
| `ActionSchema` is `.strict()` (`packages/types/src/action.ts:101`); the API ingest is `ActionLogBatchSchema.safeParse` → **400** (`packages/api/src/routes/action-log.ts:76`) | confirmed |
| `configuration_layout_revisions`: 4 insert sites, **0** selects | confirmed |
| `runLayoutValidator` has **0** production consumers (2 api test files only) | confirmed |
| `addObject` / `removeObject`: **0** non-test callers | confirmed |
| `entry.seq` exists, is documented as the stable gesture key, and is **not** serialized into the Action | confirmed |
| `PlacedAt<T>.object` carries the **full** object, so logged payloads do contain `assetDefinitionId` | confirmed |

And four things nobody in the input found, all load-bearing:

**A. The trail has no base state.** `loadConfiguration` (`editor-store.ts:456-506`) writes `objects` directly with `history: emptyHistory()` and emits no Action for the loaded objects. `replayActions` starts from `objects: []`. So `documentAtOrdinal(entries, n)` reconstructs **only objects added within the retained trail** — for any configuration reopened in a later session it reconstructs an *empty room* and every subsequent `object.update` produces an `updates X, which is not present` issue. This is why `configuration_layout_revisions` matters, and it silently gates deep undo, version restore, session replay, and the proposed novel capability. Nobody noticed because the replay bridge is DEV-gated at `EditorPage.tsx:186`.

**B. The autosave timer is source-pinned to `EditorBridge.tsx` by a fourth file.** `packages/web/src/__tests__/save-send-panel.test.ts` asserts, by regex over source text, that `flushAutoSave` is *exported from EditorBridge*, that the send flow *imports it from EditorBridge*, and that `clearTimeout(bridgeSaveTimer)` appears within 300 characters of `flushAutoSave` **in EditorBridge.tsx**. All three proposals called re-homing that timer "behaviour byte-identical, revert two files." It is not: it breaks three architectural pins in a file none of them mentioned. (Also: the importers are `send-layout-flow.ts:5` and `SubmitForReviewPanel.tsx:7` — **not** `SaveSendPanel`, which every proposal claimed.)

**C. `placedItems` reaches the server.** `GuestEnquiryModal.tsx:83` and `:137` read `placedItems`, `:142` derives the seating style from it, `:160` calls `submitGuestEnquiry`. So the mirror is an input to a server-bound payload, not merely a scene cache. Proposal 1's premise that `objects` is "the only thing reaching the server" is false — and this makes the divergence *worse*, which strengthens the case for the fix.

**D. `rearrangeTableGroup` reorders today.** `packages/web/src/lib/table-group.ts:274` returns `[...others, table, ...newChairs]`. The "content-identical reorder" hazard everybody filed as *latent* is **live**, and `diffObjects`' own docstring assumption that nothing reorders is already false.

---

## 1. THE VERDICT

### Winner: **The Commit Funnel (Proposal 3), as the spine — with Proposal 2's mechanism as the body**

Proposal 3 wins on the one thing that actually explains the failure being investigated. G4 read the "consolidate at G4" flag in `docs/plan/06-GAP-AUDIT.md` §5 and added three store modules anyway, because **nothing failed**. Prose lost to prose. Proposal 3 is the only submission whose first deliverable is a machine-checkable answer to "is this a legal store?" — one new file, `packages/web/src/__tests__/store-architecture.test.ts`, run as its own CI step. That step has verified in-repo precedent: `.github/workflows/ci.yml:141-142` runs `public-claim-guard.test.ts` as a dedicated step *before* `pnpm -r test` at `:144-145`, exactly so an unrelated red suite cannot shadow it.

It is also the cheapest thing in any of the three plans and the only part that is fully immune to 469 dirty files.

### Grafted from the losers

- **From Proposal 2 — the identity-memoized projection.** `projectPlacedItems(objects)` behind a `WeakMap<readonly EditorObject[], readonly PlacedItem[]>`, with `placedItems` kept as a real store field of unchanged name and type. This is the single best idea in the whole input and it is non-negotiable. All 23 non-test read sites are plain field reads; zustand 5.0.3 compares selector output with `Object.is` and the codebase has **zero** `useShallow`. A computed selector returning a fresh array would loop or `getSnapshot`-bail at ~20 sites, several inside the Canvas, and the failure would look like a rendering bug. **The audit's headline recommendation — "make placedItems a derived selector" — is wrong on this codebase and must not be implemented literally.**
- **From Proposal 2 — the strangler ordering** (close raw-setState holes → unify geometry → invert authority → delete legs), and its honesty rule: *every step ships one new characterization test written green against the OLD code, plus the four document suites unchanged.*
- **From Proposal 1 — `seq` and `coordinateSpace` on the Action envelope**, and the single id-healing applier. Both are prerequisites for four of the five features and neither requires consolidation.
- **From Proposal 1 — pure geometry extraction with `dimensions` as an explicit parameter**, killing the six undeclared `useRoomDimensionsStore.getState()` reads inside placement actions.

### Fatal flaws, and how each is fixed

**Proposal 3's fatal flaw (judge 3):** steps 5 and 8 have contradictory proof obligations — the pure ops must stay `PlacedItem`-typed for the 41-test oracle to hold, but step 8 deletes `placedItemToEditor`, so the funnel must still perform exactly the conversion being deleted.

**Fix — decided now, so nobody discovers it mid-refactor.** The extracted ops stay `PlacedItem`-typed. `PlacedItem` is already the established projection type (`layout-timeline.ts` and `layout-timeline-preview-store.ts` use it that way against server keyframes). `commitDocument` performs **one total, field-exhaustive conversion** with a compile-time exhaustiveness assertion over `EditorObject`'s keys, so `rotationX`, `rotationZ`, `scale`, `sortOrder` and `notes` can never again be silently dropped. That is a named, tested, single-site conversion — categorically different from today's two ad-hoc converters inside a React effect, one of which drops `scale` outright (`EditorBridge.tsx:56-70` never copies it; `InstancedFurnitureLayer` reads `item.scale ?? 1`, so a persisted 1.05 renders at 1.0). **The disease is the second write authority, not the existence of a projection type.**

**Proposal 2's fatal flaw (judge 2):** step 1 — deleting leg C — is presented as the safest change and is actually the riskiest. Verified: `captureSelection` (`editor-store.ts:324-330`) prefers selection-store and **falls back to `selectedObjectId`**; `historyStepPatch:425` writes `selectedObjectId` on every undo/redo; `removeObject:626` (which clears it) has zero non-test callers, so 3D deletes never reach it. Leg C is the only thing that clears `selectedObjectId` when the 3D selection empties. Delete it alone and a stale id gets baked into `selectionBefore`/`selectionAfter` of a production Action and restored by the next undo.

**Fix:** leg C is deleted **last**, together with the `captureSelection` fallback and after `BlueprintPage` writes selection-store instead of `selectedObjectId`. Selection collapse is step 8, not step 1.

**Proposal 1's fatal flaws:** (i) the two-type conversion survives inside `dispatch` — addressed above by making it one exhaustive site; (ii) its step 3 would **break production**. It says land the web/types half first and the api half second. `ActionSchema` is `.strict()`, `BoundedActionSchema` composes it, and the ingest returns 400 on a parse failure. Web auto-deploys on Vercel; the API ships only by manual `railway up`. Web-first means **every browser's action batches are rejected and audit-log ingestion stops entirely** until someone remembers to deploy the API.

**Fix:** API first, always. Non-negotiable, and repeated in §5.

**Proposal 3's rule (f)** — "no new module-level `let` in `components/`" — guards nothing useful. `sectionClipPlanes` is `export const` (`SectionPlane.tsx:16`), and the only two real `let`s in `components/` are `mountedInstances` and `bridgeSaveTimer`, both in `EditorBridge.tsx`, both of which this plan deletes. **Rewrite the rule to ban exported mutable containers in `components/`**, which is what actually catches `sectionClipPlanes`.

### Explicitly rejected

- **"26 stores → one store."** The end state is not one store. Four stores are written from `useFrame` or rAF (`visibility-store.wallOpacity`, `xray-store.opacity`, `bookmark-store.updateTour/updateTransition` at `CameraRig.tsx:484/:541`, `layout-timeline-preview-store.setProgress`). Merging any of them into a store the log or history engine observes violates the no-per-frame-log constraint *by construction*. `layout-timeline-preview-store` got the boundary right and is the template, not a target.
- **The GAP-AUDIT §5 wording.** "visibility-store vs cockpit-store toggles" is refuted: visibility-store toggles physical surfaces, cockpit-store toggles six analytic overlay keys plus `layerMode`; the key sets are disjoint and neither reads the other. A refactor aimed at the literal wording would merge the wrong two things. The real third copy is local `useState` in `TradesHallVisualPage.tsx:1482/:1488`, which no store refactor will find. **Amend §5 in the same commit as step 2** rather than leaving a wrong flag open.
- **Tier 2 type narrowing as a blanket change.** `ReadonlyStoreApi` is declared but *not exported* by zustand (`react.d.ts:2`), so it must be redeclared locally; and `tsc --noEmit` covers tests, where there are 46 + 58 `setState` sites across 28 files, three currently dirty. Keep it, gate it, ship it last, and accept a test-only escape export policed by the arch test.
- **Fixing the audit-integrity holes inside this programme** (unlogged proposal send, no rig persistence, view state leaking into the review PNG, markup as browser-local truth). All verified real. All out of scope. Rule (d) makes them *cheaper* to fix by forcing classification; it does not fix them, and a store refactor is not an audit fix.

---

## 2. THE SEQUENCED PLAN

Ten steps. Each is one commit with an explicit pathspec (`git commit -- <paths>` — never `-a`, never a stash; 469 dirty files include four other lanes' uncommitted work). Re-run `git status --porcelain -- <file>` immediately before editing each file; a file that went dirty between plan and edit is a stop-and-coordinate, not a merge.

**🟢 = safe while 4 sessions edit 463 files. 🟡 = safe with care. 🔴 = wait for a quiet tree.**

| # | Step | Proof | Revert |
|---|---|---|---|
| **0** 🟢 | **Coordination gate, no code.** `packages/web/src/lib/time-machine.ts` is untracked (177 lines) and its header states the "one engine, three questions" thesis verbatim; `action-log-replay.ts` is dirty with the matching `layout.restore` change. Get that lane's Definition of Done in writing and record the scope split in `docs/state/tasks.md`. Two engines plus a merge conflict in `action-log-replay.ts` is the worst available outcome. | A written scope split. | free |
| **1** 🟢 | **Ship the ratchet.** New `packages/web/src/__tests__/store-architecture.test.ts`: exact-set store manifest with a `document\|projection\|ephemeral\|infrastructure` bucket and a justification string per entry; the 12 non-test `use*Store.setState` sites as a shrink-only allowlist; only the funnel may import `editorToBatch`/`authBatchSave`/`publicBatchSave`; anything bucketed `document` must appear in the action-log emitter manifest; no store may import from `../components/`; **no exported mutable containers in `components/`**. Add a dedicated CI step after `:142`. | Prove it fails: add a 27th store file and a 13th setState site, watch both fail, revert. | delete 1 file + 3 CI lines |
| **2** 🟢 | **Pin the five behaviours a consolidation breaks silently**, plus amend GAP-AUDIT §5. New `editor-bridge-invariants.test.ts`: (a) leg A's raw `setState` at `:192` skips the entire snap engine; (b) the `configId === null` drop at `:205` is **permanent**, because `prevItems` advances at `:203` *before* the guard, so the change is never re-detected; (c) `itemsMatch` never compares `assetDefinitionId` despite its docstring claiming "all mutable fields"; (d) `rearrangeTableGroup` produces a reorder that `diffObjects` treats as a no-op; (e) a drag writes `localStorage` per pointer event. | The new file itself — all five are unpinned today. | delete 1 file |
| **3** 🟡 | **Anchor the trail. This is the highest-leverage step in the document.** Emit one `object.place` Action at `loadConfiguration` recording the opening document (or read `configuration_layout_revisions` as the base) so replay starts from a real state instead of `[]`. Without it, deep undo, restore, replay and the novel capability all reconstruct an empty room for any reopened configuration. Also fix the write-only revisions table: add a read endpoint and a retention policy — the 3000 ms autosave debounce writes roughly one full-layout snapshot every three seconds with no pruning. | New test: replay of a load-then-edit session reconstructs the full document with **zero** `is not present` issues. Today it reconstructs 0 objects and N issues. | additive Action intent; revert one call site |
| **4** 🟡 | **Envelope fields — API FIRST.** Migration + `NOT NULL` `coordinate_space` with a recorded backfill decision, plus `seq`, plus a tolerant ingest, deployed by `railway up`. **Then** widen `ActionSchema` and have `actionFromHistoryEntry` copy `entry.seq`. Every existing `action_log` row carries render-space X/Z at `RENDER_SCALE = 2.0` with no unit marker, while `configuration_layout_revisions` and `phase_layout_snapshots` both declare `REAL_METRE`. | `packages/api/src/__tests__/schema.test.ts` + a **local** api run against the portable PG stack (`pnpm -r test` gives the api suite no signal) + `editor-store-action-log.test.ts` asserting a sealed Action's `seq` survives the id-remap clone. | drop 2 columns, revert 3 files |
| **5** 🟢 | **Close the two raw-setState holes.** Add `hydrateFromDocument(items)` (replacing `EditorBridge.tsx:192`) and `rotateItems(ids, delta)` (replacing `SelectionSystem.tsx:192-198`). Add the missing `try/finally` around the `syncing` ref while here — set true at `:186` with no finally, so a throw in `editorToPlacedItem` wedges sync dead for the session. | `placement-store.test.ts` (41) unchanged. New: N rapid Q presses inside `HISTORY_COALESCE_WINDOW_MS` still yield one undo entry — Q/E/R never touched `interactionEpoch`, so coalescing is byte-identical either way and the "needs a T-447 decision" worry is resolved by construction. | additive actions |
| **6** 🟢 | **Extract the geometry as pure functions** into `lib/placement-ops.ts`, `(items, dimensions, …) → items`, removing the six `useRoomDimensionsStore.getState()` reads. Then make `editor-store.moveObjectsByDelta` call the same `computeSurfaceHeight` that `moveItemsByDelta:479` calls — its docstring already claims it mirrors it and it never writes `positionY`, so 2D drags onto a platform float or sink in 3D. | **`placement-store.test.ts` must pass with zero edits — that is the whole proof.** If an assertion needs changing, the extraction was not pure. Plus a RED-first test for the y-term. | delete 1 file, revert 2 |
| **7** 🟡 | **Re-home the autosave scheduler** to `lib/planner-autosave.ts`. **Named cost the proposals missed:** this breaks three source-scanning pins in `save-send-panel.test.ts` (`:169`, `:198`, `:203`). Rewrite them to assert the *intent* — the send flow forces a flush before the modal can open, and the flush cancels the pending timer — against the new module. Do not delete the assertions. | `editor-bridge.test.ts:203-228` (undo → 3000 fake ms → `publicBatchSave` once) must pass **unmodified**; the three rewritten pins reviewed line by line. | revert 3 files |
| **8** 🔴 | **The load-bearing step. Introduce `commitDocument(intent, mutate)` and delete leg B.** One exhaustive conversion, one write to `objects`, one projection refresh. Leg A's raw `setState` becomes a **one-way `useEditorStore.subscribe`** that projects on `objects`-identity change — **not** a line inside `commitDocument`, because `undo`, `redo`, `loadConfiguration`, `reset` and the post-save server echo all write `objects` without going through the funnel, and folding the refresh into the funnel would stop undo moving furniture. Register with an immediate projection, or an async load that resolves before the subscribe leaves the room empty. | `editor-store-history.test.ts` (**32**, not 48) and `editor-store-action-log.test.ts` (5) must pass byte-identical — verified: neither imports placement-store. Step 2's invariants file **inverted, diff reviewed line by line**. `editor-bridge.test.ts:127` and `:169` must be rewritten to drive real placement actions. Plus a `getSnapshot`-stability test and a hand-run `FRAME_BUDGET_FAIL=true` measurement before and after. | one atomic revert |
| **9** 🔴 | **Collapse selection.** `BlueprintPage` writes selection-store; `captureSelection`'s fallback is removed; leg C dies; `selectedObjectId` becomes a read-through; selection is cleared at the configuration boundary via the existing `beginActionLogForConfig` seam. Its own commit, nothing else in the diff. | `editor-store-history.test.ts` unchanged; `editor-bridge.test.ts:31-66` rewritten; new pin that selection is empty after a config switch. | riskiest revert — land alone |
| **10** 🔴 | **Type barrier + verbs.** Narrow the exported handles to a locally-declared readonly API with a test-only escape export; give the seven semantic verbs (`placeChairBrush`, `placeTableGroup`, `rearrangeGroup`, `autoArrangeBanquet`, `autoArrangeTheatre`, `groupItems`, `moveGroup`) real intents and an actor parameter. | `typecheck` is the proof for the barrier; per-verb intent assertions for the verbs. | revert annotations |

**Steps 0–2 and 5–6 are the abandonable core.** If the programme is cancelled after step 6, the ratchet stops the 27th store, five silent-break behaviours are pinned, the 2D/3D surface-height divergence is fixed, and nothing is half-migrated. Steps 8–10 wait for the tree.

---

## 3. THE FIVE FEATURES

All five share one prerequisite nobody named: **the trail has no base state** (step 3). Until that lands, every fold over the log reconstructs only what the log added.

| Feature | Verdict | Honest reason |
|---|---|---|
| **Operator-facing session replay** | **Buildable now — and already 90% built, but currently wrong** | `replayActions` exists behind a real gate (strictly increasing ordinals, no duplicate ids, an inverse on every mutation) and `change-history-model.ts` already renders it claim-safely. It is DEV-gated, which is why nobody noticed it reconstructs an empty room for any reopened configuration. Needs: step 3, then a `ReplayObject → PlacedItem` adapter, then keyframing (`documentAtOrdinal` re-runs the whole replay per ordinal — O(n) per scrub tick). Read-only; renders into `layout-timeline-preview-store`; never touches the live document. |
| **Deep undo past the 100-entry cap** | **Buildable now** — needs step 3 + step 4's `seq` + one applier | Substrate complete: eviction drops oldest-first from `past`, but every evicted gesture's exact inverse is already in the log (`action-log.ts:56-67`). The blocker is that **there are two appliers and they differ in the way that matters**: `performUndo`/`performRedo` run `buildHealMap` first to re-mint local ids for resurrected server rows, because "the batch save silently skips updates addressed to deleted rows"; `applyDelta` in the replay engine has **no** healing. One is safe for the live document, one only for a throwaway reconstruction. |
| **Version restore** | **Needs consolidation for the honest version** | `configuration_layout_revisions` is a full per-revision snapshot with `actorUserId`, `source`, and an explicit `coordinateSpace`, written by four paths and read by **none**. It has been accumulating the restore substrate in production the whole time, with no retention. But "the layout" is not one thing: objects are server-side, markup is one browser's localStorage, the lighting rig has **no persistence at all**, and event details live in `configurations.metadata`. Restore today gives back Tuesday's furniture with today's markup, today's rig, today's instructions — and nothing would say so. |
| **AI copilot** | **Needs consolidation** | The legal frame is already airtight: `AIActionProposalSchema` is a discriminated union over `status`, so `accepted` structurally requires a recorded acceptance, and actor kind `ai` is first-class through to the UI label. Two things block it, both fixed by step 10: `plannerActionContext` always returns `currentOperator()`, so an AI's work would be recorded as the *operator's* — voiding the exact law the type system encodes; and `intentForDelta` derives intent from delta **shape**, so `autoArrangeBanquet(id, 240, 10)` logs as `object.place` / "Place 240 items". A copilot whose tool API is the Action schema can only nudge boxes. |
| **Multiplayer** | **Needs external infrastructure — do not start** | Unconditionally impossible without one writer, and for a precise reason: the bridge **discards** writes. `if (syncing.current) return` at `:185` and `:205` means a remote patch arriving inside a push window is silently dropped by design, and the `configId === null` drop is *permanent* because `prevItems` advances first. Beyond that: `PlacedAt.index` is a positional array index and `insertAscending` splices by it, so concurrent inserts do not commute — the envelope is CRDT-*adoptable*, the delta inside it is not a CRDT operation. Also needs a cross-replica backplane (the event bus says in its own comment it is in-process), and note the layout WebSocket at `ws/auto-save.ts:409` is fully built and **no client connects to it**. |

### Build first: **operator-facing session replay**

Not because it is the most valuable feature — it isn't — but because it is the cheapest way to make the substrate honest. It is read-only, safe against a dirty tree, already mostly written, and **building it correctly forces step 3**, which four of the five features and the novel capability all silently depend on. It also converts a DEV-only curiosity into the operator-facing surface that proves the audit trail is real. Everything else gets cheaper afterwards.

If the business needs one shipped thing this month instead, it is not on this list: `cockpit-store.plannedGuestCount` is never persisted, while `configurations.guest_count` exists, is PATCHable, and is already rendered to the approver as `Guests: {entry.guestCount}` — and the web client's own `ConfigurationResponseSchema` **omits the field entirely** so it cannot even read it. The operator plans to 250; the human approving that configuration sees 0. That is a two-endpoint fix worth more than this refactor, and it belongs in the same week.

---

## 4. THE NOVEL CAPABILITY

**Adopt Candidate A — "What changed this": rule-status attribution at gesture granularity over an inverse-carrying decision record.** Reject B (the repo already specifies the document-level version — `configuration-sheet-snapshot.ts`'s own header describes the "snapshot diverges from live" banner) and C (its headline number, flip duration, depends on labour-time data the repo does not have and cannot derive from captured truth — the best demo and the worst truth claim).

**Novelty claim, stated honestly.** The concept is old: this is `git bisect` plus CI, and Solibri Model Checker / Navisworks Clash Detective have run rule checks against BIM model *versions* for years. What does not exist anywhere is the **granularity**: Solibri compares coarse, manually published versions and cannot attribute a violation to an authoring gesture, because BIM has no per-gesture log carrying its own inverse. Figma has the history and no rules engine. AllSeated/Prismm have neither. The moat is not the photoreal capture — it is the decision record plus a rule kernel that is a *pure function of a canonically-digested snapshot*, so it can be run against a reconstructed historical document. `sha256Hex` in `canonical-layout-snapshot.ts:358` is hand-rolled synchronous pure JS, no `node:crypto`, no async WebCrypto — the whole kernel including digests runs in a Web Worker.

**Two corrections to the proposal as submitted.**

1. `runLayoutValidator` does not have "ZERO consumers" — it has two api *test* consumers (`phase-layout-snapshot-postgres.test.ts`, `phase-layout-snapshot-service.test.ts`) and is exported from the types barrel at `index.ts:2420`. It has **zero production consumers**, which is the true and still-remarkable claim.
2. The proposal's stated kill risk — "the payloads may not carry `assetDefinitionId`" — **resolves favourably.** `PlacedAt<T>.object` carries the full `T`, and in editor-store `T = EditorObject`, so logged `added`/`removed` payloads contain `assetDefinitionId`, positions, rotation and scale. The one-hour spike it proposed is already answered.

**The real blocker is step 3, and it is disqualifying until fixed.** Running a validator against a document reconstructed from an unanchored trail does not produce a weak verdict — it produces a **confidently wrong** one. An empty or partial room passes the clearance check because there is nothing in it to be too close to. That is not a limitation to disclose; it is a false claim generated by the system, on the surface whose whole purpose is claim safety. **This feature must not ship before the trail is anchored.**

**Claim-safety obligations**, each structural rather than a disclaimer:

1. **Causation.** The log records order, not cause. "The change after which this check first reported a fail." Add `caused` and `responsible` to the banned list enforced by `public-claim-guard.test.ts` (its `SCAN_ROOTS` already cover `src/components/editor`).
2. **Non-monotonicity.** Status can flip pass→fail→pass→fail, so a plain binary search over the trail is unsound. Coarse-scan at the `structural` markers `timelineMarkers()` already flags, bisect only inside a bracket whose endpoints differ, report the **most recent** flip, and actively disclose earlier ones.
3. **Retroactive validation with today's data — the biggest risk.** The document replays faithfully, but dimensions come from today's catalogue and the clearance threshold, price book and floor outline from today's context. A historical verdict is "what today's rules say about that old arrangement," never "what we told anyone at the time." The kernel already emits `validatorDigest`, `contextDigest` and `policyRefs`; surface the rule version in the UI, not in a comment.
4. **Simulation ≠ measurement.** The derivation is `layout.geometry.convex_distance` over nominal catalogue footprints — not a measured gap and not a fire-safety approval. `warn` reads "near the threshold — venue operations should review", never "safe". Surface the existing `reviewGate` rather than flattening it.
5. **Insufficiency must look like insufficiency.** Unresolvable asset → `not_checked` / `degraded_evidence` and a **visible gap** in the chronology hairline. Never a pass. Inherit `action-log-replay.ts:108`: *"Replay never invents fields."*
6. **Folds.** Attribution cannot see behind a fold summary: "detail before change N was summarized; this check can't be attributed further back."
7. **Clocks.** Ordinal leads. `recordedTs` keeps its existing label "as recorded by the planner's device" and its existing `formatRecorded()` string-slice, which deliberately avoids `Date` so the operator's clock is never re-expressed in the viewer's timezone.

**Scope honesty:** the kernel's five rules are snapshot identity, footprint containment, seating provision, primary-furniture clearance, and budget. **Egress and accessibility are not in it** — `lib/egress.ts` is a separate module and not a validator witness. V1 attributes four rules. Do not let the pitch imply otherwise.

**Effort:** 5–7 sessions after step 3 lands. Zero new stores. All new files plus **one inserted line** in `EvidenceLensPanel.tsx`, mirroring how `<ChangeHistorySection />` was added.

---

## 5. WHAT NOT TO DO

1. **Do not deploy web-side envelope fields before the API.** `ActionSchema` is `.strict()`; the ingest 400s on parse failure; Vercel auto-deploys web; the API ships only by manual `railway up`. Web-first stops audit-log ingestion for every client until someone remembers. **This is the one item in this document that can break production.**
2. **Do not implement `placedItems` as a React-time derived selector.** zustand 5.0.3, `Object.is`, zero `useShallow`, 23 plain-field read sites, several inside the Canvas. The app breaks in a way that looks like a rendering bug and is an architecture bug.
3. **Do not delete leg C first.** It is the only thing clearing `selectedObjectId`, `captureSelection` falls back to it, and `historyStepPatch` rewrites it on every undo. Deleting it alone bakes dead ids into production Actions.
4. **Do not fold the projection refresh into `commitDocument`.** `undo`, `redo`, `loadConfiguration`, `reset` and the post-save echo all write `objects` outside the funnel. Do it and undo stops moving furniture, with no test to catch it.
5. **Do not ship step 8 half-applied across a deploy.** Every operator-facing number — guest count, seats, cost, circulation, ops load, evidence, share summary — is computed from the mirror, while the saved/emailed/PDF'd layout and `CockpitTopBar`'s count come from the document, and the enquiry payload draws from *both*. A partial migration reproduces exactly the silent claim divergence the G4 regime exists to prevent.
6. **Do not attempt the type narrowing while the tree is dirty.** 104 `setState` sites across 28 test files, three currently dirty, and `tsc` covers tests.
7. **Do not build multiplayer.** It needs a CRDT/OT document server and a backplane, and `PlacedAt.index` does not commute. Also: `action_log.id` is a **global** primary key and the ingest conflicts on `id` alone with `configuration_id` outside the target — with many clients minting uuids for many configs that becomes a cross-config write-swallowing surface reported to the client as `duplicate`, the same class the T-537 Diary review flagged as P0.
8. **Do not run the validator on an unanchored trail.** See §4. A wrong "pass" is worse than no feature.
9. **Do not fix the four audit-integrity holes inside this programme** — the unlogged proposal send (`ShareLensPanel.tsx:92-98` runs create → version → transition("sent") → share token with no Action and no `generalAuditLog` write), the rig with no persistence, markup as browser-local truth with its geometry sitting server-side in an audit table, view state baked into the review PNG. Each will feel like it belongs in whichever step you are on. Each needs its own decision — for the rig and the cost rates, "persist it" and "reset it on config switch" are *opposite* fixes to the same symptom and no ADR covers which is intended.
10. **Do not trust the docblocks.** `EditorBridge.tsx:29` says a second mount "throws synchronously"; the code at `:154` explicitly does not, and says so. `moveObjectsByDelta`'s docstring claims it mirrors `moveItemsByDelta`; it does not recompute surface height. `itemsMatch`'s docstring claims "all mutable fields"; it compares nine and skips the asset id. `placedItemToEditor:82` says new items "are assigned a real index by the editor store on first save"; nothing does, and three server routes `ORDER BY sortOrder`. Proposal 1 inherited two of these errors by trusting prose over code — the same mistake it accuses G4 of.
11. **Do not stash or sweep.** 469 dirty files include four sessions' uncommitted work. Explicit pathspec per commit. Every session commits as "Blake", so ownership is by path and content, never author.
12. **Do not claim a frame-budget result from a green CI.** `FRAME_BUDGET_FAIL` defaults to false and `frame-budget` is not in `ci.yml` at all. Step 8's number must be measured by hand with `FRAME_BUDGET_FAIL=true` against the local stack and written into the session log.

---

## 6. HONEST LIMITS

**Corrections I am making to the input, with evidence** — treat everything else in those documents with equal suspicion:

1. `editor-store-history.test.ts` has **32** tests, not 48 (audit 1).
2. `editor-bridge.test.ts` lives at `packages/web/src/__tests__/`, not under `components/editor/__tests__/`.
3. `flushAutoSave`'s importers are `send-layout-flow.ts` and `SubmitForReviewPanel.tsx`, **not** `SaveSendPanel` — all three proposals inherited `EditorBridge.tsx:270`'s own stale comment.
4. `sectionClipPlanes` is `export const`, not `let`, so Proposal 3's rule (f) cannot catch the example that justifies it.
5. `ReadonlyStoreApi` is declared but not exported by zustand; it must be redeclared locally.
6. `objects` is **not** the only state reaching the server — `GuestEnquiryModal` sends a `placedItems`-derived seating style.
7. `runLayoutValidator` has two api test consumers, not literally zero references.
8. `EditorBridge.tsx`'s docblock does not "concede" that the ref guards one direction; it asserts the opposite. The substantive critique (a synchronous ref cannot guard a post-commit effect) is correct; the citation is not.

**What I could not resolve and would need to run something to settle:**

- **Whether step 3 should anchor via a synthetic `object.place` or by reading `configuration_layout_revisions`.** The second is more honest and the data already exists, but it needs a `COUNT(*)` and `pg_total_relation_size` against production before anyone designs on it. I did not query the database.
- **The size of the revisions table.** Four writers, no retention, a 3000 ms debounce. It could be enormous. Unknown.
- **Whether `action_log.ordinal` survives the wire as a number.** It is `bigserial` `mode: 'number'` in Drizzle and `z.number().int()` client-side; some pg drivers return `int8` as a string. One live GET against a config with actions settles it. I did not run it.
- **Whether the `/plan/A → /plan/B` non-remount holds on every navigation path.** I have the router sharing one element and an in-repo comment asserting it; I have no runtime proof.
- **Whether the O(n²) clearance witness × log₂(N) evaluations is fast enough at 500 objects** even in a worker. Unmeasured.
- **The calendar, as opposed to the effort.** ~7 sessions of work across ~3 weeks with review passes, but four other sessions are actively editing this tree and step 4 alone must wait on two files another lane holds. Every prior review at this seam in this repo caught a CRITICAL — G4 took four passes. Budget the review; do not budget around it.

**The one structural limit of this analysis:** everything here is a static read plus one test run. No code was executed against a live document, no browser was driven, no database was queried. The five gate suites are green (110 tests, 5.03s, verified), which makes per-step local verification cheap — but "green suite" and "correct behaviour" are not the same claim, and steps 2 and 3 exist precisely because the current suite does not pin the behaviours a consolidation would break.

---

# Appendix — the novel-capability proposal as submitted

I have what I need. Everything below is grounded in files I read; I did not modify anything.

---

# 1. The three candidates

First, a correction to the brief's premise. Several things I'd otherwise have proposed **already exist**, and any plan that ignored them would be reinventing shipped work:

- **`packages/web/src/lib/time-machine.ts` (177 lines) + `TimeMachinePanel.tsx` already ship deep undo, version restore, and session replay.** `documentAtOrdinal()` reconstructs the document at any ordinal; `planRestore()` appends a `layout.restore` Action rather than rewriting history. So "scrub the plan's history" is **done**, not available.
- The much more interesting discovery: **`packages/types/src/layout-validator.ts` (615 lines) contains a complete, pure, deterministic rule kernel — `runLayoutValidator()` — with five real rules, per-witness `affectedObjectIds`, `facts`, `policyRefs`, `derivation`, and a sealed `proofDigest`. It has ZERO consumers in web or api.** I verified this by grep: `web_files=0 api_files=0`.
- Same pattern elsewhere: `crowd-simulation-replay.ts`, `venreplay-artifact.ts`, `claim-lifecycle.ts`, `assumption-ledger.ts`, `human-review-overlay.ts`, `event-phase-graph.ts`, `configuration-sheet-snapshot.ts` — all types-only, zero consumers. The repo's real condition is **an unusual surplus of formal contract and a deficit of composition.**

That reframes the task: the opportunity is not a new contract. It's the first composition of two engines that already exist and have never been pointed at each other.

### Candidate A — Constraint chronology with gesture-level attribution
*"This clearance check held until change 412. That change is where it first reported a fail."*

Compose `documentAtOrdinal(entries, n)` with `runLayoutValidator(snapshot, context)`: evaluate every rule at every point in the plan's recorded history, find where each status flipped, and attribute it to the exact gesture, actor, recorded clock, and affected objects.

**Closest existing analogues, named honestly:** `git bisect` + CI — for code, and extremely well known. In design: **Solibri Model Checker** and **Navisworks Clash Detective** run rule checks on BIM models and can compare two model *versions*. **Figma version history** has no rules engine at all.

**What is actually different:** Solibri compares coarse, manually *published* model versions and cannot attribute a violation to an authoring gesture, because BIM has no per-gesture log carrying its own inverse. The granularity here is one operator gesture, and each gesture stores its exact inverse, so the tool can both *diagnose* and *offer the specific historical inverse* as a surgical fix. Bisecting a design's rule history at gesture granularity does not exist in venue/event software, and does not exist at this granularity in AEC either. The concept "bisect" is old; the substrate is new.

### Candidate B — Attestation drift (what the client approved vs. what is now true, per claim)
The approved sheet records the layout digest plus the claim set true at approval; later edits re-evaluate whether the approved artifact still describes reality.

**Closest analogues:** DocuSign (immutable document, blind to the underlying design), construction submittal/as-built revision control, CPQ quote versioning, Solibri version compare.

**Honest verdict — novelty is partial, and I must flag it: this repo already specifies the document-level version of this feature.** `packages/types/src/configuration-sheet-snapshot.ts` states in its own header: *"The editor surfaces a 'snapshot diverges from live' banner when this state exists."* The `configuration_sheet_snapshots` table exists with `source_hash` and `version` (schema.ts:537), and `configuration-reviews.ts` already reads `sourceHash`. So hash-level drift detection is **designed and unbuilt**, not novel. Only *per-claim* attribution ("the capacity claim still holds, the clearance claim doesn't") would be new — and that is just Candidate A evaluated at the approved ordinal. It is a view, not a separate product.

### Candidate C — Room-flip choreography derived from a layout diff
Given ceremony layout and dinner layout — both real states on the trail — derive the labour sequence to transform one into the other, routed through the actually-captured room, checked against the Diary's real turnaround window.

**Closest analogues:** **4D BIM construction sequencing** (Synchro, Navisworks TimeLiner) is a genuine and mature analogue for "sequence the transformation," though sequences there are hand-authored rather than derived from a diff. Theatre changeover plots are done by hand. Warehouse pick-path optimisation is the routing analogue. `"room_flip"` is already an enum member in `crowd-simulation-replay.ts`.

**Genuinely absent from venue software, and the venue pain is real.** But its central output — *how long the flip takes* — depends on labour-time data (how long one person needs to move a round table) that this repo **does not have and cannot derive from captured truth**. The headline number would be invented. That makes it the best demo and the worst truth claim, which is disqualifying under this project's own rules.

---

# 2. Recommendation: Candidate A

**The moat is not the photoreal capture. It is the decision record plus the pure rule kernel — and specifically that the rule kernel is a pure function of a canonically-digested snapshot.**

Why others structurally cannot build this:

1. **It requires a gesture-granular log where every entry carries its own inverse.** AllSeated/Prismm have no such log. Revit has undo but no queryable, server-ordered, inverse-carrying trail. Figma has the history but no rules.
2. **It requires the rule kernel to be pure and side-effect-free so it can be run against a *reconstructed historical* document, not just the live one.** `runLayoutValidator` is exactly that: it takes a snapshot plus a context and returns witnesses. Crucially, **`sha256Hex` in `canonical-layout-snapshot.ts:358` is a hand-rolled synchronous pure-JS SHA-256 — no `node:crypto`, no async WebCrypto.** So the whole kernel, digests included, runs synchronously in the browser or a Web Worker. Most codebases' validators are server-only or DB-coupled; this one is neither.
3. **It requires server-authoritative ordering.** Migration 0059 gives `ordinal` as a bigserial and the read model treats it as the only read order, with `recordedTs` (operator clock) and `receivedAt` (server clock) kept deliberately distinct. Attribution is only defensible because the order is real.

The captured photoreal truth is *not* the moat here — it's the stage. The moat is the record plus the kernel.

**A second, decisive reason to pick this one:** its outputs are *facts about a record*, not predictions about the world. "At ordinal 412 this rule reported pass; at 480 it reported fail" is verifiable and reproducible (the `proofDigest` seals it). Candidate C's outputs are estimates with no ground truth. Under this project's claim-safety discipline, A is the only one of the three whose headline number can't be an overclaim.

---

# 3. Concrete design

**Operator name:** "What changed this" — a section in the Evidence lens, expandable from any warning or failing claim row. Sentence case, no jargon.

### What the operator sees
A failing or near-threshold claim gains one affordance. Expanding it reveals:
- A single line naming the change where the check first reported the new status — titled by `changeHistoryRows()` so the wording can *never* disagree with the Change history panel, with the recorded-clock chip and the `Operator · tool` origin line already used at `EvidenceLensPanel.tsx:137-147`.
- The measured facts on both sides, straight from the witness: `measuredM`, `requiredM`, `shortfallM` for clearance; `deficit` for seating.
- Hovering the line highlights the witness's `affectedObjectIds` in the 3D scene — reusing the exact pairing `TimeMachinePanel.tsx`'s `touchedByEntry()` and `CockpitEvidenceBeam` already establish.
- A "show me the room then" link handing the ordinal to the existing Time Machine, and — phase 2 only — "restore just this" via the existing `planRestore()`.

### Data feeding it
1. `GET /configurations/:configId/actions` — the ordinal-paged read route already exists; **no API change and no migration required.**
2. `documentAtOrdinal(entries, n)` → `ReplayObject[]`.
3. **NEW adapter** → `CanonicalLayoutSnapshotV0`.
4. `runLayoutValidator(snapshot, context)` → five witnesses with a sealed `proofDigest`.

### What must be built new
- **`packages/web/src/lib/replay-snapshot-adapter.ts`** — the bulk of the work, and the crux. `ReplayObject` is `{id} & Record<string, unknown>` and `HistoryObject` is **`{ readonly id: string }` only** (editor-history.ts:14-16). But `LayoutSnapshotPlacedObjectSchema` demands a strict inlined `assetDefinition` with `category`, `widthM`, `depthM`, `heightM`, `seatCount`, `collisionType`, plus numeric `Vec3` — while the live `PlacedObject` stores coordinates as **strings** (`numeric(8,3)`, configuration.ts:84-90) and carries only `assetDefinitionId`. Category and dimensions are resolved through a **catalogue lookup** at runtime (placement-store.ts:151, 275). So the adapter must parse coords and resolve the catalogue — and must return an explicit insufficiency rather than a guess when it can't, inheriting the law already stated in action-log-replay.ts:108: *"Replay never invents fields."*
- **`packages/web/src/lib/claim-chronology.ts`** — pure. Bracket, then bisect. **The correctness subtlety that a naive design gets wrong: rule status is not monotone over history.** A clearance check can go pass → fail → pass → fail. A plain binary search over the whole trail is therefore unsound. The correct algorithm: coarse-scan at the `structural` markers `timelineMarkers()` already flags (`object.place`, `object.remove`, `layout.restore`), find an adjacent pair whose statuses differ, and bisect *only inside that bracket* — then report it as the **most recent** flip and disclose that earlier flips exist.
- **`packages/web/src/workers/claim-chronology.worker.ts`** — `clearanceWitness` is O(n²) pairwise (layout-validator.ts:435-448), and bisection multiplies that by log₂(N) evaluations. This must never touch the frame loop. Operator-invoked, in a worker, results cached by `snapshotDigest`.
- The UI section, CSS, and tests.

**Two design commitments that directly answer the audit flag and the constraints:**
- **This feature adds ZERO new stores.** It is pure functions, one worker, one hook, one section. G4 was criticised for adding three store modules while consolidating nothing; this adds none.
- **It survives the ~463 dirty files** because it is all new files plus **exactly one inserted line** in `EvidenceLensPanel.tsx` (`<AttributionSection />`), mirroring precisely how `<ChangeHistorySection />` was added at line 94. It touches neither `editor-store`, `placement-store`, nor `EditorBridge`. And because all logic lives in `packages/web` and `packages/types` — where Vitest actually runs — it needs **no api change**, which matters given the api suite has zero CI signal. Undo/redo is untouched: this is read-only over the log, so `editor-store-history.test.ts` stays byte-identical.

---

# 4. Beauty, specifically

Grounded in `time-machine-panel.css`, whose header already declares the idiom: *"gold ink on captured dark, House restraint."*

- **Palette, reused not invented:** `--tm-ink: #c9a84c`, hairlines at `rgba(201, 168, 76, 0.22)`, ground `#17171a`, text `#e8e6e1`, muted `#9a978f`. Gold tokens `--vv-gold: #d7b56d` / `--vv-gold-2: #c9a84c` already exist.
- **The chronology is a hairline, not a chart.** A 1px rule at 22% gold spans the panel; ordinals map to x. No axes, no gridlines, no legend.
- **Status is carried by ink weight, not colour.** Where the check held, the rule stays a 1px hairline. Where it fails, the segment thickens to 2px solid gold. Near-threshold uses the dashed idiom already established by `.tm__object--dancefloor`. **No red/green traffic lights** — status wording uses the existing three chip classes (`--info`, `--review`, `--attention`), so this feature introduces no new semantic colour.
- **One filled 5px dot with a 1px ring marks the transition.** It is the only filled element in the panel. Restraint means the single most important pixel is the only one that's solid.
- **Motion — the one moment of delight, and it's honest.** While the worker brackets, two faint gold calipers *converge* along the rule, one settle per bisection step. It isn't decoration: it's literally what the algorithm is doing, made visible. Each step uses the panel's existing settle, `cubic-bezier(0.22, 1, 0.36, 1)` at 260ms. The failing segment then draws left-to-right via `transform: scaleX()` — GPU-composited, no layout thrash, no frame-budget risk. The dot settles 0.9 → 1.
- **Reduced motion stands the whole thing down,** as the existing CSS header promises and 42 files already honour: calipers don't animate, the segment is simply present at full width, the dot doesn't scale, and progress becomes text — "Narrowing — check 3 of 7."
- **Copy, sentence case, cause-free:** "Clearance held until change 412." / "This change brought the closest gap to 0.9 m. The venue rule asks for 1.2 m." Never "caused", never "responsible", never a name in a blame position.

---

# 5. Claim-safety obligations

This feature has seven specific temptations to overclaim. Each needs a structural prevention, not a disclaimer.

1. **Causation.** The log records *order*, not cause; two gestures can jointly produce a clearance failure. Copy must say "the change after which this check first reported a fail." "Caused" and "responsible" belong in the banned-phrase list enforced by `packages/web/src/__tests__/public-claim-guard.test.ts`, whose `SCAN_ROOTS` already covers `src/components/editor`.
2. **"The" change, under non-monotonicity.** Must render as "most recent flip", and must actively disclose earlier ones: "this check also failed between changes 120 and 180."
3. **Retroactive validation with today's data — the single biggest risk.** The *document* is replayed faithfully, but `assetDefinition` dimensions come from **today's catalogue**, and `minPrimaryFurnitureClearanceM`, the price book, and the floor-plan outline come from **today's context**. So a historical verdict is "what today's rules say about that old arrangement" — *not* "what we told anyone at the time." The kernel already supplies the means to say so: every run carries `validatorDigest`, `contextDigest`, and `policyRefs`. The panel must state the rule version in the UI, not merely in a code comment.
4. **Simulation presented as measurement.** `clearanceWitness`'s derivation is `layout.geometry.convex_distance` over *nominal catalogue footprints* — not a measured gap in the real room, and not a fire-safety approval. `warn` must read "near the threshold — venue operations should review", never "safe". The witness already emits `reviewGate: { reason: "near_threshold", reviewerRole: "venue_operations_manager" }`; the UI must surface that rather than flatten it.
5. **Missing fields becoming invented facts.** When the adapter can't resolve an asset, it must emit a `data-sufficiency` outcome (`not_checked` / `degraded_evidence`) and the chronology must render a **visible gap** in the hairline — never a pass. A gap in the record must look like a gap.
6. **Folds.** `action-log-store` folds on overflow, and `replayActions` already treats a `log.*` fold as an issue (action-log-replay.ts:190). Attribution cannot see behind a fold: "detail before change N was summarized; this check can't be attributed further back."
7. **Clocks.** Ordinal is server order and the only real order — it leads. `recordedTs` is the operator's device clock and must keep the existing label "as recorded by the planner's device" (change-history-model.ts:26), formatted via `formatRecorded()`, which deliberately avoids `Date` so the operator's clock is never silently re-expressed in the viewer's timezone.

---

# 6. Effort, and what could kill it

**Estimate: 5–7 focused sessions** for phase 1 (read-only diagnosis).
- `replay-snapshot-adapter.ts` + insufficiency paths — 1.5–2
- `claim-chronology.ts` bracket/bisect/disclosure + tests — 1.5
- Worker plumbing and a test proving no per-frame work — 0.5
- UI section, CSS, claim copy, a11y, reduced-motion — 1–1.5
- Tests including a visual fixture — 1

Phase 2 (surgical revert via the existing `planRestore`) is a further 1–2 and should not be committed to until phase 1 is in an operator's hands.

**What could make it fail, most dangerous first:**

1. **The adapter may be unsatisfiable — this is the kill risk.** If the recorded `object.*` payloads don't carry `assetDefinitionId`, every historical verdict degrades to `not_checked` and the feature has nothing to say. **I could not resolve this from source alone**: `HistoryObject` is `{id}` only and the concrete logged type is generic, so the fields that actually ride along are determined at the call site and by what's in the live rows. **Spike this first** — read real `action_log` payload rows before writing any UI. One hour of work gates the other six sessions.
2. **The two rules a venue cares most about aren't in the kernel.** The five rules are snapshot identity, footprint containment, seating provision, primary-furniture clearance, and budget. **Egress and accessibility are absent** — `packages/web/src/lib/egress.ts` is a separate module and is not expressed as a validator witness. So v1 can attribute clearance, seating, containment, and budget only. Egress attribution is a genuine follow-on, not a footnote, and the pitch must not imply otherwise.
3. **Blame framing.** Operators will read "change 412" as an accusation, and every actor is the same git-style identity in this product's own logs. If the copy fails, a diagnostic becomes a personnel liability.
4. **Performance.** O(n²) pairwise clearance × log₂(N) evaluations at 500 objects may be too slow even in a worker; mitigation is a spatial index or bounding the pairwise check, which costs a session.
5. **Fold-on-overflow truncates exactly the wrong plans.** Attribution stops at the newest fold, so the most-edited configurations — the ones most likely to have drifted — are where the feature says least.
6. **Merge collision.** One line in `EvidenceLensPanel.tsx`, but that file sits in the editor tree several parallel lanes are actively editing.

**The honest one-line summary:** the genuinely novel capability is *rule-status attribution at gesture granularity over an inverse-carrying decision record* — and the reason to build it here is that this repo already contains both halves (`time-machine.ts` shipped, `layout-validator.ts` written and unwired) and has never connected them.
