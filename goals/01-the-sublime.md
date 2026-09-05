# 01 · The Sublime — Venviewer's design philosophy and the language that replaces House v1.0

This file is the brief, version 0. Blake reads it, marks it, and when he writes "approved" on it (or his edits are in) it becomes docs/plan/17-THE-SUBLIME-DESIGN-LANGUAGE.md and gates every rebuilt surface in goals 03–07. It answers the founder's mandate in docs/plan/16-SUBLIME-EXPERIENCE-AND-AUTONOMY-MANDATE-2026-09-04.md (T-586), whose §2 reads Longinus, Burke and Kant from their primary texts and sets the ambition as awe, presence, significance and agency; §1 below is consistent with that reading and adds the two tempos. Plan 16's first design deliverable, the three-role visual study, is slice 2 here.

## The /goal block

Establish the Sublime as Venviewer's design philosophy and write the design language that replaces House v1.0: the ten laws and the sublime test in goals/01 §2–§4, a per-venue palette measured from the captured room (§3, a new tool), the motion and sound laws (§5), a captioned reference gallery of found and generated images (§6), and three keystone surfaces built as working prototypes on a branch behind `?house=sublime` (the room walk's chrome, the planner placing one table, the hallkeeper's board), each with its sublime test filled in and Playwright screenshots. Blake judges. No production surface changes; nothing lands before Tuesday 2026-09-08.

## Outcome, in Blake's words

"a spectacularly beautiful venue planning platform"; "look as many years ahead as possible"; "no annoyance or clunyness anywhere, no lag, no scuffed visuals, no clunky designs or clunky navigation in any aspect"; "an absolute joy to use both visually and practically as we interface with it with our eyes, ears, mouse"; "everything must look highly polished and carefully planned, everything is there for a reason and nothing is simply made without beauty and aesthetic deeply thought of and built into it"; "buttery smooth with awesome animations baked in to everything so it feels like magic"; "the philosophical aesthetic of the sublime which is paramount and non-negotiable".

## Where we are

House v1.0 (docs/plan/02-DESIGN-LANGUAGE.md, July 2026): a Back-of-House graphite register and a Front-of-House ivory register, one brass accent, "the room is the light source", "nothing enters, everything resolves", Söhne, Söhne Mono and Canela licensed (10 July). The Day Board references in docs/plan/reference/day-board/. The Rite landing (July), the /fresh sandstone landing, the Living Hall plan, the Trades House quiz. Blake's verdict on all of it: it does not inspire the sublime. Emil Kowalski's design-engineering skills are vendored in .claude/skills (emil-design-eng, apple-design, review-animations, animation-vocabulary); read emil-design-eng before any motion work. Blake's standing feedback: springs, never tweens; every interaction personal and cared for; never gate pointer-following visuals behind reduced motion.

The supplied reference images, acceptable interim targets that this brief must improve on: docs/design/concepts/a-board.png (a booking-conflict modal, despite its name), b-daysheet.png, c-mobile.png and e-clash.png, and docs/plan/reference/day-board/command-centre-drafting-sheet.png, command-centre-week-board.png and hall-view-phase-timeline.png (a venue-dominant planner with side tools and a phase timeline). d-portal.png stays rejected. Their room imagery, numbers and labels are design references, not Trades Hall evidence.

What survives from House because it is correctness, not taste: claim-safe language on every surface; the Hallkeeper Test (room, state, time found in under one second); 44 px touch targets; colour never carrying meaning alone; reduced motion losing no function; audio off losing nothing; 4.5:1 contrast, 7:1 for client body text.

## §1 What the sublime is, for us

Burke (1757) called the sublime astonishment: the mind so filled by an object that it can hold nothing else. Its sources are magnitude, obscurity, power seen from safety, privation (darkness, silence, solitude, vacuity), the suggestion of infinity, difficulty, magnificence, sudden light, and low intermittent sound. Kant (1790) split it: the mathematical sublime is a magnitude that defeats the senses while reason grasps it anyway; the dynamical sublime is power beheld from a safe place. Beauty pleases; the sublime overwhelms and then steadies you.

