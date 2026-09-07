**Read this when:** adding shadows, probes, postprocessing or another render pass
to a scene containing Spark splats.

# Check interactions between render targets and splat sorting

A 2026-08-06 Reception Room experiment rendered correctly until drei
`ContactShadows` added an off-screen scene pass; near-floor splats became
multicoloured blobs and the ceiling blew out. Removing that effect restored the
scene. The report used drei 9.122.0 / Three 0.180.0; screenshots were shown then
but were not retained as a committed regression. This is historical reproduction
evidence, not a CI-proven guarantee about every effect or newer Spark build.

Extra cameras/targets may interact with Spark's sort/renderer state. Verify the
mechanism against the installed renderer and reproduce the specific integration
before attributing every artifact to off-screen rendering. Keep one clear owner for
the scene's renderer resources and test camera moves, load transitions and disposal.

Baked environment/shadow inputs or an independently composed overlay may avoid the
observed conflict. They are options, not a universal ban on live probes or extra
passes. Evaluate a proposed integration in a bounded fixture with matched before/
after stills and motion, depth/occlusion correctness, GPU costs and cleanup checks.
Do not ship a known-corrupt path or claim compatibility from a static screenshot.
