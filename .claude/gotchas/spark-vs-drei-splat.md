**Read this when:** choosing the splat renderer or changing captured-asset loading.

# Native Three.js Gaussian rendering

Blake’s 18 September 2026 native migration direction supersedes the earlier Spark
choice. Current implementation guidance is in
[the native runtime note](../../docs/engineering/native-splats.md).

Use `NativeCanvas`, `NativeSplatLayer` and the shared scene host. Preserve global
sorting, SH-aware transforms, original capture data, callback ownership,
cancellation and GPU disposal. Native Gaussian support requires WebGPURenderer
(which also supplies the native WebGL fallback); it does not run on the legacy
WebGLRenderer. Do not replace the host with independent per-tile draws.

The historical filename is retained for existing links. Earlier Spark evidence
is useful as a baseline, not an instruction to reintroduce its dependency.