The Grand Hall is already a sublime object: seven metres to the cornice and a dome above, the gilded names of the dead on every wall, one chandelier, a timber floor that has held two centuries of dinners. Our job is not to decorate it. It is to get out of its way, and to make every tool feel like it was made in the same building by the same hands.

For a working product the sublime has two tempos. Work is instant and calm. The sublime is slow, rare and chosen: the room resolving out of darkness, an event assembling before a client, the year seen as one night sky. Nothing ambient ever performs. That restraint is what makes the rare moment overwhelming.

## §2 The ten laws

1. The room is the subject; the interface is the frame. At rest, the captured venue holds at least seventy percent of the frame on every spatial surface. Chrome is hairlines and type. No panel ever sits over the room; controls sit at its edge or withdraw.
2. Magnitude is felt, never stated. First views open from the floor at 1.6 m, looking along the hall's long axis so the height reads. The room is never first shown at toy scale. The dollhouse and the plan are choices, not defaults.
3. Darkness first, one light. Every surface begins from the room's own measured dark (§3) and is lit by one source: the room, or one accent drawn from its gilding. There is no second accent anywhere in the product.
4. Obscurity that resolves. Nothing loads with a spinner, a skeleton or a fabricated progress bar. The room resolves from its coarsest level; the interface resolves from blur to focus in place. Exits dissolve. Missing and failed regions stay honest.
5. Slowness is earned; speed is everywhere else. Work: input to visible change under 16 ms, a command open under 50 ms, a layout preview under 400 ms; the camera is never taken during work. The sublime: on demand only, and then slow (the resolve, the Grand Assembly reveal, the Director's Cut), always skippable.
6. Silence, then sound. Sound is opt-in and made from the building: the Grand Hall's own reverberation, recorded on site (HUMAN.md 6), gives the chime, the settle and the reveal their room tone. With audio off nothing is lost.
7. Restraint is reverence. No gradients for drama, no glow, no confetti, no particles, no frosted glass over the room. Ornament only where the building has it, and then in the building's own gold.
8. Craft rewards looking. Every hairline is on the pixel. Numbers are tabular and scrub. A spring settles like a chair set down: mass, stiffness and damping stated, never an easing curve. Focus rings are drawn, not defaulted. Every state (hover, active, focus, pressed, disabled, loading, error, empty, offline, stale) is designed, none inherited.
9. Vastness in data. Time and inventory are shown at the scale that produces awe: the year as one dark field, the day as a single line of light across the timetable, five hundred chairs as one field that arrives in waves. Density is controlled. Nothing is ever a wall of cards.
10. The interface withdraws in motion and returns at rest. While the viewer moves, chrome fades to nothing; when it stops, chrome returns within one spring. Under pressure a hallkeeper still finds room, state, time and the next action in under one second.

## §3 The venue is the design system

Tokens are not picked from a swatch. They are measured from the captured room, so every venue that is captured gets its own House without a designer touching it, and Trades Hall's is timber, plaster, gilt and dome-blue rather than a generic graphite.

The tool: `tools/palette/` (Python, beside tools/xgrids-lcc2/scripts/sog-floor-census.py, which already reads the served Gaussians). For each room it samples the finest-level Gaussians in four bands (the floor slab, the wall band, the ceiling and dome, and the brightest half-percent as the gild), clusters in CIE Lab, and writes `packages/web/src/design/venues/<venue>/<room>.tokens.json`: bg/0 is the room's darkest fifth percentile, text/1 its lightest plaster, accent its gold, hairline and status tints derived from those and pushed until every pair passes 4.5:1 (a test fails the build otherwise). Status hues stay semantic (current, review, stale, missing, blocked, simulated, assumed) and are tinted toward the room, never replaced; each still pairs an icon and a verb.

Typography: Söhne (interface), Söhne Mono (every number) and Canela (the room's name, the client's moments) are licensed; keep them unless the gallery shows a better display face. Body sizes rise one step from House: 14 px interface, 16 px client body, because "tiny unreadable text" is a clunk.

## §4 The sublime test

Every rebuilt surface fills this in, line by line, in its handoff. One failing line and the surface is not done.

1. At rest the venue holds ≥ 70 % of the frame (spatial surfaces), or one dominant field (data surfaces). Measured: canvas pixel share.
2. One light source and one accent, both measured from the room.
3. Every element states its reason in one sentence in the PR. An element without a reason is removed.
4. Room, state, time and the next action are found in under one second under pressure (the Hallkeeper Test), timed with a person.
5. Input to visible change under 16 ms; nothing waits for choreography. Measured with the harness.
6. 60 fps (frame interval p95 ≤ 16.7 ms) on the weakest device in the matrix (goal 02 D1). Until a physical device is measured, the line says "emulated".
7. Reduced motion, audio off, keyboard only and a screen reader each lose nothing. Each has a fixture.
8. Every one of the ten states in law 8 is designed and has a fixture.
9. Nothing ambient moves. Every motion is a spring with a stated mass. Every sound is opt-in and from the building.
10. Honest: no fabricated progress, no generated image posing as a photograph, the claim-safe lexicon throughout.

## §5 Motion and sound laws

Springs only, from packages/web/src/lib/springs.ts (the one spring core; never a second). The table below is the starting tuning; the motion lab (goal 03 S9) is where it is measured and adjusted, and the feedback_spring_physics memory is the standing instruction.

| Interaction | Mass | Stiffness | Damping | Feel |
|---|---|---|---|---|
| Chrome withdraws (motion begins) | 1 | 400 | 40 | gone in a breath |
| Chrome returns (rest) | 1 | 170 | 26 | settles, no bounce |
| Table placed | 3 | 120 | 22 | weight, one soft overshoot |
| Chair placed | 1 | 260 | 24 | quick, crisp |
| Chairs arrange round a table | 1 | 220 | 22, staggered 18 ms | a wave, not a queue |
| Drag follow | direct, no spring | | | the object is under the finger |
| Release / magnetise | 2 | 200 | 24 | snaps home like a drawer |
| Panel resolves (blur to focus) | 1 | 300 | 30 | focus pulled, about 180 ms |
| Panel dissolves | 1 | 400 | 36 | about 120 ms |
| Room resolves (coarse to served) | state-driven, no spring | | | truth, not theatre |
| Grand Assembly wave | 3 | 90 | 18 | slow, cinematic, skippable |

Sound (opt-in, off by default, never carrying meaning alone): the room tone from HUMAN.md 6 convolved onto three sounds only, a settle (a chair set down), a chime (a request landing on the timetable), and the reveal (the Grand Assembly's last wave). Nothing else makes a sound.

Pulses (the timetable's severity, goal 05) exist only for states a person can act on, and they quiet on acknowledgement while the unresolved work stays visible as a steady slab. Plan 16 rejects constant pulsing; so does this brief. Nothing breathes forever.

## §6 The gallery, and the prompts

Forty captioned images in docs/plan/reference/sublime/, each captioned with the law it demonstrates. Found: Turner's storms and Friedrich's wanderer (magnitude and obscurity), the Rothko Chapel and James Turrell's skyspaces (one light), Zumthor's Therme Vals and Bruder Klaus chapel (darkness and material), the Pantheon oculus (sudden light), Aman and Amangiri lighting (restraint), Kubrick's one-point frames (the frame), Linear and Teenage Engineering (craft that rewards looking), the Apple Vision Pro environment reveal (obscurity resolving). Generated, through the fal-ai-media skill with HUMAN.md 5 or Blake's own tool, never presented as photographs of Trades Hall:

1. "A vast Victorian hall at dusk, seven metres to the cornice, one chandelier lit, gilded names on dark timber panelling, an empty polished timber floor, seen from eye height along the long axis toward the far wall; no people; no interface; cinematic, still."
2. "The same hall shown as a single dark field with hairline architecture in warm gold ink, resolving from blur at the left to a photographic room at the right."
3. "A floor plan of a great hall drawn as one line of light on black; twelve round tables as faint rings; one table selected, its ring in antique gold; nothing else on screen."
4. "A day timetable as a horizon: one band of warm light crossing a dark field from left to right; four events as warm slabs on three room lanes; one slab breathing amber; the next action written in one line above in a light grotesque."
5. "A banquet for one hundred and eighty assembling in a dark hall: tables arriving in slow waves along the axis, chairs gathering round each, the chandelier the only light; seen from the floor, wide."
6. "A wedding proposal page in warm ivory with one photograph of a real dark hall, a serif room name, one gold line, generous space; no cards, no icons."
7. "A phone screen for a hallkeeper: black, one line of light for the time, the current room's name in a serif, the next action in large type, one gold request slab; nothing else."
8. "A year of a venue's bookings as a night sky: three hundred and sixty-five points on a dark field, brighter where booked, one constellation drawn between the events of one wedding."

## §7 The work, in slices

Slice 1, Blake's read (no session needed): HUMAN.md 5 and 6, then his marks on this file. Approval makes it docs/plan/17-THE-SUBLIME-DESIGN-LANGUAGE.md.

Slice 2, the three-role visual study and the gallery (two sessions). The study is plan 16's first design deliverable: three distinct, source-grounded directions, each carrying the same sample event (the demo week's linked wedding) across the room planner, the administrator's day-and-decision view and the hallkeeper's phone. One direction may evolve the supplied references; all must reach for the sublime beyond decoration. Each direction is a set of stills plus one paragraph on how it obeys the ten laws. The gallery is the forty captioned images of §6, found and generated, in docs/plan/reference/sublime/, with a one-page index mapping each to a law. Blake selects a direction.

Slice 3, the palette tool (one session, test-first): `tools/palette/` and the eight Trades Hall rooms' token files, the contrast test, and a one-page swatch per room rendered to PNG for Blake.

Slice 4, the selected direction as a working interaction prototype: three keystones on a branch behind `?house=sublime` (three sessions; each is also the first slice of its goal):
(a) the room walk's chrome at /room/grand-hall: hairlines only, the room's name in Canela, the withdraw-and-return law, the pose and time; nothing over the room.
(b) the planner placing one table with chairs arranging and settling, the tool pill, under the new tokens (goal 03 S1).
(c) the hallkeeper's board as one line of light with slots and the pulse (goal 05 S1).
Each ships with Playwright screenshots (`pnpm --filter @omnitwin/web visual-check` with the flag) and its sublime test filled in. Representative users then test presence, coherence, agency, repeated-use comfort and task success (plan 16 §2); their reports sit beside Blake's judgment, which is the aesthetic acceptance.

Slice 5, Blake's verdict, revisions, approval. Then goals 03–07 open, migrating by complete user journeys behind reviewable previews so no deep link, work or user is stranded mid-event.

## Done when

Blake has approved the brief. The three-role study exists with three directions and his selection recorded. The gallery has forty captioned images. Eight rooms have measured tokens with the contrast test green. The three keystones run behind the flag with screenshots and filled-in sublime tests. The handoff lists which House v1.0 rules were kept as correctness.

## Verify

```
python tools/palette/palette.py --venue trades-hall --room grand-hall
pnpm --filter @omnitwin/web test -- --run design
pnpm --filter @omnitwin/web visual-check
```

## Forbidden

Touching a production surface before approval. A generated image presented as a photograph of Trades Hall. A second accent. Ambient motion. Particles, glow, gradients for drama, glass over the room. A second spring core. Changing the spine.

## Human inputs

HUMAN.md 5 (image generation), 6 (the room tone). Item 4 (more taste references) is optional: plan 16 records that Blake has chosen the direction and supplied references, so it is not asked again.

## Unlocks

03, 04's surface, 05, 06's surfaces, 07.
