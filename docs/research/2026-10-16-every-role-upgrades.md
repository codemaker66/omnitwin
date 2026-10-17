# Every role, one hall: the biggest upgrades, red-teamed (16 October 2026)

Blake asked (16 Oct 2026): "looking at our venue planning platform from start to finish, what's the biggest upgrades you can make. red team your proposals with the harshest critique", with every role connected to a bookable venue researched as 50-year veterans, and with his "deeper, not bigger" method (top professional, rawest material, methods, outside proof; speed, altitude, depth, range) applied.

Published brief (private to Blake): https://claude.ai/artifact/H8VoKSJvzxJHaJmQuUYAnD. Evidence (per-agent JSON, digest): `D:/claude/dream-platform-20261016/` (`evidence/` phase one, `redteam/` phase two). Code facts were read at origin/master `9cbe15c1`.

**Status: proposed.** This is agent research and judgement, not founder acceptance. Nobody at Trades Hall was consulted; all 63 personas are illustrative composites.

## Headline

The biggest upgrade is not a new feature. Venviewer should stop telling people things nobody has checked, make every Trades Hall hold part of one event record from the first pencil, and carry one real Trades Hall Saturday through the product end to end. Every delight on this slate is built on those three, and none of the slate is proven until the Saturday has happened.

## The one thing

Ship the bind (event-spine Phase A) and use it to run the first real Trades Hall event end to end with Elaine and a working hallkeeper (goals/HUMAN.md item 1). The bind means every hold or ink, from every writer, creates or joins its event in the same database transaction, and the event's status is derived from its bookings.

Why this comes first:
- July named it 'the one thing', and it has still not shipped. Holds created from enquiries are inserted with eventId null (verified: packages/api/src/routes/bookings.ts:354). The only link today is a manual two-write 'start plan' that its own code says can orphan events.
- The import, the sealed agreement, supplier passes, versioned sheets, promises and 'same again' all hang from that one id.
- It is two to three weeks now (inferred), while production holds almost no real bookings. After the forward book is imported it becomes a backfill of hundreds of ambiguous rows.
- Only a real event creates the baseline every success metric on this slate needs. None exists today.

One prerequisite takes days, not weeks. In the same first week, remove the false claims the public product makes today: 339 standing against a published 250, a green 'Within WLL' on an invented 500 kg, a £5,044 estimate against a published £2,800, and the MCP telling AI assistants a room is 'free' two years out from a Diary that does not hold the venue's book. These are fix-first items 1 to 4. They are hours of work, they are live liabilities, and trust is the product.

## Ranking (all reworked by the red team; none survived unchanged)

| # | Upgrade | Why this rank | Impact | Delight | Feasible | Defensible | Evidence | Urgency |
|---|---|---|---|---|---|---|---|---|
| 1 | **One Event Record: born at the first hold, owning every fact (Phase A, the bind, only)** (`event-spine`) | It is the foundation every other item depends on, it is urgent (9) and well evidenced (8, verified at bookings.ts:354), and it costs a few weeks now against a messy backfill later. Its low defensibility does not matter for a foundation. Parties (Phase B) and moving a date (Phase C) follow as separate slices, each with its own proving moment. | 8 | 5 | 7 | 3 | 8 | 9 |
| 2 | **Switching Day and the Open Door: the forward book moves in, reconciled to the penny, and can leave on any day** (`switching-day`) | Until Trades Hall's real diary, holds and part-paid deposits live in Venviewer, every other item has almost no real users. It scores highest on role impact (9) and urgency (9). Its first slice also closes a live defect: any staff account can rewrite prices through the API (pricing-rules.ts with query.ts:107). Its importer waits for the bind and a signed processor agreement. | 9 | 5 | 6 | 7 | 7 | 9 |
| 3 | **The Yes That Sticks: a sealed agreement, one confirm on the venue's own rule, and money that lands in the books the venue already keeps** (`the-yes`) | This is the reason a veteran cannot switch: accepting a proposal 'does not hold the date or take a payment' (ProposalPage.tsx:362-363). It scores 9 on role impact and 9 on urgency. It sits below the two foundations because its money half waits on Blake's A1-A3 and A5 answers. Its seal works without payments: a manual deposit tick and a CSV, Xero or Sage export. | 9 | 7 | 6 | 6 | 8 | 9 |
| 4 | **The First Answer: every enquiry recorded, owned and answered truthfully, with public date status only once the book is proven whole** (`first-answer`) | It is the item closest to revenue. Slice 1 needs no new infrastructure: log any enquiry in 15 seconds, record the introducer, ask guest count first, offer an anonymous share. It also stops the live MCP over-claim. Public date status and sending from the product wait on the reconciled book and the sending domain, which holds feasibility at 6. | 8 | 7 | 6 | 5 | 7 | 9 |
| 5 | **The House Book: who said each number, when, and the building's rules before anyone buys stock** (`house-book`) | It has the strongest evidence (9) and is the most defensible item (7) after switching-day. Its honesty fixes are already on the fix-first list, and its next slice, a public rules page with the Clerk's first 10 cards, protects every supplier. It ranks fifth only because it needs a named owner at the venue with agreed hours, and none exists in the evidence. | 8 | 6 | 7 | 7 | 9 | 8 |
| 6 | **A Door for Everyone Outside: one named pass, no account, a receipt both ways** (`doors`) | It is the cheapest real unlock on the slate: an issuing screen over a supplier-pack API that is already built and serves 13 roles. It is also every outsider's first sight of the product. Stage 2 (officiants, casual staff, drivers) waits on a new party_grants table and on proof from real suppliers. | 8 | 7 | 8 | 5 | 7 | 8 |
| 7 | **One Living Record: every department reads the same version, and paper knows when it is out of date** (`living-record`) | Version drift is the operational pain named most widely across the clusters, and the first slice is small: a version line and status-only QR, plus a one-line floor change. Its real value appears only once real events run and an outside caterer acknowledges at least two of three events. | 8 | 7 | 7 | 6 | 6 | 7 |
| 8 | **The Fair Diary That Knows the Building: holds that resolve on time, and works and shared spaces in the same book** (`fair-diary`) | Stage 1 is nearly free and carries out a founder decision that was never built (promoted-owner notice, reminders), plus typed works windows. That gives it feasibility 8. The building model, room combinations and challenges are gated on evidence that multi-event days actually collide. | 7 | 6 | 8 | 5 | 8 | 8 |
| 9 | **Close the Night: a room passport, a signed show report, and extras that stand up on Monday** (`close-the-night`) | It is highly feasible (8) and holds a real revenue lever: extras agreed on the night stop living in memory. The room passport answers the hallkeeper's sev-8 fear of being blamed. It needs real nights to prove itself, and last season's disputes decide how much of it is revenue and how much is time saved. | 7 | 7 | 8 | 6 | 7 | 6 |
| 10 | **Nobody Starts From Zero: promises the client can see, handovers the receiver accepts, last year's event as this year's draft** (`nobody-starts-from-zero`) | The continuity pains are real (sales sev 9, community sev 9), and 'same again' is retention revenue timed to when the societies rebook. The evidence is composite (6), however, and the owed list needs a DPIA and a staff notice before any code. | 8 | 7 | 7 | 5 | 6 | 6 |
| 11 | **Built for the Stone Building: opens with no signal, says what has not sent, and stays silent while the vows are live** (`stone-building`) | For a stone building this is a basic need, and it absorbs goal 19 S7. But nobody has measured signal inside Trades Hall (evidence 5). A two-phone signal walk and a Clerk cold-start spike come first, and they may demote the offline shell below the outbox and quiet windows. | 7 | 6 | 7 | 5 | 5 | 7 |
| 12 | **Safe Night, Sound Evidence: a signed night log and an alarm-isolation permit nobody can forget** (`safe-night`) | No competitor has it, it is cheap, and Martyn's Law commencement (expected spring 2027) gives it a date. The permit's value depends on whether Trades Hall isolates alarm zones at all: 'zone 4' comes from a composite persona. Twelve months of panel history decide it. | 7 | 6 | 7 | 6 | 5 | 6 |
| 13 | **People, Not Counts: the host's list becomes named needs on real seats, and the kitchen's acknowledgement is what the guest sees** (`people-not-counts`) | The pain is real (catering sev 10), but this is the highest legal risk on the slate: health and religious data under UK GDPR Article 9, and no encryption at rest today. Nothing ships before a signed DPIA. Slice 0 starts now with a retention rule on today's free-text allergy field and a hand-made kitchen A4 at one dinner. | 8 | 7 | 5 | 5 | 7 | 5 |
| 14 | **The Prompt Book: a printable running order with owners, a flip plan the hallkeeper can count on, and a live line that only advises** (`prompt-book`) | It has the weakest evidence (5) and the lowest urgency (4), and whether the toastmaster-to-kitchen relay actually fails at Trades Hall is unmeasured. The paper prompt book and the flip strip are cheap and wanted. The live layer waits until two shadowed Saturdays show the relay failing. | 7 | 7 | 7 | 6 | 5 | 4 |

