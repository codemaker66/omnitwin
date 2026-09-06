# The River Gate, scene 1: sound

Nineteen cues generated on 2026-09-06 with ElevenLabs sound generation (`POST /v1/sound-generation`, model `eleven_text_to_sound_v2`, `prompt_influence` 0.3, `output_format=mp3_44100_128`, `loop: true` for the beds), under the owner's override of that day: everything is made digitally, with a provenance card on every cue. The cue table the stage reads is `packages/web/src/features/trades-house/stage/scene-manifests/scene-01-cues.ts`; this file is the record behind it.

## Budget

| | characters used | of limit | remaining |
|---|---|---|---|
| before the first generation | 27,032 | 39,874 | 12,842 |
| after the last generation | 28,237 | 39,874 | 11,637 |

The account is the starter tier; the count resets at unix 1788733060 (2026-09-06, 22:17 UTC). The measured price is 10 characters per requested second (a 0.5 s cue cost 5, a 20 s bed cost 200; the `character-cost` response header and the subscription delta agree). Today's spend: 1,205 characters, against a ceiling of 8,000. Nothing is missing.

## The cues

Requested seconds are what was sent to the API; delivered duration is the PCM length after trimming. Characters are the total spent on that cue, discarded takes included.

| id | bus | gain dB | requested s | delivered ms | bytes | peak dBFS | LUFS | onset ms | chars | take |
|---|---|---|---|---|---|---|---|---|---|---|
| paper-touch | ui | -6 | 0.5 | 366 | 6,686 | -12.0 | (too short) | 6.3 | 5 | 1 of 1 |
| seal-strike | ui | -6 | 0.7 | 513 | 9,194 | -12.4 | -34.5 | 5.0 | 7 | 1 of 1 |
| page-turn | ui | -6 | 0.8 | 682 | 12,119 | -12.5 | -40.2 | 9.9 | 8 | 1 of 1 |
| quill | ui | -6 | 1.5 | 1,485 | 24,658 | -12.3 | -30.0 | 4.9 | 15 | 1 of 1 |
| chain-swing | sfx | 0 | 1.2 | 1,205 | 20,479 | -12.4 | -33.6 | 5.0 | 12 | 1 of 1 |
| water-plunk | sfx | 0 | 0.8 | 805 | 13,791 | -12.5 | -38.9 | 5.0 | 8 | 1 of 1 |
| lantern-gutter | sfx | 0 | 0.8 | 805 | 13,791 | -12.1 | -27.7 | 5.0 | 8 | 1 of 1 |
| swallow-wings | sfx | 0 | 0.7 | 685 | 12,119 | -12.3 | -38.6 | 5.0 | 21 | 2 of 3 |
| toll-lid | sfx | 0 | 0.6 | 605 | 10,866 | -12.5 | -28.8 | 5.0 | 18 | 3 of 3 |
| toll-coin | sfx | 0 | 0.5 | 324 | 6,268 | -12.7 | (too short) | 6.5 | 5 | 1 of 1 |
| toll-coins | sfx | 0 | 0.9 | 885 | 15,045 | -12.1 | -30.3 | 2.0 | 9 | 1 of 1 |
| toll-bolt | sfx | 0 | 0.7 | 685 | 12,119 | -12.5 | -33.8 | 5.0 | 7 | 1 of 1 |
| apple-turn | sfx | 0 | 0.5 | 485 | 8,776 | -12.6 | -34.2 | 5.0 | 5 | 1 of 1 |
| rope-creak | sfx | -6 | 2.0 | 2,005 | 33,017 | -12.1 | -27.1 | 6.6 | 35 | 2 of 2 |
| gull | sfx | -10 | 1.2 | 1,205 | 20,479 | -12.4 | -33.2 | 5.0 | 12 | 1 of 1 |
| far-bell | sfx | -8 | 3.0 | 2,874 | 47,228 | -12.6 | -27.8 | 5.0 | 30 | 1 of 1 |
| bed-water | ambience | -12 | 20 | 20,000 | 160,495 | -3.4 | -25.0 | loop | 200 | 1 of 1 |
| bed-wind | ambience | -12 | 20 | 20,000 | 160,495 | -3.3 | -20.4 | loop | 600 | 3 of 3 |
| bed-voices | ambience | -12 | 20 | 20,000 | 160,495 | -3.5 | -23.9 | loop | 200 | 1 of 1 |

