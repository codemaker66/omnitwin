# The Amissing Book replaces the public Craft quiz

## Scope and integration

Blake requested the current master game on the Trades Hall landing journey,
preserving Claude's Mythia recordings, art, branching story and save/resume.
Work starts from `a80ee210` in the isolated `codex/amissing-book-integration`
worktree. The unrelated dirty main checkout and earlier `/quiz/stage` work are
not part of this release.

The live CMS landing at `https://www.tradeshallglasgow.co.uk/landing` loads
`/file-download/92/trades-hall-option-b-v5.js` in content block 78, page 10.
Its Craft action links to `https://venviewer.com/quiz`. Both `/quiz` and
`/trades-house/discover-your-craft` now redirect to `/amissing-book/`, including
trailing-slash variants. The React routes also perform document navigation for
client navigation and local preview. The visitor leaflet toolbar links directly
to the game. The printed leaflet and unrelated venue functionality remain intact.

The CMS transformer verifies the exact v5 SHA-256 before changing only welcome
copy, the Craft scene's game introduction/action and the description. It writes
a new immutable v6 asset; it refuses source drift or an existing output file.
Welcome reads **Play the interactive game.** The Craft scene introduces **The
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

Local qualification passes: seven browser cases on the exact packaged production
build, including desktop 1440×900, touch phone 390×844 orientation prompt and
844×390 gameplay, actual opening WebAudio playback, all five versioned opening
takes, character creation, a Family branch, exact checkpoint reload/resume and
continued choices/audio. Restored artwork, including the woman's ink mark, was
visually checked. Corrupt-save and blocked-storage paths also pass. All three
legacy URL browser cases pass separately on Vite dev. No collected browser
errors or missing assets remain in these final runs.

Focused Vitest checks include the route/leaflet/versioning contracts and bridges
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
`dpl_3Q9suvZHFjSXkTpryp9KySfawWWr` is READY and serves that merge on
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

The hosting preparation now removes only that uniquely guarded bootstrap
preload call. Scene and actor loaders still await required textures, portraits
and crests still load on demand, and later chapter warming remains. All authored
art, recordings, title timing, story logic and checkpoint compatibility remain
unchanged. Qualification and release of this loading-order correction are pending.

The landing wording remains unpublished. Its CMS session was signed out;
Blake has been asked to sign in. Browser control subsequently failed with
`Unable to load browser request-header policy`, including a recovery attempt.
No supported alternate CMS publisher was found. The verified v6 bundle,
native embed template, exact page/block identifiers and rollback instructions
are saved in `D:/claude/amissing-book-integration-20260930/cms/PUBLISH-LANDING-V6.md`.
T-641 cannot be marked done until the landing copy is published and verified.
