# The Amissing Book replaces the public Craft quiz

The game replacement and Trades Hall landing wording are deployed and verified.
The public landing now introduces The Amissing Book and links to the live game.

## Scope and integration

Blake requested the current master game on the Trades Hall landing journey,
preserving Claude's Mythia recordings, art, branching story and save/resume.
Work started from `a80ee210` in the isolated `codex/amissing-book-integration`
worktree. The unrelated dirty main checkout and earlier `/quiz/stage` work are
not part of this release.

Before this change, the CMS landing at `https://www.tradeshallglasgow.co.uk/landing`
loaded `/file-download/92/trades-hall-option-b-v5.js` in content block 78, page 10.
Its Craft action links to `https://venviewer.com/quiz`. Both `/quiz` and
`/trades-house/discover-your-craft` now redirect to `/amissing-book/`, including
trailing-slash variants. The React routes also perform document navigation for
client navigation and local preview. The visitor leaflet toolbar links directly
to the game. The printed leaflet and unrelated venue functionality remain intact.

The CMS transformer verifies the exact v5 SHA-256 before changing only welcome
copy, the Craft scene's game introduction/action and the description. It writes
a new immutable v6 asset; it refuses source drift or an existing output file.
The prepared v6 welcome reads **Play the interactive game.** Its Craft scene introduces **The
Amissing Book**, Glasgow's 14 Incorporated Crafts and **Play the game**.

- v5 SHA-256: `67c33a28fd3e42959ff2e2063b7947aada7a78157f6188c4caa75c378fc47e25`
- v6 SHA-256: `86ee8903baf94ffc821dd5412b30df99f6df8cf38491509aa72b6d7beb6b3f7e`

## Save/resume and packaging

Inspection found the imported game wrote a partial `lost-years-save` but never
read it. It did not retain Ink story position. A readable hosting adapter adds
choice checkpoints under `amissing-book-checkpoint-v1`, retaining the legacy
data. It restores the actual Ink state, player attributes, branches and scene
presentation. Resume returns to the most recent choice, not a mid-line timer.
New saves remain local to the same browser and origin. Legacy partial saves
cannot reconstruct a story position and are reported honestly.

The authored game JavaScript and media in `public/amissing-book` remain unchanged.
The entry HTML uses the existing site favicon so development and production do
not request a missing icon. Vite dev opens the explicit `index.html`; deployed
and preview links retain the canonical `/amissing-book/` address.
`prepare-amissing-book-resume.mjs` adds the adapter only to build output and
fails if the known bootstrap/replay boundaries drift. Then the existing
`version-amissing-book-audio.mjs` versions that prepared output, including the
adapter, full module graph, manifest and all voice bytes. There are no new
recordings or changes to the authored opening. The original audio evidence is
in [the narration release record](amissing-book-narration-2026-09-30.md).

## Verification and release status

Pre-change live baseline: all 222 voice versions match source; seven clips
(all five opening lines, later narrator and a character voice) match across
21 ordinary/versioned/cache-busted GETs. All 551 indexed audio/art URLs answer
successfully, and all 14 packaged assets match the existing production graph.

The v6 CMS candidate passes render checks at 1440×900, 872×936, 390×844 and
320×740. All 16 images, fourteen Craft selections, Escape, contact link and
event hold work; no clipped text, horizontal overflow or browser errors found.
This is local candidate evidence, not live CMS publication or aesthetic approval.

Bulk screenshots, logs and baseline JSON are outside the repository at
`D:/claude/amissing-book-integration-20260930/`.

Initial integration qualification passed: seven browser cases on the exact packaged production
build, including desktop 1440×900, touch phone 390×844 orientation prompt and
844×390 gameplay, actual opening WebAudio playback, all five versioned opening
takes, character creation, a Family branch, exact checkpoint reload/resume and
continued choices/audio. Restored artwork, including the woman's ink mark, was
visually checked. Corrupt-save and blocked-storage paths also pass. All three
legacy URL browser cases pass separately on Vite dev. No collected browser
errors or missing assets remained in those local runs.

Initial focused Vitest checks included the route/leaflet/versioning contracts and bridges
to 18 checkpoint/bootstrap and three CMS-transform Node cases. The 137 browser
gate tooling tests pass; the reviewed inventory replaces 26 retired quiz cases
with seven game cases while preserving all unrelated identities and policies.
The exact Vercel build command passes locally. Failed attempts are retained:
Vercel rejected the original command length, now guarded at 256 characters;
browser checks exposed the missing favicon, cold dev entry and actor-restore
ordering defects, all repaired before final qualification.

