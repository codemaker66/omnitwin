# AGENTS.md — Codex Instructions for Venviewer

## Current delivery instruction — 7 September 2026

Read and follow the shared [build, ship and verify contract](.claude/conventions/shipping-changes.md).
Requested product changes include deployment and live verification. This newer
founder instruction supersedes older local-only handoffs, blanket freezes and
owner-only deployment restrictions in the documents below. Ownership coordinates
safe releases; the originating task remains responsible for delivery.

The company/product is Venviewer.
The repository/package codename may still use omnitwin / @omnitwin/*.

Read first:
- CLAUDE.md
- .claude/AI_INTEGRITY_RULES.md
- docs/state/tasks.md
- docs/architecture/adr/
- docs/audits/

Do not invent .Codex paths.
Do not invent Codex-specific subagents.
Do not blindly rename omnitwin package names.
Treat CLAUDE.md as the canonical project policy unless this file explicitly overrides it.

Current priority:
- T-091: make Trades Hall real.
- T-087 Spark/Three runtime is prerequisite.
- Avoid new product ideation unless explicitly requested.

Engineering rules:
- TypeScript strict.
- No any types.
- No skeleton code.
- No fake integrations.
- No public claims ahead of evidence.
- Use existing tests and add regression tests for changed behavior.
