# The planner's figures: who stated them

What the planner may say about capacity, rigging, power, escape routes and price,
and to whom. Built from the red-teamed upgrade brief's fix-first items 1 to 3
(16 October 2026): the public planner said 339 standing in a Grand Hall the venue
publishes at 250, called a green "Within WLL" on a 500 kg nobody entered, and
showed a £5,044 "Total estimate" at made-up rates against a published £2,800.

## The rule

A figure appears with who stated it and when, or it does not appear. A fact
nobody recorded reads "Not recorded" with the person to ask. Nothing answers a
structural, electrical, egress or occupancy question with "within", "fits",
"pass", "valid" or "compliant".

## Where it lives

| Piece | Code | What it guarantees |
| --- | --- | --- |
| Published figures | `lib/planner-truth.ts` over `@omnitwin/types` `trades-hall-venue-truth.ts` | Only Trades Hall's own rooms carry its figures (the venue is read by id, not by room name); a room the venue publishes nothing for gets nothing invented. The label is written from `VENUE_TRUTH_STATEMENTS`: "Published guide · Trades Hall · 9 Jul 2026". |
| Layout to published format | `plannerLayoutStyle`, `publishedFormatForStyle` | Round and long tables read as dinner, rows of chairs as theatre, standing poseur tables as the planner's "cocktail" and so the venue's reception figure. Ceremony, cabaret, boardroom and custom layouts have no published figure. |
| Who is staff | `plannerViewerIsVenueStaff` in `lib/planner-truth.ts`, used by `hooks/use-planner-truth.ts` | The planner's existing gate, `canReadInternalEventData` (the venue floor at its own venue, or a platform administrator), narrowed to the venue whose room is open. A client, a planner, a visitor or another venue's team is not staff. |
| Computed counts | `lib/room-capacity.ts`, `lib/layout-capacity.ts` | Floor area ÷ generic spacing is shown to staff only, labelled "Estimate at generic spacing", in the Guests lens and the layout summary. Clients and visitors are counted against the published figure in the Guests lens, the layout summary, the enquiry form and the Share lens's capacity line. |
| Not recorded | `lib/unrecorded-ask.ts`, `components/editor/cockpit/NotRecorded.tsx` | Staff ask the hallkeeper (the mail opens with no recipient: the planner holds no address for him); clients and visitors ask the events team at the venue's published address, or are told who to ask when none is published. The question is drafted; the viewer sends it. |
| Rigging, power, doors, escape routes | `RiggingLensPanel`, `PowerLensPanel`, `FlowLensPanel`, `cockpit-evidence-model.ts` | The point WLL and rating, the supply's breaker, the door positions and the room's maximum start as not recorded. A figure typed in says "Entered here in this plan; not a check"; the only verdict left is "over" the figure entered. The flow simulation gives no bottleneck score while any door was placed mid-wall. |
| Lighting rig | `stores/lighting-rig-store.ts` | Starts empty, so no fixture nobody added feeds Costs, Power or Rigging. |
| Costs | `CostsLensPanel.tsx`, `stores/cost-store.ts` | Clients and visitors see "Ask us for a quote" with the plan's numbers in the drafted question, and no price. Staff keep the example scenario, marked as example rates. |
| Egress codes | `lib/egress.ts` (reference only), `types/src/solver/compliance.ts` | England's Approved Document B, the US NFPA 101 and an unverified BS 9999 table are not quoted on any planner surface; the solver's violation text names its own planning setting. No planner surface imports `lib/egress.ts`. |

## Guards

- `src/__tests__/public-claim-guard.test.ts`, "banned safety verdicts on planner
  surfaces": scans the planner's components and the libraries that write their
  words for a verdict word near a safety subject, a Pass/Within/Fits chip, or a
  foreign code citation, and fails if any planner surface imports `lib/egress.ts`.
- `components/editor/cockpit/__tests__/banned-verdicts.test.tsx`: renders the
  Rigging, Power, Lighting, Evidence, Guests and Costs lenses and the layout
  summary for a visitor, a client and staff, on an empty floor, under and over
  the published figure, and with figures typed in; none may show a verdict word.

## Open

- A published rate is shown to clients only with its year, source, VAT and every
  compulsory charge. The venue's published wedding rates do not record VAT or
  compulsory charges, so the Costs lens shows none yet.
- The venue's own provenance calls its capacities a planning guide; the venue
  should re-confirm them.
- Outside the planner: the dashboard proposal composer's capacity aid still
  computes "comfortable for around N", the Event Architect page shows "Pass"
  statuses and a bottleneck percentage, and the Trades Hall visual page shows a
  bottleneck score.
