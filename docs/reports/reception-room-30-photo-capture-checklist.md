# Reception Room: the 30-photo proof

This is the smallest photo session that can tell us whether new photographs
can add genuine detail to the Reception Room model. It is a test, not the full
room capture.

## Before you start

1. Confirm that the venue and photographer allow these photographs to be used
   to build and test a commercial 3D model. Do not upload them to a cloud or AI
   service yet.
2. Make the room still: no people, moving chairs, opening doors, or changing
   curtains. Keep the same lights on for the whole session.
3. Use a tripod if possible. A 36–60 MP camera is preferred. A phone is usable
   for this first test only if it can save RAW files and lock the lens, focus,
   exposure, and white balance.
4. Create one empty folder named `Reception-30-photo-proof`.

If the measured targets and lens-calibration work below cannot be completed, stop. The photographs may still be useful as appearance references, but they cannot pass this registration proof.

## Camera settings

- Save **RAW and JPEG** for every photograph.
- Use a normal rectilinear lens: 24 mm for room coverage and 50 mm for detail.
- Set manual mode, f/8, ISO 100, and a fixed white balance.
- Choose a shutter speed that avoids light flicker in the UK, such as 1/50 or
  1/100 second, while keeping the image correctly exposed.
- Turn off automatic HDR, digital zoom, portrait mode, perspective correction,
  and automatic lens switching.
- Do not change the focus setting within a group of photographs.
- Photograph a grey card or colour chart at the beginning and end if one is
  available. These two chart images do not count toward the 30.

## Calibrate each lens group

Do this before the room photographs. These calibration pictures do not count toward the 30.

1. Use a rigid, flat ChArUco calibration board with its exact printed square and marker sizes recorded. Do not use a board whose dimensions are unknown.
2. Make a separate calibration group for every lens and fixed-focus setting used in the room—for example, one for `24 mm` and one for `50 mm`. Do not mix zoom, focus, resolution, crop, stabilization, or lens-switching settings inside a group.
3. Take at least 20 sharp board photographs per group. Move the board through the image centre, all four edges and all four corners, with several left/right and up/down tilts. The whole board must remain visible, well lit, flat, and in focus.
4. Save the board specification, original calibration images, camera/lens serial details, focus setting, image dimensions, and the calibration result with its reprojection-error report. A visually plausible room model is not a substitute for this record.

## Place and measure 14 room targets

These targets provide a real-world ruler. They stay fixed for sets A and B and the 12 test photographs.

1. Place 14 clearly numbered targets around the room: `RR-C01` through `RR-C14`.
2. Spread them across different walls, the floor, low and high positions, and the near and far ends of the room. They must not all lie on one wall or one flat plane. Each target should be sharp and visible in several building photographs.
3. Have a competent surveyor measure every target in one room coordinate system. Record the equipment, date, units, axes, measurement method, and uncertainty. To use the report's 20 mm acceptance gate, the target measurements must be independently accurate to 5 mm or better; otherwise record that the metric gate is unavailable.
4. Give `RR-C01` to `RR-C08` to the registration software as the eight fit targets. Keep `RR-C09` to `RR-C14` secret from the fit as six blind check targets. Do not move a target or swap these roles after either model has been built.
5. Save a target diagram, coordinate file, survey report, target close-ups, and the unedited room photographs that show them. The six blind coordinates may be revealed only after models A and B are frozen.

## Take 18 building photographs

These are the photographs the first test models are allowed to use.

Take set **A**, then repeat the pattern from slightly different positions for
set **B**. Keep at least 75% of the previous photograph visible as you move.

| Set | Photographs | What to cover | File names |
|---|---:|---|---|
| A | 5 | General room views at 24 mm | `RR-PILOT-MAP-A-01` to `05` |
| A | 2 | Dark timber doors, glazing, curtains, and window edges at 50 mm | `RR-PILOT-MAP-A-06` to `07` |
| A | 2 | Floorboard grain/reflections, skirting/cornice, or column base/capital at 50 mm | `RR-PILOT-MAP-A-08` to `09` |
| B | 5 | The same categories from different positions at 24 mm | `RR-PILOT-MAP-B-01` to `05` |
| B | 2 | The same doors, glazing, curtains, and window edges from different angles at 50 mm | `RR-PILOT-MAP-B-06` to `07` |
| B | 2 | The same floorboards, skirting/cornice, or column details from different angles at 50 mm | `RR-PILOT-MAP-B-08` to `09` |

Do not take only straight-on pictures. Include lower, higher, and diagonal
views so the software can understand depth rather than memorize a flat image.

## Take 12 test photographs

These photographs are the honest exam. They must **never** be used to build or
adjust the model.

Choose these six tripod positions:

1. whole-room overview;
2. dark timber doors and their glass panels;
3. curtains and window edges;
4. a column base/capital with nearby cornice or skirting;
5. polished floorboard grain and reflections; and
6. the doorway/room depth with a wall light, vent, extinguisher, or another
   fixed small feature in view.

At each position, take two matching photographs named:

- `RR-PILOT-S01-A` and `RR-PILOT-S01-B`;
- continue through `RR-PILOT-S06-A` and `RR-PILOT-S06-B`.

Keep the framing and settings the same within each pair. Mark these 12 files
`TEST-ONLY` in a note inside the folder. Do not edit, resize, sharpen, crop, or
send them through an AI tool.

## When you finish

Check that the folder contains the 30 proof photographs plus the separate calibration/control records:

- 18 building photographs, each with its RAW and JPEG file;
- 12 test photographs, each with its RAW and JPEG file;
- optional start/end grey-card or colour-chart photographs; and
- at least 20 calibration photographs for each lens/focus group, the board specification, and the calibration/error report;
- the 14-target diagram, coordinates, survey report and measurement uncertainty, with the six blind targets kept out of both model fits; and
- a short text note recording the camera, lenses, white balance, aperture,
  ISO, shutter speeds, date, and whether anything in the room moved.

Keep the original memory card unchanged until two verified copies exist. Give
Codex the local folder path only. The next software step is to register sets A
and B separately, freeze both results, and then use the 12 test photographs to
measure whether either result genuinely improves detail and remains stable.

## Stop and retake if

- focus or exposure changes automatically;
- a person or object moves through an important area;
- the lighting changes;
- images are blurred;
- the camera silently switches lenses; or
- a hero feature is visible in only one photograph.

Computer vision can score and compare this evidence once it exists. It cannot
recover a real door-panel edge, floorboard grain, curtain detail, or column
moulding that no camera or scanner ever recorded.

This checklist is for the empty captured Reception Room. Staged wedding or
marketing photographs are appearance references only unless their exact room
state, camera, rights, and date are independently established; they are not
physical held-out truth for the empty scan.
