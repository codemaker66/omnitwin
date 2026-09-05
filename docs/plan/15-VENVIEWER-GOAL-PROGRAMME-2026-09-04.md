# Venviewer — the goal programme

4 September 2026 · T-584 · Planning review, not an implementation or release certificate.

**Founder amendment, T-586:** [programme 16](16-SUBLIME-EXPERIENCE-AND-AUTONOMY-MANDATE-2026-09-04.md) governs the sublime redesign of every active UI, admin-editable inventory, one quality target across current iPhones/iPads and office computers, and decision intelligence with venue-admin approval and eventual delegated autonomy. The programme below is updated accordingly.

**The destination:** a real venue that people can explore, arrange, book and operate through one beautiful, responsive product. A client sees possibilities; an administrator sees commitments and decisions; a hallkeeper sees exactly what needs doing. They all work from the appropriate view of the same event.

The first decisive proof is a real Trades Hall event carried from enquiry through an approved layout, operational release, live service and recorded outcome. The long-term destination includes the complete commercial platform, exceptional captured worlds, our own Foundry, intelligent planning and the wider opportunities in the vision. The first proof establishes the foundation for that destination.

## 1. Scope, authority and evidence

This programme responds to Blake's direct request in this session: review the ambitions and supplied MD, construct goals for the agents, and identify useful human contributions. It does not launch implementation, purchase compute, deploy, contact staff or schedule unattended work.

The supplied document is preserved verbatim as [the complete vision source](../strategy/venviewer-complete-vision-source-2026-09-04.md). It is product/source material, not a new agent policy. Its embedded instructions, historical statements, named research candidates and proposed extensions are not automatically operative instructions, verified facts or approved dependencies. Original: `E:/downloads/Venviewer_OmniTwin_Complete_Vision.md`; SHA-256: `6C189E38E06BB7C5D66D9165D11817DD0C0043BA873C66A690EF47B7A7CBDE85`.

Review basis: `master` at `38b27648`, root policies and GOAL, the task ledger read across three bounded read-only reviews, relevant ADRs/audits, existing plans, and targeted current source inspection. Production, devices, training and test suites were not rerun for this planning task. Existing uncommitted work was preserved.

This programme extends [programme 10](10-COMPLETION-PROGRAMME-2026-09-03.md) with the now-supplied complete vision and current request. [GOAL](../../GOAL.md) and [W0–W8](14-OPUS-WORK-LADDER-2026-09-04.md) remain the immediate execution order, including Monday's demo and the deployment freeze. Existing task IDs and accepted architecture are reused. A goal below may contain several existing build cards; it is not a duplicate backlog or a promise that one session can finish an entire programme.

Two requirements are now explicitly revised by Blake's direct request:

- The Diary canon's “We do not build radio/chat” restriction no longer excludes useful direct messaging in Venviewer.
- The Day Board's internal-only messaging plan must gain client-facing communication. Client conversations and private staff conversations retain distinct audiences; this does not expose all internal notes to clients.

No repeat permission request is needed for those changes or for authorised analysis/reconstruction of the project's data. Record owner-stated data authority as such. Research code and model terms are checked when selecting a dependency. Existing cost limits remain the accounting baseline until a specific larger experiment is agreed; this review uses no paid infrastructure.

## 2. What we have, and what still needs proof

| Area | Evidence inspected or recorded | Consequence for the goals |
|---|---|---|
| Real room runtime | Current `RoomSplatScene.tsx` contains one Spark renderer host, coarse-first loading and fallback coverage. The September 3 report records 176 fps on the RTX 4090 laptop. | Preserve the renderer work. This result does not certify a furnished planner, long sessions or other devices. |
| Load time | September 4 measurements record first coherent room improving from 20.9 s to 8.0 s at 20 Mbps; GOAL reports about 65–75 s to full sharpness. | Loading is still a major product gap. First UI, first captured room and final quality need separate measurements. |
| Planner runtime | `CockpitSplatLayer.tsx` has one host but lacks the walk's coarse ladder/profile. GOAL records first captured content around 22.5 s at 20 Mbps. | T-581 is the immediate planner delivery seam. |
| Mobile performance | `splat-runtime-profile.ts` labels medium/low budgets as extrapolated. | Physical iPad, phone and ordinary-laptop qualification is outstanding. Desktop viewport emulation is insufficient evidence. |
| Own reconstruction | The first-run diagnosis records a real Grand Hall run and a roughly 20 dB zone result; `state/training_runs.jsonl` remains empty. | Training exists; a winning, reproducibly published owned room is unproved. Reconcile evidence instead of repeating “never trained”. |
| Furniture interaction | Selection and furniture-motion code separates saved target transforms from transient spring offsets; real item work and action history already exist. | Reuse verified interaction/data logic while rebuilding presentation. Full five-form Grand Assembly remains a wider programme. |
| Diary and operations | Booking→event→planner links, the When ribbon, read-only Day Board, approved snapshot sheets, Ops Compiler and event-day issue/offline primitives exist. | Connect and verify these surfaces. Do not build another calendar, count compiler or event model. |
| Communication | Proposal comments are implemented. Day Board urgent-message/overrun types include reserved values; the current board is read-only. | General DMs, client requests, slot conversations and request-driven urgency are not proved complete. |
| Commercial journey | CRM, proposals, quotes, versions and shares have code. Full payment/signature/client workspace depth is not established by this review. | Audit the actual journey, then close its gaps; schema presence is not a completed service. |
| Real use | GOAL records that the protected production Diary→planner→sheet→Day Board journey has not been exercised by a signed-in user. | Monday rehearsal and a real operational pilot are distinct from public smoke checks and unit tests. |

