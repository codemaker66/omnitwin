# The Grand Assembly (Accio)

Goal 03, S5 Layout Recall + S6 Grand Assembly. A saved Grand Hall layout that
opens assembles itself: the pieces are summoned out of the light in the hall's
windows, the rounds fall into place like leaves, each table's chairs follow
once it has landed, the candles light table by table, and the camera cranes
gently down to a framing of the whole set room. Blake chose Accio (pure, no
gold plan) from three studies on 24 October 2026.

## When it plays

On for everyone (Blake, 26 October 2026): "Plays the first time a layout
opens with a visible skip which speeds it up. There is a present button which
plays it also if we want to see it again." (`flag.ts`, remembered per device in
`localStorage` `venviewer.assembly`):

- **By default** a saved layout plays the first time it opens on a device. A
  layout this device has watched assemble, or furnished and saved itself, opens
  as placed (`recall.ts`, `venviewer.assembly.seen`, the latest 200 layouts).
- `?assembly=accio` plays it on every open here (demos and walks);
  `?assembly=off` turns it off here; `?assembly=on` returns to the default.
- Where it plays, a saved layout's arrival in the Grand Hall is the Assembly in
  the drawn hall, not a walk in the capture. A new or already-seen layout
  keeps the capture walk.

## How it works

- `presentation-channel.ts` (in `floor/`): how placed furniture is drawn while
  a reveal plays. Per piece, the change from its placed transform
  (`drawn = delta · placed`), its contact shadow and its candles. The
  placement store is never written. The followers are:
  - the instanced models (`InstancedFurnitureLayer`, written straight into the
    instance buffers, so three's previous-instance matrices give TRAA real
    per-instance motion vectors);
  - the contact shadows;
  - the candles;
  - the `furniture-<id>` groups (cloths, settings, name plates).

  Publishing `null` redraws store truth byte for byte.
- `recall.ts`: when a saved layout finishes loading (or is already open when
  the planner mounts), it holds the room empty at once, so nothing is seen
  before it is summoned. While the room is still unknown, or the hall is drawn
  but the Assembly's code is still arriving, the hold waits (45 s at most);
  then the Assembly has 8 s to take it over. It is let go at once in a room
  known not to be the drawn hall.
- `GrandAssembly.tsx` (lazy, fetched where it may play), the director:
  - **Hold:** keeps the room empty at the opening view while the hall's
    surfaces arrive.
  - **Play:** each frame it publishes the show, moves the groups, raises the
    windows' light and places the camera.
  - **Camera:** it owns the camera through CameraRig's `suspended` prop.
    CameraRig resumes in a commit that re-aims the orbit at its opening
    target, so the director holds the final framing until the rig's controls
    are enabled again. The planner then carries on from exactly there.
  - **Held ending:** a show that plays to its end holds its last frame for
    1.2 s of show time before the chrome and overlays return.
- `show.ts` / `engine.ts` / `accio.ts` / `choreography.ts` / `pose-matrix.ts`:
  pure. Pieces come from a layout diff (empty room → saved layout), plus a
  choreography graph (anchor = "Table 1", waves outward). Every quantity is a
  spring from `lib/springs.ts`, stepped on a fixed 240 Hz clock, so a layout
  and seed always play the same way. Accio plans its own schedule:
  - each window's stream is spaced;
  - chairs start only after their round has landed (found by flying it on its
    own springs);
  - no two pieces pass through each other: prioritized planning in space and
    time, worked out in this order:
    1. Each piece is flown alone through each candidate window, sampled at
       120 Hz, with each sample swept halfway to its neighbours.
    2. It starts at the first moment, in 20 ms steps, when its whole flight
       is clear of every piece already scheduled.
    3. A held-back round does not hold back the rest of its wave, but no round
       leaves before one a whole wave ring nearer the top table.

    Planning 180 seats takes about 0.1 s on a desktop, once, at the start;
  - candles light as a table's last chair lands.
- A round tips toward the camera from wherever it is, so its top shows even
  when it comes through a window far from its place.

## Skip, cancel, reduced motion

