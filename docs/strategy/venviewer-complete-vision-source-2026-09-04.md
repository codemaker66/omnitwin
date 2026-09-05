# Venviewer / OmniTwin — Complete Project Vision, Functional Scope and Moonshot Ambition

## Reading this document

This is a transfer brief for a new LLM, product partner or engineering session. It consolidates the recoverable conversation and saved project documents. It preserves the full destination rather than shrinking it to the next release.

It is not a claim that every capability exists. Three labels matter throughout: **Core vision** means an explicit, repeatedly stated product ambition; **Proposed extension** means an idea in our earlier planning or research that belongs in the opportunity register but is not automatically an approved build; **Research frontier** means a technical route to test rather than a guaranteed capability.

The historical sources are not a live repository audit. A future coding session must inspect the actual branch, uncommitted changes, schemas, migrations, assets, tests and deployment before declaring anything implemented, missing or blocked. Earlier assistant-generated reports can contain errors; later explicit instructions from Blake supersede earlier recommendations. In particular, full long-term independence is a stated destination, and Blake has explicitly confirmed project-specific permissions over the relevant Matterport and XGRIDS materials.

This compilation includes the earlier founder blueprint's wider business and 2041 proposals, which were underrepresented in previous summaries. Their inclusion preserves the ideas; it does not turn scenario planning into a promised delivery date.

## Contents

- PART I — THE COMPANY AND THE PRODUCT
- PART II — THE SHARED MODEL THAT MAKES EVERYTHING CONNECT
- PART III — THE COMPLETE COMMERCIAL AND CLIENT JOURNEY
- PART IV — THE SPATIAL PLANNER AND THE REAL FURNITURE
- PART V — THE CINEMATIC EXPERIENCE
- PART VI — THE GRAND HALL NEURAL DIGITAL SET
- PART VII — OMNITWIN FOUNDRY AND DATA INDEPENDENCE
- PART VIII — INTELLIGENCE, SIMULATION AND EVIDENCE
- PART IX — OPERATIONS, LEARNING AND ECONOMICS
- PART X — SPATIAL COMPUTING AND THE WIDER MOONSHOT
- PART XI — EXPERIENCE, PLATFORM AND DELIVERY STANDARDS
- PART XII — THE RECOVERED TECHNOLOGY AND IDEA REGISTER
- PART XIII — BUILD CONTEXT, SCOPE BOUNDARIES AND HANDOFF

---

# PART I — THE COMPANY AND THE PRODUCT

## 1. The central idea

**Venviewer turns a real venue into a beautiful, intelligent, editable and operational world.**

People should be able to explore it like a real place, arrange it like a design tool, question it like a knowledgeable venue manager, rehearse it like a simulation, buy an event through it, and use the approved plan to run the physical event.

The complete loop is:

**Capture → understand → sell → plan → simulate → review → approve → schedule → operate → reconcile → learn.**

The concise product phrase already used is: **Capture. Plan. Prove. Operate. Learn.** The commercial version starts with **Sell**, because venue teams need bookings and operational value, not merely a sophisticated capture pipeline.

The recurring thesis is: **The venue becomes the interface.** The product is not software with a decorative 3D window attached. Spatial context should make the entire event lifecycle easier to understand and coordinate. The original master scope already described a venue operating system spanning capture, proposals, calendars, simulation, operations and learning. [S01]

## 2. Names and category

**Venviewer** is the venue-facing product name used throughout the project. **OmniTwin** is also used for the wider platform and technical ambition. **OmniTwin Foundry** names the scanner-independent capture, reconstruction and publishing system. **Venue Item Foundry** names the furniture and equipment digitisation system.

Earlier founder work proposed the category **Spatial Event Operating System**, the core object **Spatial Event Contract**, the core capability **Event Compiler**, the traceable history **Event Digital Thread**, and the farthest company-level ambition **Experience Infrastructure**. These are useful complementary concepts, not five brands that must all be marketed simultaneously. Final external naming remains a business decision. [S04]

## 3. The scale of ambition

Blake wants a category-defining company, potentially worth billions, rather than a small floorplan utility or a bespoke one-venue website. That is an ambition, not a forecast.

The desired combination is AAA-game spatial rendering, Hollywood visual storytelling, exceptional Apple-like clarity and interaction polish, Figma-like direct manipulation, Bloomberg-level information seriousness, Jane Street-like operational discipline, luxury hospitality presentation, and leading-laboratory AI capability.

The requirement is not merely to imitate those references. It is to surpass ordinary expectations of how sophisticated, beautiful and effortless venue software can feel. It should impress experienced designers and engineers while remaining understandable to a nontechnical hallkeeper.

The product must be useful even when the cinematic effects are turned off. Equally, operational seriousness must not become an excuse for a dull interface. Beauty, speed, correctness and ease are intended to reinforce one another.

## 4. What this is not

It must not collapse into a Gaussian-splat viewer, a Matterport clone, a generic booking calendar, a basic CRM, a static floorplan tool, an AI room-picture generator, a wedding-only application, or disconnected dashboards.

It must not become an impressive demonstration that venue staff abandon for spreadsheets. It must not require a different unofficial version of the event for sales, clients, suppliers and operations.

Replacing or reducing Cvent-, Salesforce-, Tripleseat-, Event Temple- and diagramming-style workflows is part of the long-term ambition. Integrating with existing systems during adoption is a delivery strategy, not a surrender of that ambition. The earlier founder blueprint recommended proposal-to-operations as the first commercial focus; it did not establish that the wider vision should be deleted. [S04]

## 5. Trades Hall as the founding laboratory

The founding venue is Trades Hall of Glasgow. The principal spaces in the project are Grand Hall, Reception Room, Robert Adam Room, Saloon, Lady Convenor's Room, North Gallery and South Gallery, together with entrances, corridors, stairs, service areas and their connections.

Grand Hall is the visual flagship and reconstruction laboratory. Reception Room is an important existing-asset test case for detail loss, scale, navigation and cutaway behaviour. The other rooms prove that the system is genuinely multi-room rather than a hard-coded Grand Hall demo.

The real architecture must remain accurate. Generated imagery must not silently replace actual façades, layouts, ornament, room relationships or heritage details. A model can be beautiful and still be wrong; that is not an acceptable captured-venue result.

Trades Hall should receive a usable product. Future venues should be configurable deployments rather than separate code forks.

## 6. People and event types

The platform must serve owners and directors, sales/enquiry staff, events managers, planners, reviewers, hallkeepers, duty managers, cleaners, caterers, AV/production teams, suppliers, clients/couples, corporate buyers, capture operators, administrators, and eventually external agencies and venue groups.

Each needs a different surface over shared records. A client needs confidence and choices. Sales needs availability and next actions. A hallkeeper needs an exact current instruction. A director needs commercial and operational visibility. A reviewer needs evidence and scope. A supplier should see only their assignment and permitted spatial information.

Event formats discussed include weddings, ceremonies, receptions, banquet and gala dinners, corporate meetings, conferences, awards, exhibitions, concerts, performances, fashion events, seasonal/Christmas parties, cultural events and other configurable gatherings. Layout patterns include banquet, cabaret, theatre, classroom, boardroom, standing reception, exhibition and combinations over time.

---

# PART II — THE SHARED MODEL THAT MAKES EVERYTHING CONNECT

## 7. The Spatial Event Contract

**Proposed architectural synthesis:** the event's commercial promise and its executable physical plan should be governed together.

A Spatial Event Contract connects the client's brief, selected venue and rooms, dates, guest-count versions, layouts, furniture, packages, prices, assumptions, approvals, event phases, suppliers, staff, operational tasks and actual outcomes.

“Contract” here names a governed product object. It does not mean the data structure automatically replaces a legally executed agreement. Proposal acceptance, signature, payment, room confirmation and operational release remain distinguishable actions.

The event should have a released version that people can rely on, while changes are prepared and reviewed separately. The exact version promised to the client must be traceable to the version staff execute. [S04]

## 8. Five connected graphs

The founder blueprint proposed four connected graphs and a company-level assumption graph:

**Venue Graph:** rooms, connectors, zones, inventory, access, constraints, verified facts, packages and visual layers.

**Event Graph:** intent, participants/roles, selected spaces, phases, layout versions, quotes, commitments, decisions and tasks.

**Change Graph:** revisions, invalidated evidence, affected prices, impacted teams, required acknowledgements and superseded decisions.

**Outcome Graph:** actual timings, issues, deviations, commercial results, feedback and proposed lessons.

**Assumption Graph:** what the company or a feature believes, why, how confident it is, what would disprove it, and who owns the next test.

These describe relationships, not a requirement to use a particular graph database. [S04]

## 9. Event Compiler and Change Impact Engine

The Event Compiler should derive a proposal, quote, room hold, layout, phase plan, BEO, supplier packet, hallkeeper tasks and evidence pack from the same controlled event state.

The Change Impact Engine answers: **“What else changes when this changes?”** If the guest count increases, it should identify affected seating, room fit, inventory, staffing, prices, setup time, routes, supplier requirements, approvals and client commitments.

The system should not quietly overwrite a previously approved promise. It should show the difference, preserve the old release, seek the appropriate decisions, and publish the new one deliberately.

An important demonstration is changing an event from 150 to 180 guests and seeing every affected commercial and operational output update coherently, rather than merely watching more chairs appear. [S04]

## 10. Promise Ledger and Decision/Acknowledgement Graph

**Earlier proposed extensions:** record each client-facing commitment with its source, scope, owner, status, expiry or validity, and supporting evidence. Examples include room exclusivity, access arrangements, equipment, timings, layout promises and service inclusions.

