**Read this when:** designing, implementing or reviewing any user-visible surface, motion, interaction or visual target.

# Venviewer product experience

## The supreme principle: make everyone's life easier (founder, 26 September 2026)

Blake asked for this to be hard-baked into every design decision, verbatim:

> we want people to feel good about themselves and work because the tools they are using are so beautiful and intuitive and streamline their work flow and makes them feel good to complete tasks, it must look highly polished and professional while being a joy to work and navigate and go through, so all information is easily communicated to them in a visually satisfying way -- this is the supreme key element we must achieve, perhaps game design or psychology will help us, please do deep thinking and research on how to best achieve this, it must look luxurious and well planned, custom designed for veteran venue bookers and sales executives of venues, must look and also feel like intelligent design choices were made. it is absolutely imperative that people feel proud to use our platform because it feels so polished and complete, they are energised by it, and feel good and uplifted using it simply because it is so easy to use and visually inviting and relaxing and encouraging, i say encouraging meaning only design wise, colour wise, no need for heavy handed encouraging words as that is belittling, we want pure production value that makes everyone's life easier and make people feel great using our platform, we must never daunt any user or client by making things look like hard work, this philosophy will steer all of our design choices to think as deeply as possible on how to ensure we do not tire or frustrate our users who may use the platform 8 hours a day every day, we want them to tell their colleagues and friends of our platform of how much of a joy it is to use. we want industry veterans of 50 years who are stuck with salesforce and cvent to move to our platform because we offer everything these companies offer, and we also offer everything they wish those companies offered, we are essentially a dream app for every professional connected to events and venue ecosystems, all the little problem areas that people don't bother to create a solution to -- we will solve all of that because our core philosophy is to "MAKE EVERYONE'S LIFE EASIER".

It governs every surface, working state and feature choice, ahead of any other preference in this file. In practice:

- **Proud, not daunted.** Every screen must feel finished, calm and luxurious to someone using it eight hours a day. Nothing may look like hard work: no walls of identical cards, no dense grey text, no generic library colours, no dead ends, no modal-on-modal.
- **Encouragement lives in design, never in words.** Colour, light, rhythm, finish and the feeling of progress do the lifting. No praise, cheerleading, badges, points or "Great job!" copy; Blake calls heavy-handed encouraging words belittling. Plain, factual language only.
- **Production value makes life easier.** Choose what removes a step, a click, a doubt or a wait over what decorates. Solve the small problems other platforms ignore.
- **Built for veterans.** Venue bookers and sales executives with decades of experience should recognise their own way of working: lead with the facts that decide (date, guests, room, stage, money), in their vocabulary, venue-local and British.
- **Intelligent design choices, visibly.** Say real consequences before acting (who is emailed, what is sent, what changes). Confirm only consequential external actions; routine internal steps are one action. Keep context: open detail beside the list rather than replacing it.
- **Ambition.** Everything Salesforce and Cvent offer, plus what their users wish they offered, so a 50-year industry veteran would move. Every professional in the events and venue ecosystem is a user worth designing for.

The Enquiries desk (T-633, [design record](../../docs/design/enquiries-desk-2026-09-24/README.md)) is the first surface Blake has judged "much cleaner", "not a slog to the eyes" and "inviting". Treat its patterns as the reference for all other surfaces:

- the selected style's ivory sheet, forest decision panel, copper plane for the numbers that matter, sage ground, and editorial serif with light large numerals;
- one clear next step, always in the same place;
- visible progress and closure (counts that tick down, a restrained status stamp, a calm "All caught up");
- keyboard triage for high-frequency work;
- calm motion (press feedback only, no hover swell, reduced motion honoured);
- WCAG AA text and a visible focus ring on every surface;
- real, sourced venue photography as the moment of scale.

### Founder decisions on reach and priorities — 26 September 2026

Blake answered four scoping questions:
- **Visual identity reach.** The desk's look covers every staff tool and everything clients receive or work in: proposals, contracts, the client portal and the planner's chrome. The public homepage and marketing pages keep their own editorial voice, tuned to read as the same family. The calm, polished principles apply everywhere.
- **Hover motion.** Remove the global springy hover pop (scale 1.06 and brightening) everywhere. Hovers become quiet colour changes, and presses a small press-down.
- **What the platform replaces.** The Trades Hall team uses Salesforce, Cvent, venue sales-and-catering software, and email, spreadsheets and paper today. Import paths and parity must cover all four.
- **Next surfaces.** After Enquiries, rebuild the Diary with its holds, and the hallkeeper and event-day tools, to the same standard.

