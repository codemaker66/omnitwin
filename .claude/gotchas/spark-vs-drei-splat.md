**Read this when:** rendering a Gaussian splat (.ply, .spz, .splat
file), modifying any 3D scene component that displays splats, or
seeing drei's Splat component imported anywhere in this repo.

# Spark, NOT drei's Splat

The production Gaussian Splat renderer for Venviewer is **Spark 2.0**
(`@sparkjsdev/spark`), NOT `<Splat />` from `@react-three/drei`.

## Why
- Spark is actively maintained by World Labs + OSS community
- Spark integrates natively with Three.js scene graphs (SplatMesh
  extends THREE.Object3D), enabling hybrid splat-and-mesh rendering
- Spark handles spherical-harmonic-correct object-space transforms
  (drei's Splat does not)
- Spark supports the SPZ format which is our production splat format
- drei's Splat is a prototyping tool with no LOD, no compositing
  support, and no SH-aware transform handling
- GaussianSplats3D (mkkellogg) is explicitly deprecated by its own
  author in favor of Spark

## The rule
- Never import `Splat` from `@react-three/drei`
- Always use `SplatMesh` from `@sparkjsdev/spark`
- Splat files in production are `.spz`, never `.ply`
- The full splat file is archival; a cropped reflective-surfaces
  splat is what gets rendered (chandeliers, mirrors, glass only)

## Reference pattern

```typescript
import { SplatMesh } from "@sparkjsdev/spark"

function VenueSplat({ url }: { url: string }) {
  // SplatMesh is a THREE.Object3D — use it directly in R3F via primitive
  const splat = new SplatMesh({ url })
  return <primitive object={splat} />
}
```

Spark requires Three.js ≥ 0.180.0; Venviewer upgraded the web renderer stack
to the 0.180 compatibility line in T-087.

See also: `.claude/council/MR_GENJUTSU.md` for the strategic
architectural reasoning behind hybrid splat-and-mesh composition.
