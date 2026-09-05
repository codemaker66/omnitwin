# Venviewer — sublime experience, quality parity and decision intelligence

4 September 2026 · T-586 · Founder amendment to [the goal programme](15-VENVIEWER-GOAL-PROGRAMME-2026-09-04.md).

This records Blake's direct follow-up requirements and turns them into design and engineering acceptance criteria. It is a planning amendment; no rebuilt UI, editable inventory or new approval behaviour is claimed implemented here.

## 1. The four binding requirements

1. **Rebuild all active interfaces and visual design from first principles around the philosophical aesthetic of the sublime.** This is paramount and non-negotiable. Existing user-supplied reference images are acceptable interim targets; improve on them when a new direction demonstrates the intended aesthetic. Existing live UI is not accepted merely because it follows House or has already shipped.
2. **Venue admins can alter their inventory numbers in the product.** Stock is maintainable operational data, not a source-code constant or a task requiring an engineer.
3. **Run on the latest iPhones and iPads and standard office computers without lowering quality.** The engineering programme must find and prove an implementation that meets both quality and responsiveness. A visibly reduced mobile mode cannot close the requirement.
4. **Venue admins approve changes and times; intelligence does the decision preparation.** It should work out feasible choices, recommend what to do and prepare the consequences, making the admin's work radically easier. Design the system so full delegated autonomy becomes possible.

These direct instructions supersede programme 15's assumption that the current visual language should be preserved, its unresolved request for Blake to select the hardware baseline, and any default plan to trade visible quality for device performance. The shared stack, correct domain records, captured truth and regression protections remain useful foundations. “From scratch” applies to the design and presentation architecture; it is not a requirement to erase tested booking logic or customer data.

This is the continuing planning conversation. Updating these goals does not by itself deploy a new product, spend on a renderer experiment or change production permissions. The existing Monday freeze remains applicable; it does not confer aesthetic acceptance on the current UI.

## 2. Philosophical grounding and our design interpretation

The sublime is not one universally agreed style. These thinkers offer distinct accounts. The product interpretations below are our design proposals, not claims that the philosophers prescribed interface patterns.

| Source | Relevant idea | Venviewer interpretation |
|---|---|---|
| Longinus, *On the Sublime*, I–III, IX, XXXIX–XL | Sublime expression elevates; timing and composition matter, while bombast and misplaced emotion undermine it. Simplicity and silence can carry grandeur. | Compose the experience as a coherent whole. Let the real hall, an event's assembly or a complex day becoming understandable carry the emotional force. Every control belongs to that composition. [Primary text](https://www.gutenberg.org/files/17957/17957-h/17957-h.htm) |
| Burke, *A Philosophical Enquiry*, I.7; II.1, VII–X | Astonishment, vastness, power and succession contribute to his sublime. Terror is central to his account, but danger felt too closely cannot delight. | Use architectural scale, depth, rhythm, material richness and carefully staged revelation while preserving the user's control. This selectively adapts Burke; obscurity is not a justification for hidden controls or uncertain saves. [Primary text](https://www.gutenberg.org/files/15043/15043-h/15043-h.htm) |
| Kant, *Critique of Judgement*, §§23–29 | His mathematical sublime concerns magnitude exceeding imaginative comprehension; the dynamical sublime concerns might experienced without actual subjection or serious fear. Sublimity concerns the judging mind rather than a numerical object property. | Reveal the scale of the venue and connected event while strengthening the user's ability to understand and act. Expanded agency in the presence of complexity is our software analogy. [Primary text](https://www.gutenberg.org/files/48433/48433-h/48433-h.htm) |

The resulting design ambition is **awe, presence, significance and agency**. Black and gold, blur, large type and expensive-looking ornament do not establish those qualities by themselves. No particular existing palette, component silhouette or navigation pattern is protected from redesign.

### Translate the ambition into the experience

- **Presence:** use the real venue's scale, spatial depth, light and material detail. The hall must remain itself, including its measured dimensions and heritage details.
- **Composition:** establish proportion, a strong visual hierarchy, considered negative space and relationships between the room and controls. Eliminate arbitrary card walls and unrelated visual treatments.
- **Revelation:** let a room, event or plan become intelligible through deliberate sequences. Loading remains tied to real readiness; no artificial suspense or delayed access to completed work.
- **Agency:** every gesture responds immediately and can interrupt choreography. People should feel able to conduct the event, understand consequences and recover from mistakes.
- **Rhythm:** create phrases of movement with quiet intervals. Continuous intensity destroys contrast and becomes tiring through an entire working day.
- **Operational sublimity:** a hallkeeper sees an intricate day rendered clear and manageable. Urgent work, counts, ownership and current instructions remain unambiguous.
- **Sound and silence:** sound may deepen explicitly chosen experiences; silence must be complete and intentional. Essential information never requires listening.

