# The Grand Assembly (Accio)

Goal 03, S5 Layout Recall + S6 Grand Assembly. A saved Grand Hall layout that
opens assembles itself: the pieces are summoned out of the light in the hall's
windows, the rounds fall into place like leaves, each table's chairs follow
once it has landed, the candles light table by table, and the camera cranes
gently down to a framing of the whole set room. Blake chose Accio (pure, no
gold plan) from three studies on 24 October 2026.

## Behind a flag

Off unless a device asks for it (`flag.ts`, the `hall-sky-access` pattern):

- `?assembly=accio` turns it on and remembers it on this device
  (`localStorage` `venviewer.assembly`); `?assembly=off` turns it off.
- With the flag off nothing changes: PlannerScene mounts no Assembly, the
  arrival is unchanged, and only a few small modules load.
- With the flag on, a saved layout's arrival in the Grand Hall is the
  Assembly in the drawn hall (not a walk in the capture).

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
  before it is summoned. The hold lapses after 8 s if no Assembly takes it
  over, and is let go at once in a room known not to be the drawn hall.
- `GrandAssembly.tsx` (lazy, flag only), the director:
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

- **Skip:** Escape (an `operation` layer in the planner's Escape order), a
  click or a tap snaps every piece to its saved transform, with the camera at
  the final framing. A press on the room is swallowed so it doesn't also
  select.
- **Cancel:** any real change to the layout (`sameLayout`), another layout
  opening, walking, the timeline preview or leaving the planner returns the
  true state at once and leaves the camera where it is.
- **Reduced motion:** the layout is simply there.

## Replay

`AssemblyReplay.tsx`: "Replay the assembly", bottom left over the hall,
shown only with the flag on. It steps aside while the Assembly plays.

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
  - the flag;
  - recall, including a layout open before the planner's code loaded;
  - the channel's byte-exact restore through the real instanced layer and shadows.
- **e2e:** `e2e/grand-assembly.spec.ts` on the real `/plan` route: it plays,
  rests, hands the camera back and writes nothing; Escape; flag off.
- **Capture (development only):** `capture-bridge.ts` installs
  `window.__assembly` on the planner lab, driven by
  `scripts/assembly-capture.mjs` (clip, look, measure) with the frame loop
  frozen. Production builds never import it.

Measured on the RTX 4090, 180 seats (198 pieces), 25 October 2026, with
`assembly-capture.mjs --mode measure` (wall time per stepped frame, p95 / max).
The phone row is the planner's phone render profile at a phone viewport on the
same GPU, not a handset:

| Profile | Show | Same layout at rest |
| --- | --- | --- |
| Desktop 1600×900 @2 | 13.9 / 16.3 ms | 12.5 / 18.7 ms |
| Phone 393×852 @3 | 12.0 / 14.5 ms | 10.3 / 13.8 ms |

The show's own work (publishing, followers, groups) is ≤ 1.1 ms p95 of that.
