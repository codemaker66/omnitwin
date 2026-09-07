# Hallkeeper experience pressure test

7 September 2026 · T-606 independent design critique · proposed interaction design

Reviewed the current [workflow](../workflow.md) and the initial interactive study at `C:/Users/blake/.codex/visualizations/2026/09/07/01a07bad-cdd7-72f2-88e3-2ff82e1fe7fe/hallkeeper-day.html`. This is source inspection and a veteran-perspective design exercise. It is not evidence from hallkeeper interviews, a browser usability test or a live service. No runtime files, venue records or other owners' scope were changed.

## The change the next design needs

The first study helps Nora see work. The next study should help Nora stop carrying it.

It currently describes uncertainties clearly, but often hands them back to her: confirm the arrival, review the change, prepare a checking list, record a note, ask for cover. A hallkeeper can already make a list. The hard part is establishing what was actually promised, getting the right person to answer, keeping the client comfortable while waiting, and remembering to return to the job interrupted halfway through.

The central promise should become: **Someone has every loose end, and you can always see who.** The service still feels personal because Nora remains the person the client trusts. She should not have to become the purchasing clerk, commercial negotiator, AV technician and message dispatcher to keep that trust.

The prototype should demonstrate three things with a single realistic story: the room plan becomes understandable work; a worried organiser receives a warm, truthful response; and Nora can hand off a problem without either abandoning the client or becoming its permanent chaser.

## Specific friction in the current concept

| Current interaction | Burden on the hallkeeper | Replace it with |
|---|---|---|
| “Next for you: Confirm catering arrival” opens an unspecified arrival and a textarea. | Nora must discover the catering lead, find a contact, ask the question, judge the reply and translate it into a note. | An answerable request with the expected window, named responsible person, last contact and one clear contact action. If Nora is only receiving the delivery, the office owns an unresolved arrival confirmation. |
| “Prepare checking list” for 12 more guests creates four more things to check. | Acknowledging a request becomes project management. | One decision owner, a response deadline, automatically linked checks with their existing owners, and a small contribution from Nora only where her observation is needed. |
| “I am blocked” changes a label to “Owner follow-up needed.” | The blocker stays in Nora's head because no person has accepted it. | “What is stopping you?” followed by the minimum useful observation; then a named responder and the next update. Keep the work with Nora only until its transfer is accepted or a manager explicitly provides cover. |
| Every task uses the same “Done / Blocked” modal. | It forces Nora to translate a physical situation into a generic status and hides the help appropriate to that job. | Contextual completion: “Delivery received,” “Room arranged,” “AV test recorded,” or “Guest helped.” A single secondary “Something is different” action opens the relevant exception. |
| The room pack always returns to Grand Hall, even after another room is selected. | Selection appears to change context but does not preserve the work. This would be a trust-breaking error in a real venue. | Keep room, event, phase and issued plan together through every view. Opening a Saloon pack must preserve Saloon; returning from a call must restore the exact previous step and scroll position. |
| “What to bring” lists unconfirmed collection points and unconfirmed trolley/crew. | Nora still has to solve the physical job before starting. | Show a prepared route only when its facts are known. Otherwise make “Store location needed from Ellis” an owned preparation gap, explain what work can safely continue, and avoid presenting the collection task as ready. |
| The room sketch contains table numbers without locating rows, doors or a familiar orientation. | Nora must mentally convert an abstract picture into the actual room. | A familiar anchor, an explicit view direction, room-specific plan identity and linked item/zone labels; require sourced geometry before showing operational measurements. Start with the whole arrangement, then expose detail on selection. |
| The handover requires “Anything Maya needs to know?” before its draft can be saved. | Nora retypes what the application already knows and may invent a redundant note to finish. | Prepare the handover automatically; make an extra note optional. The important interaction is Maya's acceptance after a two-way check, not Nora completing a form. |
| “Needs attention” includes Ellis's decision, Maya's acceptance and the AV lead's later test. | Nora is asked to attend to everyone else's work, even when she cannot act on it. | Separate “Needs your action” from a quiet “Being handled” list. Move another person's item into Nora's attention only when its consequence now requires her decision or observation. |
| “Next for you” remains Grand Hall catering while another room is selected. | Whole-shift priority and selected-room priority look interchangeable. | Label the global item “Next for your shift”; label room work “In this room.” On the phone, the current physical job wins unless a more urgent event truly requires interruption. |
| The layout advises continuing the current brief while a guest-count change is pending. | Nora could do work that is about to be undone. | Identify unaffected work and possible rework. Example: “Continue AV and linen collection; Ellis is deciding the extra tables by 15:00.” Any hold on work needs an owner and a time boundary. |
| “Brief v7” appears global while room, event and day vary. | Version numbers give false confidence if nobody knows what they refer to. | “Heritage Dinner · issued 13:20” on the working face, with its revision accessible. The technical identity remains precise underneath. A day's pack can contain several event releases. |
| Local-save disclaimers dominate outcomes. | They are honest, but demonstrate a filing tool rather than the intended service loop. | Retain one clear concept/simulation label, then simulate the full sequence visibly: request captured → Ellis accepts → answer prepared → Nora reassures organiser → work updates. Never imply an actual message was sent. |

