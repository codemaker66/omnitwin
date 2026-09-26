# Completeness review: gaps and corrections in the Venviewer design-system spec and roadmap

The most serious gaps are what clients actually receive and the documents that shape everything else. First, the emails, PDFs and link previews clients receive were never audited, and the approve email says "Great news!". Second, the Enquiries desk everything builds on is not merged, not deployed and has no committed visual baselines. Third, the roadmap ignores work already owned under Goal 12 and has a migration-number collision. Fourth, the spec hard-codes rules that the founder's own convention says must not be treated as requirements.

Evidence labels: **[inspected]** means I read the source; **[measured]** means I computed it; **[inferred]** means I reasoned from source without testing in a browser.

1. **The emails clients receive were never audited, and they break the founder's rules.**
   - The desk's Approve… and Decline… buttons send `enquiryApproved` and `enquiryRejected` (`packages/api/src/routes/enquiries.ts:292-318`). What the client gets [inspected]:
     - The approve email opens "Great news!" under a Title Case heading "Enquiry Approved" in Tailwind green (`email-templates.tsx:322-324`).
     - The decline email says "We'd love to help… please don't hesitate" and puts the staff note in a red "critical" box (`:378-386`, `:163`).
     - Styling is navy `#1a1a2e`, Tailwind blue `#3b82f6`, Helvetica and 8 px card radii (`:44-80`).
     - The date is the raw `preferredDate` value, so "on 2027-06-05" [inferred from the `date()` column, `schema.ts:680`].
     - For twin and website leads the email names the flagship room the client never chose, and falls back to "Unknown space" or "Unknown venue".
   - Only the approve email contains praise words; I grepped both packages.
   - **Fix:**
     - Add all 8 templates to the N5 truth sweep.
     - Rewrite them in the §4.8 voice, with venue-local dates and the ivory/forest look.
     - Put the decline note in a neutral quote, not an alarm box.
     - Extend the copy lint to `packages/api`.
     - Test how the emails render in Outlook, Gmail and Apple Mail.

2. **PDFs and link previews were never audited either, and a shared token file was missed.**
   - **PDFs.** The hallkeeper sheet PDF uses Helvetica at 5.5–7.5 pt (`hallkeeper-pdf-v2.ts:128-456`) [inspected]. Its gold text `#b8982f` is 2.77:1 on white and its faint text `#999` is 2.85:1 [measured].
   - **Missed token file.** `packages/types/src/design-tokens.ts` already calls itself the "single source of truth" for brand, severity and sheet type, shared by web and PDF (navy and gold). The spec never mentions it, so emails and PDFs would stay off-palette.
   - **Link previews.** `vercel.json` rewrites every route to `index.html`, which has fixed Trades Hall marketing `og:` tags. So a `/proposal-share/…` or `/supplier-share/…` link unfurls as "Trades Hall of Glasgow — weddings and events", for every venue [inspected]. That is a tenancy leak and the wrong first impression.
   - **Fix:**
     - Put the workspace tokens in `packages/types` so web, email and PDF all use them.
     - Embed static Newsreader and Inter instances in the PDFs. [inferred: PDFKit does not reliably select variable-font instances]
     - Add per-route or neutral link-preview metadata (edge function or `noindex` neutral card).
     - Add print baselines.

3. **The reference surface is not shipped and has no baselines to protect it.**
   - T-633 and 44 other commits exist only on `claude/cool-tesla-90zlcp`; `c777f90` is not an ancestor of `origin/master` [inspected].
   - The push was refused by the session's permission system (`docs/sessions/2026-09-24.md:45-53`), and T-633 is still `in-progress`.
   - There is no desk PNG under `e2e/*-snapshots/`. Yet Phase 0's exit ("desk baselines unchanged") and Phase 2 ("side by side until baselines match") both depend on desk baselines.
   - Blake's verdict is not recorded: the README, task row and session note still say "pending".
   - **Fix, as step 0 before Phase 0:**
     - Record his verdict in the README, T-633 and the session note.
     - Commit linux and win32 desk baselines: desktop, tablet and phone, each showing the overview, an open enquiry, the decline confirmation and "All caught up".
     - Ship the branch under the shipping contract.
     - Ask Blake to merge it or allow the push.

