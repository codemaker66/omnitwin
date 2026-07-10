# 03 · Architecture & Tech Stack

v1.0 · July 2026 · grounded in a fresh landscape scan (facts dated; sources in footnotes of the research brief, available on request)

---

## 1. Architectural principles

1. **One Action schema.** Every mutation in the product — a drag, a ⌘K verb, an AI proposal being materialized, a collaborator's edit, an ops correction — is one typed, serializable, invertible `Action { id, actor, intent, payload, inverse, provenance, ts }`. This single decision buys undo/redo, version history, multiplayer sync, the audit trail, AI tool-use (the Action schema *is* the copilot's tool API), phase diffs, and session replay. It is the most leveraged engineering decision in the plan.
2. **The manifest is the contract.** Room runtime packages (per the bible's Layer 5) are immutable, content-addressed, and the only way the app learns about rooms. Formats will churn (SOG today, RAD/KHR tomorrow); the manifest schema must not.
3. **Local-first reads, server-authoritative writes.** Every operator surface renders from a local store synced continuously; writes apply optimistically and reconcile. Snappiness is an architecture property, not a polish task.
4. **Jobs, not requests.** Capture processing, evidence packs, hero-shot renders, proposal PDFs, notifications — all queued, idempotent, resumable, observable. Request paths stay under 100 ms.
5. **Claim guard at every egress.** Any artifact leaving the trust boundary (share link, PDF, email, public page) passes the language linter + evidence-status stamping. Enforced in the export services, not in UI goodwill.
6. **Room-agnostic pipeline first.** One verified splat → runtime package → the Floor, repeatable for every room. (Lady Convenor's Room is the proof; Grand Hall is not a blocker.)

## 2. System shape

```
Client (browser, desktop-first; tablet ops; phone FOH)
├── App shell: Next.js 16 / React 19.2 (Compiler on)
├── Scene runtime: three.js r185 + R3F 9.5 + Spark 2.x (splats)
├── Local store: Zero sync (relational) + Yjs doc (live layout) + action log
├── Workers: sim (recast/DetourCrowd WASM), navmesh bake, ghost solver, exports
└── Design system: Tailwind v4 tokens (House) + Radix + Motion 12 + GSAP

Edge (Cloudflare)
├── R2 + custom domain: runtime packages, SOG/RAD splats, GLB proxies (immutable, content-addressed)
├── Durable Objects (SQLite GA): Yjs doc rooms via partyserver, presence, share-token gate
└── Workers: manifest service, signed URLs, watermark stamping

Core (region: EU first)
├── Postgres 16 (Neon or Supabase) — source of truth, RLS multi-tenancy
├── API: typed RPC (tRPC or server actions) emitting/consuming Actions
├── Zero (Rocicorp, 1.0 Jun 2026) — Postgres→client live sync for CRM/calendar/events
├── Jobs: Trigger.dev v4 (app jobs) · queue lane to GPU cloud (capture processing)
└── AI service: Claude API + claim guard + RAG over venue knowledge

Capture lane (bursty, external)
└── RunPod / Lambda multi-GPU high-RAM nodes: Lixel LCC → SOG/SPZ + GLB proxy + QA report → manifest publish
```

## 3. Stack picks and receipts (July 2026)

### Rendering

- **three.js r185** (Jul 2026) + **React Three Fiber 9.5** (React 19-compatible). WebGL2 primary pipeline — deliberately matching Spark.
- **Spark 2.1** for gaussian splats: v2.0 (Apr 2026) added streamed LOD "splat trees," GPU virtual memory, and the RAD streaming format — 100M+ splat scenes on ordinary devices, WebGL2 by design (~98% device reach). Venviewer already integrates Spark; that bet just matured.
- **Formats**: SOG as delivery standard (~20× smaller than PLY; ~2× smaller than SPZ; single-file, GPU-ready) · PLY as archival master · SPZ for interchange · RAD for the largest scenes · adopt **KHR_gaussian_splatting** glTF extension when ratified (release candidate Feb 2026) as the interchange sidecar. LCC/LCC2 stays source/archive only.
- **Proxy/mesh layer**: GLB with meshopt + KTX2; three-mesh-bvh for raycasting. All picking/collision on proxy, never splats.
- **Furniture**: per-SKU `InstancedMesh`; 500+ objects = a handful of draw calls. Authoring path for proxies: Blender → glTF pipeline with a validation step (scale, origin, pivot, LOD).
- **WebGPU lane (watch, don't bet)**: three.js WebGPURenderer is production-ready and WebGPU is Baseline across browsers (Safari 26 shipped it Sept 2025; Firefox 141+), and PlayCanvas 2.19 already does compute-based WebGPU splatting — but Spark's WebGL2 reach wins for clients on old venue laptops. Revisit yearly.

### Scene composition (maps the bible's layers to runtime)

```
<SceneRoot manifest={roomPackage}>
  <SplatLayer>      Spark: SOG/RAD, progressive, exposure-graded       (visual truth)
  <ProxyLayer>      invisible GLB: collision, raycast, walk, cutaway   (planning authority)
  <InkLayer>        generated linework for Plan band + atelier fallback
  <SemanticLayer>   zones, routes, doors/exits, service points overlays
  <PlannerLayer>    instanced furniture + ghosts + labels + handles
  <SimLayer>        DetourCrowd agents, density floor-glow, trails
  <PresenceLayer>   collaborator lights, POV markers, comment anchors
</SceneRoot>
```

The **Altitude compositor** owns the camera rig: scroll → altitude parameter → per-layer emphasis curves (splat opacity, ink emergence, label billboarding, projection lerp perspective→ortho between Dollhouse and Plan). One parameter drives everything; bands are just named points on it.

### App platform

- **Next.js 16** (Turbopack default, Cache Components) · **React 19.2** + **React Compiler 1.0** (stable Oct 2025) · TypeScript strict.
- **Tailwind CSS v4** encoding House tokens · **Radix** primitives under custom House components · **Motion 12** (`motion/react`) for UI physics · **GSAP 3.13+** (fully free since Apr 2025, incl. SplitText/MorphSVG) for timeline scrubbing and camera choreography.
- State: **Zustand** for scene/UI stores; the action log is the source of planner state.

### Sync and multiplayer

- **Relational domain** (CRM, calendar, events, proposals): Postgres → **Zero 1.0** (stable Jun 2026) for local-first live queries. Alternative if Zero's operational surface disappoints: ElectricSQL 1.0 (GA Mar 2025). Both keep Postgres canonical.
- **Live layout co-editing**: **Yjs** doc per layout (still the de-facto CRDT, deepest ecosystem), hosted on **Cloudflare Durable Objects** (SQLite storage GA; partyserver — PartyKit's OSS successor inside Cloudflare since the Apr 2024 acquisition). Buy-instead option: **Liveblocks v3** if we'd rather pay than operate.
- Bridge: on idle/snapshot events, the Yjs doc flattens into an immutable `LayoutSnapshot` row (hash = evidence anchor). CRDT for liveness; Postgres for truth; snapshots for proof.

### Jobs and the capture lane

- **App jobs**: **Trigger.dev v4** (self-hostable, realtime progress API) — decided (00 §9); Inngest ($21M Series A Sept 2025) held as the swap-in fallback behind a thin queue interface. Temporal ($5B, Feb 2026) only if enterprise-scale orchestration demands it later.
- **Capture processing**: Lixel LCC processing needs ~165 GB RAM → burst to **RunPod/Lambda** multi-GPU or high-RAM nodes (H100 ~$2.89–3.99/hr, spot cheaper on Vast.ai). Pipeline: raw upload → LCC/3DGS process → SOG/SPZ encode (splat-transform CLI 2.0, May 2026) → GLB proxy derivation → QA gates (coverage, floor-alignment, artifact score) → manifest publish to R2. Every step idempotent, resumable, logged; failures produce operator-readable QA reports, not mysteries.
- **Asset delivery**: R2 (zero egress) + custom domain + immutable content-addressed paths; signed URLs per exposure tier (internal / private / client-safe / public); watermark stamping in a Worker for client-safe renders.

### Simulation

- **recast-navigation-js 0.43** (Recast/Detour + **DetourCrowd** WASM): navmesh baked from floor polygons minus buffered object footprints; queue zones, staff lanes, door capacities as constraints; deterministic seeded ticks in a worker; replay artifact = versioned binary (agent trajectories + density grid + queue metrics + assumptions + seed + geometry hash). Pure-TS fallback: navcat.
- Rendering consumes replays only — simulation never runs "live authoritative" during presentation. MotionBricks-style generative motion stays a future *visual* skin; deterministic replay remains the brain (doctrine).

### AI layer

- **Claude via API** as the copilot brain. Its tools are the Action schema plus read-only evidence/semantic queries — the AI literally cannot perform an act the UI couldn't, and every act lands as ghosts (P2).
- **Claim guard** = two stages: deterministic lexicon linter (allowed/forbidden lists compiled from doctrine; runs in CI on UI strings *and* at egress on generated copy) + LLM policy check for paraphrase evasions. Blocks with suggested safe rewording.
- **Venue knowledge RAG**: packages, pricing rules, room facts, past-event outcomes (post-event learning lane) with source + freshness metadata; the copilot cites or refuses.
- Numeric grounding rule: the model may only cite measurements that exist in the semantic model / check results — enforced by tool design (it has no free-text access to numbers, only query results).

### Platform services

- **Auth/tenancy**: Organisation → Workspace → Venue; RBAC (owner, manager, sales, planner, hallkeeper, reviewer, supplier, client); scoped share tokens for portal/supplier links. WorkOS or Auth.js + custom RBAC; RLS in Postgres mirrors the model.
- **Payments/contracts**: Stripe (deposits, schedules) · e-sign via Dropbox Sign/DocuSign API · email via Resend · calendar: ICS projection first, Google/Microsoft sync later (Venviewer masters room holds; external calendars receive projections — doctrine).
- **Observability**: OpenTelemetry traces end-to-end (action id propagates from click → API → job) · Sentry · PostHog (product analytics + session replay on BOH surfaces only) · RUM Web Vitals + frame-time beacons by device tier.
- **Quality gates in CI**: type/lint/test · Playwright golden-path E2E · visual regression on fixture rooms (pixel-diff) · perf budgets (frame time, TTI, bundle) · claim-lexicon lint · a11y (axe + keyboard walk). The bible's rule stands: schema, API, UI, test, visual, journey, and claim gates all green before ship.

## 4. Data model deltas

Adopt the bible's model wholesale; add:

- `PlannerAction` (the action log), `GhostProposal` (staged AI/variant bundles), `AltitudePreset`, `CameraPOV` (exists — add `hero_shot` flag), `HeroShot` (rendered artifact + provenance), `FlipPlan` (first-class phase-gap object: deltas, crew-minutes estimate, source), `DeviceTierProfile` (quality ladder telemetry), `ClaimLintResult` (egress audits).
- `LayoutSnapshot` gains `yjs_state_vector`, `action_range`, `sha256` (evidence anchor).

## 5. Performance engineering (how the budgets in 01 are met)

- Manifest + proxy GLB in aggressive edge cache → first interactive < 1.5 s.
- SOG progressive levels sized so first visual < 2 s on 50 Mbps; splat tree LOD keeps 2 M visible splats under frame budget on M2-Air-class; device tiering picks initial LOD from a 200 ms micro-benchmark + stored profile.
- Ghost reflow solver is local and geometric (no network, no AI) — pure function over proxy + rules → < 400 ms for 150 tables.
- All raycasts against BVH proxy; splat layer is display-only. Undo = inverse action application, O(1).
- Adjacent-room prefetch on hover of the room switcher.
- Frame-time beacon p95 per tier is a CI-tracked number; regressions block merge. "Snappy" is a contract, not an adjective.

## 6. Security & privacy

- Raw captures private by default; redaction pass (faces/plates/signage) before any public derivative; VIP privacy mode per event; watermarks on client-safe renders.
- Share tokens: scoped, expiring, revocable, audit-logged; supplier links see only their slice.
- Append-only audit log (actions + auth events + exports); backups with restore drills; migration gates.
- GDPR posture from day one (EU venue first): DPA, data residency EU region, deletion workflows tied to the client/contact model.

## 7. Buy vs build

| Build (moat) | Buy/integrate (commodity) | Watch (don't build yet) |
|---|---|---|
| The Floor + six primitives | Payments (Stripe) | WebGPU splat compute path |
| Capture→runtime pipeline + QA | E-sign (Dropbox Sign/DocuSign) | KHR_gaussian_splatting (adopt on ratification) |
| Manifest/runtime package system | Email (Resend), comms | MotionBricks-style motion skins |
| Evidence runtime + claim guard | Calendar sync (ICS→Google/MS) | Generative staging (ArtiFixer-class) — labeled derivative only |
| Guest-flow sim + replay | Accounting/ERP exports | VR/AR editing (view-only WebXR later) |
| Ops compiler (plan→BEO/pick lists) | Video calls (embed) | Splat semantic auto-annotation (Splat-Analyzer-class, human-reviewed) |
| Post-event learning loop | Auth commodity parts (WorkOS) | Relight/time-of-day light study (experimental, labeled simulation) |

## 8. R&D lanes (kept honest)

- **Relight/time-of-day**: sun-position math from venue lat/long + window semantics, splat exposure/SH grading — ship only as "Simulated lighting study." Never promise photometric truth.
- **WorldMesh-style structure/appearance decoupling** already *is* our proxy+splat doctrine — continue.
- **Auto-cinematography**: heuristic first (composition rules over semantic model), learned later. Powers hero shots + client films.
- **Acoustic hint** (RT60-class estimate from geometry/materials): planning-grade wording, later.
- **ScaRF-SLAM / NeuWorld / MeshCoder / three-meshlets**: tracked, not on the critical path (per bible).

## 9. Failure modes & recovery (operator-grade)

Every workflow ships with: progress states, retries with idempotency keys, dead-letter visibility, plain-English failure copy, "copy diagnostics," and a documented operator recovery step. The capture lane additionally ships QA reports and a rollback (manifests are immutable; publishing is a pointer swap). The demo rule: any surface we'd show an investor must survive airplane-mode, a 3G throttle, and a 2019 laptop — degraded, honest, and calm.
