# Hallkeeper care and craft: delivery evidence

7 September 2026 · T-606 expanded design objective

## Outcome and artifact identity

The expanded experience is designed in [care and craft](care-and-craft.md), supported by the [complete first workflow](workflow.md), three focused research/review documents and [four revised image prompts](image-prompts-v2.md). The [acceptance matrix](experience-acceptance.md) traces the user’s requirements to design and browser evidence. The first study and its evidence are retained.

The updated interactive concept is `C:/Users/blake/.codex/visualizations/2026/09/07/01a07bad-cdd7-72f2-88e3-2ff82e1fe7fe/hallkeeper-care.html`. Final SHA-256: `2CAAA19C832487BD66CCCCBDFB13EECBD842D1FA711687DA07CD60311CEF4EA9`. It is conversation content, not a deployed application. All people, events, replies, arrangements and actions are fictional and visibly labelled as simulated. No external message is sent.

## Research and independent review

- [Veteran work research](research/veteran-work.md) uses actual hallkeeper/duty-manager duties, venue specifications, interruption research and work-motivation literature to identify practical burdens. It distinguishes research samples, professional guidance and design inference.
- [Client care research](research/client-care.md) informs personal hosting, meaningful promises and service recovery. The hallkeeper remains the client’s contact while the appropriate colleague accepts the decision or delivery work.
- [Design pressure test](research/design-pressure-test.md) challenged the first concept through 18 situations. Its recommendations are historical critique, not a claim that each is a clickable v2 integration.
- Independent final specification review found no additional essential design omission. The initial workflow covers opening, suppliers, multiroom conflicts, live rounds, emergencies, cleaning, closing and venue memory; the expanded specification develops receiving instructions, physical craft, client care, interruption recovery, relief and physical handback.
- Independent source review found and rechecked the state defects below. The final logic review reported no material blocker in those paths. Root verified actual browser behaviour separately; agreement between agents was not treated as proof.

Primary sources were accessed during the task. Root also reopened the CHI 2008 interruption study, Co-op’s 2017 rollout account and Ritz-Carlton’s Gold Standards. Dated manuals and examples are evidence of information/coordination needs, not current Trades Hall operating rules. There were no hallkeeper interviews, real service trials or measured time/stress improvements.

## Browser scenarios

Playwright CLI ran Chromium against the official visualization preview wrapper served on localhost. The fragment was frozen while scenarios ran. [Scenario source](../../../output/playwright/hallkeeper-care-2026-09-07/final-scenarios.cjs) and [52 passing assertions](../../../output/playwright/hallkeeper-care-2026-09-07/final-scenarios.json) cover:

| Gate | Observed result |
|---|---|
| S1 · Receive the arrangement | Grand Hall v7 shows orientation, intention, source and deadline. Saloon changes to its own event, counts and v3. An empty question stays unprepared; a substantive question automatically retains room/event/revision. Receipt does not release the room. |
| S2 · Changed promise | Request → office acceptance → checked exact offer → organiser agreement → issued v8 remain separate. Current 120 stays unchanged until issue. v8 shows 22 tables with two additions and requires fresh receipt. Infeasible and organiser-declined branches retain v7. Missed updates and an explicitly agreed next update remain truthful. |
| S3 · Personal care and privacy | The welcome brief carries Daniel’s intention. Organiser projection removes the staff workspace and private work notes from its rendered content. It retains the correct current venue contact and truthful request state. Keyboard Enter opens it and returns to staff work with useful focus. |
| S4 · Service recovery | Unaccepted work remains unaccepted. Sam’s unavailability transfers delivery to Pat only through the explicit simulated acceptance. Delay records an update promise; an adjustment does not imply client satisfaction. An unsuccessful response persists through escalation; an agreed alternative still requires an actual outcome check. Client comfort leaves outstanding technical reassessment owned and visible. |
| S5 · Interruption and return | Room-specific progress and notes survive clarification, People, care and another room’s work. Return restores the paused job and exposes an intervening revision without clearing recorded collection. |
| S6 · Relief and finishing | The generated handover includes Grand Hall, Saloon and Reception, room notes and unanswered questions. Optional personal prose is not mandatory; it remains visible to the incoming colleague. Declined cover retains Nora; planned acceptance does not begin the break. Explicit start, return and shift acceptance update ownership without completing work. |
| S7 · Correct a mistake | Correcting Saloon collection reopens that recorded action, retains the note and leaves Grand Hall collection unchanged. This exercises correction; full offline delivery/restart recovery is specified, not implemented here. |

No unhandled page errors were observed during the successful scenario run. This is not a blanket claim about every optional preview-library network request or every possible browser path.

