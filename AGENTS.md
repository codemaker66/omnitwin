# AGENTS.md — Codex Instructions for Venviewer

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
