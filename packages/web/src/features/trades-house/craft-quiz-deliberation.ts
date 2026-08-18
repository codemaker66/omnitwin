// -----------------------------------------------------------------------------
// The Deliberation — one more thing, asked only when it was close.
//
// Measured on the shipped model (docs/trades-house/quiz-authoring/
// FORMAT-RESEARCH-2026-08-16.md): after twelve scenes the top two Crafts sit
// within 0.15 of each other for about a third of respondents, and no change to
// HOW people answer moves the recovery rate more than a few points. The one
// lever with headroom is a scene written FOR the pair in question, asked only
// when the pair is close: +4–6 points on the third of visitors it fires for.
// It is also the Sorting Hat's own best beat — "difficult… very difficult" —
// and Pottermore's hatstall let you choose your house; we ask instead.
//
// Twelve pairs cover ~60% of close finishes and get a bespoke scene. Every
// other pair is served by composing a scene from fourteen per-Craft world
// lines, so no visitor is ever left without a deliberation because their pair
// was rare. Neither form names a Craft.
//
// About 13% of respondents have no fact of the matter — two Crafts within a
// hair on their own temperament. For them the honest thing is not to pretend:
// `verdict()` reports a hung result and the reveal says so.
// -----------------------------------------------------------------------------

import {
  AXIS_KEYS,
  CRAFT_ORDER,
  ZERO_AXIS_TOTALS,
  craftAffinity,
  rankCrafts,
  type AxisKey,
  type AxisVector,
  type CraftId,
  type CraftQuizOption,
  type CraftQuizProgress,
  type CraftRankingEntry,
} from "./craft-quiz-model.js";

/** A pair the axes cannot separate on their own. Stored in CRAFT_ORDER order. */
export type CraftPair = readonly [CraftId, CraftId];

export interface DeliberationScene {
  readonly pair: CraftPair;
  /** The Convener speaks this. Second person, present tense, no Craft named. */
  readonly scene: string;
  /** Exactly two: one lives in each Craft's world. Both honourable. */
  readonly options: readonly [CraftQuizOption, CraftQuizOption];
}

export interface Deliberation extends DeliberationScene {
  /** True when a scene was written for this exact pair; false when composed. */
  readonly authored: boolean;
}

/**
 * Below this gap between the top two, the Convener asks one more thing. Swept
 * in the format research: 0.15 fires for ~32% of consistent respondents and
 * lifts recovery ~+4; 0.25 fires for over half, which stops feeling rare.
 */
export const DELIBERATION_THRESHOLD = 0.15;

/**
 * Below this gap AFTER the deliberation, the result is reported as hung: the
 * Chain chose, and it was not wrong about the other one either.
 */
export const HUNG_THRESHOLD = 0.04;

/**
 * The deciding answer weighs more than an ordinary one — it was asked because
 * it is the decisive question, and it should be able to decide.
 */
export const DELIBERATION_WEIGHT = 1.5;

/** Canonical order for a pair, so ["masons","weavers"] never also appears
 *  as ["weavers","masons"]. */
export function pairKey(a: CraftId, b: CraftId): CraftPair {
  return CRAFT_ORDER.indexOf(a) <= CRAFT_ORDER.indexOf(b) ? [a, b] : [b, a];
}

/** The material of a composed deliberation: one answer per Craft. */
export interface CraftWorldLine {
  readonly lead: string;
  readonly body: string;
  readonly cost: string;
  readonly ledger: string;
  readonly axes: AxisVector;
}

/**
 * ONE answer per Craft that puts the visitor inside that Craft's world at its
 * most itself. These compose the fallback deliberation for any pair without a
 * bespoke scene, so together they cover all fourteen. Guessable by a lay
 * reader; never naming the trade; the axes point at the Craft, so the two
 * channels agree. The tests hold coverage, agreement, register and legibility.
 */