Reject: invented architecture used to impress; illegible text justified as atmosphere; forced camera moves; ornament obscuring work; hidden navigation described as mystery; constant pulsing; artificial delays; and a screenshot presented as proof of a successful experience.

### The rebuild covers the entire active product

Inventory the current route graph and critical state variants before replacing presentation. Coverage includes public discovery and enquiries; client portal/proposals; planner/catalogue/inspector; Diary and commercial administration; messaging and decision review; hallkeeper mobile/Day Board/print; supplier surfaces; inventory/settings/onboarding; Foundry and diagnostics where operators use them.

Carry forward verified functions, server contracts, data identities and accessibility semantics. Redesign information architecture, navigation, composition, typography, materials, controls, transitions, motion and sound from the new brief. Migrate by complete user journeys behind reviewable previews; retired navigation must not strand deep links, work or users mid-event.

Existing references are available in `docs/design/concepts/` and `docs/plan/reference/day-board/`. In this amendment we visually inspected `a-board.png` (a booking-conflict modal despite its filename) and `hall-view-phase-timeline.png` (a venue-dominant planner with side tools and a phase timeline). Their room imagery, numbers and labels are design references, not current Trades Hall evidence or runtime measurements. Other references retain their recorded provenance; the previously rejected `d-portal.png` is not revived by this amendment.

**First design deliverable:** a joined visual study of the room planner, administrator's day/decision view and hallkeeper mobile view. Produce three distinct, source-grounded directions, carrying the same sample event across the three roles. One can evolve the supplied references; all must explore the sublime beyond superficial decoration. Then turn the selected direction into a working interaction prototype before rebuilding routes. Existing supplied references remain valid interim targets if needed; no additional permission is needed to use them.

**Aesthetic acceptance:** Blake judges whether the working direction reaches the desired sublime experience. Representative users test presence, coherence, agency, repeated-use comfort and task success. Their reports complement artistic judgment; there is no numerical certificate of philosophical sublimity. Accessibility, speed, correct information and all dense/error/offline states remain release requirements.

## 3. Admin-editable inventory

Inspected current state: `packages/types/src/asset-catalogue.ts` contains a shared static catalogue; `packages/web/src/lib/catalogue.ts` checks quantities within a scene. `asset_definitions` in the database is a global visual/dimensional catalogue. The reviewed source did not establish venue stock editing or time-window reservation accounting.

Build venue stock records linked to existing item definitions. Do not fork the visual catalogue for each venue or mistake a per-scene placement cap for stock availability.

The admin experience must support:

- Search an item and directly edit owned quantity or apply an adjustment; record unavailable/damaged units, hired-in quantities with validity windows, storage location and active/retired status.
- Show clearly distinct total stock, usable stock, reserved demand and remaining availability for the selected event period. Count setup, movement, live use and breakdown where the real resource is occupied.
- Keep an adjustment history with actor, before/after, reason, effective time and record version. Use safe concurrent updates and idempotent commands; retries never apply an adjustment twice.
- Show affected events and remedies when an adjustment creates a shortage. Record the physical truth even when it invalidates a previous assumption. Do not clamp the stock count to promised demand or reject a true correction to hide the shortage.
- Preserve approved historical releases. A stock change creates an impact/review process for future instructions; it does not silently rewrite yesterday's sheet.

**Acceptance example:** 200 chairs are owned and 190 reserved over overlapping windows. An admin records 20 as damaged. Usable stock becomes 180 and the 10-chair deficit is visible. Intelligence identifies affected bookings and feasible substitutions, hire or rearrangements; the admin chooses the supported remedy; the resulting approved release updates picks and tasks. No new unsupported promise can be silently added.

Tests must include zero stock, invalid/negative counts, simultaneous adjustments, duplicate delivery, non-admin/foreign-venue access, overlapping versus non-overlapping windows, damage/return corrections, hired-in expiry, revoked approvals and already-printed sheets. Hallkeepers may report condition discrepancies; venue admins own inventory adjustments unless a later explicit delegation grants that capability.

## 4. Same quality target on current Apple and office hardware

