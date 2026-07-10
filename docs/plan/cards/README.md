# Build Cards — protocol

One card = one Claude Code session. Paste the card as the session's opening instruction (after the repo's standard CLAUDE.md preamble). Cards are generated from the plan docs in `docs/plan/` (00–08); when a card conflicts with repo reality, flag it back per the Blake Clause — do not silently reinterpret.

Reading order for new sessions: `06-GAP-AUDIT.md` (current truth) → `01-PLANNER-UX-SPEC.md` (the Floor) → `02-DESIGN-LANGUAGE.md` (House) → this deck.

Rules that bind every card:

- Repo CLAUDE.md gates stay absolute: typecheck, lint, tests, handoff protocol, no TODOs, no `any`.
- Claim-safe lexicon applies to ALL surfaces, internal included (estimates say "assumption" until actuals exist).
- Every UI card's handoff includes Playwright screenshots.
- No card may regress `sspp-performance-budget.test.ts` or the loading budgets in 01 §17.
- Naming: **Hybrid** (decided 10 Jul 2026) — existing `cockpit*` code names stay; new modules, UI copy, and docs use Floor/House vocabulary. No mass renames.
- Supersedence: `06-GAP-AUDIT.md` §2 replaces any older "current gaps" list (including the project bible's) — regenerate 06 after each wave rather than editing old lists.

Waves: A (golden loop) → B (foundation) → C (altitude + perf) → D (ghosts + live numbers) → E (timeline) → F (command + FOH + polish) → M (Event Cinema, first moonshot). G10 (room training on RunPod) runs parallel to all waves. Presence/multiplayer (T-105) stays deferred until after F.

Decisions of 10 Jul 2026:

- **Not a demo — Trades Hall is client №1.** The weekly Friday run is a *delivery check* against Beverly's real events, on real venue hardware. Ops depth ranks equal to cinema polish; expansion waits until Trades Hall is complete.
- **GPU spend approved**: start the G10 training queue immediately (RunPod/Lambda, ~£100–200/room); log every run to `state/training_runs.jsonl` (currently empty — fix as part of the first run).
- **Fonts licensed now**: Söhne + Söhne Mono (Klim) and Canela (Commercial Type) become the primary faces; Geist/Geist Mono/Fraunces remain the fallback stack in tokens. Card A3 includes wiring the licensed files.
- **Wave M = Event Cinema** (see `wave-M.md`).
- A playable interaction prototype of the Floor lives at `docs/plan/prototypes/floor-v0.html` — reference for feel (altitude, ghosts, timeline morph, live numbers, command); it is NOT product code and says so in its own evidence drawer.