/**
 * ONE answer per Craft that puts the visitor inside that Craft's world at its
 * most itself. These compose the fallback deliberation for any pair without a
 * bespoke scene, so together they cover all fourteen.
 *
 * Two audiences in one answer, on purpose: the BODY is the physical moment of
 * the work, guessable by a stranger who has never heard of the Incorporations
 * (the iron, the loom, the lime-pit); the COST carries the insider's history —
 * seventh in the line and no fuss; prison rather than sign; twice renamed and
 * the barley kept — which a member of forty years will recognise as theirs and
 * a newcomer will simply read as character. Never the trade's name. The axes
 * point at the Craft, so the two channels agree.
 */
export const CRAFT_WORLD_LINES: Readonly<Record<CraftId, CraftWorldLine>> = {
  hammermen: {
    lead: "The heat.",
    ledger: "In the end, the heat.",
    body: "You draw the iron from the fire and strike, and by the ring on the anvil you know before you look whether the work is true.",
    cost: "It burns. It burned the first day and it burns now, and your hand is still on it.",
    axes: { a1: 2, a2: 3, a3: 2, a4: 2, a5: 1 },
  },
  wrights: {
    lead: "The joint.",
    ledger: "In the end, the joint.",
    body: "You brush the shavings off the bench, push the two cut pieces home, and feel the wood take hold of itself: no nail, no gap.",
    cost: "Wood moves. What you make will be tested by every winter after you.",
    axes: { a1: 2, a2: 1, a3: 1, a5: 3 },
  },
  masons: {
    lead: "The stone.",
    ledger: "In the end, the stone.",
    body: "You lay the stone, tap it true, and cut your mark where the rain will never find it. The wall will stand when you are gone.",
    cost: "It is slow, and it does not forgive, and neither will the ones who come after.",
    axes: { a1: 3, a2: 1, a3: 1, a4: -2, a5: 1 },
  },
  coopers: {
    lead: "The hoop.",
    ledger: "In the end, the hoop.",
    body: "You drive the last hoop home, fill the cask to the brim, and stand in the steam and the shavings, listening for the drip that does not come.",
    cost: "You are trusted with what must not leak. Nobody thanks you for a barrel that held.",
    axes: { a1: 2, a2: 2, a3: 2, a4: -1, a5: -3 },
  },
  tailors: {
    lead: "The seam.",
    ledger: "In the end, the seam.",
    body: "You chalk where the shoulder ends, the shears go through the wool, and the cloth is one person's coat now and nobody else's.",
    cost: "You will unpick a day's work over a quarter-inch, and be right, and be alone in it.",
    axes: { a2: 3, a4: 1, a5: 1 },
  },
  weavers: {
    lead: "The thread.",
    ledger: "In the end, the thread.",
    body: "You throw the shuttle, beat the thread home, and hold the cloth to the light: one thread crossed wrong, and every hand that ever touches it will know.",
    cost: "You will pick up threads that other hands dropped, and let no one sit over you for long.",
    axes: { a1: 1, a2: 1, a3: 1, a4: -3 },
  },
  dyers: {
    lead: "The colour.",
    ledger: "In the end, the colour.",
    body: "You lift the wool from the vat of dye and it comes up green, and you stand in the steam and watch the air turn it blue.",
    cost: "You will wear the colour a year before the town will buy it, and you will tip the vat out and start again more than once.",
    axes: { a1: -2, a2: 1, a3: -1, a4: 3, a5: 2 },
  },
  skinners: {
    lead: "The hide.",
    ledger: "In the end, the hide.",
    body: "You haul the hide out of the lime-pit, scrape the hair from it over the beam, and wait the months it takes to come soft in your hands.",
    cost: "You will outlast people who talked more, and say nothing about being seventh in the line.",
    axes: { a1: 1, a2: 1, a3: -1, a4: -2, a5: -3 },
  },
  cordiners: {
    lead: "The road.",
    ledger: "In the end, the road.",
    body: "You draw the waxed thread through the sole, and the leather gives a little and then holds, and you know whose foot it is for.",
    cost: "A foot is a foot, whichever side it marches on. You have shod an army that was not yours, and crowned your own king rather than wait to be given one.",
    axes: { a1: 1, a2: -2, a3: 1, a4: -1, a5: -1 },
  },
  bakers: {
    lead: "The oven.",
    ledger: "In the end, the oven.",
    body: "The flour is on your arms before the town wakes, and you know by the knock on the crust which loaf will weigh true.",
    cost: "You have gone to prison rather than sign a paper about bread, and the man they fined was the one selling full loaves too cheap.",
    axes: { a1: -1, a2: -3, a3: -1, a5: 1 },
  },
  fleshers: {
    lead: "The block.",
    ledger: "In the end, the block.",
    body: "You bring the knife down once on the block, and the beast is meat, and the town eats tomorrow.",
    cost: "You have the stomach that lets the rest keep their hands clean. Some year the beast stops being anything to you, and you will not notice the year.",
    axes: { a2: -2, a4: 2 },
  },
  maltmen: {
    lead: "The cellar.",
    ledger: "In the end, the cellar.",
    body: "You turn the wet barley on the barn floor with a wooden shovel till it sprouts, then light the kiln and let the peat-smoke make it sweet.",
    cost: "Twice they said you were no trade at all; you gave your head man another title, kept the box locked, and kept the barley. You would walk any brother's coffin to the wynd-head; a stranger's you would not cross the road for.",
    axes: { a1: -1, a2: -2, a3: -3, a4: -1, a5: -1 },
  },
  gardeners: {
    lead: "The seed.",
    ledger: "In the end, the seed.",
    body: "You turn the muck under when the leaves come down, knowing it will not be earth till spring, and you keep the seed for it anyway.",
    cost: "You will not stand under the tree you set. The moon on your shield is waxing, and you are slow to cut what might yet grow.",
    axes: { a1: -3, a3: 1, a4: -2, a5: -1 },
  },
  barbers: {
    lead: "The blade.",
    ledger: "In the end, the blade.",
    body: "The water is hot, the strop is warm, and the man in the chair bares his throat to you and goes on talking.",
    cost: "You hear what a man says with a blade at his throat, and some of it you will wish you had not.",
    axes: { a1: -2, a2: 1, a3: -2, a4: -1, a5: -1 },
  },
};

