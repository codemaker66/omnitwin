export const CRAFT_ORDER = [
  "hammermen",
  "wrights",
  "masons",
  "coopers",
  "tailors",
  "weavers",
  "dyers",
  "skinners",
  "cordiners",
  "bakers",
  "fleshers",
  "maltmen",
  "gardeners",
  "barbers",
] as const;

export type CraftId = (typeof CRAFT_ORDER)[number];

export interface CraftProfile {
  readonly name: string;
  readonly crest: string;
  readonly essence: string;
  readonly archetype: string;
  readonly omen: string;
  readonly motto: string;
  readonly reveal: string;
}

// ---------------------------------------------------------------------------
// The five value axes.
//
// Options push a respondent along these axes; each Craft is a fixed direction
// in the same space; the winner is the nearest direction by cosine similarity.
// No option maps to a Craft directly — that indirection is the anti-gaming
// core. You cannot pick "the Masons answer", because no answer is one.
// Model and tuning: docs/trades-house/craft-research/16-sorting-mechanics.md.
// ---------------------------------------------------------------------------

export const AXIS_KEYS = ["a1", "a2", "a3", "a4", "a5"] as const;
export type AxisKey = (typeof AXIS_KEYS)[number];

/** A sparse push along one or more axes — an option's entire scoring payload. */
export type AxisVector = Readonly<Partial<Record<AxisKey, number>>>;
/** A dense position in axis space — a running total, or a Craft's direction. */
export type AxisTotals = Readonly<Record<AxisKey, number>>;

export const ZERO_AXIS_TOTALS: AxisTotals = { a1: 0, a2: 0, a3: 0, a4: 0, a5: 0 };

/**
 * Where each Incorporation stands.
 *
 *   a1  Lasting <-> Living      a2  Perfection <-> Provision
 *   a3  Bench <-> Hearth        a4  Bold <-> Steady
 *   a5  Make <-> Keep
 *
 * v0.3 — the dossier-16 seed profiles with synthesis Part 2.3 amendments
 * (Gardeners and Maltmen a5 -> -1: both are keepers, not makers). Every number
 * here is load-bearing: changing one moves a Craft in the space and can make
 * it unreachable. craft-quiz-reachability.test.ts is the gate that proves it
 * did not.
 */
export const CRAFT_AXIS_PROFILES = {
  hammermen: { a1: 2, a2: 3, a3: 2, a4: 2, a5: 1 },
  wrights: { a1: 2, a2: 1, a3: 1, a4: 0, a5: 3 },
  masons: { a1: 3, a2: 1, a3: 1, a4: -2, a5: 1 },
  coopers: { a1: 2, a2: 2, a3: 2, a4: -1, a5: -3 },
  tailors: { a1: 0, a2: 3, a3: 0, a4: 1, a5: 1 },
  weavers: { a1: 1, a2: 1, a3: 1, a4: -3, a5: 0 },
  dyers: { a1: -2, a2: 1, a3: -1, a4: 3, a5: 2 },
  skinners: { a1: 1, a2: 1, a3: -1, a4: -2, a5: -3 },
  cordiners: { a1: 1, a2: -2, a3: 1, a4: -1, a5: -1 },
  bakers: { a1: -1, a2: -3, a3: -1, a4: 0, a5: 1 },
  fleshers: { a1: 0, a2: -2, a3: 0, a4: 2, a5: 0 },
  maltmen: { a1: -1, a2: -2, a3: -3, a4: -1, a5: -1 },
  gardeners: { a1: -3, a2: 0, a3: 1, a4: -2, a5: -1 },
  barbers: { a1: -2, a2: 1, a3: -2, a4: -1, a5: -1 },
} as const satisfies Readonly<Record<CraftId, AxisTotals>>;

export interface CraftQuizOption {
  /** The decisive phrase, shown bold — "The iron." */
  readonly lead: string;
  /** The case a serious person would make for it. */
  readonly body: string;
  /** What it costs, named plainly. Every option pays something (law L5). */
  readonly cost: string;
  /**
   * One line for the ledger of your year — "Came in with iron." Past tense,
   * first person understood, in the narrator's register. Twelve of these are
   * the shareable artefact at the end: every path through the town is unique.
   */
  readonly ledger: string;
  /**
   * HOW the answer is tempered — the five hidden axes. Direction, not degree.
   */
  readonly axes: AxisVector;
  /**
   * WHAT the answer is about: the one Craft whose material and moral world it
   * lives in — iron and rust, willow slips and seed-corn, the loaf weighed in
   * front of the buyer, the razor at the throat. It is what the words say, so a
   * reader who knows nothing of the Incorporations but can make the obvious
   * guess (nature is the gardeners; metal is the smiths) is honoured, and it
   * tells apart Crafts the axes cannot — Masons and Weavers point within 0.79
   * of each other. The Craft's world may be shown; its NAME never appears.
   */
  readonly world: CraftId;
}

export interface CraftQuizQuestion {
  /** Authoring name. Never rendered — it would telegraph the scene. */
  readonly title: string;
  /** The scene, in the narrator's voice. The Convener speaks this aloud. */
  readonly scene: string;
  readonly options: readonly CraftQuizOption[];
}

/** How many chosen answers lived in each Craft's world. */
export type WorldTally = Readonly<Record<CraftId, number>>;

/**
 * Everything the sorting needs to know about a respondent so far. One value,
 * not three parallel ones: it moves through the page as a unit and cannot be
 * half-updated.
 */
export interface CraftQuizProgress {
  readonly totals: AxisTotals;
  /** The last answer's axes — the sorting-hat instinct that the last thing you said carries the most of you. */
  readonly lastAxes: AxisVector;
  readonly world: WorldTally;
}

export const ZERO_WORLD_TALLY: WorldTally = Object.freeze(
  Object.fromEntries(CRAFT_ORDER.map((craftId) => [craftId, 0])) as Record<CraftId, number>,
);

