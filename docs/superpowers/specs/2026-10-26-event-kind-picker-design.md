# The planner asks what the event is (T-674)

Design, 26 Oct 2026. Owner: planner-qol (local_aac7112a). The chair that follows the event is lane E's (E12).
Blake judges the look from frames in the product before it ships.

## Why

Blake, 26 Oct 2026, verbatim:

> "For weddings, the chevari, for business events the pink chair. I'm wondering if when the user first opens the
> planner if it asks them what kind of event it's for with big panels like team fight tactics/Netflix if it's
> wedding, corporate, or something else — I want the ease of use and funness to be real but not have the user spend
> any more time than they need and this could speed it up for them. But for users that like to take their time we
> should make everything as fun as full of quality of life things that make every design choice highly appreciated for
> being super levels of ultimate polish."

One tap tells the planner what the room is for, so that its first answers are already right: the chair a new seat
gets, the shape Lay out starts with, and the words on the empty floor. The moment should feel like a game asking what
you want to play, never like a form.

## Goals

- A new, empty layout opens with the question "What are you planning?" and three big panels: **Wedding**,
  **Corporate event** and **Something else**. One tap answers it and puts the person in the room, set up for it. So
  do 1, 2 and 3, or Enter on the focused panel.
- Skipping costs nothing. "Not sure yet" or Escape skips, and the planner then behaves exactly as it does today. A
  tap outside the panels does nothing (my call): as with Netflix's and TFT's pickers, a stray tap must not lose the
  question.
- The answer is kept with the layout and never asked for again. A signed-in layout keeps it in
  `configurations.metadata.eventKind`. A guest's draft keeps it on this device, because there is no public metadata
  route.
- The answer can be seen and changed. The room header names it, and its menu changes it. Straight after a pick, a
  receipt line offers "Change", so undo is one action away on every width.
- The answer has real effects, and each one is true when it ships:
  - **The chair.** New seats get the gold Chiavari at a wedding and the pink chair (Burgess Turini 18/3) otherwise.
    This comes from lane E's E12 core on master. Seats already placed keep their chairs.
  - **Lay out's shape.** Lay out starts with round tables for a wedding or something else, and with theatre rows
    for a corporate event. The other shape stays one tap away, through the prompt's Back.
  - **The empty floor.** The empty floor's sentence names the event.
- It works in v1 at every width, which is production today. v2 mounts it with lane C's one line.

## Non-goals

- No new API route and no migration. The metadata column is JSONB, and the PATCH merges top-level keys.
- No change to seats already placed: there is no automatic chair swap.
- No fields (guest count or date) in the picker.
- These are follow-ups:
  - prefilling the enquiry form's "What are you planning?" (L1's file, after #227);
  - v2's dock card set by kind (lane C);
  - reading a linked event's type.

## Anti-goals: failures even if it works

- Interrupting work. That means asking on:
  - a layout with anything on the floor;
  - a layout opened from an event;
  - a layout locked for review or frozen in a phase preview;
  - a layout someone is only viewing.
- Asking twice for the same layout.
- A panel that promises what the planner does not do. There is no Chiavari line while new seats are Turini.
- A pick that does not stick. A guest who reloads must keep the right chair.
- A tap that waits. The picker answers a tap at once, even while the room is loading underneath.

## When it asks: one pure rule, `shouldAskEventKind`

It asks only when all four of these hold:

1. **The layout is open for editing.** The editor's `lockReason` is null (no review lock, no phase preview), and no
   timeline preview is showing.
2. **Nothing is on the floor.**
3. **The layout was not opened from an event** (`?eventId=`).
4. **Nothing answers the question already.** That means none of:
   - a stored `eventKind` key (absent means never asked; `null` means asked and skipped);
   - this device's record for a guest's draft;
   - a valid `?event=wedding|corporate|other` parameter on a guest's new draft.

A known answer is applied silently. The address's answer applies only to a guest's draft that has no answer yet: the
link it came by started the plan. It is kept on this device. The address never overrides an answer, and it never
answers a signed-in layout, so a link cannot change a layout's event (lane E's review).

**Opening writes almost nothing.** The one write on open is a claimed draft's device answer, which goes to the
layout. Everything else is written only when someone picks. A viewer who may not write (a non-owner, a view-only
share) is never made to try.

## The answer's record: `lib/event-kind-record.ts` (new)

- **The seam.** It reads and writes E12's `usePlannerEventStore` (`eventKind: "wedding" | "corporate" | "other" | null`).
- **Signed-in layout.** It calls `patchConfigMetadata(id, { eventKind })`, one write at a time in a tab. The answer's
  save state is one of three:
  - **kept:** written.
  - **retrying:** no network or a server error. The receipt says "Not saved yet". It is written again when the
    browser comes back online (`lib/online-status.ts`). If the same layout loads again meanwhile, the tab's answer
    stands and is written again.
  - **this-visit:** the server refused it (4xx, no permission). The receipt says "Kept for this visit only". It is
    not tried again, and the layout's own answer wins on the next load.

  A dropped connection never makes the planner ask twice.
