# Hallkeeper image prompts — 7 September 2026

These are copy-ready prompts for Blake to use in ChatGPT ImageGen. No images have been generated for this pack. They describe a proposed product, not shipped functionality or accepted venue procedures.

Attach [the original supplied reference](style-reference.png) to the image conversation. Its role is visual direction: the airy ivory booking diary, warm heritage photography, sage/apricot/honey cards and calm spacing. It is not a source of operational facts about Trades Hall or another venue. The source image is preserved unchanged.

## How to generate the set

1. Paste the **master direction** followed by **Prompt 1**. Generate one screen.
2. Choose the Day sheet whose hierarchy and style you prefer. For each subsequent screen, attach both the original reference and that chosen Day sheet; paste the master direction and the relevant numbered prompt.
3. Generate in this order: **1 Day sheet → 2 Room setup → 3 Change request → 4 Phone → 6 Handover → 5 Deliveries → 7 Print → 8 Venue memory**. This tests the core workflow and difficult states before secondary detail.
4. Generate one screen per image, except the deliberately paired phone views in Prompt 4. Do not ask the model to squeeze the whole product into a collage.
5. Review wording and numbers after each generation. Fix unreadable or invented labels before using the result as a design reference. The image is a visual proposal; working interfaces must render real text, state and controls in code.

Suggested filenames: `01-day-sheet.png`, `02-room-setup.png`, `03-change-request.png`, `04-phone-offline.png`, `05-deliveries.png`, `06-handover.png`, `07-print-a4.png`, `08-venue-memory.png`.

## Shared fictional scenario

Every person, event, stock figure, schedule, status and work record below is illustrative. Keep the demo consistent across images:

| Field | Fictional value |
| --- | --- |
| Venue | Hillside House, matching the reference name |
| Demo clock | Thursday 15 May 2025, 14:10 |
| Main event | Heritage Trust Dinner |
| Room | Grand Hall |
| Current working brief | v7; 120 guests; doors 18:00; room ready by 17:15 |
| Current furniture requirement | 20 tables of 6; 120 chairs |
| Pending request | CR-014: 120 → 132 guests; 20 → 22 tables of 6; 120 → 132 chairs |
| Request state | Pending decision; the current brief remains 120 guests |
| Proposed additions | 2 tables and 12 chairs; availability, layout and staffing consequences require review |
| Illustrative staff | Nora, hallkeeper; Maya, break cover; Ellis, duty manager and change-decision owner |
| Break cover | Maya, 15:00–15:20, limited to routine hallkeeper duties; awaiting acceptance |
| Cover ownership | Nora remains owner until Maya accepts; accepted cover starts at 15:00. Escalate to Ellis if unaccepted by 14:55 |
| Return from break | At 15:20, Nora and Maya cross-check open items and record the return of routine duties to Nora |
| Furniture collection | Nora, 15:30, after break cover ends |

These counts describe a fictional request, **not approved room capacity, available stock, verified clearance or emergency arrangements**. Do not turn a generated room picture into a measured plan. Keep generated imagery, product design approval and operational verification as separate records.

## Master direction

Paste this with each screen prompt:

```text
Create a polished, believable interface design for the HILLSIDE HOUSE Hallkeeper workspace. Use the attached booking diary as the visual reference and retain its airy ivory composition. This screen should feel like the same product, created by the same designer, for the person physically running the venue.

The mood is quiet competence, warmth and relief: light cream surfaces, warm brown-black text, muted sage, pale apricot and honey accents, hairline warm-grey dividers, softly rounded corners and very restrained shadows. Keep the main navigation light ivory. Use heritage room photography only where it helps somebody recognise a place. Retain the architectural presence and inviting daylight of the reference while giving operational information clear priority. Avoid a dark forest sidebar, black-and-gold dashboard, oversized branding, decorative charts or a huge AI chat panel.

Make the result usable by a tired experienced hallkeeper at a glance. Large crisp human-readable typography; clear hierarchy; comfortable line spacing; generous clickable controls; short concrete labels; status expressed in words and symbols as well as colour. Do not fill spare space with extra features, tiny text or invented metrics. A pending request must look different from the current working brief. Critical unresolved work must remain visible; a green percentage must not conceal it.

Desktop screens: straight-on flat product screenshot, landscape approximately 16:10, high resolution, with the full interface visible and no laptop mockup. A subtle cream background outside the app is acceptable. Phone and print dimensions are specified in their individual prompts. Make exact requested labels legible, reducing secondary content if necessary.

All content is a FICTIONAL DEMO. Show a discreet but readable “Fictional demo · Visual concept” label. Venue: Hillside House. Demo date and clock: Thursday 15 May 2025, 14:10. Main event: Heritage Trust Dinner, Grand Hall. Current brief v7: 120 guests, 20 tables of 6, 120 chairs, ready by 17:15, doors 18:00. CR-014 requests 132 guests, 22 tables of 6 and 132 chairs; it is PENDING. Keep current requirements unchanged. Do not invent approved capacities, measured escape routes, safety certification, stock availability, delivered messages or completed checks. Never say “100% safe”, “AI approved” or “all risks solved”. Use the supplied fictional people only if needed: Nora, hallkeeper; Maya, break cover; Ellis, duty manager and change-decision owner.

Maya's proposed break cover is 15:00–15:20, limited to routine hallkeeper duties and currently awaiting acceptance. Nora remains owner until Maya accepts; accepted cover starts at 15:00. Escalate to Ellis if unaccepted by 14:55. At 15:20 Nora and Maya cross-check open items and record the return of routine duties to Nora. Nora collects furniture at 15:30 and carries out the physical room check at 17:15. Keep this a brief, explicitly scoped cover arrangement, not an indefinite shift transfer or a transfer of Ellis's decision authority.

Show the specific moment requested below. The screen should demonstrate one coherent job, with realistic unresolved states and a clear next action.
```

## 1. Primary Day sheet

```text
Design the primary HALLKEEPER DAY SHEET: the calm screen Nora opens to understand today and choose her next action. Use the attached reference's horizontal room-and-time structure, generous margins and light visual language.

Top bar: the small Hillside House identity, “Hallkeeper”, a modest search field “Find a room, task or contact”, Thursday 15 May 2025, 14:10, and compact “Print” and “Handover” controls.

Below the title, show three concise useful lines: “Next · Confirm catering arrival · 14:30”, “Grand Hall · Ready by 17:15”, and “Break cover · Maya · 15:00–15:20 · Awaiting acceptance”. Avoid a row of metric tiles.

Left rail: small recognisable heritage room photographs and room names Grand Hall, Saloon and Reception Room. Grand Hall is selected. The central area is a readable afternoon timeline from 14:00 to 19:00 with a fine 14:10 NOW marker. Grand Hall has labelled phases “Setup”, “Room check · 17:15” and “Doors · 18:00”. The Heritage Trust Dinner card clearly says “120 guests · Brief v7”. Small secondary room rows can show a fictional Board Meeting and Reception preparation without competing for attention.

An ivory right rail headed “Needs attention” contains only two clear cards. First: “12 more guests requested”, “120 → 132”, “Current brief unchanged”, “Ellis · Decision needed by 15:00”, button “Review change”. Second: “Break cover not accepted”, “Maya · 15:00–15:20 · Routine duties”, “Escalate to Ellis if unaccepted by 14:55”, button “View handover”. Beneath them a quieter reminder says “AV test · Still to do · 16:45”. Use sage for planned work, amber for pending decisions and restrained red only for genuine blocking conditions; do not decorate everything as urgent.

Under the selected event, show a short “Next in Grand Hall” list with three rows, owner and time: “Collect furniture · Nora · 15:30”, “AV test · AV lead · 16:45”, “Physical room check · Nora · 17:15”. These are planned tasks, not completed work. Footer: “Current brief v7 · Fictional demo · Visual concept”. The composition should feel like an elegant operational diary, immediately understandable without opening a drawer.
```

## 2. Room setup and equipment collection

