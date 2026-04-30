# Task dependency graph

Active backlog: Tier 0 work in flight, schema/ingestion gates, the
audit-driven cluster (T-080–T-099), the Tier 3 Geass cluster, ops/doc
follow-on, and the deferred Product Vision capabilities (T-100–T-110)
per ADR D-018. Tier 1 done work, T-010, and lower-priority Tier 2/4/5/6
tasks live in `docs/state/tasks.md` and are not visualised here.
Regenerate after each `tasks.md` change.

## Subgraph index

- **A1** — this week, RunPod foundation
- **A2** — this week, ops baseline + audit fixes
- **A3** — this week, viewer presentation polish
- **B** — next 2 weeks, gap closing + ops follow-on
- **C** — weeks 3–6, revenue + edge cases
- **D** — Tier 3, Geass cluster
- **E** — Tier 3, operational + doc follow-on
- **F** — Product Vision (deferred), capabilities per D-018

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

    subgraph A1 [a1 · this week — runpod foundation]
        T001(["T-001 — RunPod migration"])
        T002(["T-002 — RunPod runbook"])
        T003(["T-003 — Config B training"])
        T005(["T-005 — eval Config B"])
        T019(["T-019 — E57 depth supervision"])
        T052(["T-052 — Three.js 0.170 → 0.180"])
    end

    subgraph A2 [a2 · this week — ops baseline + audit fixes]
        T060(["T-060 — Sentry"])
        T061(["T-061 — uptime monitoring"])
        T062(["T-062 — backup verification"])
        T063(["T-063 — email sender domain"])
        T069(["T-069 — architecture notes"])
        T080(["T-080 — Clerk CVE upgrade"])
        T081(["T-081 — lint fix"])
        T082(["T-082 — placeholder copy"])
        T083(["T-083 — soften photoreal claim"])
        T084(["T-084 — E2E triage"])
        T085(["T-085 — deploy flow doc"])
        T113(["T-113 — 2D/3D grouped movement"])
    end

    subgraph A3 [a3 · this week — viewer presentation polish]
        T114(["T-114 — Grand Hall visual fidelity"])
    end

    subgraph B [b · next 2 weeks — gap closing + ops follow-on]
        T018(["T-018 — AssetVersion schema"])
        T053(["T-053 — backend ingestion"])
        T064(["T-064 — secrets management"])
        T065(["T-065 — unified logging"])
        T066(["T-066 — PostHog flags + analytics"])
        T086(["T-086 — fix E2E failures"])
        T087(["T-087 — Three 0.180 + Spark"])
        T088(["T-088 — invitation flow"])
        T089(["T-089 — asset upload scoping"])
        T090(["T-090 — replace as-unknown-as"])
        T091(["T-091 — Trades Hall real evidence"])
        T092(["T-092 — frontend Sentry"])
        T093(["T-093 — gated deploy"])
    end

    subgraph C [c · weeks 3–6 — revenue + edge cases]
        T094(["T-094 — Stripe integration"])
        T095(["T-095 — multi-venue routing"])
        T096(["T-096 — editor concurrency"])
        T097(["T-097 — brief privacy"])
        T098(["T-098 — dep reproducibility"])
    end

    subgraph D [d · tier 3 — geass cluster]
        T054(["T-054 — Geass v0+v1+v2"])
        T070(["T-070 — Geass v3 (proactive)"])
        T071(["T-071 — Geass ADR (D-017)"])
    end

    subgraph E [e · tier 3 — operational + doc follow-on]
        T067(["T-067 — CDN cache strategy"])
        T068(["T-068 — DR runbook"])
        T072(["T-072 — email templates"])
        T099(["T-099 — per-package READMEs"])
    end

    subgraph F [f · product vision — deferred, capabilities per D-018]
        T100(["T-100 — Verified Photoreal Twin"])
        T101(["T-101 — Truth Heatmap"])
        T102(["T-102 — Constraint Solver"])
        T103(["T-103 — Prompt-To-Perfect Event"])
        T104(["T-104 — Pricing Engine"])
        T105(["T-105 — Live Planning Room"])
        T106(["T-106 — Lookbook / Style"])
        T107(["T-107 — Event Ops Compiler"])
        T108(["T-108 — Cinematic Share"])
        T109(["T-109 — Audit Trail"])
        T110(["T-110 — Revenue Optimizer"])
    end

    T001 --> T002
    T001 --> T003
    T001 --> T019
    T001 --> T067
    T001 --> T091
    T003 --> T005
    T003 --> T054
    T018 -- "unblocks" --> T053
    T054 --> T070
    T054 -- "concurrent" --> T071
    T062 --> T068
    T063 --> T072
    T080 --> T088
    T080 --> T094
    T080 --> T098
    T084 --> T086
    T085 --> T093
    T087 --> T098

    T091 --> T100
    T100 --> T101
    T087 --> T101
    T091 --> T102
    T018 --> T102
    T087 --> T102
    T102 --> T103
    T104 --> T103
    T107 --> T103
    T080 --> T103
    T094 --> T104
    T018 --> T104
    T018 --> T105
    T080 --> T105
    T064 --> T105
    T018 --> T106
    T018 --> T107
    T102 --> T107
    T100 --> T108
    T087 --> T108
    T067 --> T108
    T018 --> T109
    T105 --> T109
    T102 --> T110
    T104 --> T110
    T107 --> T110

    classDef done fill:#b8965a,color:#1a2e3b
    classDef inprogress fill:#7d9579,color:#f4ede0
    classDef deferred fill:#3a3a3a,color:#f4ede0
    classDef blocked fill:#a85842,color:#f4ede0
    classDef notstarted fill:#f4ede0,color:#1a2e3b

    class T002,T019,T080,T081,T084,T086,T113,T114 done
    class T001 inprogress
    class T003,T005,T018,T052,T060,T061,T062,T063,T064,T065,T066,T067,T068,T069,T071,T072,T082,T083,T085,T087,T088,T089,T090,T091,T092,T093,T094,T095,T096,T097,T098,T099 notstarted
    class T053,T054,T070,T100,T101,T102,T103,T104,T105,T106,T107,T108,T109,T110 deferred
