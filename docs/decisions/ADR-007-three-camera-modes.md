# ADR-007 — Three camera modes, one scene graph
Status: Accepted. Date: 2026-04-23.

Venviewer is ONE product with three camera modes, not three products:
- **Pano-locked**: inside a panorama sphere, look around, click to
  teleport (photographic mode only)
- **Free-fly**: first-person walk through the composite scene
  (photographic or schematic)
- **Dollhouse**: overhead orbital for planning (photographic or
  schematic)

All three modes operate on a single scene graph (the
`editor-store.ts:scene: Scene | null` reference, populated by
SceneProvider) and a single Zustand store. Mode transitions are
animated camera changes (~500ms ease), not page navigations. Assets
load once; render paths pre-warm at scene load.

Schematic vs photographic is an orthogonal axis: any camera mode can
render either, depending on whether the venue has photographic assets.
A "hybrid" rendering (schematic geometry with photographic texture
overlays in regions where panoramas exist) is a possible third option,
deferred.

Why:
- Matterport's success with "inside view" + "dollhouse view" validates
  that multiple camera modes of the same scene outperform separate
  products
- Planning-tool users need both: photographic fidelity (inside) and
  overhead comprehension (dollhouse)
- Two products = double build cost, double maintenance, halved brand
  coherence
- The existing parametric editor already implements this pattern
  implicitly (one Three.js scene, multiple camera positions via
  CameraRig); photographic mode extends rather than replaces

Consequences:
- Scene graph is a single `THREE.Group` with mode-conditional render
  flags on child nodes (splat overlay disabled in pano-locked,
  projection disabled in dollhouse, etc.)
- Mode switch logic lives in camera state machine; never touches asset
  loading
- Mode-specific render paths (projection shader active/inactive,
  splat visible/invisible) must be pre-warmed on scene load to avoid
  first-switch frame drop
- Furniture placement works in all three modes; drag in free-fly,
  place in dollhouse, review in pano-locked — same scene state
- Photographic vs schematic is a render-flag toggle on the scene
  itself, not a separate scene; venues without photographic assets
  simply default to schematic

Supersedes: the "two separate products" proposal from Blake's
2026-04-22 chat, before the unified architecture landed.