- **Skip:** the visible Skip, a click or a tap plays the show on at four times
  its speed; a second press goes straight to the end. Escape (an `operation`
  layer in the planner's Escape order) goes straight to the end at once:
  every piece snaps to its saved transform, with the camera at the final
  framing. A press on the room is swallowed so it doesn't also select.
- **Presses as it ends:** the Skip answers its own presses, by pointer or by
  key, in the held ending too, and hurrying a show that has already played to
  its end brings the planner back at once; a press on the room then does the
  same. Once the room is given back the Skip stays for 600 ms
  (`REPLAY_SETTLE_MS`), fading out, and lets presses go: a hurried show can
  end under a press already on its way to the Skip, which would otherwise land
  on the room and select or deselect. Then it is gone, and focus that was on
  it goes back where it came from.
- **Clock:** the show advances by each frame's time, at most 0.25 s a frame,
  so a slow renderer still plays it in about its own time.
- **Cancel:** any real change to the layout (`sameLayout`), another layout
  opening, walking, the timeline preview or leaving the planner returns the
  true state at once and leaves the camera where it is.
- **Reduced motion:** the layout is simply there.

## Replay: Present

Present replays the Assembly (Blake: "There is a present button which plays
it also if we want to see it again"; `components/editor/planner-present.ts`):
the command deck's Present on a desktop, the last row of the Grand Hall's
View sheet on a phone or tablet. It asks through `requestAssemblyReplay()`,
which refuses unless the Assembly is on its stage (`onStage`, set while
`GrandAssembly` is mounted), at rest, over a furnished floor: a request with
nothing to take it up, or over an empty floor, would hold the room for a show
that never comes. It refuses, too, within `REPLAY_SETTLE_MS` of the room
being given back: a press on Present in the show's held ending brings the
planner back on its way down, and its click must not start the show again. Elsewhere, such as a device-day cut drawn in Capture,
Present plays the room's showcase tour where one exists; otherwise, and under
reduced motion, it says why it can't. While the show plays, Present's press
from the keys hurries it as the Skip does.

`AssemblyReplay.tsx`, bottom left over the hall (above the dock on a phone),
is the Skip only: "Skip", then "Skip to the end", gone at rest.

## Proof

- **Unit tests** (`__tests__/`):
  - determinism across stepping;
  - settled equals saved (1e-6);
  - chairs only after their round lands;
  - stream spacing;
  - no piece through the glass or wider than its reveal;
  - no piece through another, in the air or into one already down (240 Hz,
    real poses, two seeds);
  - rounds show the camera their tops;
  - nothing across the lens or set down across its table;
  - the final framing inside the orbit's limits with no chandelier mid-frame;
  - skip, cancel and reduced motion;
  - the flag's three modes, and the Skip's states: playing, hurried, fading
    as the room is given back, then gone;
  - the Skip through the director, stepped frame by frame
    (`GrandAssembly.test.tsx`): four times the pace, the second press on the
    final framing, a press as the show comes to rest by pointer or by key, a
    late press swallowed and the Skip then gone, the Assembly on its stage
    only while mounted, and presses on the room;
  - Present (`components/editor/__tests__/planner-present.test.ts`, the deck's
    and the View sheet's tests): the Assembly over a furnished drawn hall, the
    tour elsewhere, the reasons, reduced motion, a stale press, and the keys
    hurrying a show under way;
  - recall, including a layout open before the planner's code loaded, the
    first-open rule and the seen list;
  - the channel's byte-exact restore through the real instanced layer and shadows.
- **e2e:** `e2e/grand-assembly.spec.ts` on the real `/plan` route: it plays,
  rests, hands the camera back and writes nothing; Escape; with no flag it
  plays the first time, the Skip hurries it to its end (every state the
  control shows is recorded and read afterwards, so a slow renderer's timing
  cannot decide it) and is then gone, it opens as placed with nothing played,
  and Present replays it.
- **Capture (development only):** `capture-bridge.ts` installs
  `window.__assembly` on the planner lab, driven by
  `scripts/assembly-capture.mjs` (clip, look, measure) with the frame loop
  frozen. Production builds never import it.

Measured on the RTX 4090, 180 seats (198 pieces), 25 October 2026 11:45 GMT
(the clear-air build), with `assembly-capture.mjs --mode measure`. Figures are
wall time per stepped frame, p95 / max. The phone row is the planner's phone
render profile at a phone viewport on the same GPU, not a handset:

| Profile | Show | Same layout at rest |
| --- | --- | --- |
| Desktop 1600×900 @2 | 10.8 / 12.9 ms | 9.6 / 25.2 ms |
| Phone 393×852 @3 | 9.3 / 11.2 ms | 9.2 / 12.8 ms |

The 25.2 ms is one frame of the layout at rest with no Assembly. The PC is
shared: an earlier run that morning measured the show at 13.9 / 16.3 ms
(desktop) and 12.0 / 14.5 ms (phone). The show's own work (publishing,
followers, groups) is at most 0.7 ms p95 of a frame. Its plan, made once at
the start, takes about 0.1 s on this desktop.