4. **The roadmap ignores who already owns this work, and there is a migration collision.**
   - T-605 (Goal 12, active, 20 days) already targets replacing "Salesforce-, Cvent- and diagramming-style work" and "one versioned event". Its owner branch `codex/intelligent-event-decision-20260907` reserves migration 0071 (`tasks.md:97`).
   - But 0071 is already used on this branch by T-629, and 0072 by T-632 (`performance-review-2026-09-24.md:8`).
   - The roadmap adds further schema work without any lane or migration coordination: optional room, source field, VAT, owner names, capability map, a stage-counts endpoint.
   - It also never mentions `goals/EXECUTION.md` lanes or T-601 as the release owner.
   - **Fix:**
     - Add an "owner / depends-on / migration" column to every roadmap item.
     - Resolve the 0071 collision.
     - Route the Tier A capabilities and the sales spine through T-605's owner.

5. **The spec hard-codes rules the founder's convention says are not requirements.**
   - `product-experience.md` lists "one accent, blanket material bans or a fixed percentage of room imagery" as proposals that must not narrow Blake's ambition.
   - The spec and research make these laws, and propose CI guardrails for them:
     - P34: "at most one hero image per decision view"
     - §2.8: "no glass or blur in the content layer"
     - P32: "one action accent"
     - R35: accent under about 5% of pixels
     - P27: "motion only for state change"
   - P27 also misattributes "motion only for state change" to Blake's 26 September decision, which covered only the hover pop.
   - The sublime is reduced to one photograph, although the convention asks for composition, spatial presence, typography, motion and sound.
   - There is no list of rejected designs to avoid: T-591 ("terrible and boring"), the dark Diary, the "gracious ballroom" concept and the ten-direction exploration.
   - **Fix:**
     - Demote these rules to overridable defaults and do not lint them.
     - Require each surface's design record to name its moment of scale, and to show visual targets and anti-references to Blake before it is built.

6. **Existing design language and tokens are not reconciled.**
   - **Prior design language.** `docs/plan/02-DESIGN-LANGUAGE.md` (House: dark back-of-house for operators, ivory front-of-house for clients) is inverted by the spec with no supersession record.
   - **Existing chip grammar.** `EvidenceChip` is "the one chip grammar (01 §9 · 02 §3)" with an ai/simulated provenance badge, used in `CockpitTruthRail` and `TruthModeIndicator`. The spec invents StatusChip plus heather and loch alongside it.
   - **Existing semantic tokens.** `--house-text-*` and `--house-status-*` already define violet for AI and cyan for simulated (`house-tokens.css:34-49`). Ten CSS files use them, including the planner cockpit. The spec's `--reg-*` layer never remaps them, so under an ivory register they would render ivory text on ivory [inferred].
   - **Undefined tokens.** The register block references `--house-copper-text`, `--house-brick-strong`, `--house-sage-text` and the `*-lit` tones, none of which are defined in the primitives block.
   - **Fix:**
     - Redefine the House semantic names inside each `[data-register]`.
     - Fold StatusChip into EvidenceChip, or define the boundary between them.
     - Complete the primitives block.
     - Write a revision record superseding 02 §3.

7. **Colour-vision separation was only checked for charts.** My Machado-2009 simulation in OKLab [measured]:

   | Pair | Separation (ΔE_ok) |
   | --- | --- |
   | copper vs amber text, protanopia | 0.015 |
   | stage-plane dots "new" vs "review", protanopia | 0.018 |
   | stage-plane dots "new" vs "review", deuteranopia | 0.026 |
   | copper vs amber wash, normal vision | 0.029 |
   | sage vs amber wash, normal vision | 0.039 |

   Diary fills, stage dots and chips depend on these pairs when scanning at a glance.
   - **Fix:** separate the Diary and stage encodings by luminance and pattern (hatch, outline style), and run a colour-vision simulation on screenshots, not only on tokens.

8. **Undo is promised where it cannot work, and the timing contradicts other rules.**
   - Spec §4.2 treats "releasing a pencil" as reversible with Undo. But `released` is terminal (`packages/types/src/booking.ts:87-98`), and a release re-ranks the ladder.
   - Roadmap N3 puts a confirmation on Release, so the two documents disagree.
   - §3.13's 6-second auto-dismissing Undo toast contradicts P36 ("never auto-dismiss"), research R31 (at least 10 s) and WCAG 2.2.1. Its Ctrl+Z fallback does not exist on tablets.
   - **Fix:**
     - Decide release semantics with Blake (D4/D5): either an API-level "unrelease" window that restores the ladder, or a confirmation.
     - Keep the undo toast until the next action or at least 10 s, pausable, with a visible history entry.

