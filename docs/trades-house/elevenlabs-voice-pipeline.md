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

## Blake's two jobs (~15 minutes total)

1. **Account + key.** Sign up at elevenlabs.io → *Creator* plan (~$22/mo; the whole
   corpus is a one-time ~40k characters, well inside the 100k monthly credits —
   after generation you can downgrade). Profile → API Keys → create. Put it in
   `packages/web/.env.local` as `ELEVENLABS_API_KEY=...` — **never commit it;
   never paste it in chat.** Tell Claude "key is in place" — that's all Claude
   needs to know.
2. **Pick the voice.** Claude will build `scripts/convener-voice/audition.mjs`,
   which generates 4–6 candidates (Voice Design prompts like "warm gravelly aged
   Glaswegian male, quick theatrical energy, kind" plus the best Scottish voices in
   the Voice Library) each speaking the same three Convener lines, and writes a
   local `audition.html`. Open it, listen, pick. The winning `voice_id` is pinned
   in `scripts/convener-voice/voice.config.json` (committed — it's an ID, not a
   secret). If a real Glaswegian voice actor is ever cloned instead, get written
   rights first.

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
