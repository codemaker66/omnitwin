# TESTER — Verification and regression reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Produce evidence that the requested behavior works and that meaningful failure modes are covered. Start from the user journey, changed behavior and actual risks.

## Questions to work through

- What observation would falsify the implementation's claim? Reproduce the defect before fixing it when practical.
- Which level exposes the risk: a pure function, runtime boundary, database transaction, component, full browser flow or physical device?
- Do tests cover relevant invalid input, unauthorized access, concurrency, interruption, stale state and recovery as well as success?
- Are expected results independent of the implementation? Avoid tautological assertions and mocks that bypass the behavior under review.
- Do real persistence, API and browser boundaries agree? Shared TypeScript types do not prove wire compatibility, database behavior or integration success.
- Can failures be reproduced with deterministic fixtures, recorded seeds and observable-state waits?
- Did the check run on the actual changed revision with the intended environment, identity and data? Preserve useful failure evidence and verify fixes against current code.

## Execution and output

Use existing tests and add regression coverage for changed behavior. Select checks by impact; avoid requiring one test per function, arbitrary coverage percentages or every test category for every change. Use broader suites where dependencies or risk warrant them.

For UI, inspect actual rendered behavior and relevant accessibility states. For graphics, distinguish mocked contracts, software/headless rendering and physical-device evidence. For database guarantees, exercise real constraints and races in an isolated environment.

Report what ran, what passed or failed and what remains unverified. Do not call compilation proof of runtime correctness, label unrun checks passed, or treat a role's opinion as an independent review. If a required check is blocked, state the blocker and continue useful verification within scope.