## A simple grammar across the whole day

Use three entrances: **Today**, **This room**, **Help**. On a large screen they can coexist; on a phone they are stable, easy-to-reach destinations. A quiet person/shift control provides break cover and handover. Avoid teaching “handoff pack,” “mission,” “command” and “change feed” as parallel places a hallkeeper must understand.

Every job answers four questions before asking for an action:

1. **What does good look like?** Show the agreed outcome, picture or one-sentence criterion.
2. **What matters here?** Show only the unusual instruction or current exception; routine knowledge remains available.
3. **Who is doing what?** Show Nora's part, any specialist prerequisite, and a named decision-maker where needed.
4. **When do we need the next result?** Show the relevant deadline and what depends on it, not several competing clocks.

At the point of work, expose one primary action and two dependable alternatives:

- **Done** becomes a specific verb where possible: “Received,” “Arranged,” “Checked,” “Returned.” Record the outcome at the meaningful boundary; do not demand a tick for every chair or every familiar motion.
- **Something is different** records the exception: wrong item, room occupied, fewer people, damaged equipment, plan unclear, request changed, or another observation. Pre-fill everything the system already knows. The hallkeeper can describe it in ordinary words.
- **Get help** reaches the right on-duty role, including a direct-call path when appropriate. It tells Nora who has the issue and when she should expect a reply. It never ends with a bare “submitted.”

This grammar is simple because the system performs the complicated translation. Internally, completion, request, acknowledgement, approval, specialist inspection and release remain distinct. The hallkeeper sees the meaningful consequence in plain language: “Ellis is checking the extra tables. Your current setup stays the same until 15:00.”

A person should be able to understand the screen without reading a legend or knowing the software's data model. Familiar work names are more valuable than trying to label every technical state on the main face.

### Keep routine work light and exceptions rich

The veteran should see “Prepare the dinner arrangement” with the current plan, quantity summary and relevant changes. They can expand a checklist when training someone, returning after an interruption or using an unfamiliar setup. Do not require expert staff to march through a beginner's script.

Mandatory checks are different: show their precise criterion, who is competent to perform them and why they remain required. Expertise does not permit a generic “all done” action to impersonate specialist approval. The design can be respectful without being ambiguous.

Allow “Already arranged” with the same meaningful outcome and provenance as ordinary completion. Let Nora correct a mistaken tap immediately. Where someone else already completed a job, explain that and stop asking both people to do it.

## Receiving a layout is a conversation about an outcome

The handover from the office should start with **“Here is the event we have agreed to deliver.”** It should not arrive as a PDF whose omissions Nora has to discover in the room.

The first working face needs the event's purpose and host, the current issued arrangement, the important timings, the unusual requirements, and the person to ask. Examples of useful purpose: guests need to see a speaker; a family wants an unhurried welcome; an organiser needs the room to turn between sessions. These facts help a skilled hallkeeper make good small decisions without guessing the organiser's intention.

The office prepares the pack from approved sources. Before issue, unresolved essential operational facts have owners. Nora should receive “Awaiting AV input from Jordan; Ellis will confirm by 11:00,” not an empty box that quietly becomes her responsibility. Do not require hallkeeper consultation for every routine event; request a brief feasibility check when something is new, unusually tight or outside a known room recipe.

At receipt, Nora needs to respond with one of three outcomes:

