# T596 — captured Grand Hall Showcase correction

The generic Showcase used the planner dimensions' long X axis. For the real
21 × 10.5 m layout its final requested position was `[7.98, 1.7, 0.84]`, while
served GH2 is long on Z with X bounds ±5.043551 m. Its aerial/overhead positions
also exceeded the captured 6.88706525 m ceiling. The installed OrbitControls'
planner polar limit then moved that final position to approximately
`[7.9667, 2.0040, 0.8386]`, matching the observed wall-side failure. The screenshot
is preserved at `D:/claude/reference-viewer-20260906/cinematic-capture-boundary-failure.png`.

For the matching staged Grand Hall source, Showcase now follows a 13.2-second
presentation path at X 0.4 m, Y 1.6 m and Z 7.5 → 5 → 2.5 → 7.5 m. It retains
the existing arrival yaw 0.0286 and pitch 0.0784. The linear path is inside the
current descriptor's walk envelope. These poses are authored presentation,
not surveyed observations, accepted registration or a furniture/architecture
collision-checked path. Actual visual and performance qualification remains
necessary.

The tour drains OrbitControls' pending movement and applies each authored pose
with temporary permissive limits, retaining normal options and saved reset state.
Completion **and Escape** deliberately return to editable Interior at the
authored arrival. Escape does not retain a mid-tour position. A newer tour,
different configuration/room/layer or unavailable source cannot be overwritten
by a stale completion. Model/fallback tours keep the generic aerial path.
Registered packages and other captured rooms do not borrow GH2 coordinates;
Showcase is unavailable until a matching path exists. Spark, source assets,
lighting, native resolution and furniture fidelity are unchanged.

Verification in isolated branch `codex/captured-room-showcase`, based on
`b7724403c8373466ec1b37655731786fe4ecd962`:

- 91 targeted tests across nine suites pass: path containment, observed endpoint
  reproduction using actual OrbitControls, pending rotation/pan/dolly draining,
  source identity, command wiring, CameraRig completion/Escape/first-frame
  handoff, bookmark and arrival behavior. The two lifecycle tests were rerun
  after tightening their lint assertions and pass.
- Web and E2E TypeScript checks and lint of all owned source/tests pass.
- Local `vite build --mode test --configLoader runner` passes (3402 modules,
  28.47 seconds). A production-mode attempt correctly failed its authentication
  configuration guard. No production key was synthesized or configuration changed.
- Root independently reviewed the frozen production diff with no material blocker.
  No browser, GPU, server, deployment or production write was performed by this slice.

The integrated real furnished tour, Escape, camera transitions and rendering cost
remain the root's browser qualification gate. This is a demo camera correction,
not completion of reconstruction, PSNR 50+ or furnished 60 fps.