/**
 * What he says the moment the twelfth answer leaves it hanging — spoken as
 * the aside after that answer's reply, before any deliberation scene, authored
 * or composed. The reader learns it is close, and why he asks, from him; not
 * from a kicker.
 */
export const DELIBERATION_PREAMBLE =
  "It hangs between two, and I will not guess at you. One thing more, then, and I will hold to what you say.";

/** How the composed deliberation is framed. Spoken by the Convener. */
export const DELIBERATION_FRAME =
  "I have been wrong before, and it cost years. So tell me plainly: which of these is more yours?";

/**
 * What he says once you have answered the deliberation. Spoken; then the
 * weighing, where he looks and says he has it — so this only confirms he has
 * what he asked for, and does not announce the verdict twice.
 */
export const DELIBERATION_REPLY = "Then I have what I needed.";

/**
 * Bespoke scenes for the pairs that finish close most often — twelve, covering
 * about six in ten close finishes (measured: docs/trades-house/quiz-authoring/
 * FORMAT-RESEARCH-2026-08-16.md). Each is one last thing from the year, set in
 * the same town, with two answers: one lives in each Craft's world, both are
 * honourable, and neither Craft is named. Written from the dossiers' sharpest
 * distinctions — what a barber's heart and a maltman's heart do with a wrong;
 * whether a smith trusts the ring of the iron or a tailor the rule of the shut
 * room. Lookup is by canonical pair; order here does not matter.
 */
