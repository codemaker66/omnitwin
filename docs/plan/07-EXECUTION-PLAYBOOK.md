# 07 · Execution Playbook — how the Floor actually gets built

10 July 2026 · Answers: "how do we get you / Claude Code / a mixture of applications to build this?" · Assumes 06's G-series gap list.

---

## 1. Division of labor (who does what, and why this split)

| Role | Tool | Does | Never does |
|---|---|---|---|
| **Design & strategy brain** | Cowork (this) | Specs, build cards, audits, research, design reviews of screenshots, copy + claim-lexicon, wireframes, competitive scans, doc upkeep | Long implementation sessions in the repo |
| **Implementation engine** | Claude Code in `omnitwin2` | One build card per session; TDD; typecheck/lint/test gates; session logs + tasks.md shepherding per repo CLAUDE.md; uses its Context7 / Playwright / Neon MCPs | Invent scope; ship without the repo's handoff protocol |
| **Verification** | Playwright MCP (in Claude Code) + the repo's frame-budget & visual tests | Screenshot every UI change; pixel-diff golden routes; perf budgets in CI | "Looks right on my machine" |
| **SKU proxy factory** | Blender (MCP available in Cowork) | Furniture GLB proxies: correct dimensions, origins, pivots, LODs, per 01 §5's unscalable-SKU doctrine | Decorative modeling beyond proxies |
| **Splat lane** | RunPod/Lambda + capture factory (T-480) + SuperSplat/splat-transform | Train remaining 7 rooms; compress to SOG; QA in SuperSplat; publish runtime packages | Blocking the UI track — runs in parallel |
| **Camera choreography** | Theatre.js studio (authoring) → GSAP (runtime) | Author band transitions, POV recalls, peak-end orbit, Present-mode moves as editable sequences | Hand-tuned magic numbers scattered in code |
| **Mood only** | Image generators (Midjourney/Flux) | North-star mood boards for stakeholders | Ever defining a pixel of real UI — House tokens do that |

The principle: **specs are compiled here, executed there, verified by machine, reviewed here.** Two brains, one contract.

## 2. The Build Card system (the contract)

Every G-item becomes one or more **build cards** — a single markdown block pasted (or committed) as the opening prompt of a Claude Code session. Card anatomy:

```
BUILD CARD F-12 · Ghost material (G5)
Spec: 01 §2-P2, §14.7 · Tokens: 02 §3 ghost material · Audit: 06 G5
Scope: shader/DOM ghost variants; preview-first paste/duplicate/brush; materialize/strike actions
Files in play: packages/web/src/stores/placement-store.ts, components/PlannerScene.tsx, [new] materials/ghost.ts
Definition of Done:
  - acceptance criteria 01 §21.3 (ghost-preview → single-undo materialize)
  - ghost never blocks picking real objects (test)
  - provenance hue per source (violet AI / brass self) per 02 §3
  - reduced-motion: static opacity; perf: no frame-budget regression
Out of scope: AI schemes (Phase 8), collaborator ghosts (G12)
Verify: vitest + Playwright screenshot vs fixture; paste screenshots into handoff
Handoff: repo CLAUDE.md protocol (COMPLETED/VERIFIED/UNVERIFIED/REMAINING/NEXT)
```

I generate the full card deck from 01/02/06 on request — roughly 25 cards covering G1–G11. Cards are small on purpose: one session, one card, one green gate. The repo's existing discipline (squad personas, shepherd protocol, 6,697 tests) is the enforcement layer; cards just aim it.

## 3. The cadence (a working week)

1. **Plan beat (here, 30 min):** pick the next 3–5 cards; I refresh them against the repo's current state.
2. **Build beats (Claude Code):** one card per session. Session ends with the handoff block + screenshots + updated tasks.md.
3. **Design review (here):** you paste/mount the screenshots or recordings; I review against House (spacing, chip grammar, motion tiers, claim language) and return a punch list — the same way 04 red-teamed the plan.
4. **Truth beat (parallel, weekly):** one more room through the capture factory → SuperSplat QA → runtime package published. Every week the product gets one room more real.
5. **Friday demo rule:** the golden-path demo (00 §5) must run start to finish every Friday, on the worst laptop in the office. What breaks gets a card.

## 4. Sequenced card map (first six weeks of cards, capacity-agnostic)

