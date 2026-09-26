This research turns the psychology, ergonomics and game design of all-day professional tools into 40 testable design rules for Venviewer, and closes with 12 questions for Blake. The strongest findings are:
- **Read on light, decide on dark.** Dark text on light paper is easier to read for younger and older eyes alike.
- **Size text by viewing angle.** Much of the app's text is below comfortable reading size.
- **Show honest progress and close open loops.** Real counts that fall, a real finished state, and dated plans for work that cannot finish now.
- **Game design without gamification.** Clear goals, fast keyboard control and one restrained acknowledgement per decision, with no points, badges or praise.
- **Beauty only lasts if the tool is genuinely easy.** Every polish pass needs a task measurement alongside it.

## Scope, method and evidence status

- **Brief read:** `.claude/conventions/product-experience.md` (Blake's supreme principle, lines 5–28, and his decisions, lines 30–36) and the desk record `docs/design/enquiries-desk-2026-09-24/README.md`.
- **Images viewed:**
  - `desk-overview.webp` and `desk-open-enquiry.webp`;
  - the selected reference `docs/design/references/venviewer-selected-inventory-2026-09-06.png`;
  - two older baselines: `packages/web/e2e/dashboard-state-visual-performance.spec.ts-snapshots/desktop-executive-analytics-success-chromium-linux.png` and `packages/web/e2e/operational-state-visual-performance.spec.ts-snapshots/desktop-ops-handoff-ready-chromium-linux.png`.
- **Code inspected:** `EnquiriesDesk.css`, `index.html`, `src/global.css`, `src/styles/house-tokens.css` and the font stylesheets.
- **Nothing was run** against the app: no servers, no tests and no file edits.
- **Measured by me:**
  - WCAG contrast and luminance of palette tokens, with the standard formula in Python;
  - visual angle of text sizes, for Inter at 60 cm on a 24-inch 1920×1080 monitor, taking Inter's x-height as 0.546 em (an assumption) and cap height as 0.727 em;
  - grep counts of font-size declarations.
- **Blocked pages:** WebFetch could not open nngroup.com, ncbi.nlm.nih.gov (including PMC) or blog.superhuman.com. Claims from those sources rest on search-result summaries and are marked where relevant.
- **What this is not:** inferences are labelled. Nothing here is a verdict on beauty. Blake remains the judge.

## What the reference desk already gets right

The desk already follows much of the research. Keep these as the pattern for other surfaces:
- **Palette tokens** hold AA contrast on their surfaces (`EnquiriesDesk.css:9-47`).
- **Focus** is an ink ring on ivory and a cream ring on forest (`EnquiriesDesk.css:84-91`).
- **Prose width** is capped at 60ch (`:121`).
- **Large light numerals** use weight 300 at 30–42px (`:174-176`).
- **One restrained reward:** the 320 ms stamp (`:228-232`).
- **Hover** is gated to fine pointers (`:662-669`), and reduced motion removes all transforms (`:671-675`).
- **Primary buttons** are 48px tall (`:531`).
- **Keyboard triage** works in the list (`EnquiryLedger.tsx:35`) and the panel (`EnquiryPanel.tsx:76-103`, with `aria-keyshortcuts`).
- **Closure:** "All caught up" (`EnquiryOverview.tsx:106`).
- **Consequences are named** before any email goes (README lines 64–66).

## Where the rest of the app diverges (inspected)

**1. Global hover pop.** `packages/web/index.html:96-113` still scales every button to 1.06 and brightens it on non-homepage routes. Only `[data-calm-controls]` opts out. Blake has already decided to remove this.

**2. Global focus ring.** It uses `--vv-focus: #87e7f0` (`house-tokens.css:79`, `global.css:51`).
- My computation gives 1.22:1 against the desk ivory #f2eddd; the brief said about 1.4:1.
- Either way it is below the 3:1 a focus indicator needs.

**3. Dark reading surfaces.** Executive analytics and the Ops handoff pack (the baseline PNGs above) are fully dark, with:
- cyan uppercase labels of about 11–12px;
- identical boxed stat cards;
- raw values such as "GBP 4,750.00" and the enum "review_required" visible in the copy.

These break several rules below: R1 (reading on dark), R10 (vocabulary and formats) and R35 (complexity).

**4. Small type.**
- Across `packages/web/src`, px-valued `font-size` declarations split as follows (px only; rem and clamp are not counted, and some may be print or 3D chrome):

  | Size | Declarations |
  | --- | --- |
  | under 12px | 268 |
  | 12–13.9px | 299 |
  | 14px and over | 297 |

- Inline TSX `fontSize` values under 12 number 103.
- The heaviest files are `TradesHouseCraftQuizPage.css`, `diary/diary-board.css`, `hallkeeper-sheet.css` and the cockpit CSS.
- Even the desk sets its date-tile weekday and month at 10.5px (`EnquiriesDesk.css:302`).

**5. Font families.**
- `site.css` loads Fraunces, Geist, Geist Mono and Newsreader.
- `cockpit.css` loads Inter and Playfair Display.
- `quiz.css` loads Cinzel, Cormorant Garamond and EB Garamond.

**6. Luminance contrast between the two desk surfaces.** The ivory sheet has relative luminance 0.85 and the forest panel 0.047, a ratio of 18:1. Lighting guidance (IES) suggests about 10:1 across the field of view. That guidance is for rooms, so applying it to regions of a screen is an inference to test on real devices, not a rule breach.

## Research synthesis

### 1. Cognitive load and working memory
- **Capacity.** The focus of attention holds about 3–5 chunks, not 7 (Cowan 2001).
- **Split attention.** Placing information that refers to each other far apart raises load; integrating it lowers load (Chandler & Sweller 1992).
- **Expertise reversal.** Guidance that helps novices becomes redundant, even harmful, for experts (Kalyuga et al. 2003).
- **For Venviewer:**
  - at most four deciding facts per decision zone;
  - detail beside the list;
  - pre-fill from the source record;
  - no tutorials on routine staff surfaces.

### 2. Visual fatigue and reading comfort

**Which polarity to read in**
- *Light versus dark.* Dark text on light gave better proofreading and acuity for younger and older adults, whatever the ambient light (Piepenbrock et al. 2013).
- *Why.* Pupils are smaller on light displays, which sharpens the retinal image (2014).
- *Small type.* The advantage is largest for small characters (Human Factors 2014).
- *NN/g's review.* Light mode gives better visual performance for normal vision. People with cataract may do better in dark mode.
- *Counter-evidence.* In young adults, an hour of reading black on white thinned the choroid, a marker associated with myopia, while white on black thickened it (Aleman et al. 2018). This matters mainly for young eyes developing myopia. It argues for a user-chosen dim variant, not for dark reading surfaces by default.
- *Astigmatism.* Industry sources report halation (glowing, blurred letters) for astigmatic readers on dark backgrounds. That evidence is industry-grade, not peer-reviewed.

**Glare and warm paper**
- *No blue-light case.* A Cochrane review found blue-light filtering lenses probably do not reduce eye strain. Warm ivory should therefore be justified by glare, comfort and aesthetics, not by health claims.
- *Off-white.* The British Dyslexia Association style guide recommends cream or off-white over dazzling white.
- *Luminance balance.* IES guidance suggests 3:1 between a task and its immediate surround and 10:1 across the field of view. I read this from secondary sources.

**Type size**
- *Critical print size.* About 0.2 degrees of x-height (Legge & Bigelow 2011).
- *My calculation* for Inter at 60 cm on a 24-inch 1080p monitor:

  | Size | x-height (°) | Cap height (°) |
  | --- | --- | --- |
  | 16px | 0.231 | |
  | 15px | 0.216 | |
  | 14px | 0.202 | |
  | 13px | 0.188 | |
  | 12px | | 0.231 |
  | 10.5px | | 0.202 |

- *Older readers.* With an average age of 70, 14 pt was more legible than 12 pt (Bernard et al. 2001).
- *Comprehension.* It improved up to 18 pt and not beyond (Rello et al. 2016).

**Line length and weight**
- *Line length.* 55 characters per line gave better comprehension than 100 (Dyson & Haselgrove 2001).
- *Weight.* APCA guidance asks thin weights for more size and contrast. APCA is a draft method, used here as a guide, not a standard.

### 3. Density for experts
- **Match density to the task.** NN/g lists four table tasks: find, compare, view or edit one row, and act. Scanning and comparing reward density; inspecting and deciding reward space.
- **Hide complexity, not data.** Bloomberg keeps a dense Terminal but manages hierarchy carefully, and reports that experts are disrupted by small layout changes.
- **For Venviewer:** a user-chosen compact ledger, alongside an airy decision panel. The desk overview shows about 3.5 records in a 900px-tall view by my inspection of the capture; that is comfortable for deciding, slow for a backlog.

### 4. Progressive disclosure, Hick, Fitts and Doherty
- **Progressive disclosure** defers advanced features (NN/g 2006).
- **Clutter without losing power.** Complex-application guidance asks for less apparent clutter without reduced capability, and for in-context cues that help people move to expert methods.
- **Hick, Hyman and Fitts in practice.** In Cockburn's menu model:
  - novices are bound by visual search;
  - experts are bound by Hick-Hyman decision time;
  - Fitts's law governs pointing throughout.

  Hence one primary action, a stable position and generous targets.
- **Response time.**
  - Nielsen's limits (from Miller 1968 and Card 1991): 0.1 s feels instant, 1 s keeps the flow of thought, 10 s holds attention.
  - Doherty & Thadani (IBM, 1982) argued for responses under 400 ms.
  - Superhuman targets 100 ms per interaction.
- **Spatial stability.**
  - Static menus beat adaptive ones (Findlater & McGrenere 2004).
  - Spatially stable command layouts beat menus and the Ribbon for experienced users (Scarr et al. 2012).

### 5. Progress, goal gradient, peak-end and open loops
- **Progress principle.** In about 12,000 daily diaries from 238 workers, the best days were marked by progress in meaningful work (Amabile & Kramer 2011).
- **Goal gradient.** People accelerate as a reward nears (Kivetz et al. 2006).
- **Endowed progress.** Two free stamps raised completion from 19% to 34% (Nunes & Drèze 2006). Because this works, faking progress would be manipulation, so Venviewer counts only real steps.
- **Peak-end.**
  - 69% chose to repeat a longer painful episode that ended less badly (Kahneman et al. 1993).
  - The service translation is to finish strong and get the bad parts over early (Chase & Dasu 2001).
- **Open loops.**
  - The memory advantage of unfinished tasks (Zeigarnik) does not generalise.
  - The urge to resume them (Ovsiankina) does: 66.8% resumption (Ghibellini & Meier 2025).
  - A specific plan removes the intrusive thoughts unfinished goals cause (Masicampo & Baumeister 2011).
  - For Venviewer: dated next steps as a first-class feature.

### 6. Choice overload, notification fatigue, calm technology and flow
- **Choice overload** is real only under some conditions: complex sets, difficult tasks, uncertain preferences and particular decision goals (Chernev et al. 2015).
- **Defaults** strongly change outcomes (Johnson & Goldstein 2003).
- **Interruptions.**
  - Interrupted work gets done faster, but with more stress and frustration (Mark et al. 2008).
  - Batching notifications three times a day improved well-being; hourly batching barely helped; switching everything off raised anxiety (Fitz et al. 2019).
- **Calm technology.** Information should move between the periphery and the centre of attention (Weiser & Brown 1996).
- **Flow** needs clear goals, immediate feedback and a balance of challenge and skill (Nakamura & Csikszentmihalyi 2002).

### 7. Self-determination theory
- **At work,** autonomy, competence and relatedness predict autonomous motivation, performance and wellness (Deci, Olafsen & Ryan 2017).
- **In technology design,** METUX applies these needs (Peters, Calvo & Ryan 2018).
- **For Venviewer:**
  - propose the next move without imposing an order;
  - build competence through honest counts and consequences;
  - build relatedness through factual presence and handoffs, not social chatter.

### 8. Mastery curves and keyboard shortcuts
- **The plateau problem.** Among 251 experienced Word users, shortcuts were used less than 10% of the time, and experience barely predicted their use (Lane et al. 2005).
- **What helps.**
  - Changing menu feedback and cost speeds hotkey learning (Grossman et al. 2007).
  - Revealing all shortcuts while a modifier is held builds rehearsal and spatial memory (Malacria et al. 2013, ExposeHK).
  - Cockburn et al. (2014) survey why users stall at mediocre performance.
- **For Venviewer:** a plain first path, shortcuts printed everywhere, a command palette, and the desk's j/k model extended to every list.

### 9. Game feel and juice, with restraint
- **Game feel** is real-time control, simulated space and polish (Swink 2008). "Juice" is redundant, non-functional feedback (Jonasson & Purho 2012).
- **Evidence for moderation.**
  - With 3,018 players, medium and high juiciness beat none and extreme on all measures, and extreme juiciness reduced play time (Kao 2020).
  - Embellishments raised appeal but raised competence only in some cases (Hicks et al. 2019).
- **Game design, not gamification.** Vohra's principles for Superhuman, from search summaries because the blog was blocked: concrete goals, obvious next actions, robust controls, and clear feedback without distraction.
- **Animated transitions** improve perception of data changes (Heer & Robertson 2007).
- **For Venviewer:** one acknowledgement per consequential change, using several channels at once, and nothing else moving.

### 10. Encouraging through colour, light, rhythm, finish and motion rather than words
- **Why praise backfires.**
  - Imposed games lowered positive affect (Mollick & Rothbard).
  - Badges and leaderboards lowered motivation and exam scores (Hanus & Fox 2015).
  - Expected tangible rewards undermine intrinsic motivation, while informational feedback supports competence (Deci, Koestner & Ryan 1999).

  This supports Blake's view that praise copy is belittling.
- **What works without words.**
  - *Ease itself.* Easy processing produces measurable positive affect (Winkielman & Cacioppo 2001), and aesthetic pleasure follows processing fluency (Reber et al. 2004).
  - *Light and colour.* Brightness raises pleasure and saturation raises arousal; darker colours raise feelings of dominance (Valdez & Mehrabian 1994). Colour-psychology effects depend on context (Elliot & Maier 2014), so treat these as hypotheses.
  - *Nature and scale.* Soft fascination restores attention (Kaplan 1995), and 40-second green views sustained attention (Lee et al. 2015). This supports real room photographs and the sage and forest palette as rest points.

The resulting vocabulary for encouragement:

| Channel | Venviewer use |
| --- | --- |
| Light | bright warm paper |
| Colour | copper only for action, sage for settled, forest for decision and control |
| Rhythm | consistent grouping by day, repeated components |
| Finish | hairlines, engraved-feeling numerals, the seal |
| Motion | settles only on real state change |
| Closure | honest zero states |
| Scale | one sourced room photograph at the decision moment |

### 11. Avoiding patronising experts
- **Expertise reversal:** redundant guidance hurts experts.
- **Stereotype threat:** subtle cues about age lower older adults' cognitive performance (Lamont et al. 2015; d about 0.28–0.32 overall, 0.52 for stereotype-based cues). So: no "simple" or "senior" modes, and larger text offered as a neutral preference.
- **Familiarity:** fluency from familiar forms supports using the industry's own vocabulary and platform conventions.
- **Feedback:** state facts and consequences, never evaluation.

### 12. Pride of use and the aesthetic-usability effect
- **Beauty lifts perceived usability.**
  - Apparent usability tracks aesthetics more than inherent usability (Kurosu & Kashimura 1995).
  - An attractive version was rated more usable and completed faster (Sonderegger & Sauer 2010).
- **But use decides.** After use, real usability drives perceived beauty, not the reverse (Tuch et al. 2012).
- **First impressions** of appeal form within 50 ms (Lindgaard et al. 2006). Complexity and colourfulness predict them (Reinecke et al. 2013/2014).
- **Pride** lives at Norman's reflective level: what the product says about its user. Client-facing outputs are where staff pride becomes referrals.

### 13. Designing for users aged 50 to 75
- **Vision.**
  - Contrast sensitivity, colour perception and near focus decline (W3C WAI).
  - A common estimate is that a 60-year-old retina receives about a third of a 20-year-old's light (secondary source, after Weale).
  - Lens yellowing produces blue-yellow deficits (40% of older participants failed at least one colour test).
- **Motor.** Older adults spend more pointing time on fine corrective movements (Walker, Philbin & Fisk 1997, found only as a citation). Touch cut older adults' movement time by 35%, against 16% for younger adults (Findlater et al. 2013).
- **Pace.** Users 65 and over were 43% slower on websites and markedly methodical (NN/g).
- **How to design for this without looking dated:** the same elegant design for everyone, with:
  - larger default type and higher text contrast;
  - generous targets and no hover-only information;
  - no auto-dismissing messages;
  - familiar conventions, undo, and tablet parity.

## The rules

Each rule states what to do, the evidence behind it, a venue example and how to check it. They are grouped as follows:

| Rules | Theme |
| --- | --- |
| R1–R9 | eyes and reading |
| R10–R17 | attention and load |
| R18–R19 | time and mastery |
| R20–R27 | motivation |
| R28–R31 | calm and forgiveness |
| R32–R33 | expertise |
| R34–R39 | aesthetics and pride |
| R40 | older users |

1. **Read on light, decide on dark.** Text over three lines, tables, forms and timelines go on ivory. Forest holds facts, one decision, actions and photographs.
   - *Evidence:* Piepenbrock 2013 and 2014; NN/g 2020.
   - *Example:* a pale "letter" inset for the client's message inside the forest panel; analytics rebuilt on ivory.
   - *Test:* a DOM audit for text over three lines on backgrounds below luminance 0.2.
2. **Warm paper, never pure white,** and no blue-light claims.
   - *Evidence:* BDA style guide; Cochrane 2023.
   - *Example:* a proposal editor on ivory, not a white card on grey.
   - *Test:* a token lint on staff routes.
3. **Balance luminance across the screen.** A dark plane of about 40% of viewport width or less during reading tasks.
   - *Evidence:* IES 3:1 and 10:1 guidance (inference to screens); measured 18:1 between ivory and forest.
   - *Example:* the Diary grid stays ivory and its forest panel carries facts.
   - *Test:* a 2-hour device reading study before enforcing.
4. **Type floor by visual angle.** Running text at least 15px (16px preferred); secondary at least 14px; nothing informative under 12px; capitals at least 12px with tracking.
   - *Evidence:* Legge & Bigelow; my calculation; Bernard 2001; Rello 2016.
   - *Example:* the date tile's 10.5px becomes 12px; the 13px fact labels become 14px.
   - *Test:* a stylelint rule by text role.
5. **Light weights only when large.** Weight 300 only at 24px or more; one size step larger on dark surfaces.
   - *Evidence:* APCA; Piepenbrock 2014; halation reports.
   - *Test:* a weight-and-size lint.
6. **Prose 45–75 characters wide** (target 60ch), line-height 1.45–1.6.
   - *Evidence:* Dyson & Haselgrove 2001; WCAG 1.4.12.
   - *Example:* proposals and AI drafts in a 62ch column.
   - *Test:* computed widths.
7. **Contrast tiers.** Primary text 7:1 or better, secondary 4.5:1 or better, graphics and large numerals 3:1 or better.
   - *Evidence:* WCAG 1.4.3, 1.4.6, 1.4.11; W3C WAI older users.
   - *Test:* a token-pair contract test.
8. **A visible focus on every surface.** At least 2px and 3:1 against adjacent colours.
   - *Evidence:* WCAG 2.4.7 and 2.4.13; the cyan ring measures 1.22:1.
   - *Test:* Playwright ring-pixel sampling.
9. **Never colour alone, and never blue against green or violet for status.**
   - *Evidence:* ageing colour vision; WCAG 1.4.1.
   - *Example:* Diary holds hatched with "2nd option"; confirmed solid; clashes with a brick edge and "Clash".
   - *Test:* tritan simulation.
10. **Four deciding facts in a fixed order,** in venue vocabulary and British formats, with no raw enums.
    - *Evidence:* Cowan; Pirolli & Card; product-experience.md:16.
    - *Example:* "£4,750", not "GBP 4,750.00"; "Needs review", not "review_required".
    - *Test:* formatter tests and a snake_case copy lint.
11. **Related information side by side.**
    - *Evidence:* split attention.
    - *Example:* the list-plus-panel pattern for the Diary, Proposals and Contracts.
    - *Test:* an e2e check that scroll position is kept.
12. **Carry context forward:** pre-fill with provenance.
    - *Evidence:* recognition over recall; defaults.
    - *Example:* "Create opportunity" is fully pre-filled.
    - *Test:* a field-source audit.
13. **Progressive disclosure at most two levels deep,** and never modal-on-modal.
    - *Evidence:* NN/g.
    - *Test:* a depth audit.
14. **Spatial stability:** no reordering by frequency; "Next step" in one slot.
    - *Evidence:* Findlater & McGrenere; Scarr et al.; Bloomberg.
    - *Test:* bounding-box comparisons.
15. **One primary action and at most two secondaries;** the rest in the command bar.
    - *Evidence:* Hick and Hyman; Cockburn 2007; Vohra.
    - *Test:* a button count.
16. **Generous targets.** Primary actions at least 44px; all targets at least 24px or spaced; rows fully clickable; destructive actions kept apart.
    - *Evidence:* Fitts; Walker et al.; Findlater 2013; WCAG 2.5.8.
    - *Test:* a target-size audit.
17. **Recommend two or three options when preference is uncertain,** and show the full set to confident experts.
    - *Evidence:* Chernev 2015.
    - *Example:* room recommendations with capacity reasons.
    - *Test:* conditional rendering tests.
18. **Response budgets:** 100 ms to acknowledge, 400 ms at p75 for routine changes, the Activity status after 1 s, measured progress after 10 s, and optimistic updates with rollback.
    - *Evidence:* Miller and Card via Nielsen; Doherty & Thadani.
    - *Test:* performance marks.
19. **A keyboard mastery path:** list keys, Ctrl/⌘ K, shortcuts printed everywhere, keys revealed while a modifier is held.
    - *Evidence:* Lane; Grossman; Malacria; Cockburn 2014.
    - *Test:* a mouse-free triage e2e.
20. **Honest visible progress** and real zero states, never guessed counts.
    - *Evidence:* Amabile & Kramer; Heer & Robertson.
    - *Test:* count-provenance tests.
21. **Distance to done without fake progress:** paths or counts, with only real completed steps.
    - *Evidence:* Kivetz; Nunes & Drèze.
    - *Test:* each step maps to a persisted fact.
22. **Close open loops with dated plans** that come back reliably.
    - *Evidence:* Masicampo & Baumeister; Ghibellini & Meier.
    - *Test:* scheduler tests.
23. **Design the ends:** a stamp for each decision, a finished state for each queue, an optional day close, admin early in flows.
    - *Evidence:* Kahneman; Chase & Dasu.
    - *Test:* a review of every flow's final screen.
24. **No gamification artefacts and no praise copy.**
    - *Evidence:* Mollick & Rothbard; Hanus & Fox; Deci et al.; Vohra; Blake.
    - *Test:* a copy lint.
25. **Feedback states consequences, not judgements.**
    - *Example:* "Declined. Sarah Henderson was emailed at 14:02, and your note was quoted."
    - *Evidence:* informational feedback.
    - *Test:* unit tests for the consequence lines.
26. **Propose, never impose:** saved views and server-side preferences.
    - *Evidence:* SDT and METUX.
    - *Test:* bypass and persistence e2e.
27. **Relatedness through fact:** presence, handoffs and collision prevention.
    - *Evidence:* SDT; the desk's 422 handling.
    - *Test:* a two-session e2e.
28. **Three interruption tiers,** digests three times a day by default, and no toast per success.
    - *Evidence:* Mark; Iqbal & Horvitz; Fitz; Weiser & Brown.
    - *Test:* per-event policy tests.
29. **Motion budget:** state changes only, 120–320 ms, hover as colour, press at scale(0.97) or subtler, reduced motion honoured, global pop removed.
    - *Evidence:* Kao; Heer & Robertson; founder decision.
    - *Test:* a hover-transform lint.
30. **One small acknowledgement per consequential action,** using several channels, with no sound by default.
    - *Evidence:* Jonasson & Purho; Swink; Kao; Hicks.
    - *Example:* a hold turns from hatched to solid in 240 ms as the count ticks.
    - *Test:* a checklist plus a reduced-motion check.
31. **Confirm external consequences only;** undo everything internal.
    - *Evidence:* Anderson et al.; Raskin.
    - *Test:* a confirm-to-side-effect audit.
32. **Density fits the task:** a compact option aiming for 8–12 records per 900px.
    - *Evidence:* NN/g tables; expertise reversal; Bloomberg.
    - *Test:* a records-per-viewport measurement.
33. **Don't teach experts:** no tours or age-coded modes; help on demand.
    - *Evidence:* Kalyuga; Lamont.
    - *Test:* a first-run overlay audit.
34. **Polish paired with measurement:** a task benchmark for every redesign.
    - *Evidence:* Sonderegger & Sauer; Tuch.
    - *Test:* scripted timings.
35. **Low first-glance complexity:** at most two families, three surface tones and one accent under about 5% of pixels.
    - *Evidence:* Lindgaard; Reinecke.
    - *Test:* a font and pixel audit.
36. **Encourage with light and colour:** bright low-saturation grounds, copper only for action.
    - *Evidence:* Valdez & Mehrabian; Elliot & Maier.
    - *Test:* a token usage audit.
37. **One sourced room photograph per decision view or closure moment.**
    - *Evidence:* Kaplan; Lee.
    - *Test:* provenance checks plus at most one hero image.
38. **Fluency through a system:** shared tokens and components, no one-off values.
    - *Evidence:* Reber; Winkielman & Cacioppo.
    - *Test:* a token lint.
39. **Client-facing outputs carry the same finish.**
    - *Evidence:* Norman; founder reach decision.
    - *Test:* template baselines.
40. **Robust for older users:** 200% zoom and reflow, no hover-only information, no auto-dismissing messages, tablet parity.
    - *Evidence:* NN/g; W3C WAI; Findlater 2013.
    - *Test:* zoom, reflow and toast lints.

## Platform capabilities to build (most valuable first)

1. **A shared "calm surface" design system** extracted from the desk, with lints and contract tests.
2. **A command palette and one keyboard model** across all tools.
3. **Snooze with a plan:** dated next steps that come back reliably.
4. **An undo service** with per-record history.
5. **A consequence-preview component** for every external action.
6. **A three-tier notification engine** with digests.
7. **Optimistic mutations with rollback,** plus response-time telemetry.
8. **Server-side personal preferences:** density, text size, motion, views and digest times.
9. **Day open and day close.**
10. **Presence and collision prevention.**
11. **Client-facing templates** in the same finish.
12. **A task benchmark harness.**

## Questions for Blake

1. Should there be a compact ledger option, or only the airy view?
2. May I try a pale "letter" inset for long reading on the forest panel?
3. Should people be able to choose a dim variant for evenings and event nights?
4. Should each person be able to choose standard or larger text?
5. Which events may interrupt someone, and at what times should digests arrive?
6. Would a day close (and the session tally) feel useful or like surveillance?
7. Should the platform stay silent, or allow one optional sound for a signed contract?
8. Does the team use keyboard shortcuts in Salesforce or Cvent today, and would a Ctrl K bar be welcome?
9. Which words does the team use: first or second option, provisional or hold, covers or guests, function sheet or BEO?
10. May staff tools standardise on Newsreader and Inter?
11. Is one room photograph per decision view the right amount?
12. What screens do the most senior users work on, and how far from them do they sit?

## Limits

- **No live testing.** No rule has been tested against the live app; the rules are proposals to implement and measure.
- **Search summaries only.** nngroup.com, ncbi.nlm.nih.gov (including PMC) and blog.superhuman.com were blocked by the network proxy. Claims from those sources come from search-result summaries.
- **Secondary figures.** The "one third of the light" figure and the IES luminance ratios come from secondary sources.
- **Assumptions in my calculations.** The visual-angle figures assume Inter's metrics and a 24-inch 1080p monitor at 60 cm. Real devices at Trades Hall should be measured.
- **Colour psychology** effects depend on context; R36 is a hypothesis.
- **Aesthetic acceptance is Blake's alone.**

## Sources

**Reading comfort and vision**
- [Piepenbrock et al. 2013, Ergonomics](https://pubmed.ncbi.nlm.nih.gov/23654206/)
- [Piepenbrock, Mayr & Buchner 2014, Ergonomics: pupil size](https://pubmed.ncbi.nlm.nih.gov/25135324/)
- [Piepenbrock et al. 2014, Human Factors: small characters](https://journals.sagepub.com/doi/abs/10.1177/0018720813515509)
- [NN/g: Dark Mode vs. Light Mode](https://www.nngroup.com/articles/dark-mode/)
- [Aleman, Wang & Schaeffel 2018, Scientific Reports](https://www.nature.com/articles/s41598-018-28904-x)
- [Level Access: astigmatism](https://www.levelaccess.com/blog/accessibility-for-people-with-astigmatism/)
- [Cochrane 2023: blue-light lenses](https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD013244.pub2/full)
- [Sheppard & Wolffsohn 2018: digital eye strain](https://research.aston.ac.uk/en/publications/digital-eye-strain-prevalence-measurement-and-amelioration/)
- [BDA Style Guide 2023](https://cdn.bdadyslexia.org.uk/uploads/documents/Advice/style-guide/BDA-Style-Guide-2023.pdf)
- [Fagerhult: luminance ratios](https://www.fagerhult.com/knowledge/light-planning/en-12464-1/luminance-ratios/working-areas-and-room-surfaces/)
- [Visual effects of the luminance surrounding a computer display, Ergonomics](https://www.tandfonline.com/doi/full/10.1080/00140130500208414)
- [Dyson & Haselgrove 2001](https://www.sciencedirect.com/science/article/abs/pii/S1071581901904586)
- [Rello, Pielot & Marcos 2016](https://pielot.org/pubs/Rello2016-Fontsize.pdf)
- [Legge & Bigelow 2011](https://jov.arvojournals.org/article.aspx?articleid=2191906)
- [Bernard, Liao & Mills 2001](https://dl.acm.org/doi/10.1145/634067.634173)
- [APCA in a nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Understanding Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)

**Cognition, interaction laws and expertise**
- [Cowan 2001](https://philpapers.org/rec/COWTMN)
- [Kalyuga et al. 2003](https://www.tandfonline.com/doi/abs/10.1207/S15326985EP3801_4)
- [Chandler & Sweller 1992](https://bpspsychub.onlinelibrary.wiley.com/doi/abs/10.1111/j.2044-8279.1992.tb01017.x)
- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [NN/g: complex applications](https://www.nngroup.com/articles/complex-application-design/)
- [NN/g: data tables](https://www.nngroup.com/articles/data-tables/)
- [Hick 1952](https://journals.sagepub.com/doi/10.1080/17470215208416600)
- [Hyman 1953](https://pubmed.ncbi.nlm.nih.gov/13052851/)
- [Fitts 1954](http://www2.psychology.uiowa.edu/faculty/mordkoff/InfoProc/pdfs/Fitts%201954.pdf)
- [Cockburn, Gutwin & Greenberg 2007](https://www.csse.canterbury.ac.nz/andrew.cockburn/papers/paper191-cockburn.pdf)
- [Findlater & McGrenere 2004](https://dl.acm.org/doi/10.1145/985692.985704)
- [Scarr et al. 2012: CommandMaps](https://dl.acm.org/doi/10.1145/2207676.2207713)
- [Bloomberg: concealing complexity](https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity)
- [Doherty & Thadani 1982](https://jlelliotton.blogspot.com/p/the-economic-value-of-rapid-response.html)
- [NN/g: response time limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- [Lane et al. 2005](https://www.ruf.rice.edu/~lane/papers/hidden_costs.pdf)
- [Cockburn et al. 2014](https://dl.acm.org/doi/10.1145/2659796)
- [Grossman et al. 2007](https://dl.acm.org/doi/10.1145/1240624.1240865)
- [Malacria et al. 2013: ExposeHK](https://dl.acm.org/doi/10.1145/2470654.2470735)

**Motivation, progress and interruptions**
- [Amabile & Kramer 2011](https://hbr.org/2011/05/the-power-of-small-wins)
- [Kivetz, Urminsky & Zheng 2006](https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf)
- [Nunes & Drèze 2006](https://academic.oup.com/jcr/article-abstract/32/4/504/1787425)
- [Kahneman et al. 1993](https://journals.sagepub.com/doi/10.1111/j.1467-9280.1993.tb00589.x)
- [Chase & Dasu 2001](https://hbr.org/2001/06/want-to-perfect-your-companys-service-use-behavioral-science)
- [Masicampo & Baumeister 2011](https://users.wfu.edu/masicaej/MasicampoBaumeister2011JPSP.pdf)
- [Ghibellini & Meier 2025](https://www.nature.com/articles/s41599-025-05000-w)
- [Chernev et al. 2015](https://chernev.com/wp-content/uploads/2017/02/ChoiceOverload_JCP_2015.pdf)
- [Johnson & Goldstein 2003](https://www.science.org/doi/10.1126/science.1091721)
- [Mark, Gudith & Klocke 2008](https://ics.uci.edu/~gmark/chi08-mark.pdf)
- [Iqbal & Horvitz 2007](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/CHI_2007_Iqbal_Horvitz-1.pdf)
- [Fitz et al. 2019](https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596)
- [Weiser & Brown 1996](https://calmtech.com/papers/coming-age-calm-technology)
- [Nakamura & Csikszentmihalyi: flow](https://www.researchgate.net/publication/244486256_The_Concept_of_Flow)
- [Deci, Olafsen & Ryan 2017](https://www.annualreviews.org/content/journals/10.1146/annurev-orgpsych-032516-113108)
- [Peters, Calvo & Ryan 2018](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.00797/full)
- [Mollick & Rothbard](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2277103)
- [Hanus & Fox 2015](https://www.semanticscholar.org/paper/Assessing-the-effects-of-gamification-in-the-A-on-Hanus-Fox/dff76a9862467d426113ec530f83942016ae3a97)
- [Deci, Koestner & Ryan 1999](https://home.ubalt.edu/tmitch/642/articles%20syllabus/Deci%20Koestner%20Ryan%20meta%20IM%20psy%20bull%2099.pdf)

**Game feel, motion and forgiveness**
- [Superhuman: game design, not gamification](https://blog.superhuman.com/game-design-not-gamification/)
- [NFX: Superhuman frameworks](https://www.nfx.com/post/superhuman-product-frameworks)
- [Game feel (Swink)](https://en.wikipedia.org/wiki/Game_feel)
- [Jonasson & Purho, GDC 2012](https://www.gdcvault.com/play/1016487/juice-it-or-lose)
- [Hicks et al. 2019](https://dl.acm.org/doi/abs/10.1145/3311350.3347171)
- [Kao 2020](https://www.sciencedirect.com/science/article/pii/S1875952118300879)
- [Heer & Robertson 2007](https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf)
- [Harrison et al. 2007: progress bars](https://chrisharrison.net/projects/progressbars/ProgBarHarrison.pdf)
- [Raskin 2007](https://alistapart.com/article/neveruseawarning/)
- [Anderson et al. 2015](https://dl.acm.org/doi/10.1145/2702123.2702322)

**Aesthetics, colour and restoration**
- [Kurosu & Kashimura 1995](https://dl.acm.org/doi/10.1145/223355.223680)
- [Sonderegger & Sauer 2010](https://www.sciencedirect.com/science/article/abs/pii/S0003687009001148)
- [Tuch et al. 2012](https://cpb-us-e1.wpmucdn.com/wp.wwu.edu/dist/8/2868/files/2018/04/Tuch-et-al-2012-Is-Beautiful-Usable-2don1em.pdf)
- [Lindgaard et al. 2006](https://www.tandfonline.com/doi/abs/10.1080/01449290500330448)
- [Reinecke & Gajos 2014](https://www.eecs.harvard.edu/~kgajos/papers/2014/reinecke14visual.pdf)
- [Reinecke et al. 2013](https://kgajos.seas.harvard.edu/papers/reinecke13aesthetics.pdf)
- [Reber, Schwarz & Winkielman 2004](https://pages.ucsd.edu/~pwinkiel/reber-schwarz-winkielman-beauty-PSPR-2004.pdf)
- [Winkielman & Cacioppo 2001](https://pubmed.ncbi.nlm.nih.gov/11761320/)
- [Norman: emotional design](https://jnd.org/emotional-design-people-and-things/)
- [Valdez & Mehrabian 1994](https://pubmed.ncbi.nlm.nih.gov/7996122/)
- [Elliot & Maier 2014](https://pubmed.ncbi.nlm.nih.gov/23808916/)
- [Kaplan 1995](https://www.sciencedirect.com/science/article/abs/pii/0272494495900012)
- [Lee et al. 2015](https://www.sciencedirect.com/science/article/abs/pii/S0272494415000328)
- [Healey & Enns 2012](https://dl.acm.org/doi/10.1109/TVCG.2011.127)
- [Pirolli & Card 1999](https://philpapers.org/rec/PIRIF)

**Older users**
- [NN/g: usability for older adults](https://www.nngroup.com/articles/usability-for-senior-citizens/)
- [W3C WAI: older users](https://www.w3.org/WAI/older-users)
- [Colour vision problems with age](https://www.sciencedaily.com/releases/2014/02/140220102614.htm)
- [Age-related changes in visual search](https://www.nature.com/articles/s41598-020-78303-4)
- [Aging, senile miosis and contrast sensitivity](https://pubmed.ncbi.nlm.nih.gov/3253994/)
- [Findlater et al. 2013](https://makeabilitylab.cs.washington.edu/media/publications/Findlater_AgeRelatedDifferencesInPerformanceWithTouchscreensComparedToTraditionalMouseInput_CHI2013.pdf)
- [Lamont, Swift & Abrams 2015](https://kar.kent.ac.uk/46931/1/LamontSwiftAbrams(2015).pdf)
- Walker, Philbin & Fisk 1997, *Journal of Gerontology: Psychological Sciences* 52B(1):40–52 (found only as a citation).

**Repository files cited**
- `/home/user/omnitwin/.claude/conventions/product-experience.md`
- `/home/user/omnitwin/docs/design/enquiries-desk-2026-09-24/README.md`
- `/home/user/omnitwin/packages/web/src/components/dashboard/enquiries/EnquiriesDesk.css`
- `/home/user/omnitwin/packages/web/src/components/dashboard/enquiries/EnquiryLedger.tsx`
- `/home/user/omnitwin/packages/web/src/components/dashboard/enquiries/EnquiryPanel.tsx`
- `/home/user/omnitwin/packages/web/src/components/dashboard/enquiries/EnquiryOverview.tsx`
- `/home/user/omnitwin/packages/web/index.html`
- `/home/user/omnitwin/packages/web/src/global.css`
- `/home/user/omnitwin/packages/web/src/styles/house-tokens.css`
- `/home/user/omnitwin/packages/web/src/styles/fonts/site.css`, `cockpit.css` and `quiz.css`
- `/home/user/omnitwin/packages/web/e2e/dashboard-state-visual-performance.spec.ts-snapshots/desktop-executive-analytics-success-chromium-linux.png`
- `/home/user/omnitwin/packages/web/e2e/operational-state-visual-performance.spec.ts-snapshots/desktop-ops-handoff-ready-chromium-linux.png`
