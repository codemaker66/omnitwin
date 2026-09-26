# Venviewer platform roadmap: making everyone's life easier

*Synthesis, 26 September 2026. Built from 13 read-only surface audits, one live screenshot sweep and four research reports. Nothing in the repository was changed to produce it.*

## How to read this document

**Evidence levels.** Each claim uses one of these levels:
- **Inspected:** source, CSS, committed baselines and the design record were read.
- **Computed:** WCAG contrast ratios were calculated from hex values.
- **Captured:** screenshots were taken at 1440×900 and 390×844 against a mocked API with seeded users. The dev server has since been stopped, and the harness lives only in the session scratchpad.
- **Inferred:** marked "(inferred)" wherever it appears.

**What was not done.** Nothing has been deployed, no production data was used and no real device was measured. Blake has not accepted anything here.

**How to read the scores.** Conformance scores are the auditors' judgements against `.claude/conventions/product-experience.md:13-28` and the Enquiries desk. They are not Blake's verdict: he remains the aesthetic judge (`product-experience.md:56`).

**Research limits.** Some competitor quotes come from search-engine summaries, because the review sites were blocked by the proxy. Treat them as leads.

**The standard.** Blake's supreme principle is recorded verbatim at `product-experience.md:5-9`: make everyone's life easier. His 26 September decisions set four things:
- **Reach:** every staff tool and everything clients receive, including the planner chrome (`:33`).
- **Hover:** remove the springy hover everywhere (`:34`).
- **Parity:** match Salesforce, Cvent, sales-and-catering systems, email, spreadsheets and paper (`:35`).
- **Next surfaces:** the Diary, then the hallkeeper and event-day tools (`:36`).

`AGENTS.md` makes Trades Hall the priority for open-ended product work.

**Headline findings**
1. Only the Enquiries desk meets the standard. About half of roughly 90 audited surfaces and patterns score 0–1.
2. Most of that gap comes from shared plumbing, not individual screens:
   - a global spring hover (`packages/web/index.html:95-113`);
   - a cyan focus ring that measures 1.22:1 on ivory (`packages/web/src/global.css:42-54`);
   - no shared ivory token layer (`packages/web/src/styles/house-tokens.css:22`);
   - a dark default ground under every unmigrated view (`packages/web/src/components/dashboard/DashboardLayout.css:92`).

   Fixing these once lifts every surface.
3. Several screens tell users something untrue or hide a consequence:
   - "Client link — sent", when nothing is emailed;
   - "the venue team has been notified", when nobody is;
   - a fake "Plan sent — within 24 hours";
   - one-click cancellation of confirmed bookings;
   - an Enter key on Cancel that places furniture.

   These are cheap to fix and should go first.
4. Beauty alone will not move a 50-year veteran off Salesforce or Cvent. Five capabilities stop a switch today: data import, a live mailbox, multi-channel enquiry intake, a UK quote engine with VAT, and contract plus deposit. All five are missing or only partly built.

---

## 1. Where we are

**Conformance scale**
- **0:** contradicts the brief.
- **1:** the old dark cockpit look, or broken.
- **2:** the right direction, with serious slog.
- **3:** close to the style, with fixable slog.
- **4:** near the standard.
- **5:** at the Enquiries desk standard.

Where two audits scored the same surface differently, both scores are shown (for example "1–2"). "Daily use" is the auditors' estimate; no usage telemetry exists, so all figures are inferred.

### 1.1 Shared shell, global styles and cross-app patterns

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Global styles, tokens, fonts (`index.html`, `global.css`, `house-tokens.css`, `styles/fonts/site.css`, `cockpit.css`) | Every signed-in role | Every screen, all day | 1 | (1) Every button outside the desk swells 6% and brightens on a spring; only `EnquiriesView.tsx:514` opts out (`index.html:95-113`). (2) The cyan focus ring `#87e7f0` measures 1.22:1 on ivory (`global.css:42-54`, `house-tokens.css:79`). (3) No shared ivory tokens (`house-tokens.css:22`): 18 surface prefixes, 12 different "paper" hexes and 250 distinct hexes across dashboard and shared code. |
| Dashboard shell: header, nav, More, account (`DashboardLayout.tsx`) | All staff roles | Constant | 3 | (1) Enquiries, Pipeline, Proposals and Client Search sit behind More, and a test enforces this (`DashboardLayout.tsx:199-214`, `__tests__/DashboardLayout.test.tsx:82`). (2) A dark forest `#132b25` ground sits under every non-desk view (`DashboardLayout.css:92`). (3) The header remounts on every route and flashes "Dashboard", then "Your venue", then "Opening venue…" (`DashboardLayout.tsx:151-167`; `api/spaces.ts:81-83`, uncached; inferred). |
| Notifications (`NotificationCenter.tsx`) | All staff | Should be glanced at all day; effectively unseen | 1 | (1) Hidden inside More with no visible count (`DashboardLayout.tsx:226`). (2) A near-black panel sits inside an ivory popover (`NotificationCenter.tsx:44-57`). (3) Loads once and never refreshes; a failed mark-read is silent (`:91-93`, `:104-118`). |
| View routing, denied states, arrival chain (`DashboardPage.tsx`, `ProtectedRoute.tsx`, `RouteArrival.tsx`) | All staff; suppliers who reach /dashboard | Every view switch and sign-in | 1 | (1) Developer copy: "The requested view \"admin\" is held back…" (`DashboardPage.tsx:103`). (2) The supplier denial is a dead end with no action (`ProtectedRoute.tsx:36-44`). (3) Arrival flashes dark, brown, dark, then ivory under a generic "Workspace" headline; no staff view sets the tab title (`RouteArrival.tsx:36`, `LoginPage.tsx:21-23`). |
| Toasts (`ToastContainer.tsx`, `stores/toast-store.ts`) | Staff | Dozens a day (69–94 `addToast` calls; the audits counted differently) | 1 | (1) The error toast covers the account name (baselines `desktop-reviews-action-error`, `desktop-loadout-caption-error`). (2) Tailwind blue, green and red; errors vanish after 4 s (`ToastContainer.tsx:54-59`, `toast-store.ts:31-34`). (3) The same failure is shown twice, as a toast and inline, in 8 of 10 files. |
| Status, confirmation and upload components (`StatusBadge`, `ConfirmModal`, `FileUploader`) | Staff, admins | Every client profile, delete and upload | 1 | (1) 6 of 7 badge tones fail AA, at 2.34–4.39:1 (`StatusBadge.tsx:5-13`). (2) The same enquiry is "Rejected" here and "Declined" on the desk (`ClientProfile.tsx:131`, `enquiry-desk-format.ts:29`). (3) A dark modal with a red confirm button by default (`ConfirmModal.tsx:39-56,76`), and a venue delete that overstates what it removes (`AdminPanel.tsx:754-756`). |
| Activity component and first paint (`Activity.tsx/.css`) | Everyone | Brief, constant | 3 | (1) The first paint is a dark `#171715` page in system-ui (`Activity.css:3-11`). (2) The panel capsule uses Geist Mono (`:54`). (3) "Opening venue…" reappears on every shell remount (`DashboardLayout.tsx:195`). |
| *Pattern:* consequential and destructive actions | All | Several times an hour | 2 | (1) Friction is inverted: removing a photo needs a modal (`LoadoutDetail.tsx:465-468`), while cancelling a confirmed booking is one click (`BookingDrawer.tsx:180-192,515-526`). (2) Approve emails the planner and the hallkeepers without saying so (`ReviewsView.tsx:515`; `api/routes/configuration-reviews.ts:146-161`). (3) Withdrawing a proposal silently breaks the client's link with a 404 (`ProposalsView.tsx:572-581`; `api/routes/proposals.ts:964-975`). |
| *Pattern:* error, denied and crash states | All | Rare, but decisive for trust | 2 | (1) `error.message` is rendered at 39 sites, including "Request failed (HTTP 500)" and endpoint paths (`api/client.ts:94,163-166`). (2) The hallkeeper 403 page offers "Try Again" (`HallkeeperPage.tsx:424`). (3) The error boundary is off-palette grey and navy (`error-boundary.tsx:66-90`). |
| *Pattern:* empty states and closure | Staff | Daily | 2 | (1) "Create one from an enquiry" with no link or button (`CommercialPipelineView.tsx:430-436`). (2) Only the desk marks a queue as done. (3) "No venues found." reads like a failed search (`AdminPanel.tsx:852`). |
| *Pattern:* forms and validation | Staff | Constant | 2 | (1) Enter does not submit the most frequent inputs; only 16 form elements exist app-wide. (2) Staff are asked for a UUID "Enquiry ID" (`CommercialPipelineView.tsx:384-397`). (3) Reasons for disabled buttons appear only in tooltips (`ProposalsView.tsx:566`). |
| *Pattern:* keyboard and focus | Heavy keyboard users | Continuous | 2 | (1) Focus is invisible on light surfaces. (2) Only the desk and the Diary support keyboard triage. (3) Back buttons unmount the focused element (`ReviewsView.tsx:447`, `ClientProfile.tsx:85`; inferred). |
| *Pattern:* dates, times and numbers | All | Every screen | 2 | (1) Nine calls pass no locale, giving "9/26/2026, 8:12:00 AM" (`ReviewsView.tsx:463,465,553,708`). (2) Follow-ups use the browser's time zone (`CommercialPipelineView.tsx:117`). (3) There are 14 separate date helpers, and money shows as "GBP 4,750.00". |
| *Pattern:* copy and vocabulary | All | Everything people read | 3 | (1) 17 raw enum renderings through `replace(/_/g,' ')`. (2) Title Case nav ("Pending Reviews", `DashboardLayout.tsx:38-53`). (3) About 43 "planning estimate / human review required" hedges. |

### 1.2 Enquiries desk (the reference)

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Enquiries desk: overview, open enquiry, phone (`components/dashboard/enquiries/*`, `EnquiriesView.tsx`) | Sales executives, bookers | All day | 5 | (1) Never named in the top nav; "More" is underlined while it is open (`desk-overview.webp`). (2) "Create opportunity" opens nothing, then toasts "Existing opportunity opened" (`EnquiriesView.tsx:461-472`). (3) Twin and website leads show a room the client never chose, with the source note as their quote (`api/routes/public-enquiries.ts:101-148`; `enquiry-desk-format.ts:65-68`). On phones the facts line truncates the room. |

### 1.3 Sales and CRM

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Commercial pipeline (`CommercialPipelineView.tsx`) | Sales executives; venue admins are shown it but the API refuses them | Meant to be several hours a day; two clicks deep | 1 | (1) Seven identical dark boxes laid out 3-3-1 (`:439-479`), with inline cockpit styles (`:54-107`). (2) Every deal created from an enquiry reads "£0.00 · Guest count pending guests" (`api/routes/crm.ts:133`; `:472`). (3) The UUID "Enquiry ID" form, plus an invalid automatic stage advance that fails silently (`:345-352`; `types/src/commercial-spine.ts:43-52`). |
| Proposals workspace (`ProposalsView.tsx`) | Sales, admins | Daily; 10–30 minute composing sessions | 1 | (1) Every new version starts blank (`:258-260,395-397`). (2) "Generate client link" actually sends the proposal and freezes it, and says neither (`:559-576`; `api/routes/proposals.ts:711-800`). (3) Status pills measure 1.70–3.77:1 (`:100-120`), and the list shows only 20 rows, oldest first (`proposals.ts:83-87,296-301`). |
| Client proposal page (`pages/ProposalPage.tsx`) | Clients | A few visits per event; the moment the booking is won | 1–2 | (1) Dark boxed graphite; the Cormorant font is not loaded on this route (`:27`). (2) No event date, guests or room in the payload (`web/src/api/proposals.ts:21-47`). (3) "The venue team has been notified" is untrue for proposals made in the dashboard (`:55`; `proposals.ts:155-156,199-200`). |
| Client search (`ClientSearchView.tsx`) | Staff, hallkeepers | Dozens of lookups a day, often mid-call | 0–1 | (1) Detail text in `#999` measures 2.85:1; "Converted" measures 2.28:1 (`:90-125`). (2) Searches only users, leads and configurations (`api/routes/clients.ts:30-130`). (3) A failed search shows only a toast (`:42`), and dates are US-formatted (`:124`). |
| Client profile (`ClientProfile.tsx`) | Staff | Every lookup | 0 | (1) Headings inherit colour, so text may be invisible on either theme (inferred; `:110,126`). (2) No deals, proposals, value or next event. (3) Not in the URL, so reload and Back lose it (`DashboardPage.tsx:201-210`). |
| Enquiry → contract → deposit journey | Sales, clients | The sales executive's whole day | 1 | (1) Four visual languages across one journey. (2) Hand-offs dead-end (`EnquiriesView.tsx:461-472`). (3) No contract or deposit exists (`docs/state/tasks.md:249` T-459 and `:365` T-094, both not started). |

### 1.4 Layout reviews and reference loadouts

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Pending reviews queue (`ReviewsView.tsx`) | Staff, venue admins | Daily triage, under a minute | 1 | (1) US timestamps with seconds, and no room, date or wait time (`:708`). (2) The "Open Review" email link falls through to the homepage (`configuration-reviews.ts:474`; `router.tsx:705-707`). (3) Rows swell to the viewport edge on hover (sweep `reviews-row-hover-pop.png`). |
| Review detail | Staff, venue admins | Minutes per layout | 1 | (1) The layout being approved is not on the page; reviewers open two new tabs (`:469-476`). (2) The presence pill measures 1.7:1 (`:154-165`). (3) The actions block disappears after each decision while context re-reads (`:324-327,482-486`). |
| Review decisions and NoteModal | Staff; affects planners and hallkeepers | Once per review | 0 | (1) Approve is one click, emails the planner and every hallkeeper, and freezes the sheet, all unstated (`:352-373`; `configuration-reviews.ts:606-687`). (2) Withdraw is terminal and silent, yet styled like Start Review (`:417-435,529-533`; `types/src/configuration-review.ts:72`). (3) Request changes hides that the note is emailed (`:590`; `configuration-reviews.ts:815-826`). |
| Reference loadouts library (`LoadoutsView.tsx`) | Hallkeepers, staff | Weekly | 1 | (1) A photo collection shown without photos, although `coverFileKey` is returned (`:270-285`). (2) Three names for one thing. (3) Nothing downstream ever shows these set-ups. |
| New loadout dialog | Hallkeepers, staff | Rare | 1 | (1) A full blackout modal for two fields (`:288-336`). (2) Enter does not submit. (3) The new loadout is not opened afterwards (`:162-182`). |
| Loadout detail (`LoadoutDetail.tsx`) | Hallkeepers, staff | Occasional | 1 | (1) The caption Save button is clipped (`:393`). (2) The `#999` fallback tile measures 2.59:1 (`:374-381`). (3) 11 px text links, and a delete that says "cannot be undone" although the API only soft-deletes (`:419-436,455`; `reference-loadouts.ts:204-232`). |

