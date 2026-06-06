# OpenAI Deployment Company / FDE-Readiness Strategy Memo

Date: 2026-05-13  
Status: internal strategy note  
Source task: T-412  
Audience: Blake, Venviewer strategy/product/engineering

This memo is internal only. It does not imply OpenAI endorsement, partnership,
investment, support, or interest in Venviewer. It should not be reused as public
marketing copy.

## Sources checked

- OpenAI official announcement: "OpenAI launches the Deployment Company"  
  <https://openai.com/index/openai-launches-the-deployment-company/>
- Venviewer internal docs:
  - `docs/state/tasks.md`
  - `docs/architecture/venviewer-proof-carrying-venue-reality-stack.md`
  - `docs/architecture/truth-mode-doctrine.md`
  - `docs/architecture/layout-proof-object.md`
  - `docs/architecture/crowd-simulation-replay-bundle.md`
  - `docs/architecture/venue-data-request-pack.md`
  - `docs/architecture/planning-evidence-disclosure.md`
  - `docs/operations/auth-access-policy.md`
  - `docs/operations/upload-access-policy.md`
  - `packages/web/src/pages/TradesHallVisualPage.tsx`

## 1. Executive Verdict

**Verdict: YELLOW.**

Venviewer is strategically adjacent to the kind of hard deployment problem an
FDE-style organization cares about: a messy physical-world workflow, real venue
data, operational decisions, human review, and measurable business impact. But
Venviewer is not ready to approach OpenAI or a similar deployment partner as a
credible target yet.

The concept is attractive. The current proof is not yet strong enough.

### Would OpenAI likely help Venviewer now?

Probably not yet. The product is pre-revenue and still missing the decisive
proof points:

- no real `scene.ply` loaded in the runtime
- no live Trades Hall operational workflow demo
- no measured admin, sales, staff, or revenue impact
- no deployed planner-to-ops handoff used by venue staff
- no published case study or customer adoption proof

OpenAI's Deployment Company pattern is about deploying AI into real operational
systems, not reviewing ambitious architecture docs. Venviewer has unusually
strong doctrine for evidence, provenance, review gates, and venue reality, but a
deployment partner would still ask: "Which workflow is live, who uses it, what
changed, and what did it save or earn?"

### What would make Venviewer more attractive?

Venviewer becomes more interesting when it can show a single end-to-end founding
deployment:

1. Trades Hall data captured, reconstructed, and loaded as a real visual layer.
2. Planner edits saved and shared with an events/hallkeeper workflow.
3. Truth Mode honestly exposing source, assumptions, review gates, and staleness.
4. Guest Flow Replay or an equivalent operational evidence artifact answering a
   narrow, useful staff question.
5. Event Ops Compiler output turning a layout into staff tasks, furniture pick
   list, supplier notes, and handoff artifacts.
6. Measured baseline vs. Venviewer impact for at least one real workflow.

### What proof points are missing?

The missing proof is not more vision. It is "one real venue, one real workflow,
one repeatable deployment playbook."

## 2. Strategic Framing

### Venviewer as AI-operable venue infrastructure

The strongest framing is not "beautiful floorplan software." It is:

> Venviewer turns real venues into AI-operable operational infrastructure.

That means a venue is represented as:

- captured visual context
- semantic mesh/layout authority
- documented venue rules and inventory
- review-gated assumptions
- evidence artifacts
- event phase graph
- operational handoff outputs

This is a stronger fit for FDE deployment work than a pure SaaS tool because the
valuable work is not just the interface. It is the conversion of fragmented venue
knowledge into a controlled system that staff, clients, and AI assistants can
operate against.

### Trades Hall as founding deployment

Trades Hall should be treated as the founding deployment, not a demo asset.

The founding deployment should prove:

- a heritage venue can be digitized without overclaiming certainty
- staff workflows can improve without removing human review
- sales/event planning can become more visual and less back-and-forth
- operational checks can become explicit rather than tribal knowledge
- a repeatable venue onboarding pack can be reused at the next venue

### Forward Deployed Venue Engineer model

The Venviewer equivalent of an FDE is a **Forward Deployed Venue Engineer**:

- maps the venue's planning, sales, ops, and handoff workflows
- gathers venue data using a Venue Data Request Pack
- captures or ingests visual/geometry assets
- configures room semantics, inventory, constraints, flow zones, and assumptions
- builds the initial event phase graph and planner presets
- validates what the software can and cannot claim
- measures impact against pre-deployment workflow baselines

The deployable product is therefore both software and a repeatable deployment
method.

### Product plus deployment playbook

The attractive pattern is:

1. Start with one venue and one high-value workflow.
2. Turn it into a repeatable deployment template.
3. Prove the template transfers to another venue with less manual effort.
4. Build a library of venue deployment primitives.

Venviewer should pitch itself internally as a deployment system before pitching
externally as a platform.

## 3. OpenAI Fit Map

| FDE/deployment pattern | Venviewer fit | Current state | Gap |
|---|---|---|---|
| Diagnostic of high-value workflows | Strong. Venue sales, event design, layout review, staff handoff, inventory, and guest flow are workflow-heavy. | YELLOW | Need actual workflow interviews, baseline timings, and venue-user pain ranking. |
| Data/tool/control integration | Strong vision. Venue data request packs, runtime packages, layout snapshots, evidence packs, and ops outputs are designed for integration. | YELLOW | Need working end-to-end integration from venue data to planner to handoff. |
| Production system | Medium. Live web/API exist, and security fixes have landed. | YELLOW | Need reliability baseline: monitoring, Sentry, backup restore, deploy gate documentation, and demo environment stability. |
| Measurable workflow impact | Potentially strong. Admin time, revision loops, close rate, conversion, ops errors, and room-flip clarity are measurable. | RED | No measured baseline or before/after case study yet. |
| Repeatable patterns | Strong doctrine. Venue Data Request Pack, Artifact Registry, Truth Mode, Evidence Packs, and phase graphs are reusable. | YELLOW | Need second venue or at least a repeatable deployment checklist validated on Trades Hall. |
| Change management | Strong opportunity. Venue staff and clients need trust, not automation theater. | YELLOW | Need hallkeeper/events-team adoption story and reviewed handoff outputs. |
| Governance/safety | Strong doctrine. Planning Evidence Disclosure and Truth Mode are unusually mature for this stage. | GREEN/YELLOW | Need runtime implementation and public-copy guardrails matched to live workflows. |

## 4. Current Readiness

| Area | Rating | Assessment |
|---|---|---|
| Live software | YELLOW | Venviewer has live planner/web/API surfaces and recent security/trust fixes. It is not yet a polished public proof of the full venue reality stack. |
| Visual route | YELLOW | `/dev/trades-hall-visual` exists and is honest about no real asset. It is still internal and fixture-shaped until a real runtime asset exists. |
| Real venue data | YELLOW | Trades Hall COLMAP/E57 data has been locally restored/staged according to recent workflow notes, but the runtime-ready trained asset does not exist. |
| Capture pipeline | YELLOW/RED | RunPod pipeline docs/configs exist. Smoke gate, Docker/operator prerequisites, Config B run, and real output remain blockers. |
| Customer/venue access | YELLOW | The product is organized around Trades Hall, but the repo does not prove venue staff adoption, review, or operational use. |
| Measurable ROI | RED | No measured time savings, revenue lift, reduced revision loops, or staffing/ops impact exists yet. |
| Production reliability | YELLOW | Several security/deploy hardening tasks landed, but Sentry, uptime monitoring, backup restore, email infra, and deploy-flow docs remain open. |
| Safety/evidence discipline | GREEN/YELLOW | The doctrine is strong: Truth Mode, planning evidence disclosure, review gates, and artifact governance are all explicit. Runtime proof is still partial. |
| Founder/operator story | YELLOW | The vision is differentiated, but the story needs to be anchored in observed venue workflow friction, not only product ambition. |
| Public demo readiness | RED/YELLOW | The product can impress visually in slices, but the full claim-safe "real venue operating workflow" demo is not ready. |

## 5. Missing Proof Points

The critical missing proof points are:

1. **Real scene loaded:** a trained Trades Hall `scene.ply` or runtime-compatible
   splat asset loaded through Spark, with transform metadata and honest status.
2. **Workflow demo:** one credible live flow from event inquiry -> layout ->
   review -> venue handoff -> revised output.
3. **Planner-to-ops handoff:** staff-facing outputs such as furniture pick list,
   room setup checklist, supplier notes, and event phase tasks.
4. **Measurable savings:** before/after timing for layout revisions, client
   clarification loops, proposal creation, staff setup preparation, or sales
   conversion.
5. **Venue staff adoption:** a hallkeeper/events-team quote or internal note
   showing that the tool changed real behavior.
6. **Case study:** a narrow, evidence-safe, before/after story for one event type.
7. **Security/reliability baseline:** production monitoring, backup restore,
   deployment status clarity, and error tracking.
8. **Claim-safe public posture:** a short public demo that never implies legal,
   fire, accessibility, occupancy, or survey-grade certification.
9. **Repeatability proof:** a second room or second venue deployment checklist
   that reuses the same onboarding primitives.
10. **Governed AI loop:** AI assistance that proposes layouts or repairs while
    deterministic checks and human review keep authority bounded.

## 6. What To Build Before Approaching Anyone

The exact next 10 proof-building tasks should be:

1. **Close T-001:** Run the RunPod smoke gate successfully and document the output
   bundle evidence.
2. **Run T-003:** Produce the first real Trades Hall Config B training output.
3. **Run T-005:** Evaluate the output with held-out views and device/browser FPS.
4. **Start T-091/T-091A only after real asset exists:** load a real captured
   Trades Hall asset in the runtime; do not fake it.
5. **Harden T-384/T-407 route into a demo lane:** keep `/dev/trades-hall-visual`
   internal, but make it stable enough for an investor/partner technical demo.
6. **Implement the first planner-to-ops handoff slice:** choose the smallest staff
   artifact: furniture pick list, setup checklist, or hallkeeper notes.
7. **Run one venue workflow observation:** record the current event-planning
   process, number of revisions, time spent, and failure points.
8. **Create a Venue Data Request Pack fixture for Trades Hall:** fill only facts
   that can be sourced and mark missing facts as review gates.
9. **Create a narrow evidence artifact:** one Layout Evidence Pack or Guest Flow
   Replay fixture for a single scenario, clearly labelled as planning evidence.
10. **Write a private case-study draft:** one event type, one workflow, one
    before/after metric, and one safety/limitations section.

## 7. Outreach Packet Outline

Do not send this externally until the demo is credible.

### One-page deck

1. Problem: luxury and heritage venues run high-value event workflows through
   photos, PDFs, memory, email, and manual revisions.
2. Venviewer: AI-operable venue infrastructure for real planning workflows.
3. Founding deployment: Trades Hall Glasgow / Grand Hall.
4. Product layers: captured visual layer, semantic mesh, planner, Truth Mode,
   Guest Flow Replay, Evidence Packs, Ops Compiler.
5. Proof status: what is live, what is simulated/internal, what needs review.
6. Business impact target: reduce proposal/revision time, improve confidence,
   improve setup clarity, preserve review discipline.
7. Repeatability: deployment playbook for other venues.

### 3-minute demo script

1. Open with the live Grand Hall planner.
2. Show blank hall -> add a simple event layout.
3. Switch to the internal visual command route.
4. Explain visual layer status honestly: no unsupported claim if no real asset.
5. Open Truth Mode and show source/verification/assumption/review-gate structure.
6. Show a narrow handoff artifact or placeholder of the intended handoff shape.
7. Close with the workflow impact target and missing proof now being built.

### 10-minute technical demo

1. Architecture: runtime visual asset, semantic mesh, canonical layout snapshot.
2. Data: Venue Data Request Pack and artifact registry direction.
3. Evidence: Truth Mode, planning disclosure, review gates.
4. Ops: Event phase graph and handoff outputs.
5. AI loop: AI proposes, deterministic checks constrain, human review decides.
6. Safety: no legal/fire/accessibility/survey-grade claims without professional
   review.
7. Deployment path: Trades Hall first, then repeatable venue template.

