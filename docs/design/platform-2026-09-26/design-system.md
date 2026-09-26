# Venviewer design system specification

Draft 1, 26 September 2026. This is a proposal for Blake's review. Blake is the aesthetic judge, and nothing here is implemented, deployed or accepted.

---

## About this document

**Purpose.** This document defines one design system for every Venviewer surface. It is built from the two references Blake has approved:

- **The Enquiries desk.** Blake judged it "much cleaner", "not a slog to the eyes" and "inviting" (`.claude/conventions/product-experience.md`, "The supreme principle"). Its design record was written before that verdict and still reads "verdict pending" (`docs/design/enquiries-desk-2026-09-24/README.md:6`).
- **The selected inventory composition** (`docs/design/references/venviewer-selected-inventory-2026-09-06.png`).

**Evidence used.**

- **Files I re-read for this specification:**
  - `EnquiriesDesk.css` (all 709 lines)
  - `EnquiryLedger.tsx:20-70`, plus the ARIA in `EnquiryStages.tsx`, `EnquiryPanel.tsx` and `EnquiryOverview.tsx`
  - `InventoryStyle.css` (all 202 lines) and `InventoryPanel.css:1-60`
  - `index.html:60-215`, `global.css:1-120`, `house-tokens.css` (whole file) and `DashboardLayout.css:1-110`
  - the font loading in `router.tsx:11-183`
  - `house-tokens.test.ts:1-40` and `startup-guardrails.test.ts:40-70`
  - `product-experience.md`, the desk README and `loading-and-working-motion.md`
- **Images I viewed:** the selected reference PNG and `desk-overview.webp`.
- **Contrast.** I recomputed every ratio in this document with the WCAG 2.x relative-luminance formula, using a script in the session scratchpad that is not in the repository. Unless a ratio is labelled otherwise, it was measured that way.
- **Surface audits and research briefs.** Eleven surface-audit clusters, a live screenshot sweep and four research briefs (competitors, workflows, psychology and ergonomics, craft) were produced on 26 September. Their `file:line` references are cited as they reported them. Where I spot-checked a reference, it matched.

**Evidence labels.**

| Label | Meaning |
| --- | --- |
| [inspected] | I read the source |
| [measured] | I computed the value |
| [audit] | Reported by a 26 September audit and not re-read by me |
| [inferred] | Reasoned from source or CSS and not tested in a browser |
| [recalled] | The research brief could not re-fetch the source; treat it as a lead |

---

## 1. Principles

### 1.1 The founder's principle

Blake's words are recorded verbatim in `.claude/conventions/product-experience.md`. The core of them:

> "we want people to feel good about themselves and work because the tools they are using are so beautiful and intuitive and streamline their work flow … we must never daunt any user or client by making things look like hard work … our core philosophy is to 'MAKE EVERYONE'S LIFE EASIER'."

The same file turns this into six commitments. Every rule below serves one of them.

1. **Proud, not daunted.** Every screen looks finished, calm and luxurious to someone who uses it eight hours a day. There are no walls of identical cards, no dense grey text, no generic library colours, no dead ends and no modal on top of a modal.
2. **Encouragement lives in design, never in words.** Colour, light, rhythm, finish and the feeling of progress do the work. There is no praise, no badges and no "Great job!" copy. Blake calls such words belittling.
3. **Production value makes life easier.** Choose whatever removes a step, a click, a doubt or a wait over whatever decorates.
4. **Built for veterans.** Lead with the facts that decide (date, guests, room, stage, money), in the users' own vocabulary, venue-local and British.
5. **Intelligent choices, visibly.** State real consequences before acting. Confirm only consequential external actions. Open detail beside the list rather than in place of it.
6. **Ambition.** Offer everything Salesforce and Cvent offer, plus what their users wish those tools offered.