Approvals should attach to exact versions and scopes. Client acceptance, internal planning approval, specialist review and a supplier's acknowledgement are not interchangeable.

The system should show which decision is outstanding, who has authority, when it is needed, what delay affects, and who must acknowledge the resulting change. This is intended to prevent sales promises and operational reality from drifting apart. [S04]

## 11. State must be explicit

The finished model needs distinguishable commercial, booking, planning, release, operational and asset states. Earlier documents listed example stages such as enquiry, tentative hold, proposal sent, confirmed, in planning, ready for operations, live, completed, cancelled and lost. Those are product vocabulary, not a command to put unrelated concerns into one database enum.

Likewise, “captured”, “processed”, “uploaded”, “runtime-loadable”, “reviewed”, “released” and “publicly shareable” are different asset milestones.

An accepted proposal need not mean the deposit is paid. A room on hold need not mean the layout is reviewed. A loaded splat need not mean its scale is verified. A complete setup checklist need not mean every specialist sign-off is complete.

---

# PART III — THE COMPLETE COMMERCIAL AND CLIENT JOURNEY

## 12. Buying Venviewer and onboarding a venue

The experience begins when a venue chooses to buy, trial or commission the platform. The full scope includes product/package selection, organisational setup, subscription or invoice arrangements, entitlements, staff invitations, roles, venue creation, deployment ownership, onboarding progress and support.

Onboarding collects rooms, operating hours, floor plans, captures, photographs, inventory, packages, prices, suppliers, operational rules, review policies, existing templates, branding and relevant integrations.

Both assisted premium deployment and increasingly self-service onboarding belong in the vision. A venue should become useful before its most elaborate digital twin is complete: reviewed 2D plans, photographs and simple geometry can precede the full neural scene. This staged fidelity is a rollout option, not the ceiling for Grand Hall.

Migration and offboarding matter too: import existing records where supported, preserve identifiers and history, export customer records and assets, and avoid making customers prisoners of Venviewer. [S04]

## 13. Public website and venue discovery

The website should make the real venue memorable and help prospective clients understand possibilities without a lengthy sales call.

Surfaces include venue and room showcases, room comparison, event-type pages, galleries, true-to-life walkthroughs, curated layouts, enquiry forms, viewing requests, package explanations and client-safe availability indications.

The proposed public narrative is a living product surface: a real room resolves, an event brief becomes a layout, movement can be explored, a proposal is prepared and the operational handoff becomes visible. Progressive revelation should explain one useful idea at a time.

The failed before/after direction must not return: an AI-generated “after photograph” cannot masquerade as an accurate photograph of Trades Hall. Real images, actual captured assets, honest procedural previews and clearly labelled concepts have different roles.

Public visitors must never receive private supplier routes, internal issues, confidential client data or unrestricted back-of-house spatial access merely because those exist in the same scene.

## 14. Visual enquiry and concierge sales intake

A client should start from a room, event type, guest count and preferences rather than an intimidating blank form. A sketch or layout they create should become part of the enquiry instead of being discarded.

The brief can include preferred dates, alternative dates, budget, desired rooms, event phases, package interest, catering, AV, access needs, service requests, attachments and notes. Intake may also be assisted for phone, email or in-person conversations.

The staff-facing result is a structured spatial brief with a clear next action, not simply “new lead received”. Source attribution, duplicate handling, routing, ownership and response reminders belong in the commercial scope.

Personal service remains important: the software should make it easier for a named coordinator to respond intelligently, not replace hospitality with anonymous automation. These intake and service requirements were part of the earlier commercial research. [S06]

## 15. CRM and sales pipeline

The finished venue-native CRM includes accounts, contacts, enquiries, leads, opportunities, activities, notes, follow-up tasks, interaction history, tours/viewings, owners, stages, expected value, forecast, won/lost reasons and repeat-client history.

A salesperson should move from enquiry to room availability, layout and proposal without re-entering the brief. The client record should preserve useful preferences and previous event context while respecting permissions.

A calm pipeline surface should expose stalled enquiries, promises due, unanswered changes, expiring holds and the best next action. Management should see conversion and response performance, not just activity counts.

Long-term replacement of external CRM workflows is part of the ambition. Integration-first deployment remains an option for venues already dependent on another system.

## 16. Room calendar, diary and scheduling command centre

The calendar is a core operating surface, not an embedded generic calendar.

The intended views are multi-room timeline, day operations, week, month, availability search, event drawer and a simplified mobile duty-manager view. Rooms occupy lanes. Blocks show confirmed bookings, pencilled holds, setup, live time, teardown, cleaning, room flips, tours, maintenance and supplier access.

Specific visual ideas include translucent/sketched holds versus solid confirmed bookings, hold-expiry countdowns, a current-time line, an unplaced-enquiry tray, conflict cues and utilisation summaries.

The event drawer links client, opportunity, proposal, quote, room bookings, guest count, phases, layout, reviews, supplier notes, tasks and next action.

The system should detect shared-resource conflicts as well as room overlaps: the same furniture, staff, equipment, access route or service resource may be needed by multiple events. Multi-room events must remain one coordinated event rather than unrelated calendar blocks. [S01]

## 17. Feasible Offer Engine and Capacity Envelopes

**Earlier proposed extensions:** availability should answer **“What can we actually offer?”**, not only **“Which square on the calendar is empty?”**

The Feasible Offer Engine combines rooms, dates, event type, guest count, setup/teardown windows, furniture, staff, services, access, pricing and missing information to propose feasible alternatives.

Capacity Envelopes replace one misleading universal capacity number with contextual planning guidance: event type, layout, comfort objective, service style and event phase all matter. “Comfortable”, “energetic” and “maximum planning guidance” were proposed presentation categories, not certified limits.

A useful request is: “Find three dates for a 160-guest dinner with dancing and a separate arrival room.” The result should explain compromises and outstanding checks. [S04]

## 18. Living proposals and exact quotes

The proposal should be a secure, branded, interactive event experience: room, layout, guest count, date, phases, package, inclusions, exclusions, options, price and assumptions belong together.

Staff need versioning, curated variants, quote lines, packages, optional upgrades, discounts, taxes/service charges, deposits, schedules, internal approvals, client preview, secure sharing and PDF fallback.

The quote must respond to meaningful plan changes without silently altering an already accepted version. Internal cost, sell price, margin and client-visible total are separate concerns.

A client can compare ceremony, dinner and evening layouts, inspect meaningful views, comment on a specific item or location and request changes. Proposal analytics can record useful milestones such as sent, viewed, responded and accepted without manipulative tracking design.

The ambition is a luxury concierge proposal, not a spreadsheet wrapped around a screenshot. [S06]

## 19. Contract, payment and client workspace

The full scope includes contractual document generation, versioned terms, signatory authority, e-signature integration, deposits, instalments, payment status, receipts, cancellation/refund workflows and finance handoff. These are desired workflows, not a claim that payment or signature integrations are already complete.

The client portal should carry the ongoing event: approved plans, comments, outstanding decisions, timelines, guest-count updates, documents, package choices and payment milestones.

Guest lists, table/seat assignments, dietary information, menu/service selections and accessibility requests appeared in the commercial research. They should be permissioned and linked to the relevant event version and departmental outputs. Full standalone ticketing, registration, attendee apps and check-in are broader possibilities under the replacement ambition, but their detailed specification was not established in the recovered core brief; preserve them as explicit scope decisions, not invented finished modules. [S06]

## 20. Collaboration without disconnected message chains

Comments and requests should attach to rooms, planner objects, proposal lines, phases, tasks or versions. The context should travel with the conversation.

Clients, staff and suppliers need different permissions and levels of detail. Presence, review sessions, acknowledgements, notifications and version history should make collaboration understandable without exposing every internal discussion to everyone.

The product should consolidate the meaning of messages into the event record. Email, calendar and team-messaging integrations may remain useful, but they must not silently become conflicting sources of the latest approved plan.

---

# PART IV — THE SPATIAL PLANNER AND THE REAL FURNITURE

## 21. The editor

The planner must support an empty room, saved configurations, reference loadouts and event-specific starting layouts. Its core is direct manipulation in linked 2D and 3D views.

Required actions include placing, moving, rotating, duplicating, grouping, removing, aligning and snapping objects; numeric inspection; measuring; drawing guides; annotations; table and seat labels; saved camera positions; selection; undo/redo; autosave; version history; variant comparison; screenshots; print/export; and client-safe viewing.

Objects include tables, chairs, stages, lecterns, bars, dance floors, screens, AV, signage, décor, flowers and accessories. Grouped families such as a table with chairs and settings should behave coherently.

Room layers include floors, walls, ceilings, doors, windows, fixed obstacles, service areas, no-placement regions, power/AV points, heritage exclusions and reviewed planning boundaries. Top-down, first-person, orbit, dollhouse and cutaway views should share the same layout state. [S01]

## 22. AI layout generation and optimisation

The user should be able to describe an event and receive useful, editable alternatives: “Create a wedding dinner for 180 people, with a stage, dance floor, good sightlines and comfortable service routes.”

“Best” must mean best for explicit objectives, not a mysterious AI verdict. Possible objectives discussed include fit, comfort, circulation, sightlines, aesthetics, service access, inventory, setup effort, room-flip time, staffing and commercial value.

The system should explain why it placed anchor objects, what constraints ruled out alternatives, and which trade-offs distinguish candidates. It should also detect when no proposal satisfies the brief and ask for the smallest useful change.