export const ZERO_CRAFT_QUIZ_PROGRESS: CraftQuizProgress = Object.freeze({
  totals: ZERO_AXIS_TOTALS,
  lastAxes: {},
  world: ZERO_WORLD_TALLY,
});

/**
 * Weight of the world channel against the temperament channel. Chosen from
 * data, not taste: check-geometry-r4.mjs sweeps it. Below ~0.5 the crowded
 * pairs still cannot be told apart; above ~0.9 the floor stops rising and the
 * temperament channel starts losing its say. Nine tenths of a full-world sweep
 * is worth about as much as the strongest temperament signal a respondent can
 * produce, so a reader who consistently chose the iron IS a smith, and a reader
 * whose worlds were scattered is sorted by how they were tempered.
 */
export const WORLD_WEIGHT = 0.9;

export interface CraftRankingEntry {
  readonly craftId: CraftId;
  readonly score: number;
  readonly lastAnswerWeight: number;
  readonly profile: CraftProfile;
}

const MEDIA_ROOT = "/trades-house-media/assets";

export const CRAFT_PROFILES = {
  hammermen: {
    name: "THE HAMMERMEN",
    crest: `${MEDIA_ROOT}/crests/hammermen.png`,
    essence:
      "Strength of hand, integrity of work. Workers of iron and silver — the smiths, engineers and makers whose hammers built the city’s strength.",
    archetype: "The Forge-Mind",
    omen: "ringing metal",
    motto: "MAKE IT WORK. MAKE IT WORTHY. MAKE IT LAST.",
    reveal:
      "You go at the thing nobody else will touch, and you cannot leave it while it is still wrong. Their searchers smashed bad work on the Saturday and paid a widow’s rent out of the Gill Stoup on the Sunday, and saw no contradiction in it. Neither do you. Mind the pressure, though: not everything yields to it, and some people are not problems to be solved.",
  },
  wrights: {
    name: "THE WRIGHTS",
    crest: `${MEDIA_ROOT}/crests/wrights.png`,
    essence:
      "Masters of wood — carpenters and joiners who raised Glasgow’s roofs, ships and stages.",
    archetype: "The Shaper",
    omen: "fresh wood shavings",
    motto: "GIVE GOOD IDEAS A BODY.",
    reveal:
      "You join things. Timber, plans, folk who had stopped speaking to each other. Their word for a man who never made his essay was pendicle, and they meant it as the worst thing you could call somebody, because proof was not paperwork to them but the whole of a man’s standing. You will finish what you started or it will nag at you for years.",
  },
  masons: {
    name: "THE MASONS",
    crest: `${MEDIA_ROOT}/crests/masons.png`,
    essence:
      "Workers of stone — patient builders of the grand and lasting fabric of Glasgow.",
    archetype: "The Foundation-Builder",
    omen: "hewn stone",
    motto: "BUILD FOR THOSE NOT YET HERE.",
    reveal:
      "You build for people you will never meet. When the town said his arch would fall, Mungo Naismith slept the night under it, because argument is cheap and a night is not. That is your instinct exactly. The risk is mistaking permanence for rightness, and refusing to shift a thing that ought to shift.",
  },
  coopers: {
    name: "THE COOPERS",
    crest: `${MEDIA_ROOT}/crests/coopers.png`,
    essence:
      "Benders of oak and binders of barrels — exact, honest work that holds good things safe.",
    archetype: "The Holder of Pressure",
    omen: "sealed oak",
    motto: "HOLD FAST. LET NOTHING PRECIOUS LEAK AWAY.",
    reveal:
      "You are the one trusted with what must not leak. A barrel is thirty separate staves that hold only because they are bound, and the whole trade came down to one merciless question every Saturday morning: does it hold? You ask it of yourself first. Slacken the hoop now and then. Not everything precious wants gripping.",
  },
  tailors: {
    name: "THE TAILORS",
    crest: `${MEDIA_ROOT}/crests/tailors.png`,
    essence:
      "Cutters of cloth — dressing the city with precision, style and a perfect fit.",
    archetype: "The Fitter of Forms",
    omen: "fine stitches",
    motto: "NOTHING CARELESS. NOTHING ILL-FITTING.",
    reveal:
      "You see the crooked seam before anybody says a word. They kept a locked room where a man proved himself alone, and in 1724 they unseated their own Deacon over eleven unpaid pennies, because a rule that bends for the powerful is decoration. Fit is your religion. Some things have to breathe before they are finished.",
  },
  weavers: {
    name: "THE WEAVERS",
    crest: `${MEDIA_ROOT}/crests/weavers.png`,
    essence:
      "Keepers of the loom — pattern, patience and thread woven into Glasgow’s story.",
    archetype: "The Pattern-Keeper",
    omen: "threads drawn tight",
    motto: "FIND THE PATTERN. STRENGTHEN THE WHOLE.",
    reveal:
      "You notice how the threads run. Their deacons served one year only, written down as being for the avoiding of all superioritie and tyrannie, and in 1615 they ruled that a master who withheld his knowledge from an apprentice had committed theft. That is your politics, whether or not you have ever said it aloud. You will carry loose ends that were never yours to carry.",
  },
  dyers: {
    name: "THE BONNETMAKERS & DYERS",
    crest: `${MEDIA_ROOT}/crests/dyers.png`,
    essence:
      "Bringers of colour and finish — flair, craft and the crowning touch.",
    archetype: "The Colour-Bringer",
    omen: "bold dye",
    motto: "SHOW THE TRUE COLOUR.",
    reveal:
      "You make the thing by which people are known. They knitted the blue bonnet out of waste wool until it was the badge of a whole country, then took in the dyers for one reason: a colour that fades is a small public lie. You would rather be true than fashionable. You would also rather change than die, and this craft has done exactly that twice.",
  },
  skinners: {
    name: "THE SKINNERS & GLOVERS",
    crest: `${MEDIA_ROOT}/crests/skinners.png`,
    essence:
      "Workers of leather — supple, careful craft shaped exactly to the hand.",
    archetype: "The Keeper of Trust",
    omen: "old polished leather",
    motto: "GUARD WHAT HAS BEEN ENTRUSTED.",
    reveal:
      "You take what the world discards and make it worth keeping. Their founding charter has the two trades agreeing to unyte ourself in cherite togidder, and they hold the oldest charter of the fourteen while standing seventh in the line, and have never once made a fuss about it. You will outlast a good many people who talked more.",
  },
  cordiners: {
    name: "THE CORDINERS",
    crest: `${MEDIA_ROOT}/crests/cordiners.png`,
    essence:
      "The shoemakers — carrying every step of the city, skill passed hand to hand.",
    archetype: "The Road-Protector",
    omen: "road-dust",
    motto: "NO ONE GOES UNPREPARED.",
    reveal:
      "A shoemaker’s son is a Prince born. That was theirs, and they meant it: they crowned their own King Crispin and paraded him through Glasgow while actual kings went about looking shabby. The same craft made six thousand pairs of shoes for an army that was not theirs, because feet are feet. Careful the crown does not become the point of it.",
  },
  bakers: {
    name: "THE BAKERS",
    crest: `${MEDIA_ROOT}/crests/bakers.png`,
    essence: "Keepers of the oven — bread, generosity and the staff of daily life.",
    archetype: "The Sustainer",
    omen: "warm bread",
    motto: "NO ONE IS USEFUL HUNGRY.",
    reveal:
      "The town must eat, today, at an honest weight. They went to prison rather than sign on the magistrates’ terms, and once fed an army the night before the battle that settled a kingdom. You feed people and you make no performance of it. Watch the shadow: the baker they punished was the one selling full loaves too cheaply.",
  },
  fleshers: {
    name: "THE FLESHERS",
    crest: `${MEDIA_ROOT}/crests/fleshers.png`,
    essence:
      "The market’s honest trade — providers of the table since the city’s first mornings.",
    archetype: "The Plain Dealer",
    omen: "market bells",
    motto: "FACE THE NEED. SERVE IT WELL.",
    reveal:
      "You have the strong stomach that lets everybody else keep clean hands. Their signature fraud had a name of its own, the blawing of muttoun, and the man who could spot it was the same man who could have done it. They beat the magistrates in court in 1802 and never once rioted. Keep a calm sough. Just do not let steady harden into unmoved.",
  },
  maltmen: {
    name: "THE MALTMEN",
    crest: `${MEDIA_ROOT}/crests/maltmen.png`,
    essence:
      "Turners of grain into good cheer — brewers, distillers and raisers of the toast.",
    archetype: "The Fermenter",
    omen: "warm grain",
    motto: "LET TIME DO ITS NOBLE WORK.",
    reveal:
      "You are patient with what cannot be hurried. Twice Parliament declared them no craft at all; twice they quietly renamed their chief and bought their liberty back, and four and a half centuries on they are still led by a Visitor rather than a Deacon. There is a wall around your care, though, and it is worth asking now and then who is standing outside it.",
  },
  gardeners: {
    name: "THE GARDENERS",
    crest: `${MEDIA_ROOT}/crests/gardeners.png`,
    essence:
      "Growers of green places — orchards, herbs and living things tended with care.",
    archetype: "The Cultivator",
    omen: "rain on leaves",
    motto: "LET GLASGOW — AND ITS PEOPLE — FLOURISH.",
    reveal:
      "Yours is the only craft whose arms show the moment everything went wrong, Adam and Eve and the serpent and the tree, and they read that not as a curse but as a claim: the one trade practised before the Fall. The moon on their shield is waxing. You plant for eyes that will not be yours. Not everything wants tending; some of it wants pruning.",
  },
  barbers: {
    name: "THE BARBERS",
    crest: `${MEDIA_ROOT}/crests/barbers.png`,
    essence:
      "The city’s groomers and healers of old — care, renewal and a steady hand.",
    archetype: "The Restorer",
    omen: "a steady breath",
    motto: "A STEADY HAND RESTORES MORE THAN THE SURFACE.",
    reveal:
      "Every morning half a city bared its throat to a man holding a razor, and then talked. That is what you are for. Locked out of their own hall, they went to the kirk and took the minutes anyway and won by sheer patience; they booked Black journeymen in 1741, women in 1791, and petitioned against the slave trade in 1792. You are trusted with what people say when they relax, which is also the danger.",
  },
} as const satisfies Readonly<Record<CraftId, CraftProfile>>;

