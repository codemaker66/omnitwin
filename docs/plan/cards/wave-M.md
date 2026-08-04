# Wave M — Event Cinema (first moonshot; builds after Wave F)

Chosen 10 Jul 2026. Depends on: E2 (phase morph), F3 (Theatre.js orbit authoring), saved POVs. Claim rule: trailers render only captured rooms + planned objects — no generative imagery; footer carries evidence status.

## CARD M1 · The camera director

Spec: 08 §4 · 03 §8 (auto-cinematography, heuristic first)
Scope: composable shot grammar over the scene: establish (slow push from door POV) → detail (table-level dolly past place settings) → phase morph beat (ceremony→dinner during a crane rise) → finale (couple's saved POV, settle). Heuristics pick angles from the semantic model (aisle spines, stage normal, window light direction); every shot is a Theatre.js sequence a human can retime. Output: `CinemaScript` JSON (shots, durations, easings) per event.
DoD: three distinct scripts generated for the same fixture event (variety without randomness — seeded); each shot editable in Theatre.js studio; camera never clips geometry (proxy-ray sweep test).
Out of scope: rendering/export (M2), music.
Verify: in-app playback of all three scripts, recorded.

## CARD M2 · The trailer renderer

Spec: 08 §4 · 01 §18 exports
Scope: render a `CinemaScript` to a 30 s 1080p (and 9:16 vertical) file: offscreen canvas playback → MediaRecorder/WebCodecs capture; FOH title cards (serif: event name, date, venue) keyed over holds; watermark + evidence-status footer frame ("Planning visual · captured room · layout not yet review-approved" or current state, from claim data); optional licensed music bed slot (ship silent + SFX-free first).
DoD: render completes < 90 s for 30 s output on the reference machine as a background job with progress; file lands in R2 with a share token; claim footer text sourced from evidence state, tested; vertical + horizontal both pixel-checked.
Out of scope: server-side render farm (revisit if client machines struggle), TikTok/IG direct posting.
Verify: two rendered trailers (fixture + Reception Room) attached to handoff.

## CARD M3 · The premiere loop

Spec: 08 §4 growth loop · 07 §1 (mood vs product) · F2 FOH register
Scope: trailer embeds at the top of the proposal share page (poster = hero shot, tap to play); "Share your evening" action produces a clean client-facing link (no internal data, watermarked); venue-side analytics: plays, shares, which shot viewers scrub back to (feeds the camera director's heuristics).
DoD: proposal page renders trailer without layout shift; share link passes claim guard + privacy strip (internal names/notes removed); play/share events land in analytics; graceful poster-only fallback when no trailer rendered.
Out of scope: paid distribution, venue marketing site embeds (fast follow).
Verify: end-to-end — approve-ready proposal with playing trailer on a phone viewport, recorded.
