**Read this when:** changing a colour, focus ring, register or type token on a staff or client surface, or continuing N1 from the [roadmap](roadmap.md#n1-calm-platform-foundation-ml-starts-first-everything-depends-on-it).

# N1 — the calm foundation: first increment (26 September 2026, T-635)

This increment gives the platform one colour system for its working surfaces, built from the Enquiries desk Blake judged on 26 September. The desk is now its first tenant rather than a one-off. **Blake's verdict is pending.** Passing checks is not acceptance.

## What landed

**Lane 1 (T-615, PR #20), merged onto master's line.** One register for the app's chrome:
- the ivory ground on every route, with the 3D viewports painting their own;
- gold retired by hue: a guard fails any gold-family colour outside a recorded, frozen hand-off list;
- an 11px type floor in every syntax (px, the `font:` shorthand, inline `fontSize`, rem);
- the global hover pop, the gold cursor and the gold scrollbar deleted;
- one focus ring for the whole app.

**The workspace register** (the [design system](design-system.md) §2):

| Piece | Where | What it holds |
| --- | --- | --- |
| Primitives | `packages/web/src/styles/house-tokens.css`, "WORKSPACE REGISTER" | Planes, inks, lines, and five tones: copper, amber, sage, brick and slate. Each tone comes in text, chip, wash, dot and lit forms. Also the copper plane's marks, the type stacks, radii, shadows, scrim and motion. |
| Registers | `packages/web/src/styles/workspace.css` | `data-register="ivory"` and `data-register="forest"` declare the `--reg-*` semantics, and `.ws-plane` is the copper plane. Each register re-declares the House names, so a component written for the dark back-of-house chrome stays legible inside it. Each also sets its own focus ring: 2px, ink on ivory and cream on forest, with no halo. |
| Shared values | `packages/types/src/design-tokens.ts`: `WORKSPACE_COLOURS`, `WORKSPACE_FONTS` | The same colours for renderers that are not CSS, such as email and PDF, so a client's documents belong to the same family as the tools that made them. |
| Guards | `packages/web/src/__tests__/workspace-tokens.test.ts` | Checks that the CSS equals the types byte for byte. Audits every pairing §2.3–2.4 allows: 4.5:1 for text; 3:1 for control boundaries, focus rings and standalone marks. Also checks each register's ring. |

**The desk on it.**
- The `--enq-*` names alias the primitives.
- The amber literals became named status tokens. Amber means "pending elsewhere"; it is not decoration.
- The review dot on the plane moved from 2.88:1 to 3.50:1.
- Date-tile caps reached the 11px floor.
- `lining-nums` was removed, because it had no effect.
- The desk takes the ivory register and its decision panels take forest.
- The VENVIEWER wordmark is set in Newsreader, as Blake chose.

In the before-and-after capture of the desk, the only visible differences are:
- the wordmark;
- a nav shift of about 2px;
- the 11px date caps;
- the greeting, because the clock passed 17:00 between the captures.

The decision panel and the row focus ring are pixel-identical.

**Two repairs found while reconciling Lane 1 with master:**
- `useFocusTrap` now hands focus back to the opener only when focus would otherwise be lost. A dialog action that has already put focus somewhere on purpose keeps it; for example, a Diary palette pick focuses the booking it found. A new regression test fails on the old code.
- Lane 1's ellipsis loading copy is carried into the test that reads it.

## Held for the 3D batch

Eight of Lane 1's files fall inside the GPU scope (`.github/gpu/gpu-scope.mjs`):
- five import three or React Three: `TapeMeasure`, `WallTogglePanel`, `TimelinePreviewFurniture`, `SplatFixturePage` and `TradesHallVisualPage`;
- three are the Twin's sheets: `twin.css`, `tour.css` and `room-dossier.css`.

A push that touches them needs the operator-run GPU check. They are back at master's text and will travel with the 3D batch, where one operator run can cover them together with Lane 4, Lane 3 and the camera fix.

What waits with them:
- copper for the table preview, the splat fixture and the Trades Hall visual page;
- 11px for two planner labels;
- the Twin's move from its gold halo onto the one focus ring.

The guards record the hold exactly, frozen in both directions:
- three files join `GOLD_HANDOFF`;
- two labels join `PX_FLOOR_HANDOFF`.

When the batch lands, both lists become wrong and fail until they are corrected.

Lane 1 moved the root colour scheme to `light`, so the Twin must declare its own dark scheme. Until its sheet carries that line again, `global.css` does. Remove that rule when the batch lands.

## Where N1 stands against the roadmap

| Roadmap item (§2.3 N1) | State |
| --- | --- |
| Delete the global spring, brightness and press; gold cursor; gold scrollbar | Done (Lane 1) |
| Calm hover and press as the global default | Partly. Hover no longer moves any control, and a guard enforces that (see [Hover](#hover)). The 120 ms fine-pointer colour timing and the 0.97 press are still per surface. |
| Remove `[data-calm-controls]` | Done |
| Focus: ink on ivory, cream on forest, 2px, offset 2, no halo | Done inside registers. Outside a register, the app's ring is Lane 1's copper. |
| Remove the per-surface focus patches | The desk's patch is gone. The shell's is kept until the header takes a register. |
| Register blocks, control edge, forest edge, forest field, review dot | Done |
| Heather (AI drafts) and loch (estimates) tones | Not yet |
| Radii, the two shadows, scrim, motion tokens | Done |
| 4px spacing scale | Not yet |
| `color-scheme` per register; ivory ground | Done |
| Activity capsule in Inter | Not yet |
| Newsreader and Inter; literal Georgia replaced in the shell and shared states | The wordmark is done. `Georgia` still appears 164 times in 55 source files, outside tests. The staff and client ones need replacing, across the dashboard, inventory, onboarding, hallkeeper, client schedule and planner cockpit. Public marketing pages keep their own voice. |
| Component kit v1 (StatusChip, ConsequenceConfirm, Notice, UndoToast, EmptyState, DateTile, buttons, Field, `venue-time`, `describeFailure`) | Not yet |
| Delete `.vv-status-chip` | Not yet |
| Acceptance: the hover probe on 12 staff routes, and sampled ring contrast | Not yet. The token pairings are asserted. |

The dashboard header takes no register yet. NotificationCenter paints its own dark panel and reads the House names for its text, so inside a register it would turn dark-on-dark. It moves onto `--reg-*` in N2, and then the header can take the ivory register.

## Evidence

- **Unit and guard tests.** `@omnitwin/types` design tokens: 20 pass. `house-tokens.test.ts` and `workspace-tokens.test.ts`: 36 pass together, including the frozen hand-offs above. `use-focus-trap` has a new test that fails on the old code.
- **Browser, locally** (Chromium 1194 in this container; CI uses the pinned headless shell):
  - The full CPU partition, run on the merged Lane 1 tree before the hold and the hover fix: 276 passed, 36 failed and 42 skipped, of 354.
  - The 45 cases behind those 36 failures were re-run against master in the same container. 29 fail on master too, so they come from the environment, not this change:
    - the software-rendered 3D and WebGPU cases: `plan-room-*`, `public-config-flow` with placed objects, `twin-visual` and `trades-hall-visual`;
    - two operational screenshots whose text anti-aliasing differs here.
  - The rest came from this change, and each was resolved:
    - **Three baselines re-recorded**: `desktop-supplier-denied`, `desktop-admin-subroute-denied` and `mobile-asset-rooms-role-denied`. The images were inspected. The only change is the approved register, from graphite to ivory with the forest button. Master's supplier image still showed older copy, "This workspace is not available to your role"; it passed only inside the 2% tolerance. The new image shows what master already renders, "Access needed".
    - **One spec string**, Lane 1's own hand-off: the camera POV composer's selection colour is copper.
    - **Two editor timeouts**, which pass on the ship tree when the machine is not loaded.
    - **The Craft quiz's "element is not stable" timeout.** This was a real hover loop (see [Hover](#hover)), and the no-scroll cases now pass 30 of 30.

## Hover

Blake removed hover bounce everywhere. Lane 1 deleted the global `scale(1.06)` pop, which had overridden each surface's own hover lift through its specificity. Deleting it made those lifts live for the first time.

A lift is more than unwanted motion. A control that rises 1–2px away from a pointer resting near its lower edge loses the hover, drops back, regains it, and loops for as long as the pointer stays there.

The lift is gone from 15 stylesheet rules (16 selectors) and three pointer-enter handlers. Colour, border and shadow still respond to hover, and press feedback stays. `calm-hover.test.ts` fails on any stylesheet that transforms a hovered element, and on any pointer-enter handler that transforms its own element. Against the previous tree it lists all 19 lifts.

Hover `filter` (brightness) is still used by a few cockpit controls. The design system bans it (P27). It goes with the N1 hover probe.