/**
 * The twelve scenes.
 *
 * ONE story, not twelve dilemmas. A stranger arrives at a nameless walled town
 * by the water gate and, a year later, is asked to sit on the body that decides
 * who else may come in. The three acts are Jung's individuation — Persona
 * (1-4), Shadow (5-8), Self (9-12) — and that arc is part of the sorting
 * instrument rather than decoration on it: a3 Bench/Hearth IS Jung's
 * introversion/extraversion, a1 is Senex/Puer, a4 Hero/Guardian, a5
 * Prometheus/Hestia.
 *
 * Each scene is one myth or study made ours, never quoted: Baucis and Philemon
 * inverted, the bystander studies, Chesterton's Fence, Earthsea's naming, Cain
 * and Abel, the Ring of Gyges, Stone Soup, Bluebeard. Act III is bookended by
 * Le Guin's own — Omelas as a mill leat, the wall of Anarres as the gate you are
 * now asked to keep.
 *
 * Rules that still bind, inherited from the superseded brief: one threshold per
 * scene; second person, present tense; four options differing in KIND of good
 * rather than degree; every option carries a named cost; NO craft nouns
 * anywhere (an anvil would telegraph the Hammermen); no verdicts.
 *
 * Design brief: docs/superpowers/specs/2026-08-07-craft-quiz-le-guin-rewrite-design.md
 * Draft and gate: docs/trades-house/quiz-authoring/R3-LEGUIN-DRAFT.mjs
 *
 * The axis vectors are the canonical set proven by that gate. Copy may be
 * edited freely; vectors may not be edited without re-running it.
 */
