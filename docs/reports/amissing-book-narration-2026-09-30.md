# The Amissing Book: narration delivery, 30 September 2026

## Finding

Vercel production `dpl_H1NKSd5vkAbeoeYqYSfiRoBcXvbC` serves master
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
separate from the narrator and were not replaced. If Blake's "intro" refers to
those, confirm that scope before replacing their authored voices. The older
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
release. Deployment and exact live output checks are pending.
The CLI browser could not start, its Chromium download was invalid, and the
cloud browser timed out. No successful visual/playback check is claimed.
