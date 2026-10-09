# `/platform` redesign — implementation plan

> For agentic workers: execute task by task (superpowers:executing-plans);
> steps use `- [ ]` checkboxes.

**Goal:** ship the redesigned `venviewer.com/platform` described in
[README.md](README.md), pass the eight-reviewer gate, then submit the Claude
Startups application.

**Architecture:** a static page in `packages/web/public/platform/` (HTML, one
stylesheet, one progressive script, local fonts and images) served by the
existing Vercel rewrite. Product images come from capture-only Playwright
tests that reuse the end-to-end API emulators; a Vitest guard keeps the page's
assets, links, numbers and truth labels honest.

**Tech stack:** HTML, CSS (scroll-driven animations with fallback), vanilla
JavaScript, Playwright 1.59.1, Vitest, sharp for AVIF/WebP.

## Global constraints

- Truth rules in README.md: measured, dated numbers; captures of the current
  product with sample data; Claude "connected and tested, not live for venue
  use"; the film labelled a concept film; Trades Hall the first venue only.
- House type Newsreader and Inter; palette ivory `#f2eddd`, forest `#1b3a2f`,
  copper `#a9622f`, sage `#819087`; WCAG AA; visible focus; reduced motion.
- Progressive script under 10 KB; the page reads completely without it.
- No change to production data; captures use emulators or the public planner.

## Files

- Create `packages/web/public/platform/platform.js` (reveal, scroll story,
  Claude case switcher, gold-ink hero).
- Replace `packages/web/public/platform/index.html` and `styles.css`.
- Add Newsreader and Inter `woff2` files to `public/platform/fonts/`, copied
  from `src/styles/fonts/` with their licences.
- Add `packages/web/public/platform/img/*.avif|webp` (hero, captures).
- Create `packages/web/src/__tests__/platform-page.test.ts` (guard).
- Modify e2e specs with capture-only tests skipped unless
  `CAPTURE_PLATFORM_DIR` is set: `proposals-desk.spec.ts`,
  `enquiries-desk-truth.spec.ts`, `diary-timetable.spec.ts`,
  `proposal-share-link.spec.ts`, `hallkeeper.spec.ts`.

### Task 1: Guard test first

- [ ] Write `platform-page.test.ts`: parse `public/platform/index.html`;
  assert every `src`/`srcset`/`href` to `/platform/...` exists on disk; every
  `#anchor` has a target; sections `#room`, `#event`, `#claude`,
  `#engineering`, `#venue`, `#film`, `#founder` exist; the Claude section
  says drafting is "not yet switched on for venue use"; the film is labelled
  "concept film"; no `lorem` or `TODO`; script under 10 KB.
- [ ] Run `pnpm --filter @omnitwin/web exec vitest run src/__tests__/platform-page.test.ts`;
  expect failures for the missing sections.

### Task 2: Captures

- [ ] Generate one real Claude draft for the emulator's sample proposal with
  the Anthropic adapter (key file, workspace header) and keep its text.
- [ ] Add the capture-only tests (`deviceScaleFactor: 2`, skipped unless
  `CAPTURE_PLATFORM_DIR` is set), writing PNGs there: enquiries desk with an
  enquiry open; diary week with holds; proposal panel; AI draft in the
  composer with the real Claude words; the client's proposal page;
  hallkeeper today.
- [ ] Capture the Grand Hall in the live public planner with a dinner layout.
- [ ] Convert to AVIF and WebP at 1× and 2× widths; record each source.

### Task 3: Page

- [ ] HTML in the README's order: semantic landmarks, captures with honest
  captions, Claude cases from the round 3 evaluation results embedded as
  static HTML (switcher progressive), measured numbers with date and source.
- [ ] CSS: dark hall register, ivory sheets, copper plane, sticky scroll
  story (stacked under 900 px), mathematical-sublime numerals.
- [ ] `platform.js`: gold-ink drawing (SVG stroke reveal), reveal on scroll,
  story frame swap, case switcher; still under reduced motion.
- [ ] Run the guard; expect PASS.

### Task 4: Verify and review

- [ ] Local preview at 1440, 1024, 390 and 320 px; no console errors, no
  horizontal scroll, keyboard path through every control.
- [ ] Eight-reviewer panel on screenshots and the preview; fix until every
  reviewer scores every topic 9 or above.

### Task 5: Ship

- [ ] Commit with explicit paths; PR; CI green; merge; live check of
  `/platform` at desktop and phone.
- [ ] Submit the application (approved, conditional on the gate); record the
  confirmation; update T-646 and the session note.