```

`T-053` (Tier 2) is shown because the backend-ingestion script template
is queued for the moment T-018 lands. Edge `T-018 → T-053` carries the
label "unblocks" because it expresses the activation trigger, not a
code-level dependency.

`T-054 → T-070` is a soft activation edge: T-070 also requires ≥ 14 days
of operational history in the `sentinel.events` table before activation,
on top of T-054 being `done`. Hard task-list dependency is on T-054
alone; the history condition lives in the T-070 Notes field.

`T-054 → T-071` carries the label "concurrent" because the ADR is meant
to be written alongside T-054 implementation start, not before — the
dependency runs in the opposite direction from a normal blocking
dependency.

`T-001 → T-067` expresses that the CDN cache strategy needs real bundle
output from RunPod training to define cache headers against.
`T-001 → T-091` is the same pattern: T-091 (Trades Hall real evidence)
is gated on the RunPod migration completing because the entire training
pipeline lives there.

`T-062 → T-068` is a precondition edge: the disaster-recovery runbook
is empty ceremony if backup restore has never been verified.

`T-063 → T-072` expresses that the email template system benefits from
having the sender domain live first, so each template can be live-tested
end-to-end.

`T-080 → T-088`, `T-080 → T-094`, `T-080 → T-098`, `T-080 → T-103`,
`T-080 → T-105` all reflect that the Clerk CVE upgrade blocks
downstream auth-touching work: invitation flow, Stripe integration,
dependency pin, prompt-to-event (touches user identity), and the
multiplayer planning room (per-room access control) all wait for the
auth surface to be patched.

`T-087 → T-098`, `T-087 → T-101`, `T-087 → T-102`, `T-087 → T-108`
reflect the same pattern for the Three.js/Spark upgrade — the modern
runtime is required before any product-vision capability that touches
the renderer can ship.

`T-084 → T-086` was the E2E triage-then-fix sequence: triage found the
current 29-failure state from the older 28-failure audit note, then
T-086 closed it with a full serial web E2E pass.

`T-085 → T-093` is the "document the current state before fixing it"
sequence: the deploy-flow gating work in T-093 needs the honest current
documentation from T-085 as its baseline.

Subgraph F (Product Vision) clusters T-103 + T-104 + T-107 — the
Prompt-to-Layout / Pricing / Ops Compiler triple that ships as one
effort per D-018 §"Activation gates". The T-104 → T-103 and T-107 →
T-103 edges represent that T-103 cannot complete without the other two,
even though the cluster activates them concurrently.

T-064, T-065, T-066 in subgraph B have no incoming edges — independent
ops infrastructure that activates when capacity allows inside the
next-sprint window.

T-089, T-090, T-092 in subgraph B have no incoming edges either —
audit-driven security/typesafety/observability work that doesn't
sequence behind anything.

`T-010` (Tier 1, not-started, impact 2, marked "reopen on first
multi-property customer") is omitted as effectively dormant.

Subgraphs A2 and B contain 12 and 13 nodes respectively — both busy
enough that another node would hurt readability. F contains 11 nodes —
also at the readability ceiling. T-111 and T-112 are Tier 4 VSIR ADR
follow-ups and remain in `docs/state/tasks.md`, not this visual graph.
If more audit or product-vision nodes need visualization, split before
adding more nodes. (`docs/diagrams/_theme.md` line 51 caps a single
diagram at 12 nodes before splitting; subgraphs are the relief
mechanism. The per-subgraph guidance here is readability advice, not
the per-diagram cap.)

## When to update

Regenerate after each `tasks.md` change. Manual for now; automate via
`scripts/generate-diagrams.ts` only if the manual flow proves worthwhile
after two weeks of use.