### Case study structure

1. Venue and workflow baseline.
2. Data gathered and missing data.
3. Deployed workflow.
4. Human review points.
5. Before/after metric.
6. Staff/client feedback.
7. Limitations and next capture/review work.

### Why OpenAI should care

The strongest internal argument is:

- Venviewer is a concrete physical-world workflow where AI must operate against
  data, tools, human review, and business outcomes.
- Venue planning is repetitive but not trivial; it requires spatial reasoning,
  operations, evidence, and communication.
- The system can become a repeatable deployment pattern across venues, hotels,
  campuses, museums, event spaces, and eventually other physical operations.
- Truth Mode and planning-evidence discipline create a responsible deployment
  story instead of an AI overclaim story.

### Why this is repeatable across venues

Repeatability comes from five reusable assets:

1. Venue Data Request Pack.
2. Capture/training/runtime package pipeline.
3. Semantic room/layout model.
4. Event phase and ops handoff templates.
5. Truth Mode/evidence/review-gate vocabulary.

## 8. Hard Warnings

- Do not imply OpenAI endorsement, investment, partnership, approval, support, or
  interest.
- Do not pitch before the demo is credible.
- Do not claim a real captured visual layer is loaded until a real runtime asset
  is loaded.
- Do not present planning evidence as statutory approval, legal certification,
  fire-safety assessment, accessibility certification, occupancy approval, or
  survey-grade measurement.
- Do not use public wording such as `fire approved`, `certified safe`, `legally
  compliant`, `survey-grade`, `approved for occupancy`, `guaranteed accessible`,
  `Black Label`, `production ready`, or `photoreal digital twin`.
- Use safer language: `Planning evidence`, `Human review required`, `Machine
  checked`, `Not legally certified`, `Simulated guest flow`, `Not yet signed`,
  `Runtime asset loaded`, and `Purpose-fit evidence`.

## 9. Recommended Next Task IDs

Most of the hard readiness work already maps to existing tasks:

| Task | Why it matters for FDE-readiness |
|---|---|
| T-001 | Proves the training pipeline can run on RunPod. |
| T-003 | Produces the real Trades Hall visual output candidate. |
| T-005 | Gives image-quality and runtime-performance evidence. |
| T-091 | Central "make Trades Hall real" workstream. |
| T-384 | Internal runtime path for future real splat URLs. |
| T-407 | Internal command-center shell for the visual/evidence story. |
| T-260 | Venue Data Request Pack follow-up/onboarding workflow. |
| T-296 | Operational Geometry Compiler doctrine/foundation. |
| T-330 | Event Phase Graph doctrine and schema. |
| T-307 | Planning Evidence Disclosure guardrails. |

Recommended new/proposed task IDs, if Blake wants to track the outreach packet
explicitly:

| Proposed ID | Title | Depends | Scope |
|---|---|---|---|
| T-413 | Trades Hall workflow baseline interview pack | T-260 | Internal questionnaire and measurement plan for current sales/events/hallkeeper workflow. |
| T-414 | Private 3-minute deployment demo script | T-091, T-407 | Internal script only, updated after real runtime asset exists. |
| T-415 | Private one-page FDE/deployment partner deck | T-091, T-413 | Internal deck outline and proof-status matrix; no external claims. |
| T-416 | Trades Hall founding deployment case-study draft | T-091, T-413 | Private before/after narrative once real workflow data exists. |
| T-417 | Planner-to-ops handoff proof slice | T-107, T-330 | Smallest Event Ops Compiler artifact: furniture pick list or setup checklist. |

Do not open outreach until T-091 has real runtime evidence and at least one real
workflow proof point.

## 10. Strategy Conclusion

Venviewer could become attractive to OpenAI's Deployment Company or a similar
FDE/deployment partner if it proves that venue reality can be turned into a
repeatable, AI-operable workflow system with measurable outcomes. The strongest
asset is the combination of spatial interface, operational workflow, and
calibrated evidence discipline.

The immediate risk is over-positioning before proof. The next phase should stay
boringly concrete: real asset, real workflow, real measurement, real handoff,
safe claims.
