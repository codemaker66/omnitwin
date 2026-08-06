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

/**
 * What he says after ye answer a scene.
 *
 * These deliberately pass NO judgement on the choice. The scenes are built so
 * that four serious people would answer four different ways; a narrator who
 * said "aye, the right call" would both break the brief's no-verdicts law and
 * hand players a map for gaming the sort. So he does what a clerk does — he
 * marks that it happened, and moves the room on. One per scene, in order, so
 * a full run never hears the same acknowledgement twice.
 *
 * The character shows through the CADENCE, not through approval.
 */
export const CONVENER_ACKNOWLEDGEMENTS: readonly string[] = [
  "Mm. The book has that now.",
  "Aye. Written, and no' forgotten.",
  "Noted. I'll no' say what I think.",
  "Right ye are. On we go.",
  "That's the ink dry on that one.",
  "Mm-hm. Ye didnae flinch. I'll mark that too.",
  "Down it goes, in a fair hand.",
  "Aye. Some folk take longer at that one.",
  "The Hall has heard ye.",
  "Set down. Next.",
  "Och, that's an answer and a half. Onward.",
  "And the last of it — hold still while I write.",
];

/** The acknowledgement for a given scene, cycling if the quiz ever grows. */
export function convenerAcknowledgement(questionIndex: number): string {
  const safeIndex = Math.abs(Math.trunc(questionIndex)) % CONVENER_ACKNOWLEDGEMENTS.length;
  return CONVENER_ACKNOWLEDGEMENTS[safeIndex] ?? CONVENER_ACKNOWLEDGEMENTS[0] ?? "";
}

/**
 * His reply to each specific answer — 12 scenes x 4 options, in order.
 *
 * The line between a REACTION and a VERDICT is the whole craft here. He may
 * notice what ye chose, name what it costs ye, tease ye, or go quiet with it —
 * he may never say ye chose well or badly. Two reasons: the brief forbids
 * verdicts, and a narrator who warms to one option has published the answer
 * key. If a new line could be paraphrased as "good call" or "ye poor fool",
 * it is wrong, however fine it sounds.
 *
 * He also never names a Craft, or hints which one an answer serves.
 */
