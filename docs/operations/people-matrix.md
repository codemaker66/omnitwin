# People matrix — who receives what, who covers, when it escalates

**Status: draft for Blake to correct** (goal 19, S0, 8 October 2026, T-651). Drafted
from the roles and gates in the current source and the goal's D8 defaults. Until Blake
corrects it, the defaults below apply. Everything here is venue configuration: it lives in
`venue_settings` (one row per venue) and is never a constant in code. S7 of goal 19 wires
the columns named in §6; until then only `request_escalation_seconds` exists.

Blake's question it answers (HUMAN.md 8): who receives each request kind; who covers an
absence; how long before an unowned request escalates and to whom; which admins hold the
narrow approval capability for layout, price and timing changes; who releases staff
instructions.

## Roles as the product knows them today

| Role | On the floor | Reads the Diary | Inks a time | Raises a request | Handles a request | Approves money or a layout |
|---|---|---|---|---|---|---|
| admin | yes | yes | yes | yes | yes | yes |
| manager | yes | yes | yes | yes | yes | proposed: yes (Blake decides) |
| staff | yes | yes | yes | yes | yes | no |
| sales | no | yes | yes (books the room they sold) | no | no | no |
| hallkeeper | yes | yes | never | yes | yes | never |
| caterer | event-scoped only | no | no | goal 10 | no | no |
| client, planner | no | own event only | proposes a window (S6) | own event only (S4) | no | no |

Sources: `packages/api/src/utils/query.ts` (`canManageVenue`, `canAdministerVenue`,
`canReadDiary`), `services/booking-mutations.ts` (`DIARY_WRITE_ROLES`: staff, admin,
manager, sales) and `@omnitwin/types` `STAFF_AUDIENCE_ROLES` (admin, manager, staff,
hallkeeper). Goal 19 D2 adds `canProposeWindow`, `canRaiseRequest` and
`canHandleRequests` beside these; it never widens `canManageVenue` into an approval gate.

## 1. Who receives each request kind

The audience of a request is fixed when it is made and is never widened. Today every
request goes to the whole floor (admin, manager, staff, hallkeeper). "Usual owner" is who
is expected to press "I'll take this"; ownership is always exactly one person.

| Kind | Audience | Usual owner | Becomes a decision for the office when |
|---|---|---|---|
| refreshments | the floor | the hallkeeper on shift in that room | never (within the catering order) |
| temperature | the floor | the hallkeeper on shift | never |
| cleaning | the floor | the hallkeeper on shift | never |
| av (sound and screens) | the floor | a hallkeeper with the `av` rota skill, else the duty manager | hired equipment is needed |
| access | the floor | the duty manager | never |
| chairs (goal 19 adds) | the floor | the hallkeeper on shift | the quantity exceeds the released layout's count |
| tables (goal 19 adds) | the floor | the hallkeeper on shift | the quantity exceeds the released layout's count |
| setup (goal 19 adds: move or reset a room) | the floor | the hallkeeper on shift | it changes the approved layout |
| other | the floor | the duty manager | the hallkeeper says so when handing it over |

A request from a client reaches the same floor audience through a client-facing thread;
the hallkeeper who takes it sees the client's words only inside that request.

## 2. Who covers an absence

- A request nobody owns after its window (§3) escalates to the **duty admin**: the venue
  administrator named in `venue_settings.duty_admin_user_id`, else every venue admin (what
  the escalation email does today).
- When no hallkeeper screen is on (no hallkeeper presence on the venue channel), the office
  sees "No hallkeeper screen is on; escalating in N min" and the same escalation runs.
- Cover on the day: the person on a published rota shift with the `duty_manager` skill, then
  the venue admins. The rota (`rota_shifts`, T-637) is the source; nobody is written into code.
- **Shift handover:** an outgoing hallkeeper's open requests pass to a named person who must
  accept them; responsibility stays with the outgoing person until that acceptance. Absent
  relief escalates to the duty admin after the "soon" window. A shift is never silently
  extended.

## 3. Escalation windows and quiet hours

| Urgency | Default window before escalation | Production today |
|---|---|---|
| now | 2 minutes | 180 seconds, "now" only (`venue_settings.request_escalation_seconds`, migration 0077) |
| soon | 5 minutes | does not escalate |
| routine | 15 minutes | does not escalate |

- Escalation order: the duty admin in the product (slab ring, inbox, push once S7 lands),
  then Resend email to the duty admin **outside quiet hours only**.
- Quiet hours for email: **22:00 to 07:00 Europe/London** by default. In-product delivery
  never sleeps. Nothing is ever texted or posted to a third-party chat.
- Web push (S7) carries three events only: a request landed for you, a request escalated to
  you, a reply to your own request.

## 4. Who may approve a time, a price or a layout change

| Decision | Who, by default | Note |
|---|---|---|
| Propose a window (a hold on the Diary ladder linked to a plan) | client with a live event link, planner, staff, admin | `canProposeWindow`, hold rank only (S6) |
| Approve a time (ink, move or resize ink) | staff, admin | today's set also includes manager and sales (`DIARY_WRITE_ROLES`); Blake to say whether both keep it |
| A quantity beyond the released layout | admin; manager if Blake says so | the decision object (goal 09), never `canManageVenue` |
| A price change | admin; manager if Blake says so | the decision object |
| A layout change after release | admin, manager, staff (today's release path) | the Ops Compiler compiles only approved frozen snapshots |
| Release staff instructions (the approved sheet) | admin, manager, staff | as today (T-633) |

## 5. The wall display

Shows room, event title, state, time and this hallkeeper's next action. Never shows guest
names, dietary or access notes. Venue-configurable; the conservative default is on.
Day boundary (when "today" rolls over on a wall left on): **04:00** venue time.

## 6. Columns S7 adds to `venue_settings`

`request_escalation_seconds` exists. S7 replaces its single window with the matrix above:
`escalation_now_seconds`, `escalation_soon_seconds`, `escalation_routine_seconds`,
`quiet_hours_start`, `quiet_hours_end`, `duty_admin_user_id`, `day_boundary_hour`,
`handover_relief_seconds`, `wall_shows_guest_details`. Each has the default named here
and is edited in the venue's settings, never in a migration after the first.

## What Blake decides

- [ ] The usual owner per kind in §1, especially AV and access.
- [ ] Who the duty admin is, by name.
- [ ] The three windows in §3 and the quiet hours.
- [ ] Whether manager and sales keep the power to ink a time (§4).
- [ ] Whether manager may approve quantities beyond release and price changes (§4).
- [ ] The day boundary and the wall's privacy default (§5).
