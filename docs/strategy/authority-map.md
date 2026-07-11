# Authority Map — which rulebook governs what

Added 11 Jul 2026. Read this when two planning documents seem to disagree.

This repo carries two approved planning universes, produced in parallel:

1. **The Diary canon** (`docs/strategy/the-diary-research-canon.md`) — governs the **booking/calendar domain**: bookings, holds, the option ladder, conflict engine, yield, client comms/drip, payments, Day Sheets, ops run surface, and the calendar timeline UI. Within that domain it overrides everything except the two universal laws below.
2. **The product plan** (`docs/plan/00–08` + `docs/plan/cards/`) — governs the **spatial product**: the 3D planner ("the Floor"), room runtime packages, capture pipeline, proposals/showcase surfaces, and product-wide design tokens/motion.

Universal laws above both: the repo's claim-safety doctrine (planning-grade language, honest `not_checked`, no compliance badges) and root `CLAUDE.md` engineering gates.

## Rulings

- **Translucency/glass (default ruling, owner may overturn):** panels may be translucent only where what shows through is *the venue itself* (the 3D room in the Floor). On all data surfaces — Diary board, Day Sheets, portal, dashboards — Ink & Gilt's rule stands: crisp, opaque, no blur anywhere information lives. One token system serves both.
- **Design tokens:** one file. The House token layer (plan card A3) absorbs Ink & Gilt's additions (`--vv-paper`, `--vv-paper-ink`, pencil-hatch, gold-edge width, wax-red). Neither language forks the palette; both are dialects of the same graphite/gold/cream/cyan system already in `web/src/global.css`.
- **One command rail:** the Diary's ⌘K palette (Canon §8) and the Floor's command pill (plan 01 P5) are two grammars on ONE shared command/action infrastructure. Whoever builds second reuses the first's rail.
- **Naming:** the calendar surface is **"the Diary"** (canon name, adopted product-wide). The 3D planning surface is **"the Floor."** The phase scrubber inside the Floor is "the Timeline"; the Diary's room-lanes surface is "the Board." Existing `cockpit*` code names stay (hybrid naming decision, 10 Jul).
- **Realtime for bookings:** Canon §9/§15 doctrine adopted (server-authoritative commands over existing websocket, exclusion constraint as final arbiter, no CRDTs for bookings). The plan's 03 §sync recommendations are superseded *for this domain*; plan doc 03 carries a matching amendment note.
- **Conflicts not covered here:** stop and ask Blake (Blake Clause). Do not improvise a merge.

## Current build order (owner-approved 11 Jul 2026, may be revised)

1. Diary Slice 1 (backend only — prompt at `docs/strategy/diary-slice-1-prompt.md`)
2. Plan cards A1 → A2 (real room loads in the planner)
3. Plan cards A3 → A4 (merged token layer per the ruling above)
4. Then per each universe's own phasing, one session per card/slice.
