# 12 · An intelligent venue platform built around one executable event

Proposed on 7 September 2026 in response to Blake's request for the biggest useful
codebase upgrade; subsequently activated as a durable Codex goal under T-605.
Implementation uses an isolated checkout and coordinates with the current demo
release. The standing build-and-ship instruction includes deployment and live
verification of qualified product changes; other tasks and compute allowances
remain separately owned.

## Paste into Codex

```text
/goal Read goals/12-intelligent-venue-platform.md and execute its Goal contract. Deliver the first integrated intelligent venue platform: one versioned event spanning sales, spatial planning and operations, with grounded AI decision preparation, reliable authorized execution, measured ML/GPU work and repeatability across two distinct venue configurations. Complete the implementation and verification gates in that contract; a roadmap, disconnected prototypes or passing unit tests alone are not completion. Follow current AGENTS.md and GOAL.md authorization and ownership.
```

## Why this upgrade

The ambition is a worldwide platform that can replace Salesforce-, Cvent- and
diagramming-style work for venue teams. The near-term differentiator is an event
whose commercial promise, physical plan and operational instructions stay in
agreement as people and AI change it. Market leadership and company valuation
are long-term business outcomes; they cannot serve as this coding goal's finish line.

The repository already has valuable pieces. This is a source inspection, not a
fresh claim that today's shared checkout or production deployment passes tests:

| Evidence | Consequence for the goal |
| --- | --- |
| The [complete vision](../docs/strategy/venviewer-complete-vision-source-2026-09-04.md), especially §§7–11, connects an Event Compiler, Change Impact Engine and controlled releases | Implement that connection through a complete event journey |
| [Event Architect](../packages/api/src/services/event-architect.ts) persists source/policy evidence and [generates deterministic alternatives](../packages/types/src/event-architect-engine.ts) | Build on its real planning engine and validation; do not replace arithmetic or constraints with model guesses |
| The [AI service](../packages/api/src/services/ai-assistant.ts) generates draft text through a configurable HTTP adapter; its [route](../packages/api/src/routes/ai-assistant.ts) accepts caller context | Add server-authorized evidence retrieval, evaluated structured decisions and a real model integration |
| [Diary commands](../packages/api/src/services/diary-commands.ts), [canonical snapshots](../packages/types/src/canonical-layout-snapshot.ts) and [Ops Compiler](../packages/types/src/ops-compiler.ts) already exist | Preserve and connect the authoritative paths rather than creating parallel calendars, layouts or counts |
| [Intelligence](09-the-venues-mind.md) and [platform](10-the-platform.md) goals describe decisions, learning, portability and recovery | Use them as product context; recheck their dated implementation claims, commands and vendor prescriptions |
| [Current ownership](../GOAL.md) includes T-601 release, T-603 Diary, T-596 reconstruction/compute and T-597 environment authoring | Integrate verified outputs through their owners; do useful independent work without competing for their files or GPUs |

