# The Convener's voice — ElevenLabs pipeline (phase R4)

> How the portrait becomes perfectly in sync **visually** (mouth, expressions),
> **textually** (the typewriter), and **auditorily** (the voice): one manifest,
> word-level timestamps, zero runtime API calls.

## The architecture in one paragraph

Every line the Convener speaks is authored corpus — nothing is generated live. So
we batch-generate audio ONCE, offline, with a script. Each line is hashed; the
script calls ElevenLabs' text-to-speech **with-timestamps** endpoint and saves
`public/trades-house-media/voice/<hash>.mp3` plus a manifest entry recording when
each character of the line is spoken. At runtime, `say()` plays the mp3 and reveals
the typewriter text **on the audio's own character timestamps** — the text appears
exactly as he says it, and the mouth flaps on the same clock. The API key never
ships to the browser; the site serves static mp3s.

## Status (2026-08-06) — built, blocked on one thing

**Done:** key in `packages/web/.env.local` (gitignored, verified untrackable);
voice chosen and pinned in `scripts/convener-voice/voice.config.json`
(`wteyCP7td8C5nYwWnOV1`, "Chris Lee" — an instant clone Blake made);
`scripts/convener-voice/generate.mjs` written and dry-run proven.

**Blocked on:** the account is on the **free** tier. Three hard stops, each
measured against the live API rather than inferred:

| Need | Free | Evidence |
| --- | --- | --- |
| Serve an instant-cloned voice via API | ✗ | `401 ivc_not_permitted — Instantly cloned voices are not available on your current plan` |
| Commercial licence | ✗ | free grants none, and this ships on a client's public site |
| 14,951 characters for one full pass | ✗ | free cap is 10,000/month |

**Starter ($6/mo, 30,000 credits) clears all three** with a revision pass spare.
Creator ($22) matters only for professional cloning or heavy rewriting. Nothing
in the setup changes when the plan does — just rerun the generator.

> Corrected from the original plan, which guessed Creator was required and
> assumed a ~40k corpus. Measured: 102 lines, 14,951 characters.

Voice-library voices were considered and rejected: 27 Scottish ones exist, but
`free_users_allowed` governs the web UI only — the API returns
`402 paid_plan_required` for all of them. Voice Design is likewise paid-only
(`403 feature_not_available`). So the free tier could never have shipped this.

### The variable name is load-bearing

`ELEVENLABS_API_KEY`, **never** `VITE_ELEVENLABS_API_KEY`. Vite inlines every
`VITE_*` variable into the client bundle, so that one prefix would publish the
key to every visitor of a public site. Only Node scripts may read it.

### If a key is ever exposed

Rotate it. A key pasted into chat, a ticket, or a commit is burned even if it
looks unused — this repo is **public**, and keys in public repos are scraped
within minutes.

## Claude's build (R4, after the voice is picked)

- `scripts/convener-voice/generate.mjs`:
  - Extracts the full corpus: `convenerLine`s from `craft-quiz-model.ts`, the
    constants in `convener/convener-lines.ts`, and (R3) the director's reactive
    corpus. Display text and speech text can differ per line if a spelling trips
    the TTS (the manifest keeps both).
  - Per line: `sha1(speechText).slice(0,16)` → skip if the mp3 exists (idempotent —
    edit one line, regenerate one file) → `POST /v1/text-to-speech/{voiceId}/with-timestamps`
    with `model_id: "eleven_multilingual_v2"`, `output_format: "mp3_44100_128"` →
    write mp3 + manifest entry `{ hash, displayText, charStartTimesMs }`.
  - Writes `public/trades-house-media/voice/manifest.json`.
- Runtime (`ConvenerPortrait.say()` gains an audio mode):
  - Manifest hit → play the mp3, reveal typewriter chars on `charStartTimesMs`,
    drive the mouth-flap cadence from the same timings; promise resolves on audio
    end + hold. Manifest miss → today's cps typewriter, unchanged.
  - Audio unlocks on the BEGIN click (iOS/Chrome autoplay policy — one user
    gesture), which is also when the first questions' audio preloads.
  - Mute toggle, persisted in localStorage; muted = today's typewriter behaviour.
  - Reduced motion: full text instantly (existing rule) while audio still plays —
    motion preferences are not sound preferences; the hold equals audio duration.

## Order of operations

1. Blake: key in `.env.local` (any time).
2. Claude: audition script → Blake picks voice (10 min).
3. Claude: generate.mjs + manifest + runtime sync + mute toggle.
4. Regenerate as R2/R3 corpora land — only new/edited lines cost credits.
