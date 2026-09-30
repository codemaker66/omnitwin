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

The raw game export and media in `public/amissing-book` remain unchanged.
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

Implementation and game qualification are in progress. Production integration,
deployment and post-release MP3 verification remain required. The CMS session
is signed out; Blake has been asked to sign in before landing publication.