### 1.5 Analytics, settings, admin and onboarding

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Executive analytics (`ExecutiveAnalyticsView.tsx`) | GM, executives; the whole app for the "executive" role | Weekly glance | 1 | (1) Labels misstate the metrics: "utilisation" is accepted ÷ all quotes, "pipeline" is every quote ever (`api/services/revenue-analytics.ts:60-61,88-90`; routes `:331-332`). (2) Shows "GBP 4,750.00", raw enums and bad plurals (`types/src/revenue-analytics.ts:278-284`; `:141,160`). (3) Platform admins get a 400, and the "executive" role does not exist in `USER_ROLES` (`:57`; `types/src/user.ts:19`). |
| Venue settings (`VenueSettings.tsx`) | Admins | Rare | 1 | (1) The brand colour and "public preview" change nothing clients see (`use-planner-venue-identity.ts:50-53`). (2) Hex and logo-URL fields. (3) A planner can edit but saving returns 403 (`api/routes/venues.ts:111-128`). |
| Admin: registry, rooms, pricing (`AdminPanel.tsx`) | Platform admin | Bursts during onboarding | 1 | (1) Delete copy is untrue: it claims a cascade, but the API soft-deletes one row (`:755,770`; `venues.ts:136-150`). (2) "Tiered" pricing silently adds £0 (`api/services/price-calculator.ts:153-166`). (3) A backdrop click discards a drawn room outline (`:63-74`). |
| Clients & access onboarding (`OnboardingView.tsx`) | Platform admin | Per new client | 3 | (1) Raw enums in selects (`OnboardingSetupControls.tsx:7,43-59`). (2) 10.4–11.2 px chips and meta (`OnboardingView.css:75,77`). (3) No invitation email and no way to remove a leaver (`api/routes/onboarding.ts:295-337`). |
| Room outline editor (`PolygonEditor.tsx`) | Platform or venue admin | Rare | 1 | (1) Not operable by keyboard, which fails WCAG 2.1.1 (`:208-216`). (2) Mouse-only, freehand, no grid (`:70-77`). (3) Clear and Reset cannot be undone (`:183-191`). |
| Foundry release review | Platform operators | None; not mounted | 0 | Unstyled; the router comment is stale (`router.tsx:571-572`). |

### 1.6 Diary

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Diary frame: header, toolbar, loading (`pages/diary/DiaryBoardPage.tsx`) | Bookers, sales; hallkeepers read | All day | 2–3 | (1) About 13 equal-weight controls in one wrapping row, with no summary (`:618-711`). (2) The whole board blanks on every range change (`hooks/useCalendar.ts:77-79`, pinned by a test). (3) No way to go to a date: checking June 2027 takes about 39 "Later" clicks. |
| Week and fortnight overview (`BoardOverview.tsx`) | Bookers, sales | Dozens of scans a day | 3 | (1) Confirmed and provisional fills differ by only 1.08:1 in luminance (`diary-board.css:85-93`). (2) No decision date, owner or guests on the cards (`:61-75`). (3) Every card is its own Tab stop; there is no grid navigation. |
| Day view and timeline (`BoardGrid.tsx`) | Staff; hallkeepers on event days | Several times a day | 2 | (1) 9–10 px labels at 3.11–4.29:1 (`diary-board.css:136,144,169-178`). (2) Phase labels never render because of `font-size:0` (`:165`). (3) Day view opens on the empty small hours (sweep `diary-day.png`), and blocks scale by 1.06 on hover. |
| Side tray: Needs attention, enquiries, conflicts (`BoardPanels.tsx`) | Bookers | Several times a day | 2 | (1) "Needs attention" covers only the week on screen (`DiaryBoardPage.tsx:280`). (2) Enquiry slips drop the requested date (`:754-759`). (3) The 1st/2nd option ladder is hidden inside a collapsed Conflicts section (`BoardPanels.tsx:40`). |
| Booking drawer (`BookingDrawer.tsx`) | Staff (write); hallkeepers (read) | Every booking touch | 1 | (1) "Cancel the ink", Release and Mark lost are one-click terminal actions (`:180-192`; `types/src/booking.ts:87-98`). (2) Raw schema messages ("A hold requires decisionAt…") (`drawer-form.ts:177-186`; `booking.ts:146-151`). (3) Form-first layout, a false "You will own this pencil" (`:442`), and notes that disappear after creation (`:447-452`). |
| Transient layers: ink confirm, toast, palette, welcome | Staff | Many times a day | 2–3 | (1) The ink-move confirmation names no from/to (`board-copy.ts:170-175`). (2) The toast's focus ring measures 1.81:1 (`diary-board.css:34`). (3) The palette always picks the first result and cannot go beyond the loaded range; the first-visit modal blocks the board. |
| Read-only Diary for hallkeepers | Hallkeepers | Daily | 2 | (1) A disabled edit form instead of a facts sheet (`BookingDrawer.tsx:308,317`). (2) A pointless "Discard" button (`:465-467`). (3) The floor plan is unavailable to read-only users (`:471`). |
| Diary load error (sweep) | Staff | Rare | 1 | Shows the raw "Server returned an unexpected response shape for GET /calendar?…" string (`api/client.ts:165`). |
| Diary on phone (sweep) | On the move | Frequent | 2 | Controls fill the first screen, and the first booking sits about 630 px down. |
| Diary QA record (`design-qa.md`) | Platform team | Reference | 2 | Scoped to the week overview; its evidence is private; no committed Diary baseline exists. |

### 1.7 Inventory

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Inventory workspace (`dashboard/inventory/InventoryPanel.tsx`) | Venue admins | Daily to weekly; stocktake bursts | 3–5 | (1) The catalogue hides behind an unlabelled count (`:31,77-79`). (2) Rows and tiles take the spring hover. (3) The search border measures 1.49:1 (`InventoryStyle.css:20`), and Georgia is used instead of Newsreader (`:17`). |
| Reservation impact plane (`InventoryImpact.tsx`) | Venue admins | Every item opened | 3 | (1) The numbers vanish after every save (`InventoryDemand.tsx:80`; `InventoryPanel.tsx:73`). (2) Changing the period means a disclosure plus an Assess round-trip. (3) Captions show UTC offsets and IANA zone names (`inventory-window.ts:87-90`). |
| Stock correction pane (`InventoryEditor.tsx`) | Venue admins | Bursts of dozens | 3 | (1) Plain text quantity inputs, no steppers (`:31-36`). (2) The "serviceable" figure is hidden inside a disclosure (`:206-208`). (3) History sits three disclosures deep (`InventoryReceipt.tsx:125,135`). |
| Demand and decisions | Venue admins | Weekly | 1 | (1) A wall of bordered cards, not sorted by shortage (`InventoryDemandEvidence.tsx:19-35`). (2) Jargon and raw enums (`:51-57,73`). (3) The same caveat repeated five times. |
| Review drawers (reservations, requests) | Venue admins | Several a week | 2 | (1) A modal drawer replaces the side-by-side context. (2) A mandatory reason plus checkbox (`InventoryReservationReview.tsx:173-180`). (3) Receipts lead with UUIDs. |
| Loading, error, empty | Venue admins | Every open | 2 | The layout jumps, and the empty catalogue is a dead end (`InventoryPanel.tsx:70-72,90-91`). |

### 1.8 Hallkeeper and event day

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Hallkeeper event sheet (`HallkeeperWorkspace.tsx`, `HallkeeperPage.tsx`) | Hallkeepers and porters on phones | Continuous through setup | 2 | (1) Item names 12 px, quantities 11 px, zones 9 px, and 8 px on phones (`hallkeeper-workspace.css:2,17`). (2) Pages of five rows with 30 px arrows, and categories chosen from a native select (`:57-58,104`). (3) The setup deadline is never shown, and the default start is 18:00 UTC, so an hour late in summer (`api/services/hallkeeper-sheet-v2-data.ts:36,429`). |
| Day Board (`DayBoardPage.tsx`) | Hallkeepers, staff | Start of every shift, then all day | 2 | (1) Endless pulsing and breathing motion (`day-board.css:244-267`). (2) A legend that mislabels a tone; the turnaround warning measures 2.40:1 (`:182-186`; `DayBoardPage.tsx:163-180`). (3) No direct link to the setup sheet, and a US-format date input (`:62,128`). |
| Event-day ops board (`EventDayOpsPage.tsx`) | Hallkeepers, staff, planners | Hours on event day | 1 | (1) Dark cyan-and-amber cockpit at 800–950 weight (`EventDayOpsPage.css:1-9`). (2) Two task lists and two problem logs writing to different tables (`:457-467` vs `EventMissionControl.tsx:225-246`; services `event-day-ops.ts:423`, `event-mission-control.ts:690`). (3) Issues can be logged but never resolved; "Today's event" is hard-coded (`:223,345,477`). |
| Mission Control (`EventMissionControl.tsx`) | Duty managers, hallkeepers | Continuous on event days | 1 | (1) Acknowledgements dead-end once 10 newer events arrive; failures are silent (`:462,588`). (2) Incidents can never be resolved; `updateEventMissionIncident` is never imported (`:35-46`). (3) "Go live" is shown on every pending phase, then produces a misleading 409 message (`:547`; `services/event-mission-control.ts:574`). |
| Ops handoff pack (`OpsHandoffPage.tsx`) | Hallkeepers, staff | Before each event; printed | 1 | (1) Printing leaves near-white text on white paper, 1.13:1 (inferred; `OpsHandoffPage.css:414-440`). (2) The header leads with metadata ("Snapshot v4"). (3) The BEO is a monospace wall of text. |
| Client event page and schedule dock (`ClientEventPage.tsx`) | Clients | Occasional | 3 | (1) No event date, although the payload has it (`types/src/client-event-schedule.ts:14-23`). (2) A Refresh button sits in the reading line. (3) Raw "Europe/London" copy and two sub-AA labels (4.22 and 4.24:1). |
| Room plans library | Hallkeepers, staff | Occasional | 3 | Four labels at 3.21–3.64:1 (`hallkeeper-room-plans.css:3,5,10,20`). |
| Hallkeeper walkthrough (demo) | New staff | Rare | 2 | Linked from live work surfaces (`HallkeeperWorkspace.tsx:123`, `DayBoardPage.tsx:131`). |

### 1.9 Planner and editor

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Cockpit shell (`PlannerCockpit.tsx`, `ReferenceViewer.css`) | Clients; staff for hours | 20–60 minute sessions; staff longer | 1 | (1) 86 font-size declarations under 11 px. (2) 287 hex and 413 rgba literals, and four visual languages. (3) 11 unlabelled lens icons whose active state is hue-only (1.17:1); text cannot be selected, even in inputs (`App.css:19-37`). |
| Tool controls (`ToolPill`, "More" grid) | Clients, staff | Constant | 1 | (1) The More-grid Rotate and Delete buttons do nothing (`VerticalToolbox.tsx:1561-1563`). (2) A false "V" shortcut (`:1983`). (3) Save, Undo and Delete are hidden behind an unlabelled "…". |
| Command deck | Clients, staff | Continuous | 2 | (1) The state guidance is hidden on desktop (`ReferenceViewer.css:97-99`). (2) "Clear" drawing is unrecoverable (`stores/markup-store.ts:211-219`). (3) Jargon ("Laser", "Showcase", "Exit POV"). |
| Furniture catalogue | Clients, staff | Many opens per layout | 1 | (1) Subtitles measure 3.16:1; the search focus ring about 1.07:1 (`VerticalToolbox.tsx:2153-2158`). (2) A staggered animation replays on every open. (3) No owned-stock facts and no recently used items. |
| Chair count dialog (`ChairCountDialog.tsx`) | Clients, staff | Every table placed | 1 | (1) A modal for every table (`PlacementGhost.tsx:209-221`). (2) Enter on Cancel places chairs (`:191`). (3) Text at 2.55:1. |
| Side docks: layers, inspector, lenses | Staff | Always visible | 2 | (1) 200+ chair rows in Layers. (2) The inspector leads with CAD geometry. (3) Save state is a 9 px caption. |
| Save, send, review, share | Clients, staff | The conversion moment | 2 | (1) "Trades Hall" is hard-coded for every venue (`GuestEnquiryModal.tsx:254,596`), a tenancy bug. (2) "Client link — sent" when nothing is emailed (`ShareLensPanel.tsx:208`). (3) "Almost there" praise copy and generic status pills. |
| Event details panel (`EventDetailsPanel.tsx`) | Staff, planners | Once or twice per event | 2 | A backdrop click discards long text (`:376-387`); labels at 2.49:1; no focus trap. |
| 2D Blueprint (`BlueprintPage.tsx`) | Clients, staff, public | Occasional | 1 | (1) Enabled buttons that do nothing (`:836-858`). (2) The public demo shows a fake "Plan sent — our events team will respond within 24 hours." (`:294-298`). (3) A third palette with fake window chrome. |
| Timeline and schedule docks | Staff, clients | Always visible, collapsed | 1 | 7–8 px text; jargon subtitle; a dead "No event linked" dock. |
| Loading and error states | All | Every open | 1–2 | Raw error with only "Start a fresh draft"; no retry (`EditorPage.tsx:394-411`). |
| Mobile planner chrome | Clients, staff on site | Browsing | 2 | A fourth accent (wine); "Mesh/Splat/Hybrid" jargon. |
| Unmounted legacy chrome | None | Never | 0 | Stale shortcuts and palettes invite reuse (`CatalogueDrawer`, `BookmarkPanel`, `CockpitTopBar`, `App.css:84-259`). |