export const CRAFT_DELIBERATIONS: readonly DeliberationScene[] = [
  {
    pair: ["maltmen", "barbers"],
    scene:
      "A rider comes over the hill with a magistrate's plea: a town three days off is "
      + "starving, and your fellowship's chest is full. The clerk says every coin in it "
      + "was gathered for your own widows, and that one voice against could undo any "
      + "gift in court. The room is looking at you.",
    options: [
      {
        lead: "Say it, now.", world: "barbers", ledger: "In the end, said it aloud.",
        body: "Stand and say the money goes over the hill, in front of everyone, and keep saying it until it is written in the book. You have said worse to a man with your blade at his throat.",
        cost: "You will have argued a room into giving away what it was saving, and some of them will not forgive it.",
        axes: { a1: -2, a2: 1, a3: -2, a5: -1 },
      },
      {
        lead: "Keep the chest.", world: "maltmen", ledger: "In the end, kept the chest, and sent the malt.",
        body: "The widows are yours; the far town is not. Say nothing in the room, and afterward send the far town a wagon of your own malt by the same rider, and let no one know it went.",
        cost: "The far town will never learn your name. Neither will your own.",
        axes: { a1: -1, a2: -2, a3: -3, a4: -1, a5: -1 },
      },
    ],
  },
  {
    pair: ["hammermen", "wrights"],
    scene:
      "The town gate must hang by dark. The bolt you forged rings true; you struck "
      + "it and listened, and it will not fail. But it sits a finger's breadth proud "
      + "of the frame that must take it. The two men in the yard are arguing about it "
      + "in front of everyone.",
    options: [
      {
        lead: "The frame comes to the bolt.", world: "hammermen", ledger: "In the end, the frame came to the bolt.",
        body: "You heard the iron ring; you know what it does. Cut the frame to take it, and hang the gate tonight.",
        cost: "You have made the whole yard bend to one man's ear, and it was yours.",
        axes: { a1: 2, a2: 3, a3: 2, a4: 2, a5: 1 },
      },
      {
        lead: "Both, till neither sits proud.", world: "wrights", ledger: "In the end, the joint.",
        body: "Lay the bolt against the frame and the frame against the bolt, and work both until neither sits proud, whoever forged what. The gate is not the bolt or the timber. It is the joint.",
        cost: "Another day, and the town without a gate for it, and nobody's name on the work.",
        axes: { a1: 2, a2: 1, a3: 1, a5: 3 },
      },
    ],
  },
  {
    pair: ["masons", "weavers"],
    scene:
      "You have one good season left in your hands, and everyone in the town knows "
      + "it. There is a gate-lintel to cut that will carry your mark as long as the "
      + "wall stands. There is a slow apprentice at the bench who has nearly got it. "
      + "You cannot do both before the frost.",
    options: [
      {
        lead: "The lintel.", world: "masons", ledger: "In the end, the lintel.",
        body: "Cut it, and cut your mark where the rain will never find it. The apprentice will learn it or not. The stone will be standing when both of you are gone.",
        cost: "The one who nearly had it will finish learning from someone worse, or not at all.",
        axes: { a1: 3, a2: 1, a3: 1, a4: -2, a5: 1 },
      },
      {
        lead: "The apprentice.", world: "weavers", ledger: "In the end, the apprentice.",
        body: "Give up the last turn you have kept back, and stand at the loom beside them until their hands have it. Let the lintel wait a year and bear their mark, or none. You were shown it once, by someone who did not have to.",
        cost: "There will be nothing in this town with your name cut into it. Only people who do it right.",
        axes: { a1: 1, a2: 1, a3: 1, a4: -3 },
      },
    ],
  },
  {
    pair: ["coopers", "skinners"],
    scene:
      "A packman stands outside the gate with a load the town could use and no "
      + "toll-penny in his pouch, while the townsmen who paid theirs stand watching. "
      + "The gatekeeper looks at you, since you sit on the body now.",
    options: [
      {
        lead: "Measure it first.", world: "coopers", ledger: "In the end, measured it first.",
        body: "Lay the town's measure against every vessel he carries, there at the gate, and admit only what holds and is full. Toll or no toll, a thing that leaks does not come in.",
        cost: "He will stand in the road an hour while you test his life's stock in front of the town.",
        axes: { a1: 2, a2: 2, a3: 2, a4: -1, a5: -3 },
      },
      {
        lead: "Pay his penny.", world: "skinners", ledger: "In the end, paid his penny.",
        body: "Out of your own pouch, and say nothing, and let him spread his wares beside the others. You have made good leather out of what came to you stinking.",
        cost: "The townsmen who paid will remember that you did not make him. So will he.",
        axes: { a1: 1, a2: 1, a3: -1, a4: -2, a5: -3 },
      },
    ],
  },
  {
    pair: ["bakers", "fleshers"],
    scene:
      "The council nails a new rule to the market cross saying what counts as "
      + "sufficient goods from your hands, in words written by men who never made "
      + "them. The rule is fair enough. Lately your goods have not been. The provost "
      + "is holding out the pen.",
    options: [
      {
        lead: "Do not sign.", world: "bakers", ledger: "In the end, did not sign.",
        body: "The town may tell you what an honest loaf weighs. It may not tell you what a loaf is. Go to the cell tonight rather than let it, and bake tomorrow on the same terms as always.",
        cost: "Your stall stands empty in the morning, and the town goes hungry over a paper it never read.",
        axes: { a1: -1, a2: -3, a3: -1, a5: 1 },
      },
      {
        lead: "Sign it, and take them to law.", world: "fleshers", ledger: "In the end, signed, and went to law.",
        body: "Keep the stall open and the block clean, take the rule to law and beat them on the law, and throw not one stone while it runs. The town eats either way.",
        cost: "You will win in a year, and nobody will make a song about it.",
        axes: { a2: -2, a4: 2 },
      },
    ],
  },
  {
    pair: ["hammermen", "tailors"],
    scene:
      "A stranger's proving-piece lies on the table before you and the other judges. "
      + "It is faultless, and it will outlast everyone in this room. It was made in his "
      + "own lodging with the door open, not in the shut room under oath that the rule "
      + "requires. A rival has already said so.",
    options: [
      {
        lead: "Pass it.", world: "hammermen", ledger: "In the end, passed the piece.",
        body: "Strike it, turn it, work it. The iron rings true; it needs no witness and no locked door. The mark is for the work, and the work is here.",
        cost: "You have told the room the iron outranks the rule, and one day the iron on the table will not be yours.",
        axes: { a1: 2, a2: 3, a3: 2, a4: 2, a5: 1 },
      },
      {
        lead: "Send him back.", world: "tailors", ledger: "In the end, sent him back.",
        body: "Make it again in the shut room, alone, under oath, and then pass. The finest thing you have handled in years, and it goes back. The rule holds, or it is a ribbon on the door.",
        cost: "You will have sent the best hands you have seen away for a month over a door.",
        axes: { a2: 3, a4: 1, a5: 1 },
      },
    ],
  },
  {
    pair: ["masons", "coopers"],
    scene:
      "A merchant's wine is spoiling on the quay because the vault under the new "
      + "hall is not finished. You can close it tonight in rough stone nobody will ever "
      + "see, so the casks are safe and full by morning. Or in a month, in dressed "
      + "stone that bears your mark and stands three hundred years.",
    options: [
      {
        lead: "Tonight, in the rough.", world: "coopers", ledger: "In the end, closed it tonight, in the rough.",
        body: "Nobody will see the wall. Everybody will drink the wine. Close it so it holds, and let it hold, and let your name go nowhere.",
        cost: "Somewhere under the hall there is a month's craft you did not give, and only you will know it is there.",
        axes: { a1: 2, a2: 2, a3: 2, a4: -1, a5: -3 },
      },
      {
        lead: "In a month, in the dressed.", world: "masons", ledger: "In the end, the dressed stone.",
        body: "The wine is one merchant's; the vault is the town's, and it will be standing when he is a name on a stone. Cut it right, cut your mark, and answer for the wine.",
        cost: "A season's wine soured, and a merchant who will tell it for years.",
        axes: { a1: 3, a2: 1, a3: 1, a4: -2, a5: 1 },
      },
    ],
  },
  {
    pair: ["dyers", "fleshers"],
    scene:
      "The whole hall is on its feet to vote the widows' box toward soldiers, because "
      + "an enemy is said to be marching on the town. The chair is looking down the "
      + "benches for anyone who is not standing.",
    options: [
      {
        lead: "Stay sitting.", world: "dyers", ledger: "In the end, stayed sitting.",
        body: "Alone, if you have to. Say the money is the widows' and cannot be touched, and offer your own purse in its place, and let them look. You have tipped out a whole vat before rather than sell it under the wrong name.",
        cost: "The room will remember who would not stand when the town was afraid.",
        axes: { a1: -2, a2: 1, a3: -1, a4: 3, a5: 2 },
      },
      {
        lead: "Stand, and pay in.", world: "fleshers", ledger: "In the end, stood, and opened the stall.",
        body: "Stand, and then go and open your stall at the ordinary hour with the scale honest and the block clean, because whoever is marching, the town eats tomorrow.",
        cost: "The widows' box is lighter by your vote, and you were not the one who missed it.",
        axes: { a2: -2, a4: 2 },
      },
    ],
  },
  {
    pair: ["maltmen", "bakers"],
    scene:
      "A brother is buried at noon, which is the hour your batch must go in if the "
      + "town is to eat tonight. The fellowship walks every coffin to the head of the "
      + "wynd, all of them, bareheaded, and fines the ones who do not.",
    options: [
      {
        lead: "Fire the oven.", world: "bakers", ledger: "In the end, fired the oven.",
        body: "Send the journeyman with your hat, feed the town, and pay the fine for absence without arguing it. The dead man ate your bread thirty years. He would have told you to go.",
        cost: "You will be the one who was not there, and that is a thing this town counts.",
        axes: { a1: -1, a2: -3, a3: -1, a5: 1 },
      },
      {
        lead: "Walk the coffin.", world: "maltmen", ledger: "In the end, walked the coffin.",
        body: "Rake the fire out and walk with every brother to the head of the wynd, bareheaded, and let the town eat late. That was the oath: your feet on the wynd. The barley keeps.",
        cost: "Somewhere tonight a family sits at a cold table because of a man they never met.",
        axes: { a1: -1, a2: -2, a3: -3, a4: -1, a5: -1 },
      },
    ],
  },
  {
    pair: ["wrights", "masons"],
    scene:
      "The kirk roof must be closed by Martinmas. There is green timber that can be "
      + "joined so tight it will serve a lifetime, and be dry by the feast. There is "
      + "oak that will be seasoned two winters hence, and carry the roof three hundred "
      + "years. The session asks which you back.",
    options: [
      {
        lead: "The green, joined tight.", world: "wrights", ledger: "In the end, the green timber, joined tight.",
        body: "Cut it housed and pegged so the wood takes hold of itself, and have them under it by Martinmas. Fit it, finish it, and let the winters test it.",
        cost: "In sixty years someone will take it down and say the man who put it up was in a hurry.",
        axes: { a1: 2, a2: 1, a3: 1, a5: 3 },
      },
      {
        lead: "The oak, in two winters.", world: "masons", ledger: "In the end, the oak, in two winters.",
        body: "Let them sit under sailcloth two winters and have the roof that outlasts them. You build for people you will never meet, and the stone under it has taught you how long a thing takes.",
        cost: "Two winters of cold worship, and a session that will not thank you until it is dead.",
        axes: { a1: 3, a2: 1, a3: 1, a4: -2, a5: 1 },
      },
    ],
  },
  {
    pair: ["weavers", "skinners"],
    scene:
      "The town's roll is cried in the square at midsummer. Your fellowship, the "
      + "oldest chartered house inside these walls, is called seventh again and shown "
      + "to the smaller pew, while the four great houses take the front. Everyone "
      + "knows the order is wrong. Everyone always has.",
    options: [
      {
        lead: "Draft the petition.", world: "weavers", ledger: "In the end, drafted the petition.",
        body: "Gather the lesser houses tonight and put it to the court, in the open, with your name at the top: equal seats, or the reason why not, written down. A hundred years the looms have sat seventh, and nobody has asked why.",
        cost: "Six years in the courts, and the great houses will not forget whose name was at the top.",
        axes: { a1: 1, a2: 1, a3: 1, a4: -3 },
      },
      {
        lead: "Take the seventh pew.", world: "skinners", ledger: "In the end, took the seventh pew.",
        body: "And carry the candles and the box, as your house has since before there was a hall, and say nothing about the pew. The charter is the oldest in the town. It does not need a front pew to be so.",
        cost: "You will outlast every one of them, and nobody will notice you doing it.",
        axes: { a1: 1, a2: 1, a3: -1, a4: -2, a5: -3 },
      },
    ],
  },
  {
    pair: ["tailors", "coopers"],
    scene:
      "The council means to fix by statute the one measure every maker in the town "
      + "must meet. It would end your fellowship's right to set its own standard each "
      + "year by its own masters. The number they propose is a fair one. Nobody in "
      + "the trade chose it.",
    options: [
      {
        lead: "Take the number.", world: "coopers", ledger: "In the end, took the number.",
        body: "One measure, the same for everyone, tested at the gate, so that a cask from any hand holds what it says. Who chose it matters less than that it holds.",
        cost: "The trade has given away the right to be judged by people who know the work.",
        axes: { a1: 2, a2: 2, a3: 2, a4: -1, a5: -3 },
      },
      {
        lead: "Keep the standard in the craft.", world: "tailors", ledger: "In the end, kept the standard in the craft.",
        body: "Fight it. The measure must move with the year and the cloth and the body it is cut for. It must be set by masters who proved themselves alone in a shut room, or it is a number on a paper.",
        cost: "You will win the right to be hard, and be blamed for every year it changes.",
        axes: { a2: 3, a4: 1, a5: 1 },
      },
    ],
  },
];

