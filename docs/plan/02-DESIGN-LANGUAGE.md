# 02 · HOUSE — The Venviewer Design Language

v1.0 · July 2026 · applies to every surface; the Floor (01) is its deepest application

---

## 1. The idea

The design language is called **House**, and it has two registers borrowed from hospitality's own vocabulary:

- **Back of House (BOH)** — for operators. Dark, dense, precise, calm. The service corridor: everything within reach, nothing performing.
- **Front of House (FOH)** — for clients. Ivory, spacious, cinematic, warm. The ballroom: fewer things, perfectly lit.

Same bones (tokens, spacing, iconography, motion physics), different dress. This duality is the brand: a company that is Bloomberg-serious backstage and Aman-hotel-gracious out front. Staff feel understood ("back of house" is their phrase); clients never see a spreadsheet.

Non-negotiables inherited from doctrine: spatial truth before decoration · quiet precision · controlled density · operational legibility · systemic consistency · reversible decisions · claim-safe language everywhere.

## 2. Principles

1. **The room is the light source.** UI never competes with the captured space. Chrome is smoked glass over the scene; the scene's average color subtly tints panel surfaces (≤ 8% mix) so the interface is literally lit by the venue. Cheap to build, impossible to forget.
2. **Nothing enters, everything resolves.** Elements don't slide in from offscreen; they resolve in place from blur/depth, as if focus was pulled. Exits dissolve. The world feels continuous, not assembled.
3. **One accent.** Brass. Status hues exist for meaning only. A screen with three accent colors is a screen with none.
4. **Numbers are instruments.** Tabular, mono-spaced, scrubbable, provenance-aware. If a number moves, it counts; if it's interactive, it shows tick affordance.
5. **Restraint is the luxury signal.** No gradients-for-drama, no glow, no confetti. The most premium thing a UI can do is respond instantly and mean everything it says.

## 3. Color

### BOH (dark, default for operators)

| Token | Value | Use |
|---|---|---|
| `bg/0` | `#0B0A09` | canvas behind the scene, Focus mode |
| `bg/1` | `#131110` | panels (with blur + scene tint) |
| `bg/2` | `#1B1917` | raised elements, inputs |
| `hairline` | `rgba(245,240,232,0.08)` | all borders; 0.12 on hover |
| `text/1` | `#F4EFE6` | primary (warm ivory, never pure white) |
| `text/2` | `rgba(244,239,230,0.62)` | secondary |
| `text/3` | `rgba(244,239,230,0.38)` | muted, hints |
| `accent/brass` | `#C6A15B` | selection, primary actions, presence "you" |

### FOH (ivory, default for clients)

| Token | Value | Use |
|---|---|---|
| `paper` | `#FAF7F0` | canvas |
| `ink` | `#161310` | text |
| `accent/brass` | `#A9853F` | (deepened for contrast on paper) |

FOH pages may shift palette by event time — a 6 pm September wedding proposal renders in a dusk variant (deeper paper, warmer brass). A detail couples remember.

### Status hues (both registers — meaning only, never decoration)

| State | Hue | Also always |
|---|---|---|
| Current | sage `#8FAE8B` | check icon + label |
| Review required / caution | amber `#C99A5B` | icon + verb ("review") |
| Stale | grey (`text/3`) | verb ("re-run") |
| Missing | no fill — dashed hairline outline | label |
| Blocked / conflict | oxblood `#B25454` | named rule inline |
| Simulated | cyan `#6FB7C9` | "Simulated" rendered into the overlay |
| AI-proposed / assumption | violet `#9D8BC9` | AI glyph |

Chip grammar is canonical in 01 §9; this table restates it and may not drift from it.

Color-blind law: hue never carries meaning alone — every status pairs icon + label. All text ≥ 4.5:1 contrast; FOH body targets 7:1.

### The ghost material (P2, cross-cutting)

32% opacity fill of the object's own albedo, 1 px inner stroke in provenance hue (violet = AI, presence hue = collaborator, brass = your preview, cyan = simulation), plus a 3 s ±4% opacity "breath" (static under reduced motion). Ghosts cast no shadows and never occlude picking. One material, everywhere, learnable in one encounter.

## 4. Typography

Three voices, two registers:

| Role | Face (license) | Fallback (free) | Notes |
|---|---|---|---|
| UI grotesque | Söhne or Neue Haas Grotesk | Geist / Inter | 12/13/14 px UI scale; sentence case everywhere |
| Data mono | Söhne Mono or Berkeley Mono | Geist Mono / JetBrains Mono | all vitals, dimensions, money; `tnum` always |
| FOH display serif | Canela or Tiempos Headline | Fraunces | proposals, showcase, hero moments only |

Rules: two weights per face (400/500 UI; display may use 300). No ALL CAPS except 11 px micro-labels with +6% tracking. Numbers that can be scrubbed show a dotted underline affordance. BOH line-height 1.45; FOH 1.7. The serif never appears in BOH; the venue's operational world is deliberately unromantic.