### 1.10 Event Architect and suppliers

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Event Architect (`EventArchitectPage.tsx`) | Staff | A few times a week | 1–2 | (1) A dark sci-fi grid under an ivory header (`EventArchitectPage.css:1-35`). (2) The facts that decide are buried in 0.75rem prose across three tall columns. (3) The final selection is not announced, and a refresh loses the run (`api/services/event-architect.ts:434-461`; `:523-530`). |
| Ops review evidence panel | Operations reviewers | Once per layout | 1 | 15 inputs, including three hand-typed SHA-256 digests; the decision defaults to "approved" (`EventArchitectOpsReviewPanel.tsx:57,192-206`). |
| Supplier portal (`SupplierPortalPage.tsx`) | External suppliers | Once or twice per event | 1–2 | (1) No date, room, address or quantities (`types/src/supplier-coordination.ts:207-229`). (2) Replies notify nobody (`api/routes/supplier-coordination.ts:596-638`). (3) Internal references such as "snapshot.totals" (`api/services/ops-compiler.ts:599-645`). |
| Supplier sharing, staff side | Coordinators | Per event, per supplier | 0 | No UI exists; the web client has no pack or share-token calls. |

### 1.11 Public site, authentication and twin

| Surface | Audience | Daily use | Conf. | Top three slog factors |
|---|---|---|---|---|
| Front door `/` (`RoomsHomePage.tsx`) | Public; staff pass through | Every visit | 2–3 | (1) Real room photos dimmed and blurred behind "Work in progress" labels (`RoomsHomePage.css:242-268`; `lib/splat-access.ts:4-6`). (2) No capacities, although they exist (`lib/trades-hall-venue-truth.ts:31-46`). (3) Staff links in the public nav, with no enquiry, contact or legal links (`:141-147,194-203`). |
| `/fresh` editorial homepage (also `/editor`) | Public | Minutes per visit | 4 | (1) "lit" measures 2.64:1 and animates forever (`fresh.css:336-352`). (2) The room is lost between the dossier and the composer (`FreshPage.tsx:321-330`; `RoomDossier.tsx:153`). (3) The client receives no copy of the enquiry. |
| `/landing` (the Rite) | Public, old bookmarks | Rare | 1–3 | Black first viewport; navigation delayed. |
| `/welcome` (Spotlight) | Public, old links | Rare | 1 | Dead navigation links (`spotlight-copy.ts:55-60`). |
| Living Hall and the splat hold page | Public | Rare | 2–3 | "Gaussian splat viewer" jargon, with "Work in progress" shown three times. |
| `/demo` showcase deck | Venue buyers | Per pitch | 3 | 7–9 px type; Elaine's name on a public URL (`DemoShowcasePage.tsx:61`). |
| Pricing (`PricingPage.tsx`) | Venue buyers | Once or twice | 0–1 | (1) Trial and scan buttons dead-end at an invitation-only register page (`:237,463,620,639`; `RegisterPage.tsx:40-42`). (2) "MOST POPULAR" on the only plan (`:399`). (3) Cockpit black and gold with endless glow animations. |
| Trades House leaflet and quiz | Public campaign | Rare | 2–3 | Internal review note shown publicly; external Google Fonts request; spring hover on answer cards. |
| Legal pages (`LegalPage.tsx`) | Public | Rare | 4 | Cockpit cursor and cyan focus halo leak in; no Venviewer customer terms. |
| Sign in, register, `/app`, access gate | Staff daily; invited clients | Seconds a day | 3 | Off-family type; the destination is never named; `/app` loading text measures 2.61:1 (`RoleAwareRedirect.tsx:24-33`). |
| OAuth consent | Staff connecting integrations | Rare | 1 | Dark cockpit; scopes may be near-invisible (1.05:1, inferred; `OAuthConsentPage.css:109-112`). |
| `/onboard` | Venue buyers | Once | 1 | A redirect to an invitation-only register page (`router.tsx:314-317,376-381`). |
| Twin walkthrough chrome (`twin/TwinViewer.tsx`) | Public; sales on calls | Minutes per visit | 2 | (1) Eleven competing HUD pieces. (2) 9.5–11.5 px uppercase monospace labels. (3) The room-specific enquiry is not wired up (`:1898`), and "See the plan" duplicates the PLAN switch (`:1910-1921`). |
| Twin enquiry modal and how its leads land | Clients; staff receiving | Per enquiry | 1 | (1) The room is lost, and the flagship room is written instead (`public-enquiries.ts:101-137`). (2) 13 px inputs trigger iOS zoom; borders measure 1.77:1 (`twin.css:635,639`). (3) The draft is lost on an overlay click, and failures show raw server text (`TwinEnquiryModal.tsx:109`). |
| Guided tour and room notes | Public (by design) | Unmounted | 2 | Room notes ship "Example" content (`tags/tag-copy.ts:54-64`). |
| Room walk, showcase, captures console, asset registry | Public or platform admins | Dev-only or rare under the splat hold | 1–2 | A generic dark SaaS showcase; raw "t469 … failure" text; a wall of dense cells. |

---

## 2. Surface rebuild order

### 2.1 How the order was set

Four inputs decide the order: the hours each audience spends on the surface per day (inferred; there is no telemetry), the size of the conformance gap, the founder's Trades Hall and next-surface priorities, and dependencies.

| Surface group | Primary audience | Est. hours per person per day (inferred) | Conf. | Founder signal | Depends on | Tier |
|---|---|---|---|---|---|---|
| Shared calm foundation | Everyone | All day | 1 | Hover decision (`product-experience.md:34`) | Nothing | **Now (first)** |
| Truth and safety fixes | Everyone | n/a | 0–2 | "Say real consequences" (`:17`) | Nothing | **Now (in parallel)** |
| Shell and navigation | All staff | All day | 3 | The reference desk is hidden | Foundation | **Now** |
| Diary and holds | Bookers, sales, hallkeepers | All day | 1–3 | Named next (`:36`) | Foundation, component kit | **Now** |
| Hallkeeper and event day, phase 1 | Hallkeepers, duty managers | Continuous on event days | 1–2 | Named next (`:36`); Trades Hall operations | Foundation, API timing fix | **Now** |
| Enquiries hand-offs and lead truth | Sales | All day | 5 / 1 | Reference surface | Pipeline deep link, API | **Now** |
| Sales spine (pipeline, proposals, clients, client proposal page) | Sales, clients | Several hours | 0–2 | Reach covers proposals (`:33`) | Kit, capability map, Blake's stage and email decisions | **Next** |
| Layout reviews | Approvers | Short, daily | 0–1 | — | Kit, snapshot data | **Next** |
| Planner chrome and placement | Clients, staff | Sessions; staff for hours | 1–2 | Reach covers planner chrome | Foundation, Blake's register decision | **Next** |
| Event day, phase 2 (merge and restyle) | Hallkeepers, duty managers | Event days | 1 | Named next | Blake's one-tool decision | **Next** |
| Public front door, twin, one enquiry form | Public, clients | Minutes | 1–4 | Editorial voice kept | Canonical homepage decision, API enquiry fields | **Next** |
| Inventory convergence | Venue admins | Daily to weekly | 3 | Origin of the selected style | Kit | **Next** |
| Supplier portal and staff sending | Suppliers, coordinators | Per event | 0–2 | Reach covers what clients receive | API facts, notification | **Next** |
| Analytics rebuild | GM, executives | Weekly | 1 | — | Blake's metric definitions | **Next** |
| Event Architect | Staff | Few times a week | 1–2 | — | Kit | **Next** |
| Sign in and OAuth | All staff | Seconds a day | 1–3 | — | Kit | **Next** |
| Settings, admin, onboarding, room editor | Admins, platform | Rare | 1–3 | — | Capability decisions | **Later** |
| Reference loadouts | Staff, hallkeepers | Weekly | 1 | — | Naming decision | **Later** |
| Pricing and marketing pages | Venue buyers | Once | 0–1 | Own voice | Commercial decisions | **Later** (honesty fixes Now) |
| Twin extras, captures, asset registry, Foundry | Public, platform | Rare | 0–2 | Splat hold (`docs/sessions/2026-09-19.md`) | Hold lifted | **Later** |

**Sequence.** N1 starts first and unlocks N2, N3, N4 and N6, which can run in parallel. N5 runs alongside everything from day one. Next items begin as their Blake decisions arrive.

### 2.2 Definition of done for every surface

Every item below must also meet this checklist. The acceptance criteria in 2.3–2.5 list only what each item adds.

1. **Browser evidence.** Committed Playwright baselines, built from synthetic fixtures, at the existing desktop (1440×900), tablet and 390×844 projects. They cover the ready, empty or caught-up, loading, error and denied states. The reviewed image set is linked from the task row.
2. **WCAG AA**, checked in the browser, not only on tokens:
   - axe-core reports no serious or critical violations;
   - text is at least 4.5:1, and large numerals, control boundaries and focus rings at least 3:1, computed from tokens and sampled in the browser;
   - a focus ring of at least 2 px on every focusable element;
   - targets of at least 24×24 CSS px, and primary actions at least 44 px;
   - 200% zoom and 320 px reflow without horizontal scroll;
   - no information available only on hover.
3. **Motion.** No transform or filter on `:hover`. Presses scale to 0.97 or less. `prefers-reduced-motion` removes every transform. The only infinite animation is the shared Activity indicator during real work.
4. **Type.** Staff and client surfaces use only Newsreader and Inter, plus Geist Mono for reference codes. Informative text is at least 12 px and reading text at least 15 px.
5. **Copy.**
   - Sentence case, using the shared vocabulary map.
   - No raw enum values, UUIDs, HTTP codes or endpoint paths.
   - No praise words or exclamation marks, enforced by a copy lint.
   - British, venue-local dates and times through `lib/venue-time.ts`.
6. **Consequences and feedback.**
   - Every external effect (email, send, sign, charge, publish, release) names who is affected and what happens before it runs.
   - Internal steps take one action and offer Undo.
   - No toast for a routine success.
   - Errors sit inline, next to their cause.
7. **States.**
   - Loading uses only the shared Activity component.
   - The last good data stays visible during a refresh or after an error.
8. **Keyboard.**
   - Lists support ↑/↓ or j/k, Enter and Esc.
   - Focus moves to the detail heading on open and back to the row on close.
9. **Roles.** Navigation and in-view controls come from the same capability map the API enforces. An end-to-end test runs for each role.
10. **Measurement.** A before-and-after task benchmark for the surface's headline task.
11. **Acceptance.** Passing checks does not mean accepted. Blake's aesthetic verdict is recorded separately.

### 2.3 Now

#### N1. Calm platform foundation (M–L; starts first; everything depends on it)

**Why now:** it touches every staff route all day; it scores 1; the hover decision has been made (`product-experience.md:34`); and every later rebuild would otherwise copy `--enq-*` by hand.

**Scope**

*Motion, cursor and scrollbar*
- Delete the spring, brightness and 0.93 press at `index.html:95-113`.
- Make the desk's calm behaviour the global default:
  - 120 ms colour hovers, only under `(hover:hover) and (pointer:fine)`;
  - `scale(0.97)` press on buttons and `0.995` on rows;
  - nothing at all under reduced motion.
- Then remove `[data-calm-controls]` (`EnquiriesView.tsx:514`).
- Remove the gold cursor (`index.html:77-79`) and the gold scrollbar on a dark track (`:138-168`), and fix the stale comment (`:73-76`).

*Focus*
- Replace `--vv-focus #87e7f0` (`house-tokens.css:79`) with two tokens:
  - ink `#14302a` on ivory and copper (12.07:1 and 7.52:1);
  - cream `#efe7cf` on forest (8.76:1).
- Use 2 px with a 2 px offset (inset −2 px on full-width rows), and remove the cyan halo (`global.css:53`).
- Delete the per-surface patches (`DashboardLayout.css:41-42`, `EnquiriesDesk.css:84-89`).

*Tokens*
- Add `[data-register="ivory"]` and `[data-register="forest"]` blocks to `house-tokens.css`, promoted from `EnquiriesDesk.css:9-47`.
- Add these new tokens:

  | Token | Value | Measured |
  |---|---|---|
  | control edge | `#747f6f` | 3.58:1 on the sheet; 3.12:1 on a selected row |
  | forest edge | `#86a192` | 3.88:1, replacing `#4d6c5c` at 1.86:1 |
  | forest field | `#1a3229` | — |
  | review dot on copper | `#77581a` | 3.50:1 |
  | heather, for AI drafts | per the research tone table | — |
  | loch, for estimates | per the research tone table | — |

- Add a 4 px spacing scale; radii of 0, 3, 4 and 999 px and 50%; two shadows (overlay and lift); and the motion tokens.
- Alias `--enq-*` to the new names during migration.

*Canvas*
- Set `color-scheme: light` on ivory registers (`global.css:6`).
- Make the html and body ground follow the register (`global.css:10-22`).
- Give staff paths an ivory boot using the existing pathname branch (`index.html:22-30,174-203`).
- Set the Activity panel capsule in Inter (`Activity.css:54`).

*Type*
- Newsreader, with optical sizing on, plus Inter.
- Replace literal Georgia in the shell and shared states (`DashboardLayout.css:21`, `global.css:97`, `NotificationCenter.tsx:146`, `RouteArrival.css:86`).
- Remove the `lining-nums` declarations that do nothing (`EnquiriesDesk.css:178,303,482`).

*Component kit v1* (detail in §4.1): StatusChip with the vocabulary map, ConsequenceConfirm, Notice and UndoToast (replacing `ToastContainer`), EmptyState, DateTile, the button family, Field, `lib/venue-time.ts` and `describeFailure`.

*Cleanup:* delete `.vv-status-chip` (`global.css:145-169`).

