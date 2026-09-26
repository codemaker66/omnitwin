## How to read this report

This was a read-only investigation. No repository files were changed, git state is untouched and no servers were started.

**What was inspected in the repo**
- `.claude/conventions/product-experience.md`.
- The desk CSS and components, and `EnquiriesView.tsx:514`.
- The desk design record, with all seven captures viewed.
- The selected reference PNG.
- Four committed snapshot baselines: analytics, ops handoff, landing and planner.
- `index.html`, `global.css`, `house-tokens.css` and `DashboardLayout.css`.
- The font CSS, plus the actual woff2 files, read with fontTools in the scratchpad.
- `router.tsx`, the Activity component and convention, `.claude/skills/review-animations/STANDARDS.md`, and `docs/research/r1-incumbent-teardown.md` and `r4-calendar-ux.md`.

**What was measured**
- Every contrast ratio below was computed with the WCAG 2.x relative-luminance formula.
- Colour-vision separation was computed with the Machado (2009) simulation matrices and OKLab distance.

**What was fetched this session**
- Apple HIG pages, as JSON.
- W3C WCAG *Understanding* docs, from the w3c/wcag GitHub repo.
- The Radix scale documentation.
- The Carbon and Material motion tokens.
- The Mailchimp voice guide.
- The Inter and Newsreader READMEs.
- Third-party CSS extractions of the linear.app, vercel.com, airbnb.com and raycast.com **marketing** sites. These are not the product apps and not official documentation.

**Limits on the research**
- The WebSearch budget for this session was already exhausted: all 200 calls had been used before this task started.
- The egress proxy blocked linear.app, stripe.com, nngroup.com, vercel.com, w3.org, wikipedia, pubmed, arxiv, culturedcode.com, superhuman.com, raycast.com and rsms.me.
- Claims about Superhuman, Things 3, Stripe, Notion, Arc, Airbnb host tools and luxury hotel apps, and some psychology papers, are therefore marked **[recalled, not verified this session]**. Treat them as leads, not evidence.

---

## 1. What makes software feel luxurious and complete, not merely clean

"Clean" means nothing is wrong. "Complete" and "luxurious" means someone clearly decided every detail, and nothing breaks the spell. Across the references, seven qualities recur.

1. **Restraint with a point of view.** There are few materials, each with one job:
   - Linear's small speed and radius vocabulary, extracted from linear.app's CSS: quick 0.1 s, regular 0.25 s, radii 4/7/16.
   - Apple's advice to minimise typefaces and use colour "judiciously".
   - Venviewer already has its point of view: ivory paper, a forest decision surface, copper for the numbers that matter, and sage ground.
2. **Typographic craft.**
   - A display face used for meaning, not decoration.
   - UI sans set with size-dependent tracking: in the linear.app extraction, body is -0.011em and titles -0.022em.
   - Intermediate variable weights: Linear uses 510 and 590.
   - Tabular numerals wherever numbers are compared.
   - Optical sizing: Apple's "dynamic optical sizes… a single, continuous design".
3. **Speed as the luxury.** Linear's local-first model is quoted in the repo's research at `docs/research/r4-calendar-ux.md:9`: "There are no spinners because there is nothing to wait for… loads most pages in less than 50ms". Apple says "The best content-loading experience finishes before people become aware of it."
4. **Consequence-aware language.** Apple asks for verbs ("'Send' often works better than 'Let's do it!'"), no "oops", and no "we". Mailchimp's voice is "Plainspoken… clarity above all" and avoids "cheap plays to emotion". This is exactly Blake's rule of encouragement through design, never through words.
5. **Designed endings.** **[recalled, not verified this session]**
   - Superhuman marks Inbox Zero with a full-bleed photograph rather than praise.
   - Things 3 shows a small progress pie per project that fills as items close.
   - Both reward with beauty and closure, not points.
   - The desk's sealed "All caught up" and its room photograph follow the same logic.
6. **Material honesty and depth.**
   - Apple uses materials to separate content from controls, keeps glass to the controls layer and "sparingly", and never puts it in content.
   - Airbnb's extracted elevation is a whisper: `rgba(0,0,0,.02) 0 0 0 1px, rgba(0,0,0,.1) 0 8px 24px`.
   - The selected reference goes further: depth comes from overlapping opaque planes, not blur.
7. **Completeness.** Every state is drawn: first run, filtered-empty, caught up, loading, stale, error, denied, offline, long names, 0/1/many plurals, phone, print. This is where Venviewer currently breaks the spell. The desk is complete, but its neighbours (analytics, ops handoff, admin, error states, the planner chrome) are still a dark cyan-and-gold product.

### Findings by dimension

**Typographic systems**
- Apple:
  - "In general, avoid light font weights… Ultralight, Thin, and Light… can be difficult to see, especially when text is small."
  - Minimum text is 11 pt on iOS and 10 pt on macOS.
  - "Minimize the number of typefaces."
  - Avoid tight leading on text of three or more lines.
- Newsreader is "primarily intended for continuous on-screen reading in content-rich environments" (Production Type README). The shipped file is variable, with wght 200-800 and **opsz 6-72**, as inspected.
- Inter is "designed for computer screens" and has tabular numbers (rsms/inter README). The shipped subset has **no** opsz, slashed zero, case or stylistic-set features, as inspected.
- For Venviewer:
  - Newsreader carries meaning: titles, names, lede sentences and quotations.
  - Inter carries operation: labels, meta, numerals and controls.
  - Light 300 is allowed only for large numerals, as in the desk.
  - Tracking is tightened by size.
  - `font-optical-sizing: auto` stays on.

