**Read this when:** changing the staff Enquiries view, or designing another all-day staff work surface.

# The Enquiries desk — 24 September 2026 (T-633)

Status: implemented and verified in the browser. On 26 September Blake judged it
"much cleaner and … not a slog to the eyes, it is inviting", and asked for its
design preferences to reach every aspect of the app (T-634). He also decided:
keep the first-name greeting and the session tally; remove the keyboard legend
from the empty panel (the keys still work and are announced on their buttons).

## What Blake asked for

After T-632 made the list page correctly, Blake judged its look: "ugly, and not
next gen … if i were to see this as worker working 8 hours a day 5 days a week
… i would be daunted, it would feel like such a slog". The requirement: highly
polished, professional, luxurious and intuitive, "a joy to work and navigate",
with information communicated "in a visually satisfying way", custom-designed
for veteran venue bookers and sales executives. He suggested game design or
psychology might help.

## What was wrong

The old screen was a stack of identical white cards on dark green.
- **Priority:** it had no visual priority, no sense of time and no sense of progress.
- **Facts:** the facts a booker decides on (event date, guests, event type, room) sat in small grey text after the client's email.
- **Dates:** they were American-format strings.
- **Tabs:** they were barely legible.
- **Detail:** opening an enquiry replaced the list, so every enquiry cost the reader their place.
- **Actions:** they were generic amber, green and red buttons behind a modal that asked "Are you sure?". It never said that approving or declining **emails the client**, or that a decline note is **quoted in that email** (`packages/api/src/routes/enquiries.ts`, `enquiryRejected` in `email-templates.tsx`).

## What the research says, and what the desk does with it

| Finding | Source | Design decision |
| --- | --- | --- |
| Firms that tried to contact a web lead within an hour were nearly seven times as likely to qualify it as those that waited even an hour longer. | Oldroyd, McElheran & Elkington, "The Short Life of Online Sales Leads", *HBR* (2011) | The opening sentence names how many new enquiries wait and how long the oldest has waited. New rows carry a copper bar and a copper age, and the panel offers the longest-waiting enquiry as the next move. |
| Making progress in meaningful work, even a small win, is the strongest everyday source of engagement at work. | Amabile & Kramer, *The Progress Principle* (2011) | Every decision visibly moves the pipeline: the stage counts tick (New 4 → 3), the status chip stamps, the path advances and a clear stage says it is finished ("Nothing new to answer", "All caught up"). |
| Effort rises as a goal comes into view. | Kivetz, Urminsky & Zheng, "The Goal-Gradient Hypothesis Resurrected", *JMR* (2006) | The pipeline counts are always in sight and are the filters themselves, so the distance to zero is the navigation. |
| People judge more attractive interfaces as easier to use, and tolerate them better. | Kurosu & Kashimura (CHI 1995); Tractinsky, Katz & Ikar, "What is beautiful is usable" (2000) | The selected founder style is carried through: editorial serif, large light numerals, an ivory sheet, a copper plane and a forest decision surface. It is not a generic dashboard. |
| Game design, not gamification: a clear goal, fast keyboard control and a satisfying finish. | Rahul Vohra on designing Superhuman; Jonasson & Purho, "Juice it or lose it" (2012); Swink, *Game Feel* (2008) | No points or badges. The goal is an empty New stage. The keys are ↑ ↓ / j k / Enter / Esc, and focus follows the reader. There is one restrained reward, the chip "stamp" (320 ms, removed under reduced motion), and a sealed "All caught up". |
| Flow needs clear goals, immediate feedback and control. | Csikszentmihalyi, *Flow* (1990) | The next step is always in the same place, with one primary action. Starting a review happens at once. Each decision says exactly what it will send before it goes. |
| Autonomy, competence and relatedness sustain motivation. | Ryan & Deci, self-determination theory (2000) | Staff choose their own order: filters, list and panel side by side. Competence comes from honest counts and consequences. A greeting by name gives relatedness without chatter. |
| Calm technology informs without demanding attention. | Weiser & Brown, "Designing Calm Technology" (1995) | No pulsing, no badges shouting, no toast for every success. The copper accent is the only urgency colour. Motion is reserved for the moment a status changes. |
| Preattentive attributes (position, colour, size) carry meaning at a glance. | Few, *Information Dashboard Design* (2006) | Each row leads with a calendar tile, because a booker reads a request as "which day, how many, which room". Tone is doubled with a named chip, never colour alone, and all text passes WCAG AA. |

