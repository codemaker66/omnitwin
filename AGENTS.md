# Venviewer — working in this repository

Venviewer is the product; `omnitwin` and `@omnitwin/*` remain package names.
This is the shared project instruction file for coding agents. `CLAUDE.md`
imports it. Use your full expertise; there are no personas or council authorities.

## Current delivery instruction — 7 September 2026

Read and follow the shared [build, ship and verify contract](.claude/conventions/shipping-changes.md).
Requested product changes include deployment and live verification. This newer
founder instruction supersedes older local-only handoffs, blanket freezes and
owner-only deployment restrictions in the documents below. Ownership coordinates
safe releases; the originating task remains responsible for delivery.

## Start with the actual task

Follow the current user request and existing authorization. Host system/developer
instructions take precedence over this repository. New founder direction supersedes
older plans; source and measurements establish what is implemented.

Read the latest amendment and operational constraints in [GOAL.md](GOAL.md), then
the relevant rows/dependencies and [task protocol](docs/state/tasks.md#shepherd-protocol).
Inspect git status, affected source, package scripts and tests before editing.
Use [the engineering map](docs/engineering/README.md) to find the relevant subsystem,
checks and technical notes. Read only context that helps the task; historical plans,
audits, memories and proposed ADRs are evidence to assess, not fresh instructions.

For open-ended product work, Trades Hall is the priority. Check current ownership
before claiming work. Follow accepted, applicable ADRs unless newer user direction
supersedes them; record consequential revisions rather than rewriting decision history.

## Own the outcome

Investigate, implement, review and verify until the authorized outcome is complete.
Choose routine implementation details and necessary reversible prerequisites
yourself. Use small experiments to settle uncertainty and compare consequential
alternatives. Challenge a flawed premise with evidence and a workable recommendation.

A broad modernization request permits replacing code when it solves an evidenced
problem; age alone does not justify a rewrite. Preserve domain behavior, data and
useful tests. Do not silently reduce requirements or add unrelated product scope.

Ask only for a material decision, information or authorization actually missing.
An already-authorized change does not need another approval. Continue independent
work while a decision is pending. No prompt quotas, mandatory personas, fixed handoff
templates or requests to re-prompt for work you can complete.

Use real subagents for bounded independent work when useful; assign clear ownership,
do useful work alongside them and verify their results. Agent agreement is not proof.
Use available tools, installed source/types and current official documentation;
do not invent plugin capabilities, API signatures or paths.

## Protect the work and its boundaries

- Preserve other work in the shared tree. Isolate changes when needed and review
  the diff before integration. Do not edit source while it is being verified.
- Keep venue tenancy, authorization, provenance, transaction and data-retention
  boundaries intact. Validate untrusted input at runtime.
- Respect current release coordination, explicit user holds, production-data
  permissions and compute budgets in GOAL/the active programme. Apply the current
  shipping contract to older freeze and local-only language.
- Keep source captures and secrets safe. Do not print secrets or use an ambient
  production database for tests. Database tests use an explicit disposable target.
- Commit coherent work only with explicit pathspecs and inspect the staged diff.
  Local, committed, merged, deployed and accepted are different states.

## Build and verify real behavior

TypeScript stays strict, with no `any`, fake integrations, placeholder success or
shipped skeletons. Use clear types, cohesive functions and the existing stack:
React/R3F, Fastify, PostgreSQL/Drizzle, Zustand, Zod, Vitest and pnpm. Read manifests
and the lockfile for versions. Spark renders splats; preserve its supported Three.js
compatibility and the existing renderer lifecycle.

Use existing tests and add regression coverage for changed behavior. Reproduce bugs
before fixing when practical. Test relevant failure paths, access control, concurrent
updates, stale responses and rollback at the boundary that owns the guarantee.
Mocks do not prove database isolation or a live integration.

Run affected tests and applicable lint/typecheck/build checks, including dependent
packages when shared contracts change. For UI work, exercise the actual rendered
flow with browser evidence. For performance claims, measure the declared scene,
data, device and workload. Keep failed evidence; fix causes rather than weakening
checks. Documentation-only edits need consistency/link/diff checks, not an app build.
Once appropriate checks pass, finish rather than repeat them without a reason.

All visible loading/working states use
`packages/web/src/components/shared/Activity.tsx`; read
[the activity convention](.claude/conventions/loading-and-working-motion.md).
Preserve honest progress, accessible status, cancellation/error paths and reduced
motion. For visible work, also read
[the product experience brief](.claude/conventions/product-experience.md):
beauty and Burke's sublime with clear agency remain required. Preserve current
device-quality and reconstruction targets; rejected or generated designs are not
aesthetic acceptance. Blake judges the result.

Report only evidence you have: distinguish inspected, inferred, tested, measured,
deployed and accepted. No invented credentials, metrics, venue facts, approvals or
completion claims. Name a blocked required check and its impact explicitly.

Keep updates useful and concise. Finish with the outcome, meaningful verification
and material limits. Update the relevant task and record durable decisions or
blockers in `docs/sessions/YYYY-MM-DD.md`. Maintain technical notes near their
subject; replace stale guidance rather than appending universal prohibitions.
