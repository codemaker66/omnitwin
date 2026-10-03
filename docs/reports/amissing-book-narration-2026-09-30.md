# The Amissing Book: narration delivery, 30 September 2026

## Finding

Before the fix, Vercel production `dpl_H1NKSd5vkAbeoeYqYSfiRoBcXvbC` served master
`f51af1686975450276d3a3d80dfeb43802213734`, which contains the 209 replacements in
`5198fed537775f2a63462acb1b9c3a49fb89b20c`. Those MP3s have not changed since that
commit. Ordinary and cache-busted GETs match the repository bytes, including the
opening "Glasgow, tonight" (`vo_de0b5e66.mp3`, SHA-256
`a6bf140ca08b11c8cefad2de90f46676a3842d6ff7dca5788d7194eed05d7fd6`).

The live audio response nevertheless says
`public, max-age=3600, stale-while-revalidate=604800`. The original bundle fetches
`audio/index.json`, which still names the same MP3 paths. The names hash the
spoken words (FNV-1a), not the recording. A browser that retained the previous
response can therefore play an old take while this fresh network probe passes.
No claim is made that the sampled Vercel edge returned an old take, or that we
inspected Blake's browser cache. The HTML entry responds with
`public, max-age=0, must-revalidate`.

Both cited GitHub runs succeeded on 29 September, at the specified commit:
[CI 36633659628](https://github.com/codemaker66/omnitwin/actions/runs/36633659628)
and [Deploy 36635611750](https://github.com/codemaker66/omnitwin/actions/runs/36635611750).
The latter only applied DB migrations and emitted a Railway notification. Vercel
deployment identity and actual audio responses provide the web-delivery evidence.

## Scoped fix

The Vercel build now versions the imported game's narration from the actual MP3
SHA-256, publishes a content-addressed manifest, and points the HTML at a fresh
asset directory derived from the manifest and module graph. Relative imports,
cyclic back-imports, and absolute asset references stay within that graph. A query
on only the entry module would have created two instances via back-imports.

The imported game, narration bytes, music, art, general cache headers, and other
Venviewer routes are unchanged. All 222 exported voice paths are versioned (214
hashed narration files plus eight character voices); 209 narration files were
replaced in the requested commit. The five older hashed exports have no matched
current bundled narrative line; this is not a claim that every exported MP3 was
re-recorded. A new take at an existing filename changes all URLs needed to reach
it. A player with an already-open old game must reload the document.

The source game was exported from `D:/PC/trades-hall-game` using
`tools/share_build.py` (hosting commit `745e1657`). This build-side adaptation
keeps that upstream export untouched. The packaging hook lives in Vercel's
buildCommand, after the existing application build; the shared package build and
renderer toolchain are unchanged. It fails if the loader reference changes or a
manifest voice file is missing.

## Intro and voice provenance

All five opening lines, and the subsequent nine Book/character-creation branch
narration lines, were replaced by `5198fed5`. The first five files are
`vo_de0b5e66`, `vo_5b1397cd`, `vo_df3cc8e4`, `vo_d789adc8`, and `vo_c50ee102`.
The title animation itself uses ambience and sound effects.

Commit `5198fed5` records Mythia Refined on Eleven v4, slow/unhurried second-person
direction, three takes, selection for correct words, no spoken directions,
lively pitch and unhurried pace, then levelling. The exact voice ID, generation
parameters, and prompt text are absent from this repository. Reusing the verified
recordings preserves Claude's actual takes without inventing those settings.
Byte equality proves delivery of the requested takes, not a perceptual voice ID.

The eight `vo_face_B1a`–`vo_face_B8a` character-selection introductions were
deliberately recorded in each character's own voice (`443dba75`). They are
separate from the narrator and were not replaced. Blake confirmed that the
reported problem is the opening story, not character selection. The older
Convener/Chris Lee generation pipeline in this repository is not Mythia's.

## Verification and release state

Raw baseline requests, full SHA-256 values, URLs and response headers are in
[baseline.json](assets/amissing-book-narration-2026-09-30/baseline.json).
Regression tests cover overwritten takes, the complete URL chain, cyclic and
absolute imports, deterministic builds, failure on upstream contract drift or
missing files, and every shipped voice's hash. Header coverage includes all
three game entry routes.

Local qualification: 21 focused tests, affected ESLint and complete web/source
and E2E TypeScript checks pass. The production-mode application build and the
audio packaging step pass; every emitted voice query contains its MP3 SHA-256.
Independent review found and corrected Vite's base-relative preload map before
release. PR [#38](https://github.com/codemaker66/omnitwin/pull/38) CI
[36697781805](https://github.com/codemaker66/omnitwin/actions/runs/36697781805)
passed lint, typecheck, builds, tests, all four CPU browser shards and the browser
release gate; the unchanged GPU scope policy correctly excluded this change.
The security audit failed on ten existing transitive-package advisories. The
release prerequisite updates only the existing overrides for brace-expansion
to 1.1.21, 2.1.7 and 5.0.12, and engine.io to 6.6.10, with pnpm 9.15.4's
regenerated lockfile. No unrelated resolutions changed. The subsequent local
audit reports zero vulnerabilities. Final candidate `319308857e259b6c7ccf024f2b589cca81dc4d5c`
passed every applicable gate in
[CI 36702572642](https://github.com/codemaker66/omnitwin/actions/runs/36702572642),
including security audit, all four CPU browser shards and the browser release gate.
Vercel's preview was READY and its commit status succeeded before merge.
The CLI browser could not start, its Chromium download was invalid, and the
cloud browser timed out. No successful visual/playback check is claimed.

## Production verification: complete

PR #38 merged as `540dce2e590dbd10359766760a56fb8e01b5da2d`; its tree is identical
to the tested candidate. Production deployment `dpl_Bb1Rg9bfCbFSWBpswkJxFmXRm7U4`
is READY at that commit and owns `venviewer.com` and `www.venviewer.com`.
At 10:45 UTC on 30 September, live GETs verified:

- The HTML, entry module, hashed manifest and all 14 packaged assets match the
  build byte for byte. The module graph revision is
  `0ffeada815b66419a4f17462ac8b1344e69ebf9c8c843fb61b0ec4fbcde0c7dd`.
- Every one of the 222 manifest voice URLs contains its actual MP3 SHA-256.
- Seven representative clips, including all five opening lines, a later narrator
  line (`vo_fdd2dbc3`) and an unchanged character voice (`vo_face_B1a`), match both
  current master and `5198fed5`. All 21 unversioned, versioned and additionally
  cache-busted GETs returned HTTP 200, `audio/mpeg`, and the expected bytes.
- The entry remains `public, max-age=0, must-revalidate`. The audio and manifest
  retain `public, max-age=3600, stale-while-revalidate=604800`; their new URLs
  remove reuse of responses stored under the earlier unversioned URLs.

Full URLs, headers, SHA-256 values, and deployment/CI identity are recorded in
[production.json](assets/amissing-book-narration-2026-09-30/production.json).
Reloading [the game](https://venviewer.com/amissing-book/) fetches Claude's
existing Mythia opening takes through this versioned chain. No recordings were
regenerated and no voice settings were guessed. A game already open before the
release needs a document reload. Delivery is verified; perceptual voice or visual
acceptance is not claimed.
