# Device day, Wed 28 October: graphics reset recovery (L3c)

About 15 minutes per device. It checks on a real phone, tablet and office PC
that a view whose graphics the browser takes away comes back on its own, as it
does in Chromium on the RTX 4090 ([report](../reports/graphics-reset-recovery-2026-10-25.md)).

**What passing looks like.** "Restoring the 3D view" covers the view for a
moment and the same view returns: the same angle, the same layout and selected
table, the same tour viewpoint. **A fail** is any of: a blank or black canvas
with no message, "The 3D view stopped" after a single reset, the layout or
selection changed, or the view frozen with controls that do nothing.

Use the address the release candidate is on. Production holds splats, so the
room walk (`/room/grand-hall`) is checked on a preview build only.

## 1. The drill (deterministic, about 8 minutes)

`graphicsReset=<seconds>` takes the view's graphics away once, that many seconds
after it first draws, exactly as a browser does: it destroys the WebGPU device,
or loses the WebGL context and hands it back a second later. Adding `:never`
keeps the context away, which is the case where the view needs a new canvas.

| # | Open | Before the reset | Expect | Pass if back within |
|---|---|---|---|---|
| 1 | `/plan?space=grand-hall&graphicsReset=30` | Place two tables, select one, turn the view to an unusual angle | The same angle, both tables, the same table selected | 3 s |
| 2 | `/plan?space=grand-hall&graphicsReset=30:never` | The same | Layout and selection kept; the room may redraw from the start and stream in again | 10 s |
| 3 | `/tour?graphicsReset=20` | Walk two viewpoints in, look at a portrait | The same viewpoint and portrait | 3 s |
| 4 | `/tour?graphicsReset=20:never` | The same | The same viewpoint; the look may turn back to the viewpoint's opening | 8 s |
| 5 | `/room/grand-hall?graphicsReset=30` (preview build only) | Walk to the far wall | The same place and view | 3 s |

For 1 and 2, start counting when the hall first appears, not when the page
starts loading. Without the extra 30 seconds the reset can land during the
opening glide.

## 2. The real thing (about 6 minutes)

These are how real losses happen. Open the planner (as in row 1, without
`graphicsReset`) with a layout and a selected table, then:

1. **Background it under pressure.** Leave Safari or Chrome. Record 30 s of 4K
   video, then open three heavy apps or sites. Come back after two minutes.
2. **Lock it.** Lock the screen for five minutes, then unlock.
3. **Many tabs.** Open the tour and the planner in four tabs each, then return
   to the first tab.

Each may show nothing at all (the browser kept the graphics), or "Restoring the
3D view" and then the same view. Both pass. Note which one happened.

## 3. Record

One row per check:

| Device | OS and browser | Check | Outcome (back / stopped / blank) | Seconds back | Same view, layout, selection? | Notes |
|---|---|---|---|---|---|---|

Add the rows to the device-day report next to the frame-rate numbers. For a
fail, note the address, the step and what was on screen, and screenshot it if
you can. A stopped card that reads "The 3D view stopped" means recovery gave up
after three tries; press "Try 3D again" once and note whether that works.