const authoredByKey = new Map<string, DeliberationScene>(
  CRAFT_DELIBERATIONS.map((scene) => [pairKey(scene.pair[0], scene.pair[1]).join("/"), scene]),
);

function composeDeliberation(pair: CraftPair): DeliberationScene {
  const toOption = (craftId: CraftId): CraftQuizOption => ({ ...CRAFT_WORLD_LINES[craftId], world: craftId });
  return { pair, scene: DELIBERATION_FRAME, options: [toOption(pair[0]), toOption(pair[1])] };
}

/**
 * Whether the Convener should ask one more thing, and what. Null when the
 * verdict is already clear — which is the common case, and the point: a
 * deliberation that fires every time is not a deliberation.
 */
export function deliberate(progress: CraftQuizProgress): Deliberation | null {
  const [first, second] = rankCrafts(progress);
  if (first === undefined || second === undefined) return null;
  if (first.score - second.score >= DELIBERATION_THRESHOLD) return null;
  const pair = pairKey(first.craftId, second.craftId);
  const authored = authoredByKey.get(pair.join("/"));
  if (authored !== undefined) return { ...authored, authored: true };
  return { ...composeDeliberation(pair), authored: false };
}

/**
 * Applies the deciding answer at DELIBERATION_WEIGHT. Kept separate from
 * applyCraftQuizAnswer so an ordinary answer can never be over-weighted by
 * accident, and so the world tally moves by the same weight as the axes.
 */