**Acceptance**
- A hover probe runs on 12 staff routes (`/dashboard?view=*`, `/diary`, `/hallkeeper/today`, `/ops/events/:id`, `/plan`). For every enabled `button` and `[role=button]`, computed `transform` and `filter` must be `none`. Today the probe finds `matrix(1.06…)` and `brightness(1.15)` (sweep `pipeline-card-hover-pop.png`).
- Tabbing through each route, sampled ring pixels are at least 3:1 against both neighbours on ivory, copper and forest, and no cyan ring appears anywhere.
- `src/__tests__/house-tokens.test.ts` asserts every pair in the design-language tone table, and fails if the control edge on a selected row drops below 3:1.
- Grep gates: no `#87e7f0`, no literal `Georgia` in staff CSS or TSX, and no `.vv-status-chip`.
- Trace screenshots of a cold `/dashboard` load show no frame with background luminance below 0.2 before the shell paints.
- One polite live region stays mounted at all times, and no `role=alert` is nested inside `role=status`.

#### N2. Shell and navigation (M)

**Why now:** every staff user uses it all day; the desk Blake likes is hidden; the header flickers on every move; and nav and API permissions disagree, producing 403 dead ends.

**Scope**
- **One capability map.** Add a single role→capability map in `packages/types`. `NAV_ITEMS` (`DashboardLayout.tsx:55-66`), the view guards (`DashboardPage.tsx:56-86`) and the API guards all consume it. The API guards are `utils/query.ts:14-21`, `routes/crm.ts:35-38`, `configuration-reviews.ts:1022-1027` and `revenue-analytics.ts:73-75`.
- **Role-aware top level** (default in Q-C1).
  - Group More under Sales, Operations, Venue and Platform.
  - The nav slot names the current place, for example "Pipeline ⌄".
- **Notification bell** beside the account menu.
  - Outlined, with a quiet copper numeral and no pulse.
  - Ivory popover, "Mark all read", and an inline mark-read error.
  - Refreshes on window focus and every 2 minutes, paused while the tab is hidden.
- **Persistent shell.**
  - A parent layout route with `<Outlet/>` in `router.tsx`.
  - Cache the venue name; if it fails, show "Venue name unavailable".
- **Orientation.**
  - Set `document.title` for each view.
  - On a view change, move focus to the view's h1, and set main's `aria-label` to the view name.
  - Point the wordmark at `getDefaultRoute` (`lib/role-routing.ts:7-12`).
  - Use sentence-case labels that match the page headings.
- **Denied and arrival states.**
  - One denied state in the desk style, replacing `DashboardPage.tsx:88-111` and `ProtectedRoute.tsx:36-56`. It names who can grant access and offers one way out; suppliers are routed to their own pages.
  - A light `RouteArrival` that names the destination.
  - "Checking access…" becomes an inline Activity status inside the shell.
- **Test change.** Change `DashboardLayout.test.tsx:82` only after Blake decides.

**Acceptance**
- An end-to-end test runs for each role: staff, venue admin, hallkeeper, planner, executive, platform admin and supplier. Every visible nav item opens a view whose API calls return 2xx, and "Insufficient permissions" never renders.
- The `<header>` element handle stays attached across Enquiries → Diary → Hallkeeper, and neither "Your venue" nor "Opening venue…" appears after the first load.
- Each staff view's tab title follows the pattern "Enquiries · Trades Hall — Venviewer".
- Choosing a More item with the keyboard puts `document.activeElement` on the view's h1.
- The unread count is visible without opening any menu, and has an accessible name.
- Denied pages contain no raw view key and at least one working link, and never offer "Try again" on a 403.

#### N3. Diary and holds, phase 1 (L)

**Why now:**
- Bookers use it all day, and it scores 1–3.
- Blake named it next (`:36`).
- The ranked-hold ladder is already better than the incumbents (`api/services/hold-hygiene.ts`, `hold-reminders.ts`) but is hard to see.

The scope keeps the flat ivory workspace Blake selected on 7 September (`product-experience.md:38-40`), pending Q-D1.

**Scope**

*Header and toolbar*
- Header: a date line, the range as large serif numerals, and one sentence built from real counts.
- A copper count plane whose counts act as filters: Confirmed · 1st option · 2nd+ option · Prospects · Decisions due · Conflicts.
- Toolbar reduced to: ‹ Today ›, Go to date (`g`), Day/Week/Fortnight/Month, and Overview/Timeline. Secondary actions move into a View menu, and "New booking" gets a fixed place.

*Finding dates*
- Go to date accepts "5 Jun 27" and answers per room ("Grand Hall: free · Saloon: 1st option Fraser, decides 12 Oct").

*Stability while loading*
- Keep the room rail and photos visible while a range loads, and prefetch the neighbouring ranges.
- If a background refresh fails, keep the board and show a quiet notice. This means changing `useCalendar.ts:60-80` and the test that asserts blanking.
- "Refreshing" and "Saving" go in a fixed status slot.
- Enquiries are not re-fetched on every calendar change (`DiaryBoardPage.tsx:193`).

*Readability*
- Encode commitment by luminance:
  - confirmed: forest with cream text;
  - holds: ivory with a copper option numeral, and a copper decision age when 7 days or fewer remain;
  - prospects: dashed;
  - conflicts: a brick edge plus a word.
- Every label at least 12 px and 4.5:1 (`diary-board.css:136,144,169-178`).
- Phase labels become visible (remove `font-size:0` at `:165`) and get a pattern as well as colour.

*Needs attention and the ladder*
- "Needs attention" covers the whole venue, via a new API query, grouped into Overdue and Due this week.
- Enquiry slips carry a date tile.
- A "Contested dates" list offers inline Confirm, Extend and Release.

*The booking drawer*
- Facts come first, and the next step always sits in the same place.
- ConsequenceConfirm on Cancel, Release, Mark lost and Mark expired. It names the date, the room, who is promoted, and "Nothing is sent to the client".
- Parse `resequence.promotedToFirst` (`api/routes/bookings.ts:236-240` ↔ `web/src/api/diary.ts:77-89`), and allow an optional reason note.
- Show the real owner's name, which needs owner names on calendar entries.
- Map schema messages to plain British messages.
- Notes stay visible when editing.
- The default rank follows the ladder (`drawer-form.ts:124`), and hygiene fields are required when a prospect is promoted to a hold (`booking-mutations.ts:523-532`).

*Keyboard*
- `[` and `]` move the range; `g`, `n`, `o` and `?` work as described above.
- Arrow keys move around the grid with a roving tab stop.
- `<select>` elements are excluded from the global key handler (`DiaryBoardPage.tsx:520-529`).

*Other changes*
- Day view opens at the current time or the first booking; phones default to an agenda list.
- The welcome modal becomes an inline legend. Fix the e2e label drift (`e2e/support/diary-live.ts:101`, `e2e/production-smoke.spec.ts:98`).
- Apply the vocabulary from Q-B1 in `board-copy.ts`.

**Acceptance**
- **Range changes.** Stepping to a later week while the request is pending keeps the room rail rendered; the full-panel loader never appears after the first load.
- **Refresh failure.** An injected 500 on a background refetch leaves the bookings visible under a "Couldn't refresh at HH:MM" notice.
- **Go to date.** Pressing `g`, typing "5 Jun 27" and pressing Enter shows the week of 2027-06-05 with the per-room sentence.
- **Venue-wide attention.** An API fixture hold 6 months out, with a decision date of yesterday, appears in Needs attention on today's week.
- **Contrast.**
  - Confirmed against 1st-option fills is at least 3:1 in luminance.
  - Every timeline, rail, gap and plaque label is at least 12 px and 4.5:1.
- **Cancelling a confirmed booking.**
  - It is impossible without the confirmation.
  - The confirmation names the promoted holder, taken from the fixture.
  - The closure line says who was promoted.
- **Copy.** No rendered string contains `decisionAt`, `endsAt` or `startsAt`.
- **Phone.** At 390 px the first booking's box starts within the first 844 px, with no horizontal page scroll.
- **Baselines.** The first committed Diary baselines exist: week, fortnight, day, the drawer for a hold and for a confirmed booking, pencil-in, the cancel confirmation, the empty tray, read-only and phone.
- **Benchmark.** "Find a free Saturday for 140 in June 2027 and pencil it" is timed before and after.

#### N4. Hallkeeper and event day, phase 1: fix what is wrong (L)

**Why now:** Blake named it next; it is Trades Hall operations; it is used continuously on phones under time pressure; and wrong times and invisible approval states are real operational risk.

**Scope**

*API*
- `resolveTiming` defaults to 18:00 venue-local (`hallkeeper-sheet-v2-data.ts:36,429`).
- The calendar and ops projection returns the approved configuration id and the checked count, for Day Board links.

*Hallkeeper sheet*
- Expand the minified `hallkeeper-workspace.css:2` into readable rules.
- Type floor: item names 16 px, zones 13 px, quantities as Newsreader light numerals, inputs 16 px.
- Colours:

  | Element | New value | Measured |
  |---|---|---|
  | muted text | `#55655c` | 6.02:1 |
  | checkbox border | `#8b927f` or darker | at least 3:1 |
  | progress fill | `#5d8963` | — |

- "Ready by" appears next to the start time.
- Approval state: a full-width band (brick for rejected, amber for awaiting) and an approval stamp, instead of three separate version mentions.
- A copper plane of category counts replaces the five-row pages and the `<select>`. Finished zones fold away. When everything is checked, the sheet shows "Setup checked · 43 of 43".
- A "Keep in view" band: access needs, allergies, the day-of contact as a `tel:` link, and the next deadline.
- On phones, a Checklist | Plan switch, no scroll box inside the page, and the room switcher in the header.
- Venue-time formatting in `HallkeeperStatusBanner.tsx:51` and `InstructionsBanner.tsx:199-202`.
- 403 copy without "Try Again".
- Delete the dead `.hk-*` rules.

*Day Board*
- Remove the endless pulses (`day-board.css:244-267`); a single stamp plays when a room's state changes.
- A legend built from the real states.
- Amber warning `#6f500f` on `#efe0b8`.
- Finished slots keep full-strength text.
- ← Today → with arrow and `t` keys.
- Empty rooms collapse into one line.
- "Updated 14:02 · reconnecting…" with a Refresh action.
- "Open setup sheet" becomes the primary action.
- The venue time zone comes from data (`DayBoardPage.tsx:117`).
- Delete the dead dark block.

*Event-day ops and Mission Control (functional fixes only)*
- A relative kicker instead of the hard-coded one (`EventDayOpsPage.tsx:345`), and venue-zone times (`:37-64`).
- An issue list with a Resolve action (`updateEventDayIssue`), plus the honest line "Nobody is notified" until notification exists.
- A "Waiting for your acknowledgement" block with no 10-event cap. Each Acknowledge action gets busy, error and 409 handling.
- Incidents get a Resolve action.
- "Start" appears only on the next phase, with an honest message on conflict.
- Mission Control writes join the offline queue (`lib/event-day-offline-queue.ts`).
- Remove success notices, and put errors beside their card.

*Ops handoff*
- Fix the print styles (`OpsHandoffPage.css:414-440`).

**Acceptance**
- Unit test: `resolveTiming` for 2026-06-15 and 2026-12-15 in Europe/London both render 18:00, and "Ready by" appears.
- Computed-style audit at 390×844 on `/hallkeeper/:configId`:
  - no operational text under 12 px;
  - item names and inputs at least 16 px;
  - checkbox boundary at least 3:1;
  - muted text at least 4.5:1.
- A rejected-sheet fixture shows the band above the checklist, and row controls behave as Blake decides in Q-E3.
- Day Board: no element has an infinite `animation-iteration-count`, and a unit test proves every legend label equals a state label emitted by `day-board-state.ts`.
- Mission Control, with 12 newer events: an unacknowledged blocked task still offers Acknowledge; a failed POST shows an inline error; resolving every incident shows a sealed "No open issues".
- Print emulation of `/ops/handoff/:id`: sampled h1, h2 and table text is at least 4.5:1 on white.
- `context.setOffline(true)`: marking a task done and logging an incident both queue and show "Saved on this phone", then replay on reconnect.

#### N5. Truth and safety sweep (M in total; each item S; runs in parallel from day one)

**Why now:** each item shows something untrue, hides a consequence, loses data or leaks tenancy. Every one is cheap.

**Tenancy**
1. The planner's enquiry copy hard-codes "Trades Hall" (`GuestEnquiryModal.tsx:254,596`). Use the planner venue identity instead.

**False or broken promises**

2. `/blueprint` shows a fake "Plan sent — within 24 hours" (`BlueprintPage.tsx:294-298`). Route it to the real enquiry flow or remove it, and hide or explain the 2D view's do-nothing controls (`:836-858`).
3. The share lens says "Client link — sent" (`ShareLensPanel.tsx:208`). Change it to "Link ready. Not emailed; copy it into your message." Say that "Create another link" creates a new proposal (`:92-96`).
4. The client proposal page says "the venue team has been notified". Notify the owner on every proposal decision, or change the copy (`ProposalPage.tsx:55`; `proposals.ts:155-156,199-200`). Move focus to the result after the client approves.
5. The supplier "clarification request" reaches nobody. Notify the pack contact, or say so; show `contactPhone` as a tap-to-call link (`supplier-coordination.ts:596-638`).
6. "Log issue: Urgent" on the event-day board notifies nobody. Say so until notification exists (`services/event-day-ops.ts:423-435`).
7. Venue settings: remove the brand-colour "public preview" claim (`use-planner-venue-identity.ts:50-53`).
8. Pricing:
   - trial, no-card, refund and scan buttons dead-end at an invitation-only register page;
   - "MOST POPULAR" sits on the only plan;
   - `/#how-it-works` is a dead link (`PricingPage.tsx:237,290,399,463,620,639,779`).

   Change these to "Book a walkthrough" and state what happens next. Also fix Spotlight's dead links (`spotlight-copy.ts:55-60`).

**Accidental or unannounced actions**

9. Planner:
   - Enter on Cancel or "Table only" places chairs (`ChairCountDialog.tsx:191`).
   - The More grid's Rotate and Delete do nothing (`VerticalToolbox.tsx:1561-1563`).
   - The V shortcut is false (`:1983`).
   - "Clear" drawing cannot be undone (`markup-store.ts:211-219`).
   - A backdrop click on Event details discards edits (`EventDetailsPanel.tsx:376-387`).
   - The save toast promises a retry that does not happen (`EditorBridge.tsx:287-310`).