Language-model assistance, geometry, optimisation and human decisions have different roles. AI proposes; deterministic checks evaluate specified constraints; reviewers authorise consequential releases. The exact solver is an engineering decision, not an established commitment to one algorithm.

## 23. Real venue furniture, not generic substitutes

A central requirement is to use the hall's actual chairs, tables and equipment. Clients and hallkeepers should recognise what they will receive.

The target movable asset is a textured, animatable mesh, usually packaged for the runtime as GLB or an equivalent supported format. “Image-to-3D” is the broad workflow category; it is not an alternative to mesh output. For this product, the useful question is how to obtain the best faithful mesh and its operational data.

The discussed priority is manufacturer geometry where available, careful multi-view capture, reconstruction, artistic cleanup and material finishing; AI can accelerate drafts or complete unobserved regions, with those contributions recorded.

One excellent representative chair can become hundreds of efficiently rendered instances. The quality test is not only a beautiful isolated model: a room full of copies must load, select, animate, cast plausible shadows and occupy the correct measured footprint.

## 24. Venue Item Foundry

The proposed staff experience is **Add a real venue item**. The app guides capture, accepts manufacturer files or existing scans, suggests reconstruction, asks for scale evidence, shows the result for review and publishes the approved item to the venue catalogue.

Inputs can include photographs, video, manufacturer CAD/mesh files, isolated object scans, E57 crops, partial point clouds and splat crops. Capture guidance should cover front, back, sides, above and below rather than pretending one picture proves hidden geometry.

Each item package should separate source evidence, detailed visual mesh, measured planning proxy, collision, floor footprint, materials, textures, runtime detail levels, thumbnails, origin/orientation, snap points and provenance.

The operational record adds quantity, storage location, availability, seat count where applicable, stacking/handling information, setup and breakdown assumptions, staff requirement, accessories, hire price and replacement information. Future supplier components should carry the same structure.

A visual mesh generated by AI does not automatically establish exact dimensions. A bounding box alone may also be too crude for some planning checks; the appropriate footprint and clearance envelope must be reviewed.

## 25. Furniture production and accessories

The production methods discussed include photogrammetry in Epic RealityCapture/RealityScan or Agisoft Metashape; Blender or ZBrush cleanup and retopology; Substance-style material finishing and high-to-low baking; and AI-assisted candidates such as TRELLIS, Rodin, Meshy, SAM 3D Objects and Axolotl3D.

These names are a historical candidate register, not a newly verified ranking or licensing decision. The intended outcome matters more than keeping one vendor.

Table structures, linens, covers, settings, flowers and lighting décor should be separable when they need independent variation. Material variants should match the real item rather than create imaginary inventory. Complex folding or modular equipment may need meaningful component hierarchies for animation and handling.

High-resolution source assets remain archived; web/mobile versions can use simpler geometry and baked detail. Correct pivots, scale, orientation, grouping and instancing are part of asset quality, not merely rendering housekeeping.

## 26. Inventory and resource scheduling

The catalogue must connect to actual availability. The same chair cannot be promised to two simultaneous events simply because both layouts look good.

The scope includes reservations, cross-event conflicts, own versus hired stock, accessories, room or storage locations, handling, setup counts, damaged/unavailable items, and pick-list generation. Proposed later network work adds custody, condition, inter-property sharing, reuse, energy/waste information and supplier fulfilment.

A layout change should update the relevant inventory requirement and operational instructions. Operational assumptions such as staff required to move a stage need sources and review, not arbitrary AI guesses.

## 27. Event Phase Graph and Room Flip Optimiser

An event is a sequence of spatial states, not a single arrangement. Typical phases include arrival, ceremony, transition/room flip, dinner, speeches, bar activity, dancing and breakdown.

Each phase can specify rooms, times, guest count, furniture state, staff, suppliers, routes, reviews, tasks and lighting presentation. Shared resources and connectors can be occupied during the transition, not just during the event itself.

The proposed Room Flip Optimiser should account for people, furniture, staging space, storage, access routes, task dependencies and critical path. The product should answer not only “Does dinner fit?” but “Can the team turn the ceremony into dinner in the available interval?”

The theatrical motion in Grand Assembly and the actual operational movement plan are related but not identical. A magical reveal must never be mistaken for a proved physical setup sequence. [S01] [S04]

---

# PART V — THE CINEMATIC EXPERIENCE

## 28. The Room Resolves

This is the venue-loading idea: blueprint lines establish architectural form, actual captured chunks develop as they become available, and the blueprint recedes as real data arrives.

It should use real loading state, preserve honest missing/failed regions and never play a fabricated progress movie. The room should remain navigable or inspectable to the extent its available data supports.

The July 12 session report records a state-driven implementation with architectural ink, chunk-arrival handling, failure settlement, reduced motion and tests. That is dated implementation evidence, not a fresh claim about the present branch. [S09]

## 29. Grand Assembly Mode

This is the Hollywood-like, magical event-conjuring experience Blake explicitly wants. It is not a one-off loading effect and not a video laid over a planner.

It has five related forms:

**Live Assembly:** fast local choreography when manually placing or changing furniture. A footprint can trace, a table resolves or glides into place, chairs arrange around it and guides settle. The user must not wait to keep working.

**Layout Recall:** a saved arrangement assembles as though the venue remembers the event. Stored object identities, groups and positions determine the result.

**Grand Assembly:** an explicit full reveal of an AI recommendation, chosen template or complete layout. Constraints establish the usable space; anchor objects set the composition; tables arrive in waves; chairs arrange; décor resolves; routes and appropriate information appear; the camera completes a reveal.

**Transformation Assembly:** versions or event phases transition through their actual differences. Unchanged objects remain, moved objects travel, new ones arrive, removed ones leave and relevant styling changes transform in place.

**Director's Cut:** a presentation version with authored camera work, lighting states, original audio, room-to-room storytelling and export-oriented playback.

The key phrase is: **The user does not populate the venue. They conduct it.**

## 30. What makes the magic polished

Animation must be generated from canonical planner state through a deterministic layout diff and choreography graph. Intermediate transforms are presentation state, not saved furniture positions.

Object families need different motion grammars: tables carry weight, chairs assemble coherently, stage modules establish structure, settings reveal rhythmically and routes trace with precision. Spectacle should come from composition, timing and believable movement rather than constant particles.

The system needs an Assembly Director, object-transition registry, motion paths, camera cues, optional audio cues, quality tiers and a tuning laboratory. Identical source/target/version/seed should support repeatable playback and testing.

Skip, cancellation, changing layouts, undo, route changes and direct user intervention must settle to the correct current target without lost objects, duplicate instances or corrupt history. Routine editing never hijacks the camera. Reduced motion must retain full functionality.

The proposed timing ranges are starting design targets, not measured guarantees: sub-second local actions; a few seconds for recall; a longer explicit full reveal; and a presentation-length Director's Cut.

## 31. The combined cinematic story

The desired sequence is: blueprint architecture appears; the real hall resolves; the selected event assembles; light and atmosphere establish the mood; movement can be rehearsed; evidence explains the result; operational instructions become available.

The room remains the hero. The interface should never obscure architecture with gratuitous effects. The experience must work without audio and allow all theatrical elements to be skipped.

Cinematic camera paths, saved viewpoints, visual phase comparisons, spatial ambience, optional music, close-up heritage details and client-specific proposal films all belong in the ambition. No protected franchise music or imagery is required to achieve the magical feeling.

---

# PART VI — THE GRAND HALL NEURAL DIGITAL SET

## 32. A compositor, not one giant splat

The final Grand Hall should combine multiple registered representations: structural authority; captured appearance; reconstructed inference; high-detail local features; materials and lighting; semantic information; planner objects; generated cinematic variants; and device-specific delivery assets.

The master may be computationally expensive. The browser receives a suitable derivative or supported representation. The conversion between them is itself a quality gate, not a promise that every research representation can be losslessly exported to SPZ.

The physical planning layer must survive a change of renderer, splat codec or reconstruction provider. The visual layer must be able to improve without changing approved room dimensions. [S10]

## 33. Structural authority, navigation and cutaway

The structural model includes a reviewed coordinate frame, scale, floors, walls, ceiling, openings, stairs, room bounds, connectivity, collision and planning regions.

First-person exploration needs a safe spawn, meaningful eye height and field of view, floor following, collision, controlled movement and valid doorway transitions. Orbit and dollhouse modes need different camera logic. The original Reception Room failures—oversized-feeling camera, easy escape, missing cutaway—must not be treated as texture problems.

Cutaway requires coordinated treatment of the visible appearance as well as the shell. Fading an invisible proxy alone does not remove a roof contained in the splat. Room-aware clipping or compositing must preserve the far-side interior while exposing the chosen view.

Collision derived from a splat can be a useful candidate, but its source and uncertainty must be distinct from measured structural geometry. Top-down planner visibility also does not manufacture observations of chandelier tops or furniture undersides that were never captured.

## 34. The source-to-screen quality investigation

The project must be able to compare the same camera views across native LCC, highest-quality export, compressed variants, an independent viewer and Venviewer.

That separates capture limits, camera-registration errors, reconstruction limits, export/compression losses and runtime/rendering losses. Diagnostics should record source hashes, transforms, camera parameters, render resolution, settings, representation, compression generation and visual/performance results.

A file becoming larger after conversion is not evidence of recovered detail. More Gaussians alone do not prove better quality. A sharp render from a different viewpoint is not a controlled comparison.

The purpose is to preserve information already present before inventing new information. This diagnostic was explicitly established in the independence strategy. [S08]

## 35. Capture the hall like a VFX set

