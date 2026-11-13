# The planner's new screen: one room, five stations (13 November 2026)

**Status:** being built on `claude/planner-hud-tft` behind `?chrome=hud`. The look (skin) is Blake's to choose
from five concept directions; the layout and behaviour below are shared by all five.

## Why

Blake, 13 Nov 2026: "our UI design of the room planner is still terrible -- boring and looks like AI slop, hard to
navigate, boring to navigate, my mind is daunted completely when I try navigate it, i told you to completely resign
it in like with league of legends teamfight tactics ui/ux mixed with the philosophical aesthetic of the sublime and
beauty ... every single design choice, colour, animation, the way tabs open and closes, how responsive everything
is, how thingse are layed out and in what position on the screen, everything must have the strongest underlying
principle that we must not daunt or bore the user, we must inspire them with how inviting and satisyfing everything
is, that everything is so well polished that the user feels and ego boost by using such an amazing platform".

What is live at `/plan` today is the v1 cockpit: a layers tree, an inspector of X/Z coordinates, five small
toolbars and a lens rail. It asks an events person to think like a 3D artist. Every earlier redesign (chrome v2,
the October card dock, the standalone T-687 prototype) stopped short of production. This one is built in the
product and shipped.

## The rule every choice answers to

Never daunt, never bore: invite, satisfy, and make the user feel capable. Three tests for any control:

1. **Two seconds.** A first-time visitor can tell what it is and what touching it will do.
2. **An answer.** Touching it answers at once and in proportion: motion, light, a number, and (when sound is on) a sound.
3. **Made for someone important.** Generous size, exact alignment, the event's own name, real materials.

Consequences, which are law for this screen:

- One screen. Nothing a guest needs is behind navigation; every station has a fixed place and never moves.
- One verb. Take a card and set it down (click then click, or drag). Chosen things answer where they stand.
- One next move. A single line always says the most useful thing to do now; pressing it does it.
- At most about seven things per station, in one fixed order. More than that goes behind "More".
- Everything is undoable, and Undo is always on screen, so nothing is frightening to try.
- The room is the star: the stations hug the edges and never cover the floor's centre.
- Plain words. No engineering terms (layers, objects, transform, X, Z), no verdicts on safety, no praise.
- Keys are at least 44 px tall (56 px for the primary); no text under 14 px on desktop except small caps labels (12 px).

## The stations (Teamfight Tactics' screen, mapped to an event)

| Station | Where | TFT's | What it holds | Replaces today's |
| --- | --- | --- | --- | --- |
| The event plaque | top left | player frame | crest, event or room name (menu: rooms, layouts), date, save state and its notices | room header, save toast |
| The journey | top centre | stage tracker | four steps: Your event, Lay out, Finishing touches, Send; under them "Next: ..." | lens rail (Design, Guests, Costs, Share) |
| The view | top right | camera and settings | Plan, Room, Walk; the light (Daylight, Evening, Candlelight); a "more" key (measure, draw, walls, sound, account, venue tools) | view pill, More grid, tool pill |
| Your room | left | traits | six seals, each one live fact: Seats, Doors, Aisles, then three for the kind of event (wedding: Top table, Dance floor, Bar; conference: Stage, Lectern, Screen) | Guests lens checks, door notice (which stays), outliner counts |
| The hand | bottom | shop and bench | the seat line; "Lay out for me"; Undo, Redo; eight cards; "More"; "Send to Events Team" | catalogue panel, command deck, Send button |
| The piece card | right, only while something is chosen | unit panel | name, seats stepper, linen swatches, Turn, Copy, Put back | inspector (coordinates stay behind "Exact position") |

Sheets (the "tabs"): pressing a journey step opens that step's sheet from the step itself; only one is open;
Escape, the step again, or a press on the room closes it. Your event: kind of event (three large cards), guests.
Lay out: banquet rounds or theatre, the existing honest preview (`AutoFillPrompt`). Finishing touches: linen, place
settings, chairs for every table at once. Send: the existing enquiry flow, PDF and view-only link; signed-in plans
get Submit for approval. More: the whole catalogue as cards by kind.

Venue staff keep every existing tool (the seven technical lenses, the room timeline, event details, review) behind
"Venue tools" in the view station's more key. Clients and guests never see it.

## What already exists and is reused (do not rebuild)

- Cards and their engine: `lib/setup-cards.ts` (round, top-table, long-table, dance-floor, `piece:<slug>`),
  `stores/catalogue-store.ts` (`toggleCard`, `armCard`, `startCardDrag`, `stepArmedCard`, `setCardParams`), the truthful
  ghost (`components/GhostSet.tsx`), the commit (`lib/place-in-hand.ts`). Card pictures: `setupCardPreviewUrl` and each
  piece's `thumbnailUrl`.
- Drag from a DOM card to the floor is a pointer protocol, not HTML drag and drop: on the first 7 px call
  `startCardDrag(id)`, show a preview with `pointer-events: none`, and let `PlacementGhost` place on release
  (recipe: `components/editor/VerticalToolbox.tsx` `handleAssetPointerDown`). Any HUD element under the pointer
  blocks placing there, because the floor hit checks `elementFromPoint === canvas`.