The first complete CI run (`36715462357`) passed the build, lint, typecheck,
security and browser gates. Its sole unit failure was an older redirect guard
that accepted only React routes. The guard now also verifies exact unconditional
rewrites to real public HTML documents and their local module entries, with
negative coverage for missing, malformed and catch-all destinations. It does
not exempt the game by name or weaken the existing homepage-anchor protection.

The next run (`36718270820`) passed all unit suites but exhausted the desktop
game journey's 100-second overall budget. Its preserved retry trace shows native
clicks taking about two seconds each, and the Lammas transition reaching that
deadline before resume could run. The opening font requests took 30-201 ms;
the screenshot's font-wait message was not evidence of a stalled font download.
The full opening/branch/resume journey now has a 180-second overall budget.
Individual readiness and audio limits, native playback, all assertions and
browser-error checks remain unchanged. No production behavior was changed for
this adjustment.

PR #39 merged as `baad9133e87e85dc3f401365e60771e49a372251` after candidate
`88b9a359` passed complete CI `36723009288`. Vercel production
`dpl_3Q9suvZHFjSXkTpryp9KySfawWWr` was READY and served that merge on
`venviewer.com`. All four legacy URL forms return the game and preserve query
strings. The deployed HTML, manifest and 15 packaged assets match source;
all 222 voice versions, 21 representative MP3 GETs (including every opening
take and cache-busted requests) and 551 audio/art availability checks pass.

Live browser qualification then exposed a cold-network startup defect in the
imported game's eager artwork loading. The original bootstrap queues 52 future
images before Begin. A retained desktop trace shows all eight initial audio
requests still without response headers nearly 60 seconds after clicking Begin;
the opening narration was never requested. The phone reached its first narration
but later stalled behind the same burst. These are failed live checks, despite
the successful local/CI tests and deployed byte checks. Earlier 5-second startup
assertions also expired during the title image download and reveal.

The first loading correction removed that uniquely guarded bootstrap preload
call. It passed 20 Node contract cases, 23 focused Vitest checks, the production
build, seven packaged browser cases and complete CI `36728952585`. PR #40 merged
as `be4385e6477b067e135c5bbab234fecd70292b7f`; Vercel production
`dpl_GvjMTHCy4wX4mDqLw4PSDFatcixb` served that merge. A declared Chromium
simulation (192,000 B/s download, 80 ms latency, fresh contexts) measured native
opening playback at 34.884 seconds after Begin before this correction and
9.339 seconds afterward. This is simulated-network evidence, not a production
speed guarantee.

The next live run reached the opening, but all three playthrough cases stalled
after **Follow the bell**. Its trace identifies another speculative burst:
`entered()` starts the future fish chapter before the required `P01b.webp`
scene image. That required image remained without response headers through the
60-second next-line check; the next narration could not be requested. Four
route/storage cases passed. The complete failed run and trace are retained in
`browser-production-startup-fixed/`.

The final preparation suppresses three uniquely guarded speculative calls:
bootstrap artwork, future-chapter artwork and unselected character voices.
Required scene/actor textures, visible portraits and crests, selected character
voices, title cues and old-chapter unloading remain. Original artwork,
recordings, title timing, story logic and checkpoint compatibility are unchanged.

Candidate `f715db2a` passes 22 Node contract cases, 23 focused Vitest checks,
the production build and all seven original packaged-browser cases. Two full
desktop/phone journeys also pass under a declared simulation: a shared
192,000 B/s transfer limit, six response slots, and at least 80 ms header
latency, including worker requests. All 264 game requests completed. The
previously blocked required scene completed in about 1.67 seconds on each
layout. These journeys used extended bounded waits with unchanged assertions;
this simulation does not establish a production speed guarantee.

CI `36733858451` attempt 1 completed its job suites, but the browser gate
correctly rejected a retry in the unchanged planner reduced-motion case.
A blank page, generic timeout and 61.478-second interval before retry strongly
support a timeout in its fixture's 60-second R2 capture fetch before navigation.
The failed request was not traced, so the exact tile/network cause is unknown.
All seven game cases passed first time. Full attempt 2 passed on the identical
candidate, with no source, timeout, assertion or gate-policy changes. The first
attempt remains failed evidence in `scene-ci-attempt1-fixture-diagnosis.md` and
its original artifact under the outside evidence directory.

