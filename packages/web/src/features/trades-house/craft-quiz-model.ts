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
  /** The decisive phrase, shown bold — "The tin box." */
  readonly lead: string;
  /** The case a serious person would make for it. */
  readonly body: string;
  /** What it costs, named plainly. Every option pays something (law L5). */
  readonly cost: string;
  readonly axes: AxisVector;
}

export interface CraftQuizQuestion {
  /** Authoring name. Never rendered — it would telegraph the scene. */
  readonly title: string;
  /** The scene, in the narrator's voice. The Convener speaks this aloud. */
  readonly scene: string;
  readonly options: readonly CraftQuizOption[];
}

export interface CraftQuizAnswerResult {
  readonly totals: AxisTotals;
  readonly lastAxes: AxisVector;
}

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
      "The Chain heard the hammer in you — drawn to stubborn problems and the moment force becomes intelligence. Inventive, practical and quietly brave, you want to leave things stronger than you found them. Your challenge is impatience: not everything yields to pressure.",
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
      "You are a maker of forms — spaces, objects, plans — useful, but never without warmth. Versatile, constructive and welcoming, you give ideas a body. Your challenge is restlessness: finish the first thing before shaping the next.",
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
      "The Chain grew heavy with stone: you think beyond the moment and build what can bear weight after you are gone. Structured, patient and public-spirited, you plan for people you will never meet. Your challenge is rigidity — even good plans must sometimes move.",
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
      "You understand pressure — the seal, the join, the discipline to hold precious things safe. Dependable, organised and discreet, you are trusted with what matters most. Your challenge is control: some things need slack, not tightening.",
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
      "The Chain noticed your eye before your words: you see the crooked seam, the idea that almost fits. You bring poise, proportion and refinement to people and plans alike. Your challenge is perfectionism — some things must breathe before they are finished.",
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
      "You notice the connections others miss — a community, like cloth, is many strands held in tension. Subtle, loyal and patient, you strengthen the whole. Your challenge is over-entanglement: not every loose thread is yours to carry.",
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
      "The Chain flashed with dye and daring: you believe identity should be visible and nothing true should be dull. You bring imagination, flair and creative courage. Your challenge: ask what needs revealing before you change the colour.",
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
      "The Chain felt old leather polished by generations of hands: you guard standards, honour and continuity. Protective, steady and principled — people rest easier in your keeping. Your challenge is suspicion: not everyone needs testing twice.",
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
      "The Chain felt the road beneath your feet: practical, loyal and built for hard journeys, you equip others to endure. You care less for spectacle than readiness. Your challenge is guardedness — prepare for joy as faithfully as you prepare for weather.",
  },
  bakers: {
    name: "THE BAKERS",
    crest: `${MEDIA_ROOT}/crests/bakers.png`,
    essence: "Keepers of the oven — bread, generosity and the staff of daily life.",
    archetype: "The Sustainer",
    omen: "warm bread",
    motto: "NO ONE IS USEFUL HUNGRY.",
    reveal:
      "You ask whether people have eaten before anything else — care, for you, is practical before it is poetic. Warm, generous and reliable, you steady every room you provision. Your challenge is self-neglect: you feed everyone else first.",
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
      "The Chain did not flinch, and neither did you: honest about necessity, fair in supply and clean in dealing. Direct, useful and unsentimental in the best sense. Your challenge is bluntness — truth still needs tenderness.",
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
      "The Chain heard laughter in the old vats: you know trust, flavour and friendship cannot be rushed. A natural host and a fine judge of timing, you turn raw ingredients into fellowship. Your challenge is delay — conditions are never perfect.",
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
      "The Chain softened into leaf and root: you believe growth is real work, and you see what is neglected and imagine it flourishing. Patient, hopeful and restorative. Your challenge is over-nurture — some things need pruning, not tending.",
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
      "The Chain lowered its voice: you have the steadiness people need when they feel exposed. Caring, precise and humane, you restore composure as much as appearance. Your challenge is burden — do not carry others’ distress too deeply.",
  },
} as const satisfies Readonly<Record<CraftId, CraftProfile>>;

/**
 * The twelve scenes.
 *
 * Written to the laws in docs/trades-house/craft-research/17-dostoyevsky-dnd-brief.md:
 * one scene and one threshold each; second person, present tense; four options
 * differing in KIND of good rather than degree; every option carries a named
 * cost; no craft nouns anywhere in the copy (an anvil would telegraph the
 * Hammermen). Ten distinct forms across twelve scenes.
 *
 * The axis vectors are the canonical set proven by the geometry gate. Copy may
 * be edited freely; vectors may not be edited without re-running that gate.
 */