- Figures: `lib/slate-facts.ts` `planeFacts`; doors `lib/keep-doors-clear.ts`; gaps `lib/circulation-scene.ts`.
- Lay out: `components/editor/cockpit/AutoFillPrompt.tsx`, `placement-store.autoArrangeBanquet/Theatre`, `fillSeatShortfall`.
- Save state and its notices: `components/planner-chrome/Slate.tsx` (reused whole as the plaque) over
  `lib/editor-save-status.ts`. There is no Save button: saving is automatic.
- Send: `components/editor/send-layout-flow.ts` `prepareLayoutForGuestEnquiry`, `GuestEnquiryModal`, `SubmitForReviewPanel`.
- Keys and Escape: only through `lib/planner-keys.ts` (`usePlannerKeyBindings`, `useEscapeLayer`); a guard fails any
  other `keydown` listener or `"Escape"` literal reachable from `EditorPage.tsx`.
- Motion: `lib/springs.ts`, `lib/use-spring-value.ts` (write to the DOM by ref, never React state per frame).
  Sound: `lib/sound-registry.ts` (`playPlannerSound`, `usePlannerSoundArming`), Quiet by default (Blake's D1).
- Working states: `components/shared/Activity.tsx` only.

## New code

- `lib/hud/hand-cards.ts`, `room-seals.ts`, `journey.ts` (pure, tested in `lib/hud/__tests__/hud-logic.test.ts`).
- `stores/planner-hud-store.ts`: the open sheet, the skin, whether the plan was sent.
- `components/planner-hud/`: `PlannerHud.tsx` (mount), `HudFrame.tsx` (the stations round a given room), `Hand.tsx`,
  `HandCard.tsx`, `Seals.tsx`, `Journey.tsx`, `ViewStation.tsx`, `PieceCard.tsx`, `sheets/*`, `glyphs.tsx`, `hud.css`,
  `hud-skins.css`. Classes are `hud-*`.
- `lib/planner-chrome-flag.ts` gains `"hud"`; `pages/EditorPage.tsx` mounts it; `pages/PlannerLabPage.tsx` shows it
  with no backend at `/dev/planner-lab?chrome=hud`.
- `lib/planner-features.ts` gains chrome defaults: while the HUD is mounted these keys are on unless `?pf=` says
  otherwise: `setupCards`, `seatsOnTheCard`, `tableSets`, `tableNumbers`, `editingKeys`, `fillKeepOuts`.

## Skins

A skin is a set of CSS custom properties on `.hud-root[data-hud-skin]` (`hud-skins.css`): grounds, inks, the accent,
edge treatments, radii, the card mat. It also re-points the `--house-*` tokens the reused plaque reads, so the
plaque wears the skin. `?skin=honours|gilded|lacquer|ivory|oculus`, remembered on the device; the default is the
one Blake chooses (until then `honours`, the lead's pick).

The repo bans gold-family colour literals (hue 36 to 70, saturation 40+, lightness 25 to 76:
`__tests__/house-tokens.test.ts`). The skins' gilt is therefore a warm antique gilt at hue 35 or below, which also
sits with the house copper. No type under 11 px anywhere.

Concept frames and the choice page: `D:/claude/planner-hud-20261113/`, https://claude.ai/artifact/E6QUc55sr973jYmQ1tBbMG.

## Motion and sound (the same in every skin)

- Press: every key scales to 0.97 in 120 ms; release is immediate. No hover transforms (guard `calm-hover.test.ts`);
  hover is a change of light only.
- A card taken in hand rises 10 px on a spring (`detent`) and keeps its light until set down; the others dim slightly.
- A sheet opens from its step: `transform-origin` at the step, scale 0.97 to 1 and opacity, 180 ms ease-out; it
  closes in 120 ms. Opened by keyboard it appears at once.
- A seal lighting: its mark fills over 320 ms and the seat ring sweeps on a spring; a figure rolls once.
- The seat line fills on a spring (`dialGlide`).
- Reduced motion: no movement; light and number changes stay.
- Sound (Quiet): set-down, refusal, the lay-out cascade, send. Never the only signal.

## Honest numbers

Seals state measurements and counts, never verdicts: "Aisles 1.4 m" (the narrowest gap), "Doors clear" (nothing
stands in a recorded door space), "Seats 80 / 120". The venue's published figure is named as the venue's. See
`docs/engineering/planner-honest-numbers.md`.

## Phone

The same stations composed for a thumb: plaque and Send at the top, the journey as four dots with the current
step named and the next move under it, the room, one row of the seat ring and five seals, then the hand as a
sliding row of cards with "Lay out for me" first. A chosen table's card replaces the hand until it is let go.

## Delivery

1. Desktop screen complete at `/dev/planner-lab?chrome=hud` and `/plan?chrome=hud` on a local stack.
2. Sheets, the piece card, the phone composition, sound and motion.
3. Tests for the logic and the mounted screen; the repo's guards; typecheck, lint, build.
4. A pull request through the release lead; live at `venviewer.com/plan?chrome=hud` for Blake first.
5. On his word, the default flips to `hud` and v1 is retired.
