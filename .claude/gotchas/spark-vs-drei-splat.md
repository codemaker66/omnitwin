**Read this when:** choosing or changing the splat renderer, loading captured assets,
or seeing drei's `Splat` imported into a scene.

# Spark integration

Venviewer uses `@sparkjsdev/spark`, with versions pinned in
[the web manifest](../../packages/web/package.json) and lockfile. The current
integration is Spark 2.1 / Three 0.180; check the installed versions before using
API advice. The accepted renderer decision is [D-001](../../docs/architecture/adr/D-001.md).
Use the existing
[SparkSplatLayer](../../packages/web/src/components/scene/SparkSplatLayer.tsx) and
scene renderer host rather than introducing drei's `Splat` or another independent
host.

Create/dispose GPU objects through the established lifecycle, not in a React
render body. Preserve asynchronous cancellation, callbacks, invalidation and
renderer ownership. Verify actual source/format/transform behavior; the package
name alone does not establish SH, sorting, paging or compositing correctness.

Earlier notes prescribed Spark 2.0, SPZ-only delivery and reflective-only cropped
splats. Those recipes are superseded by current source and founder direction:
the current runtime also serves SOG, and the reconstruction programme may combine
all useful sources. Choose delivery formats and composition from actual manifests,
measured fidelity, loading and memory. Preserve source masters.

Read related notes on callback identity, hidden layers and render-target effects
when changing those paths. A different rendering approach can be tested in a
bounded experiment under the active brief; adopting it requires an evidenced
decision and the relevant acceptance checks.