## 5. Space, depth, and surface

- 8 pt grid, 4 pt micro-adjust. Panel radius 12 px; controls 8 px; chips 999 px.
- Depth model (back → front): the room → floating panels (blur 24 px, `bg/1` at 72% + scene tint) → drawers → command pill → toasts. Shadows only on floating layers, single soft pass, no stacked shadows.
- Hairlines do borders' work; shadows do elevation's work; never both heavy.
- Density: Comfortable default; Compact toggle (-20% paddings) for power users, persisted per person.
- The scene is never letterboxed by chrome — panels float *over* it with visible room at all four edges (except Ledger view, which is honestly a table).

## 6. Motion

Physics constants (Motion/GSAP implementation in 03):

| Tier | Duration | Curve | Used for |
|---|---|---|---|
| Instant | ≤ 100 ms | linear/ease-out | hover, ticks, selection |
| Deliberate | 200–300 ms | spring (stiffness 380, damping 32) | materialize, panels, chips |
| Cinematic | 500–800 ms | custom quintic, 80% early velocity | camera only: band jumps, POV recall, Present |

Laws: everything interruptible; max two concurrent choreographed motions; no motion on data ticks (vitals count, they don't bounce); scrub morphs are time-linear (the hand is the easing). Reduced motion: springs → 120 ms fades, camera cuts, morphs → crossfades.

Signature moves (the ones people describe to friends):

1. **The room resolves** — blueprint linework first, splat develops over it coarse-to-fine.
2. **The blueprint dissolve** — Altitude's perspective→orthographic ease where photoreality becomes drawing.
3. **Materialize / Strike** — 240 ms rise-and-settle; sink-and-fade. Theater verbs, theater physics.
4. **The wipe** — variant A/B compare sweeping across the room.
5. **Peak-end orbit** — the 3 s goodbye that shows you what you built.

## 7. Sound (optional, off by default)

"Felt & brass" palette, ≤ −30 LUFS, no sound over 80 ms except the check-pass note: place = felt thock · snap = fingernail tick · materialize = low felt press · check pass = single muted brass note · error = dry knock (never a buzzer). All-or-nothing toggle; obeys OS silent state. Sound exists because luxury objects are also heard — but silence must be a first-class experience.

## 8. Voice

- **BOH**: verb-first, terse, zero jargon. "Strike 4 tables?" "Flip window is 10 min short — see estimate." Errors: cause → next step. Never blames, never exclaims.
- **FOH**: concierge warmth without gush. "Here is your evening, from first arrival to last dance." Second person, present tense, no exclamation marks, no emoji ever.
- **Claim-safe lexicon** (from doctrine) is enforced in the copy system: allowed terms (planning evidence, machine checked, simulated, not yet signed, guidance…) are componentized; forbidden claims (fire approved, certified safe, survey-grade, photoreal digital twin…) fail CI. Marketing cannot outrun evidence *by construction*.

## 9. Iconography and presence

- 1.5 px stroke, 20 px grid, geometric, open forms; filled shapes reserved for status dots and the AI glyph. No skeuomorphs, no 3D icons — the room supplies the realism.
- Presence: each person = a warm-light point + hue + initials chip. "You" is always brass. Client presence (in portal co-view) renders FOH-soft, staff presence BOH-precise.
- The AI glyph is a small violet spark — consistent across ghosts, cards, and provenance rows. The AI is *visible* by design; an unlabeled AI act is a design-system violation.

## 10. Component inventory (build order for the Floor)

1. Smoked-glass panel + drawer + rail (with scene-tint)
2. Status chip system (evidence states, provenance badges)
3. Vitals cluster (tabular mono, count transitions, scrub affordance)
4. Command pill (input, results tray, scheme cards, answer chips)
5. Timeline (phase blocks, playhead, gap objects, conflict glow)
6. Context arc (radial, 6 verbs max)
7. Ghost material (shader + DOM variants)
8. Inspector tab set (Object/Checks/Evidence/Ops)
9. Ledger table (virtualized, editable, a11y-first)
10. Toast/hint (one at a time), readiness ring, presence avatars, POV markers
11. FOH proposal shell (cover, hero shot, option cards, comment anchors, approve bar)

Each ships with: dark+light, FOH/BOH variants where relevant, reduced-motion states, keyboard map, ARIA contract, and visual-regression fixtures. A component without its states is not done.

## 11. What House refuses

No gradients as decoration · no glassmorphism-for-its-own-sake beyond the panel system · no drop-shadow text · no skeleton shimmer theater (real progressive content instead) · no dark patterns (fake urgency, guilt copy, confirm-shaming) · no emoji in product UI · no Lorem Ipsum in any mock (real venue data or honest placeholders: "No captured layer yet"). The strongest aesthetic decision is what never appears.
