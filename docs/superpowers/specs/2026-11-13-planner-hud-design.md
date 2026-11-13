# The planner's new screen: one picture, one shelf (13 November 2026)

**Status:** built on `claude/planner-hud-tft` behind `?chrome=hud`; not merged. The ground (dark, bone or white)
is Blake's to choose. An earlier version of this note described five skins of one layout (gilt, lacquer, glass and
others); Blake rejected them the same day and they are gone.

## Why

Blake, 13 Nov 2026: "our UI design of the room planner is still terrible -- boring and looks like AI slop, hard to
navigate, boring to navigate, my mind is daunted completely when I try navigate it, i told you to completely resign
it in like with league of legends teamfight tactics ui/ux mixed with the philosophical aesthetic of the sublime and
beauty ... every single design choice, colour, animation, the way tabs open and closes, how responsive everything
is, how thingse are layed out and in what position on the screen, everything must have the strongest underlying
principle that we must not daunt or bore the user, we must inspire them with how inviting and satisyfing everything
is, that everything is so well polished that the user feels and ego boost by using such an amazing platform".

And of the first five looks: "These design choices look like ai slop. It's meant to look like it's made by the best
engineering and design team in the world with immaculate high style taste you would expected from the best fashion
houses in Paris. ... We want to blow people away by how the aesthetic just 'clicks' in the viewer's brain as being
'right'".

What is live at `/plan` today is the v1 cockpit: a layers tree, an inspector of X/Z coordinates, five small
toolbars and a lens rail. It asks an events person to think like a 3D artist.

## The idea

The hall is the sublime and takes the whole screen. The interface is the beautiful: small, exact, silent, made of
one rule, with nothing on it that could be removed. The first five looks failed because they did the reverse: they
shrank the hall to a model in a void and gave the interface the weight and the gilt.

Three tests for any control: a first-time visitor can tell in two seconds what it is and what touching it will do;
touching it answers at once and in proportion; and it could not be taken away without loss.

## The picture: the hall as a stage

`components/grand-hall/hall-stage.ts`, `HallStage.tsx`, `lib/lens-shift.ts`.

- The camera stands outside the door wall, **level**, square on to the window wall, and looks through a lens
  shifted down across it, as an architectural photographer's is. So the window wall is drawn in true elevation,
  every upright in the room is upright on the screen, and the room's lines run with the screen's own edges.
- The floor's near corners stand on the picture's foot corners: the whole floor is in view, the screen's sides
  cut the end walls, and the door wall is the missing fourth wall (lowered under the floor on this screen).
- The picture is one proportion, 2.39:1. A taller canvas keeps the rest as night above the walls. That puts the
  camera about 11 m up on an ordinary screen, which keeps the chandeliers in the picture.
- The shift lives where the camera builds its projection, because temporal anti-aliasing sets and clears a view
  offset on every frame.
- A wheel, a drag or an arrow-key pan lets go in one frame, to an ordinary orbit that shows the same picture (the
  camera tilts at the middle of the floor through the lens that keeps the picture's top and bottom). Room glides
  back and the camera squares itself up over a third of a second. Plan fills the same picture from above through
  a long lens. Walk is seen through the planner's plain lens.
- A canvas that is not wide (a phone or a tablet held upright) gets no stage yet: the ordinary orbit. A canvas
  that stops being wide while the stage is held hands the camera to the planner's own opening view, which is made
  for any canvas; when it can hold a stage again the stage is taken back, unless a hand has moved the camera.

A screen asks for the stage through `hall-view-store` (`setStage({ skyPx })`); nothing changes for one that does
not. `skyPx` is how much of the canvas's top stays dark for the screen's words. The HUD's bar measures itself and
says so (`HudFrame.tsx`), so its height is written in one place, the stylesheet.

## The interface: words on the night, and one shelf

`components/planner-hud/`.

- **No top bar.** The event's name (the one serif line), the day and room, the four steps (Your event, Lay out,
  Finishing touches, Send) and the view words (Plan, Room, Walk, the light, one "more" glyph) stand on the night
  above the hall's walls, in light ink on every ground. Away from the stage, where the hall may pass behind them,
  they take one flat scrim.
- **The shelf is the only surface,** and the canvas ends at its top edge. Its top edge is the seat line, a
  hairline that fills as guests are seated. Then: what needs saying about the room (seats, and a door or a narrow
  aisle only when there is one to look at); the quiet words (Lay out for me, Undo, Redo); eight cards as
  photographs with a two-line caption and a count once placed; "More"; and **one primary key whose label is the
  next move** ("Say how many guests", "Seat 40 more guests", "Send to the events team").
- A chosen piece's verbs (seats, cloth, Turn, Copy, Put back) take the cards' place in the same shelf.
- A step's sheet and the first screen ("What are you planning?") are the shelf grown upward, at most 60 % of the
  height.
- Each fact is said once. There is no seals column and no side panel.

Widths (the media rules at the foot of `hud.css`). Two things never give: a card's column is never narrower than
its caption (84 px), and the shelf's side columns are never narrower than their words (192 px). What gives is the
arrangement:

- **1280 px and wider:** the shelf is one row, the hand between the status and the primary key; the bar is one
  line with the steps at its centre.
