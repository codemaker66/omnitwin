# Crafted furniture

The 20 catalogue items Blake supplied as models (Hyper3D Rodin exports, 50k–217k
triangles and up to 12 MB each) are drawn in code to the same designs. Blake,
during T-652: "we don't need to use the furniture I uploaded, it would be good if
they were of similar design but you can make them from scratch".

## Where it lives

| Piece | File |
| --- | --- |
| Which slugs are crafted, preview URLs (no 3D imports) | `packages/web/src/lib/crafted-furniture.ts` |
| Factory per slug, size validation | `packages/web/src/components/meshes/crafted/crafted-registry.ts` |
| Chairs (Turini velvet, checked) | `crafted-chairs.ts` |
| Clothed rounds and trestles, cake, ceremony, bare trestles, cafés, poseurs | `crafted-tables.ts`, `crafted-drapes.ts`, `crafted-poseur.ts` |
| Bar, servery, platform, divider | `crafted-cabinets.ts` |
| Surfaces: tubes, lathes, cloth, skirts, cushions | `crafted-geometry.ts` |
| Palette and code-painted maps | `crafted-materials.ts`, `crafted-textures.ts` |
| Merge by material, appearance, disposal | `crafted-model.ts`, `CraftedFurniture.tsx` |
| Side-by-side lab and preview studio (dev only) | `packages/web/src/pages/FurnitureLabPage.tsx`, `/dev/furniture` |

`FurnitureProxy` resolves a crafted slug to the `crafted` mesh kind before the
generated proxies, so five slugs that also have a generated proxy (`trestle-6ft`,
`platform`, `bar-counter`, both poseur colours) draw crafted. None of those was
inspectable before: the inspection dock only takes generated proxies without a
supplied model. `standaloneFurnitureMeshUrl` returns null for crafted pieces, so
the planner downloads no furniture GLB.

## Rules the code keeps

- **Footprint.** Every factory draws to the catalogue's width, depth and height.
  Cloth, cascades and pleats may stand a few centimetres proud; the per-slug
  allowances are in `__tests__/crafted-furniture.test.ts`. A round's cloth keeps
  its crests within 3.5 cm of the top's edge, because the chair ring
  (`lib/table-group.ts`) seats each chair's front 5 cm off it.
- **Batching.** Every geometry carries exactly position, normal and uv, indexed;
  every material is named `crafted:<id>` and every map `crafted:<id>`. The
  instancing harvest (`InstancedFurnitureLayer`) merges by material signature, so
  each crafted type draws in one call per material. The timeline preview batches
  crafted pieces through the same layer.
- **Ownership.** Each model owns its geometries and materials and disposes them;
  the maps are built once per page and shared, never disposed.
- **Metric UVs.** UVs are in metres and each map's repeat is its real tile size,
  so weave, grain and felt keep one texel density everywhere.
- **Budgets.** Chairs at most 10,000 triangles (a hall seats hundreds), anything
  else at most 30,000. Measured: chairs 7.6k, 6 ft rounds 17.6k, the ceremony
  table 27k.

## Previews

The catalogue keeps the supplied `meshUrl` and `thumbnailUrl`: the database seeds
`asset_definitions` from it and rejects changes to either. The web maps crafted
slugs to their own previews in `public/models/furniture/<slug>/crafted-v1/`, which
the catalogue picker and the dashboard inventory show.

```sh
pnpm --filter @omnitwin/web dev   # in one shell
node packages/web/scripts/render-crafted-previews.mjs http://localhost:5173 [slug ...]
```

`CHROMIUM_PATH` may name a Chromium binary when Playwright's own is missing. The
versioned folder is served immutable (`vercel.json`): when a design change alters
how a piece looks, bump `CRAFTED_PREVIEW_VERSION` and render into the new folder.

## Comparing against the supplied models

`/dev/furniture` places each crafted piece beside the GLB it replaces in the hall's
light; `window.__furnitureLab` frames any piece (`focus`, `setPose`, `setMood`,
`setCompare`, `setBackdrop`) for headless review.
