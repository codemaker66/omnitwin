# 00 · Venviewer / OmniTwin — Master Plan

v1.0 · July 2026 · plan only, no code
Doc map: **00** this file · **01** the Floor (planner UX, deepest) · **02** House (design language) · **03** architecture & stack · **04** red-team critique · **05** concept wireframes (HTML)
Terms: "the bible" = the master project scope brief this plan implements; "SS++" = that brief's phased build plan (Phases 0–10)

---

## 1. The one-liner and the one bet

Venviewer is a **proof-carrying venue reality operating system**: sell, plan, prove, operate, and learn — inside the captured room itself.

The one bet everything hangs on: **the venue is the interface.** Every competitor's product is *about* the venue (forms, grids, diagrams, photo galleries). Ours *is* the venue. When the room resolves from blueprint into captured detail in seconds (first visual < 2 s) and a planner drags "120 guests" to 148, watching real tables reflow inside real architecture with honest clearance checks — that is the moment incumbents cannot answer.

## 2. What changed in the market (July 2026 scan)

- **Cvent acquired Prismm (ex-AllSeated) in April 2025.** The incumbent now owns 3D event diagramming alongside Social Tables. "We have 3D" is dead as a differentiator.
- **Freeman launched Blue Echo (March 2026)** — gaussian-splat "spatial intelligence" across 20 US convention centers. The category is validated; the giant-venue end is contested. The boutique/heritage/hospitality mid-market is open.
- **Spalba (India) is signing hotel groups** for venue digital twins, claiming 30–35% lead-to-booking lift — third-party evidence that spatial selling converts.
- **Spark 2.0 (April 2026)** streams 100M+ splat scenes on ordinary devices over WebGL2; SOG won the web-delivery format (~20× vs PLY). The rendering risk of this whole plan collapsed this year.
- **Cvent enterprise pricing averages ~$107K/yr with ~22% YoY increases**, quote-only. Pricing resentment is a wedge.
- Tripleseat, Event Temple, Momentus, Planning Pod all shipped **AI assistants, none spatial** — chat wrappers over the same grids.

Strategic reading: we will not out-CRM Salesforce or out-registration Cvent in year one — and don't need to. **Nobody owns "captured reality + evidence + operations."** Cvent's Prismm is generic modeled 3D (a drawing of the venue); ours is the venue. Freeman is locked to its own convention-center services business. The wedge is real and it is now.

## 3. Positioning

For venues that sell experiences — heritage halls, hotels, boutique event spaces — Venviewer replaces the diagram-quote-PDF-email pile with one spatial object every party touches: client, sales, planner, hallkeeper, supplier, director. Cvent orchestrates registration; Salesforce keeps accounts; **Venviewer owns the room** — the spatial event brief, layout, hold, evidence, and ops context — and projects outward via standards (ICS, schema.org, e-invoicing later; per doctrine, external systems may stay masters of their own domains).

Brand posture (02-House): Bloomberg-serious back of house, luxury-hotel-gracious front of house, honest everywhere. The claim-safe doctrine is not compliance overhead — it *is* the brand: the only vendor whose beautiful pictures come with provenance.

## 4. The product spine (six primitives, one lifecycle)

