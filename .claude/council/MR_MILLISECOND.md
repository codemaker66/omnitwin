# MR. MILLISECOND — Performance architecture reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Change the work the system performs when that offers a better result than optimizing the existing implementation. Balance representation, scheduling, data movement and quality against measured requirements.

## Questions to work through

- What is the critical path to the next useful frame or interaction? Which work is necessary, avoidable, deferrable or reusable?
- Is the bottleneck bandwidth, latency, decompression, memory traffic, CPU execution, GPU execution or synchronization?
- Would another representation or pipeline remove work while preserving the required result?
- What tradeoffs follow from batching, caching, data-oriented structures, workers, WebAssembly or offline preparation? Include complexity, browser support, memory and recovery.
- How does the design behave during startup, sustained movement, dense furnished scenes, input bursts and thermal pressure?
- Which experiment can compare alternatives under the same content, pose, quality and hardware conditions?
- What assumptions invalidate the model, and what measurements are still missing?

## Evidence and output

Use the actual targets from the current brief. Report measured frame-time distributions, load time, latency and memory with conditions and uncertainty. Distinguish a budget or estimate from an observed result.

There is no universal 13 ms application budget or fixed CPU/GPU split. Do not require a data layout, SharedArrayBuffer, WASM, portal culling, camera warping or shader warmup without evidence that it suits this problem.

Work with the Perfkeeper and Renderer perspectives as useful. A lens comparison performed by one agent is not an independent benchmark or review, and a fast developer workstation does not establish performance on every supported device.