10. Proposals:
    - "Generate client link" becomes "Send to client…" with a consequence line.
    - Withdraw says "The client's link will stop working."
    - Page the list properly (`proposals.ts:83-87,296-301`; `web/src/api/client.ts:158`).
    - Replace the status pills with chips that pass AA.
    - Persist the token link so a reload does not fall back to the weaker short link (`ProposalsView.tsx:430-432`).
11. Reviews:
    - Add the `/dashboard/reviews/:id` route the email links to (`configuration-reviews.ts:474`).
    - Approve names its recipients before sending.
    - Withdraw gets a confirmation.
    - Request-changes copy says the note is emailed (`ReviewsView.tsx:590`).
    - A 409 re-reads and reports the real state.
    - The demo checkbox becomes a calm sentence (`:511`).
12. Pipeline:
    - "Guest count pending guests" (`:472`).
    - The silently failing automatic advance (`:345-352`), and its unit-test fixture that mocks an invalid transition (`__tests__/CommercialPipelineView.test.tsx:302-316`).
    - "Pipeline value" includes Won and Lost deals (`:204-207`).
    - Offer only the valid next moves.
13. Analytics: rename the metrics for what they measure, show £4,750, humanise enums, and fix the platform-admin 400.
14. Admin:
    - Honest delete copy with counts (`AdminPanel.tsx:755,770`).
    - Hide "Tiered" until tiers can be entered (`price-calculator.ts:153-166`).
    - Undo for pricing-rule deletes (`:632-643`).
    - No backdrop close while an outline is unsaved (`:63-74`).
15. Loadouts: fix the caption overflow with `minWidth: 0` and save on blur (`LoadoutDetail.tsx:393`). The delete copy should match the soft delete.
16. Event Architect: before the click, state that the selection is final (`event-architect.ts:434-461`).
17. The twin's share action fails silently (`TwinViewerControls.tsx:85-87`).

**Acceptance**
- Every item has a unit or end-to-end regression test.
- A test enumerates the CTA URLs in `api/services/email-templates.tsx` and asserts each one matches a route in `router.tsx`.
- API tests spy on the email service, so no "sent" or "notified" copy renders unless a send actually happened.

#### N6. Enquiries desk: close its hand-offs and make leads truthful (M)

**Why now:** this is the reference surface, used all day. Its outbound hand-off dead-ends, and inbound twin and website leads show a false room and a false quote.

**Scope**

*API*
- `GuestEnquirySchema` gains an optional room slug, validated against the venue.
- Because `spaceId` is NOT NULL (`schema.ts:671`), store an explicit "room not chosen" marker.
- A `source` field (tour, website, planner, phone) replaces setting `fromTwin` on every venue-slug enquiry (`public-enquiries.ts:136`) and prepending the twin note (`:17,143-148`).
- A shared, human-labelled occasion list, used by the twin, `/fresh`, the planner and the desk. Today the desk prints raw slugs (`EnquiryLedger.tsx:50`).

*Desk*
- Show "Room not chosen" instead of the flagship room's name and photo, plus a quiet source chip.
- "Create opportunity" opens `?view=pipeline&opportunity=<id>` with the list beside it; remove the misleading toast (`EnquiriesView.tsx:461-472`).
- A secondary "Pencil in the Diary" action, using the existing conversion (`bookings.ts:250`).
- On phones, the facts line wraps rather than truncating.

*Twin*
- Wire `onCompose` in the room dossier (`TwinViewer.tsx:1898`) so the room is preselected.

**Acceptance**
- An API test sends a venue-slug enquiry with no room. The desk shows "Room not chosen", no Grand Hall photo, and a quote made of the client's own first words.
- An enquiry from the `/fresh` composer is stored with `source = website`.
- Pressing Create opportunity twice lands on the same deal, selected in the pipeline, both times.
- Pencilling from the desk creates a hold with the enquiry's date and room, visible in the Diary.

### 2.4 Next

#### X1. Sales spine: pipeline, proposals, clients and the client proposal page (XL)

**Why next:** the conformance gap is the largest (0–2) on a surface used for hours. It depends on N1 and N2, and on Blake's decisions about stage names, sending email and contract and deposit (Q-A1, Q-A4, Q-B2).

**Scope**

*Pipeline*
- The desk composition:
  - ledger grouped by when the next action is due;
  - copper plane of live stages showing counts and values;
  - forest panel with date, guests, room, value, the stage path, one primary action, contact, a proposal chip and the timeline.
- Offer only the valid moves (`commercial-spine.ts:43-52`); Won and Lost require a reason.
- An editable value, filled from the latest quote.
- Follow-ups with due dates.
- Proposal events move the deal's stage.
- Layouts that respond to width.

*Proposals*
- A ledger by status (Drafts / Waiting on you / With client / Accepted), paged.
- The composer is pre-filled from the latest version ("Editing version 3"), with a diff.
- Inline "Send to client…" confirmation, a persistent link, and "Preview as the client".
- "Add from price list" (`api/pricing.ts:66-78`).
- Link the deal, enquiry and configuration; derive `configurationId` on the server.
- Notify the owner of every client decision.
- "Opened by the client" from `lastViewedAt`, excluding staff previews (`proposals.ts:1242`).
- "Use in proposal" for AI drafts.
- Templates by room and event type.

*Clients*
- Extend the search API to accounts, contacts, deals and proposals, tolerant of typos (`api/routes/clients.ts:30-130,68-70`).
- A Clients desk: `/` focuses search; recent and upcoming clients show before anything is typed.
- The profile opens as a forest panel with its state in the URL (`?view=search&client=`), with `mailto:` and `tel:` links, a timeline and lifetime facts.

*Client proposal page*
- An ivory document:
  - a facts row (date, guests, room), which extends the payload at `web/src/api/proposals.ts:21-47`;
  - the room photograph;
  - a copper quote plane;
  - a forest decision panel.
- Newsreader type, the approver's name, a print stylesheet, and one caveat line.

**Acceptance**
- **Task benchmark:** from an approved enquiry to a sent proposal takes 6 or fewer deliberate actions, with no retyping of date, guests or room. Measured before and after.
- **Revisions:** after a client requests changes, the new version starts from the previous contents and shows a diff.
- **List order:** 25 fixtures appear newest-first and every one is reachable.
- **Notifications:** approving a proposal made in the dashboard (no event link) creates an in-app notification for its owner.
- **Search:** "Mcdonald" finds "MacDonald"; "henderson" returns the contact, the deal and the proposal.
- **Client profile:** survives reload, and Back returns to the results.
- **Client page:** at 390 px, the facts, total and decision are visible without horizontal scroll; print emulation is readable.
- **Baselines:** the first ones for pipeline, proposals, search, profile, and the client page (ready and accepted).

#### X2. Layout reviews desk (M)

**Scope**

*The queue*
- A ledger in the desk style: date tile, layout name, room · guests · planner, and a copper wait time.
- Stage counts: To start / In review / With planner.

*The detail panel*
- A forest panel beside the list, holding:
  - snapshot facts and a thumbnail (`getLatestSnapshot` and `safeParseSnapshot`, already exported);
  - a claim line ("In review with Catherine since 10:14");
  - presence text at 4.5:1 or better;
  - one primary action for each state, using the inline confirmations from N5.
- Keep the actions mounted while context re-reads.

*Everything else*
- The timeline as sentences, in venue time.
- A `?review=` URL and j/k triage.
- Replace the baseline that relies on mocked transitions (`e2e/dashboard-state-visual-performance.spec.ts:408`) with real state-machine transitions.

**Acceptance**
- A reviewer can approve without opening a new tab; the end-to-end test asserts no new page opens.
- Presence text measures at least 4.5:1.
- `?review=` restores the selection after a reload.
- A full triage of three reviews runs with the keyboard only.

#### X3. Planner chrome and placement flow (L)

**Scope**

*Chrome*
- The forest register over the 3D scene (Q-F1).
- Label the lens rail and split it into Plan and Production; Production is shown to staff roles only.
- One labelled tool bar.
- Limit `user-select:none` to the canvas.
- A type scale with a 12 px floor.
- Delete the unmounted legacy chrome and the `.planner-status-header` CSS.

*Placement flow*
- A facts band: guests, seats, tables, comfortable capacity.
- Seats per table set inline with a remembered default, instead of the modal.
- The command deck becomes the next-step bar, and stays on desktop.

*Catalogue and docks*
- Catalogue: AA text, a visible focus ring, no staggered entrance, recently used items first, and focus in search on `F`.
- Docks: furniture grouped by table; the inspector leads with what the object is, not its coordinates.

*Other*
- A `?` keyboard legend.
- The 2D view gains rotate, delete, zoom and add, inside the same shell.
- Loading errors offer "Try again".

**Acceptance**
- Placing 22 rounds of 10 opens no dialogs; the test counts `role=dialog` opens.
- Every rail item has a visible label.
- A computed audit finds no chrome text under 12 px.
- Inspector and notes text can be selected.
- The value chip works as a keyboard `spinbutton`.
- The first `/plan` baselines exist.
- Frame time on the declared scene and devices does not regress (measured before and after).

#### X4. Event day, phase 2: one tool, one look (L)

**Depends on:** Q-E1.

**Scope**
- Merge the checklist with Mission Control, and keep one problem log, choosing between `eventDayIssues` and `eventMissionIncidents`.
- Use venue words: Running order, Tasks, Problems, History.
- An ivory and forest restyle with a "Now" panel.
- A running order in venue time with a "now" line.
- A sentence naming what is blocked, instead of a readiness percentage.
- Show assignments.
- The ops handoff becomes an issued ivory document with "What changed since v3" first.
- The client event page leads with facts (`types/src/client-event-schedule.ts:14-23`), adds a next-step panel and the room photo.
- AA fixes for the room plans.
- The walkthrough moves under Help.

**Acceptance**
- `/ops/events/:id` shows exactly one problem form, and an API test proves one table.
- No surface on the route has a luminance below 0.2.
- Running-order times are venue-local.
- A print baseline exists for the handoff.
- The client page shows the weekday date taken from `startsAt`.

#### X5. Public front door, twin HUD and one enquiry form (L)

**Depends on:** Q-G1 to Q-G3.

**Scope**
- **Front door:**
  - the canonical homepage takes over `/fresh`'s composer, dossier, rates and contact details;
  - posters at full clarity, with capacities from `trades-hall-venue-truth.ts`;
  - a persistent "Ask about a date";
  - "Staff sign in" replaces the staff links;
  - a contact and legal footer;
  - one calm line about the 3D hold;
  - redirects for retired routes.
- **Twin HUD:**
  - three stable zones;
  - the dossier collapsed by default;
  - coach copy that matches the input method;
  - honest share failure.
- **One shared enquiry form** for the twin, `/fresh` and `GuestEnquiryModal`:
  - 16 px inputs and boundaries of at least 3:1;
  - the draft is kept;
  - fields in the order a booker decides;
  - an acknowledgement email to the client and a sealed summary.
- **Also:** fix the contrast of "lit"; make the showcase's calls to action honest ("request-layout" is never read by anything).

**Acceptance**
- A production-mode baseline of `/` (splats held) replaces the `/landing` baseline in `public-acquisition-visual-performance.spec.ts`.
- A crawl test proves no internal link lands on the catch-all redirect.
- The enquiry form at 390 px has inputs of at least 16 px, and reopening after an overlay click restores the draft.
- `e2e/accessibility-route-audit.spec.ts:378-398` is extended to `/fresh`, `/login`, `/register`, the legal pages, `/quiz`, `/demo`, `/tour` and `/oauth-consent`.

#### X6. Inventory convergence (M–L)

**Scope**
- Shared tokens and Newsreader.
- The ledger is always visible, with an attention band (Short / Damaged / Not recorded / Requests to approve).
- The default selection is the biggest shortage.
- Keep the previous numbers visible and tick them to their new values, instead of blanking.
- Period presets.
- Steppers, reason presets and a storage-location combobox.
- A consequence line and a stamp on save; a sticky panel.
- Demand and review drawers fold into the band and the panel.
- An import path from the empty catalogue.
- The item and period in the URL.
- Fix the copy mismatch between the component and the live spec (`InventoryPanel.tsx:111` vs `e2e/venue-inventory-style-live.spec.ts:74`).
- Merge the dead dark rules in `InventoryPanel.css`.

**Acceptance**
- After a save, the impact numbers are never replaced by "Checking reservations…".
- All items are visible without toggling anything.
- j/k and `/` work.
- The search border measures at least 3:1.
- The first inventory baselines exist.

#### X7. Supplier portal and staff sending (L)

**Scope**
- Add event date, time, room, venue address, loading entrance and quantities to `SupplierSafePackView`.
- Rewrite supplier text so it does not cite documents the supplier cannot see.
- An ivory restyle.
- After confirming: a stamp, plus "Ask the venue team" for later questions.
- Separate messages for "link expired" and "network error".
- A print view and an `.ics` "add arrival to calendar".
- A staff "Send to suppliers" ledger with status chips.
- Supplier confirmation status shown on the Day Board and in Mission Control.

**Acceptance**
- The date, arrival window, room and address are above the fold at 390 px.
- No `sourceRef` or snapshot hash appears in the DOM; update the assertion in `SupplierPortalPage.test.tsx:118` accordingly.
- A pack can be created and its link copied with no API tooling.
- An acknowledgement creates a staff notification.

#### X8. Analytics rebuild (L, after Q-H4)

**Scope**
- A headline sentence, a copper plane holding 3–5 figures, and a forest "Needs you" panel.
- A period switcher with the same period last year.
- A chart kit (§4.1) with a table view for each chart.

**Acceptance**
- Every figure links through to its records.
- Money shows as £4,750.
- Charts meet the chart-kit rules: at most four hues, direct labels, a table fallback.

#### X9. Event Architect (L)

**Scope**
- The desk composition, with a comparison ledger.
- Navigate to the run's URL after creating it.
- Return the brief in the run payload.
- Pre-fill from the enquiry.
- One caveat line, keeping the sentence a test asserts (`EventArchitectPage.test.tsx:395`).
- The evidence panel accepts attachments, computing each digest in the browser, and has no default decision.

