# 04 · Red-Team Critique

v1.0 · July 2026 · This document attacks 00–03 and the brief itself. It exists because a plan that only admires itself is marketing. Severity: ▲ high · ● medium · ○ low.

---

## 1. Attacks on the ambition (the brief's own framing)

### ▲ 1.1 "Dopamine hacks" would poison this exact product
The brief asks for "all the marketing psychology and dopamine hacks you can think of." Deployed literally — streaks, variable rewards, urgency mechanics — this contradicts the product's core asset: *trust*. You cannot sell "proof-carrying" and run casino mechanics in the same pane. 01 §14 deliberately converts the ask into **earned delight** (speed, materialize beat, peak-end, hero shots). Keep that conversion. If growth ever demands manipulative mechanics, put them in marketing emails, never in the room. The veterans you want to gasp will *smell* dark patterns in seconds — and gasp for the wrong reason.

### ▲ 1.2 "15 years in the future" is how demos win and products die
Futuristic ≠ alien. Users can absorb roughly one new physics per surface; 01 ships six primitives at once. The mitigation is that five of six wear familiar clothes (scroll, drag, timeline-scrub, ⌘K are known gestures with new consequences) — but the risk is real: a hallkeeper of 30 years opens the Floor and feels stupid. That feeling churns venues. Countermeasures that must not be cut: the Ledger view (spreadsheet-shaped truth), buttons for every command, Plan band as a familiar "floorplan" landing state per user preference, and progressive reveal (timeline hidden for single-phase events). The Apple lesson correctly stated: novel *materials*, conventional *semantics*. If usability tests show orientation loss in Altitude, ship band *tabs* as a classic mode and treat continuous scroll as the delighter. Test with actual Trades Hall staff before betting the UX.

### ▲ 1.3 Scope is the killer, and the bible describes six products
CRM + proposals + calendar + planner + sim + ops + learning ≈ Salesforce + Cvent + a game engine, by a team of any size. "Ignore capacity" was your instruction and 00 honors the *sequence* instead — but be explicit: the multi-billion outcome dies if years 1–2 are spent building a mediocre CRM next to a brilliant planner. The wedge (showcase → living proposal → the Floor) must reach excellence *first*; CRM/calendar can be thin, opinionated, and integration-friendly for a long time. Every month spent matching Tripleseat features is a month Freeman moves down-market.

### ● 1.4 "Surpass Cvent/Salesforce" is the wrong verb
You don't surpass a distribution fortress frontally; you make it irrelevant for a segment. 00 already reframes to segment ownership (heritage/boutique/hospitality). Watch for drift: if the roadmap ever contains "registration" or "badging," someone is fighting Cvent on Cvent's land.

### ● 1.5 The demo-hardware trap
The audience that must gasp (investors, directors) will see it on an M-class laptop; the users who must *stay* are on 2019 Windows machines in a venue office. If the wow only exists on the demo machine, churn arrives in month two. That's why 01 makes the quality ladder and Plan-band parity non-negotiable and 03 puts frame-time by device tier in CI. Treat "flawless on a bad laptop" as a launch gate, not a nice-to-have.

## 2. Attacks on the market thesis

### ▲ 2.1 Venues buy boring; wow is suspected
Enterprise hospitality buyers have been burned by 3D gimmicks (Matterport tours that changed nothing operationally — and Matterport itself sold to CoStar rather than becoming an OS). The buying trigger is not beauty; it's *fewer mistakes, faster approvals, higher conversion*. The wow opens doors; the pick-list compiler signs renewals. Sales narrative must lead with the Spalba-class number (lead→booking lift) and flip accuracy, with the room as proof, not the pitch. If we can't produce our own conversion number within two quarters of first deployment, the thesis is unproven — instrument for it from day one.

### ▲ 2.2 Capture is the moat and the anchor
165 GB RAM processing, operator visits, QA, re-capture after renovations: this is a *services* cost wearing a software costume. If capture doesn't industrialize (playbook, fixed kit, per-room hours falling quarter over quarter), CAC eats the model; investors will ask exactly this. Track 1 must publish internal metrics: operator-hours/room, GPU cost/room, capture→live days. The moat is real only if the curve bends.

