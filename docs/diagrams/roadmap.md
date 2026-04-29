# Venviewer feature roadmap

Time-banded view of shipped product, in-flight foundation work, and the
eleven Product Vision capabilities per ADR D-018. Snapshot as of
2026-04-29.

The visual hierarchy is deliberate: gold marks the two strategic peaks
(the moat and the demo), sage marks what's currently in motion,
terracotta marks the one piece of risk, charcoal marks deferred, and
the rest is calm cream. The eye should land on gold first.

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

    subgraph A [now · shipped]
        direction TB
        A1["Trades Hall Grand Hall"]:::neutral
        A2["RTS camera + section plane"]:::neutral
        A3["Onboarding + brief"]:::neutral
        A4["Splat pipeline + E57 depth"]:::neutral
        A5["Confidence budget + ADRs"]:::neutral
    end

    subgraph B [this week]
        direction TB
        B0[/"Clerk CVE patch"\]:::risk
        B1["Honest copy + lint"]:::motion
        B2["E2E triage"]:::motion
        B3["Sentry + uptime + backups"]:::motion
        B4["Email sender domain"]:::motion
    end

    subgraph C [next 2 weeks]
        direction TB
        C0(["Trades Hall real evidence"]):::peak
        C1["Three.js 0.180 + Spark runtime"]:::motion
        C2["Auth integrity + tenant scoping"]:::motion
        C3["Logs + flags + gated deploy"]:::motion
    end

    subgraph D [weeks 3 – 6]
        direction TB
        D1["Stripe · checkout + portal"]:::neutral
        D2["Multi-venue routing fix"]:::neutral
        D3["Editor optimistic concurrency"]:::neutral
        D4["Brief privacy + provenance"]:::neutral
    end

    subgraph E [weeks 7 – 12]
        direction TB
        E1["Geass v0+v1+v2 + ADR D-017"]:::neutral
        E2["Geass v3 proactive"]:::neutral
        E3["DR runbook + CDN strategy"]:::neutral
        E4["Email templates + READMEs"]:::neutral
    end

    subgraph F [product vision · D-018]
        direction TB
        F1["Verified Photoreal Twin"]:::deferred
        F2["Truth Heatmap"]:::deferred
        F3["Constraint Solver"]:::deferred
        F_DEMO(["Prompt-to-Perfect Event<br/>· the demo"]):::peak
        F_PRICE["Pricing Engine"]:::deferred
        F_MOAT(["Event Ops Compiler<br/>· the moat"]):::peak
        F4["Live Room · Style · Audit Trail"]:::deferred
        F5["Cinematic Share + Revenue Optimizer"]:::deferred
    end

    A --> B --> C --> D --> E --> F

    classDef peak fill:#b8965a,color:#1a2e3b,stroke:#1a2e3b,stroke-width:2px
    classDef motion fill:#7d9579,color:#f4ede0,stroke:#1a2e3b
    classDef deferred fill:#3a3a3a,color:#f4ede0,stroke:#1a2e3b
    classDef risk fill:#a85842,color:#f4ede0,stroke:#1a2e3b,stroke-width:2px
    classDef neutral fill:#f4ede0,color:#1a2e3b,stroke:#1a2e3b
```

## Reading the visual

The roadmap reads left-to-right: each column is a phase, each pill is
a feature or a bundle of related features. Status is encoded in colour
and shape, not in additional labels.

- **Gold, stadium-shaped** — strategic peaks. There are exactly three
  of them across the entire roadmap because three is what the eye can
  hold without losing focus: *Trades Hall real evidence* (closes the
  largest acquisition gap), *Prompt-to-Perfect Event* (the demo every
  customer opens with), *Event Ops Compiler* (the moat against Cvent /
  Matterport / Prismm). Everything else is in service of these.
- **Terracotta, trapezoidal** — the one piece of immediate risk. Clerk
  has three critical CVEs blocking five downstream tasks. Patching it
  is the cheapest unblock available.
- **Sage** — currently in motion (Tier 0 + Tier 1 audit-driven work
  and ops baseline). Soft attention without being loud.
- **Cream** — neutral state. Either already shipped (column 1) or
  scheduled for a calmer middle window (column 4).
- **Charcoal** — deferred. Tier 3 follow-on and the eleven Product
  Vision capabilities. Present but receding.

## How to view this as a visual

Three options, fastest first:

1. **Paste it into [mermaid.live](https://mermaid.live)** — paste just
   the `flowchart LR ...` block (drop the surrounding ` ```mermaid `
   fences) and it renders instantly. Best for quick preview.
2. **VS Code / Cursor preview** — install the *Markdown Preview Mermaid
   Support* extension (publisher: `bierner`), open this file, press
   `Ctrl+Shift+V`. Live-refreshes as you edit.
3. **GitHub** — commit and push, then visit
   `https://github.com/codemaker66/omnitwin/blob/master/docs/diagrams/roadmap.md`.
   GitHub renders Mermaid natively in markdown files.

Both `infra.md` and this roadmap follow the same theme as
`task-graph.md`, so all three diagrams render with consistent
typography and palette anywhere Mermaid is supported.

## When to update

Regenerate when:

- A task closes (move it left, or remove if no longer load-bearing for
  the visual)
- A new task lands in any tier
- Tier boundaries shift (rare — usually only when foundation closes
  faster or slower than expected)
- A new product capability is committed (requires ADR update)
- A peak changes (e.g. Event Ops Compiler ships → it's no longer a
  peak, the next strategic anchor takes its place)

The roadmap mirrors `docs/state/tasks.md`. Tasks are the source of
truth; this file is the time-banded read view.