- **768 to 1279 px:** nine columns will not fit between the side columns, so the shelf stands in two rows (the
  status, the quiet words and the primary key above; the hand below, across the whole width) where the window is
  at least 600 px high. In a shorter window it stays one row and the hand slides.
- **Under 1024 px:** the name, the four steps and the view will not stand in one line, so the steps take a line of
  their own under the other two.
- **Under 768 px:** a phone's two bars: the name, the step you are on and the "more" glyph above; the status, a
  sliding hand and a full-width primary key below.
- The plaque's line (the day, the room, the save state) gives way a whole item at a time, never part of a word.

Measures (tokens at the top of `hud.css`): a 4 px grid; one sans in two weights at 11, 13, 16 and 20 px; square
corners, circles only for round glyph keys; 1 px lines and a 2 px chosen outline; no shadow, glow, blur or
gradient; one accent on under a hundredth of the screen, meaning chosen, the one primary key, or something to look
at; motion only in answer to a press, 160 to 240 ms, no bounce.

## Grounds

`hud-skins.css`, `?skin=bone|blanc|noir`, remembered on the device.

- `noir`: warm black, a shade above the night. The photographs are prints on the ink's pale. The lead's pick.
- `bone`: warm bone and warm black with the hall's mahogany as the one accent. The photographs dissolve into it.
- `blanc`: the studio's own pale ground and near-black, no accent hue.

The repo bans gold-family colour literals and type under 11 px (`__tests__/house-tokens.test.ts`); none is used.

## What already exists and is reused (do not rebuild)

- Cards and their engine: `lib/setup-cards.ts`, `stores/catalogue-store.ts` (`toggleCard`, `armCard`,
  `startCardDrag`, `stepArmedCard`), the truthful ghost (`components/GhostSet.tsx`), the commit
  (`lib/place-in-hand.ts`). Card pictures: `setupCardPreviewUrl` and each piece's `thumbnailUrl`.
- Drag from a DOM card to the floor is a pointer protocol, not HTML drag and drop: on the first 7 px call
  `startCardDrag(id)`, show a preview with `pointer-events: none`, and let `PlacementGhost` place on release. Any
  element under the pointer blocks placing there, because the floor hit checks `elementFromPoint === canvas`.
- Figures: `lib/slate-facts.ts` `planeFacts`; doors `lib/keep-doors-clear.ts`; gaps `lib/circulation-scene.ts`.
- Lay out: `components/editor/cockpit/AutoFillPrompt.tsx`, `placement-store.autoArrangeBanquet/Theatre`.
- Save state and its notices: `components/planner-chrome/Slate.tsx`, reused whole and dressed from outside
  (`hud-plaque.css`). Saving is automatic.
- Send: `components/editor/send-layout-flow.ts`, `GuestEnquiryModal`.
- Keys and Escape: only through `lib/planner-keys.ts`. Motion: `lib/springs.ts`. Working states:
  `components/shared/Activity.tsx`.

## Behind its flag, and nothing more

Until this screen is the default, a planner that does not ask for it downloads none of it. The screen is one lazy
import from `pages/EditorPage.tsx`. Its parts of the room's scene (`HallStage` with its measurements and lens, and
`ChosenMarks`) are one module, `components/planner-hud/hud-scene.ts`, which `PlannerScene` fetches only where a
screen has asked for the stage or the mark. `HallStage` says where its camera stands through `hall-view-store`
(`stagePoses`), so the views' director needs none of the stage's code, and the two heights the hall's model needs
are a module of their own (`hall-stage-cuts.ts`). `src/__tests__/bundle-splitting.test.ts` fails on a static import
of any of the screen's modules from anywhere else.

## Honest numbers

The status line states measurements and counts, never verdicts: "80 of 120 seated", "Narrowest aisle 0.6 m", a
door with something standing in its space. See `docs/engineering/planner-honest-numbers.md`.

## Not built yet

- The stage on an upright phone or tablet (down the hall's length, facing the fireplace). Today an upright canvas
  opens on the planner's ordinary upright view, inside the hall.
- A short wide window (a phone on its side): it keeps the one-row shelf with a sliding hand under a two-line bar,
  and has not been designed.
- Where the doors are: the door wall is the missing one, so the door spaces should show on the floor while a card
  is in hand.
- The card photographs as one matching set in 2:3 (today's are the square studio renders).
- Send for signed-in plans (`SubmitForReviewPanel`), and venue staff's tools behind the "more" glyph.
- Sound: a card lifting, a set landing, and the setting in More tools (Quiet unless chosen). The controls of the
  planner's sound engine live in `lib/sound-registry.ts`, which every planner and the landing page download, so
  wiring them to a screen behind a flag would grow that download for everyone. It follows once the engine's
  controls can be fetched on their own.
- `/plan?chrome=hud` checked against a running API.

## Delivery

1. Desktop screen complete at `/dev/planner-lab?chrome=hud` and `/plan?chrome=hud` on a local stack.
2. The items above, the repo's guards, typecheck, lint, build.
3. A pull request through the release lead; live at `venviewer.com/plan?chrome=hud` for Blake first.
4. On his word, the default flips to `hud`.
