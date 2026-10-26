# Crafted furniture

Every piece of the catalogue that stands in the room, 44 of its 47, is drawn in
code (T-652 drew the 20 Blake supplied as Hyper3D Rodin exports, 50k–217k
triangles and up to 12 MB each; T-675 rebuilt those and drew the other 24). The
other three are dressings, the two table cloths and the place setting: they
dress a table they are dropped on (`lib/table-dressing.ts`) and draw nothing of
their own. Blake, during T-652: "we don't need
to use the furniture I uploaded, it would be good if they were of similar design
but you can make them from scratch"; on 26 Oct 2026 (T-675): "rebuild all
furniture to look recognisable but to be of the best quality visually and
performance that will be able to hold shadows stunningly when the lighting in
the rooms change".

## What it is modelled from

Trades Hall's own photographs (tradeshallglasgow.co.uk) and its equipment
inventory (`D:/claude/lane10-intake/trades-hall-equipment-source-review-2026-09-05.md`),
then Blake's supplied models and maker data. The photographs settle what the
venue's events look like: gold Chiavari chairs with ivory pads at every round of
a Grand Hall dinner or wedding (200 in stock), rounds in floor-length ivory
damask, the red checked banquet chair in theatre rows, black 130 in cloths on the
black rounds (2 cm clear of the floor on a 6 ft round at 30 in), staging as
6 × 4 ft decks. A dimension measured to differ from the catalogue goes to the
catalogue's owner with its effect (capacities, the chair ring, gangways); the
models never change the catalogue themselves.

## Where it lives

| Piece | File |
| --- | --- |
| Which slugs are crafted, the previews' version (no 3D imports) | `packages/web/src/components/meshes/crafted/crafted-slugs.ts`, read through `packages/web/src/lib/crafted-furniture.ts` |
| Factory per slug, size validation | `packages/web/src/components/meshes/crafted/crafted-registry.ts` |
| The Chiavari | `crafted-chiavari.ts` |
| Banquet chairs in the Turini shape (coral, pink, red and gold, checked, plain) | `crafted-chairs.ts` |
| Clothed and bare rounds and trestles, cake, ceremony, cafés, poseurs | `crafted-tables.ts`, `crafted-drapes.ts`, `crafted-poseur.ts` |
| Staging decks, platforms, the dance floor panel | `crafted-staging.ts` |
| Bar, servery, divider | `crafted-cabinets.ts` |
| Lectern, screens, television, microphones, projector, laptop | `crafted-av.ts` |
| Highchairs | `crafted-extras.ts` |
| Surfaces: tubes, lathes, cloth, skirts, cushions | `crafted-geometry.ts` |
| Baked occlusion | `crafted-ao.ts` |
| Sun shadow casters, the feet's floor shade | `crafted-shadow.ts` |
| Phone and desktop detail | `crafted-detail.ts` |
| Palette (node materials) and code-painted maps | `crafted-materials.ts`, `crafted-textures.ts` |
| Merge by material, appearance, disposal | `crafted-model.ts`, `CraftedFurniture.tsx` |
| Side-by-side lab and preview studio (dev only) | `packages/web/src/pages/FurnitureLabPage.tsx`, `/dev/furniture` |
| Frames in the real sky's light, frame times | `packages/web/scripts/furniture-light-frames.mjs` on `/dev/planner-lab` |

`FurnitureProxy` resolves the dressings first (they draw nothing), then a
crafted slug to the `crafted` mesh kind before the generated proxies, so every
catalogue piece draws crafted and no generated proxy is reached. The inspection
dock and its "generated" badge only take generated proxies, so for the catalogue
they now have nothing to show. `standaloneFurnitureMeshUrl` returns null for
crafted pieces, so the planner downloads no furniture GLB.

## Rules the code keeps

- **Footprint.** Every factory draws to the catalogue's width, depth and height.
  Cloth, cascades and pleats may stand a few centimetres proud; the per-slug
  allowances are in `__tests__/crafted-furniture.test.ts`. A round's cloth keeps
  its crests within 3.5 cm of the top's edge, because the chair ring
  (`lib/table-group.ts`) seats each chair's front 5 cm off it.
- **Batching.** Every geometry carries exactly position, normal, uv and `ao`,
  indexed; every material is named `crafted:<id>` and every map `crafted:<id>`.
  The palette is node materials (three/webgpu), so the instancing harvest's
  signature (`lib/furniture-instancing.ts`) keys them by name; it merges by that
  signature, so each crafted type draws in one call per material. The timeline
  preview batches crafted pieces through the same layer.