Ledger surveillance: T-001/T-091 carry old setup/trainer claims superseded in part by later run evidence, but T-091's evaluated owned-bundle gate remains open. T-582 must be judged against its exact hung-fetch deadline requirement: progress-update and tile-failure fixes do not necessarily close it. T-583 records a non-completing E2E job. These rows need evidence reconciliation, not automatic closure or invented completion percentages. Old “weeks” and header dates are not reliable schedules.

## 3. Quality contract for every goal

The figures below are proposed acceptance targets unless explicitly labelled an existing specification. Baselines must be measured on the same workload before evaluating improvement. A release must satisfy both visual and performance gates; lowering detail until the room looks poor is not success.

| Dimension | Goal and measurement |
|---|---|
| Immediate control | Preserve the Floor's existing targets: drag response under 16 ms, command opening under 50 ms and local layout preview under 400 ms. Record input-to-visible-response distributions separately from server completion. Editing must not wait for choreography. |
| Sustained rendering | 60 fps on current iPhone/iPad families including entry models and standard office fixtures defined in programme 16, with one unchanged visual quality target. Proposed qualification: active frame-interval p95 ≤16.7 ms; publish p50/p95/p99, dropped frames, long stalls and thermal behaviour over at least 20 minutes of walking, editing and room switching. Use actual captured rooms and representative furnished events. |
| Loading | Preserve the existing Floor target of proxy visible and tools live <1.5 s; an empty shell cannot pass. Next captured-room gate: ≤5 s at 20 Mbps, with ≤3 s a stretch target. Retain the existing visually-complete target <8 s at 50 Mbps; define and measure final detail per profile, separately from coarse visibility. Cold/warm runs, RTT, cache, resolution, bytes and failed-tile cases accompany results. |
| Fidelity | Retain PSNR 50+ as a research ambition. Report fixed-pose photographic reproduction, genuinely held-out reconstruction, and runtime-versus-master delivery loss separately. No universal PSNR ceiling is asserted. Higher PSNR alone cannot pass a visually worse or temporally unstable result. |
| Usability | Preserve the existing Hallkeeper Test: room/state/time identifiable in under 1 s. Proposed initial study: at least five representative people across client, admin and operations roles complete their role-specific critical tasks without coaching; target ≥90% task success and zero critical wrong-event/wrong-release actions. A hallkeeper should identify the next action within 5 s and acknowledge a request within 15 s in the test. Report sample size and failures, not a general population claim. |
| Visual craft | Rebuild every active interface around programme 16's sublime brief; current UI is not an accepted foundation. Supplied references are acceptable interim targets. Judge the working design artistically and test populated, dense, empty, loading, error, offline and stale states. No clipped controls, obscured architecture, ambiguous selection, unreadable labels or unexplained state changes. Small-screen and long-text fixtures are part of acceptance. |
| Accessible and sensory | Preserve the House/Floor targets: 44 px touch targets, keyboard actions, meaningful screen-reader and non-3D paths, adequate contrast, reduced motion and complete use with audio off. Sound is opt-in; essential status always has text/icon support. |
| Correctness and recovery | Exact release identity on phone, print and departmental outputs; no lost edits or duplicate actions on retry; visible pending/offline state; permission checks across clients/staff/venues; recovery from interrupted saves, uploads and websocket sessions. |