- **A guest's draft.** It is kept in localStorage `venviewer.planner.eventKind` as
  `{ version: 1, entries: [{ configId, kind }] }`, newest first, with the latest 200 kept. It is validated on read,
  and a damaged record reads as empty. If storage is unavailable, the answer holds for this tab only.
- **When a layout opens.** The store is set from metadata (signed-in) or the device record (guest). It is reset when
  the layout changes. As built, `editor-store`'s `loadConfiguration` and `createPublicConfig` (lane E's file) hand
  the layout to `openLayoutEventKind`, with the metadata the load already holds. That is the only place an answer is
  read. A second read would leave a moment after a signed-in layout opens when a new seat still gets the unasked
  chair, and in unit tests it would be an unstubbed request.
- **A guest's draft that is claimed** into an account keeps its device answer, and the answer is written to the
  layout's metadata the next time the layout opens signed in.

## The look (Blake decides, from frames)

- **Over the room.** A lacquer scrim with no blur; the room's arrival continues underneath and shows through at the
  edges.
- **The words.** The heading is in Newsreader: "What are you planning?". One line in Inter follows: "One tap sets up
  the room for it. You can change it any time."
- **The panels.** Three tall panels on a laptop or desktop, and three wide panels stacked on a phone. Each has
  full-bleed art, a title in Newsreader, one true line in Inter and a key hint (1, 2, 3; hidden on touch).
- **One panel in hand.** The focused panel is the one in hand: the keys move it, and a mouse or pen carries it (the
  panel under the pointer takes the focus; a touch has no hover and does not). It lifts on a spring and shows its
  key, so there is never more than one lifted panel. Focus is read from the button itself, not React's onFocus: when
  the Grand Hall's welcome opens over the question (on previews, and once the captured hall is public) and then
  closes, the browser hands focus back to the panel in hand inside the commit that removes the welcome, while
  React's events are paused.
- **Motion, on springs.** Coming into hand lifts a panel on a spring (the house spring core). A pick grows the chosen
  panel while the other two fall away and the scrim lifts. Reduced motion uses opacity only.
- **Skip.** A "Not sure yet" text button sits under the panels.
- **The receipt.** It sits at the top centre, under the tool pill. It never covers the deck, where the next tap (Lay
  out) goes.
- **Tests.** The e2e suite runs on a device told not to ask, through the default `storageState` in
  `playwright.config.ts`. The picker's own cases use `?event-question=on`. The config edit puts the PR in the GPU
  benchmark scope; that is cheaper than editing thirteen specs owned by other lanes.
- **Art.** Two directions go to Blake as frames:
  - (a) the venue's own photographs, where they exist;
  - (b) the planner's own furniture as the hero: the Chiavari, the pink chair, and the hall for "something else".

  No art may show furniture the planner will not set.

## Accessibility

- It is a `role="dialog"` with `aria-modal`, labelled by its heading.
- The panels are buttons with full names, such as "Wedding: round tables and gold Chiavari chairs".
- Focus starts on the first panel, and Tab stays inside the dialog. Escape skips. Focus returns to the planner.
- Number keys work only while it is open.
- Touch targets are far above 44 px.

## Coordination

- **E.**
  - The E12 core on master: `plannerChairSlug` and its callers, the researched sizes, and the `eventKind` key in
    `ConfigurationMetadataSchema`. The picker cannot ship before it.
  - This PR carries E12's store byte for byte, `ConfigMetadataInput.eventKind`, and the two editor-store calls. E is
    asked to review those.
- **C.** One line in `PlannerChromeV2`; later, the dock's card set by kind.
- **L1.**
  - The enquiry prefill after #227.
  - The API's metadata merge is a read and then a write, with no lock (`routes/configurations.ts:236-279`). Two
    near-simultaneous PATCHes can therefore lose one key. The fix is an atomic `metadata = coalesce(metadata, '{}') ||
    $patch`.
- **L3.** The Assembly's first open is for saved layouts (#232), and the picker is for new ones, so they never
  overlap.
- **Orchestration-2.**
  - The gate.
  - An e2e admission for the new case.
  - Existing cases that open a fresh draft seed the device record in shared support, so their behaviour is unchanged.

## Proof

- **Unit:**
  - the rule;
  - the record: storage unavailable, a damaged record, the cap and validation;
  - hydration;
  - Lay out's shape by kind, from the deck and from the empty floor;
  - the header's menu;
  - the picker: keys, focus, skip and reduced motion;
  - the copy guard.
- **e2e:**
  - a fresh layout asks;
  - 2 picks Corporate, and Lay out offers Theatre;
  - a reload keeps the answer and does not ask;
  - after the Grand Hall's welcome, the first panel is in hand and the keys answer;
  - (a layout with furniture never asks: unit-tested.)
- **Frames for Blake,** on the product host, so the founder hold applies as on venviewer.com (the drawn hall, no
  capture notice):
  - 1366 × 768;
  - 1600 × 1000;
  - a phone at 393 × 852.
- **After deploy:** the live flow on venviewer.com.