export function applyDeliberation(
  progress: CraftQuizProgress,
  deliberation: Deliberation,
  optionIndex: 0 | 1,
): CraftQuizProgress {
  const option = deliberation.options[optionIndex];
  const totals: Record<AxisKey, number> = { ...progress.totals };
  for (const key of AXIS_KEYS) {
    totals[key] += DELIBERATION_WEIGHT * (option.axes[key] ?? 0);
  }
  const world: Record<CraftId, number> = { ...progress.world };
  world[option.world] += DELIBERATION_WEIGHT;
  return { totals, lastAxes: { ...option.axes }, world };
}

export interface Verdict {
  readonly ranking: readonly CraftRankingEntry[];
  /** The top two are still within HUNG_THRESHOLD: the Chain chose, and it was
   *  not wrong about the other one either. */
  readonly hung: boolean;
}

export function verdict(progress: CraftQuizProgress): Verdict {
  const ranking = rankCrafts(progress);
  const [first, second] = ranking;
  const hung = first !== undefined && second !== undefined && first.score - second.score < HUNG_THRESHOLD;
  return { ranking, hung };
}

/** A world line must point at its own Craft, or a composed deliberation would
 *  contradict itself. Used by the tests. */
export function worldLineAgreement(craftId: CraftId): number {
  const line = CRAFT_WORLD_LINES[craftId];
  const totals: Record<AxisKey, number> = { ...ZERO_AXIS_TOTALS };
  for (const key of AXIS_KEYS) totals[key] = line.axes[key] ?? 0;
  return craftAffinity(totals, craftId);
}