PSNR protocol: pin reference-image membership, camera/intrinsics/distortion, crop, image size, colour space/data range, resampling and masks before evaluating candidates. Record raw scores; any colour-fitted score is separate and labelled. Do not train, texture-project or tune on purported held-out views. Split by camera location/session where adjacent captures would leak evaluation content. Report whole-frame and preregistered regional scores, worst views, temporal paths, source lineage and human comparisons. A delivery score against a master is never presented as accuracy against a real photograph. The official [image metric API](https://scikit-image.org/docs/stable/api/skimage.metrics.html#skimage.metrics.peak_signal_noise_ratio) explicitly distinguishes reference/test images and data range.

The blanket “no real room exceeds 30 dB / best indoor is about 25” assertions in GOAL/plan 13 are not adopted as scientific limits. Keep their useful measurement work; retain Blake's ambition and let controlled experiments establish what the project achieves. Fixed-view reproduction is a useful diagnostic, not permission to silently replace the broader fidelity goal.

Track standard web health alongside these product-specific measurements: LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 at the 75th percentile, split by device class. These are [web.dev's baseline thresholds](https://web.dev/articles/vitals?hl=en), not substitutes for measuring the 3D canvas, continuous dragging or overall task usability.

The governing art direction is now the philosophical sublime, developed from first principles in [programme 16](16-SUBLIME-EXPERIENCE-AND-AUTONOMY-MANDATE-2026-09-04.md). House is historical/interim guidance, not a requirement to retain the existing palette, component forms or navigation. Supplied `a-board`, `b-daysheet`, `c-mobile`, `e-clash` concepts and the three [Day Board reference images](reference/day-board/) may serve as interim targets; the previously rejected `d-portal` concept is not revived. Preserve readability and meaningful control while developing a new composition, spatial presence, typography, light, movement and sound. The original review inventoried references; the amendment visually inspected two. Build a joined visual study across planner, admin and hallkeeper experiences, then test the selected direction as a working interaction.

For severity pulses, preserve existing labelled states and evaluate the current cadence against brief pulses on newly actionable/escalated requests. Acknowledgement should quiet the relevant request cue while unresolved work stays visible. Reduced motion uses steady indicators; no meaning depends on colour, motion or sound. Continuous motion needs a user control where applicable; see [W3C's pause/stop guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide) and [reduced-motion technique](https://www.w3.org/WAI/WCAG21/Techniques/css/C39.html). This is a proposed usability refinement, not an untested redesign of the board's current palette.

## 4. The ten goals

### G1 — Protect the founding demonstration and establish the current truth

**Start now; immediate execution priority.** Continue T-576/W0, T-581, the exact remaining T-582 behaviour, and T-583. Retain T-087 as completed prerequisite work. Reconcile source commits, deployed versions, migrations, recorded runs and open acceptance tests; refresh the stale gap inventory against evidence.

**Monday milestone:** Elaine's demo path works on the identified deployment with a signed-in venue identity, the right room and event survive navigation, and the current sheet is reachable. The recorded rehearsal includes slow loading and recovery. Apply W0's prescribed smoke/rehearsal and named lint/typecheck/build/test gates, recording the known full-E2E gap explicitly. Preserve the existing 5 September 18:00 to 7 September 18:00 BST production freeze; this new programme does not itself authorise a deployment.

**G1 fully done when:** the evidence/state reconciliation is complete and T-583 restores a completing full E2E signal in its existing Tuesday-onward W6 slot. That engineering closure is not moved ahead of Monday by this programme.

**Artifact:** deployment/rehearsal receipt and corrected state map. **Human input:** Elaine's actual device and the practical rehearsal slot. Public smoke checks alone cannot close this goal.

### G2 — Make the real rooms spectacular and fast

**Start alongside G1 where the work is offline; improve continuously.** Continue W1–W8, T-579 and T-091 as the current execution lane. Establish the Beauty Benchmark and programme 16's fidelity-preserving performance comparison, including equivalent-work optimisations and an isolated WebGPU candidate. Existing coarse-first loading is a baseline, not proof of the final no-quality-reduction target. Measure physical devices and diagnose capture, alignment, reconstruction, encoding and rendering losses separately.

Use the existing XGRIDS frames, vendor builds, Matterport mesh/E57 and native panoramas. Register sources with explicit transforms and independent landmarks; improve the floor first, then weak walls and hero details. A common frame does not imply matching capture dates or furnishings. Protect room scale, collision and operational geometry as appearance improves.

**Done when:** every supported profile meets the agreed appearance/load/frame gates; human-scale movement, cutaway and room transitions are correct; nominated floor/gilding/window/chandelier views improve without material regressions or flicker; every accepted derivative has lineage and a rollback. Expand to the other seven rooms using a repeatable recipe. PSNR 50+ remains an explicitly tracked open stretch until achieved under its declared protocol.

**Artifact:** benchmark gallery, device matrix and versioned room packages. **Human input:** reference devices, ranked hero details and judgment on prepared comparisons; targeted recapture only if a measured gap needs it.

### G3 — Rebuild every interface around the sublime, with effortless planning

**Parallel design/product lane alongside G2 and G4–G6.** Rebuild visual and interaction design across every active surface: public/client, planner, commercial/admin, Diary, messages/decisions, hallkeeper, inventory, supplier and Foundry. Follow programme 16's philosophical brief and first three-role visual study. Existing user references are acceptable interim targets; shipped House styling is not a protected destination. Preserve tested domain behaviour and reuse T-522 action history, T-562 interaction logic and faithful item meshes where useful. Finish real-item placement, selection, formations, snapping, numeric precision, grouping, dressing, duplication, 2D/3D continuity, undo and autosave. Catalogue items carry measured footprint, identity, quantity and storage information as well as visual quality.

Build all five Assembly forms in order: Live Assembly, Layout Recall, Grand Assembly, Transformation Assembly and Director's Cut. Use deterministic layout differences and presentation-only transforms; preserve final planner truth. Routine edits keep camera control with the user. Explicit presentations may choreograph cameras and optional sound.

**Done when:** the rebuilt active journeys receive founder aesthetic acceptance under the sublime brief and retain excellent task success/accessibility; real Trades Hall furniture is recognisable and dimensionally reviewed; furnished layouts meet the unchanged quality/device gates; interrupt/skip/redrag/undo/route-change tests never lose or duplicate objects or save intermediate animation positions. The same approved layout survives reload and produces the correct item counts. Each Assembly form receives its own acceptance recording. An inventory of routes/states prevents unrebuilt active screens being omitted from completion.

**Artifact:** complete interaction fixtures, approved item packages and motion demonstration. **Human input:** measured catalogue facts and short founder design reviews against the existing references.

### G4 — Carry the whole commercial promise in one event

**Start from existing commercial and Diary foundations.** Extend T-427/T-428, T-539, T-094, the proposal/share/comment paths and event lifecycle. Connect discovery, structured enquiry, contacts/opportunities, date options, room holds, proposals, exact quotes, client decisions, contracts, deposits/milestones, guest information and departmental needs. Account for loss/cancellation/refunds and changed dates, not just the successful booking.

Use existing events, bookings, phases, snapshots, quotes and approvals. “Spatial Event Contract” describes their coherent relationship; it does not require a new universal database object or another booking clock. Separate accepted price, confirmed booking, payment status, planning approval and operational release.

Venue admins own final approval of event changes and times. Intelligence, staff and clients prepare or propose within scope; exact-version approval and existing authoritative commands apply across Diary, time ribbon, requests and commercial changes. Programme 16 defines direct admin action, draft exploration and future delegated autonomy so approval is clear without redundant clicks. Current broad staff/hallkeeper management permissions are not assumed to satisfy this new policy.

Develop feasible offers and contextual capacity envelopes here using G9's validated facts: rooms/dates alone are insufficient when stock, staffing, guest comfort or setup time makes an offer impractical. These commercial capabilities advance as their evidence becomes dependable.

**Done when:** a client and coordinator can complete the journey without retyping the same brief; accepted versions remain immutable; outstanding decisions are clear; actual selected payment/signature/finance integrations are exercised with retries and failure recovery. Multi-room events remain one event with correctly scoped room/time/resource records. Guest-facing plans, seating, dietary/access requests and communications expose only the relevant information.

**Artifact:** verified commercial journey, client workspace and versioned offer/release records. **Human input:** the venue's actual terms, pricing, existing systems and authority to bind a promise; payment-provider business details only when that integration is ready to configure.

### G5 — Make communication immediately useful

**Priority next vertical slice.** Extend Day Board S3 with direct person-to-person conversations and contextual event/room/booking threads. Reuse existing command idempotency, notifications, proposal-comment experience and event-day issue primitives where they fit. Scope new data only after reconciling those existing models.

A client can request more chairs, refreshments, AV help or other assistance. The request carries room/event, description, appropriate urgency, assignee and progress. Admins and hallkeepers can communicate privately or through a clearly identified client-facing conversation. Distinguish sent, delivered, read, acknowledged, accepted and resolved; a read receipt does not mean someone owns the work.

**Done when:** “10 more chairs in Grand Hall” reaches the correct authorised people and timetable slot; one person accepts ownership; stock/approval implications are surfaced; client sees appropriate progress; fulfilment and outcome are recorded. Reconnect/retry creates one logical request, and offline or unavailable recipients are visible. Test wrong-room, wrong-venue, duplicate-send, revoked-share, absent-staff and escalation cases. A message alone never silently changes an approved event or commits unavailable inventory.

**Artifact:** working multi-user request journey with a clear audience model. **Human input:** who receives each request category, who covers absence and the venue's actual response/escalation expectations.

### G6 — Give hallkeepers an exceptional working day

**Build with G5, over T-556/T-557, T-107 and T-436.** Complete Day Board S4/S5. From a slot, reach the current setup sheet, furniture and equipment counts, timings, contacts, changes and requests. Show who owns work and what is next. Actual doors-open/setup/done/cleaned observations must remain distinguishable from scheduled times.

Compile hallkeeper sheets, BEOs, pick lists, AV/service/supplier instructions and phase/flip tasks from released snapshots and real catalogue requirements. Include chair/table types, projectors/screens and accessories actually specified for that event. Reserve inventory across simultaneous events; unavailable or hired stock is explicit. Sheets identify the exact release and superseded versions remain recognisable as old.

Admins must be able to edit venue inventory numbers directly, including owned/unavailable/hired stock and storage, with auditable adjustments and concurrency protection. Link stock to existing item definitions. A true downward correction that creates a shortage is recorded and identifies affected events/remedies; it must not be blocked or silently clamped to existing promises. Programme 16 defines the complete acceptance example and tests. Hallkeeper observations/task completion remain distinct from admin authority to alter the promised event.

**Done when:** a hallkeeper can run the shift from phone or wall display, respond to a slot request and open/print the matching current sheet. Offline reads and queued actions retain authorship and reconcile safely; stale release warnings survive disconnection; task completion does not falsely report cleaning or stock return. Timetable severity is clear in crowded-day and reduced-motion tests. Handoffs to catering, AV, suppliers and breakdown require no manual recounting.

**Artifact:** operator-tested day workflow and matching mobile/print packs. **Human input:** current BEO/day sheet, stock/storage list, staffing and turnaround practice.

### G7 — Prove the connected product on a real event

**First complete product milestone.** Depends on usable, verified slices of G2–G6, not completion of every frontier or PSNR stretch. Rehearse with a representative multi-phase event, then operate a nominated real event with Elaine and hallkeepers. Include a client-facing change, one operational request, a shift handoff and a poor-connectivity scenario.

The controlled rehearsal includes the vision's 150→180 guest change, only in a scenario where the venue approves those counts. It must identify affected layout, inventory, price, timing and review requirements, preserve the previous release, and distribute the newly approved version. Unaffected outputs should not acquire unnecessary review work.

**Done when:** the real event reaches close-out with matching released instructions, acknowledged changes, actual timings and recorded exceptions; no critical wrong-version handoff; no unrecorded workaround required to complete the chosen workflow. Log and fix every critical break, then repeat across another event format and a multi-room/room-flip case. Report observed results rather than declaring every event type solved.

**Artifact:** event evidence pack, staff/client feedback, defects and measured effort saved. **Human input:** one upcoming event and access to its coordinator, hallkeeper and consenting client for observation.

### G8 — Own the venue and item Foundry

**Parallel research and engineering lane after the benchmark exists.** Continue T-501–T-514 where applicable, accepted D-014/D-024 and the current work ladder. Connect source inventory, alignment, reconstruction, item production, evaluation and publishing into an actually executed workflow. Preserve high-quality masters independently from browser derivatives and processing providers.

**Done when:** a nontechnical operator can ingest supported inputs, understand missing data, see a resource estimate, run/cancel/retry/resume processing, review the result, publish and roll back a room or item. Beginner operation requires no terminal; expert mode exposes bounded calibration, registration and processing controls. Qualify the operator experience and crash/restart/recovery on Windows, macOS and Linux; heavy processing may use a supported remote worker, with local capabilities declared per OS. Jobs preserve source hashes, transforms, checkpoints, costs and durable outputs. An owned room beats the selected baseline under declared tests and another operator reproduces the process. Provider independence is proved by a second supported execution path, not merely an adapter interface.

Full scene fusion, regional specialists, material/lighting reconstruction, local updates and active recapture remain explicit subgoals. The first W7 run is XGRIDS-only unless its receipt proves other sources were incorporated; “fused” in a candidate name is not evidence of multi-source training.

**Artifact:** reproducible processing receipts and usable operator workflow. **Human input:** missing capture access and specific incremental compute allocations after each experiment has a concrete design and cost estimate.

### G9 — Build intelligence that understands the venue and learns from events

**Begin the decision model alongside G4–G6; deepen predictions as their evidence becomes dependable.** Extend T-102–T-110, T-437, existing evidence and simulation foundations. Intelligence should determine feasible options, rank them, recommend a choice and prepare its complete layout/time/stock/price/staff/task consequences for venue-admin approval. Execute and verify the approved decision coherently. Programme 16 defines the progression from recommendations to prepared decisions, approved execution, bounded delegation and full delegated operation; autonomy acts within revocable venue-admin authority. Keep source facts, missing information and consequences visible. The 10× reduction in admin effort is a target to measure, not a result already established.

Add Guest Flow Replay and phase rehearsal with reproducible scenarios, assumptions and uncertainty. Connect Event Memory to actual setup/flip times, issues, client outcomes and reviewed template improvements. Advance to change-impact reasoning, setup comparison and recovery options when the underlying event model supports them.

**Done when:** a real brief produces useful alternatives with explained trade-offs and an honest no-fit outcome; a chosen plan reaches the same reviewed quote and operations process; scenarios replay deterministically; recommendations cite the venue's evidence and actuals. Changed evidence invalidates the right results. More autonomous actions have explicit scope, receipts and recovery. Attractive crowd motion is not treated as validated human behaviour.

**Artifact:** evaluated assistance/solver cases, replay bundles and evidence-linked lessons. **Human input:** venue rules, representative difficult briefs, actuals and specialist review of the relevant operational assumptions.

### G10 — Make this a repeatable platform, then open the wider frontier

**Product expansion after the founding proof; prepare requirements earlier.** Onboard all Trades Hall rooms coherently and a second unrelated venue through configuration, imports and reviewed assets. Support staff/client/supplier roles, portfolio administration, entitlements, onboarding/offboarding, scoped sharing, exports and honest integration health. Verify backups/restore, monitoring, migration recovery and multi-tenant isolation before widening live use.

**Done when:** the second venue completes the same event loop without a venue-specific code fork, including a different inventory and operating policy; multiple event formats work; support and failures are diagnosable; data/asset export works. Track request response, proposal effort, setup rework, successful released-event execution and customer retention with definitions and observed baselines.

Then activate the retained frontier one bounded experiment at a time: AR/headset presence and on-site alignment; Accessibility Journey Twin; event passports/agency workspace; supplier/component/capability networks; yield/resource exchange; circular resources; counterfactual recovery; broader physical experiences; and eventually authorised human/robot coordination. Optional proposals remain visible opportunities with activation criteria, not invented near-term commitments.

**Artifact:** second-venue acceptance pack and evaluated frontier register. **Human input:** a second design partner once the founding event demonstrates value, and eventual commercial/product choices for optional network modules.

## 5. Execution order and ownership

1. **Current lane:** G1/W0 and the W1 measurement work, then W3–W8 in the existing dependency order. Do not duplicate a card already owned by another active session.
2. **Parallel product lane:** start G3's sublime visual study across planner/admin/hallkeeper surfaces; prepare G5/G6, admin inventory editing and the shared decision/approval policy. Prove request → slot → accountable action → matching sheet using current Diary/event records and the new design target.
3. **Connected release:** integrate the required G4 slices and run G7 as soon as the selected real-event workflow is ready. Highest-ceiling rendering research continues independently.
4. **Repeatability:** deepen G8/G9 using what the event taught us, then qualify G10 with a second venue. Do not postpone foundational permissions/recovery work until this last stage.

Codex and Claude should share the same build cards, task IDs, acceptance artifacts and session log. Before assigning edits, inspect current work/branches and claim disjoint paths; use read-only independent review while another agent owns implementation. Each card names: user outcome, current evidence, files/interfaces, dependencies, acceptance checks, rollout/rollback and any actual human dependency. No invented Codex-specific squad or second task system is introduced.

Research work produces a comparison and decision; product work produces an executable flow. A feature is complete only after relevant regression tests, typechecks, lint/build, browser/visual verification and real data/device checks. Independent review should challenge the current implementation and exact revision, not replay cached findings against newer code.

No credible full-platform completion date can be derived from this review. Estimate individual build cards after their acceptance scope and current code are reconciled; use observed throughput to forecast. Monday's existing date is real. The inherited week ranges for the full programme are not new delivery promises.

## 6. Research briefs the agents can prepare and execute

Every experiment starts with a source/asset inventory, a pinned baseline, a falsifiable hypothesis, changed variables, evaluation split, compute estimate and stop condition. It ends with artifacts, measurements, a sceptical review and adopt/revise/park. A failed technique does not retire the outcome it was meant to achieve.

| Brief | Decisive question | Evidence required to advance |
|---|---|---|
| R1 — Source-to-screen diagnosis | Which stage loses the detail already in our captures? | Same-camera native/export/independent-viewer/Venviewer comparisons; encoding generations, source hashes and region scores. Improve the responsible stage. |
| R2 — Hybrid Grand Hall | Can registered photographic surfaces and regional detail improve the served hall within its device budgets? | Controlled floor/wall/hero comparisons, independent alignment checks, occlusion/seam/temporal tests, total bytes/frame/memory cost. |
| R3 — Owned reconstruction and delivery | Which combination of sampling, depth, camera model and appearance representation produces better unseen views that remain better in the browser? | Controlled ablations against the vendor/composite baseline; genuine held-out tests; resumability; exported derivative tested on devices. NHT/3DGUT and similar names remain candidates pending primary-source and compatibility verification. |
| R4 — Real furniture production | Which input/capture/cleanup method best reproduces actual venue items at runtime scale? | One chair, table and AV item from real evidence; measured footprints, pivots/materials, repeated-instance performance and staff recognition; batch production cost. |
| R5 — Event consequences and rehearsal | Can one approved change produce correct commercial/resource/task consequences, then useful phase/flow advice? | Real-event fixtures, deterministic diffs, authority and acknowledgement tests, no-fit cases, observed setup/queue/flip data and explicit uncertainty. |
| R6 — Quality-preserving device performance | Can equivalent-work optimisations or WebGPU meet 60 fps and load targets on current Apple and office devices without lowering appearance? | Same-source, same-view comparisons; declared resolution; temporal/image differences; physical-device input/frame/memory/thermal results. Programme 16 defines the initial matrix and experiment order. |

Generated repair, relighting and scene completion receive their own derivative lineage and perceptual/temporal tests. They cannot silently alter measured heritage details or operational geometry. World generation, premium renderers and novel formats are options to evaluate when they solve a demonstrated bottleneck; their mention in the source does not make them adopted technology.

The agents can prepare these briefs and inspect available sources without another prompt from Blake. If a tool/account, physical observation or spend beyond the applicable allocation is required, return the exact missing action and expected result. No need for Blake to manufacture research prompts or choose CUDA/renderer settings on our behalf.

## 7. The human contribution, ordered by leverage

| When | Request | What it unlocks |
|---|---|---|
| First | Nominate one upcoming Trades Hall event and arrange 60–90 minutes with Elaine and a working hallkeeper; include a client for the client-facing portion where possible. | We prepare the script, run the workflow, observe workarounds and define the first real-event acceptance. |
| First | Point us to one complete current event pack plus the authoritative inventory: room/phase timings, furniture and AV names/counts/dimensions, storage, current BEO/sheet and operational responsibilities. We inventory existing files before asking for missing fields. | Correct sheets, recognisable furniture, stock checks and meaningful change propagation. |
| When device measurements are ready | Provide access to representative current iPhones/iPads, ordinary office/venue machines and venue connectivity where the agents cannot access them. The engineering team defines fixtures per programme 16; Blake has already chosen the broad support scope. | A real support matrix and defensible 60 fps/load claims at an unchanged visual standard. |
| Before live requests | Identify the people who receive client requests, cover absence and handle escalation. Venue admins' final approval of changes/times is already decided; later delegation limits are configured explicitly. | Helpful messaging and prepared decisions without ambiguous authority or unowned work. We prepare the remaining operational matrix. |
| During visual work | Review prepared side-by-side hero views and the existing approved UI references. If evidence shows missing surfaces, arrange only the specific recapture/measurement access in our shot list. | Founder taste and faithful venue facts enter the evaluation without requiring technical implementation choices. |
| When a concrete account action is needed | Supply the required console/DNS action or additional experiment allocation only if existing access/budget cannot complete it; later provide the commercial details for payment/signature onboarding. | Direct asset delivery and selected integrations/research. RunPod setup and initial credits already exist; they are not requested again. |
| After founding proof | Introduce a second unrelated venue willing to run the same workflow and share feedback. | Evidence that Venviewer is configurable and valuable beyond Trades Hall. |

The event and authoritative data are the highest-leverage remaining inputs; device access follows when test cases are ready. Blake has supplied the vision, project-data authority, sublime design direction, broad support scope and admin approval role. The agents own technical investigation, design alternatives, device fixture selection, implementation plans, regression coverage and evidence collection; do not ask those settled questions again.

## 8. Vision coverage and retained scope

| Source sections | Programme home |
|---|---|
| 1–6: destination, users, venue and event formats | North star, G7/G10; test clients/admin/hallkeepers first, then guests, suppliers, catering/AV, directors and capture operators. |
| 7–11: event/change/promise/approval relationships | G4–G7/G9; reconcile existing records before new models. |
| 12–20: onboarding, discovery, CRM, Diary, offers, quotes, contracts, client collaboration | G1/G4/G5/G10; feasible offers/capacity envelopes mature with validated G9 inputs. |
| 21–27: editor, AI alternatives, real furniture, Item Foundry, inventory, phases/flips | G3/G6/G8/G9. |
| 28–31: Room Resolves and all five Assembly forms | G2/G3. |
| 32–46: neural digital set, source fusion, hero regions, materials, repair, Foundry independence | G2/G8 and R1–R4, with lineage and browser delivery gates. |
| 47–52: knowledge, flow, animated rehearsal, agents, evidence | G9 plus correctness/release gates in every goal. |
| 53–58: operational outputs, hallkeepers, suppliers, rescue, actuals, economics | G4–G7/G9/G10. |
| 59–65: XR, accessibility journey, passports, networks, circular resources, robotics | G10's retained frontier; activate from proved prerequisites and user value. |
| 66–72: visual/sensory quality, outputs, integrations, reliability, business/discovery | Quality contract, G3/G4/G7/G8/G10 and human requests. |
| 73–74: technology and idea register | R1–R6 plus the preserved source; candidate names are not dependencies or performance claims. |
| 75–82: historical state, domains/surfaces, execution story | Evidence table, all goals and G7's complete event proof. |

Standalone ticketing/registration/check-in, financial partnerships, marketplaces and robotics remain explicit future scope decisions where the source leaves them open. They are not silently deleted or implied to be finished. Supplier coordination, guest needs, commercial operations, cinema and Foundry independence remain part of the core programme.

## 9. Evidence pointers and handoff

- Runtime: [RoomSplatScene](../../packages/web/src/components/rooms/RoomSplatScene.tsx), [planner splat layer](../../packages/web/src/components/editor/CockpitSplatLayer.tsx), [device profiles](../../packages/web/src/lib/splat-runtime-profile.ts), [recorded frame measurements](../reports/splat-drag-budget-2026-09-03.md), [loading measurements](../reports/coarse-first-ladder-2026-09-04.md), [training diagnosis](../reports/foundry-first-run-diagnosis-2026-09-04.md).
- Product: [booking drawer](../../packages/web/src/pages/diary/components/BookingDrawer.tsx), [Day Board](../../packages/web/src/pages/hallkeeper/DayBoardPage.tsx), [existing Day Board slices](hallkeeper-day-board-plan.md), [Ops Compiler](../../packages/api/src/services/ops-compiler.ts), [event-day routes](../../packages/api/src/routes/event-day-ops.ts), [proposal routes](../../packages/api/src/routes/proposals.ts), [furniture motion](../../packages/web/src/lib/furniture-motion.ts).
- Architecture/design: [D-018](../architecture/adr/D-018.md), [D-014](../architecture/adr/D-014.md), [D-024](../architecture/adr/D-024.md), [authority map](../strategy/authority-map.md), [House](02-DESIGN-LANGUAGE.md), [Floor specification](01-PLANNER-UX-SPEC.md), [historical gap audit](06-GAP-AUDIT.md). Historical market claims and numerical ceilings in these documents are not independently endorsed by this review.

Completed in T-584: vision preservation, source-backed planning review, ten goals, proposed quality contract, existing-task mapping, research briefs and founder requests. Verified: source identity, linked file existence and documentation diff checks. Unverified: fresh runtime/production/device performance, broad integration completeness, reconstruction outcomes and actual-user task success. No production code or behaviour changed; no code tests were added or executed for this documentation task.

The immediate implementation order remains the first unfinished W0 card and signed-in demo rehearsal. Parallel product work now begins with the sublime three-role visual study, revised S3 messaging → request → Day Board → current-sheet slice, admin inventory editing and the shared decision/approval policy, coordinated with the existing lane owners. Completing this planning task does not complete T-091 or any of G1–G10.
