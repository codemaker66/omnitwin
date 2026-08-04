# Calendar/Scheduling Interaction Design Pattern Catalogue — Research Brief 4.2 (Venviewer Command Centre)

## TL;DR
- **For a staff-facing multi-room command centre, the reference implementation to steal from is Bryntum Scheduler/Scheduler Pro** (configurable snapping at a set 5–60 minute resolution, resource-lane drag, `validatorFn` drop-rejection, drag-from-grid backlog trays) fused with **Linear's interaction polish** (Cmd+K command palette, optimistic UI with rollback, keyboard-first model) and **Resource Guru's clash-management pattern** (block the overbook, offer Waiting List / overtime / extend-availability alternatives inline).
- **The single highest-value pattern for the venue use case is the multi-lane resource timeline with an unscheduled backlog tray** — rooms as fixed left-column lanes, bookings as events, and a side panel of unassigned bookings you drag onto lanes (proven by ServiceTitan's dispatch-board "Holding Area" and Skedulo's swimlanes).
- **Avoid**: Notion Calendar's hidden event-creation model (no obvious "new event"), continuous free-form snapping without a visible increment, and any pattern that silently allows double-bookings — for a venue, conflict prevention must be loud and inline.

## Key Findings

1. **Drag mechanics**: Bryntum is the most configurable reference. Snapping is opt-in (`snap: true`) at a set time resolution — per Bryntum's official Time resolution demo, "you can snap in any increment between 5-60 minutes. Note how drag, resize and create operations are affected by having Snap checked or not." Modifier-key copy is built in: per the Bryntum changelog, "the copyKey property of the EventDrag feature now defaults to the default copy key of the native OS (Meta-key for Mac and Ctrl for Windows)." Live time labels during drag come from the drag tooltip; invalid drops are signalled via `validatorFn` returning `{valid:false, message:...}`, which tints the drag proxy and shows an inline reason.
2. **Keyboard models**: Vimcal, Notion Calendar, Fantastical, Amie and Linear are all keyboard-first. Cmd/Ctrl+K is the near-universal command-palette convention. Fantastical's NLP parser is the gold standard for natural-language event creation. Notion Calendar exposes the full shortcut sheet via `?`.
3. **Multi-lane timelines**: Bryntum, TeamGantt, Float, Skedulo and ServiceTitan all use a frozen left column of resource rows + horizontal time axis. ServiceTitan's "Holding Area" and Skedulo's swimlanes are the backlog-tray reference; Skedulo highlights valid drop slots green and invalid grey.
4. **Conflict visualisation**: Resource Guru's clash-management engine is best-in-class for resource scheduling — it blocks the overbook and offers three inline options. Day/week overlap uses interval-partitioning (side-by-side columns).
5. **Undo/optimistic UI**: Linear is the benchmark — optimistic writes applied instantly on the client and rolled back if the server rejects, backed by a local-first sync engine.

## Details

### Pattern 1 — Drag Mechanics
**Who does it best: Bryntum Scheduler/Scheduler Pro**, because every facet is a documented, inspectable config.

- **Creation by drag / move / resize**: Standard across Bryntum, Resource Guru, ServiceTitan, Skedulo, TeamGantt. Skedulo lets you manipulate a job card in the swimlane in five-minute steps and resize for duration. Resource Guru supports expand/split/duplicate directly on the schedule.
- **Snapping**: Bryntum's snap is explicit and increment-based — its Time resolution demo confirms you "can snap in any increment between 5-60 minutes," affecting drag, resize and create operations. This is the pattern to copy — a *visible, discrete grid increment* (e.g. 15 or 30 min) rather than free-form. Bryntum also snaps to resource rows via the `snapToResource` config with a configurable pixel `threshold` (default example 30px).
- **Ghost/preview + live labels**: Bryntum shows a drag proxy plus a tooltip that updates start/end/duration live during drag and resize (the `tipTemplate`/`validatorFn` mechanism). Fantastical shows a live event preview you can drag to reposition, updating details automatically.
- **Invalid-drop feedback**: Bryntum's `validatorFn` returns validity + a message; invalid state adds a "no" cursor/tint and can show an inline tooltip explaining why (real demo messages include "Vehicle capacity is not enough" and "Overbooked"). On abort, the event bounces back to origin. ServiceTitan blocks reassignment of Working/Dispatched/Done jobs entirely.
- **Modifier keys**: Bryntum's `copyKey` copies instead of moves — the changelog confirms it "defaults to the default copy key of the native OS (Meta-key for Mac and Ctrl for Windows)." Resource Guru uses Shift+drag to copy; per its "Create Bookings" docs, you can "copy and paste a calendar event by using SHIFT+drag," with the cursor changing to a copy cursor. This Shift/Alt-to-duplicate convention is worth adopting.
- **Auto-scroll near edges**: Bryntum supports auto-scroll during drag (with documented bug-fixes around horizontal auto-scroll and drag-selection) and infinite timeline scroll.

