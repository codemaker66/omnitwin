# AGENTS.md — Venviewer

Read [CLAUDE.md](CLAUDE.md) as the canonical project policy, then
[.claude/AI_INTEGRITY_RULES.md](.claude/AI_INTEGRITY_RULES.md) and
[GOAL.md](GOAL.md). Follow CLAUDE's selective task, ADR, audit and convention loading
instructions; use current task evidence rather than frozen priority numbers here.

The company/product is Venviewer; existing `omnitwin` / `@omnitwin/*` package names
remain valid. Do not mass-rename them.

Use the tools and delegation capabilities actually provided by the current host.
Do not invent `.Codex` paths, plugin commands or named runtime agents. The squad
and council files are optional domain lenses, not required identities or limits on
reasoning. Complete authorized work and resolve routine choices without asking the
user to dispatch each step.

Durable engineering requirements: TypeScript strict, no `any`, no skeletons or fake
integrations, no claims ahead of evidence, and regression tests for changed behavior.
All loading/working UI uses `packages/web/src/components/shared/Activity.tsx`; read
[.claude/conventions/loading-and-working-motion.md](.claude/conventions/loading-and-working-motion.md).
Read [the product experience convention](.claude/conventions/product-experience.md)
for visible work. These founder requirements apply in every session and worktree.