```text
Design one focused ROOM SETUP screen for Grand Hall, Heritage Trust Dinner. Keep the same ivory shell and selected-room photograph from the Day sheet. Heading: “Set Grand Hall for tonight”; beneath it “120 guests · Brief v7 · Ready by 17:15 · Doors 18:00”. A small amber strip says “Request for 132 guests pending — prepare the current brief”.

Use a spacious two-column composition. Left: a large simple illustrative top-down arrangement of round tables, labelled “Layout reference v7” and “Illustrative arrangement · Not to scale · Clearance review required”. The diagram may suggest the arrangement but must not invent dimensions, emergency paths or a capacity certificate. Put a small warm room photograph above or beside it for recognition. Clearly written quantities, rather than tiny repeated symbols, carry the requirement: “20 tables of 6” and “120 chairs”.

Right: a practical collection list headed “What to bring”, with “Nora · Collect at 15:30” beneath it. Show “Tables · 20 required · Collection point to confirm”, “Chairs · 120 required · Collection point to confirm” and “Trolley · Availability to confirm”. Each row has room for an owner and a clearly incomplete checkbox. Do not pretend stock has already been found or reserved.

Below, a short sequence headed “Before the room is released”: “Furniture positioned”, “AV test”, “Physical room check”. Use “Planned”, “Still to do” and “Not checked” states. Provide a clear “Record progress” button and a secondary “Report a problem” button. Add one compact relevant reference link “Room care instructions · View reviewed guidance”, without inventing its technical content.

The page should reduce trips and ambiguity: where the hallkeeper is working, what the current requirement is, what is still unknown and what must happen next. No circular completion score and no false green “Ready”.
```

## 3. Consequential change drawer

```text
Design the Day sheet with a substantial ivory drawer open on the right, titled “12 more guests requested”. Keep enough of the underlying Grand Hall event visible to show its unchanged “120 guests · Brief v7”. The drawer is the focal point, with large readable before-and-after values.

Header: “CR-014 · Pending decision”; “Heritage Trust Dinner · Grand Hall”; “Requested at 14:05 · Decision needed by 15:00”. A two-column comparison reads “CURRENT BRIEF” and “REQUESTED”: Guests 120 → 132; Tables of 6 20 → 22; Chairs 120 → 132. Display “Doors remain 18:00” beneath it.

The central section is “What needs checking”, with four restrained, explicit rows: “2 more tables + 12 chairs · Availability unconfirmed”; “Revised arrangement · Layout review required”; “Catering for 132 · Confirmation required”; “Setup time and cover · Recheck needed”. Do not invent a numerical time estimate, stock count, safety result or automatic solution.

Then show “Decision owner · Ellis, duty manager” and “Current brief stays at 120 until a decision is recorded”. Primary button: “Request the missing checks”. Secondary actions: “Suggest an alternative” and “Decline request”. A quieter disabled control “Record approval” has the nearby reason “Required checks outstanding”. The interface must make it easy to understand the choice and why information is still needed.

At the bottom, a preview headed “After a decision” lists Nora, catering lead and setup crew with state “Update not sent”. This is a future distribution preview, not a claim that messages have been delivered. Keep the drawer graceful and uncluttered; no chat transcript or abstract risk score.
```

## 4. Phone: next action and honest offline state

```text
Create exactly two large straight-on phone interface panels side by side on a quiet cream canvas, labelled “Connected view” and “Offline view”. Each panel has approximately a 390 × 844 logical viewport with genuinely large readable text and thumb-friendly buttons. No photorealistic phone hardware. Keep the reference's ivory, sage and apricot style with high contrast and ample spacing. Do not shrink a desktop timetable into a phone.

Both screens show “Hillside House · Hallkeeper”, “Thu 15 May · 14:10”, and the selected room “Grand Hall”. A prominent current action card says “Confirm catering arrival”, “Due 14:30”, “Heritage Trust Dinner”, “120 guests · Doors 18:00”. Below is a compact “Next” card: “Collect furniture · Nora · 15:30”. A small amber item says “132 guests requested · Pending”. Bottom navigation has only “Now”, “Rooms” and “Handover”.

Connected view: show actions “View contact” and “Record update”, and a calm caption “Brief v7”. Do not display a made-up phone number or claim a call was made.

Offline view: show a conspicuous amber banner “Offline · Last sync 14:02”. Keep the cached brief legible. Show “1 update saved on this phone · Waiting to sync” and a small note “Other people may have newer changes”. The action is “Save note on this phone”, with no delivered tick or false live status. A compact “Offline pack” link remains available. Do not imply that supplier contact, cross-device sync or remote approval succeeded offline.

The visual should communicate calm recovery: the hallkeeper can still read the current cached work and capture a note, while the limits remain obvious. Footer on each panel: “Fictional demo · Visual concept”.
```