Total on disk: 748,120 bytes (one-shots 266,635; beds 481,485). LUFS is BS.1770 integrated (pyloudnorm) on the delivered mono file; the meter has no value for the two cues under 400 ms. Onset is the first sample within 30 dB of the peak, measured on the decoded file; it was authored at 5 ms and the two readings over 5 ms (paper-touch, page-turn) are detector spread on soft attacks, not lead-in silence.

## The prompts, exactly as sent

- paper-touch: A single fingertip lightly touching thick handmade paper, one soft dry tap, close-miked, no room reverb, silence after.
- seal-strike: A brass seal pressed firmly into warm soft sealing wax on a wooden desk, one soft heavy thud with a faint waxy squash, close, dry, no ringing.
- page-turn: One page of heavy laid paper turned in a large old ledger, a single dry rustle and settle, close, quiet room, silence after.
- quill: A quill nib writing a short line on thick paper, fine scratching strokes with one small pause, close-miked, dry, no music.
- chain-swing: A heavy chain of links swinging once and knocking against a wooden post, a dull clink and the links settling, outdoors by water at night, no ringing clang.
- water-plunk: A small stone dropped into a slow wide river, one deep hollow plunk with a soft splash, quiet evening, no other sounds.
- lantern-gutter: An oil lantern flame guttering in a sudden gust of wind, a short soft whoosh and flutter of flame, then steadying, close, quiet.
- swallow-wings (take 2, shipped): A single small bird bursting off a wooden post into flight, a quick sharp flutter of small wings, four rapid beats, close-miked, clear and present, quiet dusk, no chirping.
- toll-lid (take 3, shipped): Old wooden chest lid creaking open, hinge creak, short, close-miked, dry, then silence.
- toll-coin: One coin dropped into a small wooden box, a single short clink on wood, close, dry, silence after.
- toll-coins: A handful of coins poured into a small wooden box, a brief tumble of clinks against wood, close, dry.
- toll-bolt: A small bolt on a wooden box sliding shut, one short scrape and a firm click, close, dry.
- apple-turn: Something small turning over in still water beside a wooden jetty, a single soft lap and gurgle, very quiet, close.
- rope-creak (take 2, shipped): A thick wet mooring rope creaking slowly once as a boat pulls against a wooden jetty, one long low creak that eases off and stops, then quiet evening water, outdoors.
- gull: One distant gull calling twice over a wide river at dusk, far away, soft, with faint open air, no other birds.
- far-bell: A distant church bell, one single strike, heard across a river on a still evening, soft and far, with a long fading decay, no other sounds.
- bed-water: A slow wide river at dusk heard from mid-distance, a steady gentle flow and soft lapping against a stone bank, calm, no rain, no wind, no birds, seamless ambience loop.
- bed-wind (take 3, shipped): Wind blowing steadily across a stone sea wall at night, recorded close, loud and full, a deep continuous rush of air with slow surges, no whistling, no rain, no water, no birds, seamless ambience loop.
- bed-voices: A distant market crowd murmuring across water on a summer evening, many soft voices blended together with no intelligible words, no music, no bells, seamless ambience loop.

## Discarded takes, and why

Nobody listened to these files today; every choice below was made on measurements, and Blake's ear is the judge that remains.

