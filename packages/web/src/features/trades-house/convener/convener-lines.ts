// ---------------------------------------------------------------------------
// The Convener — the spoken corpus
//
// The voice that tells the year in the nameless town, and answers you as you
// go. He has watched a great many people arrive and has stopped being surprised
// by any of it, which is not the same as having stopped caring.
//
// REGISTER: Ursula K. Le Guin (Blake's ruling, 2026-08-07, replacing the
// Hollywood Scots of the previous build). Plain, luminous, unhurried. The
// dialect is gone entirely — from the tales AND from him.
//   - Anglo-Saxon over Latinate. "Began", never "commenced".
//   - Concrete things: weather, water, wood, hands. Never an abstraction where
//     an object will do the work.
//   - Short declaratives, then one longer sentence that opens out.
//   - No adverb propping up a weak verb.
//   - He KNOWS MORE THAN HE SAYS. What he leaves out is the character.
//   - Moral seriousness, no moralising. He never tells you what to feel.
//   - Dry, often funny, never arch and never cruel.
//   - NO VERDICTS. He may witness a choice; he may never grade it. "That is not
//     a judgment, it is a count" is the whole posture.
//   - NO CRAFT NOUNS. He has not named one in twelve scenes (L8), and the
//     sorting must never be guessable from anything he says.
//   - Every line is also SPOKEN. Read it aloud before you keep it.
// ---------------------------------------------------------------------------

/**
 * What he says before the first scene, so that nobody is dropped into a
 * dilemma without being told what this is.
 *
 * Three beats, in order: what is about to happen, that nothing here is graded,
 * and what he is actually listening for. The last one says out loud that the
 * sorting cannot be steered — which is true, because the axes are hidden and no
 * option maps to a Craft. Saying so up front turns the one thing a clever
 * reader would otherwise spend twelve scenes attempting into a joke they are
 * in on.
 *
 * He still names no Craft (L8) and still grades nothing (L10).
 */
export const CONVENER_THRESHOLD: readonly string[] = [
  "I will tell you about a year. You came here with nothing, and twelve times the choosing cost you something.",
  "There are no right answers. In four hundred years I have never seen a wrong one — only people leaning different ways under weight.",
  "Which way you lean is what I am watching. At the end I will name where you belong. Do not try to steer it — you cannot.",
];

/**
 * Poking the portrait. Strictly ordered: the index is a monotonic poke count,
 * so these read as one rising performance. The last line is terminal and
 * repeats — he has run out of patience but not of interest.
 */
export const CONVENER_POKES: readonly string[] = [
  "That is a wall. I am on it.",
  "You have found the one thing in this room that cannot feel anything.",
  "Again. All right.",
  "There is a river out there and a year ahead of you, and you are doing this.",
  "I have been looked at by better and prodded by worse.",
  "The paint is older than your country. Be careful with it, or do not. It is all one to the paint.",
  "I can wait longer than you can. It is the single thing I am good at.",
  "Enough, now. There is a child in a river and you are poking a picture.",
];

/** Spoken as he goes quiet. Idle long enough and the room settles. */
export const CONVENER_DOZE = "…the water. Mind the water…";

/** Spoken the instant anything rouses him. */
export const CONVENER_WAKE = "I was not asleep. I was looking at something you cannot see from where you stand.";

/** Small sounds in a quiet room. Never urgent, never asking for anything. */
export const CONVENER_IDLE_MURMURS: readonly string[] = [
  "The light crosses this floor the same way every day. I have had time to check.",
  "There were others on this wall once. Moved, or painted over, or simply stopped being looked at.",
  "Take the time. Nobody here is going anywhere, and I am the least likely of us.",
];

/**
 * Held between scenes when nothing more particular is warranted. Short by
 * design: the tale is the thing, and he is not competing with it.
 */
export const CONVENER_ACKNOWLEDGEMENTS: readonly string[] = [
  "I have that.",
  "Go on.",
  "That is written down now.",
  "I see.",
  "Noted, and kept.",
  "The year turns.",
  "Onward.",
  "Held.",
  "Say the next one.",
  "That one took you a moment.",
  "Yes.",
  "Keep walking.",
];

export function convenerAcknowledgement(questionIndex: number): string {
  const safeIndex = Math.abs(Math.trunc(questionIndex)) % CONVENER_ACKNOWLEDGEMENTS.length;
  return CONVENER_ACKNOWLEDGEMENTS[safeIndex] ?? CONVENER_ACKNOWLEDGEMENTS[0] ?? "";
}

/**
 * One reply for every option in every scene — twelve banks of four, in scene
 * order, in option order. He answers WHAT you chose; convener-observations.ts
 * answers HOW you chose it.
 *
 * The discipline that makes these work is refusal: he witnesses the choice and
 * its price, and stops. The moment one reads as approval, the sorting becomes a
 * test, every later answer becomes a performance for him, and the hidden axes
 * stop measuring anything real.
 */
