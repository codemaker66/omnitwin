# The Rite — Landing Page Redesign (Design Spec)

**Date:** 2026-07-01
**Status:** Approved by Blake (conversation, 2026-07-01)
**Route surface:** `/`, `/landing`, `/editor` (unchanged aliases)
**Replaces:** `packages/web/src/pages/LandingPage.tsx` + `LandingPage.css` (Claude Design handoff port, Apr 2026)

---

## 1. Intent

Redesign the public marketing homepage for Trades Hall Glasgow so that it embodies
the philosophy of the sublime — Burke (darkness, obscurity, astonishment), Kant
(the mathematical sublime: magnitude that overflows imagination), Schopenhauer
(will-less contemplation) — as a **single three-act dramaturgy** the visitor
physically passes through by scrolling. The page must:

- feel totally unlike any other webpage (an *experience with a threshold*, not a site),
- be a pleasure and genuinely fun to interact with (the flame, the carried light),
- read as months of genius-level care in tiny details,
- still convert: bookers reach `/plan` and the enquiry path without friction,
- load instantly and remain within the repo's bundle discipline (no Three.js on this route).

Audience: event bookers for Trades Hall (couples, organisers). The venue is the
protagonist; Venviewer the platform stays backstage.

## 2. The Experience (approved §1)

### Beat 0 — The Threshold (0–2 s, first visit only)
- Near-black first paint (`#030707`). One candle-flame point of light (WebGL
  fragment shader on a single canvas). One serif line fades in:
  *"There is a hall in Glasgow that has been lit for 230 years."*
- Small pulsing **Enter ↓** glyph. Any scroll / click / keypress enters instantly.
- Repeat visitors (`sessionStorage` flag `vv-rite-entered`) skip the hold; the line
  is already faded in.
- All content is in the DOM at first paint. Darkness is CSS. Crawlers, screen
  readers, and reader mode receive a complete, semantically structured document.

### Act I — Darkness (Burke; ~2.5 viewport-heights)
- Scroll descends into the hall. The cursor carries a soft light radius
  (CSS mask + custom properties, spring-lagged). It grazes edge-lit fragments of
  architecture (chandelier silhouette, dome curve, balustrade) revealed at ~8 %
  brightness from existing photography crops.
- Two short serif lines pace the descent. No nav yet.
- Touch devices: the light is carried by scroll position instead of cursor.

### Act II — Magnitude (Kant; ~3 viewport-heights)
- Hard cut to light: dome photograph full-bleed from beneath.
- Typographic architecture: a viewport-height **21** that cannot fully fit,
  *metres, end to end* in small caps beside it; then
  *7 metres to the dome · 240 at dinner · 1794* resolving from overflow into calm.
- Faint metre-etchings behind the "21" like a ruler at architectural scale.
- Nav fades in from here on. A persistent quiet **Skip to the rooms ↓** affordance
  sits bottom-right through Acts I–II.

### Act III — Contemplation (Schopenhauer; 4 chapters, ~1 viewport each)
- The four rooms, empty, one per chapter: full-bleed photograph drifting at
  dusk-speed (20 s slow scale, `transform` only), room name in serif, one line of
  prose, capacities in small caps in the margin (*400 standing · 240 banquet*),
  quiet link to each room's showcase page (`/venues/trades-hall/rooms/:slug`).
- Sound toggle (corner, OFF by default): the acoustic of an empty hall,
  synthesised via Web Audio (filtered noise + slow LFO — no audio asset shipped),
  created only on first toggle. Never autoplay.

### The Return
- Full darkness again, then: *"The room is yours to arrange."*
- One gold CTA → `/plan`. Beneath: practical footer — enquiry contact, legal links
  (privacy / terms / accessibility), Venviewer credit.

### Reduced motion / low power
- `prefers-reduced-motion` collapses the choreography into a first-class static
  rendering: same content, same order, no parallax, no cursor light, no entry
  hold; flame becomes a static gradient. This variant is designed, not degraded.

## 3. Visual Language & Details Ledger (approved §2)

