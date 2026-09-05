# 10 · The platform — repeatable for a second venue, truthful CI, the frontier register

## The /goal block

Make Venviewer a repeatable platform: all eight Trades Hall rooms coherent in one product, then a second unrelated venue onboarded through configuration, imports and reviewed assets with no code fork; staff, client and supplier roles, entitlements, onboarding and offboarding, scoped sharing, honest integration health, and exports; backups and restore, monitoring, migration recovery and tenant isolation verified before wider live use; the deploy topology made truthful (CI's e2e job finishing, the audit job meaningful, migrations in the deploy, the API deploying on push). Then the frontier one bounded experiment at a time, from proved prerequisites.

## Outcome, in Blake's words

"the very best venue planning platform in the world"; "for every use case in anything relating to events". From the vision §5: "Future venues should be configurable deployments rather than separate code forks."

## Where we are

Multi-venue: the backend is ready and the frontend has five hard-codings (the project_multi_venue_findings memory); the two flagship slugs. Deploys: the web deploys on push to master through Vercel; the API deploys through Railway only when its watch patterns match (railway.json was widened) or by manual `railway up`; deploy.yml never migrates and the CI-gated migrate step skips silently while CI is red; the audit job is red and gates nothing; the e2e job never finishes (T-583, killed by its own thirty-minute timeout); `pnpm -r test` bails before the API suite. Windows-green is not Linux-green. Clerk identity; the Diary's open tail (cron wiring, a Redis backplane, Clerk claims, PROD_SMOKE credentials). Pricing tiers and the at-cost rate are drafts. The frontier is written in docs/plan/08-FRONTIER-MOONSHOTS.md and the vision §59–65.

## Decided

- A venue is configuration and reviewed assets: rooms, hours, plans, photographs, inventory, packages, prices, rules, review policy, branding, integrations. No venue-specific branch in code.
- Every domain states which system is authoritative during a deployment; integrations carry external ids, idempotent updates, retries, logs, replay and visible failure. Silent divergence is unacceptable.
- The venue owns its data and can leave with it; defensibility is the linked history, not obstruction.
- CI's overall conclusion must mean something: the four gating jobs stay, the e2e job finishes or is split, the audit job passes or is removed from the gate with a written reason, migrations run in the deploy after a passing gate.
- The frontier is a register with activation criteria, never a near-term commitment: on-site AR alignment, the Accessibility Journey Twin, the Event Passport, the Verified Component Cloud, the Yield Network, circular resources, counterfactual recovery, human and robot coordination. Each activates only from a proved prerequisite and a demonstrated user need.

## The work, in slices

P1 CI made truthful (after Monday, T-583 first): the e2e job finishes; the audit job's findings triaged; migrations in the deploy after a green gate; the API deploying on push with railway.json verified; the runner no longer bailing before the API suite. A written topology in docs/operations that matches reality.

P2 The five frontend hard-codings removed and the slug namespaces unified test-first (shared with goal 06 S1).

P3 Venue onboarding under the Sublime: rooms, hours, plans, photographs, inventory (goal 05 S7's stock record), packages, prices, rules, review policy, branding; useful before the twin is complete (reviewed 2D plans and photographs first).

P4 Roles, entitlements, invitations, offboarding, scoped shares with expiry, supplier surfaces, exports in open formats.

P5 Reliability drills: backup and restore rehearsed and timed; monitoring and diagnosable errors; migration rollback rehearsed; tenant isolation tests across every route; feature flags and rate limits; the incident runbook.

P6 The second venue (HUMAN.md 14) runs goal 06's loop end to end with a different inventory and operating policy, without a fork; multiple event formats; a room flip.

P7 Metrics with definitions and observed baselines: request response time, proposal effort, setup rework, released events executed without a wrong-version handoff, retention.

P8 The frontier register: each item with its prerequisite, its activation criterion and its first bounded experiment; reviewed quarterly; nothing activated by enthusiasm.

## Done when

The second venue completes the same event loop without a venue-specific code fork. The restore drill passes inside its target time. CI's overall conclusion is meaningful and the API deploys on push. Exports work. Tenant isolation is proved by tests. The frontier register has activation criteria for every item.

## Verify

```
gh run list --branch master --limit 3
pnpm -r test
pnpm --filter @omnitwin/api test -- --run tenancy
node packages/web/scripts/demo-smoke.mjs --venue <second-venue-slug>
```

## Forbidden

A venue-specific branch. Silent integration divergence. An export that omits the venue's assets. Activating a frontier item without its prerequisite. A restore claimed without a drill.

## Human inputs

HUMAN.md 14 (the second venue), 15 (console actions).

## Unlocks

The company the vision describes: infrastructure for physical experiences, one venue at a time.