**Acceptance**
- A reload restores the comparison.
- A saved run shows its own brief.
- The decision has no default.
- Nobody types a digest by hand.

#### X10. Sign in, register, `/app` and OAuth consent (M)

**Scope and acceptance**
- The destination from `returnTo` is named on the page.
- The `/app` loading text is at least 4.5:1.
- OAuth consent moves to the account appearance. Rendered scopes and buttons must measure at least 4.5:1, which verifies or refutes the inferred 1.05:1.
- A sign-in link on the consent page returns to consent afterwards.

### 2.5 Later

#### L1. Settings, admin, onboarding and the room outline editor (L)

**Why later:** these are used rarely, and N5 already handles their untruths.

**Exception:** the keyboard gap in the polygon editor is a WCAG 2.1.1 failure. Bring that part forward if Blake wants venue admins to draw their own rooms (Q-C2).

**Scope**
- Room capacities per layout become first-class room facts.
- A pricing editor for the modifiers the model already supports (`types/src/pricing.ts:59-77`), with a sample-quote preview.
- A venue picker for platform admins.
- Invitation emails, renew, remove access, and an audit timeline.
- The polygon editor gets keyboard control, entry by dimensions, and an ivory drafting sheet.

**Acceptance**
- The polygon editor is fully operable by keyboard (e2e).
- No destructive action fires on a single click without undo or a confirmation that names what it affects.

#### L2. Reference loadouts (M)

**Scope and acceptance**
- One noun, per Q-B3.
- Photo-first tiles and inline creation that opens the new set-up.
- Drag reordering with a keyboard equivalent.
- The set-ups appear on the hallkeeper sheet for their room.

#### L3. Pricing and marketing (M)

**Scope**
- Rebuild Pricing in the platform family and sell the whole desk.
- Source and date every competitor figure, or remove them.
- Venviewer's own terms of service.
- `/demo`: type in the desk family and real captures.
- Self-host the leaflet's fonts.

#### L4. Twin extras and internal consoles (L)

**Scope**
- The guided tour, and room notes once the venue has authored them.
- The room walk and showcase once the splat hold lifts.
- Keyboard support in the captures console.
- The asset registry as a desk.
- A decision on the Foundry review tool.

---

## 3. Platform capabilities: parity plus "wish it existed"

**Status key**
- **Exists:** schema, service or route present, with files cited.
- **Partial:** a model exists but a key piece is missing.
- **Missing:** not found.

**Effort** uses the audits' relative scale (S < M < L < XL); these are not day estimates. **Parity** means the capability exists in Salesforce, Cvent or sales-and-catering tools. **Wish** means users of those tools say it is missing (research findings).

### 3.1 Lifecycle map

| Stage | Exists | Partial | Missing |
|---|---|---|---|
| 1 Enquiry capture | Desk triage (`components/dashboard/enquiries/*`); public planner and twin intake (`types/src/enquiry.ts:119-137`) | Staff notification goes to users with the hallkeeper role (`public-enquiries.ts:202-247`); `guest_leads` keyed by email (`schema.ts:889-900`) | Source field and response clocks; ingest address and parsers; phone entry (no staff create call in `web/src/api/enquiries.ts:78-160`); client acknowledgement; optional room (`schema.ts:668-686`) |
| 2 Qualify and respond | Enquiry transitions; create opportunity (`api/routes/crm.ts:63`); tasks (`opportunities.ts:117-379`) | AI drafts are draft-only and off until a provider is set (`types/src/ai-assistant.ts:25-36`) | Reply joined to availability; follow-up cadences; lost reasons; source analytics |
| 3 Availability and holds | Ranked and joint holds with enforced hygiene (`types/src/booking.ts:39-195`); a DB exclusion constraint stops confirmed bookings overlapping; conflict engine; ladder re-ranking (`services/hold-hygiene.ts`); T-7/3/1 reminder delivery (`services/hold-reminders.ts`, `POST /admin/diary/hold-reminders` at `routes/admin.ts:86-97`; the comment at `hold-hygiene.ts:13-17` saying it is unbuilt is stale; production scheduling is unverified) | Expiry is a manual transition (`booking-mutations.ts:443-478`); calendar links exist in the schema only (`schema.ts:2494-2508`); series ids are nullable | Auto-lapse; challenge; room hierarchy and combinations (`schema.ts:141-162`); shared resources; find-a-date across rooms |
| 4 Show-rounds | Twin, planner, room photography | — | Tours as Diary objects; tour brief; phone tour mode; recap |
| 5 Quote and proposal | Exact minor-unit quotes (`types/src/proposal.ts:195-316`); versioned proposals with share tokens and comments (`routes/proposals.ts:268-1384`); pricing rules (`types/src/pricing.ts`) | Modifiers exist but are not exposed; `lastViewedAt` stored but not shown | VAT, service charge, minimum spend, discount approval, consumer price presentation (grep: no VAT fields) |
| 6 Contract | Proposal version digest (`proposal.ts:320-445`); client approval (`proposals.ts:1317-1384`) | `e_sign` exists only as provider metadata (`types/src/integration-layer.ts:21-30`) | Terms versions; signatory evidence; signing inks the hold and requests the deposit |
| 7 Payments | — | `depositSplit` and allocation helpers (`services/money.ts:138-150`); Stripe covers subscriptions only (`schema.ts:1008-1050`) | Milestones, invoices, collection, reminders, reconciliation, accounting export |
| 8 Numbers, dietary, access | Guaranteed, expected and set-for counts (`schema.ts:1264-1290`); diet counts and access fields (`types/src/event-requirements.ts:20-150`) | Free-text allergies only | Final-numbers deadline; client portal collection; per-guest 14 allergens; menus |
| 9 Function sheet | Hallkeeper sheet v2 and PDF (`routes/hallkeeper-sheet.ts:133-242`); ops packs (`services/ops-compiler.ts:742-1018`); BEO documents and snapshot diffs (`schema.ts:1834-1860`); change feed and acknowledgements (`routes/event-plan-lifecycle.ts:182-201`) | — | Department views; "Final" at T-72h; curfew, keys and alarm clusters |
| 10 Suppliers | Packs and magic links (`routes/supplier-coordination.ts:251-636`); inventory reservations | Supplier record holds name, category and contact only (`types/src/supplier-coordination.ts:14-34`) | Staff send UI; compliance documents with expiry; approved-supplier status |
| 11 Event day | Ops board and issues (`routes/event-day-ops.ts:113-262`); Mission Control (`routes/event-mission-control.ts:214-358`); live Day Board | Offline queue for ops only (`EventDayOpsPage.tsx:66-77`) | Offline Mission Control; extras capture; lock-up checklist |
| 12 Settlement | — | — | Final invoice from contract plus extras |
| 13 Feedback and rebooking | Won and lost opportunity stages (`commercial-spine.ts:29-52`); revenue analytics (`routes/revenue-analytics.ts:179-372`, mislabelled) | — | Feedback; lost reasons; same date next year; anniversaries (with PECR consent) |

### 3.2 Ranked by how much each makes everyone's life easier

**Tier A: without these a veteran cannot switch**

| # | Capability | Stage | Type | Status and evidence | Effort | Why it ranks here |
|---|---|---|---|---|---|---|
| 1 | Free self-serve import: spreadsheets, Salesforce weekly export ZIP, sales-and-catering exports; preview, dedupe suggestions on name + date + phone, roll back a batch; future bookings and contacts first | Cross-cutting | Parity + Wish (Tripleseat charges $250 per file) | **Missing.** No importer found. The integration layer is metadata only (`integration-layer.ts:13-30`) | XL | The biggest switching barrier; Blake requires all four sources (`product-experience.md:35`) |
| 2 | Live mailbox: send as the venue's domain, capture threads onto records, attach them after the fact | 1–13 | Parity + Wish (captured Salesforce email is not reportable) | **Partial.** Outbound sends and templates exist (`schema.ts:948,2530`; `email-templates.tsx:254-728`). The only inbound webhook is Clerk (`routes/webhooks.ts`) | L | Correspondence is where the veteran's day happens |
| 3 | Universal enquiry intake: ingest address with parsers for Hitched, Bridebook, Tagvenue, Add to Event and CSN alerts; phone quick-entry; source tag and response clock; one-minute factual acknowledgement | 1 | Parity + Wish | **Partial** (see §3.1) | L | Speed to lead decides the booking (research: 7× within an hour; Tagvenue auto-expires requests) |
| 4 | Availability answered inside the enquiry panel, one-press provisional hold, reply draft joined to real availability and price guide | 1–3 | Wish | **Partial.** Conversion (`routes/bookings.ts:250`); drag-to-board; draft-only AI | M | Removes a surface switch and the retyping of every reply |
| 5 | UK quote engine: per-line VAT from option-to-tax status and supply type, service charge, minimum spend with a shortfall line, per-head packages, discounts with approval, consumer prices shown including all mandatory charges | 5 | Parity (UK) + Wish | **Missing** VAT and the rest; exact money exists | L | Surprise VAT is a known complaint; drip pricing is banned since April 2025 |
| 6 | Contract and simple e-signature on the accepted version; signing inks the hold and requests the deposit | 6 | Parity | **Partial** | L | Closes the sale inside the product |
| 7 | Payment schedules and collection (card and pay-by-bank, the venue as merchant of record), VAT invoices at each tax point, reminders, receipts, accounting export | 7 | Parity | **Missing** | XL | Nobody chases payments by hand any more |
| 8 | Typo-tolerant universal search plus a Ctrl/⌘K command palette | Cross-cutting | Wish (Tripleseat and iVvy complaints) | **Partial.** `ILIKE` substring (`routes/clients.ts:68-70`); the Diary palette searches only the loaded range (`board-palette.ts:5-8`) | M | One keystroke to any record while the client is on the phone |
| 9 | Hold lifecycle completion: auto-lapse, challenge, venue-wide decisions due, room combinations, shared resources | 3 | Wish (research found no mid-market tool combining these) | **Partial**, with a strong base | M | Stops stale holds blocking paying clients |
| 10 | Two-way Outlook/Google calendar sync and an ICS feed | 3 | Parity | **Partial.** Schema only | M–L | Removes double entry |

**Tier B: removes daily friction**