9. **The spec and roadmap contradict each other.**
   - Forest field colour: spec `#2b4a3d`, roadmap `#1a3229`.
   - Focus token: roadmap "replace `--vv-focus`", spec G4 keeps it because `house-tokens.test.ts:132` pins it.
   - Register location: roadmap `house-tokens.css`, spec `styles/workspace.css`.
   - Type floor: roadmap Definition of Done 12 px, spec 13 px for captions.
   - Press scale: the Definition of Done says "Presses scale to 0.97 **or less**", which would pass today's 0.93. It should say no smaller than 0.97.
   - Toast counts in spec P26 are wrong: there are 69 `addToast(` call sites app-wide, 66 of them in dashboard files; 94 is every mention, including declarations.
   - **Fix:** make the roadmap reference the spec as the single source of truth, and correct these values.

10. **Surfaces that exist but were never audited.** Compared against `router.tsx` and the rendered outputs:
    - `/dev/capture-intake`: production, platform-admin, appears as "Capture Factory" in the More menu, dark mint and gold (`CaptureIntakePage.css:2-9`).
    - Planner `AuthModal`, "Sign In to Save": the guest-to-account conversion moment. It is Title Case and closes on a backdrop click (`AuthModal.tsx:76-92`).
    - The Clerk profile modal (`WorkspaceAccessGate.tsx:28`) and the verification emails Clerk sends.
    - 8 of 9 planner lens panels.
      - `CostsLensPanel` shows clients a "Total estimate" with no VAT (`:103-140`). That is a DMCC risk for consumers [inferred].
    - The dev fixtures `/dev/evidence-chips`, `/dev/time-machine` and `/dev/trades-hall-visual`. The Time Machine they preview also ships in the planner.
    - The accessibility statement. It lists known failures (`LegalPage.tsx:754-831`) and must be updated as fixes land.
    - The catch-all `*` → `/` route. There is no not-found page, so a mistyped staff URL lands on the marketing homepage.
    - **Fix:** add all of these to the audit matrix and design a not-found state.

11. **Research methods that were not run.**
    - No interviews, shadowing or contextual inquiry with Elaine, the sales team, hallkeepers or clients. Every "daily use" figure is a guess.
    - No baseline task timings in Salesforce or Cvent, so the P31 benchmarks cannot show improvement over the incumbents.
    - No usability test of the desk with an eight-hour user; Blake is not that user.
    - No testing with assistive technology; the accessibility statement admits this.
    - Only a Chromium project exists (`playwright.config.ts:72-82`), with no WebKit or Firefox, although tablets are likely iPad Safari [inferred].
    - No email-client or print testing.
    - No hands-on competitor trials; the research relied on search-engine summaries, and many sources were blocked.
    - No legal review before the quote engine.
    - No visual targets for the next surfaces, although the convention demands "actual visual targets".
    - **Fix:** schedule observation sessions and baseline timings, add WebKit and Firefox projects, and produce image targets per surface.

12. **Accessibility gaps.**
    - **Forced colours.** No forced-colors rules anywhere in the desk or spec; only the twin and `Activity.css` have them. Washes, fills and selection bars would vanish in Windows High Contrast [inferred].
    - **Italic reading text.** The client's message is set in italic serif (`EnquiriesDesk.css:320,510,634`), and the spec keeps italic quote roles. That contradicts the BDA guide the spec itself cites for cream paper.
    - **Text spacing.** No WCAG 1.4.12 check against clipped, tilted planes.
    - **Missing tooling.** Neither axe-core nor stylelint is installed (`packages/web/package.json`), yet the Definition of Done and guardrails require both.
    - **Baseline platforms.** Win32 baselines exist next to the linux ones, but the recapture plan omits them.

