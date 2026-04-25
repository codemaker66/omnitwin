# ADR dependency and supersession graph

The 22 architecture decision records in `docs/architecture/adr/` and how they relate. Source of truth is the index at `docs/architecture/adr/README.md`; if status disagrees, the index wins.

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

    subgraph runtime [current web runtime — accepted]
        D001(["D-001 — Spark, not drei"])
        D002(["D-002 — Three.js ≥ 0.180"])
    end

    subgraph founding_super [founding — superseded]
        D003(["D-003 — five-asset pipeline"])
        D004(["D-004 — projective texturing"])
        D005(["D-005 — cropped splat"])
        D006(["D-006 — gsplat MCMC"])
    end

    subgraph reframings [reframings — proposed]
        D003a(["D-003a — layered radiance graph"])
        D004a(["D-004a — v1 base appearance"])
        D005a(["D-005a — residual layer"])
        D006a(["D-006a — gsplat + 3DGUT"])
    end

    subgraph founding_accepted [founding — accepted unchanged]
        D007(["D-007 — three camera modes"])
        D008(["D-008 — venue tenancy"])
    end

    subgraph new_proposed [new — proposed]
        D009(["D-009 — VSIR-0 typed graph"])
        D010(["D-010 — pose-frame"])
        D011(["D-011 — confidence budget"])
        D012(["D-012 — truth-mode separation"])
        D013(["D-013 — format strategy"])
        D014(["D-014 — venue artifact factory"])
        D015(["D-015 — capture tiers"])
    end

    subgraph workflow [workflow — proposed]
        D070(["D-070 — files in git"])
        D071(["D-071 — mermaid"])
        D072(["D-072 — task-master-ai deferred"])
    end

    D003 -- "supersedes" --> D003a
    D004 -- "supersedes" --> D004a
    D005 -- "supersedes" --> D005a
    D006 -- "supersedes" --> D006a
    D003a -- "abstracts" --> D009
    D005a -- "abstracts" --> D009
    D004a -- "uses interface from" --> D009
    D009 -- "depends on graph" --> D010
    D009 -- "depends on graph" --> D011
    D011 -- "extends QA model" --> D012
    D009 -- "format from graph" --> D013
    D013 -- "uses formats" --> D014
    D006a -- "training in" --> D014
    D011 -- "tiers from QA" --> D015
    D070 -- "enables" --> D071
    D070 -- "enables" --> D072

    classDef done fill:#b8965a,color:#1a2e3b
    classDef inprogress fill:#7d9579,color:#f4ede0
    classDef deferred fill:#3a3a3a,color:#f4ede0
    classDef blocked fill:#a85842,color:#f4ede0
    classDef notstarted fill:#f4ede0,color:#1a2e3b

    class D001,D002,D007,D008 done
    class D003,D004,D005,D006 deferred
    class D003a,D004a,D005a,D006a,D009,D010,D011,D012,D013,D014,D015,D070,D071,D072 inprogress
```

Status legend: gold = Accepted, charcoal = Superseded, sage = Proposed. Terracotta (Blocked) is reserved for future use; off-white (Not started) is not used in this graph because every ADR has at least proposed status.

## When to update

Regenerate after each ADR landing or status change. Status colours come from `docs/architecture/adr/README.md`'s status tables — that file is authoritative if the two ever disagree. Manual cadence for now; consider `scripts/generate-diagrams.ts` after two weeks of manual flow if the diagram is actually being consulted (per D-071).
