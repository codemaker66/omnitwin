# System architecture

Venviewer's runtime, API, data, training, and deployment topology. Codenames `omnitwin-web` (Vercel) and `omnitwinapi-production` (Railway) are internal-only deployment artifacts. Customer-facing surfaces use the name **Venviewer**.

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

    subgraph browser [browser runtime]
        br_next(["Next.js 15"])
        br_r3f(["React Three Fiber + drei"])
        br_spark(["Spark 2.0 (@sparkjsdev/spark)"])
        br_three(["Three.js 0.170 (0.180 pending)"])
        br_zustand(["Zustand"])
    end

    subgraph api [api layer]
        api_fastify(["Fastify"])
        api_trpc(["tRPC"])
        api_clerk(["Clerk auth"])
        api_svix(["svix webhooks"])
    end

    subgraph data [data]
        d_neon(["Neon PostgreSQL 17 (eu-west-2)"])
        d_drizzle(["Drizzle ORM"])
        d_yjs(["Yjs CRDT"])
    end

    subgraph storage [storage]
        s_r2(["Cloudflare R2 (assets)"])
        s_resend(["Resend (email)"])
    end

    subgraph training [training pipeline (RunPod, per D-006a)]
        tr_a100(["A100 80GB"])
        tr_gsplat(["gsplat 1.5.3"])
        tr_colmap(["COLMAP"])
        tr_pye57(["pye57"])
        tr_mip(["Mip-Splatting (planned)"])
        tr_dn(["DN-Splatter (planned)"])
        tr_3dgut(["3DGUT (planned)"])
    end

    subgraph deploy [deployments]
        dep_vercel(["Vercel — omnitwin-web"])
        dep_railway(["Railway — omnitwinapi-production"])
    end

    browser <-- "tRPC over HTTPS" --> api
    api <-- "Drizzle queries" --> data
    api -- "presigned URLs" --> storage
    data -- "schema" --> storage
    training -- "uploads bundles" --> storage
    training -- "writes records" --> data
    storage -- "serves assets" --> browser

    classDef done fill:#b8965a,color:#1a2e3b
    classDef inprogress fill:#7d9579,color:#f4ede0
    classDef deferred fill:#3a3a3a,color:#f4ede0
    classDef blocked fill:#a85842,color:#f4ede0
    classDef notstarted fill:#f4ede0,color:#1a2e3b

    class br_next,br_r3f,br_spark,br_three,br_zustand done
    class api_fastify,api_trpc,api_clerk,api_svix done
    class d_neon,d_drizzle,d_yjs done
    class s_r2,s_resend done
    class tr_a100,tr_gsplat,tr_colmap,tr_pye57 done
    class tr_mip,tr_dn,tr_3dgut notstarted
    class dep_vercel,dep_railway done
```

Three.js sits at 0.170 today; the 0.180 upgrade is required before any Spark integration work begins (D-002). Mip-Splatting, DN-Splatter, and 3DGUT are planned training-pipeline additions called out by D-006a.

## When to update

Regenerate after stack or dependency changes — Three.js 0.170 → 0.180 upgrade landing (flip `br_three` label and keep gold), a new training tool integrated (Mip-Splatting / DN-Splatter / 3DGUT flipping to gold), a new deployment target added, or any boxed component swapped.