13. **Rules that would re-clutter screens or patronise experts.**
    - Each of these is permanent:
      - a lede sentence on every view that repeats the stat plane;
      - consequence hints under routine buttons, e.g. "Only your team sees this stage…";
      - a keyboard legend in every panel;
      - delta and provenance lines.
    - Together they conflict with Blake's 7 September request to remove unnecessary text (T-609, done) and with the spec's own P18 (don't teach experts what they already know).
    - The "no 'we'" copy rule should not apply to venue-to-client email, where "we" is natural.
    - **Fix:** set a text budget per view; show internal hints on focus or until they are learned; keep external-consequence lines.

14. **Novice and client users are not designed for.**
    - Every rule targets expert staff. There is nothing for once-a-year couples in the planner or for suppliers.
    - The planner's first-visit coach cannot be reached on `/plan`, per the audit.
    - Roadmap question C1 sets no home for planners or clients, and `getDefaultRoute` sends planners to `/dashboard` (`role-routing.ts:10`).
    - **Fix:** add a novice rule set for client and supplier surfaces, including a guided start.

15. **The design assumes one venue.**
    - Photographs are bundled in code for Trades Hall only (`enquiry-room-photo.ts:6-13`), so any other venue gets no moment of scale.
    - Money, locale and time are hard-coded British (`formatPounds`), and link previews say Trades Hall.
    - Goal 12 requires a second venue without a code fork.
    - **Fix:**
      - Add a venue photo library capability (provenance, rights, focal point, alt text).
      - Take locale, currency and time zone from venue data, with en-GB as the default.
      - Ask Blake whether non-UK venues are in scope.

16. **Questions for Blake: too many, badly framed, and some missing.**
    - About 65 questions are split across spec §8 and roadmap §5, with duplicates under different numbering.
    - They lean on jargon ("register", "forest-register mode", "heather"), include leading defaults (F7: "drop the tally, which can read as scorekeeping"), bundle several questions into one (A1, C2), and file accountant facts as preferences (A3).
    - **Missing questions:**
      - Will you merge the desk branch, or allow the push?
      - How do you want to review work: preview links or a side-by-side gallery?
      - May we observe Elaine and the team?
      - Newest-first order and start-review-without-confirmation (desk README decisions 1–2).
      - Which comes first: the visual rebuild or Tier A parity (import, mailbox and the rest)?
      - Keep the existing violet AI marker or switch to heather?
      - Are non-UK venues in scope?
    - **Fix:** one merged list of at most 8 blocking questions, each with a picture or A/B comparison; everything else proceeds on defaults.

17. **Claims presented without evidence, or mislabelled.**
    - "Five capabilities stop a switch" is stated as fact; the research itself calls it an inference.
    - P36 misstates Findlater: the 35% figure was a movement-time reduction for older adults (against 16% for younger adults), not a narrowing of the age gap.
    - The NN/g "43% slower" figure and "NN/g 2020" came from blocked pages and should be marked [recalled].
    - "Declared office hardware" does not exist; the device matrix is still pending human input (`docs/plan/15…:90`).
    - "A test deliberately keeps Enquiries under More": the test arrived in a squash (`bd6d866`) with no recorded intent.
    - The desk README and the brief say the cyan ring measures about 1.4:1 on ivory. It measures 1.22:1 on ivory; 1.43:1 is on white [measured].
    - The spec cites 17 `replace(/_/g` renderings; grep finds 21 occurrences.
    - `vercel.json` redirects `/tour`, contradicting the router comment the audit relied on.
    - The desk's conformance "5" ignores its false "Existing opportunity opened" toast (`EnquiriesView.tsx:461-472`) and its false room name.

18. **Performance is not tied to real numbers.**
    - The spec's budgets (100 ms and 400 ms) ignore the current measured baseline: `/dashboard` becomes visible in 2.47 s and `/diary` in 2.42 s on the slow profile, and every Diary change triggers a full refetch on every client (`performance-review-2026-09-24.md:240-303`).
    - Nobody has measured the cost of the proposed clip-path planes, sticky frames, photo fades, `color-mix()` and `:has()` on low-end tablets.
    - **Fix:** adopt the T-629 figures as the baseline, set per-route budgets, and measure on real devices once H8 is answered.

19. **Print is missing for the surfaces veterans are most likely to print.**
    - There is no print stylesheet for the Diary, Enquiries or the client proposal page. Print CSS exists only for hallkeeper, ops, legal and marketing pages [inspected by grep].
    - **Fix:** add print targets for the week or month diary and the proposal, and ask Blake whether the team prints the diary for its Monday meeting [inferred practice].