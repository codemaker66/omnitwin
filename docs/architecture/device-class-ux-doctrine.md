# Device-Class UX Doctrine for Venviewer

Status: Active planning doctrine
Date: 2026-04-30
Source: USER-2026-04-30

Venviewer must be a first-class web app across desktop, tablet, and phone. The same venue truth and planning data model must project into different surface grammar by device class. Do not squeeze the desktop planner into smaller screens.

## Device Classes

| Class | Breakpoint guide | Surface role |
|---|---:|---|
| Phone portrait | width < 640px, portrait | Guided, focused, touch-native workflow |
| Phone landscape | width < 900px and short viewport height | Guided workflow with maximum canvas priority |
| Tablet portrait | 640px <= width < 900px, portrait | Serious planning and presentation surface |
| Tablet landscape | 900px <= width < 1200px | Planning/presentation surface with compact inspector chrome |
| Desktop | width >= 1200px or large fine-pointer display | Power editor and high-fidelity production surface |

Breakpoints are implementation guides, not separate product lines. Pointer type, viewport height, and available interaction method may refine the actual UI.

## Product Rules

The no-dead-end rule: every shared or embedded venue module must give the user a path to a real working surface on the device they are holding. A phone preview may be simplified, but it must not strand the user at a static or clipped demo.

Touch-native expectations:
- Primary controls are reachable by thumb without relying on hover.
- Tap, drag, select, close/back, and open-3D actions must work with pointer events.
- Pan/drag must preserve correct planner coordinates after responsive fitting.
- Pinch zoom can be staged, but the current affordance must degrade honestly.

The full-screen mobile planner pattern:
- Landing and embedded pages show a fitted, elegant interactive preview.
- Starting a real edit action on phone opens a fixed, full-viewport planner shell.
- The shell owns its own top bar, plan viewport, compact controls, inspector/docked detail surface, and close/back control.
- Underlying page scroll is locked while the shell is open.

Tablet is a first-class planning and presentation surface:
- Tablet users should see the room plan fitted to available space.
- Tablet should keep real controls visible, not hide everything behind phone-only launch chrome.
- Tablet layouts should support drag, rotate, select, inspector review, and 3D preview/presentation paths as those features exist.

Desktop is the power-editing surface:
- Desktop supports the full editor, advanced layout controls, high-fidelity 3D, and future Truth Mode, Scene Authority, and Grand Assembly tools.

## Minimum Capability by Surface

Phone must support:
- Opening shared layouts.
- Seeing the 2D plan fitted to screen.
- Opening the full-screen planner.
- Selecting key objects.
- Basic object movement/editing where supported.
- Viewing summary chips such as seats and egress.
- Opening 3D view or a 3D preview.
- Commenting, approving, or requesting changes where those features exist.

Tablet must support:
- Real 2D planning.
- Drag, rotate, and select interactions.
- Bottom-sheet or side-panel inspector.
- 3D preview and presentation.
- Staff, supplier, and hall keeper workflows when implemented.

Desktop must support:
- Full editor.
- Advanced layout controls.
- High-fidelity 3D.
- Future Truth Mode, Scene Authority, and Grand Assembly tools.

## Trades Hall Module Standard

The Trades Hall landing planner is the first implementation standard:
- Phone: fitted embedded preview plus full-screen planner on tap/edit/CTA.
- Tablet portrait: fitted room plan with controls and inspector visible below the plan.
- Tablet landscape: compact three-surface planning layout with sidebar, plan, and inspector visible.
- Desktop: full stacked hero planner with the desktop power-editor path intact.

The planner data model must remain shared across all device classes.