**Palette as lighting design.** Heritage DNA kept: candle-gold `#d7a64b`,
parchment ink `#fbf2df`, near-black `#030707`. The palette moves through the acts:
Act I monochrome black + flame gold → Act II cool stone/daylight → Act III dusk
warmth → Return black + gold.

**Typography.** Newsreader variable (display serif; optical-size axis animated
with scroll depth in Act I — type physically "comes closer" in the dark), italics
for whispered lines, Geist for UI small caps, tabular figures for all numbers,
hairline gold rules at 28 % opacity.

**Motion grammar.** Spring physics for every interactive response (standing rule —
no tweens for objects). Nothing linear. Every input answered within 100 ms.
Scroll choreography via CSS scroll-timelines where supported, rAF spring fallback.
Act cuts via View Transitions API where supported.

**Details ledger** (each is a requirement, not a suggestion):

1. Flame is alive: breathes ±2 %, responds to cursor velocity (gutters when swept
   past, steadies when still).
2. Scrollbar is a wick: hairline gold thread; progress reads as a candle burning
   down the page.
3. Cursor light has physics: warm core, cool falloff, spring lag — carried, not painted.
4. Focus rings are candle-glow halos (accessibility as beauty).
5. Text selection is gold on black.
6. Capacities count up (0 → 240) in ~600 ms tabular figures on entering view; zero CLS.
7. CTA ignites: light sweep enters from the cursor's entry angle.
8. Image placeholders are art: dark gradient abstracts per room; AVIF where
   available with JPEG fallback, lazy per act.
9. The tab remembers: leaving mid-rite sets the tab title to *"The hall is still lit."*
10. `theme-color` matches the black; mobile browser chrome melts into the page.
11. Print stylesheet yields an elegant one-page fact sheet (rooms, capacities, contact).
12. After local sunset, ambient hue runs ~2 % warmer. Never announced.

**Budgets:** LCP < 1.5 s, CLS = 0, page-specific JS < 60 KB gzip, shader ~2 KB.

## 4. Architecture (approved §3)

```
packages/web/src/pages/LandingPage.tsx     — route shell: meta, threshold flag, act orchestration
packages/web/src/pages/landing/
  ThresholdAct.tsx    — Beat 0 + Act I
  MagnitudeAct.tsx    — Act II
  ContemplationAct.tsx— Act III room chapters
  ReturnAct.tsx       — CTA + footer
  FlameCanvas.tsx     — raw WebGL flame (no Three.js)
  useCursorLight.ts   — spring-lagged light → CSS custom props (no React re-renders)
  useScrollRite.ts    — act progress; scroll-timeline detect + rAF fallback
  useRoomTone.ts      — Web Audio synth, lazy init, toggle state
  rite-motion.ts      — spring constants, easing scale (pure)
  rite-copy.ts        — all copy as data (single source)
  rite.css            — scoped `.vv-rite`
```

- Old `LandingPage.tsx`/`LandingPage.css` deleted; git history preserves them.
- Room facts imported from `trades-hall-room-showcase.ts` / `room-geometries.ts` —
  capacities can never drift from planner truth.
- Zero network calls beyond static assets.

**Progressive-enhancement ladder (error handling):** WebGL fails → static gradient
flame + CSS flicker · no `scroll-timeline` → IntersectionObserver + rAF springs ·
no View Transitions → opacity cuts · audio blocked → toggle quietly disables ·
JS off → readable semantic document.

## 5. Testing

- **Vitest:** spring math (`rite-motion`), act-progress math (`useScrollRite`),
  copy completeness (`rite-copy`), threshold sessionStorage logic, reduced-motion
  branch, meta tags. Existing happy-dom + mocked-canvas patterns.
- **Visual:** extend `visual-check` harness with landing captures — each act at
  fixed scroll positions, reduced-motion variant, phone viewport.
- **Performance:** budget test (page JS < 60 KB gzip); scroll-jank spot-check via
  frame-budget harness.
- **E2E:** landing → `/plan` click-through preserved in the public flow spec.

## 6. Out of scope

- New photography / video production (works with existing exports + CSS treatment).
- Any change to `/plan`, pricing, dashboard, or the planner itself.
- SaaS-audience messaging (Venviewer-the-platform page is a separate future task).
- Live 3D / Gaussian splats on the landing route.