Blake's second round of answers (same day):
- **Hold words.** Screens say "Provisional", "1st option", "2nd option", "Joint 1st" and "Confirmed". Internal words such as pencil, ink, prospect and ladder position do not appear.
- **What the Diary opens on.** This week, with a quiet venue-wide list of holds whose decision date is due or overdue.
- **When a 1st option lapses or is released and the 2nd moves up.** The 2nd option's owner is told in the app and given a drafted email to their client to review and send. Nothing is sent automatically.
- **Diary composition.** The Diary takes the full desk composition: sage ground, tilted ivory sheet, copper count plane and forest panel.
- **Event day.** Hallkeeper and event-day tools serve hallkeepers on phones and on tablets, a duty manager at a desk, and printed function sheets. Design for all four.
- **Enquiries desk.** Keep the first-name greeting and the session tally; remove the keyboard legend from the empty panel.
- **House type.** Newsreader is the one serif everywhere, including the VENVIEWER wordmark. Inter sets all interface text.
- **Shipping.** Blake: "you handle everything, make sure all our good work is implemented and not lost on stray branches, make sure all our improvements and new work go live, you have full permission to do everything and anything."

### Selected Diary direction — 7 September 2026

The founder rejected the old dark Diary and selected a light ivory/forest workspace and an airy room-photo timetable as the interim direction. Preserve readable booking titles and exact times, clear status and conflict distinctions, recognizable sourced room photos, and direct access to booking details. The full-week overview and precise timeline have distinct purposes; summary-card width must not falsely imply duration. [Current scoped design QA](../../design-qa.md) records the adaptation and remaining dense-week limitations. The founder's attachment references remain private and their sample names, rooms and quantities are not operational data.

### Selected inventory style — 6 September 2026

Blake selected [this inventory composition](../../docs/design/references/venviewer-selected-inventory-2026-09-06.png) and asked to make it the new style: welcoming, easy to use, functional and beautiful. This is the current implementation target, superseding the earlier open choice between ten image concepts. Preserve its warm ivory, deep forest green, pale copper and sage; substantial overlapping planes; tangible furniture illustration; editorial headings; and an adjacent correction surface. Adapt those principles to each real workflow and device rather than copying the screenshot as an interface. The retained 1586 × 992 PNG has SHA-256 `50d0620dcf2180512bd33d90e522ab3a00c243446a3251e0b063fdd2f740acae`.

The [demo integration record](../../docs/reports/trades-hall-demo-release-integration-2026-09-06.md) identifies the included inventory implementation, its verification boundaries and the private source/design archive excluded from that release ancestry. Inspect current source for implemented behavior. Broader workflow plans and matching-screen studies remain design context; they do not establish delivered or accepted features.

Selecting this image approves a visual direction, not its illustrative stock figures, furniture identity, future features or the eventual implementation. The generated furniture [asset provenance](../../packages/web/src/assets/inventory-style/provenance.json) remains presentation-only. Do not copy 20 damaged chairs, 190 reservations, East store or 24 round tables into venue data. Keep recorded facts, unknowns and source qualifications intact. Detailed equipment intake remains in the private source archive; this branch's illustrations and design brief do not authorize an operational import. Blake's acceptance of the working result and physical-device qualification remain separate.

### Continuing founder aesthetic requirement

Beauty and the philosophical sublime are required product outcomes across every active surface and working state, including administration and inventory. Blake explicitly rejected T-591's inventory screenshot as "absolutely terrible and boring". Its functional verification remains valid; its presentation is rejected and must not be reused as an approved visual target.

Blake's clarification explicitly requires **Burke's sublime: delightful horror**. Aim for an immediate perceptual encounter with overwhelming scale, obscurity, mass, luminous intensity or power, experienced from a secure position. The interface must give the user clear, dependable agency within that experience. The earlier gracious ballroom/showroom concept was rejected as insufficiently awe-inspiring. The ten-direction exploration of 5 September is now historical design context; do not treat this already-made visual choice as pending. Apply the continuing philosophical ambition through the current selected style. Do not manufacture operational danger, unreadability or obstructive navigation to evoke the sublime.

Do not equate passing tests, readable text, muted colours, a serif title, expensive materials or a conventional dashboard with aesthetic acceptance. Design the composition, navigation, physical/spatial presence, typography, interactions, motion, sound and ordinary dense/error/offline states together. Demonstrate beauty, felt scale/depth/significance and effortless agency through actual visual targets and working interactions. Blake remains the aesthetic judge; agent review does not replace his verdict. Continue using already-authorised references where applicable without requesting redundant permission.

Every action must work, communicate its real consequences and preserve data. Use the shared Activity component for actual working states and honor reduced motion. Preserve visual quality across the declared phones, tablets and office computers; qualify performance on actual devices.

Specific stylistic prescriptions in an unapproved design draft (including darkness everywhere, one accent, blanket material bans or a fixed percentage of room imagery) are proposals, not founder requirements. Do not let them narrow his ambition or reproduce a rejected design. The earlier rejection and prompt history remains context; the selected reference and current founder direction guide this work.