The older [architecture plan](../docs/plan/03-ARCHITECTURE-TECH-STACK.md) describes
Next/React/Zero/RPC choices that differ from the current Vite/React/Fastify/Drizzle
manifests. Its useful principles are design inputs, not an instruction to migrate
the stack. [Official goal guidance](https://learn.chatgpt.com/use-cases/follow-goals)
supports a durable objective with a verifiable finish. [Agent evaluation guidance](https://developers.openai.com/api/docs/guides/agent-evals)
supports reproducible evaluation of the AI workflow.

## Goal contract

### Outcome

Transform Venviewer into a coherent, maintainable first version of an intelligent
venue operating platform. Complete one commercial-to-operations event journey at
Trades Hall and repeat it with a materially different venue configuration without
a code fork. Make the event's current state, proposed changes, authoritative
release and actual outcomes understandable to sales, planners, clients and staff.
Deliver working software and evidence, with a clear path to global expansion.

Use full engineering and research judgment. Inspect the current implementation,
identify the constraints on this outcome, choose the strongest supported design,
and implement it. Reuse, refactor, replace or remove code when evidence supports
doing so. Preserve domain behavior, data, useful tests and other active work.

### Establish the baseline and then build

Read AGENTS.md, the latest GOAL amendments, active ownership, the relevant vision
sections and goals 04–10 selectively. Trace the actual event journey through
schemas, APIs, jobs and rendered UI. Reconcile implemented, locally verified,
integrated and deployed states. Record the current commit and relevant worktree
changes; create an isolated checkout with dependencies you own.

Establish a runnable baseline and a compact acceptance matrix before major edits.
Rank gaps by user value, correctness risk and what they enable. Define the smallest
coherent architecture that satisfies the outcome, record consequential tradeoffs,
then proceed through integrated increments. Planning and scaffolding are prerequisites,
not deliverables that close this goal. Use independent subagents where they help.
First complete the deterministic event/change path, then add grounded AI, then
qualify learning/GPU integration and repeat the journey for the second venue.

### Build the shared event and decision path

Connect existing commercial, booking, layout, inventory, phase and operations
records through explicit identities and revisions. Keep their distinct lifecycles.
A controlled event release must identify the exact quote, layout, resources,
instructions, evidence and approvals it uses; preserve previous releases.

Implement one reusable change-impact and decision path for guest-count changes,
booking-time moves and equipment shortages. Prepare options, constraints, unknowns,
costs, affected people and outputs, and the exact proposed mutations. Validate
current authoritative state again when executing. A decision binds to its venue,
actor capability, inputs, scope, expiry and approved revision.

Execute through the same typed domain commands used by the UI. Enforce tenancy
and permission at execution, atomic database changes, idempotency and durable
delivery of dependent work. Recover visibly from partial external failure using
retry, reconciliation or domain-appropriate compensation. External side effects
are not universally reversible. Avoid assuming an exactly-once network or an
inverse for every action. Invalidated approvals require a revised decision.

### Make AI, machine learning and GPU work useful

Implement a real, provider-configurable AI path for understanding an event brief,
retrieving authorized venue evidence, preparing feasible alternatives and
explaining their consequences. Assemble trusted context on the server. Preserve
source, venue scope, revision, freshness and uncertainty; retrieved documents are
data, not instructions or permission. Missing or contradictory evidence must
produce a useful question, qualified option or no-fit result.

Use structured model outputs and validated tools. Reuse deterministic engines for
money, scheduling, availability, geometry and known constraints. Enforce action
policy outside the model. Admins authorize consequential changes; their direct
informed action can express approval. Support bounded, revocable delegation in the
design and shadow evaluation; expand live autonomy only under authorized policy.

Add model/request tracing, evaluation datasets, timeouts, cancellation, retry
limits, caching where correct, and per-venue usage/cost controls. Compare actual
models and prompting approaches on the task; select for measured quality, latency
and cost rather than a fashionable name. Exercise at least one real model path
with authorized credentials or local inference. A mock proves a contract only.

Create the outcome/feedback data path needed to learn from accepted, edited,
rejected and executed plans. Keep labels, data rights, missing actuals and dataset
versions explicit. Evaluate a useful pretrained retrieval/ranking component on
authorized venue evidence against simple search/ranking. Train a venue-specific
alternative only when sufficient rights-cleared actual feedback exists. Use a
frozen evaluation split and venue/time separation where appropriate. Promote a learned model only with evidence
of benefit; insufficient data must leave the baseline serving and a concrete data
collection path. Synthetic fixtures do not establish real-world predictive accuracy.
Cross-venue learning requires the applicable opt-in and isolation policy.

Integrate one real GPU workload into a durable job-to-artifact path that the product
can consume: choose the highest-value available batch planning, simulation,
reconstruction or asset-quality workload from measured needs. Reuse the Foundry
and existing compute contracts where suitable. Version inputs, executable/model,
parameters, outputs and quality evidence. Prove worker restart, cancellation,
retry, resource limits and job status; measure latency, peak memory and cost against
the appropriate baseline. A qualified result must be consumed in the supported
journey and meet a quality, latency, throughput or cost criterion declared before
the experiment. GPU floating-point comparisons use justified tolerances.
Keep a correct CPU or operational fallback. A slower or worse experiment stays
recorded and unpromoted. Do not duplicate T-596's active capture/training work or
spend its programme balance on this goal.

### Make the product repeatable and operable

Prefer clear domain modules in the current application with isolated long-running
workers. Add distributed services, a new database, sync framework or infrastructure
only when a measured need justifies its operational cost. Remove duplicate paths
after migration and parity proof. Keep APIs/contracts typed, inputs runtime
validated, dependencies maintained and migrations compatible with staged rollout.

Make venue policy and content configurable: rooms, actual inventory, prices,
rules, branding, time zones, currency and permissions. Prove timezone/DST and money
boundaries. Keep translation, regional policy and data-residency extension points
explicit without claiming worldwide compliance or building speculative deployments.
Provide portable import/export and a domain ownership map for future integrations.
Verify one available integration in a genuine sandbox if authorized; label contract
tests separately when external access is unavailable.

Deliver a coherent staff-facing journey using the current founder-selected visual
direction and Activity convention. Show source-linked recommendations, change
comparison, approval, progress, cancellation, failure/recovery and the resulting
event release. Preserve direct editing, keyboard/touch accessibility, reduced
motion and useful non-3D operation. Treat beauty and spatial fidelity as product
requirements. This goal does not lower existing reconstruction or physical-device
targets, or claim that a UI screenshot closes their separate qualification.

### Completion gates

1. **One event, consistent outputs.** A persisted enquiry/brief progresses through
   feasible options, exact quote/proposal, booking, editable layout, inventory,
   approved operational release, staff instructions and recorded actuals. Exercise
   a 150-to-180 guest request, a 30-minute time move and a shortage. Include a
   known-feasible case for each that executes through a coherent revised release,
   and separate infeasible cases that explain the concrete no-fit. Preserve
   matching release identifiers on phone/print outputs and track required acknowledgements.
   Commercial acceptance, payment, internal approval and operational completion
   remain distinct. Any dependent stale output is invalidated, never silently current.
2. **Portability.** Repeat the supported journey for two venue configurations and
   dinner/theatre formats, including a room flip, without venue-specific code.
   If a second customer is unavailable, use a clearly labelled synthetic fixture
   with different inventory, policies, currency and timezone; claim portability,
   not customer onboarding or market validation.
3. **Integrity and recovery.** Real disposable PostgreSQL tests and worker failure
   drills prove isolation, concurrent changes, stale/revoked approval, duplicate
   execution, restart and partial-failure recovery. Test isolation in retrieval,
   caches, jobs, artifacts and exports as well as routes. No unresolved known critical
   defect in the delivered journey. Preserve failing evidence and address causes.
4. **Intelligence evidence.** Before tuning, freeze a representative suite of
   valid, ambiguous, impossible, stale, adversarial and cross-tenant requests with
   independently reviewed expected outcomes and justified numerical acceptance
   thresholds. All defined hard-boundary cases must pass. Require the declared
   task-success and unsupported-claim limits and a measured benefit in success or
   correction effort over the current manual/deterministic journey, with latency
   and cost inside their budgets. Do not lower thresholds after seeing failures.
   Publish sample sizes and limits. Real-model, retrieval/ranking, feedback and
   GPU paths execute and their results enter the journey; a standalone benchmark
   is insufficient. A documented lack of training data may retain baseline ranking
   with the working data pipeline; this does not establish a venue-trained model
   or ML improvement. Negative experiments remain evidence, not promoted features.
5. **Performance and operation.** Establish workload/device-specific budgets from
   the existing product contract before optimization. Freeze workload, baseline,
   target and tolerances. Meet the declared improvement target, or an already-met
   applicable product budget without regression; do not chase optimization beyond
   the agreed gate. Record API/job p50/p95, UI responsiveness, resource use and cost;
   include a multi-tenant load test and a noisy-neighbour case. Rehearse backup/
   restore and migration/release recovery on disposable infrastructure. Publish
   observed capacity and bottlenecks, not an unsupported global-scale claim.
6. **A shipped, verified release.** Relevant tests, typechecks, lint, dependency audit,
   builds and actual rendered desktop/mobile workflows pass on the final integrated
   candidate. Make applicable CI gates execute meaningfully; name unrun platform,
   live-provider or physical-device checks. Deliver coherent commits, migration
   and rollout/rollback instructions, benchmark/eval receipts, an updated engineering
   map and a concise next-stage roadmap tied to demonstrated bottlenecks. Coordinate
   integration, deploy the qualified candidate and verify the changed production
   journey. A handoff or rollout document does not complete this gate.

Keep working until these gates are met. Do not substitute a design document,
generic chat panel, unconnected subsystem, trained-on-test metric or code-volume
increase for the outcome. If a required credential, decision, compute allowance,
real input or environment is missing, finish independent work, prepare the concrete
choice, and report the precise outstanding gate; do not silently redefine completion.

### Execution boundaries

Follow current user authorization and GOAL ownership; recheck them at execution.
Follow the shared build, ship and verify contract for requested product changes;
it does not grant unrelated external-message, production-data or cloud-spend
authority. Use existing scoped permissions and complete incremental integration,
deployment and live verification with the active release coordinator. Preserve
T-601/T-603, T-596/T-590 and T-597 work. Record durable
progress and evidence so another turn can resume without repeating completed work.