export const CRAFT_QUESTIONS = [
  {
    title: "The River Gate",
    scene:
      "The town has a wall on three sides and a river on the fourth. You came in by the water gate, which is the one they do not watch, because nobody has ever arrived by river meaning harm. Not yet. The gatekeeper asks what is in your bag. It is a fair question. You have carried it four hundred miles.",
    options: [
      {
        lead: "The iron.",
        body: "Files, punches, a pair of tongs, wrapped in oiled cloth and heavier than the food was. You ate less to keep the edges dry.",
        cost: "They name you before you speak. From here you are what you can make with heat, and nothing else.",
        ledger: "Came in with iron.",
        world: "hammermen",
        axes: { a1: 1, a2: 2, a3: 1, a4: 2, a5: 3 },
      },
      {
        lead: "The cuttings.",
        body: "Slips of willow and a twist of seed, kept damp the whole way. Most of them are still alive.",
        cost: "They need ground you do not own and years nobody has promised you.",
        ledger: "Came in with cuttings, most of them alive.",
        world: "gardeners",
        axes: { a1: -3, a2: -1, a4: -2, a5: -1 },
      },
      {
        lead: "The pattern-book.",
        body: "Every cut you ever made, drawn to the quarter-inch, and the measures of a hundred people who will never stand in front of you again. It is the only thing that says what you can do.",
        cost: "You carried paper instead of bread, and half the bodies in it are dead by now.",
        ledger: "Came in with a book of measures.",
        world: "tailors",
        axes: { a2: 3, a4: 1 },
      },
      {
        lead: "The boots.",
        body: "Nothing in the bag worth naming: a blanket, a knife, a river stone. What you carried was on your feet, and it did four hundred miles and has another four hundred in it.",
        cost: "Nothing to show them. You will have to be believed on your face, and on how you walked in.",
        ledger: "Came in on my feet.",
        world: "cordiners",
        axes: { a1: 1, a2: -3, a5: -1 },
      },
    ],
  },
  {
    title: "The Low River",
    scene:
      "The river has been low all summer. When the child goes in it is not deep enough to drown her, and deep enough that no one can see the bottom. Three people are standing closer to the water than you are. Not one of them has moved. You notice that you have already started walking.",
    options: [
      {
        lead: "Straight in.",
        body: "The water is waist-high and the cold is a decision you make once. You have a strong stomach. You have always been the one who goes in.",
        cost: "You go in not knowing the bottom. Two of you may need pulling out instead of one.",
        ledger: "Went into the river.",
        world: "fleshers",
        axes: { a1: -1, a2: -3, a4: 3 },
      },
      {
        lead: "The boat pole.",
        body: "Eight feet of ash on the bank, straight in the grain and sound; you know wood, and you know what it will bear. You reach her from dry stone and lose nothing but time.",
        cost: "Fetching it costs seconds, and you will count those seconds for the rest of your life.",
        ledger: "Reached her with the ash pole.",
        world: "wrights",
        axes: { a1: 1, a2: 2, a3: 1, a5: 2 },
      },
      {
        lead: "Wake the whole bank.",
        body: "You shout, and keep shouting, until the three who did not move are moving and people who know this river are running. Your voice was always the tool you reached for first.",
        cost: "You have made it everyone's, which means it is no longer only yours to get right.",
        ledger: "Woke the whole bank.",
        world: "barbers",
        axes: { a1: -1, a3: -3, a5: -1 },
      },
      {
        lead: "The line you can see.",
        body: "There is a pale seam of gravel under the surface, straight as a warp thread. You walk it. It holds, because gravel does, and because you have never trusted a thing you could not see the whole length of.",
        cost: "It is the long way round, and the long way is only right if she is still there at the end of it.",
        ledger: "Walked the gravel seam.",
        world: "weavers",
        axes: { a1: 1, a2: 1, a3: 1, a4: -3 },
      },
    ],
  },
  {
    title: "The Fence",
    scene:
      "They set you to mend a fence that starts in the middle of good pasture and stops in the middle of it. It keeps no beast in and no weather out. When you ask what it is for, the woman who set you the work says it has always been there, and goes back inside.",
    options: [
      {
        lead: "Mend it exactly.",
        body: "Same posts, same spacing, same joint. Whoever built it built it to hold, and a thing built to hold keeps its reason in its shape. You do not need to know what it held.",
        cost: "A week on a thing you cannot defend. You will be asked why, and have no answer.",
        ledger: "Mended the fence as it was.",
        world: "coopers",
        axes: { a1: 2, a2: 2, a3: 1, a4: -1, a5: -2 },
      },
      {
        lead: "Find out first.",
        body: "Someone here knows; the oldest woman in the town was a child when it went up, and children remember fences the way hands remember a pattern. Knowledge kept back is theft; asking is the other half of telling.",
        cost: "Asking makes you the stranger who questions things. That name is hard to put down again.",
        ledger: "Asked what the fence was for.",
        world: "weavers",
        axes: { a1: 1, a3: -1, a4: -3, a5: -1 },
      },
      {
        lead: "Mend it better.",
        body: "The joints are wrong for this ground. You know a way — housed and pegged, the posts charred at the foot — that will stand sixty years, and you have it in your hands.",
        cost: "It stops being their fence. Whatever it meant, it will mean yours now.",
        ledger: "Mended the fence better than they asked.",
        world: "wrights",
        axes: { a1: 1, a2: 2, a3: 2, a4: 2, a5: 3 },
      },
      {
        lead: "Make it useful.",
        body: "Pasture is pasture, and grass does not care about a line drawn through it. Rehung as a gate and a windbreak, the same wood shelters lambs in March instead of dividing grass.",
        cost: "You solved a different problem from the one you were given, which is a kind of not listening.",
        ledger: "Rehung the fence as a gate.",
        world: "gardeners",
        axes: { a1: -3, a2: -2, a4: -1 },
      },
    ],
  },
  {
    title: "The Naming",
    scene:
      "A town this size cannot hold two of anything, so everyone here is called for what they do. There is a Reed and a Kettle and a woman called Thursday for reasons nobody will explain. At the well they ask what you should be called. They are not making conversation. Whatever you say will be true for forty years.",
    options: [
      {
        lead: "Your own name.",
        body: "The one your mother used. It means nothing here, which is why it is still yours. Some things are worth more for being kept shut, and hold better.",
        cost: "A name that says nothing has to be filled by you, alone, and slowly.",
        ledger: "Kept my own name.",
        world: "coopers",
        axes: { a2: 1, a3: 3, a4: -1, a5: -2 },
      },
      {
        lead: "The trade.",
        body: "Let them call you by the work — Baxter, Wright, Souter, Webster; half the town is named for what it does with its hands. It is honest, and it tells a hungry stranger which door has bread behind it.",
        cost: "On the day you cannot do the work, you will not know what is left of you.",
        ledger: "Took the name of the work.",
        world: "bakers",
        axes: { a2: -2, a3: -1, a5: 1 },
      },
      {
        lead: "Whatever they land on.",
        body: "They will choose one anyway, out of some small thing you did on a Tuesday. There are people who let a town rename them twice over and lose nothing by it but the noise; they had the cellar and the barley either way. Better to let them.",
        cost: "You hand them the naming. Some of what they see in you, you will not like.",
        ledger: "Let the town name me.",
        world: "maltmen",
        axes: { a1: -1, a2: -2, a3: -3, a4: -1, a5: -1 },
      },
      {
        lead: "Something you are not yet.",
        body: "Take the name of the thing you mean to become, and spend the forty years catching up to it. Wool takes the colour it is put in. So can a person.",
        cost: "Every day until then, the name is a small lie you are wearing in public.",
        ledger: "Took a name I had not earned.",
        world: "dyers",
        axes: { a1: -2, a4: 3, a5: 2 },
      },
    ],
  },
  {
    title: "The Other One",
    scene:
      "There is someone else here who does what you do. They do it worse — you can see it in the finish, and so could anyone who looked. Nobody looks. They are warm and quick and people like standing near them, so the work goes to them, and it comes back needing doing again inside the year.",
    options: [
      {
        lead: "Let the work speak.",
        body: "Make yours so plainly better that the comparison does the arguing. When they said his arch would fall, the man who built it slept the night under it. Argument is cheap. A night is not.",
        cost: "Eventually is a long time to be poor and quietly certain you are right.",
        ledger: "Let the work speak.",
        world: "masons",
        axes: { a1: 3, a2: 2, a3: 2, a4: -2, a5: 1 },
      },
      {
        lead: "Say it out loud.",
        body: "Someone should tell the town what it is buying. Where you come from, work that would not pass was broken in the square on a Saturday, bad iron over the step, in front of everyone. Nobody thought it cruel. They thought that was what a mark was for.",
        cost: "You will be the one who spoke against a well-liked neighbour. That is what people will remember, not the joint.",
        ledger: "Said it out loud.",
        world: "hammermen",
        axes: { a1: 2, a2: 2, a4: 3 },
      },
      {
        lead: "Learn the warmth.",
        body: "They have something you do not, and it is not luck. Watch how they are with people — how a room eases when they come into it, the way it eases when the jug goes round — and take it.",
        cost: "You will half-know you copied it, and wonder what you set down to make room.",
        ledger: "Learned the warmth.",
        world: "maltmen",
        axes: { a1: -2, a2: -1, a3: -3 },
      },
      {
        lead: "Mend what comes back.",
        body: "Their work returns broken inside the year. Be the one who takes what others have spoiled and makes it worth keeping, and say nothing about who spoiled it.",
        cost: "You build your living on their failures, which quietly requires them to keep failing.",
        ledger: "Mended what came back.",
        world: "skinners",
        axes: { a1: 1, a4: -2, a5: -3 },
      },
    ],
  },
  {
    title: "The Ring",
    scene:
      "The old man's stock is yours to count now, because he cannot climb the stairs and his eyes have gone. There is more here than his book says. Not a little more. Nobody living knows what is in this room but you, and he will be dead before the year turns, and you have been hungry.",
    options: [
      {
        lead: "Count it true.",
        body: "Every item into the book, in a hand that can be read to him. The number is the number. You have spent your life making things that hold, and a count that leaks is not a count.",
        cost: "You hand back a fortune you were the only one who knew about, and nobody will ever know you did.",
        ledger: "Counted it true.",
        world: "coopers",
        axes: { a1: 2, a2: 3, a3: 1, a4: -1, a5: -1 },
      },
      {
        lead: "Take the difference.",
        body: "Wages he never paid, for years, to people he has outlived. Call it the account settling itself. It takes a strong stomach, and you have one, and you would rather have it than not.",
        cost: "You decided what you were owed with nobody else in the room. That is the whole of the thing.",
        ledger: "Took the difference.",
        world: "fleshers",
        axes: { a1: -1, a2: -2, a3: 2, a4: 3, a5: -1 },
      },
      {
        lead: "Tell him.",
        body: "Sit with him and read the true figure aloud, slowly, the way you would talk a man through something with a blade an inch from his throat. He may not follow it. Say it anyway, while he is here to hear it.",
        cost: "He may weep, or accuse you, or not understand. You will have given him a burden to die holding.",
        ledger: "Told him.",
        world: "barbers",
        axes: { a1: -1, a3: -2, a5: -1 },
      },
      {
        lead: "Put it to use.",
        body: "It is rotting in a dark room. Turn it into stock and work and wages while he lives: vats, wool, a colour this town has not seen. Show him a trade thriving before he goes.",
        cost: "You spent what was not yours on being right about what it was for.",
        ledger: "Put it to use.",
        world: "dyers",
        axes: { a1: -2, a2: -2, a3: -1, a4: 2, a5: 3 },
      },
    ],
  },
  {
    title: "The Thin Winter",
    scene:
      "The frost came early and took the late crop with it. There is food in the town, but it is in cellars and it is not evenly spread, and everyone has begun doing sums about their neighbours. Someone has set an empty pot in the square. It has stood there two days. Nothing has gone into it.",
    options: [
      {
        lead: "Put yours in first.",
        body: "Somebody has to go before it is safe to. A pot with one thing in it is a different object from an empty one. You put in the flour you had been keeping back, and walk home lighter.",
        cost: "If nobody follows, you have given away your winter to make a point about your town.",
        ledger: "Put mine in first.",
        world: "bakers",
        axes: { a1: -1, a2: -3, a3: -2, a4: 2 },
      },
      {
        lead: "Make the list.",
        body: "Who has what, who has none, what each household needs to reach spring. Fair is arithmetic before it is feeling, the way a warp is counted before a single thread is thrown.",
        cost: "You will know exactly who lied about their cellar, and you will have to keep greeting them.",
        ledger: "Made the list.",
        world: "weavers",
        axes: { a1: 1, a2: 2, a4: -2 },
      },
      {
        lead: "Keep the seed.",
        body: "Not the food — the seed. Three mouths, a hard four months, and a store of seed-corn that is next year. A garden eaten in one winter is two winters. Charity that eats the seed is a slower harm.",
        cost: "You will eat in a town that watched you not share, and it will remember longer than the winter.",
        ledger: "Kept the seed.",
        world: "gardeners",
        axes: { a1: -1, a2: -1, a3: 2, a4: -3, a5: -2 },
      },
      {
        lead: "Stretch what there is.",
        body: "Bones make broth, and barley that will not make bread will make small beer, and a small thing warm feeds four. You cannot make more food. You can make it go further.",
        cost: "It is the work of every day, unpaid, and nobody thanks the person who makes thin things bearable.",
        ledger: "Stretched what there was.",
        world: "maltmen",
        axes: { a1: -2, a2: -1, a3: -3, a4: -1, a5: -1 },
      },
    ],
  },
  {
    title: "The Door You Were Told Of",
    scene:
      "You have the run of the workshop now, every bench and press and cupboard, except the low door at the back. She was clear about it and she was not unkind, and she gave no reason. She has been gone eleven days. Something behind that door has begun to smell of damp.",
    options: [
      {
        lead: "Open it.",
        body: "Damp ruins wood and paper and iron alike, and rust does not wait for anyone's permission. A rule that costs her forty years of work is not one she would want kept. You go at the thing nobody else will touch, because somebody must.",
        cost: "You will have decided, alone, that you understood her better than her own instruction did.",
        ledger: "Opened the door.",
        world: "hammermen",
        axes: { a1: 1, a2: 2, a3: 1, a4: 2, a5: 1 },
      },
      {
        lead: "Keep it shut.",
        body: "She said the door stays shut. She did not say until it was inconvenient. Where you come from, the oldest promise in the town is one nobody living understands. It has been kept three hundred years, in charity, by people who never asked what it was for.",
        cost: "Whatever is behind it may be past saving by the time she is home, and you will have let that happen.",
        ledger: "Kept it shut.",
        world: "skinners",
        axes: { a1: 2, a4: -2, a5: -3 },
      },
      {
        lead: "Send for her.",
        body: "Eleven days is a long time and not a lifetime. A rider could reach her; a letter could. Half of what you know how to do is ask, and listen, and carry an answer back. It is her door and her decision.",
        cost: "You will have called her home for something you could not settle, and you will both know it.",
        ledger: "Sent for her.",
        world: "barbers",
        axes: { a1: -1, a2: 1, a3: -3, a4: -1, a5: -1 },
      },
      {
        lead: "Work on the wall.",
        body: "Do not open the door. Find the leak, cut the water off outside, and dry the room through the stone. You know walls, and you know that water tells you where it came in if you are patient with it.",
        cost: "You may be too late, and you will have spent the days being clever instead of being decisive.",
        ledger: "Worked on the wall.",
        world: "masons",
        axes: { a1: 2, a2: 2, a3: 3, a4: -1, a5: 2 },
      },
    ],
  },
  {
    title: "What the Town Is Built On",
    scene:
      "You find out the way everyone finds out: someone tells you over work, plainly, as though it were weather. The mill leat runs through the low cottages, and every third year it floods them. The town has known for sixty years how to move it, and has not, because moving it takes the water off the mill. Everything here is built on that. Your bench included.",
    options: [
      {
        lead: "Move the water.",
        body: "A season of digging and timber framing and a bad year for everyone. Then it is done, and done for good, and nobody argues with a finished channel. You have never left a thing half-made in your life.",
        cost: "A bad year is not survivable for every household. Some of those households are in the low cottages.",
        ledger: "Moved the water.",
        world: "wrights",
        axes: { a1: 2, a2: 1, a3: 1, a4: 1, a5: 3 },
      },
      {
        lead: "Raise the houses.",
        body: "You cannot move the water this year. You can get good stone under eleven floors before the next flood, starting Monday, and stone laid right does not care how many floods come after it.",
        cost: "The leat stays. You have made the wrong thing bearable, which is how it survived sixty years.",
        ledger: "Raised the houses.",
        world: "masons",
        axes: { a1: 1, a3: 1, a4: -2, a5: 1 },
      },
      {
        lead: "Say it at the meeting.",
        body: "Sixty years of not saying it out loud is what holds it up. Say it where everyone is, and make them decide in front of each other. Where you come from they turned out their own head man over elevenpence, in the open, because a rule that bends for the powerful is a decoration.",
        cost: "You will force a town to look at itself, and towns do not forgive the one who held the mirror.",
        ledger: "Said it at the meeting.",
        world: "tailors",
        axes: { a2: 3, a3: -1, a4: 2 },
      },
      {
        lead: "Leave.",
        body: "You will not eat from it. Take your tools and your name and walk out by the gate you came in by. Your boots did four hundred miles to get here and will do four hundred more, and a road is a kind of home.",
        cost: "The leat runs on without you. You have saved nobody but yourself, and you know it.",
        ledger: "Would have walked out.",
        world: "cordiners",
        axes: { a1: 1, a2: -1, a3: 1, a5: -1 },
      },
    ],
  },
  {
    title: "The Apprentice",
    scene:
      "The child has been at the door four mornings running and has asked for nothing, which is its own kind of asking. It is not a clever child. It is the other thing, which is rarer and harder to teach: it will stand in the cold and watch the same joint cut nine times without getting bored.",
    options: [
      {
        lead: "Everything, in order.",
        body: "Start where you started. Seven years, the whole of it, nothing held back and nothing skipped. Where you come from a master who kept back a thread of it from an apprentice was called a thief, and rightly.",
        cost: "Seven years of your working life spent making the person who will one day take your custom.",
        ledger: "Taught everything, in order.",
        world: "weavers",
        axes: { a1: 3, a3: 1, a4: -2, a5: 1 },
      },
      {
        lead: "The last thing last.",
        body: "Teach all of it but the one turn that makes your work yours — the thing you learned alone in a locked room, and proved alone. That, when they have earned it. Or at the end.",
        cost: "You have taught someone to almost do a thing, and left them knowing there is a door you are standing in front of.",
        ledger: "Kept the last thing back.",
        world: "tailors",
        axes: { a2: 3, a4: 1, a5: -1 },
      },
      {
        lead: "Put them to work.",
        body: "No lessons. A knife in the hand and real meat on the block from the first morning, ruining real material, until the hands know it and the stomach stops turning.",
        cost: "They will learn your habits before your reasons, including the habits you would not choose to pass on.",
        ledger: "Put the child to work.",
        world: "fleshers",
        axes: { a1: -1, a2: -3, a3: -1, a4: 2, a5: 1 },
      },
      {
        lead: "Send them round the town.",
        body: "A season with everyone here who makes anything, and then come back. Let them find out what their hands are for. You do not know what a seed is until it comes up, and you cannot hurry it.",
        cost: "They may not come back. You will have given away the one apprentice who came to your door.",
        ledger: "Sent the child round the town.",
        world: "gardeners",
        axes: { a1: -3, a3: -1, a4: -2, a5: -1 },
      },
    ],
  },
  {
    title: "The Fire",
    scene:
      "It starts in the thatch two doors down and it is in your roof before anyone has finished shouting. You have the time it takes to cross the room once. The smoke is at head height and dropping. Everything you own is in here, and everything you own is not the same as everything that matters.",
    options: [
      {
        lead: "The tools.",
        body: "The tongs and the files and the small hammer that fits your hand, thirty years of edges ground to your own grip. Iron does not burn, but a workshop's worth of it is a puddle by morning. With them you can make all of it again.",
        cost: "Only you can use them properly, so you are saving your own future and nobody else's.",
        ledger: "Carried out the tools.",
        world: "hammermen",
        axes: { a1: 1, a2: 2, a3: 2, a4: 1, a5: 3 },
      },
      {
        lead: "The papers.",
        body: "The charter and the books: the oldest paper in the town, older than the hall it hangs in, and the name of everyone who ever owed or was owed. Sixty years of a trade, most of it not yours.",
        cost: "Paper is the easiest thing in this room to replace with a lie, and the hardest to eat.",
        ledger: "Carried out the papers.",
        world: "skinners",
        axes: { a1: 2, a2: 1, a3: -1, a4: -2, a5: -3 },
      },
      {
        lead: "The grain.",
        body: "Four sacks: this winter's flour and next year's seed, and there is no next year without them, for anybody. Yours is not the only house on fire, and a town that cannot bake in the morning has lost more than a roof.",
        cost: "They are heavy and slow and you will still be in the room when the roof decides.",
        ledger: "Carried out the grain.",
        world: "bakers",
        axes: { a1: -2, a2: -3 },
      },
      {
        lead: "The people next door.",
        body: "There is an old man through that wall who has not come out, and things do not shout when they are burning. You have had your hands on more strangers' faces than anyone in this town. You know how a person goes quiet.",
        cost: "You will own nothing by morning. Nothing at all, and you will begin again in front of everyone.",
        ledger: "Went through the wall.",
        world: "barbers",
        axes: { a1: -2, a2: -1, a3: -3, a4: 1 },
      },
    ],
  },
  {
    title: "The Wall",
    scene:
      "A year, and they have asked you to stay, and there is a bench with your name on it. They have also asked you to sit on the body that decides who else may come in. There are more at the gate this year than last. You remember the water gate. You remember that nobody was watching it.",
    options: [
      {
        lead: "Keep the standard.",
        body: "Let in whoever can do the work to the mark. Not the mark you like — the mark, tested, alone in a shut room, the same for everyone. A rule that bends for a friend is a decoration, not a rule.",
        cost: "Some who would have been good in five years are turned away in their first, and go elsewhere, and are good there.",
        ledger: "Kept the standard.",
        world: "tailors",
        axes: { a2: 3, a4: 1, a5: 1 },
      },
      {
        lead: "Take the ones who need it.",
        body: "The gate is not a prize. Let it be the thing a person with nothing can walk through, as you did, on whatever they have on their feet. Feet are feet. You have shod an army that was not yours because feet are feet.",
        cost: "Work will go out under the town's name that is not good enough, and the name is all anyone here has.",
        ledger: "Took the ones who needed it.",
        world: "cordiners",
        axes: { a1: 1, a2: -3, a5: -1 },
      },
      {
        lead: "Take down the gate.",
        body: "Any wall that decides who counts as a person is doing that job whatever it was built for. Let them in, and let it be difficult. You have changed your colour twice rather than die in the old one. A town can do the same.",
        cost: "You will have unmade in one season the thing that carried this town through a hundred winters.",
        ledger: "Took down the gate.",
        world: "dyers",
        axes: { a1: -3, a2: -1, a4: 3, a5: 1 },
      },
      {
        lead: "Write it down.",
        body: "Not who to admit — how to decide. Rules that hold when you are dead and the people deciding are worse than you. You have spent your life setting stone for people you will never meet, and this is only more of that.",
        cost: "Written rules outlive their reasons. Someone will be kept out one day by a sentence you wrote tonight.",
        ledger: "Wrote it down.",
        world: "masons",
        axes: { a1: 3, a3: 2, a4: -2 },
      },
    ],
  },
] as const satisfies readonly CraftQuizQuestion[];

