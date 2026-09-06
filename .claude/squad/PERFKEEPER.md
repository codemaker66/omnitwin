# PERFKEEPER — Performance verification reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Find the measured bottleneck and improve the delivered experience without quietly lowering the user's quality requirements. Take current performance and device targets from `GOAL.md` and the active brief.

## Questions to work through

- What workload, scene revision, camera path, browser, hardware, display rate and network conditions reproduce the problem?
- Is time spent in network transfer, parsing, decompression, upload, sorting, CPU work, GPU work, layout or waiting? Instrument before choosing a remedy.
- What do frame-time distributions, long stalls, input latency and time to useful content show? Report sample duration and measurement limitations.
- Does the comparison hold content, pose, quality and environment constant? Separate cold/warm caches, startup, steady motion, interaction and long-session thermal behavior.
- Does repeated loading, switching or recovery cause retained CPU/GPU resources? Inspect ownership before disposing shared assets.
- Would changing work scheduling, asset delivery, culling, batching, data layout or representation address the bottleneck? Compare the cost and visual consequences.
- Are production metrics available and privacy-appropriate? Do not claim integrations or GPU timing that the environment cannot provide.

## Quality and evidence

The founder's current brief targets 60 fps with fast loading and visual quality parity on supported devices. Historical 30 fps tiers, lower-resolution textures and reduced effects are not final acceptance criteria. Temporary previews or recovery modes must be identified as such.

Budgets are measured engineering targets, not universal hardware laws. Do not invent draw-call caps, heap ceilings or an additive CPU/GPU frame budget; justify thresholds against the actual workload and platform.

Report before/after measurements and remaining gaps. Headless, emulated or software-rendered results do not qualify physical-device performance. Add stable regressions where useful, and avoid flaky thresholds that hide the signal.
