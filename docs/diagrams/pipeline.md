# Capture-to-runtime data pipeline

How a venue capture becomes a rendered scene. RunPod is the canonical training environment per D-006a. Local Windows training has been deprecated as of 2026-04-25.

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
flowchart LR

    subgraph capture [capture (current)]
        cap_lidar(["E57 LiDAR (Pro3)"])
        cap_pano(["Pro3 panoramas"])
        cap_obj(["MatterPak OBJ"])
    end

    subgraph processing [processing (RunPod)]
        proc_pano_extract(["Pano extraction"])
        proc_cubemap(["Cubemap conversion"])
        proc_colmap(["COLMAP pose solve"])
        proc_depth(["Depth supervision"])
        proc_gsplat(["gsplat MCMC + bilateral grid"])
        proc_residual(["Automatic residual extraction"])
        proc_spz(["SPZ export"])
    end

    subgraph delivery [delivery]
        del_bundle(["Signed AssetVersion bundle"])
        del_r2(["R2 storage"])
    end

    subgraph runtime [runtime composite]
        rt_base(["Projective texture base (D-004a)"])
        rt_splat(["Cropped splat residual (D-005a)"])
        rt_furn(["Furniture meshes"])
        rt_ui(["UI overlays"])
    end

    cap_lidar --> proc_depth
    cap_pano --> proc_pano_extract
    cap_obj -- "icp anchor" --> proc_colmap
    proc_pano_extract --> proc_cubemap
    proc_cubemap --> proc_colmap
    proc_cubemap --> proc_gsplat
    proc_colmap --> proc_gsplat
    proc_depth -- "e57-derived" --> proc_gsplat
    proc_gsplat --> proc_residual
    proc_residual --> proc_spz
    proc_spz --> del_bundle
    proc_cubemap --> del_bundle
    proc_depth --> del_bundle
    del_bundle --> del_r2
    del_r2 -- "atlas + depth packs" --> rt_base
    del_r2 -- "cropped .spz" --> rt_splat

    classDef done fill:#b8965a,color:#1a2e3b
    classDef inprogress fill:#7d9579,color:#f4ede0
    classDef deferred fill:#3a3a3a,color:#f4ede0
    classDef blocked fill:#a85842,color:#f4ede0
    classDef notstarted fill:#f4ede0,color:#1a2e3b

    class cap_lidar,cap_pano,cap_obj notstarted
    class proc_pano_extract,proc_cubemap,proc_colmap,proc_depth,proc_gsplat,proc_spz inprogress
    class proc_residual notstarted
    class del_bundle,del_r2 notstarted
    class rt_base,rt_splat,rt_furn,rt_ui done
```

Capture nodes use the off-white "not started" colour because they are inputs to the pipeline rather than process states tracked by us. Automatic residual extraction is planned per D-005a (replaces manual SuperSplat cropping). The signed AssetVersion bundle is the formal training-runtime boundary per D-014.

## When to update

Regenerate after capture, training, or runtime stage changes. Particularly when a stage moves between status colours — for example, automatic residual extraction landing flips `proc_residual` to gold, or the AssetVersion bundle going live flips `del_bundle` to gold. Also regenerate when a new stage is added (e.g., 3DGUT training mode landing per D-006a).