| # | Capability | Stage | Type | Status and evidence | Effort | Why it ranks here |
|---|---|---|---|---|---|---|
| 11 | Function sheet department views (kitchen, front of house, hallkeeper, bar, client), "changed since you last looked", acknowledgements, "Final" at T-72h | 9 | Parity + Wish | **Partial** | M | The most valuable operational artefact is nearly there |
| 12 | Client portal: final-numbers deadline, per-guest 14-allergen list, menus, table plan, payments, documents | 8 | Parity + Wish | **Partial** | L | Ends email-thread final numbers and dietary spreadsheets |
| 13 | Consequence-preview component plus an undo service | Cross-cutting | Wish | **Partial.** Desk confirmation (`EnquiryPanel.tsx:323-387`); Diary undo (`lib/undo-stack.ts`) | M | Removes fear and dialogs at the same time |
| 14 | Notification policy (interrupt, periphery, digest) and owner notified of every client decision | Cross-cutting | Parity | **Partial.** `NotificationCenter`; proposal notifications only when an event is linked (`proposals.ts:155-156`) | M | Deals are currently won with nobody told |
| 15 | Self-serve reporting: conversion and response time by source, lost reasons, pace against last year, CSV export on every list | 13 | Parity + Wish (Momentus and Event Temple complaints) | **Partial.** Mislabelled metrics | L | No report should need a support ticket |
| 16 | Proposal templates, price-list lines, pre-fill from the previous version, "opened by the client" | 5 | Parity + Wish | **Partial** | M | Revising a proposal is the most frequent proposal task |
| 17 | Room capacities by layout as first-class room facts | 1, 3, 5 | Parity | **Partial.** Trades Hall truth file (`trades-hall-venue-truth.ts:31-46`), absent from the Space model (`types/src/space.ts:101-116`) | M | The first question asked about any room |
| 18 | Supplier workspace: send UI, compliance locker (PLI, PAT, RAMS) with reminders the supplier updates, confirmation status on the day | 10 | Wish | **Partial.** API only | M–L | Stops the pre-event document chase |
| 19 | Event-day offline mode plus capture of extras (bar tab, extra guests, damage) feeding the final invoice | 11 | Wish | **Partial** | L | Stone walls kill signal; extras on paper get lost |
| 20 | Show-rounds as Diary objects, a phone tour mode, and a recap with quote within 24 hours | 4 | Wish | **Missing** | M | Tours currently collide with set-ups invisibly |
| 21 | Client 360 timeline: emails, calls, tours, holds, payments | 1–13 | Parity (Salesforce's strength) | **Partial.** Foreign-key links exist | L | The record a veteran checks before every call |
| 22 | Presence and collision prevention on every record | Cross-cutting | Wish | **Partial.** `hooks/use-review-viewers.ts`; desk 422 handling | M | Two people no longer approve the same date |
| 23 | Server-side personal preferences: landing view, density, text size, digest times | Cross-cutting | Parity | **Missing** | M | People can tune a tool they use eight hours a day |
| 24 | Day open and Monday brief: show-rounds, decisions due, final numbers due, arrivals, money due | Cross-cutting | Wish | **Missing** | M | The system holds the open loops |

**Tier C: completes the lifecycle**

| # | Capability | Stage | Type | Status and evidence | Effort | Why it ranks here |
|---|---|---|---|---|---|---|
| 25 | Settlement: final invoice from contract plus extras, net of payments | 12 | Parity | **Missing** | L | Monday invoices stop being built from memory |
| 26 | Feedback, won/lost reasons, "same date next year", anniversaries (PECR-aware) | 13 | Wish | **Missing** | M | Repeat business |
| 27 | Diary annotations: bank holidays, Scottish school holidays, city events, promotions | 3 | Wish (iVvy user request) | **Missing** | S–M | Context when quoting |
| 28 | Recurring series with per-occurrence edit and cancel | 3 | Wish (Perfect Venue complaint) | **Partial** | M | Annual dinners and AGMs |
| 29 | Day delegate and 24-hour packages; agency commission tracking | 5, 7 | Parity (UK) | **Missing** | M / S–M | UK conference practice |
| 30 | Cvent Supplier Network RFP intake with each RFP question as a checklist | 1 | Parity | **Partial.** Provider metadata only | L | Depends on CSN volume (Q-A5) |
| 31 | Jurisdiction prompts: Scottish occasional licence lead time, M10 reminder to the couple (prompts, never compliance claims) | 8–9 | Wish | **Missing** | S–M | Small problems nobody solves |
| 32 | Full export at any time (CSV/JSON) | Cross-cutting | Wish (honest terms) | **Unconfirmed.** CSV found only in analytics UI | M | Removes exit fear |
| 33 | Real-room 3D planner and diagrams shared with clients and crew | 5, 9 | Differentiator | **Exists** (`/plan`, configurations, runtime packages) | — | Keep it fast and true to the room's heights (Cvent diagramming complaints) |
| 34 | Inventory checked against layouts | 9–10 | Wish | **Exists** (`routes/inventory-reservations.ts`) | — | Show read-only availability to sales and hallkeepers |
| 35 | Operational change acknowledgement | 9 | Wish | **Exists** | — | Ahead of the market; surface it in X4 |
| 36 | Bedroom blocks and PMS | — | Parity (hotels) | Out of scope (inferred: Trades Hall has no bedrooms) | — | Confirm with Blake |

---

## 4. Cross-cutting engineering work

### 4.1 Design-system modules

| Module | Built from | Replaces | First consumers |
|---|---|---|---|
| Register tokens: ivory, forest, editorial night (`styles/house-tokens.css`) | `EnquiriesDesk.css:9-47` plus the measured tone table (copper, amber, sage, brick, slate, heather, loch as wash, dot, text and lit) | `--enq-*`, `--diary-*`, `--hk-*`, `--db-*`, `--ea-*`, `--mission-*`, `--supplier-*`, and the planner's 287 hex and 413 rgba literals | All |
| Type roles and font stacks | Newsreader (variable, optical sizing) and Inter, from `site.css` | Georgia (56 CSS declarations), Playfair, and Cormorant on client pages | All |
| Motion tokens | `EnquiriesDesk.css:660-675`, stamp at `:228-232` | `index.html` spring, Day Board pulses, Mission Control pulse, planner blur and overshoot | All |
| Button family (primary, quiet, destructive trigger) | Desk CTA and quiet buttons | About 15 inline JS button constants, 16 CSS button classes, `.vv-button` | All |
| StatusChip and vocabulary module | `EnquiryStages.tsx:18-22`, `enquiry-desk-format.ts:25-33` | `StatusBadge`, `ProposalsView` `STATUS_COLORS`, Reviews `STATUS_VISUALS`, 17 `replace(/_/g,' ')` sites | N3, N5, X1, X2 |
| Sheet, StatPlane, DecisionPanel, LedgerRow, DateTile, KeyLegend, Timeline | Desk components | Card walls and bespoke panels | N3, N4, X1–X9 |
| ConsequenceConfirm | `EnquiryPanel.tsx:323-387` | `ConfirmModal`, Reviews NoteModal, the floating InkConfirm card, inventory and Foundry dialogs | N3, N5 |
| Notice and UndoToast | Diary UndoToast (`BoardPanels.tsx:195-212`) | `ToastContainer`, SaveErrorToast, Blueprint Toast | N1 |
| EmptyState / StateMessage (first run, filtered-empty, caught up, error, denied) | Desk closure in `EnquiryOverview.tsx` | `.vv-state-panel`, error boundary UI, one-off empty states | N1, N2 |
| Field and form wrapper (Enter submits; `aria-describedby`; errors on blur and submit) | `VenueSettings.tsx` validation pattern | Ad hoc inputs | N5, X1 |
| `lib/venue-time.ts` | `enquiry-desk-format.ts:187-290`, `pages/diary/lib/board-time.ts` | 14 local helpers and 9 locale-less calls | N1 onward |
| `describeFailure(error, {action, subject})` | New, at the `api/client.ts` boundary | 39 raw `error.message` renders | N1 onward |
| `useListTriage` hook and legend | `EnquiryLedger.tsx:35`, `EnquiryPanel.tsx:76-103` | Tab-only lists | N3, X1, X2, X6 |
| `useUnsavedChanges` | `InventoryNavigationGuard.tsx` | Nothing (only inventory has a guard today) | Settings, proposal composer, event details |
| Persistent StaffLayout route | `DashboardLayout` | Each page wrapping its own layout | N2 |
| Chart kit | Research palette in fixed order (forest, copper, sage, heather), a headline sentence, table fallback | Cyan bars and KPI card walls | X8 |

### 4.2 Global CSS and HTML changes

1. `index.html:95-113`: delete the spring, brightness and press rules, then remove `[data-calm-controls]`.
2. `index.html:77-79` and `:138-168`: remove the gold cursor and the dark-track scrollbar. Fix the stale comment at `:73-76`.
3. `index.html:22-30,174-203`: give staff paths an ivory boot.
4. `global.css:42-54`: register-aware focus tokens with no halo.
5. `global.css:6` and `:10-22`: set `color-scheme` and the html/body ground from the register. This removes the dark overscroll band and dark native controls (inferred).
6. `global.css:145-169`: delete `.vv-status-chip`. Retire the dark `.vv-state-panel` (`:72-110`).
7. `DashboardLayout.css:92-99`: turn the four grounds into a register the view declares, and migrate view by view. Several views paint light text straight onto the ground, so a blanket switch would break their contrast.
8. `house-tokens.css:22`: the ivory register is currently described as "deliberately absent". Add it.
9. Move the planner, Pipeline, Proposals, Client Search and Client Profile from inline styles to CSS on tokens. Inline styles cannot express pointer-gated hover, media queries or reduced motion.
10. Remove per-surface focus overrides that set `outline: none` (`VenueSettings.css:104-118`, `ChairCountDialog.tsx:321`, `VerticalToolbox.tsx:2153`).
11. Add a shared `scroll-margin-top` for anchors and a shared top offset for sticky panels, because the header is sticky (`DashboardLayout.css:5`).

### 4.3 Shared API and domain plumbing

- **One capability map** for nav, views and API guards. The UI hides controls; the API still enforces access.
- **Public enquiries:** optional room, a "room not chosen" marker, a source field, and an occasion list with human labels.
- **Notifications:** notify the owner of every client proposal decision, not only event-linked ones.
- **Diary:** parse `resequence.promotedToFirst` in the web client; add owner names to calendar entries; add a venue-wide decisions-due query.
- **Calendar and ops projection:** return the approved configuration id and checked count.
- **Timing:** `resolveTiming` uses venue-local time.
- **Payloads:** add event facts to the supplier-safe and public proposal views.
- **Search:** extend it to accounts, contacts, deals and proposals.
- **Desk counts:** a single stage-counts endpoint replacing the desk's six count requests.
- **Email CTA audit:** every template's link must resolve to a route.

### 4.4 Test and evidence harnesses

- **Contrast contract:** extend `src/__tests__/house-tokens.test.ts` to every ivory and forest pair.
- **Stylelint rules:**
  - font-size floors by role;
  - no literal colours or spacing outside tokens;
  - no `transform` or `filter` under `:hover`;
  - no `outline:none` without a replacement.
- **ESLint rules:**
  - no `toLocale*` or `Intl.DateTimeFormat` outside `lib/venue-time.ts`;
  - no `replace(/_/g` in render paths;
  - a copy lint banning praise words, exclamation marks and snake_case in JSX strings.
- **Playwright probes:** hover transform and filter; focus-ring pixel contrast; target size; 200% zoom and 320 px reflow; reduced motion; computed font family; luminance of reading surfaces; infinite animations.
- **Accessibility audit:** `support/accessibility-audit.ts:316-326` only checks that a ring exists, which is why the 1.22:1 ring passes. Add a contrast check, and extend the route list (`accessibility-route-audit.spec.ts:378-398`).
- **Visual baselines:**
  - Add the missing surfaces: Diary, Pipeline, Proposals, Search, Profile, Inventory, the planner, the twin enquiry form, and a production-mode `/`.
  - Re-record stale ones: `desktop-supplier-denied`, and `desktop-admin-create-venue-error`, which shows a retired sidebar.
  - Replace the Reviews baseline that uses mocked transitions (`dashboard-state-visual-performance.spec.ts:408`).
- **Committed mock-API fixture layer.** Turn the screenshot sweep harness, which exists only in the session scratchpad, into a committed layer with seeded roles, run under both en-GB/Europe/London and en-US/UTC. The sweep's en-US/UTC browser is what exposed the locale and time-zone bugs.
- **Fix e2e drift:** `e2e/support/diary-live.ts:101`, `e2e/production-smoke.spec.ts:98`, `e2e/venue-inventory-style-live.spec.ts:74`.
- **Task benchmarks** per surface, and **response-time telemetry** against 100 ms acknowledgement, 400 ms p75 for routine changes, and an Activity label after 1 s.
- **Real-device qualification** on the declared phones, tablets and office computers (Q-H8).
- **A design record per rebuild** in `docs/design/<surface>-<date>/README.md`, following the desk's record.

---

## 5. Questions only Blake can answer

Grouped by theme, with the themes that block the most work first. Every question has a recommended default, so work can continue while it is open.

### A. What we build first, and how money moves (blocks Tier A and X1)

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| A1 | Are contract and deposit in scope now? Which e-signature (in-product, DocuSign, Adobe)? Should Venviewer take payments (card, pay-by-bank) or only record them from the accounts system (Xero, Sage)? | In-product simple e-signature with evidence (take legal advice on the terms); card and pay-by-bank with Trades Hall as merchant of record; export to their accounting system | Capabilities 6, 7, 25; automatic hold-to-confirmed; wording of the client "Approve" button |
| A2 | What confirms a booking at Trades Hall: signed contract, deposit, or both? What deposit and payment timing is normal? | Signed contract and deposit received together make it confirmed; we draft CMA-aware deposit presets for you to pick | Ink rule; payment schedule presets; Diary confirmation copy |
| A3 | Is Trades Hall opted to tax? Do the preferred caterers invoice the client directly? Are minimum spends, per-head packages or day delegate rates used? Should quotes show inc-VAT, ex-VAT or both? | VAT configured per line and per venue; consumers see VAT-inclusive totals with all mandatory charges; businesses see ex-VAT plus a VAT line | Quote engine; proposal totals; analytics net vs gross |
| A4 | Should Venviewer email clients itself (acknowledgements, proposals, supplier packs), and from whom? Should replies carry the executive's name instead of "Venue team" (`proposals.ts:101`)? | Yes, from the venue's verified domain in the executive's name, always naming recipients before sending | Proposal sending; enquiry acknowledgement; supplier packs; X1 and X7 copy |
| A5 | What exactly does the team use: Salesforce edition (or Delphi on Salesforce), Cvent products (Supplier Network RFP inbox?) and monthly RFP volume, which sales-and-catering system, Microsoft 365 or Google? Can we have sample exports, anonymised? How much history must come across? | Import future bookings and contacts first; history read-only later; start with the Salesforce weekly export ZIP if the edition supports it | Importer design; mailbox integration; whether CSN intake is worth building |
| A6 | Where do enquiries come from, in rough shares? Who should own a new enquiry (the code currently emails hallkeepers)? Send an instant acknowledgement? What reply time can we promise? | A named sales owner by rota; a factual acknowledgement within a minute; "within one working day" | Intake parsers; response clocks; public copy |
| A7 | Pipeline value: raw total of open deals, or weighted by stage? Must every lost deal carry a reason? Should approving an enquiry create the deal automatically? | Raw open value plus "Won this month"; reason required from presets; keep deal creation as the one-click next step | X1; analytics |

### B. The team's own words (blocks every relabelling pass in N3–N5)

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| B1 | Holds: "provisional, 1st option, 2nd option, confirmed" (and "contracted"?) or "pencil and ink"? May "Ladder position", "Prospect" and "Occupancy footprint" go? | UI says "Provisional · 1st option", "Joint 1st option", "Confirmed"; pencil and ink stay internal; the jargon goes | N3 copy, chips and legend; client-facing statuses |
| B2 | Sales stages: Salesforce-style (Qualified, Negotiation) or venue language? | Enquiry → Viewing → Provisional → Proposal out → Contract out → Confirmed | X1 |
| B3 | What does the team call: Reference loadouts, Pending reviews, Handoff pack / BEO, Configuration, covers or guests, "Mission Control"? | "Standard set-ups", "Layout sign-off", "Function sheet", "Layout", "guests", "Event day" | Nav labels (N2), N4, X2, X4, L2 |
| B4 | Which planning and safety caveats are legally required, and may they appear once per document? | One plain line ("Numbers are planning estimates; the events team confirms them") plus a footer, keeping any sentence a test asserts | Client proposal page, planner, supplier page, Event Architect |
| B5 | Times: 24-hour on staff screens? And in client documents, "14:30" or "2.30pm"? | 24-hour for staff; "2.30pm" in client documents | `lib/venue-time.ts` (N1) |

### C. Navigation, roles and who may do what (blocks N2)

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| C1 | Should Enquiries be a named top-level item (a test currently forbids it)? Which items should each role see first? | Sales: Enquiries · Diary · Pipeline · Proposals · Clients. Hallkeepers: Today · Diary · Rooms. Executives: Performance. Admins add Inventory and Settings. | N2 and `DashboardLayout.test.tsx:82` |
| C2 | Who may do what? Specifically: should venue admins work the pipeline (the API refuses them)? Should hallkeepers search clients and see enquiries in the Diary? Who may cancel a confirmed booking, and must they give a reason? May staff withdraw a planner's submission, and is the planner told? Should venue admins manage rooms, prices and staff invitations and removals? May hallkeepers edit the venue name and address? Should "executive" become a real role? Who sees lifetime value and money? | Venue admins may work the pipeline; hallkeepers get neither client search nor enquiries; staff and admins may cancel with a required reason; only planners withdraw their own submissions; venue admins manage their own rooms, prices and staff; hallkeepers see venue settings read-only; make "executive" real; money visible to sales and managers | The capability map; N3 drawer; X1; L1 |
| C3 | A header search box and a ⌘K palette? A bell with a small copper number, or just a dot? | Yes to both; a small copper numeral, no pulse, no red | N2 |
| C4 | Which events should interrupt someone, and who hears about an urgent event-day problem, and how? | Interrupt only for a clash, a client decision, signature or payment, an urgent event-day problem (duty manager, in-app plus text), or a supplier question. Everything else in digests at 09:00, 13:00 and 16:30. | Notification engine; N4 copy |
| C5 | When access is denied, may we name the venue admin (with email), or offer "request access"? Should suppliers who sign in go straight to their own pages? | Name the admin with a mail link; redirect suppliers | N2 denied component |

### D. Diary and holds (blocks N3)

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| D1 | Should the Diary keep the flat ivory workspace you chose on 7 September, or take the desk composition? | Keep the full-width ivory grid, adding the desk's header, copper count plane and a docked forest panel on wide screens | N3 layout |
| D2 | What should the Diary open on: this week, decisions due, or a 12–18-month availability view? | This week with decisions due; month availability in a later phase | N3 |
| D3 | May confirmed bookings become dark forest cards, with holds light ivory carrying a copper option number? Owner initials on cards? Money on cards? | Yes, yes, and money only in the side panel | N3 encoding |
| D4 | Default hold length and decision window; lapse automatically or ask the owner; a challenge rule (for example 48 hours for the 1st option to confirm or release)? | Lapse automatically at the decision date with a note to the owner, unless a contract or deposit is attached; a challenge with a visible countdown, length yours to set | Capability 9 |
| D5 | When a 1st option is released and the 2nd is promoted: tell the colleague only, or also draft or send an email to that client? | Tell the owner in-app with a drafted email to review; nothing is sent automatically | N3 drawer consequence text |
| D6 | Keep the first-visit Diary guide for experienced staff? Should hallkeepers see set-up and teardown bands prominently? | Replace the modal with an always-visible legend and `?`; bands on the timeline only | N3 |
| D7 | Who runs show-rounds, and when? Are they recorded anywhere today? | Tours become Diary objects owned by their host | Capability 20 |

### E. Hallkeeper and event day (blocks N4 and X4)

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| E1 | Keep one live event-day tool (merge the checklist and issue form into Mission Control) with one problem log? Keep the name "Mission Control"? | Merge into one "Event day" tool with an offline queue and venue words | X4, and limits rework in N4 |
| E2 | Who holds it during an event: a hallkeeper on a phone on the floor, or a duty manager at a desk? | Phone-first for hallkeepers; keyboard support for the desk | X4 layout |
| E3 | May rows be ticked on a sheet that is awaiting approval, or has been rejected? | Allowed while awaiting, under an amber band; locked when rejected | N4 |
| E4 | When you rejected the long hallkeeper sheet, was it the length or the look? Would one category at a time, with zones that fold away when done, be acceptable? Checklist or plan first on phones? | Yes to one category at a time; checklist first | N4 |
| E5 | Should allergies and the day-of contact always be in view for hallkeepers? | Yes | N4 "Keep in view" band |
| E6 | Is the Day Board a wall display or a phone list? Should client names appear on it? Should anything move? | A phone and tablet list; no client names; only a single stamp when a room's state changes | N4 |
| E7 | Should hallkeepers open floor plans read-only from the Diary? Should they get an approval email for every layout? | Yes; every approval, batched into a digest if the event is more than 14 days away | N3 read-only view; X2 email |
| E8 | Is the function sheet handed out on paper? Is a dim mode wanted for darkened halls? | Print-first A4 with a QR code to the live version; no global dark mode, a personal dim option later | X4 |

### F. Look, feel and personal comfort (blocks details of N1 and X3)

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| F1 | Should the planner chrome be forest over the 3D room, or fully ivory? Does the planner keep any of the gold cursor, gold scrollbar or springy buttons? | Forest chrome; remove every cockpit ornament everywhere | N1 cursor and scrollbar; X3 |
| F2 | Is Newsreader the house serif for every staff surface, including the VENVIEWER wordmark (now Georgia), with Inter for UI? | Yes | N1 |
| F3 | Should every staff screen use the desk's tokens and components (sage, ivory, forest, copper), adapted per workflow? | Yes | N1 through X9 |
| F4 | Long client messages and timelines sit on dark green, and research favours dark text on light for reading. May we try a pale "letter" inset for long text inside the forest panel? | Yes | Kit DecisionPanel |
| F5 | A per-person compact density option? A per-person "larger text" option (never labelled by age)? | Both, stored per person | Preferences capability; ledger component |
| F6 | Sound: none, or one optional quiet cue when a client signs or something leaves the building? | Silent by default, with that one optional cue | Later polish |
| F7 | On the desk: keep the first-name greeting? Keep the "N moved forward this session" tally? Offer an end-of-day close? | Keep the greeting; drop the tally, which can read as scorekeeping; make the day close optional and off by default | Desk; day-open capability |
| F8 | Room photography at more moments (confirmed booking, signed contract, opening the hallkeeper sheet)? | Yes, at openings and completions only, using only sourced photos | X1, N4, X4 |
| F9 | Heather (dusty violet) to mark AI drafts, or a symbol only? Should the marketing accent move from brass to copper? | Heather with a glyph and the word "Draft"; copper | Tokens (N1); X5 |

### G. Clients, suppliers and public pages (blocks X1, X5 and X7)

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| G1 | Which is the one public homepage: `/` or `/fresh` (which the flyers reach through `/editor`)? Is it Trades Hall's site or Venviewer's front door? May `/landing`, `/welcome`, `/living-hall` and `/blueprint` be retired? | Merge `/fresh` into `/` as Trades Hall's site; Venviewer marketing lives on its own path; redirect the rest | X5 |
| G2 | Should staff links stay on public pages? May the splat hold be one calm line in plain words ("walk-through") rather than per-card "Work in progress" labels? | A single "Staff sign in" link; one plain line | X5 |
| G3 | Required public enquiry fields; must a room be chosen; which capacity formats are public; should prospects see live availability? | Email, date and guests required; room optional with "Not sure yet"; reception and dinner (theatre if confirmed); no public live availability | X5 and N6 |
| G4 | Should client-facing pages wear the Venviewer style, Trades Hall's branding, or both? Keep a venue colour setting? Should the venue name in settings drive the planner (currently hard-coded)? | The selected style carrying the venue's name, crest and photographs; no venue colour; settings drive the planner | X1 client page; L1 |
| G5 | Does approving a proposal commit the client? Deposit payable from the proposal page? Default validity, and automatic expiry? | Agreement in principle pending contract; deposit through the contract step; 30 days' validity (your figure) with a notice when it expires | X1 |
| G6 | What must suppliers always see, and what is off-limits? Who sends packs today? Should suppliers have a home page? | Date, arrival window, room, address, loading entrance, quantities and venue phone; no budget or client contact details; coordinators send; supplier home later | X7 |
| G7 | Are the prices, add-ons, scan tiers and 14-day trial approved? Should Pricing stay public before self-serve billing exists? Keep the competitor table? Is there a Venviewer legal entity with customer terms? | Keep Pricing public but make every call to action "Book a walkthrough"; remove unsourced competitor figures; publish terms before any trial | N5; L3 |
| G8 | Should `/demo` (with Elaine's name and the PDF) stay public? | A private share link | N5 |
| G9 | Are the Trades House leaflet and quiz the charity's own brand, separate from Venviewer? Should the fictional hallkeeper walkthrough stay in the product? | Separate brand; walkthrough under Help | L3; X4 |
| G10 | Who is Event Architect for (sales from an enquiry, or operations after booking)? Should selection stay final? Should the Foundry review tool ship at all? | Sales, opened from the enquiry; final per comparison, with "Start a new comparison"; Foundry stays off the product | X9; L4 |

### H. Trades Hall facts we need from you or your team

These are information, not preferences. Until each arrives, the default is to show it as "Not set" and never invent it.

| # | Fact needed | Blocks |
|---|---|---|
| H1 | Which rooms combine, or cannot be sold together (noise, shared access, staffing), for example the galleries, or the Saloon with the Grand Hall | Room combinations (capability 9) |
| H2 | Capacities by layout style, and which styles Trades Hall sells | Capability 17; public capacities; planner auto-fill |
| H3 | How room hire is priced (day rates, sessions, minimum spend, seasonal); financial year start; net or VAT-inclusive reporting | Quote engine; pricing editor; analytics |
| H4 | The 3–5 numbers leadership reviews weekly, and how "utilisation" is defined | X8 |
| H5 | The standard hire agreement and terms, and who signs for Trades Hall | Capability 6 |
| H6 | Default seats per round and the table sizes the venue owns | X3 placement defaults |
| H7 | Who signs off door positions, routes and operations; whether measured floor plans exist for tracing | X9 evidence panel; L1 room editor |
| H8 | The screens the most senior daily users work on (size, laptop or monitor, tablet), their viewing distance and room lighting | Type sizes by viewing angle; device qualification |

---

## 6. Risks and what not to do

| Don't | Why (evidence) | Do instead |
|---|---|---|
| Praise copy, cheerleading, exclamation marks, "Great job", "Almost there" (`TwinEnquiryModal.tsx:219`, `GuestEnquiryModal`) | Blake calls it belittling (`product-experience.md:14`); controlling feedback lowers intrinsic motivation (Deci, Koestner & Ryan 1999) | Plain consequence lines ("Declined. Sarah Henderson was emailed at 14:02.") enforced by a copy lint |
| Gamification: points, badges, streaks, leaderboards, confetti, tallies compared between colleagues | Imposed games lowered positive affect (Mollick & Rothbard); badges and leaderboards lowered motivation and exam scores (Hanus & Fox 2015) | Honest counts falling to zero, one restrained stamp, a sealed "All caught up" |
| Generic dashboards: walls of identical KPI cards, cyan labels and gold numerals, "GBP 4,750.00" | This is the look Blake rejected; see the `desktop-executive-analytics-success` baseline | A headline sentence, one copper plane of figures that decide, and every figure linking to its records |
| Hidden consequences: one-click terminal actions, "sent" or "notified" copy with no send behind it, silent 404s for clients | `product-experience.md:17`; see the N5 list | ConsequenceConfirm naming recipients and effects; API tests that spy on sends |
| Confirmation dialogs everywhere | Brains habituate to warnings from the second exposure (Anderson et al. 2015) | Confirm only external or irreversible actions; Undo for everything internal |
| A toast for every success; errors that fade after 4 s; errors in two places | Calm technology; WCAG 2.2.1 | Show the changed state; persistent inline errors with Retry |
| Fake progress, guessed counts, skeletons, fake percentages, false "Refreshing" drama | `.claude/conventions/loading-and-working-motion.md` | The shared Activity component with real labels; keep the last good data visible |
| Switching the workspace ground to light for every view at once | Several views paint light text straight onto the ground (`DashboardLayout.css:92`) | Migrate view by view, with contrast tests |
| Copying `--enq-*` into each new surface, or adding one-off hex values | Drift is already 250 hexes in dashboard and shared code, and 1,208 web-wide | One register token layer plus a lint against literal colours |
| Spring hovers, overshoot curves, endless pulses, blur-in entrances | Founder decision (`:34`); too much "juice" hurts (Kao 2020) | Press feedback only, 120 ms colour hovers, one 320 ms stamp |
| Dark surfaces for reading, 7–11 px text, six-plus font families | Dark text on light reads better, especially small type (Piepenbrock 2013/2014); the audit counts show how widespread the problem is | Read on ivory, decide on forest; a 12 px floor; Newsreader and Inter only |
| Status carried by colour alone, or blue against green | Age-related yellowing of the eye's lens causes blue-yellow deficits; WCAG 1.4.1 | Every status is a named chip; tones differ in lightness |
| Menus that reorder themselves, or moving the primary action | Static menus beat adaptive ones (Findlater & McGrenere 2004) | One fixed "next step" position per surface type |
| "Simple" or "senior" modes, first-run tours for experts | Age-stereotype cues lower performance (Lamont et al. 2015); guidance for novices hinders experts (Kalyuga 2003) | Right-sized defaults for everyone; help on demand through `?` |
| Compliance or safety claims ("capacity OK", fire, licensing, allergen "safe" badges) | Blake's brief and the repo's claim guard | Operator-entered data, and "Not checked" where nothing was checked |
| Presenting stubs as integrations | The webhook test stores `stubbed` (`routes/integrations.ts:193-216`); the layer is metadata only (`integration-layer.ts:13-30`) | Label them "not connected" until live |
| Auto-sending AI drafts, or auto-merging duplicate contacts on email | Marketplaces mask email addresses, so an email key is wrong (research); AI output is marked unverified (`types/src/ai-assistant.ts`) | Drafts need a human send with a consequence preview; dedupe suggestions on name, date and phone |
| Marketing to clients without consent, drip pricing, oversized deposits | PECR; DMCC Act (April 2025); CMA deposit guidance | Separate service and marketing streams; inclusive consumer prices; CMA-aware presets with advice to seek legal review |
| Tenancy leaks, or copying the reference image's sample stock into data | Hard-coded "Trades Hall" (`GuestEnquiryModal.tsx:254,596`); `product-experience.md:48` forbids importing the illustrative figures | Venue identity from data; no sample figures in venue records |
| Treating passing tests, mocks, stale baselines or agent agreement as acceptance; loosening tests to fit | `AGENTS.md`; the stale `desktop-supplier-denied` and mocked-transition baselines | Fix causes; re-record baselines deliberately; change `DashboardLayout.test.tsx:82` only on Blake's decision; get Blake's verdict separately |
| Beauty without parity | Research: veterans cannot switch without import, mailbox, intake, VAT quotes, contract and deposit | Run Tier A of §3.2 alongside the surface rebuilds |
| Reopening held scope: room walk links during the splat hold, shipping Foundry, or a big-bang rewrite | `docs/sessions/2026-09-19.md`; `AGENTS.md` ("age alone does not justify a rewrite") | Keep domain behaviour that already works: hold hygiene, pending-command retention, navigation guards, stale-response guards, the offline queue |
| Polish that slows the 3D planner or the Diary | Declared device targets (`product-experience.md:58`); response budgets | Measure frame time and interaction latency on real devices before and after every change |