Each hardened proposal (what every role sees, look/feel/sound, the four questions, first slice, measures, upheld critiques, validation with real people) is in `redteam/adjudicate__<id>.json` and the published brief.

## Fix first

1. **Lead the Guests lens with the venue's published figure for each layout: 180 dinner, 250 reception and 250 theatre, labelled 'published guide, Trades Hall, 9 Jul 2026'. Map the planner's 'cocktail' style to 'reception'. Show the computed counts to staff only, as 'estimate at generic spacing'. Remove the fits, tight and over chip.** The public planner states 339 standing against the venue's own 250. That is safety-adjacent and breaks July's first refusal, and the fix is hours. The venue should also re-confirm its published figures, since VENUE_TRUTH_PROVENANCE itself calls them a planning guide. _Evidence: Verified: layout-capacity.ts:28-35 (1.5, 0.65 and 0.8 m2 per guest over 220.5 m2 gives 147, 339 and 275; the minimum allowances give 490 standing). The published figures are at trades-hall-venue-truth.ts:36. ground:live-walk severity 5._
2. **Remove every verdict built on an assumed input:
- no 'Within WLL' on the default 500 kg;
- no 'Pass' chips in Evidence;
- no 'Bottleneck 100/100' on doors 'assumed mid-wall';
- no England ADB or US NFPA citations for a Glasgow building.
Inputs show 'not recorded', each with an Ask action. The lighting rig starts empty. Extend the claim-guard tests with a banned-verdict test.** All seven lenses call a green structural verdict on a number nobody entered the most dangerous screen in the product. The wrong-jurisdiction fire citation should be removed before anything else is built on it. _Evidence: Verified: RiggingLensPanel.tsx:60 useState(500) and :71 'Within WLL'; lighting-rig-store.ts:64 DEFAULT_RIG_COUNTS (18 fixtures, which also feed Costs and Power); egress.ts:9-12 cites ADB Vol 2 and NFPA 101; solver/compliance.ts:57. ground:live-walk severity 5._
3. **Stop showing example prices to anyone who is not staff. Show the published rate that matches the occasion, with its year and source, including VAT and every compulsory charge. Otherwise show 'Ask us for a quote'. Never show an outside caterer's prices.** The venue's own tool shows prospects made-up prices. The fix is a few lines. _Evidence: Verified: cost-store.ts:12-17 (£750 room hire, £45 per cover, £8 per table, £150 per AV item, £35 per fixture). ground:live-walk severity 5: a £5,044 'Total estimate' against the published £2,800._
4. **Rename the public MCP's bare 'free' to a self-caveating state (for example 'no_booking_on_our_diary_team_confirms'), with asOf in every answer and the same wording on the web. Add a per-session request budget on top of the per-IP limit. Whether to hide date status by default until a room is reconciled is Blake's decision.** AI assistants are being told rooms are 'free' two years out from a Diary that does not hold the forward book, which is the false OK July refused the word 'available' to avoid. _Evidence: Verified: public-mcp.ts:239 says it returns only 'free', 'held' or 'busy'. public-discovery.ts:53-55 allows 92 days per call and 730 days ahead, at 120 requests per minute per IP. product-experience.md:35: the real book lives in Salesforce, Cvent, venue software, email, spreadsheets and paper, and no importer exists._
5. **Restrict pricing-rule POST, PATCH and DELETE to admin, plus manager only if Blake says so, with route tests proving staff receive 403.** Any staff account can rewrite prices today, against a recorded rule, and real pricing rules are about to be entered (item 13). _Evidence: Verified: routes/pricing-rules.ts gates on canAdministerVenue; utils/query.ts:107 VENUE_ADMINISTRATION_ROLES = admin, manager, staff; docs/operations/people-matrix.md:89 'A price change: admin; manager if Blake says so'._
6. **Replace 'Gaussian splats · Work in progress', 'Try the virtual tour · Work in progress' and the seven 'Work in progress' card labels with calm copy that names the rooms and offers the panorama tour. Do not claim the captured 3D room is live while the founder's splat hold stands. Blake approves the wording.** In its first five seconds the front door apologises in engineering words. It is a copy-only change, but the hold is a rights decision, so the copy must not overclaim. _Evidence: Verified: home-copy.ts:62-66 and :86, whose comment ties HOME_HERO_SPLATS_HELD to the 19 Sep hold; lib/splat-access.ts returns false on venviewer.com. ground:live-walk severity 4 (copy) and severity 3 (two home pages disagree)._
7. **Delete the unsourced competitor price table from the pricing page, and do not name competitors on the page at all.** It is a minute's work, and it breaks July's refusal of counter-marketing the moment the page goes public. _Evidence: Verified: PricingPage.tsx:745-751 ('Cvent Event Diagramming $500–2,000/mo', 'Prismm $99–299/mo'). ground:competitors-smb-uk found disagreeing sources (Prismm from $35 a month)._
8. **When a 2nd option moves up, write a staff notification inside the same transaction as the resequence. It carries a drafted email addressed to the hold's relationship owner (the agent, on an introduced hold), which a person reviews and sends. If the owner cannot write the Diary, the card says who in the office will confirm or release. Cover released, expired and lost exits alike.** A recorded founder decision has not been built, and every silent promotion risks a lost booking. _Evidence: Verified: booking-mutations.ts:646-690 returns the resequence only to the actor; event_plan_notifications accepts a null eventId; product-experience.md:41 records Blake's 26 Sep decision; DIARY_WRITE_ROLES is staff and admin (booking-mutations.ts:121)._
9. **Confirm RESEND_API_KEY and DIARY_CRON_TOKEN in production, run the hold-reminder dry run for Blake, then uncomment the schedule. Owners only, never clients.** It is built and decided and has never run. Tell Blake it covers only holds made in Venviewer until the forward book is imported. _Evidence: Verified: .github/workflows/diary-hold-reminders.yml:54-55 has the cron commented out (manual dispatch, dry run by default); product-experience.md:51 sets 7, 3 and 1 days._
10. **Correct people-matrix.md lines 19, 21 and 87 to match Blake's 10 Oct decision. Ask him one narrower question: may sales and managers place, but not ink, a provisional hold? Correct the slate's own role stories that assume they can.** The docs and the code disagree, and two slates nearly reversed a founder decision by misreading HOLD_OWNER_ROLES. _Evidence: Verified: people-matrix.md:112 records 'no; staff and admin only'; booking-mutations.ts:121 DIARY_WRITE_ROLES; HOLD_OWNER_ROLES at :134 governs ownership only (comment at :128-133)._
11. **Let an anonymous organiser send a read-only link and PDF of their plan through a separate hashed view token, never the configuration id. The shared view shows no prices and the line 'Drawn by a visitor; not reviewed by the venue'. Configurations with a live share token are exempt from the 72-hour cleanup.** Sending the plan to the boss or partner is every organiser's main job. Built as originally written, it would hand the recipient edit rights to a plan that disappears within three days. _Evidence: Verified: ShareLensPanel.tsx:183 and OpsLensPanel.tsx:229 'Sign in as venue staff'; POST /public/configurations/:configId/objects/batch needs only the id; services/cleanup.ts:18-42 hard-deletes unclaimed previews after 72 hours. ground:live-walk severity 5._
12. **Route planner and client accounts to their own projects or event instead of /dashboard. Update role-routing.test.ts, and add an authorisation test proving an invited planner cannot read another client's data.** It is trivial, and it is the only part of professional-studio worth doing now. The cost lands the day invitations start. _Evidence: Verified: role-routing.ts getDefaultRoute sends WORKSPACE_ROLES to /dashboard; role-capabilities.ts:100 includes planner, while :81 lists planner as a client role._
13. **Book an hour with the owner to enter Trades Hall's real pricing rules (HUMAN.md item 9) and decide the 'Exclusive Use' rule. Add a time window to enquiries (a migration plus a public form field) so quotes stop pricing a hard-coded 10:00-22:00 slot.** Without real rules every price surface is seeded fiction in production, and no commercial metric can be measured. _Evidence: Verified: routes/enquiries.ts:466-467; production holds no pricing rules (PR #97, ground:july-delta); no slot has held that window since migration 0089._
14. **First fix the length and width axis naming between the seed and the venue-truth module, in its own migration. Then settle the Grand Hall's short axis (10 or 10.5 m) by measuring the scan and a hallkeeper tape check, recording who measured and the tolerance. Mark the North and South Gallery dimensions 'not recorded'.** Every area-derived figure inherits this, and a width picked between two files is still unsourced. _Evidence: Verified: trades-hall-venue-truth.ts:84 lengthM 21 x widthM 10 against seed.ts:78-79 width 21 x length 10.5, with the same swap for the Saloon; galleries seeded 8 x 4 x 3 m with no source (seed.ts:83-84)._
15. **Fix the planner's first ten seconds on a phone. First, say why when an item hits its cap (one line). Then:
- auto-fill asks for the guest count first;
- 'Short 16 seats' gets a one-tap fix;
- hide 'No event linked' from anonymous visitors;
- plan lens panels as a bottom sheet, treated as one to two weeks of real UI work with focus management.** These are the first interactions on the device couples actually use, and today they feel broken. _Evidence: Verified: placement-store.ts:150 returns silently on isAtMaxCount. ground:live-walk severity 4 (64 seats placed for 80 guests) and severity 3 (lens taps do nothing on touch)._
16. **Print 'v7, issued 14:02, printed 06:02' in words on the hallkeeper sheet. Put the configuration snapshot id, version and hash in its QR, behind a no-login page that answers only 'current' or 'superseded: ask for v9'. With no signal it says 'Can't check: no signal; your copy is v7, printed 06:02'.** It is the change a hallkeeper would notice first and trust most, and paper stays the veteran's backup. _Evidence: Verified: hallkeeper-pdf-v2.ts:83 generateQr(data.webViewUrl) encodes only the live staff URL; snapshots are per configuration (schema.ts:645-664). role:event-manager asks for a printed sheet that can tell it is out of date._
17. **Add a staff 'Issue pass' sheet over the existing supplier-pack and share-token API, offered once the ops snapshot is compiled. Make expiry mandatory (event date plus 7 days, backfilling existing nulls) and add one-tap revoke. Ship the plain-language supplier page with it: no 'Handoff vN' or hash, and 'Updated 14:02 · what changed for you'. A cross-scope leak test gates the release.** The portal is built, but no supplier can reach it, so every outsider is still chased by emailed PDF. _Evidence: Verified: web/src/api/supplier-coordination.ts exports only get and acknowledge; expiresAt is nullable (schema.ts:1838) and optional in the route (:330, :430); SupplierPortalPage.tsx:59-60 and :185-186. critic:completeness calls it 'the cheapest unlock'._
18. **Put a retention rule and a privacy-notice line on the dietary free text already stored, and keep it out of logs and Sentry. Stop supplier acknowledgements being cascade-deleted when an editable pack changes.** Health-adjacent data is already held with no rule, and suppliers can lose their proof of what they were told. _Evidence: Verified: event-requirements.ts:109-116 otherAllergies is copied into retained snapshots; LegalPage.tsx:204 tells people not to send health information; no retention job touches it; supplier_acknowledgements cascade from editable packs (schema.ts:1846-1858)._
19. **Make routing honest:
- real 404s through a route allowlist in vercel.json, with a route-inventory test so /proposal-share/:token and /plan/:code keep working;
- a plain /pricing page reading 'not yet public; talk to us';
- titles that non-JS crawlers can read.
Change the staff manifest (name Venviewer, start at the role's own surface) only together with the stone-building service worker.** AI assistants and crawlers, the discovery channel the venue chose, cannot tell real pages from missing ones. _Evidence: ground:live-walk severity 3 (soft 404s with HTTP 200, including /.well-known/mcp.json; /pricing sends visitors to 'Welcome back'). Verified: site.webmanifest start_url '/'. Nineteen pages already set titles client-side (engineer lens)._
20. **Close the front-page accessibility gaps and fix client emails:
- add the skip link the accessibility statement promises;
- enlarge the 8 targets smaller than 44 px;
- make the enquiry fields full width at 375 px;
- restyle client emails in ivory and forest, and fix INK_MUTED #999 on #f5f5f0 (about 2.6:1);
- run the existing contrast audit at 7:1 on the proposal, public room and supplier routes.** A published accessibility statement the page contradicts is a misleading claim, and an email is the first thing a client receives. _Evidence: ground:live-walk severity 2. Verified: no skip link in RoomsHomePage.tsx; email-templates.tsx:51-55 (navy, blue and grey palette). goals/01 sets 44 px targets and 7:1 for client body text._
21. **Show the panorama tour's loading through the shared Activity component with a real stage label, and name viewpoints by room instead of 'Viewpoint 46 of 149'.** It breaks the project's own convention on the public tour veterans liked most, and 'Viewpoint 46' is meaningless when a screen reader speaks it. _Evidence: ground:live-walk severity 3: 4 s of black on desktop and 8 s or more on emulated mobile. AGENTS.md requires components/shared/Activity.tsx for every visible wait._
22. **Housekeeping:
- remove framer-motion and @react-spring/web;
- fold toolbar-sounds.ts, useRoomTone.ts, arrival-chime.ts and when-ribbon-tick.ts into one sound registry, with a test that rejects unregistered sounds;
- write honest training_runs.jsonl rows for T-655 and T-657 if they fit the schema, and otherwise record the mismatch.** It is last on purpose: no venue user is touched. One sound system must exist before anything adds another sound. _Evidence: Verified: both libraries are in packages/web/package.json with no import in web/src. ground:july-delta says the training-ledger refusal has expired._

## Sequence

- **Weeks 1-2**: Take down the live false claims and the defects that cost hours: fix-first items 1 to 7. These cover published capacity, verdicts built on assumed inputs including the ADB and NFPA citations, invented prices, the MCP 'free' token, staff pricing writes, front-page copy within the splat hold, and the competitor table. _Proves it when:_ A CI banned-verdict test fails on any within, fits, pass or valid shown for a structural, electrical, egress or occupancy question. No public surface shows 339, 'Within WLL', £5,044 or a bare 'free'. A staff-role pricing POST returns 403 in a route test and in a read-only probe against production.
- **Weeks 1-2**: One 90-minute decision meeting between Blake and the Trades Hall office, using the founder decisions below. It answers A1, A2, A3, A5, A6 and A8, the MCP default, whether sales may place holds, and who changes prices. It also names the first real event and books Elaine plus a working hallkeeper for it. _Proves it when:_ The answers and the named event date are recorded in docs/sessions/2026-10-xx.md and docs/operations/people-matrix.md, and the A5 sample export is requested from the venue.
- **Weeks 1-2**: Measure before building. Shadow one real Saturday with no software. Start a two-week tally of inbound calls on event mornings (06:00-10:00) and a four-week enquiry log by channel. Collect the venue's paper into D:/claude/venue-facts: one BEO or function sheet, terms, the lock-up list, the key ledger, the alarm panel zone list with 12 months of isolation history, and the last 12 months' disputed invoices. _Proves it when:_ Baseline numbers exist for morning calls, first-reply time, enquiries by channel, list rekeying minutes, changes after the lock and dispute causes, and the venue-facts folder holds the named documents.
- **Weeks 1-2 (started), landing by week 4**: Start event-spine Phase A. In parallel, ship the cheap built-or-decided items: the promoted-owner notice in the same transaction, hold reminders on after Blake's dry run, the version line and status-only QR on the sheet, and the doors 'Issue pass' screen with mandatory expiry and the plain supplier page. _Proves it when:_ The notification log shows every resequence producing an owner notice. The reminder cron runs, with clients never emailed. A stale printed sheet scanned after a change says 'superseded'. The cross-scope leak test passes as a release gate.
- **Days 15-90**: The bind lands: the foreign key changes to RESTRICT, a backfill runs with a review list, the conditional CHECK and the CI invariant go in, and 'start plan' is removed. Then July's proving moment runs on a seeded multi-room wedding (Saloon ceremony, Grand Hall dinner). After that comes the first real Trades Hall event, carried end to end by Elaine and a working hallkeeper. _Proves it when:_ A read-only SQL invariant shows zero holds or inks without an event, in CI and once in production. Releasing a competing ladder hold leaves no live draft event in ops views. On the real event, the load-in time set on the Board prints as the same Glasgow time on the hallkeeper's sheet, recorded by Elaine and the hallkeeper, not by us.
- **Days 15-90**: Lay the platform foundations several items silently assume:
- An Article 28 processor agreement between the Trades House and Venviewer, a record of processing, the DPIA programme and an updated sub-processor list.
- A durable job runner (single-fire, idempotent).
- One party-and-grant model, designed once.
- A verified sending domain and a delivery webhook shared by doors, the-yes and first-answer. _Proves it when:_ The processor agreement is signed by both parties. A job fires exactly once with two API instances running in a test. Delivery events from the email provider appear against a real sent message.
- **Days 15-90**: Run first slices on real Trades Hall work:
- switching-day phases 0-1: pricing editor, ICS feed, full CSV/JSON export, then a dry-run import of the A5 sample through the bind.
- the-yes seal on the venue's own confirm rule, with a manual deposit tick and export.
- first-answer slice 1.
- house-book: the axis-naming migration, typed geometry, a tape check, and the Clerk's first 10 rule cards on a public page.
- doors stage 1 on one real dinner.
- fair-diary typed works windows.
- close-the-night room passport and show report on two real nights.
- stone-building: a two-phone signal walk and a cold-start spike. _Proves it when:_ Finance signs one reconciled month with zero unexplained differences against the old system and the bank. At least three of five suppliers acknowledge their pass unaided before arrival. Hallkeeper morning calls are compared with the baseline. The duty manager signs off the night in two minutes or less. The hallkeeper's tape check of 10 scan facts falls within the stated tolerance.
- **Following two quarters (about January to June 2027)**: Cutover. Trades Hall's forward book is imported, reconciled to the penny and signed by finance. The old diary is read-only for one week, the tested export is the rollback, and a named person owns the go/no-go decision. _Proves it when:_ The share of Trades Hall's next-12-months confirmed bookings by value whose system of record is Venviewer moves from about zero to most of the book. At the week-four check-in the sales lead says the old diary was not opened.
- **Following two quarters**: Money and answers:
- Payments into the venue's own account, if A1-A3 say so, with VAT codes and an idempotent push to the venue's accounting system.
- first-answer slices 2-3: sending from the product, one named cover, and a private clock.
- Public date status only for rooms with a dated reconciliation record. _Proves it when:_ The median days from acceptance to deposit, taken from bank statements, improve against last season. Enquiry-to-confirmed conversion by channel improves against the four-week baseline, cross-checked by an independent mystery shop. No public 'nothing on our diary' answer is later contradicted by an unentered booking.
- **Following two quarters**: The day of the event and continuity:
- doors stage 2: officiants, casuals through the agency's link, drivers.
- living-record: an event-level issue, and a kitchen page built with one caterer once she has acknowledged two of three events.
- stone-building: offline shell, one outbox and quiet windows driven by live cues.
- safe-night: night log and alarm permit before Martyn's Law commencement, if the panel history shows isolations.
- nobody-starts-from-zero: promise lines, handover, cover, and 'same again' timed to the societies' rebooking.
- people-not-counts slice 1, after a signed DPIA.
- prompt-book: the paper prompt book and flip strip. _Proves it when:_ Each item's own measure is met:
- Stale-sheet entries in the night log fall.
- Zero lock-ups close with a zone still isolated and no recorded reason, checked against the panel's own history.
- The covering coordinator's timed five-question test is faster from the handover page than from the inbox.
- Annual events rebook within a month of last year's.
- Wrong plates and at-table 'who is the...?' questions fall at observed dinners.
- Generated flip minutes fall within about 25 percent of observed flips.
- **End of the two quarters (gate, not a date)**: Decide on venue two only after Trades Hall's signed cutover and one season of measures. Hold it to July's test: the onboarding pull request contains zero .tsx files, and operator hours, capture cost and capture-to-live days are published internally. _Proves it when:_ Trades Hall's leadership would act as a reference, and the onboarding diff and its four numbers exist.

## Decisions only Blake can make

### What confirms a Trades Hall booking, and whether payments are in scope (A1, A2, A3)

- Signed agreement plus deposit received confirms the booking. The seal ships first with a manual deposit tick, and payments into the venue's own account follow.
- A signature alone confirms the booking, and the deposit is chased afterwards.
- Keep confirming outside Venviewer for now.

Recommendation: Signed agreement plus deposit received, as a venue setting, with the venue as merchant of record and the seal shipped without a payment processor first. Inking on a signature alone releases the 2nd option against money that may never arrive. This is how the trade confirms, and the setting can flip later if Trades Hall works differently.

### Where the forward book and CRM live after switching day (A5)

- Import the forward book into Venviewer and retire the diary function of Salesforce and the other tools, keeping Salesforce read-only for history for one season.
- Keep Salesforce as the CRM and sync bookings into Venviewer.
- Keep running two diaries.

Recommendation: Import and retire the diary function, decided after a 60-minute 'show me your diary' session with the sales lead and a dry run on the A5 sample export. Two diaries is the failure the product exists to remove, and a sync makes Phase 3 a different and costlier integration project. The session shows which system the sales lead actually trusts.

### Public date status on the live MCP and website (A8; T-649 shipped 'held, enquire' by your choice)

- Rename 'free' now and hide date status by default, per room, until the venue records a dated reconciliation of that room's forward book.
- Keep free, held and busy as shipped, with the token renamed.
- Remove date status from public surfaces altogether.

Recommendation: Rename now and hide by default per room until reconciled. The default answer is 'Tell us your date: [owner] replies by [time]'. Today AI assistants are told a room is 'free' up to two years out, from a Diary that does not hold the venue's book. That is the double-booking deal-breaker sales names.

### Whether sales and managers may place provisional holds (your 10 Oct decision removed all Diary writes from them)

- Keep staff and admin only, and add a one-tap request queue so an owner's confirm, release or extend goes to the office.
- Let sales and managers place a provisional hold but never ink one.
- Restore full write rights.

Recommendation: Keep your rule and add the office queue now. Allow place-but-not-ink if the sales lead's real hold walk-through shows the office re-keying holds that sales took, or if office requests regularly wait over half a working day. It respects a recorded decision while measuring its cost. The forward book is honest only if every pencil reaches the Diary quickly.

### Who may change prices (people-matrix.md:89)

- Admin and the venue manager, with an audit line, and staff never.
- Admin only.

Recommendation: Admin and the venue manager with an audit line. Today any staff account can rewrite prices through the API. A small venue needs its manager to set rates, and nobody else should.

### Sending domain and the reply promise (A4, A6)

- Send from the venue's verified domain in the seller's name, promising a reply 'by 13:00 next working day', shown only when a named cover is set.
- Keep replying from staff mailboxes and make no promise.

Recommendation: The venue's verified domain, the seller's name, and a promise only with a named cover. Weekend enquiries say 'by Monday 13:00'. A promise without cover is the slate's own named risk, and slices 2-3 of first-answer and the-yes codes all wait on a working sending domain.

### Switching AI drafting on in production

- Keep it off until the processor is named in the privacy notice, untrusted inbound text is isolated, and AI is barred from stating availability, price or capacity, then allow drafts only.
- Switch drafts on now.

Recommendation: Keep it off until those three guardrails exist. LegalPage.tsx names no AI processor today, and one invented figure in a reply to a couple undoes the trust argument.

### Killing professional-studio until a second venue exists, and adding no agent role

- Kill the programme. Keep planner routing and a read-only share link in fix-first, move the to-scale drawing into house-book exports, and put one disclosed commission term on the-yes agreement.
- Build the single-venue planner studio now.
- Build the cross-venue studio and agent desk.

Recommendation: Kill the programme and keep the three small parts. Production has one venue, the planner and agent channel at Trades Hall is unmeasured, and four of the seven lenses independently say kill.

### Wording for the front page while your splat hold stands

- Keep the hold, replace 'Work in progress' with calm copy naming the rooms, and lead with the panorama tour and real photographs.
- Lift the hold.

Recommendation: Keep the hold and approve the new copy. The hold is a rights decision (T-628). The front door should stop apologising without claiming what is held.

### What Trades Hall commits to, and who pays Venviewer

- A written founding-venue agreement: Trades Hall makes Venviewer its system of record by a named date, a named staff member owns it with agreed hours, and price is set after the cutover is measured.
- Set a subscription price now from the draft £47.99 a month.
- Take a platform fee on client payments.

Recommendation: The written founding-venue agreement, with price deferred and no fee on client payments until legal and commercial advice. No evidence shows Trades Hall has committed to switching or named an owner, and every adoption metric depends on it. The draft price has never been tested against delivery cost.

### Exit and continuity promise

- A full export on any day, plus a solicitor-reviewed continuity statement now, and escrow only when a second venue asks.
- Buy software escrow now.

Recommendation: Export plus a solicitor-reviewed continuity statement now. 'What happens to my bookings and money if you go under?' is a veteran's first question. An export answers most of it at almost no cost.

## July 2026 refusals, as they should stand now

- **Any determination about egress, occupancy, fire or licensing**: Holds, and widens. No screen says within, fits, pass, valid or green for structural, electrical, egress or occupancy questions, and every such chip already shipped is removed. Published figures are labelled 'published guide' and are never 'the room's capacity'. Capacity authority runs from the fire risk assessment maximum, to the licence figure, to the published guide. No England or US code is cited for a Scottish building. Software warns and records, and never blocks the person at the alarm panel or replaces the radio and 999. The live product already crossed this line ('Within WLL' on an invented 500 kg; ADB and NFPA citations). A delighted hallkeeper who is wrongly told he is safe is the worst outcome on the slate.
- **AI that answers enquiries on its own**: Holds. AI stays off in production until the privacy notice names the processor, untrusted inbound text is isolated from instructions, and AI is barred from stating availability, price, capacity or safety unless the figure is pulled from the record. It is drafts only, and a person reads and sends. A named person replying fast is the delight. One wrong figure or promotional line in a bot reply costs more trust than it converts.
- **The word 'available'**: Holds, and covers 'free' too. The public MCP's bare 'free' is renamed to a self-caveating state now. Date status goes public only for rooms with a dated, expiring reconciliation of the forward book, and members' and Craft dates show only as 'held'. The Diary does not yet hold the venue's book (product-experience.md:35), so 'free' is the same false OK July refused.
- **Counter-marketing on accuracy**: Holds, and widens to every claim about competitors. The unsourced competitor price table is deleted. No 'beats incumbents' line reaches sales copy until it has been checked hands-on, because the evidence already corrects several such claims (Cvent Diagramming has diets against seats and a view-only link; Tripleseat has collaborative floor plans). A confident, true product is the proof, and claims about rivals are a liability.
- **Generative staging and neural restyling**: Holds, with the boundary restated. Learned appearance is acceptable only when it is scored against held-out photographs of the real room. Generating anything that was not photographed is not. The reconstruction lane now trains learned floor skins and reflection layers (ground:july-delta), so the line needs to be precise.
- **A public trust page publishing our own accuracy**: Holds. Keep a private accuracy record for the venue. A public figure is a permanent adversarial screenshot before two years of accurate numbers exist.
- **A row in training_runs.jsonl**: Expired. Write honest rows for the real RunPod runs (T-655, T-657) if they fit the schema, and otherwise record the mismatch. Real runs now exist, so an empty ledger is the untruthful state.
- **Reverse-engineering the capture container or encrypted calibration**: Superseded by Blake's 28 Sep permission (GOAL.md). Record the authority and the provenance. Separately, whether XGRIDS terms allow scan-measured facts to be published stays open, so published facts cite the measurement, not the scan asset. The founder has decided. The rights question that remains concerns publishing, not decoding.
- **Multiplayer, CRDTs, presence cursors, soft locks**: Partly superseded. Record-level presence and collision prevention are justified now that several roles, a wall display and live conversations exist. CRDTs and live cursors in the planner remain refused. The second concurrent user now exists for records, but still not for drawing.
- **Frosted glass and a third motion library**: Holds. Finish the cleanup July asked for: remove the two unused motion libraries and keep one sound registry. Half of July's instruction is still undone.
- **Holding money**: Holds. The venue is merchant of record on the provider's direct model, and Venviewer never holds funds or handles refunds. It also refuses to run a rival ledger: invoices and reconciliation stay in the venue's accounting system unless the accountant says otherwise in writing. The refusal is not an excuse for no payments. A veteran cannot switch without deposits and a sealed agreement, and two invoice series for one booking satisfy nobody.
- **A fifth homepage**: Holds. No new front door until an enquiry-to-booking number exists, which first-answer's four-week log will produce. The denominator still does not exist.
- **New Foundry contract families until an asset crosses the existing ones**: Not holding in practice, so it is restated as a budget. No new reconstruction contract families and no uncapped runs. Name the single asset that must cross the ledger next. Product work on the event record takes priority until the first real Saturday has run. Reconstruction has absorbed a large share of recent effort while July's 'one thing' did not ship (ground:july-delta).
- **Volume plays on someone else's turf (registration, marketplace, RSVP and wedding-site builders, supplier directory, in-app radio, multi-venue)**: Holds firmly, and now kills the professional-studio programme until venue two. people-not-counts stays inside the bar as import plus each guest's own needs, with no invitations or wedding site. Urgent calls stay on phone and radio, and the app records them. Blake's 4 Sep override for in-app messaging stands. With one venue there is no network to win, and the incumbents' moats are exactly these plays.
- **The backlog itself (cut to thirty rows)**: Failed, and renewed. Cut docs/state/tasks.md to the rows this sequence needs and park the rest explicitly. The ledger grew from 527 to 583 rows and no one can tell what is true. That is a delight problem for the people building the product.

## Killed by the red team

- **The Planner's Room as a programme (cross-venue studio, firm client lists, agent desk, masked availability, white-label committee proposal, commission ledger)**: Four of the seven lenses say kill. Production has one venue, so there is no network for a planner or agent to move into. CSN, Aisle Planner and HoneyBook own that ground (ground__competitors-enterprise, ground__competitors-smb-uk), and nobody has measured the planner and agent channel at Trades Hall (role:marketing sev 9). The useful part moves elsewhere. Planner routing and a read-only share token that survives the 72-hour cleanup go to fix-first items 11 and 12. The to-scale Truth Pack drawing becomes a house-book export. One disclosed commission term goes on the-yes agreement. Revisit only when there are several venues in one region or three agents' written letters of intent.
- **Value beside a hold, displacement figures and the trustee 'purpose weight'**: No real event has run through the product (ground:july-delta), so every figure would come from the rate card, which collides with role:leadership's deal-breaker about numbers that do not tie to the accounts. Reconsider only after a season of recorded outcomes and a back-test, and then for leadership only.
- **The six-earcon house voice, custom haptic patterns, room-tone sounds and IEC 60601-1-8 alarm tiers**: The web cannot deliver them: iPhone web has no vibration, and a locked PWA cannot play its own sound. They conflict with goal 19's three-event push rule, and naming IEC 60601-1-8 invites a conformance claim. Floor devices stay silent, and the existing opt-in office chime is the only sound until a Saturday shadow and a device matrix show anything more is wanted and deliverable.
- **The rehearsal sandbox, the private staff logbook and W-BNS questionnaires as a product metric**: There is no event history to rehearse from. Copying real guest and allergen data into a sandbox is a privacy problem, nobody in the evidence asked for a logbook (which carries employment-law exposure), and a psychology scale is not a product metric. New starters walk the real rooms with a colleague and the house notes instead.
- **The Light Book, acoustic cards, a third-party listing drift checker and a capture-rights CI gate inside the House Book**: These are separate projects with no buyer within twelve months, and they would turn a capped fact list into a records office that a three-person team cannot maintain. A single computed sunset line on the prompt book covers the near-term need.
- **Software stating a 'fair' cancellation figure graded against CMA guidance, and a Venviewer-owned invoice series by default**: What the venue may keep on cancellation is a legal judgement for a named person, and the CMA can now fine directly. A second invoice series beside the accountant's package satisfies neither of finance's deal-breakers. The cancellation desk shows the clause, the facts and the arithmetic, and the venue's accounting system keeps the numbering unless the accountant says otherwise in writing.
- **Finger signatures from the host at midnight, AI captions of photos with people in them, review solicitation and the trustee Board Page inside close-out**: A squiggle from a guest at 00:40 binds nobody who is liable, and AI captioning of identifiable people adds processing nobody asked for. Review invitations belong under the relationship-owner rule in nobody-starts-from-zero. The Board Page needs paid-money truth from the-yes first.
- **Door-tap 'live headcount', a hard block on lock-up, a preset dry-hire responsible person, PVG prompts and an app-based lone-worker alarm**: A headcount can be mistaken for an evacuation roll call. A hard block makes a lone hallkeeper fake a tick at 01:40. Para 6.5 of the Martyn's Law guidance forbids presetting who controls the premises. PVG applies only to regulated roles, and a web app must never be the safety channel. Warnings and recorded overrides replace blocks, and urgent calls stay on phone and radio.
- **Seat auto-solver, medication timing, cross-contact tolerance fields, hosts declaring other people's health data as consent, and an 'Arranged' or 'safe' status**: Each one fails data minimisation, asks the venue to take a medical view, or gives an assurance the venue cannot make about an outside kitchen. The guest sees 'Received', then 'Confirmed by [caterer]', and nothing else.
- **Per-platform listing-site email parsers, published catering price ranges and the claim to 'answer inside the CSN thread'**: No inbound mail infrastructure exists. Parsers need a terms review per platform, and no baseline shows listing sites are a material share. Catering is quoted by named outside caterers, and the CSN claim is contradicted by the venue's own competitor evidence. Log any enquiry by hand first.
- **Per-person standby-and-go cues, personal-phone haptics at the pass and any screen that issues a fire time**: It puts a new device into the worst minute of the night, it depends on outside people adopting a link mid-service, and it cannot vibrate an iPhone. A stale screen overruling the room is the failure three critics raised independently.
- **Bulk 'what moves' postponement, an eight-role permission grid and the marriage-schedule trail inside the spine**: Moves are negotiated one event at a time, with refund or new date offered by default. Permissions reach people as presets written in sentences. The ceremony trail belongs in a ceremony slice attested by people.
- **A venue-editable permission matrix replacing roles in code, and two-way Outlook or Google editing of holds**: An editable matrix is a rewrite and a safety trap (medical notes to casuals, money to hallkeepers). Two-way editing would make Outlook a second diary. Keep a read-only ICS feed with one-tap deep links, and reconsider only if staff still edit in Outlook after the feed is measured.

## How it should look, feel and sound

- Truth is the luxury. Every figure carries who stated it and when, one tap away. Nothing shows a green tick for something a named person did not check, and a gap appears as a person to ask ('Ask the hallkeeper'), never a grey void.
- The best upgrade removes a step. 'Start plan' disappears, nobody re-keys, an outsider installs nothing and makes no account, and a held date is already an event.
- One job, one page. Each role opens on its own work with sensible defaults set by job, and 'show all' is one tap away. Nothing is added to the hallkeeper's screen unless he can still read it in one second (the goals/01 test), and each role has a daily budget of interruptions.
- Paper is first-class. Every operational page prints to A4, states its version in words ('v7, printed 06:02'), survives a mono laser printer, and a superseded printout can say so.
- Speak the trade's language. Use 1st option, Confirmed, Your Saturday at Trades Hall. System words such as hash, snapshot or handoff vN never appear, and officiants are never called suppliers. Keep one glossary so the slate's many metaphors do not become a vocabulary test.
- Colour never carries meaning alone. Stay in the ivory, forest, copper and sage register with audited tokens: 4.5:1 contrast generally and 7:1 for client body text. Copper is for display sizes only. Add one ivory-safe caution token distinct from amber's 'Guests due', and 'ISOLATED' never borrows oxblood LIVE.
- Silence is the default. Sound comes only from one registry, and no device behaviour is promised that the web cannot deliver: no iPhone vibration, no custom alert with the screen off. Life-safety calls stay on the radio and the phone.
- Every 'no' comes with a way forward: the nearest Saturdays, the Saloon, the Friday, or a named person and a reply time.
- A person sends, and a person decides. Nothing leaves in the venue's name without someone reading the exact words. Money, cancellation, safety and withdrawal decisions carry a named human, and nothing releases or confirms itself.
- Pride comes from authorship. Names go on the work ('Signed off, Grand Hall, 01:42 — Moira'), makers are credited on the show report, a list can say 'nothing else is owed today', and nobody is ever ranked.
- It works where people stand. Targets are at least 44 px, everything works one-handed and in gloves, honest 'saved here, will send when signal returns' states cover the cellar, and every drag has a list-and-keyboard alternative.
- Waiting is honest and calm. Every visible wait uses the shared Activity component with real progress, motion uses springs, reduced motion is respected, and nothing flashes.
- Design one moment of felt scale. Burke's sublime (product-experience.md) needs a secure first look at the Grand Hall at true scale. While the splat hold stands, that comes from the panorama tour and real photography, never from overclaiming.

## Validation plan

This runs at Trades Hall under a written research protocol: notice to staff and guests, no filming of guests without consent, and a deletion date. A shadowing researcher who is neither Blake nor an agent does the counting with a stopwatch and tally sheets. Blake judges aesthetics, and the people named below judge everything else.

1. One real Saturday before building (weeks 1-2), with no software in hand. Shadow a wedding or society dinner from the 06:00 opening to lock-up. Record:
- The hallkeeper's and duty manager's inbound calls from 06:00 to 10:00, by caller and reason.
- Every 'which door, what time' question.
- Changes after the numbers lock, and how each one travelled (paper, WhatsApp, a walk).
- The minutes from speeches overrunning to the kitchen knowing.
- Every server asking a table 'who is the...?', and any wrong or near-wrong plate.
- Minutes spent rekeying the guest list.
- Whether any phone sounded during the vows.
- Who actually acts as caller.
- Signal bars and a timed page load on one iPhone and one Android in each room, the stairwells, the cellar store and the lane.
Collect the paper behind the night: function sheet or BEO, terms, the lock-up list, the key ledger, the alarm panel zone list and 12 months of isolation history.

2. Four weeks of baselines.
- The sales team logs every enquiry: channel, first reply time, show-round, outcome.
- The sales lead and the Trades House secretary reconcile 30 forward 2027 dates, weighted to Saturdays, against every system the book lives in.
- Finance walks the last 10 confirmed bookings from acceptance to deposit against bank statements, and classifies the last 12 months of disputes by cause.

3. Signed-in journeys on real phones. Each person uses their own device and is observed, not helped. Each journey is timed and asked one ease question.
- The sales lead logs a phone enquiry (target 15 seconds) and prepares a hold.
- Elaine places two holds for a multi-room wedding, answers 'Same event or new?', inks it, and opens the event with no 'start plan'.
- The hallkeeper opens today's Day Board in the cellar in airplane mode, prints the sheet, and scans a stale printout, which must say 'superseded'.
- Five regular suppliers (florist, outside caterer, piper or band, AV firm, van driver) open their pass from SMS, WhatsApp or Gmail in the app they normally use, find the door and time, and tap 'I've read it'.
- A couple and a parent over 65 open a shared plan and sign a sealed demo agreement with a one-time code.
- The duty manager signs off the show report at close.
- Finance ticks a deposit and reconciles one month.

4. The first real event end to end (within 90 days), with Elaine, a working hallkeeper and a consenting client.

Named measures, with the decision each one drives:
- Holds or inks without an event: zero.
- Load-in set on the Board equals the printed Glasgow time, recorded by Elaine and the hallkeeper. Any mismatch blocks release.
- Morning calls against the baseline. If 'which door' calls are a small share, cut doors stage 2.
- Suppliers acknowledging unaided before arrival. Fewer than 3 of 5 means rework the pass before stage 2.
- Duty manager sign-off of two minutes or less. If he would not sign at 00:40, the report is wrong.
- Older payers signing first time. If more than 1 in 5 fails, add staff-assisted phone signing.
- Reconciliation mismatches. Any mismatch keeps that room's public status hidden.
- Enquiry-to-confirmed conversion by channel against the baseline, cross-checked by an independent mystery shop of first reply.
- Hallkeeper tape check of 10 scan facts within the stated tolerance. More than 2 outside means scan facts stay off client surfaces.
- Overrun-to-kitchen minutes. If under about two minutes with no plates lost across two Saturdays, shelve the live prompt-book layer.
- Panel history showing few or no isolations means the permit is killed and the night log ships alone.

5. Independent judges outside the team:
- The venue's fire risk assessor confirms capacity authority and reviews the permit records.
- The external accountant closes one month on the pushed records.
- A Scottish solicitor approves signing grades, terms and move wording.
- A DPO signs the DPIA before any guest health data exists.

6. Pride and delight, measured rather than asserted. After each journey, ask a per-task ease rating and record, as observed rather than asked, whether the person shows the screen to a colleague. Do this with the newest staff member and with two digital-native couples as well as the veterans.

## What this does not prove

- Nobody at Trades Hall was consulted. All 63 personas across the 21 role clusters are illustrative composites (critic:completeness). The pains are plausible, not measured.
- No real event has run through the product, so every 'before and after' still lacks its 'before'.
- Competitor comparisons come from public documents and reviews, not hands-on trials. Several slate claims were already wrong on inspection, and every 'beats Cvent or Salesforce' line is untested.
- No signal, device or notification behaviour was measured inside the building, and no real phone, screen reader or slow network was used.
- Revenue effects, willingness to pay and Venviewer's own business model are unknown. The evidence holds no Trades Hall figures for conversion, disputes, hold decay or channel share.
- The legal points (Scots law on signing, consumer rights, UK GDPR bases, VAT, Martyn's Law tiering) are informed critique, not advice. A solicitor, DPO, accountant and fire engineer must rule.
- Engineering estimates such as 'two to three weeks for the bind' are inferences, not measurements.
- Code facts were read at origin/master 9cbe15c1 on 16 Oct 2026. Live production state was not checked: environment variables such as RESEND_API_KEY, deploys, and the number of real holds and inks in the database.
- Physical facts remain open: the Grand Hall's true short axis, the fire risk assessment maxima, whether Trades Hall isolates alarm zones, and who sells the bar.
- It does not show that Trades Hall will commit to Venviewer as its system of record or name an owner for it.
- Delight and pride have not been measured anywhere. The design principles are hypotheses until the ease and show-a-colleague measures exist.
- This ranking is a judgement over agent critiques. Agents agreeing with each other is not proof, and the first real Saturday is the first independent test of any of it.

## Method

- Phase one (workflow `wf_eda63685-0c9`, 28 agents, Sonnet high): two production code maps, a delta against the July vision, a live walk of venviewer.com (couple on a phone, corporate EA, production manager; no forms submitted; visiting /plan autosaves an anonymous draft layout, as for any visitor), enterprise and SMB/UK competitor teardowns, 21 role clusters with 3 veteran personas each, and a completeness critic.
- Phase two (workflow `wf_e6940aec-e1f`, 27 agents, Opus): altitude, depth and range syntheses; one merged slate of 15; seven hostile lenses (venue veterans, client/supplier veterans, incumbent strategist, principal engineer reading the code, adoption economist, design/accessibility/sound, UK law/licensing/AI ethics); one judge per proposal; a final ranking.
- Agent agreement is not proof. The first real Trades Hall Saturday is the first independent test.
