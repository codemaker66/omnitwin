// ---------------------------------------------------------------------------
// Ye Auld Convener — the spoken corpus
//
// A talking portrait of the Hall's patron: a medieval Scottish Robin Williams.
// Warm, fast, theatrical, and never mean. He escalates rather than repeats —
// the joke is that he REMEMBERS, so ordering matters in every bank below.
//
// Voice rules for anyone adding lines — the register is HOLLYWOOD SCOTS
// (Blake's ruling, 2026-08-05): obviously Scottish, effortlessly understood
// by Americans, English and Europeans. Shrek, not Burns manuscripts.
//   - The COMPREHENSION TEST: a non-Scottish teenager understands every line
//     cold, no glossary. If a word fails that, use the standard spelling and
//     let rhythm and idiom carry the Scottishness.
//   - Freely use: aye, ye/yer, ken, auld, wee, nae, och, wisnae/cannae/didnae,
//     laddie/lassie, bonnie, tak, wi', bairn, o'. Famous phrases are exempt
//     from the test ("Here's tae us — wha's like us!"). Rulings (2026-08-06):
//     "bairn" is allowed (Shrek-tier famous, load-bearing warmth); "naebody"
//     is NOT — write "nobody", per the naething precedent; "the morn" is NOT —
//     write "tomorrow" (non-Scots read it as "the morning").
//   - Avoid dense orthography: fower, abune, naething, mooth, oot, withoot,
//     ance, gaed/gang. Write four, above, nothing, mouth, out, without, once.
//   - He is centuries old and finds that funny, not tragic.
//   - He may be exasperated, never cruel. The user is a guest of the Hall.
//   - Capitals carry the performance: he SHOUTS one word, not whole lines.
//   - Every line will also be SPOKEN (ElevenLabs) — read it aloud; if the
//     spelling would trip a text-to-speech engine, prefer the standard form.
// ---------------------------------------------------------------------------

/**
 * Poking the portrait. Strictly ordered: the index is a monotonic poke count,
 * so these read as one rising performance. The last line is terminal and
 * repeats — he has run out of patience but not of affection.
 */
export const CONVENER_POKES: readonly string[] = [
  "Careful — the varnish is aulder than yer country.",
  "Aye, hullo. I'm a PAINTING. This is one-way glass, friend.",
  "Poke the Bakers' crest instead, it's softer.",
  "I felt that in 1611.",
  "Persistent! The Hammermen tak applications, ye ken.",
  "Right. That's it. I'm telling the Deacon.",
  "…Still at it. I admire it. I HATE it — but I admire it.",
  "The frame is gold leaf. The man is priceless. HANDS.",
];

/** Spoken as he nods off. Idle long enough and the Hall goes quiet. */
export const CONVENER_DOZE = "…zzz… mind the… quorum…";

/** Spoken the instant anything wakes him. */
export const CONVENER_WAKE = "WHA—! I wisnae sleeping. I was thinking wi' my eyes shut.";

/** He has been alone with his own portrait for four and a half centuries. */
export const CONVENER_IDLE_MURMURS: readonly string[] = [
  "Tak yer time. I've nothing but.",
  "The bell above us was cast in seventeen ninety-four. It waits fine, ye ken.",
  "I'll be here. I'm load-bearing.",
];

/** Milliseconds of no input before he dozes off. */
export const CONVENER_DOZE_AFTER_MS = 45_000;

/** Terminal poke index — reached, then held. */
export const CONVENER_FINAL_POKE_INDEX = CONVENER_POKES.length - 1;