- **Occlusion.** Phones and tablets get no screen-space occlusion
  (`lib/render-quality.ts`), so every piece bakes its own into the `ao`
  attribute as it is built, and its materials apply it to ambient and reflected
  light only. Each piece describes itself to the bake as a few boxes (legs,
  rails, seat, top); a box's occlusion of a vertex is exact (Lambert's polygon
  formula over the faces it turns to the vertex, clipped to the vertex's
  horizon). The floor occludes what faces it within a range (0.52 m for a chair,
  whose seat's underside stands 0.4 m up); cloth adds a cavity term for its fold
  valleys. Vertices a centimetre apart facing the same way share one
  evaluation.
- **Sun and moon shadows.** A piece casts the shadow map with its
  `shadow-caster` part alone: the same boxes, set in a few millimetres (so a lit
  face never shadows itself into acne), thickened to the map's least useful
  width, on the stand-ins' layer (`HALL_SUN_CASTER_LAYER`, which only shadow
  cameras see; the instancing harvest keeps each batch's layers), drawn by a
  material that would also be discarded in a view (`maskNode` false) and kept in
  the shadow pass (`maskShadowNode` true). The view never draws a caster: no
  pipeline, no vertices, no pick, and none at all without the real sky. Any
  other light that casts must see that layer too (the lab's studio light does).
  What is seen only receives. A chair casts
  with a few hundred triangles instead of several thousand; a clothed round with
  a coarse copy of its drape set in along its normals (`shadow-sheet`, cast
  from both faces), so a fold's valley lies outside its own caster. The
  phone's caster drops the spindles, which would only flicker in its coarser
  map. A ghost (the placement preview, faded or tinted) casts nothing, so a
  drag brings no caster into the shadow pass.
- **Contact.** Each foot leaves a soft spot of shade on the boards (the
  `contact` part, unlit, blended, never cast), which no shadow map is fine
  enough to draw: every leg reads as standing on the floor in any light, under
  the sun's normal offset as under the chandeliers, which cast no shadows. It
  shares its piece's instance transforms, so while a reveal (the Grand
  Assembly) moves or hides a batch's pieces, that batch's shade is not drawn
  and `FurnitureContactShadows` grounds them as the reveal presents them.
- **Detail.** A phone draws each piece with fewer segments round its turned and
  bent parts and fewer cloth samples (`crafted-detail.ts`): same footprint,
  same caster, same materials. So does a software rasteriser (SwiftShader,
  llvmpipe), read once from a released probe WebGL context the hall's way
  (`classifyDevice` "poster"): every triangle costs its CPU in every pass. On
  SwiftShader the Grand Assembly's show then plays in 34.6 s against master's
  40.2 s (45.0 s at full detail). The level is fixed for the page.
- **Ownership.** Each size of each piece is built once and its geometry shared
  by every copy (`crafted-registry.ts`, a cache of at most 48 sizes); another
  copy takes under 1 ms, which matters to the chair brush's preview and the
  instancing templates. A first build on a desktop (warm, maps already
  painted): chairs 16–48 ms, a clothed round 50–80 ms (most of it the cloth's
  occlusion bake), the bar and the servery about 100 ms. Lean detail builds a
  chair in 8–21 ms and a clothed round in 12–15 ms. Each copy owns only its
  materials, which the placement ghost fades and tints. The maps are built once
  per page and shared, never disposed.
- **Shading.** Materials draw front faces only. The open cloth sheets (linen,
  damask, the black cloth, spandex, the stage skirt) cast from both faces
  wherever what is seen casts (a piece built without a caster: no catalogue piece is), as the drape
  casters do, or a skirt's shadow breaks into strips. Lathe profiles may be
  written either way up.
- **Metric UVs.** UVs are in metres and each map's repeat is its real tile size,
  so weave, grain and felt keep one texel density everywhere.
- **Budgets.** What is seen: chairs at most 10,000 triangles (a hall seats
  hundreds), anything else at most 30,000. What casts: a chair at most 600, anything
  else at most 3,000. Measured at full detail / lean: chairs 6.7k–8.4k / 3.3k–4.9k,
  their casters 108–264; a clothed 6 ft round 19.2k / 9.1k, its caster 2.5k; the
  ceremony table 26.3k (supplied models: 50k–217k). At 180 seats on the 4090 the
  branch's frame matches master's (p95 11.6 ms desktop, 9.3–10.0 ms in the phone
  profile), with half the triangles seen in the phone profile and 4 % of them in the
  sun's map (`scripts/furniture-light-frames.mjs --frames 240`; `--refit 1` redraws
  the map every frame).
- **Painted maps.** Each map is painted on the CPU the first time a material
  needs it and kept for the page. The damask's figure is mirrored and on a half
  drop, so a quarter of its tile is evaluated and copied (exactly, tested), its
  shapes skipped where a pixel is clear of them, and its colour and roughness
  maps share the one figure; the parquet's two maps share theirs. First use on a
  desktop: the damask 82 ms, the parquet 101 ms, any other map under 30 ms.

## Previews

The catalogue keeps the supplied `meshUrl` and `thumbnailUrl`: the database seeds
`asset_definitions` from it and rejects changes to either. The web maps crafted
slugs to their own previews in `public/models/furniture/<slug>/crafted-v4/` (800 px
square, for the dashboard's 360 px featured picture), which the catalogue picker
and the dashboard inventory show.

```sh
pnpm --filter @omnitwin/web dev   # in one shell
PREVIEW_GPU=1 node packages/web/scripts/render-crafted-previews.mjs http://localhost:5173 [slug ...]
```

`PREVIEW_GPU=1` draws on the GPU through WebGPU, the planner's own renderer, in
a second or two a piece (take the shared GPU lock first on a shared machine);
without it SwiftShader draws on the CPU, which takes minutes. `CHROMIUM_PATH`
may name a Chromium binary when Playwright's own is missing. The
versioned folder is served immutable (`vercel.json`), previews included: when a
change alters how a piece looks, bump `CRAFTED_PREVIEW_VERSION` and render into
the new folder. The script refuses to replace an existing preview unless
`OVERWRITE=1`, which is only right for a version that has never been deployed.

## Comparing against the supplied models

`/dev/furniture` places each crafted piece beside the GLB it replaces in the hall's
light; `window.__furnitureLab` frames any piece (`focus`, `setPose`, `setMood`,
`setCompare`, `setBackdrop`) for headless review.
