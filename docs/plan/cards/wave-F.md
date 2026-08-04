# Wave F — Command, Front of House, and the closing beats

## CARD F1 · Command pill, local verbs (G8)

Spec: 01 P5 (verbs + questions only; AI schemes are SS++ Phase 8) · 02 §10.4
Scope: top-center pill (⌘K/click): local grammar — `add 12 rounds of 10`, `arrange cabaret`, `check clearances`, `label tables`, `share` — resolving < 400 ms via the Action layer with ghost previews; question register answering from the semantic/check data in claim-safe language ("Planning guidance… human review required") with a ghost proof and zero mutation. Every command has a menu/button equivalent (the pill is an accelerant, not a gate).
DoD: acceptance 01 §21.5; open < 50 ms; full keyboard operation; no network on the verb path; unknown input degrades to search over commands, never an error wall.
Out of scope: natural-language AI schemes, voice input.
Verify: latency numbers in handoff + Playwright transcripts of 6 commands.

## CARD F2 · FOH register on the proposal share (G11)

Spec: 02 §1/§3 FOH · 05 board F · 06 G11 (route exists: `/proposal/:shareCode`)
Scope: restyle the existing proposal share surface in the FOH register: ivory paper tokens, display serif (licensed pick or Fraunces fallback), concierge voice pass over copy (claim-guarded), hero shot slot, option cards, comment + approve actions kept functionally identical. Mobile-first. Event-time palette variant (dusk) if trivially cheap, else parked.
DoD: zero functional regressions on share/approve/comment tests; copy passes claim guard; ≥ 7:1 body contrast; renders beautifully at 375 px wide; watermark + "evidence status" footer present on renders.
Out of scope: approval choreography (F3), payments.
Verify: mobile + desktop screenshots; share-flow e2e green.

## CARD F3 · Loading cinema + peak-end orbit

Spec: 01 §14.2/.4 · 02 §6 signature moves 1 & 5 · 08 §8 (approval theatre v0 optional)
Scope: polish A2's resolve into the signature moment (timed fades, caption typography); add the session-end 3 s orbit + delta card ("seated 120 · 3 checks passed · flip cut 8 min") — skippable, never on quick reopen, data from the Action log. Theatre.js for authoring the orbit path, GSAP runtime, reduced-motion = static summary card.
DoD: acceptance 01 §21.10; orbit path is an authored asset (editable), not code constants; delta card numbers are provenance-true — computed from the log, no invented stats (and yes, this line is a trap: if you can't compute it, don't show it).
Out of scope: hero-shot auto-cinematography (post-F), Event Cinema trailers (08 §4).
Verify: recording of session-end; reopen-suppression test.

## CARD F4 · Friday demo hardener

Spec: 00 §5 (beats 1–7, minus AI schemes and Rehearse) · 07 §3.5
Scope: one Playwright script that runs the golden path end-to-end on the Reception Room: load/resolve → brush-place seating → guest-count scrub → phase scrub + flip compile → seat-adjacent POV → FOH share on a phone viewport → approve → pick-list draft. Runs in CI weekly and before any demo; failures file themselves as issues with screenshots.
DoD: script green on the reference laptop AND a throttled low-tier profile (quality ladder engages honestly); total runtime < 4 min; artifacts (screens/recording) archived per run.
Out of scope: fixing what it finds (those become cards).
Verify: two consecutive green runs on different profiles.
