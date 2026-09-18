**Read this when:** adding shadows, probes, postprocessing, capture exports or
another render pass to a Gaussian splat scene.

# Check interactions between render targets and splat sorting

The native migration on 18 September 2026 supersedes the Spark renderer described
below. See [the native runtime note](../../docs/engineering/native-splats.md) for
the current integration. The historical filename remains for existing links.

The native host owns a single globally sorted draw under `NativeCanvas`. Native
poster exports use an explicit render target on that same renderer and restore
its state afterward; legacy `preserveDrawingBuffer` assumptions do not apply.
Off-screen or nested passes must not acknowledge main-camera source readiness.
That acknowledgement is scoped to the successful outer canvas render and waits
for GPU completion, which still does not prove compositor presentation.

Preserve those boundaries when introducing extra passes. Test camera and target
changes, restoration after errors, source transitions, clipping and disposal.
The historical Spark corruption below neither proves nor disproves compatibility
of a native effect.

## Historical Spark render-target experiment

A 2026-08-06 Reception Room experiment rendered correctly until drei
`ContactShadows` added an off-screen scene pass; near-floor splats became
multicoloured blobs and the ceiling blew out. Removing that effect restored the
scene. The report used drei 9.122.0 / Three 0.180.0; screenshots were shown then
but were not retained as a committed regression. This is historical reproduction
evidence, not a CI-proven guarantee about every effect or newer Spark build.

Extra cameras/targets could interact with that Spark sort/renderer state. Verify the
mechanism against the installed renderer and reproduce the specific integration
before attributing every artifact to off-screen rendering. Keep one clear owner for
the scene's renderer resources and test camera moves, load transitions and disposal.

Baked environment/shadow inputs or an independently composed overlay may avoid the
observed conflict. They are options, not a universal ban on live probes or extra
passes. Evaluate a proposed integration in a bounded fixture with matched before/
after stills and motion, depth/occlusion correctness, GPU costs and cleanup checks.
Do not ship a known-corrupt path or claim compatibility from a static screenshot.