PR #41 passed every applicable gate in
[CI 36733858451, attempt 2](https://github.com/codemaker66/omnitwin/actions/runs/36733858451)
and merged at 15:39:55 UTC as `a2bdda84e9beacc346ff961b53aa42e76d46e4b9`.
Vercel production `dpl_Exig4Ny5XZL1gpGTQS27Kggr8VLS` became READY on
`venviewer.com` with that exact source. The working game is
[The Amissing Book](https://venviewer.com/amissing-book/), also reached through
the existing [/quiz](https://venviewer.com/quiz) entry. All four legacy forms
return 307 then the correct game HTML with 200, preserving query strings;
see `legacy-production-a2bdda84.json`.

The first live run on this merge passed five route/storage cases, but the two
full journeys exhausted their 60-second next-line limits on required transfers.
Desktop's page/book images took 56.818 seconds before authored transitions;
the next narration request began 372 ms after the deadline. Phone completed
its Cross scene assets but still awaited the current audio at the deadline.
Neither trace shows future-chapter downloads or browser/HTTP errors. These
failures demonstrate slow delivery on the observed connection, without proving
a particular client/network/CDN cause. Both traces and diagnostics remain in
`browser-production-scene-fixed/`, `production-a2bdda84-desktop-touch-timeout.md`
and `production-a2bdda84-phone-lammas-timeout.md`.

Only those two journeys were repeated with live-only 120-second next-line
limits and 600 seconds overall, retaining every behavioral assertion and the
original repository/CI deadlines. Both passed in a 4.9-minute run:
`browser-production-slow-transfers/results.json`. Together with the five
passing cases in the first run, all seven integration cases are verified live.
Desktop 1440x900 and touch phone 390x844 portrait guidance / 844x390 landscape
play cover native opening playback, all five versioned opening takes,
character creation, the Family branch, exact checkpoint equality after reload,
restored choices/artwork and subsequent narration/choices. The passing cases
record no browser errors or missing game assets. Opening and resumed screenshots
were visually inspected. This is Chromium viewport evidence, not a physical
iPhone/Safari test, and the slow-transfer failures are not a claim of fast loading.

The final package/audio audit at 16:01 UTC compares the deployed release with
canonical packaging from merged master `a2bdda84`. HTML, manifest and all 15
packaged assets match exactly. All 14 JavaScript modules resolve through 37
edges, including three cyclic back-edges, in graph
`0a99d3a723252b5579a62f8777e125e4e432f8bf4c362ea0b3983fb93602d738`.
All 222 voice version hashes match source. Seven MP3s, including all five
opening takes, later narration and a character voice, match across all 21
ordinary/versioned/cache-busted GETs. All 551 audio/art HEAD checks pass with
correct media types. All 456 source audio files retain the baseline paths and
bytes; no recordings were regenerated. See `audio-production-a2bdda84.json`.
HEAD checks establish availability, not full-body equality of every asset;
subjective voice quality and aesthetic acceptance are not claimed.

The earlier CMS blocker is resolved. The retained 15:20 UTC check found v5;
browser control had failed while loading its request-header policy. After Blake
provided the CMS login, browser access recovered and normal sign-in succeeded.
The credentials are stored outside Git in the shared local secrets directory;
AGENTS.md and Claude's project memory contain only discovery pointers.

Page 10/block 78 was backed up as `cms/block-78-before-v6.html`. The normal CMS
file-library flow uploaded v6 as file **94**. Its public URL is
`https://www.tradeshallglasgow.co.uk/file-download/94/trades-hall-option-b-v6.js`.
At 16:14 UTC, an anonymous download returned JavaScript, 940,550 bytes and SHA-256
`86ee8903baf94ffc821dd5412b30df99f6df8cf38491509aa72b6d7beb6b3f7e`, exactly matching
the reviewed candidate. The source editor received the completed embed with
that verified URL; the CMS confirmed **Changes have been saved**. V5 remains
unchanged for rollback. Publication used no guessed upload IDs or hidden API.

Live browser checks at 1440x900, 390x844 and 320x740 verify the new welcome/game
copy, all fourteen Craft stories, Escape/Back, narrow-screen story layout, the
event construction notice and contact links. All sixteen landing images load;
the checked landing console has no errors or warnings. Both desktop and phone
**Find your Craft → Play the game** journeys reach the game start screen in the
same tab. The ordinary homepage and cookie controls still render. Existing
incomplete saves are preserved; no user save was replaced during this CMS check.

The independent 16:15 UTC HTTP audit verifies ordinary and cache-busted landing
and v6 responses, retained v5 bytes, and the query-preserving `/quiz` redirect.
Game HTML, entry module and audio manifest still match the previously verified
deployment fingerprint, so the full live narration/choices/save-resume evidence
above remains applicable. See `cms/live-publication-http.json`,
`cms/live-publication-browser.json` and `cms/screenshots/live-v6-*` under the
external evidence directory. The upload/rollback record remains in
`cms/PUBLISH-LANDING-V6.md`. **T-641 is done.** Physical iPhone/Safari testing,
subjective voice/aesthetic acceptance and fast loading on slow connections are
not claimed.