function requireQuestion(questionIndex: number): CraftQuizQuestion {
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= CRAFT_QUESTIONS.length) {
    throw new RangeError(`Question index ${String(questionIndex)} is outside the quiz.`);
  }

  const question = CRAFT_QUESTIONS[questionIndex];
  if (question === undefined) {
    throw new RangeError(`Question index ${String(questionIndex)} is outside the quiz.`);
  }

  return question;
}

function dot(left: AxisTotals, right: AxisTotals): number {
  return AXIS_KEYS.reduce((sum, key) => sum + left[key] * right[key], 0);
}

function magnitude(vector: AxisTotals): number {
  return Math.sqrt(dot(vector, vector));
}

/**
 * How closely a respondent's position points the same way as a Craft — cosine
 * similarity, so it measures DIRECTION and ignores emphasis. A timid
 * respondent and a vehement one who share the same values sort alike.
 */
export function craftAffinity(totals: AxisTotals, craftId: CraftId): number {
  const scale = magnitude(totals) * magnitude(CRAFT_AXIS_PROFILES[craftId]);
  return scale === 0 ? 0 : dot(totals, CRAFT_AXIS_PROFILES[craftId]) / scale;
}

/**
 * How many homes each Craft has among the forty-eight answers. Computed from
 * the questions themselves so it can never drift from them; the tests assert
 * every Craft has three or four.
 */