**Steal**: discrete snap increment with live duration label; validatorFn-style inline rejection reason; Shift/modifier-to-copy; snap-to-resource-row. **Avoid**: free-form no-snap dragging (imprecise for room bookings); silently allowing an invalid drop to "stick".

### Pattern 2 — Keyboard Models & Command Palettes
**Who does it best: Linear (palette architecture) + Fantastical (NLP) + Vimcal (density of coverage).**

- **Command palette**: Cmd/Ctrl+K is the convention across Linear, Notion Calendar, Vimcal, Figma, Raycast. Linear's model — a centralised command registry where every action is a command, fuzzy-searchable, grouped by context, showing the bound hotkey next to each entry — is the architecture to copy. Notion Calendar's Cmd+K menu also surfaces the shortcut for each action (good for discoverability/learning).
- **Vimcal** (named after the Vim editor, brands itself "Superhuman for Calendar"): verified shortcuts are **Cmd+K** (command centre / natural-language bar; a review lists its options as "Select your availability / Create an event / Flash the shortcuts / Time travel"), **D/W/M** for day/week/month views (confirmed in Vimcal's own newsletter: "you can just press 'D' in your calendar to switch it to day view? Pressing 'W' switches to week view, and 'M' brings up month view"), and **A** for availability/slots ("Click the letter 'A', then drag the available slots on your calendar"). Vimcal's homepage claims "instant response times (<100ms) and shortcuts for everything." Create-event ("C"), jump-to-today ("T"), and J/K navigation are plausible (mirroring Google Calendar/Vim) but are NOT documented in public sources — treat as unconfirmed.
- **Fantastical NLP**: the parser understands "[event name] at [location] [date/time] [alert] [URL] [calendar name]", `/calendarname` to target a calendar, `:weekly`/"every Tuesday" for recurrence, "with [name]" for invitees, quotes to protect literal text, and shows the parsed result live as you type. This is the gold standard for typed event creation.
- **Notion Calendar**: `?` opens the searchable full shortcut list; `S` shares availability; `P` overlays a teammate's calendar; number keys change the multi-day view span. Notably criticised for hiding event creation — there is no obvious Cmd+N; you must navigate to the date and drag. This is a cautionary tale.
- **Navigation/manipulation**: Notion number keys (1–9) for day-count; arrow-key event nudging and Cmd+D duplicate appear in Notion's block model and are worth mirroring for events.

**Steal**: Cmd+K registry with inline hotkey hints; `?` to reveal all shortcuts; Fantastical-grade NLP quick-add; single-letter view switches (D/W/M). **Avoid**: hiding the primary create action behind obscure gestures (Notion Calendar's cardinal sin for a tool coordinators live in).

### Pattern 3 — Multi-Lane / Resource Timeline (Highest Priority)
**Who does it best: Bryntum (engine) + ServiceTitan & Skedulo (dispatch/backlog UX).**

- **Lane/row headers**: Frozen left column with resource name/avatar is universal (Bryntum uses "frozen grid columns on the left with the Scheduler timeline... occupying the remaining available space"; TeamGantt; Skedulo swimlanes). Bryntum supports hierarchical/nested resource data with collapse/expand and infinite resource scroll.
- **Grouping/nesting**: Group by team/room/type — Bryntum tree-group mode; Resource Guru groups by department and filters by skills/custom fields; ServiceTitan groups by Business Unit/Zone/skill.
- **Time axis tiers**: Header tiers (month/week/day/hour) via Bryntum ViewPresets (e.g. `hourAndDay`, `weekAndMonth`). Weekend/working-hours shading via Bryntum's `stripe` feature and TimeRanges; Skedulo shades availability white and unavailability grey; Motion shades blocked/unavailable time with diagonal grey.
- **Zoom**: Bryntum offers discrete zoom levels (an ordered `zoomLevels` array) plus Ctrl+mouse-wheel continuous zoom (`zoomOnMouseWheel` default on), pinch-zoom, and `zoomToSpan`/zoom-to-fit. Note documented rough edges: zoom can "get stuck" if preset order is wrong, and presets must be sorted zoomed-out→zoomed-in. TeamGantt uses simpler discrete day/week zoom (60% week view = 36 months max out).
- **Virtualisation feel**: Bryntum uses row recycling + infinite scroll for hundreds of rows / thousands of events, and caps time-axis ticks at 10,000 to protect performance. TeamGantt/Float scale to large teams. Watch for recycling artefacts on rapid zoom (Bryntum's changelog documents several such fixes).
- **Now-line**: Current-time indicator is standard (Bryntum TimeRanges with a "current time line"). Treatment: coloured vertical line with a time label; auto-scroll-to-now on load is expected.
- **Backlog/unscheduled tray**: THE key venue pattern. ServiceTitan's "Holding Area" is, per its designer's case study, "a Visual Staging Zone for Unassigned Jobs on the Dispatch Board" that exists specifically because "many customers create dummy technicians or fake teams just to have jobs appear near the techs... The Holding Area removes this need"; ServiceTitan's help docs call it "a helpful replacement for using dummy technicians." Skedulo's "Quick Create Job" produces a card you drag into a swimlane, and it highlights valid time slots green / insufficient slots grey. Bryntum's "drag from grid" demo is the reference implementation (external grid of unplanned tasks → drop on scheduler). ServiceTitan's redesign also added a **"Click-to-drop"** alternative (select item, then click destination) that, per the case study, "aligns with WCAG 2.2 requirements" because traditional drag-and-drop "requires precise mouse or touch movements, which are not possible" for keyboard-only users or those with motor impairments — important for a command centre.

**Steal**: rooms as frozen lanes; backlog tray with drag-to-lane AND click-to-place; green/grey slot highlighting on drag; discrete zoom presets with Ctrl+scroll; now-line with auto-scroll. **Avoid**: dummy-resource workarounds for unscheduled items (ServiceTitan explicitly built the Holding Area to kill this anti-pattern); continuous-only zoom with no snap to sensible tiers.

### Pattern 4 — Density Modes
**Who does it best: Notion Calendar (interface scale + hour zoom) and ServiceTitan (chip degradation).**

- Notion Calendar offers "Interface scale" (Zoom In/Out/Actual) and "Zoom Hours In/Out" to change vertical density, plus a collapsible all-day section. This maps well to compact/comfortable/spacious toggles.
- **Chip degradation**: ServiceTitan job bubbles show as many tags as fit and reveal the rest on hover; it recommends short tags/emojis to keep bubbles legible. This is the model for graceful truncation + hover-overflow.
- **Many short bookings in a lane**: Bryntum adjustable row height + bar margin (live sliders in the demo); event layout handles overlapping bars within a tall row.

**Steal**: an explicit density toggle (Notion's three-level scale) + hour-zoom; tag/label truncation with "+N more" on hover; adjustable row height. **Avoid**: fixed row heights that clip dense days.

### Pattern 5 — Conflict / Overlap Visualisation
**Who does it best: Resource Guru (resource clashes) + interval-partitioning (day-view overlap).**

- **Resource schedulers**: Per Resource Guru, it "makes it nearly impossible to overbook team members because we automatically notify you when it's about to happen. Our innovative clash management engine cross-references new bookings with your team members' availability, alerting you when there's a scheduling conflict." On a clash, its help docs state "you'll see a Booking Clash with three options"—**Add to Waiting List**, **Add With Overtime**, or **Add without overtime (extend availability)**—and the overtime "is elastic, meaning that it is ✨ automagically ✨ removed if time becomes available again" (shown as a red bar + red date background). Float alerts on resource conflict and on assigning to non-work days, with red overallocation indicators. Timewatch Whitespace can either warn or hard-block, highlighting conflict days red and disabling already-busy resources in the picker.
- **Soft vs hard conflict**: Resource Guru distinguishes tentative bookings (soft) from confirmed. Teamup lets a sub-calendar be configured to allow overlap (green arrow) or forbid it (red cross → error prevents save). This soft/hard distinction is exactly what a venue needs (e.g. a "pencilled-in" hold vs a confirmed booking).
- **Day/week overlap rendering**: Interval-partitioning algorithm — sort by start, assign to minimum columns, side-by-side widths (the Google Calendar / react-big-calendar approach). Bryntum has `allowOverlap` and its own overlap layout.
- **Conflict explanation surfaces**: Skedulo has a "Rule conflicts console" — a dynamic list of all detected scheduling conflicts you can assign to users to resolve. Dynamics 365 Field Service shows a conflict icon + "Operation Details" explaining exactly what changed.

**Steal**: block-and-offer-alternatives on conflict (Resource Guru); soft (tentative) vs hard (confirmed) visual distinction; a central "conflicts to resolve" list; inline tooltip explaining *why* it conflicts. **Avoid**: silent overlap stacking that hides a double-booked room; warning-only with no next step.

### Pattern 6 — Hover Cards & Previews
**Who does it best: Notion Calendar (right context panel) + Linear (hover polish).**

- Notion Calendar uses a persistent **right context panel** for event details (status Busy/Free, Public/Private, participants, rooms, linked Notion docs) rather than a floating card — and shows a **warning sign next to the event name if a room becomes unavailable**. Hovering a database item offers a quick-edit pencil.
- ServiceTitan job bubbles show a hover pop-up with detailed job info; Vimcal lets you hover a meeting to see details and launch the call without clicking.
- Bryntum `eventTooltip` with `hoverDelay` (a documented bug: tooltip showing immediately on Shift+click despite a configured delay — so delay timing matters).
- Linear is the polish benchmark: hover cards with consistent 4px spacing, muted colours, progressive disclosure, sub-100ms transitions.

**Steal**: right context panel for full detail (persistent, doesn't occlude the grid) + lightweight hover card for at-a-glance; room-unavailable warning badge; configurable hover delay (~300–500ms) so cards don't flicker during scanning. **Avoid**: instant-fire hover cards that occlude while a coordinator sweeps the timeline.

### Pattern 7 — Undo/Redo & Optimistic UI
**Who does it best: Linear (undisputed benchmark).**

- Linear's optimistic UI: changes appear instantly, the API call happens in the background, and roll back only if the server rejects; backed by a local-first sync engine (IndexedDB, operation ordering, merge logic). This is attributable to Linear CTO/co-founder Tuomas Artman's Local-First Conf talks; on boot Linear reads from IndexedDB into an in-memory MobX object pool and "every UI query hits that local pool, not a server," and Artman has noted "the first lines of code that I wrote was the sync engine." Writes are queued when offline and rebased on reconnect. Critically, "this pattern only works when the design communicates certainty" — animations signal "done," not "processing."
- Toast-with-undo is standard; TeamGantt has undo but a documented weakness: undoing a dependency cascade shows all 50 downstream changes rather than the single cause — a lesson in *granular, cause-level undo*.
- Bryntum has real-time revisions / a state-tracking manager (STM) for undo/redo in scheduler contexts.

**Steal**: optimistic apply + rollback-on-reject with a clear toast ("Booking moved — Undo"); Cmd+Z; queue-and-rebase for flaky venue Wi-Fi. **Avoid**: spinners on every drag (kills the "instant" feel); undo that dumps a wall of cascaded changes instead of the one action.

### Pattern 8 — Empty / Loading / Error States
**Who does it best: Linear (skeletons over spinners).**

- Linear uses skeleton placeholders matching the shape of incoming data rather than spinners, and no full-page reloads (SPA view transitions keep spatial context). Onboarding is deliberately thin (no guided tour) — a *weakness* for a mixed-skill venue-staff audience.
- Vimcal's onboarding is the counter-model: a guided interactive sandbox where users practise dragging availability, ~10 minutes, with prompts along the bottom. This is better suited to training duty managers.
- Skedulo/ServiceTitan show empty backlog tabs (Unassigned/Alerts/Hold) and troubleshooting states (e.g. unassigned jobs live in the tray, not the board).

**Steal**: skeleton timeline grid on load; auto-scroll-to-now once loaded; Vimcal-style interactive onboarding sandbox for new coordinators; explicit empty-lane ("no bookings — drag from tray") and offline banners. **Avoid**: Linear's zero-onboarding stance for non-expert staff; spinners that reset scroll position.

### Pattern 9 — Mobile Timeline Interaction (concise — phone is a separate ops mode)
- Field-service tools are the reference: Skedulo pushes schedules to a mobile app with SMS/push; ServiceTitan Mobile is what technicians see when dispatched. Both keep the *dispatcher* board desktop and give the field worker a simplified per-day list, not the full timeline.
- Bryntum is touch-capable (pinch-zoom via `zoomOnMouseWheel`/pinch) but has documented iPad issues (event drag triggering timeline scroll instead of drag) — a warning that drag-to-move is fragile on touch and long-press-to-drag with larger handles is safer.
- Notion Calendar mobile restricts editing of events not created on mobile; Linear's mobile "keyboard-first advantage vanishes."

**Steal**: for the phone ops mode, mirror Skedulo/ServiceTitan — simplified per-lane/day list + long-press to move with touch-sized handles, not a scaled-down desktop timeline. **Avoid**: cramming the desktop multi-lane timeline onto a phone.

## Recommendations

**Stage 1 (MVP — build the spine):** Implement the multi-lane resource timeline on the Bryntum Scheduler engine (or an equivalent with the same capabilities): rooms as frozen left-column lanes, bookings as events, 15-min discrete snap with live duration tooltip, snap-to-lane, now-line with auto-scroll. Add a Cmd+K command palette (Linear-style registry) and a backlog tray with drag-to-lane + click-to-place (ServiceTitan Holding Area pattern). Ship optimistic UI with rollback + toast-undo from day one.
- *Benchmark to advance:* coordinators can create/move/resize a booking in ≤3 interactions and the drag feels sub-100ms.

**Stage 2 (make it safe):** Add Resource Guru-style clash management — block hard double-bookings of a room, offer inline alternatives (tentative hold / alternative room / waiting list). Distinguish soft (pencilled) vs hard (confirmed) bookings visually. Add a central "conflicts to resolve" list and inline "why this conflicts" tooltips.
- *Threshold to change plan:* if coordinators frequently need *intentional* overlaps (e.g. shared foyer), switch from hard-block to warn-and-confirm per resource type (Timewatch model).

**Stage 3 (power-user speed):** Add Fantastical-grade NLP quick-add ("Wedding in Grand Hall Saturday 6pm–11pm"), full `?` shortcut sheet, D/W/M view switches, density toggle + hour zoom, hover card + right context panel with room-unavailable warning badge.

**Stage 4 (resilience & onboarding):** Skeleton loading, offline queue-and-rebase (venue Wi-Fi), Vimcal-style interactive onboarding sandbox for new duty managers, and a simplified mobile per-lane day list for the separate phone ops mode.

## Caveats
- Several Bryntum specifics come from support-forum threads and changelogs (documenting *bugs* as well as features) — verify current behaviour against the live demos before committing, especially zoom-preset ordering and iPad drag.
- Vimcal's full keyboard map could not be fully verified from public sources (the authoritative list lives inside the JS-rendered app); the C/T/J-K keys are inferred, not confirmed. Verified keys are Cmd+K, D/W/M and A.
- "<100ms" (Vimcal) and Linear speed figures are vendor/marketing or secondary-blog claims, not independent benchmarks.
- Motion, Amie and Notion Calendar are consumer/prosumer single-user tools; their conflict handling (auto-block personal double-booking) does not translate directly to multi-resource venue scheduling.
- Some review sources (efficient.app, ellieplanner, toolguide) are affiliate/marketing-adjacent; treat feature claims as directional.

### Where to visually verify these patterns
- **Bryntum interactive demos**: `bryntum.com/products/scheduler/examples/` (time-resolution/snapping, drag-from-grid backlog, validation), `bryntum.com/products/schedulerpro/examples/`.
- **ServiceTitan dispatch board**: `help.servicetitan.com/docs/use-the-new-daily-and-weekly-dispatch-board` and the designer teardown at `shunsukehayashi.com/dispatch-board` (Holding Area, click-to-drop, WCAG rationale).
- **Skedulo swimlanes**: `support.skedulo.com` (vertical/horizontal swimlanes, green/grey slot highlighting).
- **Resource Guru clash management**: `help.resourceguruapp.com/en/articles/2942080` (Waiting List / overtime) and `.../1955394` (Shift+drag copy).
- **Fantastical NLP**: `flexibits.com/fantastical/help/adding-events-and-tasks`.
- **Notion Calendar**: `notion.com/help/notion-calendar-keyboard-shortcuts`, `.../manage-your-calendars-and-events` (right context panel, room-unavailable warning).
- **Linear speed/optimistic UI**: `performance.dev/how-is-linear-so-fast-a-technical-breakdown`, plus Tuomas Artman's Local-First Conf talks; design teardown at `925studios.co/blog/linear-design-breakdown-saas-ui-2026`.
- **Vimcal**: `vimcal.com`, onboarding teardown at `goodux.appcues.com/blog/vimcal-calendar-onboarding`.
- **TeamGantt drag/dependencies**: `support.teamgantt.com/article/8-dependencies`.