## 5. Deliveries and arrivals

```text
Design the DELIVERIES screen for Thursday 15 May 2025 at 14:10. Retain the light ivory shell, small room images and generous typography. Title: “Arrivals & collections”. The purpose is to prevent the hallkeeper becoming the switchboard for every supplier.

Use a readable short schedule on the left, not a map. Three fictional entries: “Catering · Expected 14:30 · Arrival time to confirm”; “AV team · Expected 15:00 · Contact available”; “Hire collection · 22:30 · Collection arrangement to confirm”. These are expected appointments, not actual arrivals. Select Catering.

The right detail pane shows “Catering · Heritage Trust Dinner”, “Grand Hall · 120 guests · Brief v7”, “Expected 14:30” and “Nora · Arrival contact”. Show three useful preparation rows: “Arrival instructions · Draft”; “Unloading slot · To confirm”; “Setup requirements · Review with catering lead”. Do not invent a real gate, loading bay, vehicle route or emergency access path. Provide “View contact”, “Prepare arrival brief” and “Record arrival” as separate controls.

A small amber note says “Request for 132 guests pending · Catering confirmation needed”. Beneath the draft arrival brief, explicitly show “Not sent” and a button “Review before sending”. Leave meaningful blank space around this focused work. There should be no tracking dots implying real vehicle telemetry, no automatic delivered status and no irrelevant guest data.
```

## 6. Break cover handover and return

```text
Design a break-cover Handover screen at the same demo clock, Thursday 15 May 2025 at 14:10, preparing Nora's proposed break cover with Maya from 15:00 to 15:20. Use the airy ivory diary style, a quiet architectural room image and large readable text. Heading: “Take your break with cover”. Subtitle: “Nora → Maya · 15:00–15:20 · Routine hallkeeper duties only”. Show “Prepared for review · Not yet accepted”. This is a short cover arrangement; Ellis retains change-decision authority.

The main sheet has three uncluttered sections. “What is happening”: Heritage Trust Dinner, Grand Hall, current brief v7, 120 guests, ready by 17:15, doors 18:00. “What needs attention”: request for 132 guests pending with Ellis, catering arrival confirmation due 14:30, AV test still to do at 16:45. “What the next person needs”: link to the room brief, link to relevant contacts, and “Keys and equipment locations · Confirm together”. Do not fabricate security instructions or key codes.

An adjacent narrow panel headed “Confirm break cover” shows three incomplete steps: “Review the open items”, “Confirm routine duties and 15:00–15:20 window”, “Accept cover”. A concise note says “Nora remains owner until Maya accepts; cover starts at 15:00”. Show a primary “Review break cover” control and secondary “Add a note”. The acceptance control “Maya: accept break cover” is visibly unavailable until the review step is complete, with that reason readable. A clear amber line says “Escalate to Ellis if unaccepted by 14:55”.

A quiet return card reads “Return to Nora · 15:20 · Cross-check open items together”, with state “Return not yet recorded”. Record the return of routine duties to Nora after that cross-check; a timer alone must not imply it happened. Beneath it, show “Next for Nora · Collect furniture 15:30 · Physical room check 17:15”. Do not imply a protected break, accepted cover or completed return while those steps are unconfirmed. This is a useful shared briefing, not a leaderboard, timesheet or staff performance score. Keep the unresolved items more prominent than routine completed work.
```

## 7. Printable A4 hallkeeper sheet