The maximum-quality capture ambition combines full-room imagery, geometry, multiple camera heights, close hero passes, controlled exposure and colour, HDR lighting references and separate empty/dressed states.

Chandeliers, paintings, gilding, carvings, timber and ceiling details should receive more useful photographic sampling than a plain wall. Reflections, glass, dark surfaces, windows and moving people need explicit handling rather than a generic “scan everything” pass.

Cross-polarised material capture, grey/colour references, environment-light references, longer-lens details and properly planned elevated views were among the proposed high-end techniques. Their use should follow the real surface and permitted capture conditions, not a rigid image-count recipe.

Where new capture is unavailable, the pipeline must still investigate the best use of the existing rendered splats, photographs, panoramas, meshes, E57 and retained raw projects. New photography is a quality opportunity, not a reason to discard existing work. [S10]

## 36. Captured reconstruction and Neural Harmonic Textures

The intended research programme compares vendor reconstruction with owned reconstruction and refinement, using common images, cameras, scale and evaluation views.

Candidates already discussed include gsplat/Splatfacto, 3DGUT/3DGRUT, MCMC densification, depth/normal supervision, antialiased rendering, exposure/appearance correction and alternative density-control methods.

**Neural Harmonic Textures (NHT)** became a headline candidate because the research was directed at richer high-frequency and view-dependent appearance, rather than merely adding more primitives. The proposed headline experiment is 3DGUT with conventional spherical harmonics versus 3DGUT with NHT under comparable conditions.

NHT is a candidate master, not an established Grand Hall winner or an assumed drop-in browser format. The delivery path must demonstrate that the visual advantage survives reconstruction, adaptation and runtime presentation. [S10]

## 37. Hero Volumes and local updates

A Hero Volume is a separately captured/reconstructed high-detail region with bounds, source observations, cameras, transform, quality evidence, optional materials and runtime variants.

It could preserve a chandelier, important artwork, moulding, carving or fireplace at far higher fidelity than a uniform room representation. Normal viewing uses the base room; closer viewing uses the local specialist when appropriate.

The hard parts are registration, lighting consistency, seams, duplicate surfaces, transition behaviour, memory and the treatment of already-baked room content. The scope includes solving and testing these, not simply stacking two splats and assuming a seamless result.

Incremental photo fusion and local refinement should also let the venue improve one weak area or update one changed object without rebuilding the entire building. [S10]

## 38. Materials, relighting and inserted-object coherence

The long-term hall should move beyond replaying baked appearance. The ambition is to represent enough geometry, material response and illumination to make new furniture and lighting belong convincingly in the room.

Desired fields include normals, albedo, roughness, reflectivity, glass masks, light-source metadata, environment lighting and potentially neural material representations.

The vision: a stage light appears; the floor receives illumination; timber and gilding respond differently; the chandelier picks up highlights; inserted tables cast plausible shadows; the captured room and planner assets read as one place.

Two distinct paths must remain clear. Physically based/inverse-rendered lighting seeks coherent material/light behaviour. Generative relighting creates plausible visual variants. Neither should be advertised as calibrated lighting-engineering evidence without the corresponding measurement and validation work.

Daylight, warm evening, chandeliers-only, gala, ceremony, speeches, dancing and working-light states can become event-phase presentation options. [S10]

## 39. Repair, super-resolution and generated cinematic beauty

The project explicitly welcomes research-grade generative enhancement, including systems that render weak views, repair them with a neural model and refine a 3D representation from the result.

ArtiFixer/ArtiFixer3D/ArtiFixer3D+, Difix3D+, Fixer and GSFixer were discussed for repair and novel-view completion. Gaussian super-resolution, extreme zoom and GR3EN-style relighting provide other routes.

The intended states are captured mode, enhanced/reconstructed mode with source lineage, generated cinematic mode and concept/imagination mode. Generated details can be useful and beautiful without being claimed as observed history.

A generated rear surface, painting detail, inscription or ornament must not silently become factual evidence. The source master remains intact; generated variants retain model/version, conditions, seed where available, lineage and region information when known. Unknown contribution masks must be recorded as unknown rather than fabricated.

## 40. Beauty Benchmark and delivery tiers

Quality means more than pixel metrics. The desired benchmark covers held-out image fidelity, fine-detail preservation, thin structures, identity of the real room, temporal stability, floaters, edge tearing, transitions, colour, lighting consistency, load time, frame time, memory and usability.

It should include stable room-wide and close-up cameras, difficult oblique views, high/low viewpoints, navigation paths, side-by-side comparisons and human judgement.

Ultra, High, Standard/Balanced, Mobile and presentation profiles are proposed. Degradation should reduce detail and spectacle, not corrupt dimensions, event state or review status. The maximum-quality master is preserved independently of today's web delivery constraints.

The existing performance target discussion includes 60-fps-class presentation where supported and graceful lower-tier operation; these are acceptance targets to measure on specified hardware, not universal promises.

---

# PART VII — OMNITWIN FOUNDRY AND DATA INDEPENDENCE

## 41. The Foundry's complete mission

**Drop in everything you have; the system identifies it, aligns it, shows what is missing, builds the best supported venue representation and publishes it.**

Inputs discussed span E57, LAS/LAZ, ordinary and Gaussian PLY, XGRIDS raw projects, LCC/LCC2, SPZ/SOG, photographs, RAW stills, panoramas, cubefaces, video, RGB-D, phone LiDAR, camera trajectories, IMU/GNSS/RTK, calibration, control points, meshes, floorplans, CAD/BIM and OpenUSD.

The Foundry should detect formats and roles, inventory and hash files, preserve source evidence, identify calibration and coordinates, choose an appropriate processing graph, align data, segment rooms, reconstruct geometry and appearance, identify weak regions, support review, generate derivatives and publish room packages.

It is more than a converter, a trainer wrapper or a desktop front end to proprietary Windows processing. It is intended to become the owned venue-reconstruction system.

## 42. The E57 and multi-room programme

The whole-building Matterport capture must become reusable per-room data without losing the relationships between rooms.

The earlier intended work included inspecting/converting the large E57, preserving scan poses and images where present, generating manageable multi-resolution derivatives, isolating rooms, aligning photo/COLMAP reconstructions, projecting valid depth supervision, and building planning/collision/cutaway candidates.

Room crops must preserve the master frame or carry explicit invertible local-to-venue transforms. Doors, galleries, stairs and corridors must still connect. Floorplan polygons, roof-removed viewing geometry and full structural geometry have different purposes.

A future high-RAM processing run should produce durable, tested assets and metadata that can be used later on ordinary machines, not just a screenshot proving a huge file opened.

The earlier rental expired before the extra E57 work was performed. Do not mark that proposed programme complete. The latest user update says rendered splat outputs are available; exact room-by-room files and quality still require inventory.

## 43. Cross-platform, provider-independent processing

The operator application should work across Windows, macOS and Linux where feasible, with heavy processing separated from the interface. It may use a local service, desktop shell, browser UI, remote workers or a combination selected by engineering evidence.

Processing jobs should declare RAM, GPU/VRAM, disk, software, inputs, outputs and checkpoints. They should support progress, cancellation, retry, recovery and clear errors. Local workstations, rented GPUs and private/cloud clusters should be interchangeable execution options where their capabilities permit.

High system RAM and GPU memory are different requirements. The Grand Hall's historical LCC estimate of around 165 GB was one workload estimate, not a universal requirement for every visual method.

Outputs must be copied and verified to durable storage before a temporary machine disappears. Provider portability, reproducibility, logs, hashes and checkpointed work are product requirements, not optional engineering polish.

## 44. Beginner and expert experience

A nontechnical operator should not need to know COLMAP, ICP, camera matrices, Docker, CUDA, spherical harmonics or object-storage keys.

Beginner mode should explain what was recognised, what can be produced, what is uncertain, which optional outputs are useful, and the one next action needed. It must not invent menu items, hide a failed stage or use reassuring progress that is disconnected from actual work.

Expert mode should expose calibration, frames, source images, transforms, camera models, masks, control points, quality profiles, registration residuals, training parameters, resource usage, derivative lineage and versioned publishing.

This matters particularly because Blake repeatedly needed genuinely step-by-step instructions, not technically plausible instructions based on an imagined vendor interface.

## 45. Active recapture and maintaining the twin

The long-term system should identify blur, inadequate overlap, weak angle diversity, missing surfaces, inconsistent lighting, alignment disagreement, reflective failures and visually important under-sampled areas.

It should then prescribe useful capture actions: where to stand, camera direction/height, subject, lighting state, framing and expected benefit. A missing chandelier top calls for an appropriate observation, not a claim that ground-level data already proves it.

After venue changes, the same system should identify stale facts and local update needs. Capture dates, zone-specific validity, new inventory, seasonal dressing and renovations should trigger review or delta capture rather than allowing an old twin to remain silently authoritative.

Active recapture and freshness form the bridge between a one-off impressive scan and a maintainable venue product. [S10]

## 46. Full independence and confirmed authority

Blake explicitly wants full long-term independence from compulsory XGRIDS Premium features, vendor viewers, proprietary raw processing and Windows-only application dependency. Existing vendor tools may remain useful bridges or competing providers; they should not define the platform.

Separate retrospective recovery of existing PortalCam projects from prospective open capture. Technical access to frames, timestamps, intrinsics, extrinsics, poses, LiDAR and calibration remains a factual engineering question even when permission is granted.

Blake has explicitly stated full project-specific authority covering Matterport/XGRIDS data use, reconstruction, training, enhancement and commercial derivatives, and additionally authorisation to reverse-engineer LCC Studio, bypass relevant encryption/access controls, copy relevant proprietary code and redistribute relevant SDK components.