**Reach (Blake's decision, 26 September).** The desk's look covers every staff tool, and everything clients receive or work in: proposals, contracts, the client portal and the planner's chrome. The public homepage and marketing keep their own editorial voice, tuned to read as the same family.

**Burke's sublime (continuing requirement).** Aim for an overwhelming sense of scale, experienced from a secure position with clear agency. On working surfaces the sublime comes from real room photography at the moment of decision, never from obstruction.

### 1.2 What the references establish

| Pattern | Where it is proven |
| --- | --- |
| Sage ground, ivory sheet with a tilted edge, copper impact plane, forest decision surface with a skewed inner frame | Reference PNG; `EnquiriesDesk.css:10-47, 66-110, 138-155, 380-431` [inspected] |
| Editorial serif headings and light, large numerals | `EnquiriesDesk.css:114-120, 171-180, 493` [inspected] |
| One next step, always in the same place | Desk panel (`EnquiryPanel.tsx` next-step section) |
| Counts that are also filters and tick down; restrained stamp; sealed "All caught up" | `EnquiryStages.tsx:36-53`; `EnquiriesDesk.css:228-232`; `EnquiryOverview.tsx:114` [inspected] |
| Keyboard triage (↑ ↓ j k Home End Enter Esc) with roving focus | `EnquiryLedger.tsx:33-40, 147`; `EnquiryPanel.tsx:92-103` [inspected] |
| Consequences named inline before an email goes | `EnquiryPanel.tsx:366-387`; desk README "The design" |
| Press-only feedback; hover gated to fine pointers; reduced motion honoured | `EnquiriesDesk.css:662-675` [inspected] |
| An adjacent correction surface; tangible illustration | Reference PNG; `InventoryStyle.css:72-107` [inspected] |

### 1.3 Numbered rules

Each rule states what to do, the evidence for it, and how it is checked. These are the laws of the system. Sections 2–5 apply them.

#### A. Eyes and reading

**P1. Read on light, decide on dark.** Text over three lines, tables, forms and timelines sit on ivory. Forest surfaces carry short, large content: facts, one decision, actions and photography.
- *Evidence:* Dark-on-light text gave better proofreading and acuity for younger and older adults, especially at small sizes (Piepenbrock et al., *Ergonomics* 2013 and 2014; *Human Factors* 2014; NN/g 2020).
- *Precedent:* The desk already puts AI draft textareas on an ivory inset inside the forest panel (`EnquiriesDesk.css:624`).
- *Check:* An audit that flags any block of more than three lines on a background with luminance below 0.2.
- *Open question:* the client's full message currently sits on forest in 18 px italic (`EnquiriesDesk.css` `.enq-quote`). See §8, question 6.

**P2. Warm paper, never pure white.** Staff surfaces use the ivory tokens, never large `#fff` fills. Justify this on glare and comfort, not on blue light.
- *Evidence:* The BDA Style Guide 2023 recommends cream or off-white. A Cochrane review (2023) found blue-light filtering lenses probably make no difference to eye strain.
- *Check:* A token lint.

**P3. Type floor by visual angle.** Running text is at least 15 px; secondary text at least 14 px; tertiary captions at least 13 px; all-caps labels at least 12 px (11 px only inside the date tile). Nothing informative is smaller.
- *Evidence:*
  - Critical print size is about 0.2° of x-height (Legge & Bigelow 2011).
  - For readers averaging 70 years old, 14 pt was more legible than 12 pt (Bernard et al. 2001).
  - The psychology brief calculated that 13 px Inter at 60 cm on a 24-inch 1080p monitor gives about 0.19° [computed by the brief; assumes those metrics].
  - The brief counted 268 px-valued `font-size` declarations under 12 px in web CSS.
- *Check:* A source scan by text role (§7.5).

**P4. Light weights only when large.** Weight 300 is allowed only at 24 px and above. Body text is at least 400.
- *Evidence:* Apple HIG, Typography: "avoid light font weights".

**P5. Measure.** Prose runs 45–75 characters per line (target about 60ch), with line-height 1.45–1.6.
- *Evidence:* 55 characters per line beat 100 for comprehension (Dyson & Haselgrove 2001). The desk summary already caps at 60ch (`EnquiriesDesk.css:121`).

**P6. Contrast tiers.**
- Text is at least 4.5:1 (aim for 7:1 or more on primary reading text).
- Large numerals, icons, control boundaries and meaningful graphics are at least 3:1.
- Focus rings are at least 3:1 against their adjacent colours.
- *Evidence:* WCAG 1.4.3, 1.4.6, 1.4.11 and 2.4.13. Today's global focus ring measures 1.22:1 on the desk ivory [measured].
- *Check:* A contrast test over token pairs (§7.5).

**P7. Colour never works alone, and status is never blue against green.** Every tone travels with a word. Charts use at most four categorical hues.
- *Evidence:*
  - WCAG 1.4.1.
  - Lens yellowing with age brings blue–yellow deficits (W3C WAI, older users).
  - The craft brief's simulation (Machado 2009 matrices) found copper and amber collapse under deuteranopia (ΔE_ok 0.014), while forest, copper, sage and heather stay apart (minimum ΔE_ok 0.068).

#### B. Attention and decisions

**P8. The deciding facts first, in a fixed order:** date · guests · room · stage · money. Use British formats and the venue's vocabulary, and never show raw enum values.
- *Evidence:*
  - Working memory holds 3–5 chunks (Cowan 2001).
  - The brief says to lead with the facts that decide (`product-experience.md`).
  - Current failures [audit]: "GBP 4,750.00" and "Comfort status review_required; 2 review gate(s)." (`ExecutiveAnalyticsView.tsx:160`); 17 renderings of `replace(/_/g, " ")`; "Guest count pending guests" (`CommercialPipelineView.tsx:472`).

**P9. Detail opens beside the list, never in place of it.**
- *Evidence:* Putting mutually referring information apart raises cognitive load (Chandler & Sweller 1992). The desk README records that opening an enquiry used to "cost the reader their place".

**P10. One primary action per view, in a fixed place**, with at most two secondary actions. Everything else goes in a menu or the command palette.
- *Evidence:* Hick–Hyman law. Expert time goes to decision-making (Cockburn, Gutwin & Greenberg 2007). "Obvious next action" (Vohra on Superhuman) [recalled].

**P11. Spatial stability.** Controls never reorder by frequency or recency.
- *Evidence:* Static menus beat adaptive ones (Findlater & McGrenere 2004); spatially stable command layouts win for experts (Scarr et al. 2012).

**P12. Carry context forward.** Never ask for a fact the system already knows. Pre-fill it and show where it came from.
- *Evidence:* Recognition over recall; defaults (Johnson & Goldstein 2003).
- *Current failures [audit]:* the Pipeline asks staff to type an enquiry UUID (`CommercialPipelineView.tsx:384-397`), and the proposal composer starts blank for every new version (`ProposalsView.tsx:258-260, 395-397`).

**P13. Recommend two or three options when preference is uncertain; show the full set to confident experts.**
- *Evidence:* Choice overload depends on preference uncertainty and task complexity (Chernev, Böckenholt & Goodman 2015).

**P14. Progressive disclosure at most two levels deep, and never a modal on top of a modal.**
- *Evidence:* NN/g guidance on progressive disclosure and complex applications.

#### C. Speed and mastery

**P15. Response budgets.**

| Budget | Requirement |
| --- | --- |
| 100 ms | Acknowledge every direct action |
| 400 ms at p75 | Complete routine internal changes, on declared office hardware |
| After 1 s | Show the shared Activity component with its real label |
| After 10 s | Show measured progress, and let the person leave |

Updates are optimistic, with honest rollback.
- *Evidence:* Miller 1968 and Card 1991 via Nielsen; Doherty & Thadani 1982.

**P16. A path to keyboard mastery.** Every high-frequency list supports ↑ ↓ / j k, Home, End, Enter and Esc. A Ctrl/Cmd+K palette reaches every action. Shortcuts are printed in tooltips and menus, and a legend opens with `?`.
- *Evidence:* Experienced Word users used shortcuts under 10% of the time (Lane et al. 2005). Grossman et al. 2007; Malacria et al. 2013.
- *Precedent:* `EnquiryLedger.tsx:33-40`; `EnquiryPanel.tsx:92-103`.

**P17. Density fits the task.** Scanning views may be dense; deciding views stay spacious. A compact density option is a question for Blake (§8).
- *Evidence:* NN/g on data-table tasks; Bloomberg Terminal practice.

**P18. Don't teach experts what they already know.** No tours, no coach marks and no "simple" or "senior" modes on routine staff surfaces. Help is available on demand.
- *Evidence:*
  - The expertise-reversal effect (Kalyuga et al. 2003).
  - Subtle age-stereotype cues lower older adults' performance (Lamont, Swift & Abrams 2015).
  - Current failure [audit]: the Diary opens with a blocking welcome modal (`WelcomePanel.tsx:43-50`).

#### D. Progress and closure

**P19. Honest, visible progress.** Counts come from real data and fall as work is done. A stage shows only its name until its count is known.
- *Evidence:* The progress principle (Amabile & Kramer 2011). Precedent: `EnquiryStages.tsx:47`.

**P20. Show the distance to done, never fake progress.** Use paths or counts, and include only steps that really happened.
- *Evidence:* Goal-gradient effect (Kivetz et al. 2006). Endowed progress works (Nunes & Drèze 2006), which is exactly why faking it would be manipulation.
- *Current failures [audit]:* "Open review gates" always adds 1 (`EventArchitectPage.tsx:352`); "Pipeline value" sums Won and Lost deals (`CommercialPipelineView.tsx:204-207`).

**P21. Close open loops with dated plans.** Anything that cannot finish now takes a dated next step ("Chase Tue 10:00"). It leaves the view and comes back reliably.
- *Evidence:* Plans remove the intrusive thoughts that unfinished goals cause (Masicampo & Baumeister 2011). The tendency to resume unfinished tasks is robust (Ghibellini & Meier 2025).

**P22. Design the ends.** Each decision ends in a stamp; each queue ends in a real finished state; each flow puts admin early and ends on the reward.
- *Evidence:* Peak–end rule (Kahneman et al. 1993) [recalled in the craft brief; cited by the psychology brief]; Chase & Dasu 2001.

**P23. No gamification and no praise.** No points, badges, streaks, leaderboards, confetti, emoji celebrations, exclamation marks, or "Great job".
- *Evidence:* Imposed games lowered positive affect (Mollick & Rothbard). Badges and leaderboards lowered motivation (Hanus & Fox 2015). Expected rewards undermine intrinsic motivation (Deci, Koestner & Ryan 1999). Blake's direction.

**P24. Feedback states consequences, not judgements.** For example: "Declined. Sarah Henderson was emailed at 14:02 and your note was quoted."
- *Evidence:* Informational feedback supports competence (Deci et al. 1999).

**P25. Propose, never impose.** The system suggests the next move, but lists, filters and ordering stay open.
- *Evidence:* Self-determination theory at work (Deci, Olafsen & Ryan 2017); METUX (Peters, Calvo & Ryan 2018).

#### E. Calm and forgiveness

**P26. Three tiers of interruption.**
1. Interrupt only for time-critical external events: a clash, an event-day problem, or a client who has signed, paid or is waiting.
2. Put counts in the periphery.
3. Put everything else in digests.

There is never a toast for every success.
- *Evidence:*
  - Interrupted work is done faster but with more stress (Mark, Gudith & Klocke 2008).
  - Batching notifications three times a day helped; switching everything off raised anxiety (Fitz et al. 2019).
  - Calm technology (Weiser & Brown 1995).
  - The audits counted 69 `addToast` calls in dashboard files and 94 app-wide [audit].

**P27. Motion only for state change.** No hover transforms, no overshoot, and reduced motion honoured everywhere.
- *Evidence:*
  - Apple HIG, Motion: "avoid adding motion to UI interactions that occur frequently".
  - Extreme "juice" hurt (Kao 2020).
  - Animated transitions help people perceive data changes (Heer & Robertson 2007).
  - Blake's decision of 26 September.

**P28. One small acknowledgement per consequential change,** delivered through several channels at once: the stamp, the count tick and the row settling. There is no sound by default.
- *Evidence:* Jonasson & Purho 2012; Swink 2008; Kao 2020. Medium juice beat none and extreme.

**P29. Confirm only external consequences; make everything internal undoable.** Actions that email, sign, charge, publish or release a hold get an inline confirmation naming who and what. Internal actions happen at once, with Undo.
- *Evidence:* The brain's response to warnings drops from the second exposure (Anderson et al. 2015); "Never use a warning when you mean undo" (Raskin 2007).
- *Current inversion [audit]:*
  - Removing a photo (the file stays in storage) needs a full-screen modal (`LoadoutDetail.tsx:452-472`).
  - Cancelling a confirmed booking, a terminal state, takes one click (`BookingDrawer.tsx:180-192`; `booking.ts:94-97`).

**P30. Honest loading.** Use only the shared Activity component: no skeletons, no spinners, no guessed numbers. Keep the last good data visible while refreshing or after an error.
- *Evidence:* `.claude/conventions/loading-and-working-motion.md`; Apple HIG, Loading.

#### F. Beauty, pride and reach

**P31. Every polish pass is paired with a measurement.** Each redesign ships with a before-and-after task benchmark (time and errors). Blake's verdict is recorded separately.
- *Evidence:* Attractive interfaces were rated more usable and completed faster (Kurosu & Kashimura 1995; Sonderegger & Sauer 2010), but after use, actual usability drives how beautiful people find a product (Tuch et al. 2012).

**P32. One system, low complexity at first glance.**
- Two type families on staff surfaces; three surface tones plus one action accent; no one-off values.
- *Evidence:*
  - Visual appeal is judged within 50 ms (Lindgaard et al. 2006).
  - Complexity and colourfulness predict first impressions (Reinecke et al. 2013 and 2014).
  - Fluency produces aesthetic pleasure (Reber, Schwarz & Winkielman 2004).
  - Today's counts: 1,208 distinct hex colours in web CSS (craft brief), 212 `box-shadow` declarations, 15+ radii, and 250 hex values in dashboard and shared code alone [audit].

**P33. Encourage with light and colour.** Grounds are bright and low in saturation. Copper is reserved for "needs you now", sage marks what is settled, and forest marks the place of decision. A day with nothing urgent shows no copper.
- *Evidence:* Brightness predicts pleasure and saturation predicts arousal (Valdez & Mehrabian 1994). These effects depend on context (Elliot & Maier 2014), so treat this as a hypothesis.

**P34. Real, sourced venue photography is the moment of scale.** Use at most one hero image per decision view or closure moment, and only from the venue's own supplied set.
- *Evidence:* Soft fascination restores attention (Kaplan 1995); a 40-second view of greenery sustained attention (Lee et al. 2015); the Burke requirement.
- *Precedent:* `enquiry-room-photo.ts`.

**P35. What clients receive has the same finish.**
- *Evidence:* The reflective level of design drives pride and word of mouth (Norman 2004); Blake's reach decision.

**P36. Robust for older eyes and hands.**
- Works at 200% zoom and reflows at 320 CSS px.
- No hover-only information; tooltips also appear on focus.
- Messages that carry information never auto-dismiss.
- Touch targets are at least 44 px; pointer targets at least 24 px or spaced.
- Tablets get full parity.
- *Evidence:* W3C WAI on older users; users aged 65+ were 43% slower (NN/g); touch narrowed the age gap by 35% (Findlater et al. 2013); WCAG 2.5.8.

**P37. Every visible action works and says what it does.** No placeholder success and no promises that aren't kept.
- *Evidence:* `AGENTS.md` ("no fake integrations, placeholder success").
- *Current failures [audit]:*
  - `/blueprint` shows "Plan sent — our events team will respond within 24 hours" without sending anything (`BlueprintPage.tsx:294-298`).
  - The brand colour in Venue settings is read nowhere else (`VenueSettings.tsx:241-273`).
  - The More-tools Rotate and Delete buttons do nothing (`VerticalToolbox.tsx:1561-1563`).

---

## 2. Tokens

### 2.1 Registers

A **register** is a coherent surface family. A screen chooses a register; it never invents a palette.

| Register | Used for | Ground | Content surface | Accent |
| --- | --- | --- | --- | --- |
| **Ivory** (default) | All staff tools; client portal; proposals and contracts on screen | Sage `#819087` | Ivory sheet `#f2eddd` | Copper plane `#deb599` |
| **Forest** | Decision panels, inline confirmations, dialogs, planner chrome over 3D, event-day dim mode (pending, §8) | — | Forest `#264337` | Cream `#efe7cf` and the "lit" tones |
| **Editorial** (public only) | Public homepage, marketing, legal | Each page's own paper or night ground | Photography, editorial serif | The warm-metal family (§5.1) |

### 2.2 Where the tokens live, and how they are named

**Location.** Add a "Workspace register" section to `packages/web/src/styles/house-tokens.css`. That file is imported by `global.css:3`, and its header says "FOH (ivory register) tokens are deliberately absent — F2's card" (`house-tokens.css:22`). This specification fills that gap.

**Three layers.**

| Layer | Where | Contents |
| --- | --- | --- |
| Palette primitives | `--house-*` at `:root` | Constant values. `house-tokens.css:4-6` makes `--house-*` canonical. None of the new names collide: `--house-sheet` and `--house-ink-*` do not exist today [inspected]. |
| Register semantics | `--reg-*` under `[data-register="ivory"]`, `[data-register="forest"]` and `.ws-plane` | Components consume only `--reg-*`, so one button, field or chip works on every register. |
| Legacy aliases | Existing names, kept during migration | `--enq-*` (`EnquiriesDesk.css:10-47`) and the light `--inventory-*` values (`InventoryStyle.css:4-6, 74`) become aliases, then are deleted. `--vv-*` stays untouched as the dark back-of-house layer: `--vv-ink` is `#0B0A09` (`house-tokens.css:68`), so that name cannot be reused for desk ink. |

**Proposed palette primitives:**

```css
/* house-tokens.css — "Workspace register" (proposed) */
:root {
  /* Planes */
  --house-ground: #819087;         --house-ground-plane: #97a597;
  --house-sheet: #f2eddd;          --house-sheet-hover: #ebe5d3;   --house-sheet-selected: #e5dec9;
  --house-paper: #faf8f1;          /* raised insets: fields, date tiles */
  --house-overlay: #f7f3e6;        /* menus, popovers, tooltips */
  --house-plane: #deb599;          --house-plane-hover: #d7aa8b;
  --house-forest: #264337;         --house-forest-deep: #1f3a2f;   --house-forest-field: #2b4a3d;
  --house-cream: #efe7cf;          --house-cream-hover: #f7f1de;
  /* Ink */
  --house-ink-1: #14302a;  --house-ink-2: #42584e;  --house-ink-3: #55655c;
  --house-plane-ink: #3e3528;
  --house-forest-ink-1: #f2eee1;  --house-forest-ink-2: #d0d9cd;  --house-forest-ink-3: #a9bdb0;
  /* Lines */
  --house-rule: #d9d4c2;          /* decorative separators only */
  --house-rule-strong: #bfc0ac;   /* decorative tile borders only */
  --house-edge: #747f6f;          /* control boundary on ivory */
  --house-plane-rule: #b9906f88;
  --house-forest-rule: #4d6c5c;   /* decorative separators only */
  --house-forest-edge: #86a192;   /* control boundary on forest */
  --house-frame-line: #75948255;  /* skewed panel frame */
  /* Type */
  --house-serif: "Newsreader", Georgia, "Times New Roman", serif;
  --house-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --house-mono: "Geist Mono", ui-monospace, monospace;
}
```

**Register semantics:**

```css
/* styles/workspace.css (proposed) */
[data-register="ivory"] {
  color-scheme: light;
  --reg-surface: var(--house-sheet);        --reg-surface-hover: var(--house-sheet-hover);
  --reg-surface-selected: var(--house-sheet-selected);  --reg-raised: var(--house-paper);
  --reg-text-1: var(--house-ink-1); --reg-text-2: var(--house-ink-2); --reg-text-3: var(--house-ink-3);
  --reg-rule: var(--house-rule);    --reg-edge: var(--house-edge);    --reg-focus: var(--house-ink-1);
  --reg-primary: var(--house-forest); --reg-primary-ink: var(--house-forest-ink-1);
  --reg-primary-hover: var(--house-forest-deep);
  --reg-attention: var(--house-copper-text); --reg-alert: var(--house-brick-strong);
  --reg-settled: var(--house-sage-text);
}
[data-register="forest"] {
  color-scheme: dark;   /* native selects and date pickers render dark, as InventoryStyle.css:74 does today */
  --reg-surface: var(--house-forest);   --reg-surface-hover: #ffffff0d;  /* composites to #314d41 */
  --reg-surface-selected: var(--house-forest-deep); --reg-raised: var(--house-forest-field);
  --reg-text-1: var(--house-forest-ink-1); --reg-text-2: var(--house-forest-ink-2);
  --reg-text-3: var(--house-forest-ink-3);
  --reg-rule: var(--house-forest-rule); --reg-edge: var(--house-forest-edge); --reg-focus: var(--house-cream);
  --reg-primary: var(--house-cream); --reg-primary-ink: var(--house-ink-1);
  --reg-primary-hover: var(--house-cream-hover);
  --reg-attention: var(--house-copper-lit); --reg-alert: var(--house-brick-lit);
  --reg-settled: var(--house-sage-lit);
}
.ws-plane {   /* the copper impact plane, inside the ivory register */
  --reg-surface: var(--house-plane); --reg-surface-hover: var(--house-plane-hover);
  --reg-text-2: var(--house-plane-ink); --reg-text-3: var(--house-plane-ink);   /* ink-2 and ink-3 fail on the plane */
  --reg-attention: #7e2d1b; --reg-alert: var(--house-brick-strong);
}
```

### 2.3 Colour, with measured contrast

**Ivory register: planes and ink**

| Token | Value | Role | Measured contrast |
| --- | --- | --- | --- |
| `--house-ground` | `#819087` | sage ground | **Never carries text**: ink 4.22:1, sheet 2.86:1 |
| `--house-ground-plane` | `#97a597` | pale tilted plane behind sheets | decorative |
| `--house-sheet` | `#f2eddd` | ivory sheet | ink-1 12.07 · ink-2 6.55 · ink-3 5.27 |
| `--house-sheet-hover` | `#ebe5d3` | row hover | ink-1 11.23 · ink-3 4.90 |
| `--house-sheet-selected` | `#e5dec9` | current row | ink-1 10.51 · ink-2 5.71 · ink-3 4.59 (the lowest text pair in the system) |
| `--house-paper` | `#faf8f1` | fields, date tiles | ink-1 13.30 · ink-3 5.81 |
| `--house-overlay` | `#f7f3e6` | menus, popovers | ink-1 12.73 · ink-3 5.56 |
| `--house-plane` | `#deb599` | copper impact plane | plane-ink 6.41 · ink-1 7.52 · **ink-2 4.08 and ink-3 3.28: never on the plane** |
| `--house-plane-hover` | `#d7aa8b` | stage hover | plane-ink 5.74 · ink-1 6.74 |
| `--house-edge` (new) | `#747f6f` | boundary of fields and quiet buttons | 3.58 on sheet · 3.95 paper · 3.33 hover · 3.12 selected · 3.78 overlay |
| `--house-rule` / `-strong` | `#d9d4c2` / `#bfc0ac` | separators, tile borders | 1.27 / 1.58: decorative only, never a control's only boundary |

**Forest register**

| Token | Value | Role | Measured contrast |
| --- | --- | --- | --- |
| `--house-forest` | `#264337` | decision surface | against ground 3.23 |
| `--house-forest-deep` | `#1f3a2f` | confirmations, nested surfaces | forest-ink-1 10.61 · -2 8.50 · -3 6.21 |
| `--house-forest-field` (new) | `#2b4a3d` | field fill on forest | forest-ink-1 8.42 · -2 6.74 · -3 (placeholder) 4.93 |
| `--house-forest-ink-1/2/3` | `#f2eee1` / `#d0d9cd` / `#a9bdb0` | text | on forest 9.32 / 7.47 / 5.46; on hover `#314d41` 7.98 / — / 4.67 |
| `--house-forest-edge` (new) | `#86a192` | control boundary | 3.88 on forest · 4.42 on deep · 3.50 on field |
| `--house-forest-rule` | `#4d6c5c` | separators | 1.86: decorative only |
| `--house-cream` / `-hover` | `#efe7cf` / `#f7f1de` | primary button on forest; focus ring on forest | ink-1 on cream 11.44 · on cream-hover 12.51 · cream against forest 8.76 |

**Semantic tones.** Every tone appears with a word.

| Tone | Meaning | Text on sheet | Chip text / wash | Dot (supplementary) | Lit (on forest) |
| --- | --- | --- | --- | --- | --- |
| **Copper** | needs you now: new, awaiting our reply, decision within 7 days | `#94491f` 5.55 | `#8a4119` / `#f3dcc9` 5.57 | `#c1703f` 3.17 | `#f0b68f` 6.08 |
| **Amber** | pending elsewhere: in review, 1st option, awaiting client | `#6f500f` 6.34 | `#664a0c` / `#efe0b8` 6.28 | `#c3952b` 2.34 (always beside a label); standalone mark `#a07614` 3.52 | `#f0cf8f` 7.23 |
| **Sage** | settled: approved, confirmed, paid, done | `#2f5a3a` 6.78 | `#2c5537` / `#dbe5d3` 6.56 | `#5d8963` 3.43 | `#9fc7ae` 5.80 |
| **Brick** | refused, conflict, failed, destructive | `#8a3522` 6.86; strong `#6f2616` 9.13 | `#83311f` / `#f1d8cf` 6.38 | `#b4513a` 4.29 | `#ffcdb7` 7.56 |
| **Slate** | inactive: withdrawn, cancelled, archived, unknown | `#545e59` | `#545e59` / `#e3e3db` 5.21 | `#8e9992` 2.52 (always beside a label) | `#c9d1cb` 6.94 |
| **Heather** (new, pending §8) | AI-proposed; always with glyph and "Draft" | `#5a4577` 7.03 | `#5a4577` / `#e7e0ea` 6.37 | `#8b76a6` 3.42 | `#cdbfe3` 6.27 |
| **Loch** (new) | estimate, simulated, for information | `#2d5563` 6.92 | `#2d5563` / `#d9e5e3` 6.28 | `#5f8b97` 3.19 | `#a8d0d6` 6.52 |

Ink-1 on every wash measures 10.4–11.0:1, so wash-filled blocks can carry ink text. On forest, dots use the lit value, because copper and sage dots measure 2.92 and 2.69 on forest.

**On the copper plane.** These are the only colours allowed on the plane besides ink-1 and plane-ink.

| Use | Value | On plane |
| --- | --- | --- |
| Attention count (for example, New > 0) | `#7e2d1b` | 4.91 |
| Alert or shortage text ("10 chairs needed", "−10") | `#6f2616` (brick-strong) | 5.69 |
| Stage dots | new `#9a4a25` 3.31 · review `#77581a` 3.50 · approved `#3d6b47` 3.29 · declined `#8a3522` 4.28 · withdrawn `#5d6862` 3.09 | |

**Charts**
- Categorical hues, in this order: forest `#264337` (9.24), copper `#b8612f` (3.74), sage `#5d8963` (3.43), heather `#8b76a6` (3.42). Anything beyond four series is grouped as "Other" in `#747f6f` (3.58).
- Sequential scale (occupancy): `#e9e4d1 → #c9d2c0 → #9fb39f → #6f8f76 → #466b53 → #264337`. This is the craft brief's proposal; its intermediate steps are not measured.
- Diverging scale (against a target): copper ← ivory → forest.

**Diary commitment encoding.** This is a proposal. The words depend on Blake's vocabulary decision (§8).

| State | Treatment | Why |
| --- | --- | --- |
| Confirmed (ink) | Forest fill, cream text (9.32) | A firm week visibly "fills in". Today hold and ink fills differ by 1.08:1 [audit, `diary-board.css:85-93`]. |
| 1st option | Amber wash, amber left edge, ink text; option numeral "1st" | |
| 2nd+ option | Sheet fill, amber dashed outline with 45° hatch; "2nd" | |
| Decision within 7 days | Copper age text ("decides in 3 days") | Copper means a real clock |
| Prospect | Slate dashed hairline | |
| House block | Slate hatch | |
| Clash | Brick double edge plus the word "Clash" | |
| Released / cancelled / lost | Slate chip, title struck through, **full-strength text** | Today's `opacity: 0.85` gives 2.91–3.68:1 [audit] |

### 2.4 What may sit on what

| Surface | Allowed text | Never |
| --- | --- | --- |
| Sage ground | nothing | any text |
| Ivory sheet, hover, selected, paper, overlay | ink-1/2/3, tone text, chip text on its wash | brass `#c9a84c` (1.95), cyan `#87e7f0` (1.22), `#999` |
| Copper plane | ink-1, plane-ink, `#7e2d1b`, `#6f2616` | ink-2, ink-3, copper text `#94491f` (3.46), brick `#8a3522` as text (4.28) |
| Forest, deep, field | forest-ink-1/2/3, cream, lit tones | any dark ink, tone dots as the only signal |
| Cream (primary button) | ink-1 | forest-ink |

### 2.5 Typography

**Families.**
- Newsreader carries meaning: titles, names, lede sentences, quotations and date numerals.
- Inter carries operation: UI text, labels, numerals and controls.
- Geist Mono is used only for reference codes.
- `font-optical-sizing: auto` stays on. The shipped Newsreader file has an optical-size axis from 6 to 72, per the craft brief's fontTools read.

**Weights.** Use only 300, 400, 500 and 600.
- `site.css` and `cockpit.css` declare discrete weights that point at variable files [inspected: `site.css` Newsreader faces; `cockpit.css` Inter faces].
- Weights such as 450, 550, 650, 800, 850 and 950 fall between the declared faces, so the browser picks the nearest face [inferred].

**Numerals.** Use `font-variant-numeric: tabular-nums` for counts, money, times and table columns. Drop `lining-nums` (`EnquiriesDesk.css:178, 303, 482`): the shipped fonts have no `lnum` feature (craft brief).

| Role | Family | Size / line-height | Weight | Tracking | Use (desk source) |
| --- | --- | --- | --- | --- | --- |
| display-l | serif | clamp(38px, 3.6vw, 54px) / 1.04 | 400 | −0.022em | page h1 (`:114-120`) |
| display-m | serif | clamp(30px, 2.6vw, 40px) / 1.1 | 400 | −0.018em | panel name (`.enq-panel__name`); overview heading folds in (was 34–46 px) |
| title-l | serif | 26 / 1.2 | 400 | 0 | empty and caught-up headings; date-tile day |
| title-m | serif | 21 / 1.3 | 400 | 0 | confirmation question (`:579`) |
| title-s | serif | 19 / 1.25 | 500 | −0.005em | row title, card title |
| lede | serif | 19 / 1.5 | 400 | 0 | one-sentence summary, max 60ch |
| quote-l | serif italic | 18 / 1.55 | 400 | 0 | client's words in a panel |
| quote-s | serif italic | 15 / 1.35 | 400 | 0 | row excerpt (was 14.5) |
| numeral-xl | sans | clamp(30px, 2.7vw, 42px) / 1.04 | 300 | −0.045em | stage counts, stat plane |
| numeral-l | sans | clamp(24px, 2vw, 32px) / 1.1 | 300 | −0.03em | facts; tally |
| numeral-input | sans | 28 / 1.15 | 400 | 0 | editable quantities (inventory fields) |
| body | sans | 15 / 1.45 | 400 | 0 | default UI text |
| meta | sans | 14 / 1.45 | 400 | 0 | row meta, notices, consequence lines |
| caption | sans | 13 / 1.4 | 400–500 | 0 | ages, hints, field help, chips |
| eyebrow | sans caps | 12 / 1.3 | 600 | +0.09em | section labels, group headers |
| micro | sans caps | 11 / 1.1 | 600 | +0.08em | **date tile only** (was 10.5, `:302`) |
| button-l / button / quiet | sans | 16 / 14 / 14 | 600 / 600 / 500 | 0 | panel primary / others / quiet |

Half-point sizes (12.5, 13.5, 14.5) fold into the nearest role. That changes the desk by at most 0.5 px, and those changes will be recaptured as intended differences.

### 2.6 Spacing and layout

**Spacing scale** (4 px base): `--house-space-` 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 28 · 32 · 36 · 40 · 48 · 56 · 64 · 80. Existing desk values of 18, 22, 26, 30 and 34 map to the nearest step when components are extracted.

| Token | Value | Source |
| --- | --- | --- |
| `--house-header-height` | 80 px | `DashboardLayout.css:12`; desk `calc(100dvh - 80px)` |
| `--house-gutter` | 24 px (20 below 1180; 0 at 760 and below) | `EnquiriesDesk.css:59, 677-681` |
| `--house-panel-width` | clamp(400px, 34vw, 540px) | `EnquiriesDesk.css:52` |
| `--house-panel-top` | 104 px (header plus gutter) | `EnquiriesDesk.css:382` |
| `--house-sheet-pad` | 36 · clamp(28px, 3.2vw, 52px) · 48 · clamp(24px, 3.4vw, 56px) | `EnquiriesDesk.css` `.enq-sheet` |
| `--house-page-max` | 1780 px | `InventoryStyle.css:119` (the only implemented cap) |
| `--house-row-min` | 84 px (comfortable); 60 px compact, pending §8 | `.enq-row` |
| Targets | 44 px touch; 36 px pointer-only icon buttons | `.enq-quiet`, `.enq-close` |

**Breakpoints** (one set):
- 1180 px and above: list and panel side by side.
- 761–1179 px: list and panel take turns.
- 760 px and below: full bleed, tilts flatten.

Inventory's 1190, 900 and 560 px steps (`InventoryStyle.css:129-201`) become container queries inside the component.

### 2.7 Radii

| Token | Value | Use |
| --- | --- | --- |
| `--house-radius-0` | 0 | sheets, planes, panels, tables, notices |
| `--house-radius-control` | 3 px | buttons, fields, tiles, confirmations |
| `--house-radius-key` | 4 px | `kbd` only |
| `--house-radius-pill` | 999 px | chips, segmented controls, planner mode pills |
| round | 50% | avatars, icon buttons, dots |

There are no 8–14 px "SaaS card" radii.

### 2.8 Planes, depth and elevation

Depth comes from overlapping opaque planes and value steps, not from shadows or blur.

**Layer order, back to front:**
1. Ground.
2. Ground plane: `polygon(0 0, 100% 0, 84% 100%, 0 72%)` (`EnquiriesDesk.css:75`).
3. Sheet, with its right edge inset 14 px (`:109`), and the forest panel, whose 1 px frame is inset 14 px at `skewX(-1.5deg)` (`:425-429`).
4. Impact plane, in one of two shapes:
   - **band** inside a sheet, breaking past its left edge: `polygon(0 7%, 100% 0, calc(100% - 10px) 100%, 6px 100%)` (`:152`);
   - **block** beneath a sheet: `polygon(3% 0, 100% 0, 97% 100%, 0 100%)` (`InventoryStyle.css:57`).

**Tilts.** At most 2°. A plane has at most one tilted edge, except where another plane overlaps it, in which case the overlapped edge may tilt to meet it (the reference image). All tilts flatten at 760 px and below.

**Shadows (only two):**
- `--house-shadow-overlay: 0 1px 0 #14302a0f, 0 14px 36px #18372a24` for menus and popovers. The second layer is `DashboardLayout.css:64`.
- `--house-shadow-lift: 0 10px 24px #14302a2e` for a dragged item only.

**Scrim:** `--house-scrim: #14302a5c`, for the rare true dialog.

**Z-index scale:** sticky panel 10 · header 40 (`DashboardLayout.css:7`) · popover 80 · toast 90 · dialog 100 · skip link 200. The toast (currently 500) and the inventory overlay (currently 420, `InventoryPanel.css:53`) move to this scale.

No glass or blur appears in the content layer (Apple HIG, Materials).

### 2.9 Motion

| Token | Duration | Easing | Use |
| --- | --- | --- | --- |
| `--house-motion-press` | 120 ms | `--house-ease-out` | `scale(0.97)` on buttons, `scale(0.995)` on rows (`:287, :370`) |
| `--house-motion-hover` | 120 ms | ease | colour only; `(hover: hover) and (pointer: fine)` only |
| `--house-motion-instant` | 100 ms (existing) | — | highlight appearing, ticks, selection |
| highlight out | 150 ms | ease | keyboard highlight leaving |
| `--house-motion-reveal` | 180 ms | ease-out | disclosure, inline confirmation opening (opacity plus 4 px) |
| `--house-motion-deliberate` | 240 ms (existing) | `--house-ease-standard` | pressed-stage underline, panel content change (opacity only) |
| `--house-motion-stamp` | 320 ms | ease-out | chip stamp on a real status change (`:228-232`) |
| `--house-motion-cinematic` | 650 ms (existing) | `--house-ease-in-out` | 3D camera only |

**Easings:**
- `--house-ease-out: cubic-bezier(0.23, 1, 0.32, 1)` (`:47`)
- `--house-ease-standard: cubic-bezier(0.2, 0, 0, 1)`
- `--house-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`

Overshoot curves are banned in UI, which removes `cubic-bezier(0.34, 1.56, 0.64, 1)` at `index.html:99`.

**Reduced motion** removes every transform and the stamp, and keeps colour transitions at 120 ms or less (`EnquiriesDesk.css:671-675`).

Nothing pulses or loops except the shared Activity indicator during real work.

### 2.10 Focus

Every focusable element gets `outline: 2px solid var(--reg-focus)`, `outline-offset: 2px`, and `box-shadow: none`.
- Full-width rows use an offset of −2 px (`EnquiriesDesk.css:91`).
- Ink on ivory and on the plane: 12.07 and 7.52.
- Cream on forest: 8.76.
- The cyan halo `0 0 0 6px rgba(107,217,232,.16)` (`global.css:53`) is removed everywhere.

### 2.11 Icons and imagery

**Icons.** Lucide at 16–20 px with a 1.5–1.75 stroke, beside a word. Icon-only is allowed for close, previous and next, back, and expand, each with an accessible name and a focus-visible tooltip.
- `ArrowUpRight` means "opens a new tab or leaves Venviewer" and nothing else. Today it also marks in-page actions (8 uses in inventory [audit]) and "Open their layout" (`EnquiryPanel.tsx:410`).
- Emoji are never used as icons (`FileUploader.tsx:117` [audit]).
- Moments use the engraved seal family (`EnquiryOverview.tsx:114`).

**Imagery.** Use only real, sourced venue photographs, matched to the requested room, faded into the surface below (`EnquiriesDesk.css` `.enq-room-photo::after`). Show no photo when the room is unknown or the venue is not the source. Inventory illustrations are labelled "Illustrative view" and never imply what is in stock (`InventoryPicture.tsx:83, 107` [audit]).

### 2.12 Reconciliation log

Each row below records a conflict and how it was resolved. By default the desk's value wins, because Blake judged the desk. Contrast wins over either reference. Inventory wins only where the desk has no equivalent.

**Desk (`EnquiriesDesk.css`) against inventory (`InventoryStyle.css`, `InventoryPanel.css`):**

| # | Property | Desk | Inventory | Resolved to | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | Ground | `#819087` (`:10`) | `#819087` (`:9`); shell paints the inventory main `#7f9182` (`DashboardLayout.css:94`) | `#819087` | Agreed by both; the shell value is drift |
| 2 | Sheet | `#f2eddd` (`:11`) | `#f0ebd9` (`:15, :108`); state box `#efeada` (`:4`) | `#f2eddd` | Blake's judged surface; the difference is ≤ 4 per channel |
| 3 | Hover and selected | `#ebe5d3` / `#e5dec9` (`:12-13`) | surface `#e6e1cf` (`:4`), choice hover `#dce0cc` (`:42`), catalogue hover `#e4e3d2` and pressed `#dbe0cb` (`:51-52`) | desk pair | Five near-duplicates collapse to two, both of which keep ink-3 at 4.59 or better |
| 4 | Raised inset | date tile `#faf8f1` (`:298`) | search and popover `#f6f2e5` (`:20, :23`) | paper `#faf8f1` for fields; overlay `#f7f3e6` for popovers | Separates fields from floating layers |
| 5 | Primary ink | `#14302a` (`:17`) | `#102c25` (`:4`) | `#14302a` | 12.07 compared with 12.48: no reading difference, and the desk is the reference |
| 6 | Secondary ink | `#42584e` / `#55655c` (`:18-19`) | muted `#4c6055` (`:5`); figcaption `#5c685a` (`:29`) | ink-2 for secondary, ink-3 for tertiary | Two tiers, both AA; the inventory values fall between them |
| 7 | Rules and boundaries | `#d9d4c2` / `#bfc0ac` (`:20-21`) | `#acb3a3` (`:5`), `#8f9e8966` (`:36`), `#a9b19e88` (`:49`); search border `#c0c4b4` 1.49:1 (`:20`) | decorative: desk rules; controls: new `--house-edge` `#747f6f` (3.58) | Neither reference had a 3:1 field boundary |
| 8 | Plane and its ink | `#deb599`, plane-ink `#3e3528` (`:14-16`) | `#deb599` (`:57`), caption `#4c4839` 4.87 (`:63`), rule `#816b5344` (`:67`) | plane-ink 6.41; plane-rule `#b9906f88` | One ink on the plane |
| 9 | Shortage on the plane | — | `#842b1c` 4.77 (`:69`) | `#6f2616` 5.69 | The same token already works on sheet (9.13) and wash (7.87). The desk brick `#8a3522` fails on the plane (4.28). |
| 10 | Forest | `#264337` (`:37`) | `#264337` (`:72`); ivory-side primary `#294b3b` (`:5`) | `#264337` | One forest |
| 11 | Forest ink | `#f2eee1` / `#d0d9cd` / `#a9bdb0` (`:39-41`) | pane `#f1edde` (`:72`); editor `#f2eee1` / `#d0d9cd` (`:74`) | desk trio | Already almost identical |
| 12 | Forest lines | rule `#4d6c5c` 1.86, used for quiet-button and textarea borders (`:42, :553, :587`) | `#799383` 3.25, used for field borders and separators (`:74`) | split: `--house-forest-rule` for separators; new `--house-forest-edge` `#86a192` (3.88) for controls | The desk's control borders fail 3:1 |
| 13 | Field on forest | textarea `#18301f33`, dark translucent (`:589`) | `#365447`, lighter (`:74`, 1.30 against forest) | `#2b4a3d`, solid and slightly lighter than forest | The reference shows fields as slightly lighter wells; solid keeps contrast predictable (forest-ink 8.42, placeholder 4.93) |
| 14 | Primary on forest | cream `#efe7cf`, hover `#f7f1de` (`:43-44`) | accent `#eae2ca` with `filter: brightness(1.06)` hover (`:74, :105`) | cream / cream-hover | Filters are banned from hover (P27) |
| 15 | Error on forest | `#ffcdb7` (`:626`) | `#ffccb4` (`:74`) | `#ffcdb7` | One value |
| 16 | Panel frame | inset 14, `#75948255`, `skewX(-1.5deg)` (`:425-429`) | inset 16, `#75948288`, `skewX(-2deg)` (`:73`) | desk | The quieter frame of the two |
| 17 | Sheet edge | right edge inset 14 px (`:109`) | right and bottom both tilted (`:15`) | right edge; bottom tilt only where a plane overlaps | The one-tilt rule, with the reference's overlap exception |
| 18 | Impact plane shape | band (`:152`) | block (`:57`) | keep both as named shapes | They serve different compositions |
| 19 | Serif | Newsreader (`:45`) | Georgia (`:17, :32, :44, :77, :110`; `InventoryPanel.css:20, 51, 56`) | Newsreader | Loaded on every route (`index.html:15`); one voice |
| 20 | Display h1 | clamp(38–54)/1.04, −0.022em (`:114-120`) | clamp(36–52)/1.1, −0.025em (`:17`) | desk | Reference |
| 21 | Large numerals | 300 weight, clamp(30–42) (`:171-180`) | 450 weight, clamp(32–49) (`:38`) | 300 | 450 is not a declared face [inferred]; light numerals are the desk idiom |
| 22 | Editable quantities | — | Inter 29 px, 400 (`:82`) | numeral-input, 28 px, 400 | Editing needs a solid weight; this is the only inventory-only role |
| 23 | Radius | 3 px (`:297, :361`) | 4 px (`:41, :81`; `InventoryPanel.css:22`) | 3 px | Reference |
| 24 | Control heights | 40 / 44 / 48 (`:358, :551, :531`) | 46 buttons, 48 fields, 56 save (`InventoryPanel.css:22`; `:81, :96`) | 40 inline · 44 quiet and fields · 48 primary | One ladder; 44 meets the touch minimum |
| 25 | Weights | 500 / 600 | 550 (`InventoryPanel.css:23`; `:69, :99`) | 600 | 550 is not a declared face [inferred] |
| 26 | Hover timing and gating | 120 ms, fine-pointer only (`:170, :662`) | 150–160 ms, ungated (`:41-52`; `InventoryPanel.css:22, 25`) | 120 ms, gated | Touch devices otherwise keep a sticky hover [inferred] |
| 27 | Focus | ink / cream, offset 2, halo removed (`:84-90`) | `#2f614b` (6.00) and `#eee1b4` (8.28), offset 4, global halo still showing (`:106-107`; `InventoryPanel.css:29`) | ink / cream, offset 2, `box-shadow: none` | One rule, and no cyan halo |
| 28 | Notices | `#f1e6d6` with a copper edge (`:347`) | `#f0dcc0`, `#a28a64`, `#4b381f` (`:111`); forest `#3d4d38` / `#fae5b5` (`:112`) | tone wash plus 3 px tone edge on ivory; forest-deep plus lit edge on forest | Notices reuse chip washes (ink on copper wash 10.69); one fewer token |
| 29 | Success on forest | stamp only | `#365746` / `#91ad8a` / `#edf0d7` (`:113-114`) | sage-lit text on forest-deep plus the stamp | One success language |
| 30 | Overlay scrim and shadow | none | scrim `#142b2477` (`:118`); popover shadow `0 12px 24px #183a2326` (`:23`) | `--house-scrim`; `--house-shadow-overlay` | One depth model; the shell's shadow is already on screen |
| 31 | Small captions | age and chip at 12.5 px (`:214, :325`) | figcaption 11 px, captions 12 px (`:29, :63, :84`) | 13 px caption; 11 px only for date-tile caps | Type floor (P3) |
| 32 | Colour scheme | `light` (`:65`) | panel `light`, editor `dark` (`:6, :74`) | per register: ivory light, forest dark | Native controls match their surface |
| 33 | Dark legacy base | — | `InventoryPanel.css:1-16` still declares the dark palette, overridden only by import order | delete once InventoryStyle rules move to tokens | Dead rules invite reuse [audit] |

**Desk-internal fixes.** These change the reference, deliberately:
- Quiet-button and textarea borders move from 1.86 to 3.88 or better (row 12).
- The review dot on the plane moves from `#85651a` (2.88) to `#77581a` (3.50) (`:197`).
- Date-tile caps move from 10.5 to 11 px.
- `lining-nums` is removed.
- Half-point sizes fold into roles.

**Shell (`DashboardLayout.css`) against the desk:**

| Property | Shell | Resolved |
| --- | --- | --- |
| Paper and ink | `#f2edda`, `#122b25` (`:2-3`) | sheet and ink-1 (ink on the shell paper is 12.05 compared with 12.07: no change in reading) |
| Rules | `#c9cdbd`, `#bfc4b2`, `#b8c1ae`, `#d3d8c7` (`:14, :4, :63, :81`) | rule / rule-strong / edge |
| Menu states | hover `#e7e5d5`, `#e7e9d9`; active `#dce3d1` (`:39, :80`) | sheet-hover / sheet-selected; the active item also gets weight 600 and `aria-current` |
| Focus | `#365f4f` (`:41`) | `--reg-focus` |
| Menu label | `#54675c`, 0.72rem (`:67`) | eyebrow role, ink-3 |
| Wordmark | Georgia caps (`:21`) | Newsreader caps, pending §8 |
| Default main ground | `#132b25` (`:92`) | register-driven, migrated view by view (§6) |

**House BOH tokens against the workspace layer:**
- `--house-motion-instant: 100ms` (`house-tokens.css:58`) keeps its role (ticks, highlight appearing). Hover and press take 120 ms, the desk's value.
- `--vv-focus: #87e7f0` (`:79`) keeps its value, because `house-tokens.test.ts:132` pins it. It becomes the fallback only on unmigrated dark surfaces.

---

## 3. Components

All components live in `packages/web/src/components/workspace/`, with `.ws-` classes in `workspace-components.css`. They consume only `--reg-*` and `--house-*` tokens.

### 3.1 Workspace shell (header, navigation, account, notifications)

**Use for:** the frame of every staff route. It becomes one persistent layout route: today each page mounts its own `DashboardLayout` and refetches the venue name [audit, `DashboardLayout.tsx:151-167`].

**Anatomy:**
- An 80 px ivory header containing:
  - the wordmark;
  - a hairline and the venue name, which links to the role's home via `getDefaultRoute` (`role-routing.ts`); today it always goes to `/dashboard` (`DashboardLayout.tsx:192`) [audit];
  - role-aware primary items;
  - a "More" menu grouped under eyebrow headings (Sales, Operations, Venue, Platform);
  - a search field (later);
  - a notification bell with a quiet count (pending §8);
  - the account avatar.
- The current item carries a 2 px ink underline. When a view inside More is open, its own name replaces "More" in that slot.

**States:**
- rest
- hover (colour only, fine pointer)
- current (`aria-current="page"`, underline, weight 600)
- menu open
- venue loading: a cached name, never "Your venue" and then "Opening venue…"
- venue failed: "Venue name unavailable", with retry in the account menu

**Accessibility:**
- `<nav aria-label="Primary">`.
- A skip link, "Skip to workspace" (`DashboardLayout.tsx:189`).
- Menus close on Esc and return focus to their trigger (`:104-124`).
- On a view change, focus moves to the new h1 (`tabIndex=-1`), `main` takes the view's name as its `aria-label`, and `document.title` reads "Enquiries · Trades Hall — Venviewer".
- Menu items are at least 44 px.
- The notification count is inside the button's accessible name, never shown only as a badge.

### 3.2 Page sheet and header

**Anatomy:**
- The root `<div data-register="ivory">` sets the ground.
- An optional ground plane.
- The sheet contains:
  - an eyebrow date line in venue time (greeting pending §8);
  - the h1 in display-l;
  - one lede sentence built only from real counts: numbers in `<strong>` at ink 500, attention numbers in copper.

**States:**
- Loading: the lede slot holds an inline `ActivityStatus` at the same minimum height, so the layout does not jump (`EnquiriesDesk.css:123, 131`).
- Error: brick-strong text with Retry in the lede slot (`:132-133`).

**Accessibility:** exactly one h1 per view (Pipeline, Reviews, Analytics, Proposals, Search, Loadouts, Settings and Admin have none today [audit]). The lede is plain text, not a live region.

### 3.3 Stat plane (counts that are the filters)

**Anatomy:**
- One copper plane per view, in the band or block shape, holding 3–6 cells.
- Each cell has a numeral-xl count in ink and a 14 px plane-ink label with an 8 px dot.
- Cells are separated by plane-rule dividers.
- Optional delta line in 13 px plane-ink ("2 more than last Monday"). There are no arrow-only or red/green deltas.
- Money appears as "£12,400" in tabular figures.

**States:**
- rest
- hover (plane-hover)
- pressed filter (3 px ink underline, label weight 600)
- attention count (`#7e2d1b`)
- unknown count (label only)
- phone: a 3 × 2 grid (`EnquiriesDesk.css:691-697`)

**Accessibility:** `role="group"` with a label ("Show enquiries by stage"). Each cell is a `<button aria-pressed>` whose accessible name is "New, 4" (`EnquiryStages.tsx:36-53`). Count changes are not announced separately; the consequence line announces them (§3.12).

### 3.4 Ledger, group header and row

**Anatomy:**
- Groups get an eyebrow header, a hairline and a count, grouped by time: Today · Yesterday · Earlier this week · Last week · then by month.
- Each row is `<li><button>` in a grid of `58px | 1fr | auto`, at least 84 px tall, containing:
  - a date tile;
  - a title-s serif name;
  - 14 px ink-2 meta in the booker's order (event type · guests · room · extras);
  - one quote-s line in ink-3;
  - a side column with the chip and the age;
  - a 3 px copper left bar when the row needs attention.

**States:**
- rest
- hover (fine pointer)
- selected: sheet-selected fill, a full-height ink bar and `aria-current="true"`
- press: `scale(0.995)`
- new: copper age text
- stamped: the chip plays the stamp once
- phone: two columns, with the side column moving under the main one (`:698-700`)

**Accessibility:**
- One Tab stop into the list, with a roving `tabIndex` (`EnquiryLedger.tsx:147`).
- ↑ ↓ / j k / Home / End move; Enter opens.
- Each row's `aria-label` is the full sentence: "Sarah Henderson, Saturday 5 June 2027, wedding, 140 guests, Grand Hall, New, received 2 hours ago". The visual spans are `aria-hidden` (`:146-170`).
- Groups are `<section aria-labelledby>` (`:79`).

**Extract from:** `EnquiryLedger.tsx`, `EnquiriesDesk.css:236-326`.

### 3.5 Date tile

**Anatomy:** 58 × 60 px minimum (52 on phones), paper fill, rule-strong border, 3 px radius. Weekday and month in micro caps, ink-3; the day in title-l serif; the year shown as "'27" only when it differs from the venue's current year.

**Variants:**
- open date: dashed border, the word "Open"
- past: transparent, ink-3
- today (Diary): 2 px ink border
- range: "5–7 JUN"

**Accessibility:** the tile is `aria-hidden` inside a row whose label carries the full date. A standalone tile has `aria-label="Saturday 5 June 2027"`.

### 3.6 Status chip and stamp

**Anatomy:** a pill with padding 3/10/3/8, 13 px weight 600, an 8 px dot, the tone's wash and chip text (§2.3).

**States:**
- Static by default.
- Filter chips are `<button aria-pressed>`, 32 px tall with a 44 px hit area.
- The stamp (`scale(1.14)` to 1 over 320 ms, with a copper-lit ring fading, `EnquiriesDesk.css:228-232`) plays only when the status actually changes. It is removed under reduced motion.

**Vocabulary.** One map per record type lives in `lib/status-vocabulary.ts`, so the same record uses the same words everywhere.
- Today the desk says New / In review / Declined (`enquiry-desk-format.ts:25-47`).
- StatusBadge says Submitted / Under Review / Rejected, with 6 of 7 tones below AA (`StatusBadge.tsx:5-13`) [audit].
- StatusBadge is retired.

**Accessibility:** the text is the meaning and the dot is `aria-hidden`. The chip's text meets AA on its wash (5.21–6.56).

### 3.7 Decision panel (forest)

**Anatomy:**
- A sticky frame (`top: var(--house-panel-top)`, `height: calc(100dvh - 128px)`) with a body that scrolls inside it (`overscroll-behavior: contain`, `EnquiriesDesk.css:380-400`).
- Content, in this order:
  1. The bar: Previous and Next (chevron plus word), and a 36 px close button.
  2. An optional room photograph (132–200 px) fading into forest.
  3. An eyebrow line: record type · age.
  4. The name, in display-m.
  5. The status chip.
  6. The facts row (§3.8).
  7. **The next step, always immediately after the facts:** the path (§3.9), then one primary action, at most two quiet alternatives, and a consequence line (14 px, forest-ink-2).
  8. Then contact, the client's words, tools, drafts (collapsed) and the timeline, as sections separated by forest-rule lines with eyebrow headings.

**States:**
- Opening: an `ActivityStatus` centred in the body.
- Nothing selected: proposes the next move (the longest-waiting item, or "waiting for a decision"), or shows a sealed caught-up state, plus the keyboard legend (`EnquiryOverview.tsx`).
- Stale: a notice reading "Changed while you had it open. Showing the latest."
- Below 1180 px: full width, with "Back to …".
- Single-column mode: `.enq-desk--single` (`:436-437`).

**Accessibility:**
- `<section aria-labelledby>` pointing at the name.
- The name has `tabIndex=-1` and receives focus when the panel opens; closing returns focus to the row.
- `aria-keyshortcuts` on Previous, Next and Close (`EnquiryPanel.tsx:92-103`).
- One visually hidden `role="status"` for the announcement after a decision (`:115`).

### 3.8 Facts row

**Anatomy:** up to three facts as numeral-l (the room at 19–23 px regular, `:495`), with forest-rule dividers and 13 px forest-ink-2 labels underneath. The date carries a qualifier ("Saturday, in 8 months"). An unknown fact reads "Not given" in forest-ink-3 at 18 px.

**Accessibility:** a `<dl>`. The visual order puts the value above the label (`column-reverse`) while the DOM order stays dt then dd.

### 3.9 Path (where the record is)

**Anatomy:** an `<ol>` of marks joined by 22 px lines: done (filled forest-ink-2), current (copper-lit fill and ring, weight 600), next (outline).

**Accessibility:** `aria-label="Progress"` and `aria-current="step"` on the current step (`EnquiryPanel.tsx:231-233`).

**Reuse:**
- Enquiry: New → In review → Decision.
- Deal: Enquiry → Held → Proposal → Accepted → Contract signed → Deposit paid → Confirmed. Each step reflects the real state of the record that owns it.
- Setup: Rooms → Heights → Prices → Photos → Ready.
- Review: Submitted → In review → Decision.

### 3.10 Buttons

| Variant | Ivory register | Forest register | Height |
| --- | --- | --- | --- |
| Primary (one per view) | forest fill, forest-ink-1 text (9.32); hover forest-deep | cream fill, ink-1 (11.44); hover cream-hover | 48 (panel) / 40 (inline) |
| Quiet | transparent, 1 px `--reg-edge` border, ink-1 14/500; hover sheet-hover | transparent, forest-edge border, forest-ink-1; hover `#ffffff0d` | 44 |
| Text link | underline offset 3 px, decoration at 35% alpha, full on hover | the same, forest-ink-1 | inline |
| Destructive trigger | quiet style, brick text `#8a3522`, label ends "…" | quiet style, `#ffcdb7` | 44 |
| Icon | 36 px circle, edge border, with an accessible name and tooltip | the same | 36 (44 on touch) |

**Rules:**
- There is never a red-filled button. The action that confirms a destructive step is the primary style with an explicit verb ("Decline and email").
- Labels are a verb plus an object, in sentence case.
- While busy, show `ActivityIndicator` plus a present participle ("Declining…"), set `aria-busy`, and hold the button's width.
- Disabled buttons use 0.7 opacity and a default cursor, and the reason is shown in visible text beside them, never only in a `title` (see `ProposalsView.tsx:566` [audit]).
- Press is `scale(0.97)`.

### 3.11 Consequence confirmation (inline)

**Use for:** any action that emails, signs, charges, publishes, releases a hold, or is terminal.
- It replaces `ConfirmModal` (a dark overlay with a default `#dc2626` button, `ConfirmModal.tsx:39-56, 76` [audit]).
- It also replaces the Reviews `NoteModal` (`ReviewsView.tsx:197-265` [audit]).

**Anatomy:**
- A forest-deep box with a 1 px forest-edge border, a 3 px left rule in the tone (sage, amber or brick), 16 px padding and a 3 px radius.
- A question in title-m serif.
- A consequence sentence in 14 px forest-ink-2 that names the recipient's address and what is sent, what changes, and whether it can be undone.
- An optional note field whose label says where the note goes ("Quoted in the email to sarah@…" or "Kept on the timeline").
- Actions: the primary "[Verb and consequence]" and a quiet Cancel.
- On an ivory surface, the same component uses the ivory register: paper fill with an edge border.

**States:**
- opening (reveal motion)
- saving (`aria-busy`; note preserved)
- failed (`role="alert"` in brick-lit, note preserved)
- conflict: after an HTTP 409 or 422, the record is re-read and the component says where it is now ("Catherine approved this at 10:14")
- done (the chip stamps and the panel moves to the next step)

**Accessibility:**
- `role="group"` with `aria-labelledby` pointing at the question. Focus moves to the question (`tabIndex=-1`, `EnquiryPanel.tsx:366-367`).
- Esc cancels and returns focus to the trigger.
- For irreversible deletions of named things (a venue), the confirming button stays disabled until the name is typed, with the reason stated.

### 3.12 Notice

**Anatomy:** in-flow, never floating. A 3 px tone left rule, the tone's wash (or forest-deep with a lit rule), 12 × 14 px padding, 14 px ink text, and at most one action.

| Tone | Used for |
| --- | --- |
| copper | attention |
| brick | alert |
| sage | settled |
| slate | information, offline, denied |
| loch | estimate or simulated |

**Standard messages:**
- "Changed while you had it open. Showing the latest." [Reload]
- "You're offline. Changes are kept on this device and sent when you reconnect." Use this only where it is true.
- "Only venue admins can change this. Ask Elaine MacGregor."
- "Couldn't refresh at 14:02. Showing the last loaded diary." [Retry]

**Accessibility:** alerts use `role="alert"`; everything else is plain text in place. Never nest live regions.

### 3.13 Undo toast (the only toast)

**Use for:** undoable internal actions whose result is not visible where the person is looking. This promotes the Diary's `UndoToast` (`BoardPanels.tsx:195-212` [audit]) and replaces `ToastContainer`, which sits at the top right covering the account name and dismisses errors after 4 s (`ToastContainer.tsx:73`; `toast-store.ts:31-34`) [audit].

**Anatomy:**
- Placed bottom-left, above the content, clear of the header and the panel.
- Forest fill with cream text, stating what happened and where ("Moved Henderson wedding to Saloon, Sat 19:00–00:00").
- Actions: Undo and a 24 px or larger dismiss control.
- A hint showing Ctrl/Cmd+Z.

**States:**
- Lasts 6 s, pausing on hover or focus.
- One at a time; a newer toast replaces the older.
- Ctrl/Cmd+Z keeps working after it disappears.

**Accessibility:**
- One persistent polite live region, always mounted: today's container returns `null` when empty (`ToastContainer.tsx:65` [audit]), so first announcements may be missed [inferred].
- The Undo focus ring is cream (the Diary's `#517963` measures 1.81:1 on its toast [audit]).
- Failures are never toasts; they appear as notices beside their cause.

### 3.14 State message (and seal)

One component with these kinds:

| Kind | Content |
| --- | --- |
| First run | A title-l fact ("No enquiries yet"), where they will come from, and one action ("Copy the form link" or "Import from a spreadsheet") |
| Filtered empty | "No declined enquiries" and [Show all]; the stat plane stays visible |
| Caught up | The engraved seal (copper-lit on forest, ink on ivory), "All caught up", and one factual line; optionally the room photograph. No praise. |
| Error | What failed, in plain words (from `describeFailure`), what is unchanged, and [Try again]. Last good data stays visible. |
| Denied | What this page is for, who can grant access (by name when known), and one way forward (the role's home, "Use another account", or a supplier's own pages). Never "Try again" on a 403 (`HallkeeperPage.tsx:424` [audit]). |
| Not found | "This setup sheet could not be found", with a way back |

**Accessibility:** the heading level fits the surrounding outline, and actions are buttons or links. The seal is `aria-hidden`.

### 3.15 Fields and forms

**Anatomy:**
- Label above the field (13 px/500 `--reg-text-2`), then the field, then help text (13 px `--reg-text-3`), then the error.
- The field uses a `--reg-raised` fill, a 1 px `--reg-edge` border, a 3 px radius, is at least 44 px tall, and uses 15 px text. On coarse pointers the text is 16 px, so iOS does not zoom the page on focus [inferred from known iOS behaviour].

**Variants:**
- text, textarea, select (native, following the register's colour scheme)
- number stepper: ↑ ↓ ±1, Shift ±10, with visible − and + buttons, as in the reference
- date field: shows "Sat 5 Jun 2027" beside the native control, so the result does not depend on the laptop's locale
- combobox (for example, storage locations)
- checkbox and radio (the desk's cream and ink)
- segmented control (§3.16)

**States:**
- focus (the register's focus ring; the border does not change colour)
- invalid (brick text and brick border plus an icon)
- disabled (with the reason visible)
- read-only (rendered as a facts view, not as greyed-out inputs)
- autosaved ("Saved 14:02" in text-3)

**Accessibility:**
- `aria-invalid`, `aria-describedby` for help and error, "(required)" in words, and an error summary at the top of long forms.
- Every create, compose or respond area is a `<form>`, so Enter submits and Ctrl/Cmd+Enter submits from a textarea. Today Pipeline, Proposals and the supplier response have neither [audit].

### 3.16 Segmented control and filter chips

**Anatomy:** a pill container at a 999 px radius. Options are 32 px tall with 44 px hit areas. The selected option is filled with forest and uses forest-ink-1 text; the others are ink-2 text. This is used for Day · Week · Fortnight · Month, period presets and density.

**Accessibility:** a radiogroup with arrow keys, or buttons with `aria-pressed` when the options are filters. The selected state is never shown by hue alone: the fill changes luminance.

### 3.17 Data table

**Anatomy:**
- On the sheet, with no card around it.
- A sticky header row in eyebrow caps (ink-2), with a strong rule below.
- Rows 56 px tall (48 compact), 1 px rules between rows, no zebra striping.
- Numbers right-aligned in tabular figures; a totals row in Inter 600 above a strong rule.
- Empty cells show "—" with an accessible name of "none".
- A cell whose text is truncated reveals it fully in an overlay on hover or focus.

**States:** hover (sheet-hover), selected (sheet-selected plus an ink bar), sortable headers.

**Accessibility:** a real `<table>`. Sortable headers are buttons carrying `aria-sort`.

### 3.18 Timeline (history)

**Anatomy:** a dot, a 1 px line, a weight-600 title ("Sent to the client"), the time in 13 px, and any quoted note in italic serif (`EnquiriesDesk.css:627-634`). Entries are written as sentences ("Catherine started the review · 10:14"), never as enum arrows ("DRAFT → SUBMITTED").

**Accessibility:** an `<ol>`, with `<time datetime>`.

### 3.19 Overlays: menu, popover, tooltip, dialog

**Anatomy:** overlay fill `#f7f3e6`, 1 px edge border, 3 px radius, `--house-shadow-overlay`.

**Rules:**
- Tooltips appear on hover **and** on focus, after a 120 ms fade.
- Dialogs are reserved for flows that genuinely need focus isolation, such as the command palette. They use the scrim and trap focus with `useFocusTrap`.
- A dialog never opens another dialog, and a backdrop click never discards unsaved input (`AdminPanel.tsx:63-74`; `EventDetailsPanel.tsx:376-387` [audit]).

**Accessibility:** menus use `aria-haspopup` and Esc. Dialogs are `aria-modal` with a trap, restore focus on close, and close on Esc from anywhere inside.

### 3.20 Keyboard legend and command palette

**Anatomy:** `kbd` keys with a 1 px edge border, a 2 px bottom border, a 4 px radius and 12 px/500 text (`EnquiriesDesk.css:647-656`). The legend lives in the panel's resting state, and `?` opens the full sheet.

**Palette** (Ctrl/Cmd+K):
- Commands, "go to" and search, including search beyond the currently loaded range.
- Arrow-key selection via `aria-activedescendant`.
- Each result shows its shortcut.
- Parses dates ("5 jun 27") to jump to them.

**Keys are suppressed** inside inputs, selects and the planner canvas (the Diary handler does not currently exclude `<select>` [audit, `DiaryBoardPage.tsx:520-529`]).

### 3.21 Activity (existing; the rules of use)

`components/shared/Activity.tsx` stays the only loading and working vocabulary.
- On the ivory register, set `--vv-activity-accent` to copper dot `#c1703f`. The indicator is decorative, and its text carries the meaning.
- The panel capsule uses the house sans, not Geist Mono (`Activity.css:54` [audit]).

### 3.22 Booking block (Diary)

**Anatomy:**
- Line 1: the full-width title.
- Line 2: time · guests.
- Top right: the option numeral ("1st", "2nd") for holds.
- A copper decision-age line when the decision is 7 days away or less.
- The commitment encoding from §2.3.
- Phase bands (Setup · Live · Teardown) distinguished by pattern and luminance, not hue alone, with labels at 11 px or larger where they fit. Today the labels are `font-size: 0` (`diary-board.css:165` [audit]).

**Geometry is data.** No hover or press transform ever touches a block on a timeline. Hover changes only the border and ink, and press is at most `scale(0.995)`.

**Accessibility:**
- The full description goes in the accessible name.
- A styled preview appears on focus or hover in place of the native `title` tooltip.
- Keyboard moves: Space lifts, arrows move 15 min (Shift for 1 min), Enter drops, Esc cancels (`useBoardDrag.ts:199-252` [audit]).

### 3.23 Charts

**Anatomy:**
- A one-sentence serif headline stating the takeaway ("Saturdays in June are 82% held").
- Bar and line charts first.
- Horizontal gridlines only, in the rule colour.
- Axis labels in 12 px ink-3 tabular figures.
- Bars with 0 radius; 1.5 px lines.
- At most four hues (§2.3), labelled directly.
- The tooltip uses the overlay style.

**Accessibility:** every chart has a table view and an `aria-label` summary. No gradients, no 3D, no rings with more than two parts.

### 3.24 Room photograph

**Anatomy:** full bleed across the panel or sheet, 132–200 px tall, `object-fit: cover`, with the fade gradient into the surface (`EnquiriesDesk.css:408-418`). It appears only when the photograph is sourced and the room matches.

**Accessibility:** decorative (`aria-hidden`) when the room's name is shown as text. Otherwise it has alt text naming the room.

---

## 4. Patterns

### 4.1 List and detail beside each other

- At 1180 px and wider, list and panel sit side by side. The panel frame is sticky while its body scrolls. Selecting a row never moves or unmounts the list.
- Below 1180 px they take turns, with "Back to …", and scroll position and selection are restored.
- The selection is kept in the URL (`?view=reviews&review=<id>`, `?view=search&client=<id>`), so reload, the browser's Back button and sharing all work. Today reviews, the client profile and inventory items are held only in component state [audit].
- Opening a record moves focus to the panel heading. Closing it returns focus to the row.
- Adopt this on: Reviews, Pipeline, Proposals, Clients, Loadouts, Admin venues, Onboarding clients, Diary bookings (docked at 1180 px and wider, in place of the fixed 430 px overlay, `diary-board.css:189` [audit]) and Inventory.

### 4.2 Consequences before acting, undo after

| Action class | Examples | Pattern |
| --- | --- | --- |
| External or irreversible | approve or decline (emails the client); send a proposal; withdraw a proposal (the client's link returns 404); approve a layout (emails the planner and hallkeepers); cancel a confirmed booking; delete a venue | Consequence confirmation (§3.11) that names recipients, what is sent, what changes and whether it can be undone |
| Internal and reversible | stage moves within policy, releasing a pencil within policy, notes, reordering, removing a photo (file kept) | One action, then an Undo toast (§3.13) or an in-place change |
| Internal and harmless | start a review ("Only your team sees this stage. Nothing is sent to the client.") | One action, with a consequence hint under the button (`EnquiryPanel.tsx:268`) |

The API already computes consequences the client currently throws away: for example, `resequence.promotedToFirst` on hold release (`routes/bookings.ts:236-240` [audit]). Surface them: "Fraser is now 1st option."

### 4.3 Progress and closure

- **Counts** live on the stat plane, fall as work is done, and are the filters.
- **Paths** in the panel show where each record stands.
- **The stamp** plays on the one chip that changed.
- **Finished states** are real, never decorative:

| Surface | Finished state |
| --- | --- |
| Enquiries | "All caught up" |
| Diary | "Nothing to decide this week" |
| Hallkeeper | "Setup checked · 43 of 43" (room release is still a separate decision) |
| Notifications | "Nothing waiting on you" |
| Event | "Settled" |

- **Dated next steps** (P21): "Follow up Tue 10:00" removes an item from view and brings it back with its reason.
- **Readiness is explained by what blocks it,** never by a percentage ("2 tasks blocked: AV check waiting on access").
- **The day's close** (optional, pending §8) lists what moved and what is scheduled for tomorrow, with no scores.

### 4.4 Keyboard triage

This is one grammar for every high-frequency list: the desk's, applied everywhere.

| Key | Action |
| --- | --- |
| ↑ ↓ / j k | move (focus follows; one Tab stop per list) |
| Home / End | first / last |
| Enter | open beside the list |
| Esc | close, and return to the row |
| `[` / `]` | previous / next period (Diary, Analytics) |
| `/` | focus this surface's search |
| `?` | shortcut sheet |
| Ctrl/Cmd+K | command palette |
| g then a letter | go to a section (g e Enquiries, g d Diary) |
| Ctrl/Cmd+Z | undo the last internal action |

The legend appears in each panel's resting state. `aria-keyshortcuts` is set on the controls that have shortcuts.

### 4.5 Empty, caught-up, error, loading and other states

| State | Rule | Component |
| --- | --- | --- |
| First load | Keep the layout frame; `ActivityStatus` goes where the content will appear (the lede slot, the panel body) | Activity |
| Refresh | Keep the content visible. Put status in a fixed-size slot, shown only after about 400 ms. Never insert rows that shift the layout (`DiaryBoardPage.tsx:721-722` [audit]) | Activity (compact) |
| Range change (Diary) | Keep the room rail and photographs, draw the new axis, and prefetch adjacent ranges. Never blank the board (`useCalendar.ts:77-79` [audit]) | — |
| Failed refresh | Keep the last good data and add a stale notice with Retry | Notice |
| First-load error | Plain sentence, what is unchanged, Retry, and a way back | State message |
| Empty, first run | A fact, where items come from, and one action | State message |
| Empty, filtered | "No declined enquiries", [Show all] | State message |
| Caught up | Seal, "All caught up", one factual line | State message |
| Denied | Name who grants access and offer the one permitted next step; branch on HTTP status, never on string matching | State message |
| Offline | Say what is kept on the device and when it will be sent. Say it only where that is true (the event-day queue, `lib/event-day-offline-queue.ts`) | Notice |
| Route arrival | A light arrival variant naming the destination ("Opening the Diary…"). No 108 px "Workspace" headline, no dark interstitial (`RouteArrival.tsx:36`; `RouteArrival.css:64-92` [audit]) | Activity panel |

### 4.6 Forms

- Wrap every form in `<form>`. Enter submits; Ctrl/Cmd+Enter submits from a textarea.
- Pre-fill everything known, and state where it came from ("From enquiry received 24 Sep").
- Validate on blur and on submit, never on each keystroke. Put errors beside their field, in venue language ("Enter a price of £0 or more", not "non-negative number"; "Add a decision date", not "A hold requires decisionAt…" from `booking.ts:146-151` [audit]).
- Offer presets where people repeat themselves: reason chips (Stocktake · Damaged at event · Repaired · Purchased · Disposed); due chips (Tomorrow 09:00 · Next Monday · Pick a date); period presets (Next 7 days · This weekend · Next 30 days · Custom).
- Guard unsaved work (`useUnsavedChanges`, generalised from `InventoryNavigationGuard.tsx`) on view change, sign-out and backdrop clicks.
- Hide actions that a person's role cannot use, or show them read-only with "Only venue admins can change this". Never show a form that can only fail with a 403 (planners in Venue settings, for example [audit]).

### 4.7 Dates, times, money and numbers

All formatting comes from `lib/venue-time.ts` and `lib/money-format.ts`, always in the venue's zone. There are no locale-less `toLocale*` calls: the audits found 9 of them, and a committed baseline shows "6/18/2026, 1:00:00 PM".

| Context | Format | Example |
| --- | --- | --- |
| Date tile | weekday / day / month, year only if it differs | SAT · 5 · JUN '27 |
| Inline date | short weekday, day, short month, year only if it differs | Sat 5 Jun 2027 · Sat 5 Jun |
| Panel and accessible name | full, plus lead time | Saturday 5 June 2027 · in 8 months |
| Time | 24-hour, venue-local (the client-document format is pending §8) | 19:30 |
| Range | en dash; next day marked | 18:00–23:00 · 22:00–01:00 (Sun) |
| Moment | no seconds | 18 Jun, 13:00 |
| Age | relative for 7 days, then a date | 2 hours ago · yesterday · Tue 3 Sep |
| Time zone | never show the IANA name; show "UK time" only when the device's zone differs | — |
| Money, total | £, thousands separator, pence only when non-zero | £4,750 · £4,750.50 |
| Money, quote and invoice lines | always 2 decimal places, tabular, right-aligned | £1,200.00 |
| Negative | true minus sign | −£250 · −10 |
| VAT | labelled; consumer totals include every mandatory charge (DMCC Act 2024) | £5,400 inc VAT |
| Counts | pluralised properly; never "(s)"; unknown stated in words | 1 enquiry · 2 enquiries · Guests not given |
| Percent | whole number, with meaning | Booked 42% of this week |
| Phone and email | `tel:` and `mailto:` links | — |

### 4.8 Copy voice

Plain, factual, British, in the venue's own vocabulary. No praise.

**Rules:**
- **Case and spelling.** Sentence case everywhere, including the nav: "Pending reviews", "Sign out" [audit, `DashboardLayout.tsx:38-53, 77`]. British spelling (colour, organise, cancelled).
- **Buttons.** A verb plus an object. Add "…" when the button opens a confirmation. Name the consequence when something leaves the building ("Decline and email").
- **Tone.** No exclamation marks, "oops", "Almost", "we", "Great job", or emoji.
- **Failures** say what did not happen, what is unchanged, and the next step.
- **Consequences** name people and addresses.
- **Caveats** are stated once, where the action is: "Numbers are planning estimates; the events team confirms them." Do not repeat them per panel; Event Architect shows six today [audit].
- **Machine text never appears:** no enum values, slugs, UUIDs, hashes or HTTP codes. Reference codes go in a quiet footer in `--house-mono` for support calls.

**Before and after** (the "before" examples come from the audits):

| Before | After |
| --- | --- |
| "Failed to approve" (toast) plus an inline error | "Approval didn't save. The layout is still waiting for review." [Retry] (inline only) |
| "GBP 4,750.00" | "£4,750" |
| "Comfort status review_required; 2 review gate(s)." | "Needs review: 2 checks outstanding." |
| "Guest count pending guests" | "Guests not given" |
| "Working..." | "Deleting the venue…" |
| "Almost — just needs a valid email address" | "Enter an email address, for example name@example.com." |
| "The requested view \"admin\" is held back…" | "Admin is for Venviewer platform administrators." [Back to Enquiries] |
| "Server returned an unexpected response shape for GET /calendar?…" | "The Diary couldn't be read just now. Nothing has changed." [Try again] |
| "Generate client link" (it actually sends the proposal) | "Send to client…" with a consequence line |
| "Client link — sent" (nothing is emailed) | "Link ready. Not emailed; copy it into your message." |

**Vocabulary (pending Blake, §8).** Each term is decided once and applied everywhere through `lib/status-vocabulary.ts`.

| Internal term | Proposed display term |
| --- | --- |
| submitted / under_review / rejected | New / In review / Declined (the desk's words) |
| pencil / hold, rank | Provisional · 1st option · 2nd option · Joint 1st |
| ink | Confirmed |
| Configuration | Layout |
| Pending reviews | Layout sign-off |
| Reference loadouts | Standard set-ups |
| Handoff pack / BEO | Function sheet |
| Pick lines | Furniture to collect |
| Room flip | Changeover |
| Mission Control | Live running order |
| Laser / Showcase / Surface | Draw notes / Walk-through / Overview |
| Occupancy footprint | Setup to breakdown |

### 4.9 Notifications and interruption

- **Tier 1, interrupt:** a clash, an event-day urgent issue, a client who has signed, approved or paid.
- **Tier 2, periphery:** the bell count and stat-plane counts. No pulsing and no red.
- **Tier 3, digest:** everything else, at times each person chooses (default 09:00, 13:00 and 16:30, pending §8).
- The notification feed moves out of "More" (`DashboardLayout.tsx:226` [audit]) into a header control. Items are grouped by record, carry venue-time stamps, and offer "Mark all read". The feed refreshes on focus. It ends with "Nothing waiting on you".
- Sound is off by default. At most two quiet cues are offered as an option, and always alongside a visible state.

### 4.10 Wayfinding

- `document.title` names the view, the venue and Venviewer. Today staff tabs show the public title or "Sign in - Venviewer" [audit].
- One h1 per view, in display-l, and focus moves to it on a view change.
- The nav slot names the current place, even for views inside More.
- The wordmark goes to the role's home.
- Every email link resolves to a real route. For example, `/dashboard/reviews/:id` (`configuration-reviews.ts:474`) falls through to the homepage today [audit].

---

## 5. Surfaces that may differ, and how they stay one product

### 5.1 Public marketing (`/`, `/fresh` and `/editor`, pricing, legal)

**May differ in:**
- ground and darkness (the warm-black homepage body, the sandstone paper of `/fresh`);
- display type (Fraunces with Geist, as `site.css` loads);
- scroll choreography and cinematic pacing;
- the depth of editorial storytelling.

**Must share:**
- the wordmark drawing;
- the button form (3 px radius, cream on dark, forest on light);
- the warm-metal accent family, with no cyan (brass or copper is pending §8);
- the focus rule (ink on light, cream on dark, 3:1 or better, with no global cyan halo underneath; `fresh.css:90-94` resets only the outline today [audit]);
- no spring hover;
- sourced photography;
- the voice (§4.8);
- British formats;
- the Activity component;
- venue identity from data, never a hard-coded "Trades Hall" (`GuestEnquiryModal.tsx:254, 596` [audit]).

**Also:**
- Staff links (Dashboard, Diary, Hallkeeper) leave public headers for a single "Staff sign in" (`RoomsHomePage.tsx:141-147`; `FreshPage.tsx:661-666` [audit]).
- Pricing moves off the black-and-gold look (`PricingPage.tsx:19-28` [audit]) into the family, and removes claims it cannot keep.
- The `/demo` deck sells the desk, so it uses the desk's type (Newsreader and Inter).

### 5.2 The 3D planner

**May differ in:**
- the canvas, which follows the capture's own lighting;
- a darker chrome over the scene;
- pill mode switches;
- 650 ms cinematic camera easing;
- dense precision tools for staff.

**Must share:**
- The chrome uses the **forest register**: opaque panels at 94% opacity or more, cream primary, forest-ink text, the forest-edge boundary, the house type scale with a 12 px floor, and Newsreader for room and panel names.
- Lists (the furniture catalogue, the layers list) sit on ivory insets.
- One next step, pinned in the forest decision panel ("Send to the {venue} events team" / "Submit for approval").
- A facts band on the copper plane: Guests · Seats · Tables · Comfortable capacity.
- The keyboard legend under `?`.
- Undo on every destructive action ("Clear" drawing currently has none: `markup-store.ts:211-219` [audit]).
- Loch and heather keep their reserved meanings: simulated or estimated, and AI-proposed.

**Also:**
- Brass cannot survive on ivory (1.95:1), so planner accents become copper or forest.
- `user-select: none` is limited to the canvas stage (`App.css:19-37` [audit]).
- The 2D blueprint uses the ivory register inside the same shell and drops its fake macOS window dots (`BlueprintPage.tsx:872-880` [audit]).

### 5.3 Print, PDF and email

- **Print** (function sheets, proposals, handoff): white paper, ink text (14.13:1), Newsreader headings, copper hairlines, no planes or tilts, and chips drawn as outlined labels. Every text element gets an ink colour in `@media print`. Today's handoff print would render near-white headings, 1.13:1 [audit, inferred].
- **Email:** an ivory header band, a serif heading (with a Georgia fallback for mail clients), a forest button with cream text, and the same facts order as the panel.

### 5.4 Event day in dim rooms (pending §8)

An optional whole-sheet switch to the forest register for use in darkened halls. Components carry over unchanged, because they read `--reg-*` tokens.

### 5.5 Trades House campaign (quiz, leaflet)

The quiz and leaflet keep the guild's heraldic navy and gold, and its fonts (`quiz.css`: Cinzel, Cormorant Garamond, EB Garamond), pending Blake's confirmation that this is the Trades House's own brand. The calm-motion and focus rules still apply. The global spring currently overrides the quiz's own hover [audit, `TradesHouseCraftQuizPage.css:325-329`].

### 5.6 What makes every surface one product

1. The same focus law.
2. The same motion law: no hover transforms, press-only, reduced motion honoured.
3. The same Activity vocabulary.
4. The same voice and British formats.
5. The same wordmark.
6. The same warm-metal family, with no cyan.
7. Real photography.
8. One next step in a fixed place.
9. Nothing that looks like hard work.

---

## 6. Global changes needed

| # | Change | Where | Do | Risk | Mitigation and verification |
| --- | --- | --- | --- | --- | --- |
| G1 | **Remove the spring hover** (scale(1.06) + brightness(1.15), press 0.93, overshoot, `!important` transition) | `index.html:95-113` [inspected] | Delete the `@media (prefers-reduced-motion: no-preference)` block. Move calm press and hover into `styles/workspace.css`. Delete `[data-calm-controls]` (`EnquiriesView.tsx:514`, its only use). Keep the reduced-motion killswitch below it. | Low. No test depends on 1.06 [audit, grep]. Planner, quiz and cockpit buttons lose feedback they have today until their own press rules land. The `!important` transition currently hides the header nav's 140 ms transition on `<button>` items (`DashboardLayout.css:37`), so those items will change behaviour. | Ship with the workspace press rules. Re-run the dashboard, operational and public visual specs. Manual pass on the planner and quiz. |
| G2 | **Remove the gold cursor** | `index.html:77-79` | Delete. If Blake wants it kept in the planner, scope it to `.venviewer-planner-shell`. | Low. It also restores the I-beam over selectable text [inferred]. | Visual check on one staff route and the planner. |
| G3 | **Remove the gold scrollbar** | `index.html:138-168` | Delete, including the Firefox `*` rule. Scrollbars follow `color-scheme` per register (native). The forest panel keeps its own `scrollbar-color` (`EnquiriesDesk.css:399`). | Medium. It changes every scrollbar at once, including the planner's. A dark 3D chrome needs `color-scheme: dark` on its register, or native bars turn light. | Set registers in the same change; screenshot the planner, Diary and desk on Windows Chrome and Firefox. |
| G4 | **Register-aware focus ring** | `global.css:42-54`; `house-tokens.css:79` | `outline: 2px solid var(--reg-focus, var(--vv-focus)); outline-offset: 2px; box-shadow: none`. Keep `--vv-focus` as the fallback for unmigrated dark surfaces (10.5:1 on dark forest [audit]). Remove per-surface patches (`DashboardLayout.css:41-42`, `InventoryStyle.css:106-107`, `EnquiriesDesk.css:84-90`) as each surface migrates. | Medium. Every focus ring in the app changes, and the halo disappears. `house-tokens.test.ts:132` pins `--vv-focus`, so keep its value. `accessibility-route-audit` checks only that an outline exists [audit]. | Add a Playwright ring-pixel contrast check (§7.5); tab through each migrated route. |
| G5 | **Canvas and colour scheme** | `global.css:6, 10-21` (html and body use `--vv-ink`; `color-scheme: light dark`) | Registers set `color-scheme`. The staff shell paints the canvas sage (`html:has(.ws-shell)` or equivalent) so overscroll and gaps never flash black [inferred]. | Medium. Dark routes (planner, twin, pricing) depend on the dark body, and text without a set colour follows the OS scheme (`ClientSearchView`, `ClientProfile` [audit]). | Scope to the shell only; give every migrated text element an explicit colour. |
| G6 | **Route-aware boot and arrival** | `index.html` inline script (lines 22-30 already branch on path [audit]); `Activity.css:3-11`; `RouteArrival.*` | Staff paths get an ivory boot capsule (Newsreader label; `site.css` is already linked at `index.html:15`) and a light arrival naming the destination. | Low to medium. `src/__tests__/activity-convention.test.ts:199-205` pins first paint [audit]. | Update the test with the new variant; keep reduced-motion behaviour. |
| G7 | **Fonts** | `site.css`, `cockpit.css`, `quiz.css`; `router.tsx:13-65` | See the table below. | See the table below. | `self-host-google-fonts.mjs` and `provenance.json` regenerate the stylesheets; `startup-guardrails.test.ts:52` pins the `site.css` link (keep it). |
| G8 | **Delete dead and legacy grammar** | `global.css:145-169` `.vv-status-chip` (0 consumers [audit]); `.vv-state-panel` / `.vv-button` (`:72-110`) | Delete the chip now. Mark the panel and button legacy until `DashboardPage`, `ProtectedRoute` and `EditorPage` move to the state message. | Low | Grep for consumers before deleting. |
| G9 | **Default workspace ground** | `DashboardLayout.css:92` (`#132b25` under every view except enquiries, inventory and diary) | Make `surface` a register chosen per view; migrate view by view. | **High if flipped all at once.** Analytics headings and the Reviews "← Back" link paint light text directly on the ground [audit]. | Flip per view, each with baselines. |
| G10 | **Toasts, badges and confirmations** | `ToastContainer.tsx`, `toast-store.ts`, `StatusBadge.tsx`, `ConfirmModal.tsx` | Replace with Undo toast, notice, status chip and consequence confirmation. Remove duplicated toast-plus-inline errors. | Medium. 69–94 call sites [audit]. | Migrate file by file; delete the old modules after their last consumer is gone. |
| G11 | **Navigation labels and order** | `DashboardLayout.tsx:38-53`; `DashboardLayout.test.tsx:82` pins "no top-level Enquiries" [audit] | Sentence case now. Role-shaped top level after Blake decides (§8). | Low for casing (update tests that query by name); the test change needs Blake's call. | Unit tests plus a nav baseline. |

**Fonts: keep or retire**

| Family | Loaded by | Decision | Risk |
| --- | --- | --- | --- |
| Newsreader | `site.css`, on every route (`index.html:15`) | **Keep.** House serif for staff and client surfaces; the wordmark (pending §8) | Low; already loaded everywhere |
| Inter | `cockpit.css` via `cockpitImport` (`router.tsx:13, 63-65`). Staff routes such as the Diary, Day Board and Event Architect are `lazyWithPreload` without `cockpitImport` (`router.tsx:107, 162, 182`) and receive Inter through the `cockpitImport`'d Clerk provider (`:78`) [inferred] | **Keep.** House sans. Split it into its own stylesheet so staff routes stop pulling Playfair | Medium: if the split is wrong, a staff route renders in the system sans. Verify with `document.fonts` on each staff route |
| Geist Mono | `site.css` | **Keep** for reference codes and the homepage measurement line only. Remove from the Activity capsule | Low |
| Fraunces, Geist | `site.css` | **Keep** for public editorial only | Low |
| Playfair Display | `cockpit.css` | **Retire** after the planner, pricing, hallkeeper states and ChairCountDialog move off it. It is also the accidental fallback for Cormorant | Medium: many inline styles in the planner [audit] |
| Cinzel, Cormorant Garamond, EB Garamond | `quiz.css` (`router.tsx:15-17, 47`) | **Keep for the quiz only** (pending Blake). Remove Cormorant from `ProposalPage.tsx:27` and `SupplierPortalPage.css:60, 172, 397`, where it is requested but never loaded [audit] | Low |
| Georgia (system font) | not loaded; named in about 55 files [audit] | **Retire** as a chosen face; it survives only as a fallback in `--house-serif` | Low. It renders differently per device, and the Linux container captures a substitute [audit, inferred] |
| JetBrains Mono, Segoe UI/Arial stacks | not loaded (`BlueprintPage`, `/demo`, walkthrough) | **Retire** on product surfaces | Low |

---

## 7. Migration plan

### 7.1 Modules to create

| Path | Contents | Extracted from |
| --- | --- | --- |
| `packages/web/src/styles/house-tokens.css` (extend) | Workspace palette primitives (§2.2), spacing, radii, motion, shadows, z-index | `EnquiriesDesk.css:10-47`; `InventoryStyle.css:4-6, 74` |
| `packages/web/src/styles/workspace.css` (new; `@import` in `global.css` after `house-tokens.css`) | Register semantics; base element rules; focus; press and hover laws; reduced motion; `::selection`; print base | `EnquiriesDesk.css:84-91, 662-675` |
| `packages/web/src/components/workspace/workspace-components.css` | `.ws-*` component classes | `EnquiriesDesk.css:103-656`; `InventoryStyle.css` (planes, correction pane, numerals) |
| `components/workspace/WorkspaceSurface.tsx` | Register root, ground, ground plane, sheet-plus-panel grid, single-column mode | `.enq-desk` |
| `components/workspace/Sheet.tsx` | `Sheet`, `PageHeader`, `Lede` | `.enq-sheet`, `.enq-head`, `.enq-summary` |
| `components/workspace/StatPlane.tsx` | Counts as filters (band or block) | `EnquiryStages.tsx`; `.inventory-impact` |
| `components/workspace/Ledger.tsx` | `Ledger`, `LedgerGroup`, `LedgerRow` | `EnquiryLedger.tsx` |
| `components/workspace/DateTile.tsx` | Date tile | `.enq-date` |
| `components/workspace/StatusChip.tsx` | Chip, dot, stamp | `EnquiryStages.tsx:18-22`; `.enq-chip` |
| `components/workspace/DecisionPanel.tsx` | `Panel`, `PanelBar`, `RoomPhoto`, `PanelSection` | `EnquiryPanel.tsx`; `.enq-panel*` |
| `components/workspace/Facts.tsx`, `Path.tsx`, `Timeline.tsx` | Facts row, progress path, history | `.enq-facts`, `.enq-path`, `.enq-timeline` |
| `components/workspace/Button.tsx` | primary, quiet, text, destructive trigger, icon | `.enq-cta`, `.enq-quiet`, `.enq-button`, `.enq-close` |
| `components/workspace/ConsequenceConfirm.tsx` | Inline confirmation | `EnquiryPanel.tsx:314-387` |
| `components/workspace/Notice.tsx`, `UndoToast.tsx` + `packages/web/src/stores/notice-store.ts` | Notices; the single toast | `.enq-notice`; Diary `UndoToast` |
| `components/workspace/StateMessage.tsx`, `Seal.tsx` | The state kinds (§3.14) | `.enq-empty`; `EnquiryOverview.tsx:114` |
| `components/workspace/Field.tsx`, `SegmentedControl.tsx`, `DataTable.tsx`, `KeyLegend.tsx` | Forms, segmented control, table, keyboard legend | `.enq-confirm textarea`; inventory fields; `.enq-keys` |
| `components/workspace/CommandPalette.tsx` (later) | Ctrl/Cmd+K | Diary `BoardPalette.tsx` [audit] |
| `packages/web/src/lib/venue-time.ts` | Date parts, lead time, venue moment and date, relative age, received groups; re-exports `VENUE_TIME_ZONE` | `enquiry-desk-format.ts:78-305`; `pages/diary/lib/board-time.ts` |
| `packages/web/src/lib/money-format.ts` | `formatPounds`, line-item format, VAT labels | new (exact minor units, as `services/money.ts` does server-side) |
| `packages/web/src/lib/status-vocabulary.ts` | Label and tone per record type and state | `enquiry-desk-format.ts:12-47` |
| `packages/web/src/lib/phrasing.ts` | Plurals and count phrases | `enquiry-desk-format.ts:54-63` |
| `packages/web/src/lib/describe-failure.ts` | `ApiError` → a plain sentence plus "what is unchanged" | new; replaces 39 `error.message` renderings [audit] |
| `packages/web/src/hooks/use-list-triage.ts` | Roving focus, keys, focus return | `EnquiryLedger.tsx:33-70` |
| `packages/web/src/hooks/use-unsaved-changes.ts` | Guard for navigation, sign-out and backdrop | `inventory/InventoryNavigationGuard.tsx` |
| `packages/web/src/hooks/use-document-title.ts` | Per-view titles | new |
| `packages/web/src/__tests__/workspace-tokens.test.ts` | Contrast matrix for every allowed pair in §2.3 and §2.4 | modelled on `house-tokens.test.ts` |
| `packages/web/src/__tests__/workspace-conventions.test.ts` | Source scans (§7.5) | modelled on `startup-guardrails.test.ts` |

`components/workspace/` does not exist today [inspected], and none of the proposed file names collide with existing `hooks/`, `lib/` or `stores/` entries [inspected].

### 7.2 Phases

Each phase ends with its checks passing and baselines recaptured. It is then committed and deployed under the shipping contract, with Blake's verdict recorded separately.

**Phase 0 — tokens and tests, no visual change.**
- Add the primitives, the registers and `workspace.css`.
- Alias `--enq-*` to `--house-*` inside `EnquiriesDesk.css`. The values are identical, so the desk should be pixel-identical.
- Add `workspace-tokens.test.ts`.
- Exit criterion: desk baselines unchanged.

**Phase 1 — global cleanup.**
- G1–G5 and G8. Shell tokens and a persistent layout route.
- `document.title`; focus moves to the h1; sentence case.
- Exit criteria: no spring on any route; focus contrast of 3:1 or better on ivory and forest; no dark flash when arriving on a staff route.

**Phase 2 — extract components from the desk.**
- Re-implement the desk on `components/workspace`.
- Apply the desk-internal fixes (§2.12) as intended, captured differences.
- Exit criteria: the desk is visually unchanged apart from those fixes; all desk unit tests and the Playwright paging and triage spec pass.

**Phase 3 — shared replacements.**
- `StatusChip` for `StatusBadge`; `Notice` and `UndoToast` for `ToastContainer`; `ConsequenceConfirm` for `ConfirmModal` and `NoteModal`.
- `venue-time`, `money-format`, `status-vocabulary` and `describe-failure` adopted everywhere they are imported.
- Exit criterion: the old modules have no consumers left and are deleted.

**Phase 4 — surfaces,** in Blake's order (`product-experience.md`, "Next surfaces"):
1. **Inventory:** mostly a token swap, the closest to the reference.
2. **Diary:** holds encoding, docked detail panel, go-to-date, tray.
3. **Hallkeeper and event day:** Day Board, event sheet, ops board together with Mission Control, handoff and print.
4. **Sales:** Pipeline, Proposals, Clients and profile, Reviews.
5. **Operations and admin:** Analytics, Settings, Admin, Onboarding, Loadouts, Event Architect.
6. **Shared states:** denied, error boundary, route arrival, access check.
7. **Client-facing:** proposal page, supplier portal, client event page, email templates, print.
8. **Planner chrome:** forest register, facts band, one tool bar.
9. **Public alignment:** focus, spring, fonts, staff links, pricing.

### 7.3 Adoption checklist, per surface

1. Wrap the surface in `WorkspaceSurface` with the correct register. Delete its own ground and dark-panel styles.
2. Replace literal colours, radii, shadows and font families with tokens. Move inline style objects into `.ws-*` classes, because inline styles cannot express `:focus-visible`, hover gating, media queries or reduced motion.
3. Use shared components: sheet, stat plane, ledger, panel, buttons, confirmations, notices, state messages.
4. Put the selection in the URL. Add keyboard triage, the h1, and the document title.
5. Route every date, money value and status through the shared libraries. Remove raw enum values and `toLocale*` calls.
6. Remove success toasts. Put errors beside their cause.
7. Hide actions the role cannot perform.
8. Recapture desktop (1440 × 900), tablet (820) and phone (390) baselines for its states: ready, empty, caught up, error, denied, and the key decision.
9. Run a task benchmark before and after (P31). Record Blake's verdict as a separate step.

### 7.4 Guardrails

`workspace-conventions.test.ts` runs as source scans over migrated directories, with an allowlist that shrinks as surfaces migrate. It checks for:

- no `transform` or `filter` inside `:hover` rules;
- no hex literal outside `house-tokens.css` (legacy allowlist aside);
- no `font-size` below 12 px, except the date tile's 11 px caps;
- no Georgia, Playfair, Cormorant or JetBrains named in migrated CSS or TSX;
- no `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString` or `new Intl.DateTimeFormat` outside `lib/venue-time.ts`;
- no `replace(/_/g` in rendered copy;
- no praise copy or `!` in UI strings;
- no `outline: none` without a replacement.

In the browser (Playwright):
- focus-ring pixel contrast of 3:1 or better on each migrated route;
- a run with reduced motion enabled;
- 200% zoom and 320 px reflow;
- a keyboard-only triage run on each list.

### 7.5 Risks

| Risk | Mitigation |
| --- | --- |
| The desk changes shape during extraction | Phase 2 keeps the old and new versions side by side until baselines match |
| Stale baselines hide regressions (`desktop-supplier-denied` and `desktop-admin-create-venue-error` show retired UI [audit]) | Recapture or retire them before redesigning their surfaces |
| Committed baselines use mocked states that the real state machines cannot produce (the Reviews four-button baseline [audit]) | Baselines use real transition sets |
| Role and API mismatches surface as design dead ends (for example, Pipeline shown to venue admins that the API refuses) | Fix the capability map when each surface migrates |
| Inter delivery changes when `cockpit.css` is split | Check `document.fonts` on every staff route |

---

## 8. Decisions needed from Blake

1. **Navigation.** Should Enquiries (and Pipeline and Proposals for sales staff) sit in the top bar, with the top bar varying by role? Today a test deliberately keeps Enquiries under More (`DashboardLayout.test.tsx:82`).
2. **Wordmark.** Should VENVIEWER be set in Newsreader capitals, replacing Georgia?
3. **Diary vocabulary.** Should the Diary use "Provisional · 1st option · 2nd option · Confirmed", or "Pencil · Ink"? And should confirmed bookings become dark forest blocks, so a firm week visibly fills in?
4. **The planner.** Should its chrome use the forest register over the room? Should anything of the gold cursor, scrollbar or brass survive there?
5. **Density.** Should there be a per-person compact option (about 60 px rows) for heavy days, or one comfortable layout for everyone?
6. **Long reading on forest.** May long text (the client's message, notes, drafts) sit on a pale "letter" inset inside the forest panel, as the AI drafts already do?
7. **Toasts.** Should there be one bottom-left forest capsule with Undo, used only for undoable actions, or no toasts at all?
8. **Notifications.** Is a quiet copper count on a bell in the header acceptable, and which events should reach people at all?
9. **Dim mode.** Should the event-day and hallkeeper tools offer a forest-register mode for darkened halls?
10. **Time in client documents.** "19:30" or "7.30pm"?
11. **Public accent.** Should marketing move from brass to copper, so the family reads as one?
12. **AI marker.** A muted heather colour, or a glyph alone?
13. **Sound.** None at all, or an optional soft cue when a contract is signed?
14. **Desk touches.** Keep the first-name greeting and the session tally, or remove them?
15. **Trades House campaign.** Should the quiz and leaflet keep their separate heraldic brand?

---

## 9. Limits of this specification

- **Nothing here has been rendered.** No new token or component was tested in a browser. Contrast values are computed from hex pairs; translucent values are composited by calculation.
- **Some audit references were not re-read by me.** `file:line` references marked [audit] come from the 26 September audits.
- **Research sources.** Research citations come from the four research briefs. Where a brief could not re-fetch its source (Superhuman practice, the peak–end rule, the constants behind Inter's metrics), the claim is marked [recalled] and should be treated as a lead.
- **Assumed viewing conditions.** Visual-angle figures assume Inter's metrics on a 24-inch 1080p monitor at 60 cm. Trades Hall's actual devices and viewing distances should be measured before the type floor is final.
- **Colour psychology** (P33) is a hypothesis to test, not a law.
- **Aesthetic acceptance belongs to Blake alone,** and qualification on physical devices remains open.