Six interaction primitives (defined in 01) power every surface: **Altitude** (2D/3D as one continuous view) · **Ghosts** (everything possible-but-uncommitted, incl. all AI) · **Timeline** (the event as a 4D object; flips = phase diffs) · **Live Numbers** (every figure scrubbable, ghost-previewed) · **Command** (say it, see it before it's true) · **Proof** (evidence as ambient material).

They compound across the lifecycle: Capture → Showcase → Enquire → Propose (living spatial proposal) → Plan (the Floor) → Prove (checks, gates, packs) → Schedule (room-aware calendar) → Operate (compiled BEO/pick lists/hallkeeper mobile) → Learn (actuals feed estimates, templates, pricing). One venue, one plan, one source of planning evidence.

## 5. The golden-path demo (the artifact that raises money and signs venues)

Ninety seconds, one take, real data, Lady Convenor's Room:

1. Public room page → the room resolves (blueprint → photoreal). *(0–10 s)*
2. "Describe your event" → *charity dinner, 120, band* → three ghost schemes appear in the room; pick one. *(10–25 s)*
3. Altitude scroll: guest-eye → dollhouse → plan; drag guest count 120 → 148; tables reflow live, one aisle goes amber with the rule named. *(25–45 s)*
4. Timeline scrub Ceremony → Flip → Dinner; the room transforms; flip gap shows crew-minutes. *(45–60 s)*
5. Click a chair — the guest's actual view; save POV "Grandma's seat." *(60–70 s)*
6. Share → living proposal opens on a phone (FOH ivory register, hero shot, options, Approve). *(70–85 s)*
7. Approve → "Compile ops" → pick list + setup sequence appear. Fade on the evidence chip: *machine checked — human review required*. *(85–90 s)*

Every phase of the build (below) exists to make one more beat of this demo real.

## 6. Business frame (sketch — numbers to be validated)

- **Pricing**: transparent, per-venue. Showcase £490/mo → Planner £990/mo → OS £1,990/mo (multi-room, ops, evidence, integrations) + one-time capture/onboarding £2–6K per venue (becomes margin as the pipeline industrializes) + later: payments take on deposits, premium capture refresh, portfolio/enterprise tier. Anchor against Cvent's ~$107K/yr opacity.
- **Unit story**: capture cost (operator day + GPU hours ~£100–200/room at current RunPod/Lambda rates) against multi-year SaaS — CAC-adjacent capture is the moat *and* the scaling constraint; industrializing it is a first-class product track (Track 1), not an errand.
- **Moat stack**: capture ops playbook → per-venue data flywheel (post-event actuals make estimates smarter, per venue, compounding) → evidence layer trust (hard to copy culturally) → luxury brand.
- **North star**: confirmed events planned through Venviewer per month. Counter-metrics: enquiry→approved-proposal time; flip-estimate accuracy; venue weekly-active staff (≥3 roles = OS behavior, not tool behavior).
- **TAM honesty**: event-management software estimates diverge ($7–15B, 2025 reports); the venue segment is poorly measured. The credible story is bottoms-up (venues × £12–24K/yr × attach) plus category expansion — argued in 04.

## 7. Build order (SS++ preserved, UI lighthouses overlaid)

The bible's SS++ phases stand — including its warning not to front-run runtime/evidence truth with polish. Overlay: each phase ships a **lighthouse** — a demo-able beat of §5 — so the product is always showable, honestly.

| SS++ phase | Lighthouse (demo beat) |
|---|---|
| 0 · Guardrails | Claim-lexicon lint + perf budgets live in CI |
| 1 · One real room package | **L0: The room resolves** (beat 1) + atelier fallback |
| 2 · Multi-room runtime | Room switcher < 2 s; three rooms live |
| 3 · Commercial intake | Public room page + enquiry (beat 1 public) |
| 4 · Event/proposal model | **L1: The Floor MVP** — Altitude, Ghosts, Live Numbers, Command verbs (beats 3 and 5; beat 2 ships verbs-only until Phase 8) · **L2: living proposal** (beat 6) |
| 5 · Ops compiler | **L4: plan→pick list** (beat 7) + hallkeeper mobile |
| 6 · Evidence runtime | Proof ambient everywhere; evidence packs (beat 7 close) |
| 7 · Guest Flow Replay | **L3: Rehearse** on the timeline (beat 4 deepens) |
| 8 · Revenue + AI | AI ghost schemes complete beat 2; Director's alternatives; revenue scenarios (comfort-guarded) |
| 9 · Integrations + repeatable deployment | Second venue onboarded from playbook |
| 10 · Post-event learning | **L5: estimates cite actuals** ("based on 12 flips in this room") |

Timeline note ("ignore capacity" per your instruction): even unconstrained, sequence is the law — the Timeline primitive before evidence runtime is theater; evidence before a real room package is paperwork. Order beats speed.

## 8. What we refuse (scope armor)

No generic-3D-model venues (captured or honest-atelier only) · no fake AI imagery on public pages · no compliance/safety certification claims ever · no building registration/badging/mega-conference features (Cvent's fortress) in years 1–2 · no CRM-first pivot (spatial object first; sync outward) · no VR editing v1 · no template marketplace before institutional memory works for one venue.

## 9. Decision log seeds (kept in repo, ADR-style)

Spark/WebGL2 over WebGPU-first (reach) · SOG delivery (size/ecosystem) · Yjs-on-Durable-Objects for live layout, Zero for relational sync (liveness vs truth split) · Postgres canonical (Neon/Supabase — final pick pending ops preferences) · Trigger.dev for app jobs; GPU burst on RunPod/Lambda · furniture unscalable by doctrine (SKU swap only) · sound off by default · timeline hidden for single-phase events · claim guard enforced at egress + CI · flips are gaps, not phases (deliberate deviation from the bible's phase list) · "OmniTwin" is an internal codename, never market-facing copy (twin-claim doctrine).

## 10. The standard

Every surface at launch quality must pass what 01/02 call the House bar: instant response, honest states, one accent, evidence one gesture away, and at least one moment per session that a jaded operator would show a colleague without being asked. If a screen has no such moment, it isn't done; if it has three, it's probably lying about one of them — see 04.