Record this as **owner-stated project authority**, with a durable place for supporting documents. Do not silently downgrade it into “permission is unknown”, and do not imply a new LLM has independently inspected the paperwork. The scope is the authorised project materials, not unrelated systems. Third-party research code and model-weight terms remain separate.

The strategic formula is: **hybrid representations; optional vendors; an owned canonical scene and processing system.** [S12]

---

# PART VIII — INTELLIGENCE, SIMULATION AND EVIDENCE

## 47. Venue-specific spatial intelligence

The initial “world model” ambition is a venue-specific understanding of rooms, connections, furniture, quantities, doors, access, power, AV, kitchens, bars, toilets, lifts, stairs, natural light, views, acoustic zones, rules, packages, historical layouts and operational constraints.

The scene should answer contextual questions: What will guests see from the entrance? Where can the bar go? Which layout preserves sightlines? Which rooms are underused? What changes between ceremony and dinner? Which supplier needs this access route?

The knowledge should be linked to objects and spatial regions, not isolated chat text. Every answer involving a venue fact should carry a source, freshness and scope where relevant.

A general foundation model trained from scratch is a frontier option, not a prerequisite for a useful venue-specific intelligence layer.

## 48. Guest Flow Replay

The vision is a browser-visible, replayable simulation of guest and staff movement grounded in geometry and event phases.

Inputs include floors, obstacles, furniture footprints, doors, stairs/lifts, room connections, arrival patterns, guest/staff counts, service points, queue zones, keep-clear regions, permissions and assumptions.

Outputs include trajectories, ghost agents, flow trails, density maps, queue estimates, bottlenecks, route conflicts, staff interference and phase comparisons. Heatmaps should describe space and time meaningfully rather than changing their analytical meaning with camera zoom.

Earlier research proposed a fixed-step, seeded, semantic agent system with separate geometry, routing, local motion, queue and connector logic. Multiple runs can explore uncertainty. A deterministic replay is a reproducible scenario, not a guarantee that real humans behave identically. [S07]

## 49. Animated guests, staff and rehearsal

The visual crowd should eventually feel alive: walking, turning, sitting, milling, serving, queueing and transitioning between phases. Natural motion-generation research such as MotionBricks was discussed as an animation layer.

Behaviour and appearance must remain separate. Attractive motion does not calculate reliable queue times, and a world-model video does not substitute for a geometry-aware simulation.

The proposed Counterfactual Rehearsal Lab extends this into questions such as: What happens if the bar opens late? A room becomes unavailable? Arrival concentrates into twenty minutes? A lift is unavailable? The dinner-to-dancing transition has fewer staff?

Scenarios should state their assumptions, show uncertainty and offer alternatives. The system is operational decision support, not automatic evacuation or safety certification. [S04]

## 50. AI assistant and progressive autonomy

AI should assist enquiry summarisation, brief extraction, qualification, venue search, date suggestions, layout alternatives, proposal drafts, supplier instructions, conflict explanations, venue knowledge search and post-event synthesis.

The near-term policy discussed is draft/review for consequential outputs. The founder frontier extends this to an **Authority-Aware Event Agent**: suggest, simulate, request precise authority, execute a bounded permitted action, verify, and roll back or escalate.

This is a permissioned autonomy ladder, not approval for an LLM to change bookings, send offers, charge clients or direct staff merely because an API exists. Authority, scope, tool inputs, resulting changes and receipts should be auditable.

The research style should remain ambitious and adversarial: multiple approaches, falsifying tests, measurable artifacts, source verification and explicit unresolved gaps. [S04]

## 51. Truth Mode and the Evidence OS

Truth Mode answers what a user is looking at, where it came from, whether it is measured/captured/reconstructed/simulated/generated, what assumptions it uses, what changed, and what still needs review.

It should be selection-aware. A table reveals its catalogue and placement evidence; a route reveals geometry and assumptions; a splat reveals source and processing lineage; a heatmap reveals scenario parameters; a proposal reveals the approved commercial/layout version.

Evidence packs attach to immutable snapshots. Relevant changes make dependent checks and approvals stale. A signed file proves its integrity or approval history within a defined scope; it does not prove the building has not changed or that an event is safe.

The proposed Evidence OS adds authority, validity, reviewer scope, expiry, permitted audience, auditability and release gates throughout the product. “One shared plan” must not erase genuinely different sources of authority or unresolved disagreements. [S04]

## 52. Provenance vocabulary and claims

The useful distinctions are measured observations, reviewed structural inference, captured imagery, reconstructed appearance, enhanced appearance supported by sources, generative contributions, procedural planner state and simulated behaviour.

These need not be one mutually exclusive enum: a photo-refined asset can contain generated supervision, and a simulation can be based on measured geometry. The model must preserve those facts rather than laundering them into a “truth” badge.

Important status vocabulary includes current, stale, partial, missing, unverified, machine checked, human reviewed, released and source-linked. Examples such as “Runtime asset loaded, not yet verified/signed” were used to prevent overclaiming.

The standing intent is to avoid unsupported assertions of safety, compliance, accuracy or production readiness. Earlier documents contained overly broad forbidden-word lists; the important principle is evidence-backed wording, not banning an otherwise accurate descriptive word forever.

---

# PART IX — OPERATIONS, LEARNING AND ECONOMICS

## 53. Ops Compiler and departmental handoff

An approved plan should compile into a BEO/event order, furniture pick list, setup sequence, staff tasks, supplier instructions, kitchen/service notes, AV placement, floristry zones, signage/power information, room-flip plan, breakdown and a clear change summary.

No team should have to retype the proposal into its own spreadsheet to discover what was promised. Each gets the appropriate view of the released event.

Instructions need roles, owners, dates/times, locations, dependencies and acknowledgement where appropriate. Counts should derive from the actual furniture/accessory plan. A print pack and a mobile view should agree on their revision identity.

The BEO is one output of the shared model, not another independent truth that must be reconciled by hand. [S06]

## 54. Hallkeeper and duty-manager experience

The operational surface must be designed for someone under time pressure, perhaps on a phone with poor reception. Large touch targets, readable text, short instructions, conspicuous current version, visible next action and offline resilience matter more than cinematic complexity.

The previously described duty-manager vocabulary includes CLEAN, SET, LIVE and FLIPPING. The day sheet needs timings, room arrangements, furniture counts, supplier arrivals, contacts, issues and what changed since the previous release.

The hallkeeper should be able to acknowledge work, report missing or damaged items, attach evidence, flag an ambiguity and escalate it without navigating through the sales interface.

Offline completion and later reconciliation should preserve authorship and avoid silently overwriting someone else's update. Printable A4 run sheets and familiar day-sheet layouts remain useful alongside the digital experience.

## 55. Supplier, catering and production coordination

The full scope includes supplier directories, categories, preferred providers, requests for quotes, quote comparison, assignment, document exchange, load-in windows, setup zones, delivery routes, responsible contacts and acknowledgements.

A supplier should receive a scoped portal or link showing only their event responsibilities. The long-term spatial collaboration idea allows suppliers to place their proposed stage, AV, bar or floral setup in the shared plan for review.

Catering and production requirements should remain connected to guest count, menu/service choices, dietary/access notes, power/AV requirements, timings and the physical arrangement. Client-sensitive information must not become visible to every supplier by default. [S06]

## 56. Live Event Rescue and reality reconciliation

**Earlier proposed extensions:** Rapid Reality Check lets staff re-verify critical venue facts with a timestamped phone workflow. Plan-to-Reality Setup QA compares a camera view or scan to the released layout and proposes missing or misplaced items for human confirmation.

Live Reality Reconciliation connects confirmed differences back to the event model. A moved obstacle, unavailable room or failed piece of equipment should affect the correct downstream instructions.

Live Event Rescue, also called the Disruption & Recovery Compiler in the frontier work, ranks fallbacks when weather, delay, supplier failure or room outage disrupts the plan. Approved contingencies can be recompiled into phases, tasks and targeted communications.

These are not claims that computer vision already recognises every chair or that an AI should autonomously reroute guests. They are substantial proposed product tracks. [S04]

## 57. Event Memory and post-event learning

After an event, the system should compare planned and actual timings, setup effort, guest counts, supplier performance, issues, late changes, costs, revenue, layout results and feedback.

Event Memory answers: “When did a dinner like this last work?” It retrieves relevant layouts, actual timings, known complications and source-linked lessons rather than offering generic AI advice.

Learning should propose template, staffing, turnaround, pricing or capture updates. It should not silently change rules or promote unverified correlations into authority.

Cross-venue learning was proposed as opt-in and privacy-conscious. Local baselines matter; successful arrangements in one venue may not transfer to another. Contradictory outcomes, missing actuals and staff workarounds are valuable evidence rather than inconvenient noise. [S04]

## 58. Revenue and executive intelligence

The management view should link demand, response time, pipeline, proposal conversion, holds, confirmed revenue, room utilisation, dark dates, packages, upsells, costs, margins, event readiness and operational friction.

Revenue scenarios should preserve defined comfort and operational constraints. The system should not maximise furniture count or income regardless of consequences.

Useful questions include: Which rooms are underused? Which layouts convert? Which packages create rework? How long do flips actually take? Where do proposals stall? Which staffing assumptions repeatedly fail?

The founder blueprint proposed **Trusted Events Run** as a north-star candidate: events delivered from the same released commercial/spatial/operational record without critical version or handoff failure. This complements, rather than replaces, the visual ambition. [S04]

---