## The design

- **Composition** follows the selected Inventory reference
  (`docs/design/references/venviewer-selected-inventory-2026-09-06.png`):
  - The sage ground sits under a pale plane.
  - An ivory sheet has a slightly tilted edge.
  - The pipeline counts sit on a copper plane that breaks past the sheet's left edge, as the reference's impact plane does.
  - The forest decision panel has a skewed inner frame, and the frame stays still while the enquiry scrolls inside it.
- **Header:** the venue date and a greeting by first name ("Thursday 24 September · Good evening, Elaine"), then *Enquiries*, then one sentence of what is waiting, built from the real counts.
- **Stages:** New, In review, Approved, Declined, Withdrawn and All. Each count is its filter.
  - The counts are read with six one-row requests (`countEnquiryStages`).
  - They move at once when staff change a status here, then are re-read from the server.
  - Until the counts are known a stage shows only its name, never a guessed number.
- **Ledger:**
  - Rows are grouped by when they arrived: Today, Yesterday, Earlier this week, Last week, then the month.
  - Each row carries a date tile (weekday, day and month, with the year only when it differs), the client's name in serif, then event type · guests · room · "layout attached", and the first line of their message in italic.
  - The status chip and age sit on the right.
  - Paging, overlap joining and the "changed while open" notice are T-632's, unchanged. When working through a stage empties the loaded rows, the next page follows on its own.
- **Decision panel:**
  - It opens with a photograph of the room the client asked for, fading into the forest. The scale of the Grand Hall is the one moment of Burke's sublime here, seen from a secure desk. Photos come only from Trades Hall's own supplied set (`enquiry-room-photo.ts`), and only when the venue is Trades Hall under its asset or seeded slug; another venue's room gets no picture.
  - The event date, guests and room are set in large type. The date is qualified by weekday and lead time ("Saturday, in 8 months").
  - Then come contact links, the client's message as a quotation, and the next step with a New → In review → Decision path.
  - **Start review** happens at once and says "Only your team sees this stage. Nothing is sent to the client." A quiet "Start review with a note" keeps the timeline note.
  - **Approve…** and **Decline…** open an inline confirmation that names the address the email goes to. The note field says whether the note stays on the timeline (approval) or is quoted to the client (decline).
  - If someone else moved the enquiry first (HTTP 422), the panel re-reads it and says where it now is.
  - An approved enquiry offers **Create opportunity** as its next step. "Open their layout", the AI drafts (mounted only when opened) and the timeline follow.