“Latest” includes the entry models, not only the most expensive Pro device. Current Apple pages checked in this review list iPhone 17, 17 Pro/Pro Max, Air and 17e; iPad Pro M5, Air M4, mini A17 Pro and iPad A16. Recheck the shipping lineup when devices are procured and before release. [iPhone](https://www.apple.com/uk/iphone/), [17e](https://www.apple.com/newsroom/2026/03/apple-introduces-iphone-17e/), [iPad Pro](https://www.apple.com/uk/ipad-pro/specs/), [iPad Air](https://www.apple.com/uk/ipad-air/specs/), [iPad mini](https://www.apple.com/uk/ipad-mini/specs/), [iPad](https://www.apple.com/uk/ipad-11/specs/).

The engineering team chooses provisional office fixtures rather than asking Blake to choose a GPU: Windows 11, Intel Core i5-1135G7/Iris Xe, 8 GB RAM, 1920×1080; a comparable AMD integrated-graphics machine; and an 8 GB M1 MacBook Air. Add a 16 GB office configuration and the venue's actual computers. These are proposed qualification fixtures, not a market-share statement or a claim they already pass. Record OS, browser, resolution and thermal/power settings.

Every target gets the same accepted appearance and spatial correctness requirements at its declared display/zoom conditions. No silent low-resolution canvas, missing ornaments, reduced visible furniture quality, blurred motion or 30 fps substitution counts as completion. PSNR 50+ remains tracked under programme 15's distinct image protocols. Existing coarse-first loading is recorded current behaviour, not proof that a lower-detail frame meets this stricter visual target.

Different representations may be necessary, but “different” does not establish “equivalent.” Preserve source masters. Distinguish mathematically lossless storage from any measured image change, perceptual approximation or inferred detail. Report every candidate's differences; a perceptual claim cannot be relabelled as strict losslessness. A reduced quality threshold requires a new founder decision, not an engineering default.

### The concrete experiment order

1. **Remove redundant work with the accepted assets intact:** retain one renderer host, instance repeated furniture, cache/precompute static work, eliminate avoidable CPU/GPU transfers and unnecessary UI updates. Three.js supports instancing for repeated geometry/material to reduce draw calls. [Three.js](https://threejs.org/docs/pages/InstancedMesh.html)
2. **Render and deliver only what can contribute to the view:** conservative culling, exact spatial partitioning, residency management and predictive prefetch. Test large Gaussian footprints, glass, mirrors, portals, fast turns and disocclusion. Never erase visible contribution simply because a primitive's centre is off-screen.
3. **Benchmark WebGPU against Spark on the same full-detail source:** Safari 26 ships WebGPU on iOS/iPadOS; PlayCanvas documents GPU splat culling/projection/radix sorting in its 2026 renderer. This is a real route worth testing, not a proven Venviewer solution. A candidate may require a new renderer boundary/ADR; do not assume it is a drop-in Spark upgrade or migrate production by default. [WebKit](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [PlayCanvas](https://blog.playcanvas.com/new-in-supersplat-webgpu-and-streaming-bring-huge-performance-wins/)
4. **Compare hybrid surfaces and regional appearance:** photographs/meshes where they preserve or improve detail, high-detail residuals where required. Judge seams, contact, thin structures, view dependence and motion as well as stills. This can change the work required to produce the same accepted appearance; equivalence must be demonstrated.
5. **Evaluate encoding and precomputation with separate error accounting:** lossless alternatives first; compression, quantisation, distillation and temporal reconstruction require explicit non-regression evidence. SOG uses lossy quantisation even though its property images use lossless WebP; its name cannot certify zero quality loss. [SOG specification](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/)
6. **Retain remote GPU assistance as a secondary experiment:** it can move heavy rendering off the office machine but adds network/encoding/decoding latency and stream-quality constraints. A local interactive layer plus remote imagery needs its own latency, image, depth/occlusion and failure tests. It is not an automatic answer to the no-compromise requirement. [Epic stream tuning](https://dev.epicgames.com/documentation/unreal-engine/stream-tuning-guide)

Transfer arithmetic is part of the design: at 20 Mbps, 101.9 MB needs about 40.8 seconds of payload transfer before overhead (decimal units). A fast full-quality first view therefore cannot depend on downloading that entire payload first. Prove view-local delivery, reuse or a better representation instead of assuming an unspecified compression ratio.

**First runtime deliverable:** a same-source comparison of Spark, equivalent-work optimisations and a WebGPU prototype, using the real Grand Hall plus representative furniture and active UI. Run 20-minute physical-device sessions with cold/warm loads, rapid turns, placement, phase changes and messages. Record image/temporal differences, frame p50/p95/p99, input latency, memory and thermal behaviour. Target active-frame p95 ≤16.7 ms, programme 15's load goals and the unchanged appearance bar together.

If no candidate meets both gates, record the bottleneck and run the next decisive experiment. That is unfinished engineering, not permission to lower the target or claim success. No such experiment was executed in this planning amendment.

## 5. Intelligence prepares the decision; admins own approval

Current source has useful foundations: deterministic Event Architect candidates, layout recommendations, exact-snapshot review and a review-gated AI draft route. Those are not evidence of a configured production autonomous operator. Current Diary/review policies also permit some staff/hallkeeper actions; the new admin-approval rule requires an explicit policy change.

Build a common decision object/policy using existing event/command/approval primitives where possible. Each consequential proposal should carry:

- The intended outcome and current event/booking/inventory versions.
- Feasible options, the recommended option and intelligible reasons.
- Costs, resource/timing/layout/task consequences, material trade-offs and required acknowledgements.
- Missing facts, unverified assumptions, conflicts, urgency and the minimum useful question.
- The exact proposed mutations, required approval authority, execution receipt and recovery/compensation path where possible.

**Example:** moving dinner by 30 minutes should produce choices consistent with other bookings, turnaround, staff, catering and equipment. The admin sees the recommendation and consequences together. Approval applies that exact prepared change through the existing authoritative command path; if availability changes before execution, revalidate and return the revised choice rather than executing stale approval.

Venue admins initially approve event changes and timings across Diary drag, planner time ribbon, client requests, commercial changes and intelligent recommendations. Staff/clients/hallkeepers can propose within their scope. An admin's direct action can itself express the required approval when the exact action and consequences are clear; do not force a redundant second approval click for every trivial edit. Draft exploration remains fluid; publishing a changed promise or schedule follows the authority policy.

Hallkeeper task completion and observations remain distinct from authority to change the event. Client acceptance, payment and specialist review retain their own meaning. Do not turn a broad `canManageVenue` check into final approval authority: inspected code includes staff/hallkeepers in that helper. Use a narrow venue-scoped capability and exact-version approval policy.

### The route to full delegated autonomy

1. **Recommend:** gather facts, determine feasible alternatives, explain the best choice and expose uncertainty.
2. **Prepare:** build the complete proposed change across relevant domains, so the admin reviews a coherent decision rather than doing the coordination manually.
3. **Execute approval:** apply and verify an approved command set; deliver revised outputs and track acknowledgements. Retry without duplicating commitments.
4. **Delegate bounded operation:** the venue admin grants revocable action scopes, time/resource/financial limits, policy rules and exception triggers. The system executes inside those bounds and escalates exceptions.
5. **Full delegated operation:** expand by action class as shadow runs and live outcomes establish reliability. Admins continue to own policy, delegation, override and revocation; the system can carry out routine and increasingly complex decisions without requesting each approval separately.

Full autonomy is a destination, not an assertion that all current recommendations are reliable. Permission, constraints and deterministic checks must be enforced by the application, not solely by a language-model prompt. Claims of a 10× improvement require a measured baseline: admin handling time, interruptions, rework, wrong decisions and event outcomes on matched tasks. The aspiration is 10× less decision/coordination effort; no achieved factor is claimed.

**Acceptance:** run a date change, guest-count change, stock shortage and unanswered service request from suggestion through approval, execution and current instructions. Test no-feasible-option, contradictory facts, concurrent booking/stock changes, permissions, stale approval, duplicate execution, partial failure, revocation and recovery. One approval must never imply authority beyond its exact scope.

## 6. Effect on the work programme

- **G3 becomes the all-surface sublime redesign programme**, including visual/navigation architecture across G4–G6/G8/G10, as well as effortless furniture interaction and all five Assembly forms.
- **G2 retains one quality bar across the supported devices.** Add the fidelity-preserving WebGPU/equivalent-work comparison. Existing low-tier extrapolations are diagnostic baselines, not acceptable final solutions.
- **G4/G6 gain explicit admin inventory editing and shortage-aware reservations.** Reuse item identity; add actual venue stock and adjustment authority.
- **G4–G6/G9 share the admin approval/decision policy.** Begin the decision model alongside the product workflows, not after all rendering research finishes. Advanced predictions depend on their evidence; useful decision preparation can start with current deterministic facts.
- **Human requests already answered:** Blake has chosen the aesthetic direction, broad device scope and final approval role. Do not ask those again. We choose test fixtures and prepare concrete design alternatives. Remaining human input is actual venue data, physical test access, final artistic review and later delegation/budget specifics when needed.

The next design output is the three-role visual study. The next inventory output is a real admin-edit/shortage flow. The next intelligence output is a prepared timing/stock decision with admin approval. These become bounded implementation cards after their current-code seams are reconciled; this document does not mark them built.

## 7. Review and verification

Three read-only reviews supplied primary-source philosophy, current rendering/device evidence, and current inventory/approval code findings. Product Design routing/context guidance was read; no saved plugin context was present, so the repository remains the durable project authority. User's explicit redesign instruction overrides the skill's default to preserve an existing design system.

Verified for this amendment: source-backed interpretations and technology availability, cited current code seams, two viewed reference images, documentary authority/goal consistency and local link/diff checks. Unverified: new sublime prototype, device performance, inventory mutations and approval/autonomy behaviour. No code, schema, production data, compute or external communications changed.