# PART X — SPATIAL COMPUTING AND THE WIDER MOONSHOT

## 59. VR, AR and real-world alignment

The ambition includes premium headset presentations, desktop/web exploration, tablet/mobile access and on-site spatial overlays. Varjo, Apple Vision Pro and Quest were discussed as possible experience tiers, not mandatory dependencies or a current procurement recommendation.

AR should eventually align a phone or headset with the physical venue so a user can stand in the hall and see the planned event overlaid at the correct position and scale.

Potential uses include setup guidance, furniture placement, walking an access route, checking sightlines, wayfinding, supplier zones and live spatial notes. Reliable relocalisation, coordinate alignment, drift handling and a non-AR fallback are required parts of that ambition.

Niantic/VPS-style localisation, Scaniverse-style capture and open XR approaches were discussed as candidate directions. Do not turn a vendor demonstration into a claim that on-site precision is already achieved.

## 60. Accessibility Journey Twin

**Earlier proposed extension:** model the whole guest journey, not only a wheelchair symbol next to a doorway.

This includes step-free routes, relevant widths and thresholds, seating, toilets, quiet areas, service interactions, arrival and movement between event phases. Requirements can vary by person; private accommodation requests should be handled respectfully.

Accessibility information should distinguish measured features, reviewed guidance and unknowns. The product needs full keyboard, screen-reader, touch, reduced-motion and non-3D paths as well as visually impressive spatial modes.

A route preview must not become a blanket guarantee that the venue meets every person's needs. [S04]

## 61. Event DNA Passport and planner workspace

**Earlier proposed extension:** a reusable, selectively shared event brief that agencies, touring productions and corporate organisers can take across venues.

The passport preserves intent, guests, phases, service needs, equipment, preferences and decisions. Different venues test that same intent against their own geometry, availability, inventory, access and operating constraints.

The organiser should not repeatedly type the same requirements into disconnected forms. A planner workspace can compare venue-specific feasible adaptations while preserving the original brief and explaining compromises.

This is a path from venue software to a network that also creates value for the people booking venues. [S04]

## 62. Verified Component Cloud and supplier network

**Earlier proposed extension:** suppliers publish dimensioned, priced, available furniture, AV, staging and décor components that flow from a plan to a quote, reservation, delivery and return.

The Venue Item Foundry provides the asset side; resource scheduling provides availability; supplier collaboration provides fulfilment; source/review records provide trust.

The Verified Capability Network extends this to qualifications, insurance records, authority, inspection and calibrated equipment as scoped, expiring and revocable evidence.

These are future network ideas, not a requirement to build an empty marketplace before the core venue workflow works. [S04]

## 63. Venue Yield Network and Physical Experience Exchange

**Earlier proposed extensions:** distribute underused rooms and dates according to genuine event suitability, not merely listing availability.

A demand brief could be matched against venue capability, time, inventory, staffing, access, pricing and evidence. The more distant Physical Experience Exchange adds interoperable components, agency demand, supplier capability and partner-enabled commerce.

This is not simply “another venue directory”. The distinctive ambition is feasibility-aware demand and fulfilment grounded in the same event model used to execute the event.

Payments, procurement, finance and insurance partnerships were proposed as future commercial layers. They remain business and regulatory design decisions, not existing services or an assertion that Venviewer should hold customer funds. [S04]

## 64. Circular resources, resilience and wider physical experiences

The Circular Event Resource Graph would track inventory custody, condition, reuse and movement across venues and suppliers. Energy, carbon, waste, comfort, access and resilience can become first-class planning constraints where reliable source data exists.

The same event compiler could later serve exhibitions, brand activations, touring productions, festivals, film/TV locations, pop-up retail, campuses, cultural estates and hospitality groups—contexts where a real space is temporarily transformed and many parties must coordinate.

The proposed **Intent-to-World Compiler** is the broadest expression: describe the gathering, find a compatible place, assemble a feasible commercial/spatial plan, carry approvals into execution and learn from the result. [S04]

## 65. Human/Robot Orchestrator and the 2041 horizon

**Research frontier and scenario planning:** the same phase/task model could eventually coordinate human teams and authorised machines for transport, setup, inspection and other appropriate venue work.

Agents might represent clients, venues and suppliers, negotiate options within delegated limits and produce auditable receipts. Physical execution remains bounded by safety, competence, permissions and verified outcomes.

The founder blueprint explored four futures: ambient agents/adaptive spaces; locked-down spatial platforms; proof-first purchasing and oversight; and operations constrained by climate, energy and labour. These were scenarios, not forecasts.

The durable idea across them is an **Executable Spatial Contract**: a controlled connection between temporary human intent and the configuration of a real place. The operational twin and the probabilistic future/simulation twin remain deliberately separate. [S04]

---

# PART XI — EXPERIENCE, PLATFORM AND DELIVERY STANDARDS

## 66. Visual identity and ease of use

The recurring art direction is dark graphite, warm cream, restrained antique gold, warm architectural imagery, cyan/teal spatial intelligence and amber review cues; refined editorial typography for identity with extremely readable operational text.

The deeper rules matter more than exact colours: the room is the hero; hierarchy is clear; information density is controlled; actions are reversible; detail appears progressively; errors explain recovery; and a pressured staff member can find the next action immediately.

No generic card wall, gratuitous glass effects, constant particles, tiny unreadable text or endless animations. Equally, no retreat to an unimaginative spreadsheet merely because the product is operational.

Ethical engagement comes from agency, visible progress, clarity and satisfying precision—not artificial scarcity, anxiety, streaks or manipulative notification loops. Spectacle is available on demand; ordinary work remains calm and fast.

## 67. Output, storytelling and presentation ideas

The product should produce interactive proposals, client-safe scene links, curated camera tours, cinematic films, screenshots, 2D plans, BEOs, pick lists, run sheets, evidence packs, room diagrams and printed operational material from consistent underlying records.

Separate from software functionality, Blake explored striking physical presentation documents for Elaine: a large central planner image surrounded by explanations and arrows, A3 printing, and multi-sheet tabletop compositions rather than dense pages of tiny text. The tabletop exploration included a sixteen-sheet arrangement and then a possible smaller arrangement with two central hero sheets and eight surrounding information sheets. These were presentation explorations, not an implemented app mode.

Brochures, leaflets, merchandise, heritage imagery and wedding-marketing assets are adjacent design work supporting Trades Hall. The product opportunity is to reuse approved real assets and released event examples in marketing without confusing one-off creative work with core platform functionality.

## 68. Integrations and open boundaries

Desired integrations discussed include Google/Outlook calendars and ICS, CRM systems, payments, signatures, accounting/ERP, email, Slack/Teams-style notifications, website embeds, public room pages, supplier systems, AV/signage and external APIs/webhooks.

Each domain should state which system is authoritative. Venviewer may own spatial plans, room holds, release states and operational context while an external finance or CRM system owns other records during a given deployment.

Integration scope includes external identifiers, versioning, idempotent updates, retries, logs, replay, backfills, conflict handling and visible failure states. Silent divergence is unacceptable.

Standards proposed across the wider research include glTF/GLB, OpenUSD, E57/LAS/LAZ, Gaussian formats, iCalendar, building/indoor-navigation standards, credentials, asset traceability and robotics adapters. Their current version or implementation support must be verified when adopted; the stable internal model must not depend on a fashionable external format. [S04]

## 69. Security, privacy and reliability

The full platform requires organisation/venue isolation, role-based and where needed field-level permissions, staff/client/supplier separation, scoped shares, expiring access, private storage, audit trails, retention/deletion, redaction and careful public-versus-operational twin exposure.

It needs backup/restore proof, migration discipline, monitoring, errors that can be diagnosed, job recovery, integration health, feature flags, rate limits, controlled secrets and clear incident handling.

A venue twin can contain sensitive physical information. Public room beauty must not automatically expose service routes, VIP plans or private operational areas. Personal movement or accessibility data must be minimised and permissioned; surveillance is not the business model.

Offline mode, conspicuous release identity and reconciliation are part of correctness. A beautiful live dashboard is insufficient if staff print or cache the wrong plan.

## 70. Engineering architecture and testing

The existing project has used a TypeScript/React web stack, Three.js/React Three Fiber/Spark scene work, Zustand state, Fastify APIs, Drizzle/Postgres, storage and worker-based processing. Treat these as historical architecture context, not a fresh audit of dependency versions or deployed services.

Required engineering qualities include typed contracts, runtime validation, tenancy enforcement, reproducible jobs, immutable source artifacts, explicit coordinates, well-defined authority, observable workflows and graceful degradation.

Tests should cover domain rules, migration/schema behaviour, APIs, end-to-end journeys, visual milestones, reduced motion, keyboard/touch access, interruption races, offline recovery, file lineage, real scene performance and failure injection.

Research claims require benchmarks and a reproducible environment. Passing unit tests does not establish visual quality, safety, production deployment or a completed real-data training run. The same distinction applies to strategy documents and demo fixtures.

## 71. Commercial model, distribution and IP

The wider commercial ideas include per-venue/property subscriptions, paid onboarding/capture, premium modules, white-label/client experiences, portfolio administration, API/embed usage and eventual partner-enabled transaction revenue.

Deployment should become repeatable and partner-deliverable rather than requiring Blake to hand-build every room forever. Founding-venue proof should expand to unrelated paying design partners and multi-property customers. These are proposed growth routes, not current revenue claims.

The earlier IP structure proposed venue ownership/control of its data and bespoke content, platform ownership of reusable software/algorithms and an agreed licence/support arrangement for Trades Hall. Exact ownership is a contractual matter; do not infer it from who owns a workstation or commissioned one brochure.