export const CONVENER_REACTIONS: readonly (readonly string[])[] = [
  // 1 — The River Gate
  [
    "Iron. You said it before you had quite decided to, which is how I knew it was true.",
    "Living things, carried four hundred miles, and most of them still alive. That is a particular kind of attention.",
    "Paper instead of bread. Not one in ten would choose that, and you did not pause over it.",
    "Nothing in the bag, and four hundred miles on your feet. You will be believed on how you walked in, or you will not, and you have decided to find out which.",
  ],
  // 2 — The Low River
  [
    "You went in. I thought you might. Most do not, and that is not a judgment, it is a count.",
    "Three seconds for eight feet of ash. You will do that arithmetic again for the rest of your life.",
    "You made it everyone's. The three who did not move are moving now, and they will remember who made them.",
    "You walked the gravel, and never once looked up at the people watching you take the long way.",
  ],
  // 3 — The Fence
  [
    "A week on a thing you cannot explain, on the chance that somebody once could.",
    "You went and asked. That makes you the stranger who questions things, and you knew it before you knew the answer.",
    "Your joint, your soil, your sixty years. It is a better fence now, and it is not theirs.",
    "You changed the question. Sometimes that is wisdom and sometimes it is not listening, and from out here they look alike.",
  ],
  // 4 — The Naming
  [
    "Your own. Nothing in it for them to take hold of, which means you will be filling it yourself, and slowly.",
    "The work, then. Short and true, and it tells a stranger where to bring a broken thing.",
    "You let them choose. That is great trust or great tiredness, and I have known it be both at once.",
    "A name you have not earned yet. Forty years to catch it, and it will be watching you the whole way.",
  ],
  // 5 — The Other One
  [
    "You will wait. Years, possibly, being right and poor, and the waiting will be the harder half of the work.",
    "You said it out loud. Somebody had to, and now you are the one who did.",
    "You went to learn from them. That costs more pride than most people have to spend.",
    "You mend what they break and say nothing. A living built on their failures, which needs them to keep failing.",
  ],
  // 6 — The Ring
  [
    "Every item, true, and nobody will ever know you did it. That is the whole of the thing.",
    "You decided what you were owed with nobody else in the room. The room is the part that matters.",
    "You told him while he was still there to hear it. He may not have followed a word.",
    "You spent it on being right about what it was for. You may well be right.",
  ],
  // 7 — The Thin Winter
  [
    "First into an empty pot. If nobody follows, you have given away your winter to prove a thing about your neighbours.",
    "Arithmetic before feeling. You will learn exactly who lied about their cellar, and greet them all spring.",
    "Three mouths, four hard months, and the seed kept back. The town will remember this longer than the winter lasts.",
    "You made it go further. Nobody thanks the one who makes thin things bearable. I noticed.",
  ],
  // 8 — The Door You Were Told Of
  [
    "You decided, alone, that you understood her better than her own instruction did.",
    "Shut. Whatever is behind it may be past saving, and a trust that holds only while it is easy was never one.",
    "You called her home. You will both know you could not settle it yourself, and that is not nothing.",
    "You went around it. Clever, and slow, and the roof does not care which.",
  ],
  // 9 — What the Town Is Built On
  [
    "A season of digging and a bad year for everyone. Some of those households are the ones in the low cottages.",
    "Stone under eleven floors, starting Monday, and the leat stays. You made the wrong thing bearable, which is how it lasted sixty years.",
    "You made them look at one another. Towns do not forgive the one who held the mirror up.",
    "You walked out. The water runs on without you, and you knew that before you took the first step.",
  ],
  // 10 — The Apprentice
  [
    "Seven years, the whole of it. You will be making the person who takes your custom, and you know it.",
    "All of it but the one turn. They will feel that door long before they can name it.",
    "Hands first. They will have your habits before your reasons, including the ones you would not have chosen to pass on.",
    "You sent them away to find out. They may not come back, and you sent them anyway.",
  ],
  // 11 — The Fire
  [
    "Thirty years of edges ground to your hand, and only your hand.",
    "Sixty years of a trade, most of it not yours, carried out through the smoke.",
    "Four sacks of next year. Heavy, and slow, and you were still in the room.",
    "Through the wall. You will own nothing by morning, and you did not stop to work that out first.",
  ],
  // 12 — The Wall
  [
    "The mark, tested, the same for everyone. Some who would have been good in five years will be good somewhere else.",
    "You opened it to whoever needs it. The name is the only thing this town has, and you have put it in other hands.",
    "A hundred winters came through on that gate, and you have unmade it in a season.",
    "Not who — how. Someone will be kept out one day by a sentence you wrote tonight, and you wrote it anyway.",
  ],
];

export function convenerReaction(questionIndex: number, optionIndex: number): string {
  return CONVENER_REACTIONS[questionIndex]?.[optionIndex]
    ?? convenerAcknowledgement(questionIndex);
}

/**
 * The deliberation. A sorting that answers the instant you stop talking is a
 * form, not an oracle — the pause IS the ceremony, and it is the only place the
 * quiz can say "this was close" before it says anything at all.
 *
 * Three beats, in order: he looks, he admits the pull of more than one, he
 * decides. None may hint WHICH — he has not named a craft in twelve scenes and
 * he does not start here (L8).
 */
export const CONVENER_DELIBERATION: readonly string[] = [
  "Stand still a moment. Let me look at you properly.",
  "More than one of them has a claim on you. I can feel the pull of it.",
  "Yes. Yes, I have it.",
];

/** How long each deliberation beat holds before the next. */
export const CONVENER_DELIBERATION_BEAT_MS = 1_600;

/** Milliseconds of no input before he goes quiet. */
export const CONVENER_DOZE_AFTER_MS = 45_000;

/** Terminal poke index — reached, then held. */
export const CONVENER_FINAL_POKE_INDEX = CONVENER_POKES.length - 1;