export const CONVENER_REACTIONS: readonly (readonly string[])[] = [
  // The Half-Done Thing
  [
    "Ten years, ye say. And ye never blinked at the number. Rab knew what he was doing, handing that to you.",
    "The lad, then. In thirty years somebody will ask whose work it is, and there'll be nae simple answer.",
    "The widow eats. Nobody carves that on a wall, but she eats.",
    "Untouched. Some would call that giving up, some the only honest thing left. You ken which ye meant.",
  ],
  // The True Thing That Doesnae Suit
  [
    "The measure holds. And a man walks home with a true thing he will never love. Both of those are yours now.",
    "The fit wins. He'll no' forget it — a maker remembers the day his true work was sent back.",
    "Locked in together. Och, ye brave soul. I've seen that end in a handshake and I've seen it end worse.",
    "Ye paid. The cheapest way out of that room was a word, and ye chose the dearest.",
  ],
  // One Armful
  [
    "The box. Cold arithmetic in a warm panic — that takes a certain nerve.",
    "The papers. A year from now the claim is won and nobody thanks ye for it. You'll ken, though.",
    "Her hand on the paper. Poorer, and holding the only copy that ever existed.",
    "Through the wall. Ye never waited to find out if she needed ye. That is the whole of ye, that.",
  ],
  // The Thing Told at the Fire
  [
    "A deadline. The man came for peace and left with a week. Mercy with teeth in it.",
    "Ye'll mend it quiet and let him keep the comfort of being unpunished. A strange, generous arithmetic.",
    "In yer pocket, then. Mind — a thing kept that long starts to feel like it belongs to ye.",
    "Ye carried it. Two tables, one man, nae relief in either seat.",
  ],
  // The Paid Debt
  [
    "Ye let yerself be helped. You would be astonished how many cannae, and call it pride.",
    "Squared to the penny. Grace, filed under settled. It'll sleep better in the ledger.",
    "Passed on into the dark. Somebody gets a good winter and never learns whose.",
    "Banked against the hook. I would want ye counting my money. I'm no' sure I'd want yer winter.",
  ],
  // The Far Buyers
  [
    "True, and the roof waits. Yer wee ones will no' understand that for twenty years. Then they will.",
    "Written into the bargain. Every man after ye is bound by a rule he never agreed to — that is how a standard starts, and why it's hated.",
    "Thin where it doesnae show. You'll keep that ledger in yer head, and it is a heavy one.",
    "Turned down flat. The best purse of the year, refused on a principle nobody asked ye to hold.",
  ],
  // The Smooth Road
  [
    "Ye took it, and ye meant it. Warm houses. And every vote from here is his — ye knew that when ye said aye.",
    "At the market cross, out loud. Ye've made yerself expensive to ignore and cheap to punish.",
    "Quiet, every time. Nae banner, nae credit, nae witness. That one is only ever between you and you.",
    "His coin, yer purpose. Every man who took that road told himself the same. Some were even right.",
  ],
  // Berries Off the Same Field
  [
    "Condemned whole, and ye took the cut yerself. An expensive kind of honesty.",
    "Ye stood for him. This town has a long memory and a short list of folk it forgives for that.",
    "Nothing either way. He meets it alone, and you go home and look at the field. Both true.",
    "Said it out loud in a court, then put yer name on his mending. That's no' mercy, that's an investment.",
  ],
  // The Room Gone Quiet
  [
    "Ye sat down beside him and ate. Nothing said. The whole room read it anyway.",
    "On yer feet, order restored. The man is still the colour of ash, mind — but the feast survived.",
    "Ye named the reader. An enemy with friends, and a friend with none.",
    "Ye kicked over yer own glass. The daftest, kindest thing in that room, and nobody will ever ken it was deliberate.",
  ],
  // The Twice-Broken Word
  [
    "The whole caution. Twice broken, and ye signed. That is faith, or arithmetic ye've no' done.",
    "Half, with the truth attached. You'll find out soon enough whether a man can hear that as anything but an insult.",
    "Ye walked beside him and signed nothing. He'll mind the walking. He'll mind the nothing too.",
    "Refused plainly, with a reason. If he sinks, he hears that sentence in your voice for the rest of his life.",
  ],
  // The Wee Kindness
  [
    "Handed back, and him set to work. He keeps it or he doesnae, and you'll ken by the spring.",
    "Ye built the machine. A thousand bowls a year and no' a warm word in any of them — and it is a real thing ye've made.",
    "Ye let him have his stage. The town gets a spectacle and you get a part ye never auditioned for.",
    "Ye told the bairn the true part and let him tell the rest. Two stories now, and only one of them yours.",
  ],
  // The Good Chair
  [
    "Mended for sitting. Every repair takes a wee bit of the auld hands away, and ye did it anyway.",
    "Sealed and set apart. It'll outlive every one of them now, and never hold another soul.",
    "Sold, and the roof fixed. The oldest thing in that family left in a cart, and the living stayed dry.",
    "The chair and the mending both. Her first repair will be poor and it will show forever. That's the point, is it no'?",
  ],
];

/** His reply to a given answer; falls back to a plain mark if ever missing. */
export function convenerReaction(questionIndex: number, optionIndex: number): string {
  return CONVENER_REACTIONS[questionIndex]?.[optionIndex]
    ?? convenerAcknowledgement(questionIndex);
}

/** Milliseconds of no input before he dozes off. */
export const CONVENER_DOZE_AFTER_MS = 45_000;

/** Terminal poke index — reached, then held. */
export const CONVENER_FINAL_POKE_INDEX = CONVENER_POKES.length - 1;
