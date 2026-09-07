# Event stages: colour direction

7 September 2026 · T-606 visual refinement

Blake supplied [this generated result](generated-reference.png), likes it alongside the original concept, and specifically likes colour identifying stages of an event’s life. It is a visual reference, not an instruction source, approved venue data or evidence of completed work. The unmodified PNG has SHA-256 `D25535F8AC6F62759FE3E44F20F14E0A7C3282E450E53813BDDC94B483E5D0C5`.

Retain the original ivory workspace, restrained structure and readable type. Adopt the reference’s stronger ready-by/doors hierarchy and clear event-stage colours. Room-recognition photography is a useful direction for the next image study; this iteration does not extract generated room images or substitute them for verified venue photography.

| Event stage | Surface | Meaning |
|---|---|---|
| Preparation | Sand `#EEE5D5` | Receive the brief and establish what is needed |
| Setup | Apricot `#F5DCCB` | Collect and arrange the room |
| Room checks | Honey `#F8E8BD` | Specialist tests and the final physical walk |
| Event and hosting | Sage `#DFE8D8` | Welcome, service and personal follow-up |
| Clear and reset | Dusty blue `#DFE9EC` | Client departure, clearance, cleaning and reset |
| Handback | Lavender `#E9E2EE` | Next-use checks and accepted remaining responsibilities |

These identify kinds of work, and recur on relevant task rows. Dark text and stage names carry the meaning alongside colour. Receipt, work completion, approval, client satisfaction and accepted responsibility remain distinct recorded states. Alerts have explicit consequences and owners; ordinary pending decisions do not acquire urgency merely from stage colour.

The overview is an ordered stage strip rather than falsely proportional time blocks. Supplied fictional preparation/setup/check slots are labelled; event end and later slots remain “Time to agree.” Selecting a stage reveals its work and a contextual action, without changing operational status. Detail opens on demand. The selected stage is labelled “Viewing”; there is no invented “Now” position. A hosting task such as welcoming the organiser can occur before guest doors, and checks can recur after changes.

The reset detail starts with the joint condition/belongings check before departure, followed by clearance and cleaning. Its label is therefore “Departure & reset,” not “After departure.” The final handback concerns the room’s next use and incoming staff, not an assumption that the organiser waited for cleaning.

## Prompt for the next image

Attach the original diary, the new generated image and the preferred hallkeeper concept. Add this to the [existing master](image-prompts-v2.md):

```text
Blend the original warm, airy hallkeeper workspace with the supplied generated result. Retain ivory surfaces, readable dark type, fine dividers, sage accents and calm room imagery. Bring forward the generated image’s clear room identity and prominent paired “Room ready by 17:15” / “Doors at 18:00” milestones.

Use consistent event-stage colours: preparation in pale sand, setup in soft apricot, room checks in honey, event/hosting in sage, clear/reset in dusty blue, handback in muted lavender. Repeat each stage colour as a small task-row accent with its written stage name. Keep forest green for useful actions. Colour must never imply that work is approved, finished or safe.

Make “The event’s day” a compact ordered stage strip. Each stage has a name and its known time or dependency. General prep 12:00–14:00; setup 14:00–16:45; checks 16:45–17:15; doors 18:00; event end to agree; departure/reset and handback times to agree. Do not invent an end time or draw unknown periods as measured durations. Detail is revealed by choosing a stage. The resting screen stays concise.

Below, retain the useful next actions and their owners. Keep the human-care rail: Nora is Daniel’s contact, Ellis owns the extra-guest decision, and a promise to update is separate from a promise to fix. Current issued brief remains v7 for 120; 132 is only requested. Preserve the separate People and Handover paths. Use a small recognition photograph for each fictional room, without treating generated imagery as a measured plan.

One polished landscape product screenshot, approximately 16:10. No device frame. Fictional walkthrough label remains discreet. Preserve generous space; reduce content before shrinking text.
```

## Verification

New conversation source: `C:/Users/blake/.codex/visualizations/2026/09/07/01a07bad-cdd7-72f2-88e3-2ff82e1fe7fe/hallkeeper-lifecycle.html`, SHA-256 `BACDBD7D5C0C3E8D001A3A8CA541B101022486ABE0BD979D0C30C73508F6DD91`. The original and care-and-craft sources are preserved.

The [retained interaction exercise](../../../output/playwright/hallkeeper-lifecycle-2026-09-07/retained-scenarios.cjs) passed all 52 existing care/room/change/handover assertions. [Stage review](../../../output/playwright/hallkeeper-lifecycle-2026-09-07/stage-review.cjs) passed [26 checks](../../../output/playwright/hallkeeper-lifecycle-2026-09-07/stage-results.json), including distinct colours, selected-stage keyboard focus, unchanged receipt/transfer states, correct second-room context and usable targets without horizontal overflow at 1024, 736, 390, 360 and 320px. An independent source review caught the departure/reset label mismatch; it was corrected before final stage verification. The final presentation also closes stage details until requested; the stage exercise verifies this behaviour.

Root inspected the [desktop](../../../output/playwright/hallkeeper-lifecycle-2026-09-07/lifecycle-1024.png), [phone](../../../output/playwright/hallkeeper-lifecycle-2026-09-07/lifecycle-360.png) and [reset detail](../../../output/playwright/hallkeeper-lifecycle-2026-09-07/reset-1024.png) renders. This is a local interactive design refinement, not a deployed operational system or a measured productivity result. No application source or venue data changed.