export const CRAFT_WORLD_HOMES: Readonly<Record<CraftId, number>> = Object.freeze(
  CRAFT_QUESTIONS.reduce<Record<CraftId, number>>(
    (acc, question) => {
      for (const option of question.options) acc[option.world] += 1;
      return acc;
    },
    { ...ZERO_WORLD_TALLY },
  ),
);

/**
 * The share of a Craft's world the respondent walked through: chosen homes over
 * homes available, so a Craft with four homes is not advantaged over one with
 * three. 0 = never entered that world; 1 = took every answer that lives in it.
 */
export function worldAffinity(world: WorldTally, craftId: CraftId): number {
  const homes = CRAFT_WORLD_HOMES[craftId];
  return homes === 0 ? 0 : world[craftId] / homes;
}

/** The blended score: how you are tempered, plus what your answers were about. */
export function craftScore(progress: CraftQuizProgress, craftId: CraftId): number {
  return craftAffinity(progress.totals, craftId) + WORLD_WEIGHT * worldAffinity(progress.world, craftId);
}

export function applyCraftQuizAnswer(
  progress: CraftQuizProgress,
  questionIndex: number,
  optionIndex: number,
): CraftQuizProgress {
  const question = requireQuestion(questionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= question.options.length) {
    throw new RangeError(`Option index ${String(optionIndex)} is outside question ${String(questionIndex)}.`);
  }

  const option = question.options[optionIndex];
  if (option === undefined) {
    throw new RangeError(`Option index ${String(optionIndex)} is outside question ${String(questionIndex)}.`);
  }

  const totals: Record<AxisKey, number> = { ...progress.totals };
  for (const key of AXIS_KEYS) {
    totals[key] += option.axes[key] ?? 0;
  }
  const world: Record<CraftId, number> = { ...progress.world };
  world[option.world] += 1;

  return { totals, lastAxes: { ...option.axes }, world };
}