### ● 2.3 Cvent can buy its way here
They bought Prismm in weeks and Goldcast/ON24 in a quarter. What they can't buy quickly: per-venue captured reality at quality, the evidence culture, and hospitality-shaped ops workflows. Speed in the open window + data flywheel per venue is the defense. Also a candid note: being acquired by an incumbent at a strong multiple is a *success mode* for investors even if the brief dreams bigger — don't structure the company to make it the only mode.

### ● 2.4 The heritage-venue beachhead is small
Trades Hall-class venues are a wonderful wedge and a modest TAM. The expansion sequence (hotels' S&C departments → venue groups → conference centers) needs to appear in the deck with the wedge, or "multi-billion" reads as vibes. Bottoms-up: it takes ~40–80K venue-rooms worldwide at OS-tier pricing to underwrite the number — plausible only with the hotel move.

## 3. Attacks on the design (01/02)

### ▲ 3.1 Six primitives = six ways to be confused
Strongest version of 1.2, aimed at me: Ghosts specifically risk "what is real?" confusion — a planner screenshots a ghost variant and a client thinks it's confirmed. Mitigations exist (ghost material discipline, screenshots exclude ghosts by default in client-safe exports, provenance on hover) but this must be usability-tested with non-designers. If confusion persists, reduce ghost usage to AI proposals + previews only, and give collaborator-drag its own subtler treatment.

### ● 3.2 Altitude's projection morph can nauseate and disorient
Perspective→ortho lerps are notoriously queasy. Constraints: morph only in the top band transition, short duration, no roll, reduced-motion = cut. If tests still show disorientation: keep Altitude as four discrete levels with animated-but-cut transitions — the *conceptual* unity survives without the continuous morph.

### ● 3.3 Live Numbers can feel like the tool overruling the planner
A reflow that moves 40 tables because a number moved is powerful and terrifying. Rules already in 01 (always ghost-first, single undo, Esc) are necessary but not sufficient: add a "pin" (lock tables/zones so reflow may not touch them) before this ships. Pros pin the head table first, always.

### ● 3.4 The timeline seduces toward fiction
Morphing between phases looks like physics but is presentation; a naive user may believe the *transition itself* is planned reality (chairs don't glide themselves). 01 already refuses to export in-betweens; also add a caption during scrub ("visualizing change between phases") the first N times. Related: crew-minutes estimates before actuals exist are assumptions — the label must say so loudly (claim doctrine applies to *internal* surfaces too; hallkeepers deserve the same honesty as clients).

### ● 3.5 One accent + dark luxury can slide into gloom
Dark-first in a *bright venue office at noon* can read as murky, and brass-on-graphite has contrast traps (02 sets floors, but audit every chip state). BOH light variant is specced — don't let it rot as a second-class theme; ops users outdoors will live in it.

### ○ 3.6 Sound is a liability until proven
Even off-by-default, shipping audio invites "it beeped in a client meeting" stories. Fine to design the palette; gate shipping it behind explicit demand.

### ○ 3.7 Named layouts and hero shots leak privately
"Sarah's candlelit scheme" and auto-generated beauty shots will get shared; watermark + exposure tiers cover clients, but internal names/notes must be stripped from any client-safe artifact by default (add to claim-guard scope: *privacy* guard, not just claims).

## 4. Attacks on the architecture (03)

### ▲ 4.1 The Action schema is load-bearing and unproven at this breadth
Undo + CRDT + audit + AI tools through one schema is elegant on paper and gnarly where Yjs merge semantics meet inverse-action undo (undoing *my* action after *your* concurrent edit is a known hard problem). De-risk order: single-user action log first (undo/history/audit), then presence, then co-editing via Yjs with **per-user undo scopes** (Yjs supports this) — and accept that "inverse" for some actions is snapshot-restore, not algebraic inversion. Budget real weeks for this; it is the platform.

### ● 4.2 Zero 1.0 is four weeks old
Betting relational sync on a 1.0 (Jun 2026) is a startup-shaped risk. It's the right *category* (local-first reads), but hold ElectricSQL 1.0 (GA Mar 2025) as a tested fallback and keep the data layer behind an interface thin enough to swap. Same posture on Trigger.dev vs Inngest: pick one, isolate it.

### ● 4.3 Dual sync planes must not become three
Yjs (layout) + Zero (relational) + an action log is already two-and-a-half consistency models. The LayoutSnapshot bridge is the only sanctioned crossing; any feature that wants "just a little" live sync elsewhere must use one of the existing planes. Guard this in review or entropy wins.

### ● 4.4 WebGL2 bet is right and will look wrong
By 2027, WebGPU splat pipelines (PlayCanvas-style compute) will benchmark better in blog posts, and someone will ask why we're "behind." The answer (98% reach incl. old venue laptops = the actual customer) is in the ADR; revisit yearly with data, not fashion.

### ○ 4.5 Vendor romance
Neon post-Databricks, Supabase at $10.5B, Cloudflare DO pricing GA'd January — all fine today; all could reprice. Content-addressed R2 + Postgres-canonical keeps exit costs low. Keep it that way (no proprietary data shapes in the hot path).

## 5. Sequencing attacks

### ▲ 5.1 The bible's own warning is the biggest risk to this plan
"Do not build polished public/AI/revenue/simulation claims before runtime/evidence foundations are truthful." The most seductive failure: spend a quarter on Altitude/Ghost polish against the *procedural* Grand Hall while zero real rooms are runtime-packaged. Phase 1 (one real room, honest chip) gates everything; 05's wireframes are plans, not permission.

### ● 5.2 The wireframes will be mistaken for the product
Stakeholders see boards and assume weeks-away. Every board in 05 carries its phase tag; keep them attached in any deck.

### ● 5.3 Post-event learning is the moat and is scheduled last
Phase 10 in SS++ — correct for build order, dangerous for data: the flywheel needs *actuals* from the first real events. Cheap insurance: from the first operated event, capture planned-vs-actual timings and issues in the simplest possible form (even a structured form), so the learning lane starts with a year of data, not a cold start.

## 6. What I'd cut first (if reality intrudes despite "pure ambition")

1. Sound palette (design it, don't ship it)
2. Rehearse/sim (Phase 7 anyway — resist pulling it forward for demos; ghost *schemes* demo better than fake crowds)
3. Voice input (keep the grammar, add the mic later)
4. Continuous Altitude morph (keep bands + animated cuts)
5. FOH dusk palettes (delight, not spine)

Never cut: the honest fallback states, claim guard, quality ladder, Ledger, the action log. Those are the difference between a demo and a company.

## 7. Steelman of the plan (so the critique doesn't overcorrect)

- The six primitives are individually familiar gestures; compounding is where the "15 years ahead" feeling legitimately lives — this is not chrome, it's collapsed workflow (drawing/picture/numbers/schedule into one object), which is exactly the kind of leap incumbents structurally can't follow (their org chart *is* the separation).
- The evidence layer as brand is contrarian and correct: in an AI-slop era, provenance is luxury.
- Capture-as-moat cuts both ways, but the side that industrializes it first owns the segment — someone will; the plan at least prices it honestly.
- And the market timing evidence (Freeman, Spalba, Cvent's Prismm buy) says the window is open *now* — the plan's biggest risk isn't being wrong; it's being slow.

## 8. Judgment

The plan is coherent, differentiated, honest about physics, and correctly sequenced — its dangers are cultural, not conceptual: scope seduction (1.3), polish-before-truth (5.1), and novelty outrunning the hallkeeper (1.2). Pin those three to the wall. Ship the room that resolves, then make one planner at one venue faster and prouder than they've ever been; the gasps follow the proof, in that order.
