# Reception Room coordinate-pair collection pack

Status: internal measurement collection checklist
Task: T-453
Source request: `docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json`

This pack tells an operator what to measure before a reviewed `runtime-control-coordinate-pair-intake.v0` file can exist. It records no coordinate values and does not create reviewed intake, a reviewed packet, a capture-control source, a signed transform, public exposure, or operational geometry.

## Scope

| Field | Value |
| --- | --- |
| Venue | `trades-hall` |
| Room | `reception-room` |
| Runtime package | `71687e9e-c23d-4f51-b3dd-a6a82c97978d` |
| Source packet | `reception-room-landmark-control-intake-2026-06-16` |
| Source frame | `ARF` |
| Target frame | `CVF` |
| Required coordinate pairs | 4 |
| Request status | `coordinate_pairs_required` |

## Measurement Rows

| Landmark id | Label | Feature | Frames | Required observations | Visual evidence refs | ARF source coordinate | CVF target coordinate | Residual m | Reviewer role | Measurement evidence ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reception-door-left-jamb-base | Reception room door left jamb base candidate | door jamb | ARF -> CVF | source point coordinate, target point coordinate, per landmark residual m, reviewer role, measurement evidence ref | Settled camera screenshot: output/playwright/reception-room-camera-arrival-settled.png |  |  |  |  |  |
| reception-door-right-jamb-base | Reception room door right jamb base candidate | door jamb | ARF -> CVF | source point coordinate, target point coordinate, per landmark residual m, reviewer role, measurement evidence ref | Settled camera screenshot: output/playwright/reception-room-camera-arrival-settled.png |  |  |  |  |  |
| reception-column-plinth-front-corner | Reception room column plinth front corner candidate | column plinth | ARF -> CVF | source point coordinate, target point coordinate, per landmark residual m, reviewer role, measurement evidence ref | Settled camera screenshot: output/playwright/reception-room-camera-arrival-settled.png; After-drag camera screenshot: output/playwright/reception-room-camera-arrival-after-drag.png |  |  |  |  |  |
| reception-skirting-floor-corner-left | Reception room skirting and floor corner candidate | wall floor corner | ARF -> CVF | source point coordinate, target point coordinate, per landmark residual m, reviewer role, measurement evidence ref | After-drag camera screenshot: output/playwright/reception-room-camera-arrival-after-drag.png |  |  |  |  |  |

## Acceptance Criteria

- Create a separate runtime-control-coordinate-pair-intake.v0 file; do not edit the source packet.
- Include every required landmark id exactly once with source and target coordinates in the requested frames.
- Include per-landmark residuals, residual RMSE, max residual, reviewer role, and measurement evidence refs.
- Keep all coordinate-pair intake guardrails false until a later command builds downstream artifacts.

## Claim Boundary

- Use this pack to collect measurements only.
- Convert the collected values into a separate `runtime-control-coordinate-pair-intake.v0` JSON file.
- Run `assets:inspect-runtime-control-coordinate-pair-intake` before building any reviewed packet.
- Do not edit the source packet or checked-in request artifact to add measurements.

## Current Blockers

- No request-level blocker; reviewed coordinate-pair measurements are still missing.

## Guardrails

| Side effect | Created by this pack |
| --- | --- |
| Coordinate-pair intake | no |
| Reviewed runtime-control packet | no |
| Capture-control source | no |
| Signed transform | no |
| Public exposure change | no |
| Operational geometry | no |
