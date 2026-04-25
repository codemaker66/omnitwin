# Scene graph — VSIR-0 typed spatial-layer graph

VSIR-0 typed spatial-layer graph per D-009. Designed to be USD-isomorphic — mirror semantics to `UsdVolParticleField3DGaussianSplat` when Khronos KHR_gaussian_splatting ratifies (expected Q2 2026).

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#f4ede0',
    'primaryTextColor': '#1a2e3b',
    'primaryBorderColor': '#1a2e3b',
    'lineColor': '#3a3a3a',
    'secondaryColor': '#b8965a',
    'tertiaryColor': '#7d9579',
    'fontFamily': 'Georgia, serif'
  }
}}%%
flowchart TD

    subgraph truth [truth layers]
        t_survey(["Survey truth: E57, control points, certified dimensions"])
        t_structural(["Structural truth: geometry, mesh, planes, walls, doors"])
        t_semantic(["Semantic truth: rooms, exits, rigging, fragile zones"])
        t_photographic(["Photographic truth: panoramas, projection, splats"])
        t_operational(["Operational truth: capacities, setups, vendor access"])
        t_commercial(["Commercial truth: pricing, availability, conversion"])
        t_event(["Event truth: configurations, approvals, BEO"])
    end

    subgraph crosscut [cross-cutting]
        c_access(["Access layer: redaction, RBAC, watermarking, expiry, audit"])
        c_confidence(["Confidence layer: per-layer QA metrics (D-011)"])
    end

    subgraph recipes [render recipes]
        r_spark(["Spark + WebGL2 (current)"])
        r_gltf(["glTF + KHR_gaussian_splatting (target Q2 2026)"])
        r_usd(["OpenUSD / Hydra (future)"])
    end

    t_survey & t_structural & t_semantic & t_photographic & t_operational & t_commercial & t_event --> c_access & c_confidence
    c_access & c_confidence --> r_spark & r_gltf & r_usd

    classDef done fill:#b8965a,color:#1a2e3b
    classDef inprogress fill:#7d9579,color:#f4ede0
    classDef deferred fill:#3a3a3a,color:#f4ede0
    classDef blocked fill:#a85842,color:#f4ede0
    classDef notstarted fill:#f4ede0,color:#1a2e3b

    class t_survey,t_structural,t_semantic,t_photographic,t_operational,t_commercial,t_event done
    class c_access,c_confidence inprogress
    class r_spark done
    class r_gltf,r_usd notstarted
```

Every truth layer feeds both cross-cutting layers (access and confidence). Both cross-cutting layers feed every render recipe. The structure is what makes a switch of render recipe (Spark today, glTF when KHR ratifies, OpenUSD later) a recipe-swap rather than a rewrite.

## When to update

Regenerate when D-009 (VSIR-0) or any cross-cutting ADR (D-011 confidence budget, D-012 truth-mode separation) lands a structural change. The render-recipe row updates when D-013 (format strategy) pins a new target — for instance, when KHR_gaussian_splatting ratifies and `r_gltf` flips to gold, or when an OpenUSD/Hydra path is demonstrated and `r_usd` moves off-white.