- **Understood.** This acknowledges the issued instructions; it does not approve commercial or safety decisions.
- **I need one answer.** Select the relevant plan element or instruction and ask in place. The office receives the actual question with context, not a detached screenshot.
- **This will not work as written.** Record the observed constraint, consequence and helpful suggestion. The office owns the revised agreement; Nora does not need to edit the contract or redraw the whole plan.

When Nora enters the room, the valuable comparison is **agreed arrangement versus the room as found**, not merely version 6 versus version 7. A verified current-room state can support “leave these tables; move those; bring six chairs.” If the actual arrangement is unknown, ask once whether it matches the recorded picture. Do not invent a movement plan from an unconfirmed previous event.

Changes highlight only affected instructions. If the office changes the table count, unaffected AV checks remain complete; moved cables or changed access may require specific checks to reopen. Keep the old print visibly old, but provide a short practical change slip so Nora need not compare two whole documents under pressure.

## The office–hallkeeper–organiser triangle

Use one shared request record with different views, not three parallel conversations. Define three responsibilities per request, which may be held by fewer than three people:

| Responsibility | Question it answers | Typical owner |
|---|---|---|
| Relationship | Who makes sure the organiser hears back? | The person who took the request, or an accepted replacement |
| Decision | Who can agree a change to the venue's promise? | The authorised office or duty role; a hallkeeper only within explicit delegated scope |
| Delivery | Who will do the accepted work? | The appropriate on-duty colleague or specialist |

The person who receives a request should not have to personally perform all three. Nor should reassignment make the organiser wonder whether anyone still cares.

### Example: “Could we have twelve more guests?”

The organiser asks Nora during setup. Nora can keep eye contact, say that she will check what can be arranged, and capture a short request afterwards. The record retains the organiser's own words and the agreed details; suggested structured values require confirmation where ambiguous.

The system recognises that this is a change to the event's agreement. Ellis receives one answerable decision containing the existing plan and required confirmations. Catering and inventory checks attach to that decision with their own owners. Nora is asked only for a practical observation she can supply, such as whether the current setup has started or which work would need repeating.

Nora's screen now says: **“Ellis has this. Next update to the organiser by 15:00. Continue linen and AV preparation.”** The update deadline is a promise about communication; it must not masquerade as a promise that the answer will be yes.

If feasible choices are ready, Ellis approves an explicit option and the instructions are issued. If the requested option is not feasible, the office gives a useful alternative with its consequence. Nora receives the short execution difference and a plain-language answer she can review before speaking or sending. The client sees the answer, not the internal shortage debate.

The request closes only after the client-facing loop and accepted delivery have the required outcomes. “Ellis approved” is not “Nora moved the furniture,” and “furniture moved” is not “the organiser knows.”

### Example: “The room feels cold”

Do not put every act of hospitality through a managerial approval queue. If the venue has authorised a simple adjustment within a known operating range, Nora can act and record the result briefly. If heating is unavailable or a restriction applies, route the issue to the appropriate role and offer the organiser a truthful immediate response.

The system should support small care actions inside clear delegated scope, with accountability proportionate to their effect. Changing guest numbers, contractual timings or a constrained layout is different from fetching water. Avoid both reckless automatic promises and bureaucracy that makes common kindness slow.

### Example: “But the office said that was included”

Never make Nora arbitrate a disputed promise in front of guests. Provide a discreet way to see the relevant agreed requirement and contact its owner. Preserve the client's statement without treating it as proven or accusing anyone of error. The office resolves the agreement and prepares the response; Nora can continue welcoming people.

## A client-facing glance screen

Provide a deliberate **“Show organiser”** view from the event. It should be comfortable to turn a tablet around without exposing staff messages. A separate organiser link can show the same authorised information when access is configured.

Its first face is human and short:

- The event and today's host contact.
- The next agreed programme moment and relevant room.
- “Your venue contact today: Nora,” with the approved way to reach the on-duty team.
- The agreed arrangement thumbnail or simple room summary, when useful.
- One outstanding request, its actual state and next update: “Your extra-guest request is being checked. We will update you by 15:00.”
- A clear “Ask for help” path and a way to correct a misunderstanding.

Show the specific answer when there is one: “We can seat 132 with the revised arrangement; please review it.” Do not compress a complex decision to a green readiness badge. Private internal debate, staff breaks, individual performance, other clients, security details, prices the viewer cannot access and personal assistance information are excluded by audience rules.