## Failed evidence retained and corrected

[The initial seven-defect reproduction script](../../../output/playwright/hallkeeper-care-2026-09-07/review-reproductions.cjs) is retained as the original failing exercise. Its initial result had `defectReproduced: true` for all seven checks. The new agreement step intentionally changes that old script’s sequence; it is not the final regression suite.

| Observed defect | Correction and final evidence |
|---|---|
| v7 receipt incorrectly applied to v8 | Receipt is bound to the issued revision; R1 passes. |
| One bookmark lost notes and mixed room/work context | Independent room bookmarks with preserved notes and resumption target; R2a–c and S5 pass. |
| Replacement worker still labelled Sam | Response labels follow Pat; R3 passes. |
| Ellis escalation disappeared on navigation | Persisted awaiting-acceptance and alternative states; R4 passes. |
| Handover accepted three rooms while showing only Grand Hall | Generated per-room briefs include actual progress and questions; R5 passes. |
| Organiser view repeated an expired 14:25 promise | Missed promise remains visible until a recorded conversation establishes the next update; R6 passes. |
| Old break controls could contradict an accepted shift | Accepted shift closes incompatible controls and owns the current contact; R7 passes. |
| Incoming colleague could not see the saved personal note | Browser reproduction confirmed omission; read-only accepted view now includes the note; R8 passes. |
| Agreeing to an alternative claimed it had been physically tried | Browser reproduction confirmed premature claim; agreement now prompts actual help and outcome check; R9 passes. |
| No direct return to the paused job from handover | Browser scenario timed out on the missing return action; handover now includes the same contextual return. S5 passes. |
| Mobile CSS hid Handover together with the staff-name label | Responsive browser interaction failed; selector now hides only the label. All staff views retain Handover across tested widths. |

One initial assertion assumed rendered label case despite CSS uppercase; the harness was corrected to inspect semantic text. This was not a product defect. Initial tall-iframe screenshots clipped lower content during capture. Final captures use a tall browser viewport and the product root; the fragment is unchanged for photography.

## Rendered review

[Responsive exercise](../../../output/playwright/hallkeeper-care-2026-09-07/responsive-review.cjs) and [aggregated results](../../../output/playwright/hallkeeper-care-2026-09-07/responsive-results.json): 45 view/width combinations across 1024, 736, 390, 360 and 320px, plus one 512px layout check. All nine views fit without measured horizontal overflow or out-of-bounds/smaller-than-43px visible controls; buttons use a 44px minimum height. Actual fragment widths vary with wrapper padding and scrollbars (observed 273–992px). The 512px case exercises the layout width associated with 200% on 1024px; it is not a physical browser zoom/device qualification.

Reduced-motion inspection found no animations. The requested ivory palette remains intentional under a dark system preference. States use words alongside colour. Native controls, labels and focus are exercised; this is not an accessibility certification or screen-reader audit.

Final visual captures include [Today, desktop](../../../output/playwright/hallkeeper-care-2026-09-07/final-today-1024.png), [room instructions, desktop](../../../output/playwright/hallkeeper-care-2026-09-07/final-room-1024.png), [Today, phone](../../../output/playwright/hallkeeper-care-2026-09-07/final-today-360.png), [service response, phone](../../../output/playwright/hallkeeper-care-2026-09-07/final-care-360.png), [handover, tablet](../../../output/playwright/hallkeeper-care-2026-09-07/final-handover-736.png) and [organiser view, phone](../../../output/playwright/hallkeeper-care-2026-09-07/final-organiser-360.png). The inspected layouts preserve warm paper, sage/honey/apricot accents, clear type, fine structure and generous spacing. Blake’s liking of v1 establishes the direction, not automatic acceptance of v2.

## Material limits and delivery boundary

This completes a researched and browser-exercised design concept, with proposed full-workflow behaviour and copyable prompts. State lives in this demonstration’s memory and resets on reload. Production persistence, authentication, role enforcement, notifications, concurrency, offline reconciliation, real plans/stock/contacts and venue-qualified operation remain implementation work. The public projection, detailed training mode, printing and full event handback are designed in the documents; the seven representative scenarios above are the clickable scope.

No application source, production data, deployment or generated image was changed by T-606. No app build was needed for these standalone design artifacts. Documentation links, fence/whitespace consistency, source syntax and scoped diffs were checked. The shared shipping convention preserves research/prototype/artifact scope; it does not require an unrelated application deployment. T-601/T-603/T-605 retain their implementation responsibilities. Real staff observation must establish whether this removes effort and improves the day.