- **Nothing open:** the panel proposes the next move. It shows the longest-waiting new enquiry, or the enquiries waiting for a decision, or a sealed "All caught up", with a quiet count of status changes made this session. (The keyboard legend was removed on Blake's decision of 26 September.)
- **Widths:**
  - At 1180 px and wider, the list and panel sit side by side.
  - Below that they take turns, with "Back to enquiries".
  - At 760 px and narrower the sheet goes full bleed and the stages fold into a 3 × 2 grid. This also fixes the old 390 px sideways scroll.

### Motion, focus and contrast

- **Motion:** the app's global cockpit spring (every button grows 6% on hover) made each list row swell under the pointer. `index.html` now lets a surface opt out with `[data-calm-controls]`. The `:where()` keeps the global selectors' specificity unchanged, and no other surface changes. The desk keeps press feedback (`scale(0.97)` on buttons, `scale(0.995)` on rows), 120 ms colour hovers gated to fine pointers, and the stamp. Reduced motion removes all transforms and the stamp.
- **Focus rings:** focus is an ink ring on ivory and copper, and a cream ring on forest. The app's cyan ring measures about 1.4:1 on ivory, under the 3:1 a focus indicator needs.
- **Contrast:** every text pair measures at least 4.5:1, and large numerals and graphics at least 3:1. The lowest is ink-3 on the selected row, 4.59:1. The table is in the session note.

## Decisions for Blake

1. **Order:** new enquiries are listed newest first (T-632). Oldest-first would put the longest wait at the top; the panel already offers it as the next move.
2. **Start review without confirmation:** it sends nothing and cannot hurt the client. It is the most frequent action, and the note stays one click away.
3. **The session tally** ("3 enquiries moved forward this session"): small-wins feedback that is kept only in the browser. Remove it if it feels like surveillance.
4. **The greeting by first name:** remove it if it feels too familiar for the team.

## Image-generation prompts for exploring alternatives

Each prompt produces a single flat UI screenshot, not a device mock-up. Use a 16:10 aspect ratio for desktop and 9:19.5 for phone.

**A — the desk, as built, for comparison**

> High-fidelity desktop web app screenshot, 16:10, of a venue sales team's "Enquiries" desk for Trades Hall Glasgow, a Georgian events venue. Luxurious editorial software, calm and precise. Muted sage-green background (#819087) with a large paler tilted plane behind. Left: a warm ivory paper sheet (#F2EDDD) with a slightly tilted right edge; small caps line "THURSDAY 24 SEPTEMBER · GOOD MORNING, ELAINE"; huge elegant serif heading "Enquiries" (Newsreader-like); one serif sentence: "4 new enquiries are waiting for a first look; the longest-waiting arrived 6 days ago." Below, a pale copper (#DEB599) tilted band breaking past the sheet's left edge holding six large light-weight numerals separated by hairline rules: 4 New, 3 In review, 3 Approved, 1 Declined, 1 Withdrawn, 12 All. Then a ledger grouped under small caps "TODAY", "YESTERDAY": each row has a small calendar tile (SAT / 5 / JUN '27), a serif client name "Sarah Henderson", grey sans details "Wedding · 140 guests · Grand Hall", an italic quoted line from their message, and on the right a soft copper pill "New" with "2 hours ago". Right: a deep forest-green panel (#264337) with a thin skewed inner frame line, cream serif name "Elspeth Grant", three large numerals with hairline dividers "2 Oct 2026 | 50 guests | Reception Room", a cream primary button "Start review". Inter for UI text, generous whitespace, crisp legible text, no lorem ipsum, no glassmorphism, no neon, no drop-shadowed cards, no stock dashboard widgets.

**B — more sublime: the room itself as the reward**

> Same desk and palette as a luxurious staff tool, but the forest decision panel opens with a wide photograph of a vast Georgian hall with gilded coffered ceiling, crystal chandeliers and tall arched windows at dusk, fading down into deep forest green. Over the fade, in cream serif: "Sarah Henderson", then large light numerals "5 Jun 2027 · 140 guests · Grand Hall". The feeling of standing in an enormous, awe-inspiring room while fully in control: precise typography, one cream action "Approve…", quiet hairlines. 16:10, flat UI screenshot, legible text, no people, no fake logos.

**C — phone triage**

> Tall phone screenshot (9:19.5) of the same Enquiries desk for a venue sales executive on the move: ivory background, serif "Enquiries", a copper band with six stage counts in a 3 × 2 grid (4 New, 3 In review, 3 Approved, 1 Declined, 1 Withdrawn, 12 All), then list rows each led by a calendar tile (SAT 5 JUN), serif name, "Wedding · 140 guests · Grand Hall", a copper "New" pill and "2 hours ago". Thumb-friendly spacing, crisp text, no device frame.

**D — "All caught up"**

> Desktop 16:10 UI screenshot, same palette: the forest decision panel shows a fine engraved-looking copper seal with a check mark, a cream serif heading "All caught up", and "Nothing is waiting on you. New enquiries appear here as they arrive." Beside it the ivory ledger with every row marked by soft sage "Approved" pills. Quiet, satisfying, dignified, like closing a leather-bound ledger at the end of the day. No confetti, no emoji.

## Evidence

Browser captures from the mocked-API harness are in this folder:
- [before/after with the same enquiries](enquiries-desk-before-after.webp)
- [the desk](desk-overview.webp)
- [an open enquiry](desk-open-enquiry.webp)
- [the decline confirmation](desk-decline-confirmation.webp)
- [all caught up](desk-all-caught-up.webp)
- [tablet](desk-tablet.webp)
- [phone list and detail](desk-phone.webp) The unit tests and the Playwright paging and triage spec are listed in the session note for 24 September.

## Known limits

- The desk re-reads the six stage counts after every change. That is cheap, but it is 6 small requests where a single counts endpoint would be 1.
- The session tally resets when the page reloads.
- Room photographs (Trades Hall venues only) come from the Diary's supplied set.
- Blake's acceptance and a physical-device qualification remain open.