A powerful computer, scanning equipment and cloud capacity are production tools considered for this work. They do not define the product's intellectual property or substitute for the agreement.

The defensibility thesis is the linked history of intent → place → promise → plan → execution → outcome, plus deployment capability, approved templates, interoperability and eventually the network—not obstructed customer exports. [S04]

## 72. Discovery and assumption management

The founder blueprint added an operating discipline for unknowns: shadow real work, record surprises and workarounds, preserve contradictory evidence, turn important beliefs into tests and maintain reversible frontier bets.

The product and company should track why a capability is being built, which user pain it addresses, what evidence would validate it and what result would change the plan.

The research protocol Blake prefers is root investigation: normalise the question, develop materially different approaches, maintain a registry, require concrete artifacts, conduct adversarial audits and return the strongest supported conclusion with exact gaps.

Do not treat an elegant narrative, a named research paper or an impressive demo as proof. Do not treat one failed method as proof that the desired outcome is impossible. [S04]

---

# PART XII — THE RECOVERED TECHNOLOGY AND IDEA REGISTER

## 73. Technologies already discussed, grouped by intended role

This is a memory of the research programme, not a claim that every tool is installed, currently released, commercially cleared or the best available today. Code, weights, datasets and hosted-service terms need separate verification before adoption.

| Family | Names discussed | Intended place in the vision |
|---|---|---|
| Capture and source data | Matterport/Pro3, XGRIDS PortalCam, K2/Lixel-family candidates, LCC Scan, Lixel CyberColor, LixelStudio, independent LiDAR, DSLR/mirrorless/medium-format, phone/360/RGB-D/drone capture | Existing capture lanes and future scanner-neutral inputs; do not conflate product support or export capabilities |
| Point-cloud work | Autodesk ReCap, CloudCompare, Open3D, PDAL, pye57, E57 depth-projection tooling, MeshLab/Blender where applicable | Inspection, conversion, room crops, coordinate alignment, geometric QA and derived surfaces |
| Camera reconstruction | COLMAP, GLOMAP/global-mapping ideas, hloc, learned matching/pose systems such as VGGT/DUSt3R/MASt3R, ScaRF-SLAM | Camera/geometry reconstruction and alternative open capture routes |
| Gaussian training | gsplat, Nerfstudio/Splatfacto, PostShot, 3DGUT/3DGRT/3DGRUT, MCMC, bilateral appearance correction, depth/normal supervision, DN-Splatter, antialiased/Mip-Splatting ideas, Brush | Owned reconstruction, refinement and portability comparisons |
| Detail and updates | Pixel-GS, ReAct-GS, CL-Splats, GaussianUpdate, Cross-Temporal/LTGS ideas, WildGaussians, residual-radiance layers | Better representation of observed detail and local/multi-session updates |
| High-capacity appearance | Neural Harmonic Textures | A proposed higher-fidelity captured master, subject to scene and runtime tests |
| Generative repair | ArtiFixer, ArtiFixer3D, ArtiFixer3D+, Difix/Difix3D+, NVIDIA Fixer, GSFix3D/GSFixer | Repair renders and/or investigate distillation back into 3D; generated contribution remains explicit |
| Gaussian super-resolution | SplatSuRe, Arbi-3DGSR, SR3R, S2Gaussian, GaussianZoom, ConFi-GS, CLEAR | Multi-view/detail enhancement research, not assumed one-click arbitrary-file upscalers |
| Surfaces and hybrid geometry | TSDF/SDF, Poisson/screened-Poisson, neural surfaces, 2DGS/surfels, SuGaR, GOF, mesh-plus-splat/residual composition | Structural and visual mesh candidates, with inference and licence checks |
| Materials and relighting | GR3EN, GS-IR, DeferredGS, LumiGauss, IRGS++, NeuMatEx, TRON, Horizon-style research, environment/HDR references | Generated mood variants, inverse rendering, neural materials and future coherent light response |
| Object understanding | Splat Analyzer, 3D segmentation, Mask3D/RoomFormer/PolyRoom/SpaCeFormer-type candidates, SAM-based masks | Room/object proposals, crop assistance, semantics and recapture targeting |
| Object generation and completion | MeshCoder, Axolotl3D, TRELLIS/TRELLIS.2, Rodin, Meshy, SAM 3D Objects, Hunyuan3D, Edify-style concepts | Item Foundry candidates; no automatic promotion of guessed geometry into planning truth |
| Furniture production | RealityCapture/RealityScan, Agisoft Metashape, Blender, ZBrush, Substance materials/baking | Faithful real-object meshes, cleanup, materials, detail levels and reusable catalogue assets |
| Conversion and web delivery | SplatTransform, SuperSplat/Viewer, PlayCanvas, gsbox, Spark, Three.js/R3F, PLY, SPZ, SOG/streamed SOG, RAD/RADC, glTF Gaussian experiments | Inspection, cleanup, packaging, delivery and renderer comparisons |
| High-detail/premium rendering | Unreal Engine, LiDAR Point Cloud, Modeling Mode, Geometry Script, Nanite, Lumen, Datasmith/Interchange candidates; Three-meshlets demo; Unity, Omniverse/OpenUSD | QA, mesh editing, premium demonstrations and possible high-detail rendering paths; historical plugin usage must be verified |
| Generative worlds and real-to-sim | WorldMesh, NeuWorld, SimFoundry, NVIDIA Cosmos, World Labs/Marble | Structure/appearance research, concepts, rehearsals and simulation-ready composition rather than measured venue truth |
| Spatial capture benchmarks and AR | Meta Hyperscape, Niantic/Scaniverse/VPS, OpenXR-style interfaces | Experience benchmarks, localisation and future on-site alignment |
| People and simulation | MotionBricks, seeded agent simulation, navmeshes, queue models, local avoidance and batch scenarios | Natural presentation over a separate auditable behavioural model |
| Processing and delivery infrastructure | Local workstations, Docker/WSL, RunPod, AWS and other provider candidates, R2/object storage, rclone | Reproducible processing, durable artifacts and provider independence |

Research names should never become dependencies merely because this list exists. The earlier unidentifiable YouTube link remains an unresolved reference, not an invented method. Nor should an old “not found” verdict remain authoritative after a real source is supplied.

## 74. Named ideas that must remain in the project memory

**Core and repeatedly discussed:** The venue becomes the interface; proof-carrying venue reality operating system; Mesh/Splat/Hybrid; The Room Resolves; Grand Assembly; Live Assembly; Layout Recall; Transformation Assembly; Director's Cut; Truth Mode; Layout Evidence Pack; Event Phase Graph; Guest Flow Replay; Ops Compiler; OmniTwin Foundry; Venue Item Foundry; Hero Volumes/Hero Region Specialists; residual radiance; source-to-screen lineage testing; runtime distillation; active recapture; neural digital set.

**Recovered strategic proposals:** Spatial Event Contract; Executable Spatial Contract; Event Compiler; Event Digital Thread; Venue/Event/Change/Outcome/Assumption Graphs; Change Impact Engine; Promise Ledger; Feasible Offer Engine; Capacity Envelopes; Decision & Acknowledgement Graph; Rapid Reality Check; Plan-to-Reality Setup QA; Live Reality Reconciliation; Room Flip Optimiser; Event Memory; Live Event Rescue; Disruption & Recovery Compiler; Event DNA Passport; Verified Component Cloud; Verified Capability Network; Accessibility Journey Twin; Venue Yield Network; Circular Event Resource Graph; Counterfactual Rehearsal Lab; Venue Capability & Feasibility API; Authority-Aware Event Agent; Human/Robot Orchestrator; Physical Experience Exchange; Intent-to-World Compiler; Trusted Events Run; Experience Infrastructure.

“Recovered strategic proposal” means precisely that: an earlier idea worth retaining and evaluating, not proof that Blake approved every name or that the feature ships today. [S04]

---

# PART XIII — BUILD CONTEXT, SCOPE BOUNDARIES AND HANDOFF

## 75. Historical implementation evidence

The June 2026 gap audit described a strong single-venue layout editor, internal review lifecycle, hallkeeper/PDF handoff, pricing and enquiry foundations, authentication/billing scaffolding and a substantial typed architecture. It also distinguished plans and fixtures from running capture, CRM, proposal, simulation and evidence systems. That was a dated audit. [S03]

The July 12 session log records The Room Resolves work and diary slice work involving a booking drawer, enquiry conversion and a live channel. It explicitly said some migrations were written but not applied and that certain browser checks remained open. Do not turn “coded” into “deployed”. [S09]

The July independence strategy reported an existing Config B training implementation but no recorded completed real run at that time, and proposed T-500 to T-504 for diagnosis, the XGRIDS/COLMAP bridge, independent baseline, photo fusion and generative research. Those old task states must be rechecked now. [S08]

Later discussion expanded the visual ambition, data permissions, Foundry, Grand Assembly and furniture pipeline. It did not independently verify that every prompted task had been completed. This master brief is therefore a vision and context transfer, not a current release certificate.

## 76. Room and asset status must be re-inventoried

The conversation records completed external splats for Lady Convenor's Room, North Gallery and South Gallery; a processed Reception Room with quality/navigation concerns; heavy Grand Hall raw capture work; and Robert Adam Room/Saloon capture work.

The user later rented a machine and reported having rendered splat outputs. The precise current room list, versions, files and quality are not established by a current manifest in this brief. Do not repeat an older “unprocessed” label as a present fact.