A guest-facing entrance or wall display has a different audience. It may show where to go, the next public activity and how to ask for assistance. It must not inherit the organiser's change permissions or reveal their private messages. A hallkeeper should not have to remember to hide a sidebar before being helpful.

## Interruptions should end with a safe return to work

The software should keep Nora's place. When a request interrupts furniture preparation, it remembers the room, plan revision, current step and last meaningful completion. After the request is handled, show **“Back to Grand Hall: linen collected; tables still to arrange.”** This can be based on recorded work and an optional “leave myself a note,” never a made-up claim about what Nora was doing.

Use three interruption levels:

- **Act now:** a genuinely urgent event under the venue's operating rules. Give the action and responsible contact immediately; do not wait for typing.
- **Before the next moment:** a decision or response with a real time boundary. Group related changes and show the consequence.
- **When convenient:** routine information and learning. Keep it quiet until the current job ends or Nora opens it.

Nora can choose a temporary focus state, such as receiving a delivery or being with the organiser, with an obvious way to end it. It routes appropriate requests to accepted cover or holds routine notifications. It does not hide real emergencies, make unattended promises or infer unavailability through covert monitoring.

Repeated pings about the same issue should update one item. A client chasing the same unanswered request should raise its service consequence, not create a second job. A response timer should help the team keep a promise; it must not become a public countdown shaming the worker.

## Recovery without blame

| Situation | Good recovery |
|---|---|
| Nora taps Done by mistake. | Offer Undo at once. If a dependent decision already used that result, explain the affected work and route the correction; do not silently preserve a false completion. |
| The office changes instructions while Nora is offline. | Keep the downloaded release readable with its last confirmed time. On reconnect, show the practical difference and review affected queued work before applying it to a new release. |
| Nora submits a request, then loses connection. | Show “Saved on this device; not delivered.” Preserve it, offer the established call route if urgent, and avoid duplicate delivery on retry. |
| A message was sent but no reply arrived. | Show its actual known delivery state and the next accountable follow-up. “Sent” never transfers responsibility by itself. |
| Ellis is absent or does not accept the request. | Route to the defined on-duty deputy after the configured threshold; make the gap visible to the duty role. Do not bounce it endlessly between people. |
| The replacement colleague declines break cover. | Nora sees the decline and the manager owns finding coverage. Nora does not lose the handover notes or have to start again. |
| An organiser changes their mind after approval. | Preserve what was agreed and what work has happened. Prepare the practical reversal and decision consequences without assigning blame. |
| The real room differs from the plan. | Capture one located observation. Keep it linked to the affected job and decision until resolved; do not force the hallkeeper to edit 3D geometry to report a blocked route. |
| A client reports a problem another colleague already logged. | Suggest linking to the existing issue, retain the new information and relationship owner, and show who is dealing with it. |

## Protect judgement, care and dignity

The system should make experience easier to use and share. A veteran can offer a short local tip, correct a poor instruction, request a second pair of hands, or say the job is not feasible without being scored as slow or difficult. Reusable tips require review before they become venue procedure. Private client history should not become a general room tip.

Measure repeated entry, missed changes, avoidable trips, unanswered requests and perceived effort. Do not rank workers by ticks per hour, infer attitude from tone, silently record conversations or turn every pause into an exception. Team coverage and realistic job design matter more than driving individual speed.

Build room for hospitality: a host welcome, a discreet check after the event begins, assistance at the right moment, and a calm goodbye. These can be optional well-timed prompts tied to actual commitments, not a scripted checklist of performative friendliness. Allow Nora to silence a suggested service moment while preserving an agreed obligation.

Show useful appreciation sparingly and specifically: an organiser's actual thank-you, a resolved problem, a clean accepted handover. Do not invent praise, confetti or artificial achievement badges for basic work. End-of-shift reassurance should be factual: “Maya accepted these two open items; tomorrow's supplier collection is with Ellis.”

## Pressure tests for the next interactive study

These are proposed pass conditions, not measured results. Test with experienced and new staff together; ask participants to think aloud, then revise the language using their own words.