**Spacing scales.** The extracted systems all sit on 2 or 4 px units (Raycast, Vercel and Airbnb extractions), with gaps clustering at 16/24/32/40. The desk uses about 26 distinct spacing values and about 25 font sizes (counted in `EnquiriesDesk.css`). It looks right, but it is not yet a system.

**Colour systems with semantic tones**
- Radix gives each step one job: 1-2 background, 3-5 component states, 6-8 borders and focus, 9-10 solids, 11-12 text.
- Apple:
  - "Avoid using the same color to mean different things."
  - "Avoid relying solely on color."
  - Colours must work in increased-contrast contexts.
- **[recalled, not verified this session]** Stripe built its accessible palette in a perceptual colour space so that hues at the same step read with equal weight.
- For Venviewer, each tone is a role set of **wash / dot / text / lit (on forest)**, with fixed meanings.

**Surfaces and depth.** Venviewer uses opaque paper planes (ground, sheet, impact plane, forest panel), tilts of 2° or less, and two shadows only.

**Iconography**
- Lucide 1.7.0 is the repo's library, with 60 imports.
- Icons stay secondary to words.
- Moments get a custom engraved family; the desk's seal at `EnquiryOverview.tsx:115-117` is the prototype.

**Micro-interactions**
- Apple:
  - "Aim for brevity and precision in feedback animations."
  - "Generally avoid adding motion to UI interactions that occur frequently."
  - "Let people cancel motion."
- Carbon separates *productive* from *expressive* motion: fast-01 70 ms, fast-02 110, moderate-01 150, moderate-02 240.
- Material's standard easing is `cubic-bezier(0.2,0,0,1)`.
- Linear's highlights appear instantly and fade out over 150 ms.
- The repo's own standard: press `scale(0.97)`, UI animations under 300 ms, never `ease-in`, hover gated to fine pointers (`.claude/skills/review-animations/STANDARDS.md:21-60,167`).
- An 8-hour tool is productive motion almost everywhere, with one expressive moment per status change.

**Sound.** Apple says to silence nonessential sounds and never to carry information by sound alone. Sound is therefore opt-in and rare.

**Empty and completion states.** Apple: "An empty screen can be daunting if it isn't obvious what to do next… give them a button or link." It also reserves success confirmation for important tasks: "they only need to know when it doesn't."

**Loading honesty.** Apple asks for determinate progress only when duration is known, and for letting people keep working. The repo convention asks for the shared Activity component, no skeletons and no fake percentages. The repo's r4 research suggested skeletons on first load, but the convention overrides it. **[recalled, not verified this session]** Buell & Norton's "labour illusion" (2011): showing the work done raises perceived value. Use it honestly, for example "Checked 3 rooms for Sat 5 Jun; the Grand Hall is free".

**Copy voice**
- Apple and Mailchimp, as above.
- Venue vocabulary from `docs/research/r1-incumbent-teardown.md`: prospect, provisional, definite, first/second option, joint first option, decision date, challenge-and-release.

**Luxury hospitality products** **[recalled, not verified this session]**
- Four Seasons Chat (human messaging inside the app).
- The discretion of Aman and Rosewood: sparse layouts, photography-led, anticipation over instruction.
- The transferable principle is *service as anticipation*: the decision panel proposes the next move (the longest-waiting enquiry) before being asked. Client-facing artefacts (emails, proposals) are as finished as the staff tool.

---

## 2. Psychology and game design for an eight-hour day

The repo record (`docs/design/enquiries-desk-2026-09-24/README.md:28-40`) already cites the core literature. These mechanisms should become product-wide:

| Principle | Mechanism in Venviewer |
| --- | --- |
| Progress principle (Amabile & Kramer, 2011) | Counts tick down, the chip stamps, the path advances, and every stage has a closed state. |
| Goal gradient (Kivetz et al., 2006) | The copper plane's counts stay always visible and are the filters, so the distance to zero is the navigation. |
| Flow (Csikszentmihalyi) | One next step, always in the same place; the keyboard map; immediate feedback. |
| Aesthetic-usability (Kurosu & Kashimura, 1995; Tractinsky, 2000) | Beauty is functional. The selected style is carried everywhere, including errors. |
| Calm technology (Weiser & Brown) | Copper is the only urgency colour; no pulsing; periphery vs centre. |
| Game feel and "juice" (Swink; Jonasson & Purho) | Exactly one restrained reward, the 320 ms stamp. No confetti, points or badges. |
| Self-determination (Ryan & Deci) | Staff choose their own order; counts are honest; colleagues' presence is shown only where it avoids collisions. |
| Peak-end rule (Kahneman et al., 1993) **[recalled, not verified this session]** | Design the *endings* most beautifully: caught up, contract signed, event struck. Use a real room photo as the reward. |
| Response thresholds (Doherty & Thadani, 1982; Nielsen's 0.1/1/10 s) **[recalled, not verified this session]** | Local feedback under 100 ms; work over 1 s gets an Activity label; work over 10 s runs in the background and can be cancelled. |
| Positive polarity (Piepenbrock et al., 2013) **[recalled, not verified this session]** | Dark text on light reads better for proofreading. This supports the ivory default. Ivory's relative luminance is 0.847 against white's 1.0 (computed), which reduces glare. A forest register is available for dim event-day rooms. |

---

## 3. What the Enquiries desk gets right, and where it falls short

**What it gets right** (inspected and measured)
- Text meets AA everywhere. The lowest is ink-3 #55655c on the selected row #e5dec9, at 4.59:1.
- Focus rings follow the register: ink on ivory and copper, cream on forest (`EnquiriesDesk.css:84-90`).
- Hover is colour-only and gated to fine pointers (`:662-669`).
- Reduced motion removes transforms (`:671-675`).
- Buttons press to 0.97 and rows to 0.995 (`:287,:371`).
- There is one 320 ms stamp (`:228-232`).
- Grouped ledger, date tiles, a sticky forest panel that scrolls inside a fixed frame, and inline consequence-naming confirmation.

**Where it falls short** (measured)
- The quiet-button and textarea border on forest, #4d6c5c, measures **1.86:1** (`:553,:587`). Change it to #86a192 (3.88:1).
- The review dot on the plane, #85651a, measures **2.88:1** (`:197`). Change it to #77581a (3.50:1). It is supplementary to the label, so this is not strictly a failure.
- The date-tile caps are 10.5 px (`:302`). Raise them to 11 px.
- `lining-nums` does nothing on the shipped Newsreader (`:178,:303,:482`).
- The tokens are scoped to `.enq-desk` (`:9-47`), so no other surface can use them.

**Beyond the desk** (inspected)
- `index.html:95-111`: the spring pop on every button except the desk.
- `index.html:78`: a gold custom cursor on all non-homepage routes.
- The cyan focus ring #87e7f0 measures **1.22:1** on #f2eddd.
- `DashboardLayout.css:92`: the dark default main ground.
- `DashboardLayout.css:21`: the Georgia wordmark.
- The analytics and ops baselines are dark cards with cyan eyebrows and gold numerals; "GBP 4,750.00" is shown in the analytics baseline.
- The planner baseline has gold ENQUIRE and mode pills and mono labels.
- Enquiries sits under "More" in the top nav, per the desk captures.
- Measured across the web CSS: 1,208 distinct hex colours, 15+ radii and 212 shadows.
- `house-tokens.css:21-22` notes that the ivory tokens are "deliberately absent", which is the gap this proposal fills.

---

## 4. The Venviewer design language (proposal)

### 4.1 Registers

| Register | Used for | Ground | Content surface | Accent |
| --- | --- | --- | --- | --- |
| **Ivory** (default) | All staff tools, client portal, proposals and contracts on screen | Sage #819087 | Ivory sheet #f2eddd | Copper plane #deb599 |
| **Forest** | Decision panels, dialogs, inline confirmations, planner chrome over 3D, optional event-day low-light mode | — | Forest #264337 | Cream #efe7cf and lit tones |
| **Editorial night** | Public homepage and marketing only | Near-black (existing) | Photography, serif display | Warm metal (brass or copper; question for Blake) |

Implementation:
- Add the register blocks to `packages/web/src/styles/house-tokens.css` under `[data-register="ivory"]` and `[data-register="forest"]`.
- This keeps the canonical `--house-*` namespace while `:root` keeps the existing dark BOH values for the golden routes.
- The desk's `--enq-*` names become aliases during migration.

### 4.2 Colour tokens, with measured WCAG ratios

**Planes and ink (ivory register)**

| Token | Value | Use | Measured |
| --- | --- | --- | --- |
| `--house-ground` | #819087 | sage ground | never carries text: ink 4.22:1 ✗, ivory 2.86:1 ✗ |
| `--house-ground-plane` | #97a597 | pale tilted plane behind sheets | ink 5.48:1 if ever needed |
| `--house-sheet` | #f2eddd | ivory sheet | — |
| `--house-sheet-hover` | #ebe5d3 | row hover | ink-3 4.90:1 |
| `--house-sheet-selected` | #e5dec9 | current row | ink-3 4.59:1, ink-2 5.71:1 |
| `--house-paper` | #faf8f1 | fields, date tiles (raised inset) | ink-3 5.81:1 |
| `--house-overlay` | #f7f3e6 | menus, popovers, tooltips | ink 12.73:1, ink-3 5.56:1 |
| `--house-plane` | #deb599 | copper impact plane | plane-ink 6.41:1, ink 7.52:1 (ink-2 4.08 ✗, ink-3 3.28 ✗: never use them) |
| `--house-plane-hover` | #d7aa8b | stage hover | plane-ink 5.74:1 |
| `--house-plane-ink` | #3e3528 | labels on the plane | 6.41:1 |
| `--house-plane-rule` | #b9906f88 | hairlines on the plane | decorative |
| `--house-ink-1` | #14302a | primary text, focus ring | 12.07:1 on sheet |
| `--house-ink-2` | #42584e | secondary text | 6.55:1 |
| `--house-ink-3` | #55655c | tertiary text | 5.27:1 (4.59 minimum, on selected) |
| `--house-rule` | #d9d4c2 | separators | 1.27:1 (decorative only) |
| `--house-rule-strong` | #bfc0ac | tile borders | 1.58:1 (decorative only; the tile also has text) |
| `--house-control-edge` | **#747f6f** (new) | field and quiet-button boundary | 3.58:1 sheet, 3.95 paper, 3.33 hover, 3.12 selected, 3.78 overlay |
| `--house-focus` | #14302a | focus ring on ivory and plane | 12.07 / 7.52:1 |

**Forest register**

| Token | Value | Measured |
| --- | --- | --- |
| `--house-forest` | #264337 | panel vs ground 3.23:1 |
| `--house-forest-deep` | #1f3a2f | confirmation and nested surfaces |
| `--house-forest-field` | **#1a3229** (new, solid) | cream text 11.81:1, placeholder 6.91:1 |
| `--house-forest-ink-1` | #f2eee1 | 9.32:1 (10.61 on deep) |
| `--house-forest-ink-2` | #d0d9cd | 7.47:1 (8.50 on deep) |
| `--house-forest-ink-3` | #a9bdb0 | 5.46:1 (6.21 on deep) |
| `--house-forest-rule` | #4d6c5c | 1.86:1, decorative separators only |
| `--house-forest-edge` | **#86a192** (new) | control boundary: 3.88:1 on forest, 4.42 on deep, 4.91 on field |
| `--house-cream` | #efe7cf | primary button: ink 11.44:1; edge vs forest 8.76:1 |
| `--house-cream-hover` | #f7f1de | ink 12.51:1 |
| `--house-forest-focus` | #efe7cf | 8.76:1 |

**Semantic tones.** Every chip or label pairs the tone with a word.

| Tone | Meaning | Text on sheet | Chip text / wash | Dot (mark) | Lit (on forest) |
| --- | --- | --- | --- | --- | --- |
| **Copper** | needs you now: new, awaiting our reply, hold expiring | #94491f 5.55 | #8a4119 / #f3dcc9 5.57 | #c1703f 3.17 | #f0b68f 6.08 |
| **Amber** | pending elsewhere: in review, 1st option, awaiting client | #6f500f 6.34 | #664a0c / #efe0b8 6.28 | #c3952b 2.34 (supplementary only); standalone #a07614 3.52; on plane #77581a 3.50 | #f0cf8f 7.23 |
| **Sage** | settled: approved, definite, paid, done | #2f5a3a 6.78 | #2c5537 / #dbe5d3 6.56 | #5d8963 3.43 | #9fc7ae 5.80 |
| **Brick** | refused, conflict, failed, destructive | #8a3522 6.86 (strong #6f2616 9.13) | #83311f / #f1d8cf 6.38 | #b4513a 4.29 | #ffcdb7 7.56 |
| **Slate** | inactive: withdrawn, cancelled, archived, unknown | #545e59 5.74 | #545e59 / #e3e3db 5.21 | #8e9992 2.52 (supplementary) | #c9d1cb 6.94 |
| **Heather** (new) | AI-proposed; always with the glyph and a "Draft" label (the ivory equivalent of house violet) | #5a4577 7.03 | #5a4577 / #e7e0ea 6.37 | #8b76a6 3.42 | #cdbfe3 6.27 |
| **Loch** (new) | estimate, simulated, information (the ivory equivalent of house cyan) | #2d5563 6.92 | #2d5563 / #d9e5e3 6.28 | #5f8b97 3.19 | #a8d0d6 6.52 |

- Ink on every wash measures 10.4-11.0:1, so wash-filled hold bars with ink text are safe.
- Cream on a brick fill measures 6.92:1, but brick fills are not used for buttons (see 4.4).

**Diary hold mapping** (proposal, using the vocabulary from r1)

| Booking state | Treatment |
| --- | --- |
| Definite | forest fill, cream text (9.32:1) |
| 1st option | amber wash, ink text |
| 2nd+ option | amber outline with 45° hatch, ink text |
| Provisional / prospect | slate dashed outline |
| Enquiry | copper outline |
| Conflict | brick double edge plus the word "Clash" |
| Cancelled / lost | slate with strikethrough title |

**Chart palette** (on sheet, 3:1 or better)
- Categorical order: forest #264337 (9.24), copper #b8612f (3.74), sage #5d8963 (3.43), heather #8b76a6 (3.42).
- Deuteranopia minimum ΔE_ok is 0.068 for these four. Adding amber or loch collapses pairs, down to 0.014.
- "Other" and baselines use #747f6f.
- Sequential scale (occupancy): #e9e4d1 → #c9d2c0 → #9fb39f → #6f8f76 → #466b53 → #264337.
- Diverging scale (vs target): copper ← ivory → forest.

### 4.3 Type scale

Font stacks:
- `--house-serif: "Newsreader", Georgia, serif`
- `--house-sans: "Inter", ui-sans-serif, system-ui, sans-serif`
- `--house-mono: "Geist Mono", ui-monospace, monospace` (reference codes only)

Settings:
- `font-optical-sizing: auto`.
- Recommended: switch the @font-face weight descriptors to ranges (`200 800` Newsreader, `100 900` Inter). This is inferred from CSS Fonts 4 and untested.
- Inter tracking follows its size-dependent "dynamic metrics" formula. The values below were computed from constants I recalled; the formula was not re-fetched.

| Role | Font | Size / line-height | Weight | Tracking | Use |
| --- | --- | --- | --- | --- | --- |
| display-l | serif | clamp(38px, 3.6vw, 54px) / 1.04 | 400 | -0.022em | page title |
| display-m | serif | clamp(30px, 2.6vw, 40px) / 1.1 | 400 | -0.018em | panel name, overview heading |
| title-l | serif | 26 / 1.2 | 400 | -0.01em | empty and caught-up headings |
| title-m | serif | 22 / 1.3 | 400 | -0.005em | confirmation question |
| title-s | serif | 19 / 1.25 | 500 | -0.005em | row title, card title |
| lede | serif | 19 / 1.5 | 400 | 0 | summary sentence (max 60ch) |
| quote | serif italic | 18 / 1.55 (panel), 14.5 / 1.35 (row) | 400 | 0 | client's words |
| numeral-xl | sans | clamp(30px, 2.7vw, 42px) / 1.04 | 300 | -0.045em | stat plane counts |
| numeral-l | sans | clamp(24px, 2vw, 32px) / 1.1 | 300 | -0.03em | facts |
| date-day | serif | 26 / 1 (22 phone) | 400 | 0 | date tile |
| body | sans | 15 / 1.45 | 400 | -0.009em | default UI text |
| body-strong | sans | 15 / 1.45 | 500–600 | -0.009em | emphasis |
| meta | sans | 14 / 1.45 | 400 | -0.006em | row meta, notices |
| caption | sans | 13 / 1.4 | 400–500 | -0.003em | hints, ages, field help |
| eyebrow | sans caps | 12 / 1.3 | 600 | +0.09em | section labels, group headers |
| micro | sans caps | 11 / 1.1 | 600 | +0.08em | date-tile weekday and month |
| button-l | sans | 16 | 600 | 0 | panel primary |
| button | sans | 14 | 600 (quiet 500) | 0 | everything else |

Rules:
- Collapse the desk's half-sizes (12.5, 13.5, 14.5) to the nearest role.
- Apply `font-variant-numeric: tabular-nums` to counts, money, times and table columns.
- Keep prose proportional.

### 4.4 Spacing, layout and hit areas

**Spacing scale** (4 px base): `--space-0-5:2 · -1:4 · -1-5:6 · -2:8 · -2-5:10 · -3:12 · -3-5:14 · -4:16 · -5:20 · -6:24 · -7:28 · -8:32 · -9:36 · -10:40 · -12:48 · -14:56 · -16:64 · -20:80`.

Desk values that map onto it: 22→24, 26→24 or 28, 30→28 or 32, 34→32 or 36.

**Layout**

| Token | Value |
| --- | --- |
| `--page-gutter` | 24 at 1180 px and up; 20 below; 0 at 760 px and below |
| `--sheet-pad` | 36 top, clamp(28px, 3.2vw, 52px) right, 48 bottom, clamp(24px, 3.4vw, 56px) left |
| `--panel-width` | clamp(400px, 34vw, 540px) |
| `--panel-pad` | clamp(24px, 2.6vw, 40px) |
| `--row-min` | 84 (comfortable) or 60 (compact; a question for Blake) |
| `--hit` | 44 for touch; 36 for pointer icon buttons |

- Proposal (inference, not measured): at 1680 px and up, cap the page grid at 1640 px so the sage ground frames the work.

### 4.5 Radii, planes and shadows

**Radii**
- `--radius-0: 0` for sheets, planes, panels, tables and notices.
- `--radius-paper: 3px` for buttons, fields, tiles and confirmations.
- `--radius-key: 4px` for kbd.
- `--radius-pill: 999px` for chips and planner mode pills.
- `--radius-round: 50%` for icon buttons, avatars and dots.

**Planes, back to front**

| Level | Plane | Shape |
| --- | --- | --- |
| 0 | ground | — |
| 1 | ground-plane | `polygon(0 0,100% 0,84% 100%,0 72%)` |
| 2 | sheet | right edge inset 14 px |
| 2 | forest panel | skewed 1 px inner frame `skewX(-1.5deg)`, inset 14 px |
| 3 | impact plane | `polygon(0 7%,100% 0,calc(100% - 10px) 100%,6px 100%)`, breaking past the sheet's left edge |
| 10 | overlay | — |
| 20 | undo toast | — |
| 30 | dialog scrim | #14302a5c |

All tilts flatten at 760 px and below.

**Shadows** (only two)
- `--shadow-overlay: 0 1px 0 #14302a0f, 0 14px 36px #18372a24`. The second layer is already used by `DashboardLayout.css:64`.
- `--shadow-lift: 0 10px 24px #14302a2e`, for a dragged booking or planner item only.

### 4.6 Motion

| Token | Duration | Easing | Use |
| --- | --- | --- | --- |
| `--motion-press` | 120 ms | `--ease-out` cubic-bezier(0.23,1,0.32,1) | `scale(.97)` buttons, `(.995)` rows |
| `--motion-hover` | 120 ms | ease | colour only, fine pointer only |
| `--motion-highlight` | 0 ms in / 150 ms out | ease | keyboard-moved highlight |
| `--motion-reveal` | 180 ms | `--ease-out` | disclosure, inline confirmation opening (opacity plus 4 px) |
| `--house-motion-deliberate` | 240 ms (existing) | `--ease-standard` cubic-bezier(0.2,0,0,1) | pressed-stage underline slide, panel content change (opacity only) |
| `--motion-stamp` | 320 ms | `--ease-out` | chip stamp on status change (once) |
| `--house-motion-cinematic` | 650 ms (existing) | `--ease-in-out` cubic-bezier(0.77,0,0.175,1) | 3D camera only |

- Overshoot curves are banned in UI; this deletes the `cubic-bezier(0.34,1.56,0.64,1)` at `index.html:99`.
- Routine navigation has no entrance animation.
- Counts change instantly; there is no rolling-digit animation.
- Under reduced motion, all transforms and the stamp are removed, and colour changes stay at 120 ms or less.

### 4.7 Components

**Page sheet**
- Root: `<main data-register="ivory" data-calm-controls>`.
- Header, in order:
  - an eyebrow line with the venue-local date, optionally with a greeting (a decision pending with Blake);
  - an h1 at display-l;
  - one lede sentence built only from real counts: numbers in `<strong>` at ink 500, attention numbers in copper text.
- While loading, the lede slot holds an inline `ActivityStatus` at the same min-height, so the layout does not jump.
- Layout:
  - at 1180 px and up: `grid-template-columns: minmax(0,1fr) var(--panel-width)`, gap 24;
  - below 1180: panel and list alternate, with "Back to …";
  - at 760 px and below: full bleed, no tilts.

**Decision panel (forest)**
- Sticky at `top:104px`, `height:calc(100dvh - 128px)`. The frame stays fixed and the body scrolls (`overscroll-behavior:contain`).
- Order of content:
  1. Bar: Previous / Next (chevron and word) and a close icon button (36 px circle, forest-edge border).
  2. Optional real room photograph, 132–200 px, fading into forest.
  3. Eyebrow (type · received age).
  4. Name at display-m (focus moves here on open, `tabindex=-1`).
  5. Status chip.
  6. Facts row: up to 3 facts as numeral-l with 1 px dividers, labels at caption forest-ink-2. The date gets a qualifier ("Saturday, in 8 months").
  7. **Next step section, always first after the facts**: path marks (done, current, next) → one cream primary → quiet alternatives → a consequence line (14 px, forest-ink-2).
  8. Contact, their message (quote), tools, drafts (collapsed), timeline.
- Sections are separated by forest-rule with eyebrow headings.
- Empty panel: shows the next move (the longest-waiting item), or "waiting for decision", or a sealed caught-up state. It also carries the keyboard legend.

**Pipeline / stat plane (copper)**
- One per view, with 3–6 cells.
- Cell anatomy: count at numeral-xl in ink; label at 14 px plane-ink with an 8 px dot.
- 1 px plane-rule dividers.
- Filter stages are `<button aria-pressed>`. The pressed state is a 3 px ink underline plus a 600 label.
- An attention count (for example New > 0) uses #7e2d1b (4.91:1, large).
- An unknown count shows the label only.
- Optional delta line at 13 px plane-ink ("2 more than last Monday"), with no arrow-only or green/red deltas.
- Money: "£12,400" in tabular numerals.
- Phone: a 3 × 2 grid.

**Ledger row**
- `<li><button>` in a grid of `58px | minmax(0,1fr) | auto`, gap 18, min-height 84, padding 14/14/14/12.
- Main column:
  - title at title-s serif;
  - meta at 14 px ink-2 in the booker's order (event type · guests · room · extras);
  - one italic quote line at 14.5 px ink-3.
- Side column: chip and age (13 px; copper 500 when new).
- A 3 px left bar marks attention.
- Selected: sheet-selected background plus a full-height ink bar and `aria-current`.
- Group headers: eyebrow text, a hairline and a count (Today / Yesterday / Earlier this week / Last week / month).
- Keyboard: j/k and arrow keys move, Enter opens, Esc closes, and focus follows.
- Phone: `52px | 1fr`, with the side content moving under the main column.

**Date tile**
- 58 × 60 minimum (52 on phone), paper background, 1 px rule-strong border, 3 px radius.
- Weekday and month at micro 11 px ink-3; day at 26 px serif.
- The year is shown as "'27" only when it differs from the current year.
- Variants:
  - open date: dashed border, transparent, the word "Open";
  - past: transparent, ink-3;
  - today (Diary): 2 px ink border.
- The whole tile carries an accessible label ("Saturday 5 June 2027").

**Chips**
- Pill with padding 3/10/3/8, 13 px/600, line-height 1.3, an 8 px dot, and wash plus chip-text from the tone table.
- Static by default.
- Filter chips are buttons at 32 px height with a 44 px hit area and `aria-pressed`.
- The stamp animation plays only when the status actually changes.

**Buttons**
- Primary on forest: cream background, ink 16/600, min-height 48 (40 inline), 3 px radius. Hover cream-hover; press 0.97; disabled opacity 0.75 with a default cursor.
- Primary on ivory: forest background, forest-ink-1 text (9.32:1). Hover forest-deep. At most one per view.
- Quiet:
  - on ivory: transparent, 1 px control-edge border, ink 14/500;
  - on forest: 1 px forest-edge border (replacing the 1.86:1 border), forest-ink-1 text, hover `#ffffff0d`.
- Text link: underline offset 3 px, decoration at 35% alpha, full on hover.
- Destructive:
  - never a red-filled button;
  - the trigger is quiet with brick text (#8a3522, 6.86:1 on ivory; #ffcdb7 on forest) and ends in "…";
  - it opens an inline confirmation whose confirming button is the primary style with an explicit verb ("Decline and email");
  - internal deletions use undo instead of confirmation.
- Busy state: `ActivityIndicator` plus a present-participle label ("Declining…"), `aria-busy`, and the button width holds.
- Labels are a verb plus an object. Add "…" when the button opens a confirmation.

**Inline confirmation**
- Forest-deep box, 1 px forest-edge border, 3 px tone left rule, padding 16, 3 px radius.
- Content:
  - question at title-m serif (focus moves here);
  - consequence at 14 px forest-ink-2 naming the recipient address and what is sent;
  - optional note field whose label states where the note goes ("quoted in the email" vs "kept on the timeline").
- Actions: [Verb and consequence] and [Cancel].
- Esc cancels.
- On success: the chip stamps and the panel advances to the next step.
- On failure: brick-lit text under the actions, with the note preserved.
- On a conflicting change by someone else (for example HTTP 422): re-read and say where the item is now.

**Notices** (in-flow, not toasts)
- 3 px tone left rule, wash background, 12 × 14 padding, 14 px ink text, at most one action.
- Kinds and tones:
  - attention: copper;
  - alert: brick;
  - settled: sage;
  - info, offline, denied: slate;
  - estimate: loch.
- Standard messages:
  - "Changed while you had it open. Showing the latest." [Reload]
  - "You're offline. Changes are kept on this device and sent when you reconnect." (only where that is true)
  - "Only venue admins can change this. Ask Elaine MacGregor." (names who can grant access)
- **Undo toast**: bottom-left, forest background, cream text, 6 s, pauses on hover or focus, one at a time, carries the keyboard hint (Ctrl/Cmd+Z).

**Empty, caught-up and error states** (one component with five kinds)

| Kind | Content |
| --- | --- |
| First run | title-l fact ("No enquiries yet"); a line on where they come from ("Enquiries from your website form and the planner arrive here."); one action ("Import from Salesforce" / "Copy the form link") |
| Filtered-empty | "No declined enquiries"; [Show all]; the stat plane stays visible |
| Caught up | engraved seal (copper-lit on forest, ink on ivory); "All caught up"; a fact line; optionally the room photo; no praise |
| Error | what failed, in plain words; [Try again]; the last good data stays visible with the stale notice |
| Denied | what the person can do, and who can grant access |

**Forms**
- Label above the field at 13 px/500 ink-2.
- Field: paper background, 1 px control-edge border (3.58:1), 3 px radius, min-height 44, 15 px text. On forest: forest-field background with a forest-edge border.
- Focus: a 2 px register focus ring; the border does not change colour.
- Help text at 13 px ink-3.
- Errors:
  - validate on blur and on submit, never on each keystroke;
  - brick text at 13 px with an icon, plus a brick border;
  - long forms get an error summary at the top, linked to the fields.
- Required fields are marked with the word "(required)" and kept to a minimum.
- Drafts autosave, showing "Saved 14:02" in ink-3.
- Consequential submission uses the inline confirmation.
- British formats for dates, phone numbers and money.

**Tables** (data grids, as distinct from the ledger)
- Sit on the sheet, with no card around them.
- Sticky header: eyebrow 12 px caps ink-2 with a strong rule below.
- Rows are 56 px (48 compact), separated by 1 px rules. No zebra stripes and no vertical rules except between column groups.
- Numbers are right-aligned in tabular numerals. Totals row: Inter 600 above a strong rule.
- Hover: sheet-hover. Selection: sheet-selected plus a 3 px ink bar.
- Sortable headers are buttons with a chevron and `aria-sort`.
- Truncated cells reveal the full text on hover or focus via the overlay.
- Empty cells show "—" with an accessible "none".

**Calendars and timelines (Diary)**
- Month grid:
  - ivory cells, weekends on sheet-hover;
  - today marked with a 2 px ink ring on the day numeral;
  - holds drawn as tone bars with words.
- Room timeline:
  - one lane per room, headed by a sourced room thumbnail and the room name in serif;
  - 15-minute hairlines, with hour labels at 12 px tabular;
  - a 2 px copper "now" line with its time;
  - bar width is true to duration; summary cards must not imply duration (product-experience rule);
  - dragging uses `--shadow-lift`, updates optimistically and offers undo; a server clash snaps back with a brick notice naming the clash.
- Vertical event timeline (as in the panel): a dot, a 1 px line, a 600 title, a time at 13 px, and a quote in italic serif.

**Charts**
- A one-sentence serif headline stating the takeaway ("Saturdays in June are 82% held").
- Bar and line charts first.
- Horizontal gridlines only, in the rule colour; axis labels at 12 px ink-3 in tabular numerals.
- Bars have 0 radius. Lines are 1.5 px.
- At most four hues, in the fixed order; series are labelled directly; the tooltip uses the overlay.
- Every chart has a table view and an `aria-label` summary.
- No gradients, 3D or donut rings for more than two parts.

**Navigation**
- Top bar: 80 px, ivory, with the wordmark in Newsreader (replacing Georgia at `DashboardLayout.css:21`), the venue switcher and role-aware primary items.
- For sales and bookings roles, Enquiries and Diary are first-class; they currently sit under "More".
- Primary items: 16 px/500, with a 3 px ink underline on the current item.
- "More" opens the overlay menu.
- Global Ctrl/Cmd+K palette for commands, "go to" and search. "?" shows the keyboard legend. g-then-letter jumps (for example g d for Diary).
- Phone: the two-row header shown in `desk-phone.webp`.
- The system cursor everywhere; the gold cursor at `index.html:78` goes.

### 4.8 When a surface may differ

1. **Public marketing** (editorial night).
   - *May* use a black ground, Fraunces or Newsreader italic display, Geist UI, scroll choreography and cinematic motion.
   - *Must* share: the wordmark drawing, the cream-primary button form (3 px, cream on dark), the warm-metal accent family (no cyan), the register focus rules (cream ring on dark), no spring hover, the sourced-photography standard and the voice.
   - Sign in and "Open the planner" land on the ivory or forest registers without a style jump.
2. **3D planner.**
   - The canvas follows the capture's lighting.
   - The chrome is forest register: opaque panels at 94% or more, cream primary, ivory text, pill mode switch.
   - Gold pills are replaced by cream, and mono labels by Inter caps.
   - Provenance keeps its reserved meanings: loch for simulated or estimated, heather for AI-proposed.
   - The 650 ms cinematic easing is for the camera only.
3. **Print (function sheets, BEOs, proposals as PDF).**
   - White paper, ink text, Newsreader headings, copper hairlines.
   - No planes or tilts; chips become outlined labels.
4. **Client email.**
   - Ivory header band, serif heading with a Georgia fallback, forest button with cream text.
   - The same facts order as the panel.
5. **Event-day and hallkeeper tools in dim rooms.**
   - May switch the whole sheet to the forest register. This is a question for Blake.
6. **Phone.**
   - Planes flatten, the stat plane becomes 3 × 2, and the panel becomes a full page with Back.
   - The chosen register's colours and type are unchanged.

---

## 5. Suggested build order for engineering

1. Ship the ivory and forest register tokens in `house-tokens.css`, extend `src/__tests__/house-tokens.test.ts` to assert every ratio in section 4.2, and alias the desk's `--enq-*` names.
2. Global cleanup: delete the spring and brightness rules at `index.html:95-111` (and `[data-calm-controls]` with them), remove the gold cursor at `:78`, and make focus register-aware (`global.css:42-53`).
3. Extract the desk's components into a shared kit: Sheet, DecisionPanel, StatPlane, Ledger/LedgerRow, DateTile, Chip, Button family, InlineConfirm, Notice/UndoToast, StateMessage, Field, DataTable, Timeline.
4. Re-skin, then re-baseline, the dark staff views: analytics, ops handoff, admin, reviews, supplier, and all denied and error states.
5. Diary, then hallkeeper and event-day, per Blake's stated order.
6. Command palette, keyboard map and undo service.
7. Chart kit.
8. Client register: portal, proposals, contracts, email and print.
9. Density preference and opt-in sound.

---

## 6. Sources

**Fetched this session**
- Apple HIG:
  - [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
  - [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
  - [Loading](https://developer.apple.com/design/human-interface-guidelines/loading)
  - [Playing audio](https://developer.apple.com/design/human-interface-guidelines/playing-audio)
  - [Writing](https://developer.apple.com/design/human-interface-guidelines/writing)
  - [Color](https://developer.apple.com/design/human-interface-guidelines/color)
  - [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
  - [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
  - [Charting data](https://developer.apple.com/design/human-interface-guidelines/charting-data)
  - Retrieved through `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`.
- W3C *Understanding* docs:
  - [Focus Appearance](https://github.com/w3c/wcag/blob/main/understanding/22/focus-appearance.html). This is AAA in the published WCAG 2.2; that level is from my knowledge, because the fetched summary said AA.
  - [Non-text Contrast](https://github.com/w3c/wcag/blob/main/understanding/21/non-text-contrast.html).
- [Radix: understanding the scale](https://github.com/radix-ui/website/blob/main/data/colors/docs/palette-composition/understanding-the-scale.mdx)
- Carbon motion: [tokens.ts](https://github.com/carbon-design-system/carbon/blob/main/packages/motion/src/tokens.ts) and [motion.json](https://github.com/carbon-design-system/carbon/blob/main/packages/motion/src/dtcg/motion.json)
- [Material motion tokens](https://github.com/material-components/material-web/blob/main/tokens/versions/latest/sass/_md-sys-motion.scss)
- [Mailchimp voice and tone](https://github.com/mailchimp/content-style-guide/blob/master/02-voice-and-tone.html.md)
- [Inter README](https://github.com/rsms/inter)
- [Newsreader README](https://github.com/productiontype/Newsreader)
- Third-party marketing-site CSS extractions (not official, not the product apps):
  - [linear.app variables](https://github.com/Manavarya09/design-extract/blob/main/website/public/gallery/linear-app/linear-app-variables.css)
  - [vercel.com](https://github.com/Manavarya09/design-extract/blob/main/website/public/gallery/vercel-com/vercel-com-design-language.md)
  - [airbnb.com](https://github.com/Manavarya09/design-extract/blob/main/website/public/gallery/airbnb-com/airbnb-com-design-language.md)
  - [raycast.com](https://github.com/Manavarya09/design-extract/blob/main/website/public/gallery/raycast-com/raycast-com-design-language.md)

**Repository records (inspected)**
- `docs/design/enquiries-desk-2026-09-24/README.md`, whose research table cites HBR 2011, Amabile & Kramer, Kivetz et al., Kurosu & Kashimura, Tractinsky, Vohra, Jonasson & Purho, Swink, Csikszentmihalyi, Ryan & Deci, Weiser & Brown, and Few.
- `docs/research/r4-calendar-ux.md` (Linear speed and undo).
- `docs/research/r1-incumbent-teardown.md` (venue vocabulary).
- `.claude/skills/review-animations/STANDARDS.md`.
- `.claude/conventions/loading-and-working-motion.md` and `product-experience.md`.

**Recalled, not verified this session** (search budget exhausted, domains blocked)
- Superhuman's Inbox Zero imagery and 100 ms goal.
- Things 3: its 2017 Apple Design Award and project progress pies.
- Stripe's 2019 accessible colour system.
- Vercel Geist's colour-scale semantics.
- Airbnb's 2025 app redesign.
- Four Seasons Chat.
- Piepenbrock et al., 2013 (display polarity).
- Buell & Norton, 2011 (labour illusion).
- Kahneman et al., 1993 (peak-end).
- Doherty & Thadani, 1982.
- Nielsen's response-time limits.
- The constants for Inter's dynamic-metrics tracking.

**Computed** (scratchpad, not in the repo)
- `contrast.py` for WCAG 2.x ratios.
- `cvd.py` for the Machado 2009 colour-vision simulation and OKLab distances.
- fontTools reads of the shipped woff2 files: axes and OpenType features.