/**
 * Ranks all fourteen Crafts by the blended score — temperament plus world. Ties
 * break toward the Craft the FINAL answer pointed at hardest — the sorting-hat instinct that the last thing you
 * said carries the most of you — and then by the Incorporations' own order of
 * precedence, so the outcome is always deterministic.
 */
export function rankCrafts(progress: CraftQuizProgress): readonly CraftRankingEntry[] {
  const { lastAxes } = progress;
  const lastTotals: AxisTotals = {
    a1: lastAxes.a1 ?? 0,
    a2: lastAxes.a2 ?? 0,
    a3: lastAxes.a3 ?? 0,
    a4: lastAxes.a4 ?? 0,
    a5: lastAxes.a5 ?? 0,
  };

  return CRAFT_ORDER
    .map((craftId, stableOrder) => ({
      craftId,
      score: craftScore(progress, craftId),
      lastAnswerWeight: craftAffinity(lastTotals, craftId),
      profile: CRAFT_PROFILES[craftId],
      stableOrder,
    }))
    .sort((left, right) =>
      right.score - left.score ||
      right.lastAnswerWeight - left.lastAnswerWeight ||
      left.stableOrder - right.stableOrder,
    )
    .map(({ craftId, score, lastAnswerWeight, profile }) => ({
      craftId,
      score,
      lastAnswerWeight,
      profile,
    }));
}
export function buildCraftIntroductionMailto(craftId: CraftId): string {
  const craftName = CRAFT_PROFILES[craftId].name;
  const subject = `Craft introduction — ${craftName}`;
  const body = [
    "Hello,",
    "",
    `I took the Discover Your Craft quiz and my affinity was ${craftName}. I would like to learn more about the Craft and request an introduction.`,
    "",
    "My name:",
    "My trade or profession:",
    "",
  ].join("\n");

  return `mailto:info@tradeshallglasgow.co.uk?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