| Scenario | Expected behaviour | Failure to watch for |
|---|---|---|
| Nora receives an unfamiliar dinner layout. | She can explain the intended arrangement, unusual requirement, next deadline and person to ask from one working face. | She searches multiple tabs or interprets a thumbnail without orientation. |
| A familiar setup has one small change. | She sees the precise difference and can use her established working method. | The product forces a full repetitive checklist or hides the change among unchanged rows. |
| The organiser asks for extra guests while Nora carries furniture. | A brief capture preserves the request; a named decision owner accepts it; Nora returns to the paused job. | Nora becomes the chaser for catering, stock, layout and office agreement. |
| The organiser asks a routine question about where to leave coats. | Nora can answer from the relevant approved guest information with minimal interaction. | The app creates a change request or requires the organiser to open an account. |
| The organiser asks a question whose answer is unknown. | Nora gives a truthful acknowledgement and a realistic next-update promise owned by a person. | Suggested text invents an answer or implies guaranteed feasibility. |
| The organiser claims the office promised a service. | Nora can discreetly pass the statement and source context to its agreement owner. | The product makes Nora dispute the client or exposes internal blame. |
| Nora selects Saloon, opens its plan, asks for help and returns. | Room, event, revision and work position remain consistent. | Grand Hall's content appears because the setup view is hard-coded. |
| A catering delivery is 20 minutes late. | The receiver sees the actual update, consequence and contact; the organiser update is owned separately. | Nora is repeatedly asked to confirm a fact the office already learned. |
| An AV lead marks a test done while Nora views the room. | The current requirement updates once; a completed specialist check is attributed correctly. | Nora must duplicate the tick or is allowed to sign as the AV lead. |
| The plan changes after the room was partly arranged. | Only affected work is reopened; possible rework and safe-to-continue work are visible. | Everything resets, nothing resets, or Nora keeps building a soon-to-be-obsolete arrangement. |
| Nora turns the tablet toward the organiser. | A deliberate glance view shows a reassuring, authorised event summary and request update. | Internal staff notes, personal assistance details, lock instructions or another client appear. |
| Nora needs a break with two issues unresolved. | The handover is prepared without mandatory prose; a real colleague accepts coverage; unresolved work stays owned. | “Sent” means covered, or a missing note prevents the transfer. |
| Nora makes an honest mistake. | A correction is easy and preserves a useful audit trail without accusatory wording. | Undo is absent, the wrong state silently persists, or the app treats the worker as a problem. |
| Connection drops mid-request and the app restarts. | Nora can identify what is saved locally, what reached someone and which issued plan is available. | A pending badge drains while the recipient never received the request. |
| Three routine requests concern the same room. | They batch coherently; the urgent exception remains prominent; Nora can ask for help without rerecording context. | Every message interrupts independently or all requests flatten to identical urgency. |
| A duty manager does not answer by the agreed time. | The responsible fallback is explicit and the organiser still has a relationship owner. | The system merely turns the card red and leaves Nora to invent an escalation. |
| A late changeover has insufficient people or time. | The duty role sees viable choices and their effects; Nora can flag physical reality without falsifying completion. | The software silently reduces cleaning, checks or breaks to make its schedule fit. |
| The event ends with a collection still outstanding. | The client can depart while the operational return has a named owner and next action. | Closing the event hides the equipment or makes Nora remain its owner off shift. |

## Recommended prototype changes, in order

1. Replace the generic first task with a fully answerable job: the agreed result, real sample contact, next deadline and contextual actions. Keep all example people and facts explicitly fictional.
2. Build the extra-guest story through acceptance, decision, organiser reassurance, issued difference and actual completion. Show the office, hallkeeper and organiser views of the same request; keep the simulation label visible.
3. Make “Something is different” the shared exception entry, with a named responder, a next update and an exact return to the interrupted job. Demonstrate a declined or unanswered handoff as well as success.
4. Add the deliberate organiser glance screen and show a host welcome/service moment. This is the largest missing dimension in the first concept's very internal task view.
5. Make the room pack follow the selected room and event. Show one familiar arrangement and one meaningful change; demonstrate how a question attaches to the layout.
6. Replace mandatory handover prose with generated exceptions, optional personal context and accepted cover. End with an honest “You are covered” state only after simulated acceptance.
7. Exercise one pressured failure—offline uncertainty or a late decision—without losing work, inventing a response or turning the screen into a wall of alerts.

The next pass succeeds when its most memorable interaction is a person being looked after and a loose end being taken off Nora's shoulders. More visible fields, reminders and charts would not establish that outcome.