```text
Create a flat, straight-on A4 portrait PRINT DESIGN, approximately 2480 × 3508 pixels, with a white paper background, generous printer margins, mostly dark ink and very restrained sage rules. It should feel like the same Hillside House product without relying on coloured fills or photography. No perspective, desk props, paper curl or ornamental border. The sheet must be readable in greyscale and usable with a pen.

Header: “HILLSIDE HOUSE”, “Hallkeeper sheet”, “Thursday 15 May 2025”, “Printed 14:10 · Brief v7”, and the explicit label “FICTIONAL DEMO · VISUAL CONCEPT”. Below: “Heritage Trust Dinner · Grand Hall”, “Current brief: 120 guests”, “20 tables of 6 · 120 chairs”, “Room ready 17:15 · Doors 18:00”.

A prominent outlined box says “PENDING CHANGE — NOT PART OF CURRENT BRIEF”, “CR-014: 120 → 132 guests”, “Would require 22 tables of 6 and 132 chairs”, “Decision owner: Ellis · Needed by 15:00”. Do not turn the requested numbers into the working setup.

The central task table has four generous rows with columns Time, Action, Owner and Done / initials. Rows: 14:30 Confirm catering arrival / Nora; 15:30 Collect furniture / Nora; 16:45 AV test / AV lead; 17:15 Physical room check / Nora. All completion boxes start blank.

Below are clear pen-friendly areas titled “Exceptions and changes”, “Break cover — acceptance / return”, and “Close and carry forward”. The cover area says “Maya · 15:00–15:20 · Routine duties only”, “Nora remains owner until Maya accepts”, “Escalate to Ellis if unaccepted by 14:55” and “15:20 · Cross-check and record return to Nora”, with blank initials/time fields. Include a small contact section naming Nora, Maya and Ellis by role, with no invented numbers or access codes. Footer: “Check for a newer brief before use. Record changes with the duty lead.” and “Page 1 of 1”. Do not make a QR code the only route to essential information. Avoid safety certification, signatures that appear already completed, giant checklists and decorative progress bars.
```

## 8. Venue memory and a useful work order

```text
Design a focused VENUE MEMORY screen in the same airy ivory style. Title: “Know the room”. Small search field: “Find a switch, procedure, item or past issue”. Grand Hall is selected, with its recognisable heritage photograph. This is the venue's practical shared knowledge, not an AI conversation.

Use two readable adjacent panes. Left is a short knowledge list with clear provenance labels: “Room care instructions · Reviewed reference”; “AV quick guide · Review due”; “Furniture collection notes · Colleague tip”. Select “AV quick guide”. Its detail says “Reference owner: AV lead”, “Review due”, and “Check the current guide before use”. Show a small document preview shape rather than inventing electrical instructions. Provide “Open source” and “Request review” controls. Distinguish a reviewed reference, an out-of-date reference and an unverified colleague tip visibly.

Right is a work-order card: “Projector remote missing”, “Grand Hall · Reported by Nora at 14:05”, “Owner not yet assigned”, “Needed before AV test at 16:45”. Show an evidence area labelled “Add photo or note”, a concise impact “AV test may be delayed” and practical controls “Assign owner” and “Add update”. Do not invent a completed repair or success message. A lower action says “After resolution: propose a knowledge update”, visibly a future step that still requires review.

A small event context strip keeps “Heritage Trust Dinner · 120 guests · Doors 18:00” visible. This screen should make a veteran's useful knowledge easy to find and preserve, and make an unresolved fault easy to own and follow through. Avoid fantasy building telemetry, generated safety instructions, long prose blocks and unnecessary personal information.
```

## Reviewing the outputs

Review each image for visual and operational coherence: can a hallkeeper identify the current brief, pending request, owner, deadline and next action without decoding the screen? Does it remain readable at ordinary display size? Are incomplete checks and offline limits explicit? Are 120 current guests and 132 requested guests kept separate? If any wording or geometry drifts, correct the image before treating it as a design reference.

An image can establish a desired appearance and interaction concept. It does not establish tested functionality, staff agreement, venue facts, stock availability, validated geometry, lawful operating capacity, completed inspections, delivered notifications or Blake's final aesthetic acceptance. Keep these generated screens in the design pack; only verified source records belong in operational data.