- swallow-wings take 1 (prompt: "A single small bird taking off from a wooden post, a quick flutter of small wings, three or four beats, close, quiet dusk, no chirping."): peak -25.6 dBFS, -52.9 LUFS, near-empty. Take 2 (-0.7 dBFS peak, 390 ms of flutter) shipped; take 3 ("Small bird wing flap taking off, fast wingbeats close to the microphone, crisp feathers, no vocalisation, no background.") was quieter and shorter.
- toll-lid take 1 (prompt: "The lid of a small old wooden box opening on stiff hinges, one short wooden creak and a light knock as it rests open, close, dry."): 47 ms of knock and no hinge body. Take 2 ("A small old wooden box lid lifted open slowly on stiff dry hinges, a short creaking groan of wood then a light knock as the lid rests back, close, dry.") was two knocks. Take 3 has a 500 ms sustained creak and shipped.
- rope-creak take 1 (1.5 s, prompt: "A thick wet mooring rope creaking slowly as a boat pulls against a wooden jetty, one long low creak, outdoors, quiet evening water."): hard-limited at 0 dBFS (23 clipped samples) and creaking to the last sample. Take 2 at 2.0 s eases off in its last 300 ms and shipped with a 300 ms fade; it is also limited at the source (19 clipped samples, now sitting at -12 dBFS after normalisation). The task asked for 1.5 s; the shipped file is 2.0 s because the model would not end the creak sooner.
- bed-wind takes 1 and 2 (prompts: "A low steady wind moving over a stone estuary wall at night, soft and hollow, no whistling, no rain, no water, seamless ambience loop." and "A steady low wind blowing over a stone estuary wall at night, present and full, a soft continuous rush with slow gusts, no whistling, no rain, no water, no birds, seamless ambience loop."): both at -60 LUFS with a -34 dBFS peak, too quiet to lift 30 dB without lifting the encoder's noise. Take 3 (-28 LUFS raw) shipped.

The raw stereo takes, every discarded take, the generation log (`gen-log.jsonl`, one row per API call with its `character-cost`) and the scripts are kept at `D:\claude\quiz-stage-sfx\` (`raw/`, `takes/`, `tools/`): source files are never deleted.

## Post-processing (why the delivered files differ from the raw takes)

The API returns stereo 44.1 kHz 128 kbps MP3 with a variable lead-in (paper-touch's transient sat 116 ms into its file) and peaks anywhere from -25 to 0 dBFS. The spec (plan section 6) wants mono, material pokes with the transient within 5 ms of the file's start, peaks near -12 dBFS, beds mono and loopable. Each shipped file is therefore: decoded (miniaudio), summed to mono (the mid loses at most 3.4 dB against the channel average, on toll-coins and far-bell whose channels are decorrelated; level is restored by normalisation), one-shots trimmed to 5 ms before the onset and to 40 ms after the last sample above -60 dBFS with a 30 ms fade (rope-creak 300 ms, gull 150 ms), peak-normalised to -12 dBFS (beds to -3 dBFS, no trim and no fade so the model's loop seam survives), and re-encoded with LAME 3.100 (`lameenc`, quality 2) as mono 44.1 kHz MP3 at 128 kbps (one-shots) or 64 kbps (beds).

`lameenc` writes no Xing/Info frame, so each file carries a hand-built CBR `Info` frame with the LAME extension (encoder delay 576, padding per file, info-tag CRC-16). Two decoders confirm it: mutagen (which validates the CRC) reports each file's length as exactly the PCM length, and miniaudio's decoder returns exactly `expectedSamples` frames with the transient at 5 ms. `expectedSamples` in the cue table is therefore the exact PCM count fed to the encoder; a decoder that ignores the tag returns 576 + 529 leading frames more plus the padding, which is what the engine's expected-sample correction is for.

Peak levels could be measured (ffmpeg is absent, but miniaudio decodes MP3 without it); nothing about the sound's character was judged by ear.

## Mix notes for the engine

Gains follow the brief: pokes 0 dB, the ceremony's ui cues -6 dB (paper-touch is played at -18 dB by the ceremony on top), beds -12 dB, far-bell -8 dB. Two values were not specified and are this session's choice: rope-creak -6 dB and gull -10 dB, both distant one-shots that should not compete with a poke. With the bus table in `audio/audio-types.ts` as of 2026-09-06 (ambience -18, sfx -12, ui -16) and the Appendix D bed mix (water 0.6, wind 0.3, voices 0.15), a poke peaks at about -24 dBFS and bed-water's RMS sits near -60 dBFS, some 36 dB under it; the OfflineAudioContext loudness gate is the instrument that sets the final numbers, not this table.

## Fairness lint

Every cue id, file name and caption was checked against the scene's four worlds in `__tests__/world-lexicon.ts` (hammermen, gardeners, tailors, cordiners) and against `CRAFT_NAMES`: 0 hits. Prompts describe materials freely ("brass seal", "wooden box") and are never shown to a reader; "iron" appears nowhere.