Historical totals for E57 files, staged data and raw project collections refer to different inventories and dates. A new session should read actual metadata rather than infer exact current size or content from this narrative.

Likewise, source images, poses and calibration are not automatically present in a rendered splat. Rights, technical accessibility, a valid camera dataset and successful training are separate gates.

## 77. Data model domains

The long-term system needs coherent records across these domains; these are modelling responsibilities, not instructions to create duplicate tables blindly.

**Organisation and identity:** organisations/workspaces, venues, users, roles, invitations, staff profiles, client/supplier identities and scoped shares.

**Venue and space:** rooms/levels, zones, surfaces, doors/windows, connectors, access routes, facts, rules, review policies, packages, inventory and prices.

**Capture and assets:** sessions, devices, raw files, versions, camera/calibration bundles, transforms, processing jobs, quality reports, rights records, runtime packages, materials, hero layers and provenance.

**Commercial:** accounts, contacts, enquiries, opportunities, activities, tasks, proposals/versions, quotes/lines, packages, contracts, signature/payment references and financial handoff.

**Events and scheduling:** event master, functions/phases, room holds/bookings, availability rules, resources, snapshots, variants, objects, seating, menus/service requirements, attachments, changes and releases.

**Evidence:** observations, assumptions, check results, review scopes, decisions, acknowledgement records, claim states, evidence packs and stale-dependency events.

**Simulation:** scenario versions, geometry/navigation versions, agent profiles, queue/service models, trajectories, replay chunks, density/route outputs and evaluation assumptions.

**Operations and outcomes:** handoff packs, BEOs, tasks, assignments, pick lists, suppliers, load-in, flips, breakdown, issues, observations, actuals, feedback and learned-template proposals.

**Platform/network:** integrations, external IDs, retries, webhook events, calendar projections, API capabilities, passports, component offers and expiring capability records where those proposed modules are adopted.

## 78. Screen and surface inventory

Public and client: product/venue homepage, room gallery/showcase, guided exploration, event-type configurator, enquiry/viewing request, proposal portal, comments/approvals, event details and document/payment milestones.

Internal commercial: today/dashboard, enquiry inbox, clients/accounts, opportunity pipeline, availability finder, multi-room diary, booking drawer, proposal/quote builder and executive analytics.

Spatial: room viewer, 2D blueprint, 3D editor, object catalogue/inspector, saved variants, phase timeline, first-person/dollhouse, Truth Mode, evidence review, guest-flow replay and Grand Assembly controls.

Operations: day sheet, duty-manager board, hallkeeper mobile tasks, supplier portal, departmental packs, live issues/rescue and post-event review.

Foundry/admin: venue onboarding, source inventory, processing jobs, alignment/calibration review, room segmentation, coverage map, recapture guidance, item capture/review, quality comparisons, runtime publishing, roles/settings, integration health and support diagnostics.

Developer/internal labs: fixed-camera benchmark, real-asset loader, representation bake-offs, animation/choreography lab, failure-state tests and performance diagnostics. Internal fixtures must never masquerade as customer evidence.

## 79. Ambition versus implementation order

Nothing in this brief means every frontier module must be built before a venue receives value. Equally, an early release must not redefine the destination as a small calendar or floorplanner.

The main parallel programmes are: a real-data visual/runtime programme; the commercial/event/operations programme; evidence and reliability; and bounded reconstruction/intelligence research.

A useful proof is one real room, one event brief, one proposal, one approved layout, one released handoff and one actual outcome. Multi-room and multi-venue deployment then prove that this is a product rather than a one-off.

The Grand Hall can pursue the highest visual ceiling while simpler room profiles and operational views keep the product usable. Full Foundry independence, neural materials, marketplaces and robotics remain visible destinations or options rather than being quietly erased or made prerequisites for everything else.

## 80. Instructions to a new LLM or coding session

Read this brief as the destination and vocabulary. Inspect the current repository and session before acting. Preserve good work, uncommitted changes, actual assets and established review/state conventions.

Do not create a fresh branch/worktree, reset work, merge, push or deploy without the user's applicable instruction. Do not overwrite raw captures or start new paid infrastructure merely because the vision is ambitious.

Reconcile existing concepts before adding new schemas. Verify relevant capabilities, versions, code/weight licences and tool interfaces rather than repeating old assistant claims. Respect the owner's stated project-specific permissions without claiming documentary verification you have not performed.

Keep source data, planning authority, generative contribution, processing state and presentation state separate. Do not call a placeholder a real capture, a plan an implementation, a written migration an applied migration, a rendered image a repaired 3D scene, or a simulation a guarantee.

When building, produce an actual vertical slice, tests, visual evidence, measured limitations and exact next actions. When researching, keep multiple routes alive and identify decisive tests. Do not return another grand strategy document when asked to implement; do not start implementation when asked only for planning.

## 81. The completed experience in one story

A client discovers the real hall online and explores an accurate, beautiful room. They describe the event, choose dates and guest count, and receive meaningful options. Their intent becomes a structured enquiry, not another disconnected email.

The venue team checks a room-aware calendar and resource constraints, creates a proposal and a layout using real furniture, and compares alternatives. Grand Assembly lets the event form cinematically before the client's eyes. The planner can return instantly to precise 2D or direct manipulation.

The system exposes assumptions and relevant evidence, rehearses guest/service movement, links the quote to the selected plan and collects exact approvals. A late change shows its downstream consequences instead of creating contradictory files.

The approved event releases departmental instructions, supplier access information, furniture counts, phase timings and hallkeeper tasks. Staff operate from the current version, even with poor connectivity. Reality checks and issue reporting reveal deviations early; approved fallback plans support recovery.

After the event, actual work, timings, client experience and outcomes improve future templates and recommendations. The room's visual assets also remain maintainable through local recapture and an owned Foundry rather than a permanent vendor bottleneck.

Across many venues, that shared structure can eventually support portable event briefs, verified components, feasibility APIs and an experience network.

## 82. The final ambition

**A venue that can be explored like a place, edited like a design system, understood like a database, rehearsed like a simulation, sold like a luxury experience and operated from the same plan everyone approved.**

The visual ambition is a breathtaking neural digital set. The workflow ambition is a living commercial-to-operational event model. The technical ambition is an owned, cross-platform, provider-neutral Foundry. The business ambition is infrastructure for physical experiences.

The difference is their combination: **beautiful enough to create desire, precise enough to plan, clear enough to run, and traceable enough to trust.**

---

## Source guide for another LLM

These references identify the project material behind this transfer brief. They are source-document identifiers, not live web citations or a claim that the files accompany this brief. Retrieve the named source when verifying a historical statement; inspect the current repository for current implementation status.

[S01] Venviewer / OmniTwin — Master Project Scope and Ambition Bible. Saved as Pasted text(5).txt. Original end-to-end product scope.

[S02] SS++ Platform Execution Plan. Dated 11 June 2026; saved as Pasted markdown.md. Five build tracks and proof-slice doctrine.

[S03] Venviewer / OMNITWIN — Master Gap Report. Dated 6 June 2026; saved as Pasted text.txt. Historical repository evidence, not present state.

[S04] OmniTwin: The Founder Blueprint — 2041 Edition. Internally dated 9 July 2026; saved as omnitwin-founder-blueprint.html. Spatial Event Contract; Venue/Event/Change/Outcome/Assumption graphs; change, rescue and network concepts; frontier portfolio; commercial architecture; scenario thinking. Strategic proposals, not all user-ratified commitments.

[S05] OmniTwin Founder Prompt Arsenal. Saved as omnitwin-founder-prompt-arsenal.md. Evidence labels, adversarial discovery and decision method.

[S06] What a luxury-venue platform must deliver to reduce or replace Cvent and Salesforce workflows. Saved as deep-research-report (28).md. Commercial, client, event, supplier and operational workflow proposals.

[S07] Practical browser-visible indoor flow simulation for Venviewer. Saved as deep-research-report (29).md. Proposed simulation architecture, replay, queue semantics and limitations.

[S08] Splat quality independence — owning the HD enhancement lane. Dated 12 July 2026; saved as splat-quality-independence.md. Historical assets, trainer/bridge proposals and source-to-screen diagnostic. Several external technology/licence claims were disputed later; do not treat its entire technology table as current fact.

[S09] Session log — 2026-07-12. Reported Room Resolves and diary implementation, tests and open deployment checks.

[S10] The Grand Hall Visual-Layer Moonshot. Neural digital set, NHT candidate, Hero Volumes, materials, Foundry and runtime research. Proposed experiments are not completed scene-specific evidence. Its earlier project-data-rights caveat was superseded by Blake's explicit permission statement.

[S11] Grand Hall Visual Super-Pipeline: Escaping XGRIDS Lock-in with a Hybrid Splat Stack. Claude's comparison document. Its factual disagreements were subsequently discussed; do not accept conflicting tool-availability or licensing assertions uncritically.

[S12] Codex Continuation Directive — Grand Hall Visual Super-Pipeline. Saved as Pasted markdown(1).md. Later integration direction and owner-stated project-specific permissions.

[Conversation] Direct exchanges with Blake are the basis for Grand Assembly requirements, full Foundry independence, broad project permissions, real-furniture digitisation, AR/headset ideas, tabletop/A3 presentation explorations and rental/output updates. Requirements restated from those exchanges are product intent, not external scientific claims.

Coverage note: this brief consolidates the visible conversation and relevant saved project materials successfully retrieved for this task. It is not a guarantee of access to every historical chat, deleted message, local Codex session or unpublished branch. Do not fill such gaps with invented memories. This is not a current vendor-capability, licence, legal or repository audit.
