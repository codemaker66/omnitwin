# Venviewer engineering review and collaboration

Updated 2026-09-06 at Blake's request to modernize the earlier persona workflow.

The Squad and Council are optional collections of questions and domain knowledge.
They are not separate authorities, required roles, or substitutes for engineering
judgment. Use the full range of relevant expertise in any task. Introducing yourself
as a character, staging a debate, or collecting fictional signoffs adds no evidence.

Follow the current user request and the project policy in the root `CLAUDE.md`, with
`.claude/AI_INTEGRITY_RULES.md` for evidence and completion standards. Accepted ADRs,
current founder decisions and verified repository behavior determine constraints.
Persona opinions and historical Council discussions do not establish approval.

## Domain reference map

Load a reference when its questions help with the actual task. Cross-domain work
may benefit from several perspectives without requiring several agents or voices.

| Reference in `.claude/squad/` | Useful focus |
| --- | --- |
| `RENDERER.md` | Scene rendering, coordinate systems, assets, GPU lifecycle and visual correctness |
| `INTERACTOR.md` | Input handling, manipulation, camera behavior, gestures and interaction feedback |
| `ARCHITECT.md` | API contracts, data models, tenancy, security boundaries and migrations |
| `FRONTENDER.md` | UI composition, state, accessibility and responsive behavior |
| `DEPLOYER.md` | Build and release systems, environments, observability and recovery |
| `TESTER.md` | Reproductions, behavioral regression coverage and test reliability |
| `DOCUMENTER.md` | Generated plans, hallkeeper sheets, exports and operational legibility |
| `PERFKEEPER.md` | Measured loading, latency, frame time, memory and delivery cost |

The references in `.claude/council/` provide additional product, design, research
and systems perspectives. Use them within the requested scope; they do not authorize
new product work or override founder direction. Their names are document labels,
not proof of installed tools, specialist credentials or independent review.

## Work and delegate with purpose

1. Establish the requested outcome, current implementation, relevant constraints and
   evidence needed for acceptance. Make a plan when dependencies or uncertainty
   warrant it; keep straightforward work straightforward.
2. Carry the authorized work through implementation, integration and verification.
   Break complex work into manageable steps internally and continue without asking
   Blake to send another prompt for each step.
3. Use independent agents when the available runtime supports them and a bounded
   investigation, implementation or review can improve quality or save time. Give
   each a concrete question, relevant context, ownership boundaries and expected
   evidence. Do useful work in parallel and avoid overlapping edits.
4. Integrate results against the current files. Reproduce material findings and
   resolve conflicting claims through evidence. Multiple agents agreeing does not
   prove correctness; a single model playing several personas is not independent
   corroboration. Do not claim a reviewer or tool ran unless it did.
5. Resolve routine technical tradeoffs within the authorized task. Ask Blake only
   when a material product choice, missing requirement or action outside existing
   authorization needs his decision. Continue independent work while that is open.

One coordinating agent owns the complete outcome. Blake does not need to route
messages between specialists or perform checks the available tools can run.

## Review the affected contracts and risks

Shared schemas in `@omnitwin/types` are contracts. When one changes, trace its actual
consumers and update affected callers, validation, fixtures and generated outputs
together, or provide an explicit compatible migration. Do not assume every package
consumes every schema, or introduce unrelated changes to satisfy a role checklist.

Select review and validation from the behavior changed:

- Rendering and interaction: inspect the real scene and exercise affected controls,
  camera states and asset/error paths. Measure performance on a declared scene,
  device and workload when the change or claim depends on performance.
- APIs and persistence: check applicable validation, authentication, authorization,
  tenant isolation, failure handling and migration compatibility. Use the existing
  Zod contracts and established application patterns.
- UI: verify the affected user journey, responsive layout, keyboard/accessibility
  behavior and working states. Use the shared `Activity.tsx` system and its loading
  convention; preserve current founder aesthetic requirements.
- Generated documents: inspect affected exports for correct data, layout and
  legibility, including the hallkeeper sheet when its inputs or generator change.
- Infrastructure: verify relevant build, configuration, migration and release
  behavior. A local implementation does not require a production deployment to be
  complete; deployment follows its own task scope, authorization and release rules.

Add meaningful regression tests for changed behavior and run the relevant existing
checks. Expand validation for shared contracts, security boundaries or uncertain
impact. Choose documented acceptance criteria and measured budgets appropriate to
the task. Old persona thresholds, arbitrary coverage percentages and an eight-role
checklist are not universal gates.

## Completion and incidents

Completion means the requested scope is implemented and its relevant checks pass,
with evidence and any remaining limits stated accurately. A failed relevant check
needs investigation; distinguish a new regression from a verified pre-existing
failure. Do not broaden an unverified local result into a production, device-wide
or aesthetic acceptance claim.

For incidents, first establish impact and preserve diagnostic evidence. Restore
service within existing authority, investigate the cause, and add regression
coverage for the failure when practical. For visual or performance defects,
reproduce the reported scene and conditions before changing it. Document the result
and unresolved risk; no persona ceremony or fictional veto is required.