| Wave | Cards | Outcome (lighthouse) |
|---|---|---|
| A | G1 ×2 (runtime default-on; resolve-over-blueprint load + honest chip) · G2 ×2 (House tokens; chip grammar) | **L0: the room resolves** — Reception Room, real data |
| B | Upgrade lane ×1 (three r185 / R3F 9.5 / Spark 2.1) · G4 ×3 (action log core; store retrofit; history UI) | Foundation for everything; deep undo |
| C | G3 ×3 (altitude rig; ink/Plan band; blueprint absorption) · G9 ×1 (instancing+BVH) | One continuous view, 60 fps |
| D | G5 ×2 (ghost material; preview-first ops) · G7 ×1 (vitals + guest-count reflow) | **L1 feel arrives** — materialize beat, live numbers |
| E | G6 ×3 (timeline UI; scrub morph; flip-gap card + compile hook) | The 4D event; flips become diffs |
| F | G8 ×1 (command verbs) · G11 ×1 (FOH register on proposal share) · polish ×2 (peak-end orbit; loading cinema) | **L2: living proposal** + the demo beats 1–7 all real |

G10 (rooms) runs continuously; G12 (presence) stays parked. AI schemes, Rehearse sim, revenue cards: after F, per SS++ 7–8.

## 5. Tools to add (small list, high leverage)

- **Theatre.js** — author camera/scene choreography visually, export sequences; the difference between "animated" and "directed."
- **SuperSplat (v2.28+)** — splat QA/cleanup + SOG export; adopt its Streamed LOD manifest chunks when upgrading Spark.
- **splat-transform CLI 2.0** — scripted PLY→SOG in the capture factory.
- **recast-navigation-js** — parked until Phase 7 (Rehearse), listed so nobody builds a bespoke navmesh.
- **PostHog** (if 06's observability check comes back empty) — TTFW and primitive-adoption funnels from day one.
- **Figma MCP** (optional): only if you want House components mirrored as a design file for hiring/investors; the product's source of truth stays code.
- Already in hand and sufficient: Context7, Playwright MCP, Neon MCP, Clerk, Resend, R2, Vitest/Playwright, Blender MCP (here).

## 6. Working agreements (so two AIs and one human stay coherent)

- The plan docs (00–08) live in `omnitwin2/docs/plan/` (pending your go-ahead) so Claude Code sessions read them natively; this playbook's card deck lives beside them. Files-in-git is already your ADR-070 doctrine.
- Claude Code never redefines UX; it flags friction back ("card F-12 conflicts with store X") and I revise the card — mirrors the repo's "Blake Clause" for architecture contradictions.
- Claim-lexicon lint (already in code) is the one gate neither of us may soften, in either direction — internal surfaces included (06's crew-minutes labeling).
- Screenshots or it didn't happen: every UI card's handoff includes Playwright captures; design review happens on pixels, not descriptions.
- Session logs + tasks.md remain the memory spine (already your practice — today's T-480/481/482 log is the model).

## 7. Appendix — image-generation, round 2

The two mockups scored: mood 9/10, DNA 8/10 — ghost tables, clearance ring with measurement, phase timeline with playhead, dusk ballroom, champagne palette all landed. Four drift items to correct if you generate more: (1) the **Select/Move/Rotate/Scale toolbar** — the Floor has no persistent tool ribbon, and *Scale must not exist* (unscalable-SKU doctrine); (2) the left rail is a CAD layers tree (Walls/Doors/Ceiling) — ours lists Phases/Zones/Objects, we are not a CAD; (3) **POLYS/MEMORY/FPS debug stats** — internal mode only; the corner belongs to Guests/Clearance/Flip/£; (4) no command pill, evidence chip, or presence. Panels should also be one notch more transparent (the room bleeds through).

Revised prompt (append `--ar 16:9 --style raw` for Midjourney):

> Professional UI concept render of a next-generation 3D venue event-planning app, dark mode. The entire screen is a photorealistic 3D-scanned grand Victorian ballroom at dusk used as the working canvas; the room IS the interface. Minimal chrome, highly translucent smoked-glass panels with the room visible through them: top bar only — small breadcrumb text left, slim pill-shaped command input centered ("Ask or command"), two tiny avatar dots, a small sage-green status chip and one champagne-brass button right. Left: one narrow floating panel listing event phases and furniture groups (no CAD layers, no walls/doors tree). Right: slim inspector for a selected round table. NO toolbar, NO select/move/rotate/scale buttons, NO polygon or FPS counters. Bottom: thin timeline of five phase blocks with a brass playhead. Bottom right: four rows of monospaced stats — guest count, clearance check, flip minutes, price in pounds. In the room: elegant round banquet tables; three rendered as translucent violet holographic ghosts; the selected table outlined in champagne brass with a soft sage clearance ring and a small measurement label. Palette: near-black warm graphite, ivory text, single champagne-brass accent, muted sage/amber/cyan dots only. Style: Apple-keynote product design, Bloomberg seriousness, luxury architecture studio, cinematic window light, ultra-sharp UI, 8K.

Worth generating next: the **Plan band** (same room, straight-down orthographic, photograph dissolving into ink linework at the edges — the blueprint-dissolve moment) and the **FOH proposal on a phone** (ivory, serif, one brass Approve button) — those two plus the existing pair cover the deck-and-investor set.