export const CRAFT_QUESTIONS = [
  {
    title: "The Half-Done Thing",
    scene:
      "Auld Rab worked beside ye thirty years, and now he's dying, and he grips yer hand like a man gripping a ledge. Two things he leaves ye, and breath for one sentence: the great work o' his life, half-done where he left it — and the apprentice lad, half-taught at the door. “See it finished,” he says. And then he says nothing, ever again. Ye cannae do both well. Choose.",
    options: [
      {
        lead: "Finish the work itself.",
        body: "To his ain design, exact, though it takes ye ten years. It will stand when every soul who knew him is gone.",
        cost: "ten years of yer own life",
        axes: { a1: 2, a4: -1, a5: 1 },
      },
      {
        lead: "Finish the lad instead.",
        body: "Teach him till HIS hands can finish it. Slower. And the work will change in his hands, for nae two hands are the same.",
        cost: "the work will not be Rab's",
        axes: { a3: 1, a4: -2 },
      },
      {
        lead: "Sell the half-done thing.",
        body: "And put the price in his widow's hand before winter. Rab's dead; she isnae.",
        cost: "the great work dies",
        axes: { a2: -2, a3: -1 },
      },
      {
        lead: "Leave it exactly as his hands left it.",
        body: "Cover it, keep it, let the half-done thing BE his memorial. Finished is not the only kind of true.",
        cost: "it will never serve a living soul",
        axes: { a1: 1, a5: -2 },
      },
    ],
  },
  {
    title: "The True Thing That Doesnae Suit",
    scene:
      "Two of them stand before ye, and ye are the one they've asked to judge. The maker, arms crossed, beside the thing he made — and by every measure ye ken, it is TRUE. Sound, exact, honest work; ye've checked it twice. And beside him the man it was made for, who paid for it, wearing the face of a man at a funeral. It does not suit him. It never will. Both of them are right, and the room is waiting on yer mouth.",
    options: [
      {
        lead: "Judge the thing.",
        body: "It is true work and it passes — the measure cannae bend to a man's mood, or it is no measure at all.",
        cost: "the buyer leaves grieving",
        axes: { a1: 1, a2: 2, a3: 2 },
      },
      {
        lead: "Judge the fit.",
        body: "A thing made FOR a man that doesnae serve him has failed, however true — remake it till it serves the man that paid.",
        cost: "the maker's true work is called a failure",
        axes: { a1: -1, a2: 2, a3: -1 },
      },
      {
        lead: "Refuse the verdict; force the conversation.",
        body: "Lock the pair of them in wi' each other till the maker sees the man and the man sees the work.",
        cost: "neither man brings ye a quarrel again, and the night may end wi' both of them hating the judge",
        axes: { a3: -2, a4: -2 },
      },
      {
        lead: "Pay the difference yerself and dissolve the bargain.",
        body: "Some griefs have nae culprit. The maker keeps his truth, the man his money, and ye are poorer and free.",
        cost: "yer own purse, for other men's peace",
        axes: { a2: -2, a3: 1, a5: -1 },
      },
    ],
  },
  {
    title: "One Armful",
    scene:
      "The river's in yer stairwell — came up in the night like a thief, and it's still rising. One armful, nae more, and the rest is the water's. In yer room: the tin box wi' every penny ye have. The papers that prove what ye own and what ye're owed. Yer mother's letters, that exist nowhere else on this earth. And through the wall, the neighbour's bairn, crying in the dark — whether the neighbour's in there wi' her, or away, or has her in her arms already on the far stair, the wall willnae tell ye. One minute. One armful. Choose.",
    options: [
      {
        lead: "The tin box.",
        body: "Grief doesnae feed anybody. Ye can grieve wi' a roof; ye cannae roof wi' grief.",
        cost: "everything irreplaceable",
        axes: { a2: -2, a4: 1 },
      },
      {
        lead: "The papers.",
        body: "Money's lost in a night; RIGHTS are lost for a generation. What's provable is what's real when the water goes down.",
        cost: "the past, and the present purse",
        axes: { a2: 1, a5: -2 },
      },
      {
        lead: "The letters.",
        body: "The law can be argued again and money earned again. Her hand on paper cannot come back into the world.",
        cost: "yer claim and yer coin",
        axes: { a1: 2 },
      },
      {
        lead: "The wall.",
        body: "Ye put yer shoulder through the wet plaster for the bairn that isnae yours, and let the river have the lot.",
        cost: "everything ye own, on a maybe",
        axes: { a1: -1, a3: -1, a4: 3, a5: 1 },
      },
    ],
  },
  {
    title: "The Thing Told at the Fire",
    scene:
      "At the end of a long wake, when the room has thinned to embers, a man ye hardly ken sits down beside ye and tells ye a thing that cannae be untold. A wrong he did, years back, to a man ye break bread wi' every week — never found out, and never mended. He asks ye for nothing. That's the trap of it. Tomorrow he'll walk the town as ever, and only ye will ken.",
    options: [
      {
        lead: "“Ye tell him yerself — this week — or I will.”",
        body: "A wrong stays alive as long as it stays hidden.",
        cost: "ye become the keeper of another man's conscience",
        axes: { a1: 1, a2: 2, a3: 2, a4: 1 },
      },
      {
        lead: "Say nothing — but mend what his wrong left broken.",
        body: "Quietly, at yer own cost, and never say why.",
        cost: "ye do the labour of a sin that isnae yours",
        axes: { a2: -1, a5: 2 },
      },
      {
        lead: "Keep it. Watch him.",
        body: "Some things are safer in a careful pocket than loose in the town.",
        cost: "a watcher's loneliness, at two tables",
        axes: { a5: -3 },
      },
      {
        lead: "Carry it as it was given.",
        body: "A man emptied his soul at yer fire; that is a kind of holy, and holiness isnae evidence.",
        cost: "ye must sit whole at two tables, forever",
        axes: { a3: -2, a4: -1 },
      },
    ],
  },
  {
    title: "The Paid Debt",
    scene:
      "A hard winter, and yer debts stand at the door like dogs. Then a letter: paid. All of it. Nae name, nae condition — only a line in a strange hand: “For a kindness ye'll no' remember.” Ye search yer memory and find nothing there. It is more than ye needed and far more than ye earned, and whoever did it doesnae want finding.",
    options: [
      {
        lead: "Take it whole, and let yerself be helped.",
        body: "Grace doesnae keep books.",
        cost: "living wi' a debt that cannae be paid",
        axes: { a2: -1, a3: -2 },
      },
      {
        lead: "Take it — and work its worth back into the town.",
        body: "Till the sum squares in yer own ledger, to the penny.",
        cost: "grace turned back into arithmetic",
        axes: { a2: 2, a5: -1 },
      },
      {
        lead: "Take it, and do the same for some other soul",
        body: "who will never find you either.",
        cost: "yer own winter stays lean",
        axes: { a1: -2, a3: -1 },
      },
      {
        lead: "Live as if the debts still stood.",
        body: "Bank what they would have taken, week upon week, till the hook shows itself or the sum sits ready to hand back.",
        cost: "the help ye needed changes nothing about yer winter",
        axes: { a4: -1, a5: -2 },
      },
    ],
  },
  {
    title: "The Far Buyers",
    scene:
      "The biggest order o' yer year, bound for buyers across the sea who will never once stand in yer doorway. There is a cheaper way to do it — no' wrong, exactly; thinner. And yer own voice, quite reasonably, says: thinner is all they asked for and all they paid for — nae buyer on that shore could tell the difference, nor want to. Three winters till it shows, and by then there's an ocean between ye. And the wee ones have slept two winters now under the rain-stain. Ye have till the tide.",
    options: [
      {
        lead: "Do it true, at the dear rate,",
        body: "and let the roof wait another year.",
        cost: "the roof, a year",
        axes: { a2: 3 },
      },
      {
        lead: "Do it true — and write the standard into the bargain",
        body: "so nae man after ye can do it thin either.",
        cost: "yer trade will curse yer name for the precedent",
        axes: { a2: 1, a3: 1, a5: -2 },
      },
      {
        lead: "Thin where it doesnae matter, true where it does",
        body: "— and ken exactly which is which.",
        cost: "ye now keep two sets of conscience",
        axes: { a2: -1, a4: 2 },
      },
      {
        lead: "Turn it down flat.",
        body: "Work that big, for strangers that far, is a door better left shut.",
        cost: "the year's best purse, gone on a principle nobody asked for",
        axes: { a4: -2, a5: -1 },
      },
    ],
  },
  {
    title: "The Smooth Road",
    scene:
      "He is no' a wicked man — that's the devil of it. The landlord's new factor, the man who collects the rents, offers ye a settled rent, a warm back door, first call on every good thing — and asks only that when the vote comes, yer hand rises where his does. He points out the window at the hungry doorways and the cold stairs. “Order feeds more folk than principle ever did,” he says. And looking where he points, ye cannae call him wrong.",
    options: [
      {
        lead: "Take it, and mean it.",
        body: "Warm houses now beat fine speeches forever.",
        cost: "yer hand is his, in public, always",
        axes: { a2: -2, a3: -1 },
      },
      {
        lead: "Refuse him at the market cross, out loud,",
        body: "so the price of him is published.",
        cost: "his warmth turns, and yours is the first roof he forgets",
        axes: { a4: 3, a5: 1 },
      },
      {
        lead: "Refuse him quietly.",
        body: "Vote as ye judge, every time, without banners.",
        cost: "nobody will ever ken what it cost — and he can pick ye off unwatched",
        axes: { a2: 1, a4: -3 },
      },
      {
        lead: "Take his coin wi' yer own purpose folded inside.",
        body: "Rise wi' his hand till the day yer hand matters more.",
        cost: "years o' yer hand rising wi' his, and nae promise the day ever comes",
        axes: { a3: 1, a5: 2 },
      },
    ],
  },
  {
    title: "Berries Off the Same Field",
    scene:
      "They've caught a man at the thing ye've only ever thought about in the low hours — the shortcut ye never took, the leaving ye never did. And as they bring him past, he stops, and smiles, and says, low: “You and me — berries off the same field.” The worst of it is no' that he's lying. Yer word tomorrow helps sink him or save him.",
    options: [
      {
        lead: "Condemn the act in full.",
        body: "And if that condemns a corner of yerself, so be it. That is what judgment is for.",
        cost: "a corner of ye goes down wi' him",
        axes: { a1: 2, a2: 1 },
      },
      {
        lead: "Stand for him.",
        body: "Ye ken exactly how a man arrives there — and mercy that was never tempted is nae mercy at all.",
        cost: "the town files ye beside him",
        axes: { a2: -2, a4: -1, a5: -1 },
      },
      {
        lead: "Say nothing either way.",
        body: "And go home and study the field ye both grew in, till ye ken what seeds it.",
        cost: "abstention is also a verdict, and he'll meet it alone",
        axes: { a4: -2, a5: -2 },
      },
      {
        lead: "Tell the court the truth — “there but for a thin wall go I” —",
        body: "then stand over his mending wi' yer own name on it.",
        cost: "yer respectability, spent on his second chance",
        axes: { a3: 1, a4: 1, a5: 2 },
      },
    ],
  },
  {
    title: "The Room Gone Quiet",
    scene:
      "A feast night, the long table full, when a letter that should never have left its drawer is read aloud for sport — and the man it undresses is sitting right there, gone the colour of ash. The room goes quiet the way a room does when it has been given a body to eat. Ye have the space of a breath, and where ye stand in it will be remembered as long as anybody at this table lives.",
    options: [
      {
        lead: "Cross the room and sit down beside him, and eat",
        body: "— as if beside him is where ye always sat.",
        cost: "his shame becomes joint property",
        axes: { a3: -3 },
      },
      {
        lead: "On yer feet: “This is a feast, no' a court.”",
        body: "And haul the room back to order by the scruff.",
        cost: "ye become the man who hushed it up",
        axes: { a2: 2, a4: 1 },
      },
      {
        lead: "Say the exact truth aloud:",
        body: "the shame in this room belongs to the man reading, no' the man it names.",
        cost: "the reader has friends, and now ye have theirs",
        axes: { a3: -1, a4: 3, a5: 1 },
      },
      {
        lead: "Kick over yer own glass — loudly.",
        body: "Be the fool the room turns to instead.",
        cost: "yer dignity, spent like small coin, and nobody will ever ken why",
        axes: { a2: -1, a3: 1, a5: -1 },
      },
    ],
  },
  {
    title: "The Twice-Broken Word",
    scene:
      "He has broken his word twice — once to the whole street, and once, more privately, to you. Now he stands at yer door asking ye to stand caution for him before the court: yer name under his, yer money behind his promise. The record says no. Something in ye, looking at him, says maybe. Nobody else will do it — and refusing is safe, sensible, and blameless.",
    options: [
      {
        lead: "Sign the whole caution.",
        body: "If a man is to rise at all, somebody has to bear the weight of believing it first.",
        cost: "yer money and yer name, on the record's worst bet",
        axes: { a1: -2, a3: -2 },
      },
      {
        lead: "Sign for half — and tell him to his face:",
        body: "the other half is yours to earn back.",
        cost: "half a grace can read as a whole insult",
        axes: { a2: 2, a5: -1 },
      },
      {
        lead: "Sign nothing — but walk beside him to the court,",
        body: "and be seen walking.",
        cost: "presence buys him nae bread, and earns ye his hope's resentment",
        axes: { a3: -1, a5: -2 },
      },
      {
        lead: "Refuse him plainly:",
        body: "“Carry yer own weight the whole way once — and then ye'll ken ye can.”",
        cost: "if he sinks, that sentence is yer epitaph in his story",
        axes: { a1: 2, a2: 1, a4: -2 },
      },
    ],
  },
  {
    title: "The Wee Kindness",
    scene:
      "Once, years back, ye did a wee kindness — hardly worth the word. A bowl. A bed for a night. A lie no' told. Now the man ye did it for is rich, and he stands in the middle of the town telling everybody that wee thing SAVED him — and he wants to pay it back a thousandfold, wi' yer name over the door of the paying. A bairn ye're raising is watching how ye answer.",
    options: [
      {
        lead: "Take nothing — and set HIM to pass it on wee:",
        body: "a bowl here, a bed there, nae name on any of it. Ye'll ken if he keeps it.",
        cost: "the thousandfold good his gratitude could do, declined",
        axes: { a1: -2, a3: 1, a4: -1 },
      },
      {
        lead: "Take it — and build the thing that does the wee kindness a thousand times a year,",
        body: "without needing anybody's warm mood.",
        cost: "warmth becomes machinery",
        axes: { a2: 1, a5: 2 },
      },
      {
        lead: "Let him make his show.",
        body: "Gratitude that big deserves a stage, and the town could use the spectacle of goodness.",
        cost: "the kindness is now a performance, and ye are in the cast",
        axes: { a1: -1, a4: 2, a5: 1 },
      },
      {
        lead: "Give him nae answer at all — and tell the bairn, later, the only true part:",
        body: "it was one bowl, it was yours to give, and it counted because nobody counted it.",
        cost: "his telling, no' yours, becomes the town's truth of it",
        axes: { a1: 1, a3: -1, a5: -1 },
      },
    ],
  },
  {
    title: "The Good Chair",
    scene:
      "The auld man's chair — his grandmother's before him — comes to ye wi' the house, worn to the shape of four generations of sitting. The joints are going. The family looks to ye, as the one they trust wi' such things, to say what's done wi' it. Every one of them wants a different right thing.",
    options: [
      {
        lead: "Mend it for sitting.",
        body: "A chair kept FROM its work isnae kept at all — put the bairns in it the day the glue is dry.",
        cost: "every repair replaces a little of the hands that made it",
        axes: { a1: -3 },
      },
      {
        lead: "Steady it, seal it, set it where it is seen and never sat on again.",
        body: "Some things' work is finished; their witness isnae.",
        cost: "a chair becomes a relic, and relics gather distance",
        axes: { a1: 2, a5: -2 },
      },
      {
        lead: "Sell it to the collector wi' the deep purse,",
        body: "and put the money under the leaking roof of the living house.",
        cost: "the family's oldest witness leaves in a stranger's cart",
        axes: { a2: -2, a4: 1 },
      },
      {
        lead: "Give it to the young one WITH the mending of it",
        body: "— let her hands learn what holds it, fault and all.",
        cost: "her first mend will be a poor one, and it will show forever",
        axes: { a1: -1, a3: 1, a4: -2 },
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

export function applyCraftQuizAnswer(
  totals: AxisTotals,
  questionIndex: number,
  optionIndex: number,
): CraftQuizAnswerResult {
  const question = requireQuestion(questionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= question.options.length) {
    throw new RangeError(`Option index ${String(optionIndex)} is outside question ${String(questionIndex)}.`);
  }

  const option = question.options[optionIndex];
  if (option === undefined) {
    throw new RangeError(`Option index ${String(optionIndex)} is outside question ${String(questionIndex)}.`);
  }

  const next: Record<AxisKey, number> = { ...totals };
  for (const key of AXIS_KEYS) {
    next[key] += option.axes[key] ?? 0;
  }

  return { totals: next, lastAxes: { ...option.axes } };
}

/**
 * Ranks all fourteen Crafts by affinity. Ties break toward the Craft the FINAL
 * answer pointed at hardest — the sorting-hat instinct that the last thing you
 * said carries the most of you — and then by the Incorporations' own order of
 * precedence, so the outcome is always deterministic.
 */
export function rankCrafts(
  totals: AxisTotals,
  lastAxes: AxisVector = {},
): readonly CraftRankingEntry[] {
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
      score: craftAffinity(totals, craftId),
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
