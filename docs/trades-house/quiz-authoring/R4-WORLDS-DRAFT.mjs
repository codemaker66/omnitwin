// ---------------------------------------------------------------------------
// R4 — the twelve scenes, each answer now living in a Craft's WORLD.
//
// R3 proved the arc; calibrate.mjs then proved the sorting was a lottery rigged
// toward a few hubs (Coopers 15.9%, Gardeners 1.3% of consistent respondents),
// and that the strongest answers for most Crafts said nothing a lay reader could
// recognise — Hammermen's best three were "mend it better / keep the standard /
// the boat pole": right temperament, no iron. Two causes, both measured: the
// fourteen directions crowd (Masons–Weavers 0.79, Hammermen–Tailors 0.77) and
// coverage is uneven (Gardeners 2 options, Coopers 10). Vector-nudging alone
// stalled at 10/14.
//
// So every option now carries a second, orthogonal signal: `world`, the one
// Craft whose material and moral world the answer lives in. Iron and rust for
// Hammermen; willow slips and seed-corn for Gardeners; a loaf weighed in front
// of the buyer for Bakers; the razor at the throat for Barbers. It is what the
// words SAY, so a reader who knows nothing of the Incorporations but can make
// the obvious guess — nature is the gardeners, metal is the smiths — is
// honoured; and it tells crowded pairs apart by what the answer is ABOUT rather
// than only how it is tempered. Allocation solved in allocate-worlds.mjs: four
// distinct worlds per scene, 3–4 homes per Craft, weighted toward the Crafts
// temperament starves. Rule kept from the old brief: no Craft is ever NAMED.
// Its world may be shown; its name may not.
//
// The two channels must never contradict each other on one answer: a home
// option's temperament vector always points within ~50° of its Craft.
//
//   node --experimental-strip-types docs/trades-house/quiz-authoring/check-geometry-r4.mjs
//
// Axes  a1 Lasting/Living   a2 Perfection/Provision   a3 Bench/Hearth
//       a4 Bold/Steady      a5 Make/Keep     — positive is the FIRST word.
// ---------------------------------------------------------------------------

export const SCENES = [
  // ===== ACT I — THE PERSONA: what you show ================================
  {
    title: "The River Gate",
    scene:
      "The town has a wall on three sides and a river on the fourth. You came in "
      + "by the water gate, which is the one they do not watch, because nobody has "
      + "ever arrived by river meaning harm. Not yet. The gatekeeper asks what is in "
      + "your bag. It is a fair question. You have carried it four hundred miles.",
    options: [
      { lead: "The iron.", world: "hammermen",
        body: "Files, punches, a pair of tongs, wrapped in oiled cloth and heavier than the food was. You ate less to keep the edges dry.",
        cost: "They name you before you speak. From here you are what you can make with heat, and nothing else.",
        axes: { a1: 1, a2: 2, a3: 1, a4: 2, a5: 3 } },
      { lead: "The cuttings.", world: "gardeners",
        body: "Slips of willow and a twist of seed, kept damp the whole way. Most of them are still alive.",
        cost: "They need ground you do not own and years nobody has promised you.",
        axes: { a1: -3, a2: -1, a4: -2, a5: -1 } },
      { lead: "The pattern-book.", world: "tailors",
        body: "Every cut you ever made, drawn to the quarter-inch, and the measures of a hundred people who will never stand in front of you again. It is the only thing that says what you can do.",
        cost: "You carried paper instead of bread, and half the bodies in it are dead by now.",
        axes: { a2: 3, a4: 1 } },
      { lead: "The boots.", world: "cordiners",
        body: "Nothing in the bag worth naming: a blanket, a knife, a river stone. What you carried was on your feet, and it did four hundred miles and has another four hundred in it.",
        cost: "Nothing to show them. You will have to be believed on your face, and on how you walked in.",
        axes: { a1: 1, a2: -3, a5: -1 } },
    ],
  },
  {
    title: "The Low River",
    scene:
      "The river has been low all summer. When the child goes in it is not deep "
      + "enough to drown her, and deep enough that no one can see the bottom. Three "
      + "people are standing closer to the water than you are. Not one of them has "
      + "moved. You notice that you have already started walking.",
    options: [
      { lead: "Straight in.", world: "fleshers",
        body: "The water is waist-high and the cold is a decision you make once. You have a strong stomach. You have always been the one who goes in.",
        cost: "You go in not knowing the bottom. Two of you may need pulling out instead of one.",
        axes: { a1: -1, a2: -3, a4: 3 } },
      { lead: "The boat pole.", world: "wrights",
        body: "Eight feet of ash on the bank, straight in the grain and sound; you know wood, and you know what it will bear. You reach her from dry stone and lose nothing but time.",
        cost: "Fetching it costs seconds, and you will count those seconds for the rest of your life.",
        axes: { a1: 1, a2: 2, a3: 1, a5: 2 } },
      { lead: "Wake the whole bank.", world: "barbers",
        body: "You shout, and keep shouting, until the three who did not move are moving and people who know this river are running. Your voice was always the tool you reached for first.",
        cost: "You have made it everyone's, which means it is no longer only yours to get right.",
        axes: { a1: -1, a3: -3, a5: -1 } },
      { lead: "The line you can see.", world: "weavers",
        body: "There is a pale seam of gravel under the surface, straight as a warp thread. You walk it. It holds, because gravel does, and because you have never trusted a thing you could not see the whole length of.",
        cost: "It is the long way round, and the long way is only right if she is still there at the end of it.",
        axes: { a1: 1, a2: 1, a3: 1, a4: -3 } },
    ],
  },
  {
    title: "The Fence",
    scene:
      "They set you to mend a fence that starts in the middle of good pasture and "
      + "stops in the middle of it. It keeps no beast in and no weather out. When you "
      + "ask what it is for, the woman who set you the work says it has always been "
      + "there, and goes back inside.",
    options: [
      { lead: "Mend it exactly.", world: "coopers",
        body: "Same posts, same spacing, same joint. Whoever built it built it to hold, and a thing built to hold keeps its reason in its shape. You do not need to know what it held.",
        cost: "A week on a thing you cannot defend. You will be asked why, and have no answer.",
        axes: { a1: 2, a2: 2, a3: 1, a4: -1, a5: -2 } },
      { lead: "Find out first.", world: "weavers",
        body: "Someone here knows; the oldest woman in the town was a child when it went up, and children remember fences the way hands remember a pattern. Knowledge kept back is a kind of theft; asking is only the other half of telling.",
        cost: "Asking makes you the stranger who questions things. That name is hard to put down again.",
        axes: { a1: 1, a3: -1, a4: -3, a5: -1 } },
      { lead: "Mend it better.", world: "wrights",
        body: "The joints are wrong for this ground. You know a way — housed and pegged, the posts charred at the foot — that will stand sixty years, and you have it in your hands.",
        cost: "It stops being their fence. Whatever it meant, it will mean yours now.",
        axes: { a1: 1, a2: 2, a3: 2, a4: 2, a5: 3 } },
      { lead: "Make it useful.", world: "gardeners",
        body: "Pasture is pasture, and grass does not care about a line drawn through it. Rehung as a gate and a windbreak, the same wood shelters lambs in March instead of dividing grass.",
        cost: "You solved a different problem from the one you were given, which is a kind of not listening.",
        axes: { a1: -3, a2: -2, a4: -1 } },
    ],
  },
  {
    title: "The Naming",
    scene:
      "A town this size cannot hold two of anything, so everyone here is called for "
      + "what they do. There is a Reed and a Kettle and a woman called Thursday for "
      + "reasons nobody will explain. At the well they ask what you should be called. "
      + "They are not making conversation. Whatever you say will be true for forty years.",
    options: [
      { lead: "Your own name.", world: "coopers",
        body: "The one your mother used. It means nothing here, which is why it is still yours. Some things are worth more for being kept shut, and hold better.",
        cost: "A name that says nothing has to be filled by you, alone, and slowly.",
        axes: { a2: 1, a3: 3, a4: -1, a5: -2 } },
      { lead: "The trade.", world: "bakers",
        body: "Let them call you by the work — Baxter, Wright, Souter, Webster; half the town is named for what it does with its hands. It is honest, and it tells a hungry stranger which door has bread behind it.",
        cost: "On the day you cannot do the work, you will not know what is left of you.",
        axes: { a2: -2, a3: -1, a5: 1 } },
      { lead: "Whatever they land on.", world: "maltmen",
        body: "They will choose one anyway, out of some small thing you did on a Tuesday. There are people who let a town rename them twice over and lose nothing by it but the noise; they had the cellar and the barley either way. Better to let them.",
        cost: "You hand them the naming. Some of what they see in you, you will not like.",
        axes: { a1: -1, a2: -2, a3: -3, a4: -1, a5: -1 } },
      { lead: "Something you are not yet.", world: "dyers",
        body: "Take the name of the thing you mean to become, and spend the forty years catching up to it. Wool takes the colour it is put in. So can a person.",
        cost: "Every day until then, the name is a small lie you are wearing in public.",
        axes: { a1: -2, a4: 3, a5: 2 } },
    ],
  },

  // ===== ACT II — THE SHADOW: what you deny, and what tempts ===============
  {
    title: "The Other One",
    scene:
      "There is someone else here who does what you do. They do it worse — you can "
      + "see it in the finish, and so could anyone who looked. Nobody looks. They are "
      + "warm and quick and people like standing near them, so the work goes to them, "
      + "and it comes back needing doing again inside the year.",
    options: [
      { lead: "Let the work speak.", world: "masons",
        body: "Make yours so plainly better that the comparison does the arguing. When they said his arch would fall, the man who built it slept the night under it. Argument is cheap. A night is not.",
        cost: "Eventually is a long time to be poor and quietly certain you are right.",
        axes: { a1: 3, a2: 2, a3: 2, a4: -2, a5: 1 } },
      { lead: "Say it out loud.", world: "hammermen",
        body: "Someone should tell the town what it is buying. Where you come from, work that would not pass was broken in the square on a Saturday, bad iron over the step, in front of everyone. Nobody thought it cruel. They thought that was what a mark was for.",
        cost: "You will be the one who spoke against a well-liked neighbour. That is what people will remember, not the joint.",
        axes: { a1: 2, a2: 2, a4: 3 } },
      { lead: "Learn the warmth.", world: "maltmen",
        body: "They have something you do not, and it is not luck. Watch how they are with people — how a room eases when they come into it, the way it eases when the jug goes round — and take it.",
        cost: "You will half-know you copied it, and wonder what you set down to make room.",
        axes: { a1: -2, a2: -1, a3: -3 } },
      { lead: "Mend what comes back.", world: "skinners",
        body: "Their work returns broken inside the year. Be the one who takes what others have spoiled and makes it worth keeping, and say nothing about who spoiled it.",
        cost: "You build your living on their failures, which quietly requires them to keep failing.",
        axes: { a1: 1, a4: -2, a5: -3 } },
    ],
  },
  {
    title: "The Ring",
    scene:
      "The old man's stock is yours to count now, because he cannot climb the stairs "
      + "and his eyes have gone. There is more here than his book says. Not a little "
      + "more. Nobody living knows what is in this room but you, and he will be dead "
      + "before the year turns, and you have been hungry.",
    options: [
      { lead: "Count it true.", world: "coopers",
        body: "Every item into the book, in a hand that can be read to him. The number is the number. You have spent your life making things that hold, and a count that leaks is not a count.",
        cost: "You hand back a fortune you were the only one who knew about, and nobody will ever know you did.",
        axes: { a1: 2, a2: 3, a3: 1, a4: -1, a5: -1 } },
      { lead: "Take the difference.", world: "fleshers",
        body: "Wages he never paid, for years, to people he has outlived. Call it the account settling itself. It takes a strong stomach, and you have one, and you would rather have it than not.",
        cost: "You decided what you were owed with nobody else in the room. That is the whole of the thing.",
        axes: { a1: -1, a2: -2, a3: 2, a4: 3, a5: -1 } },
      { lead: "Tell him.", world: "barbers",
        body: "Sit with him and read the true figure aloud, slowly, the way you would talk a man through something with a blade an inch from his throat. He may not follow it. Say it anyway, while he is here to hear it.",
        cost: "He may weep, or accuse you, or not understand. You will have given him a burden to die holding.",
        axes: { a1: -1, a3: -2, a5: -1 } },
      { lead: "Put it to use.", world: "dyers",
        body: "It is rotting in a dark room. Turn it into stock and work and wages while he lives: vats, wool, a colour this town has not seen. Show him a trade thriving before he goes.",
        cost: "You spent what was not yours on being right about what it was for.",
        axes: { a1: -2, a2: -2, a3: -1, a4: 2, a5: 3 } },
    ],
  },
  {
    title: "The Thin Winter",
    scene:
      "The frost came early and took the late crop with it. There is food in the "
      + "town, but it is in cellars and it is not evenly spread, and everyone has "
      + "begun doing sums about their neighbours. Someone has set an empty pot in the "
      + "square. It has stood there two days. Nothing has gone into it.",
    options: [
      { lead: "Put yours in first.", world: "bakers",
        body: "Somebody has to go before it is safe to. A pot with one thing in it is a different object from an empty one. You put in the flour you had been keeping back, and walk home lighter.",
        cost: "If nobody follows, you have given away your winter to make a point about your town.",
        axes: { a1: -1, a2: -3, a3: -2, a4: 2 } },
      { lead: "Make the list.", world: "weavers",
        body: "Who has what, who has none, what each household needs to reach spring. Fair is arithmetic before it is feeling, the way a warp is counted before a single thread is thrown.",
        cost: "You will know exactly who lied about their cellar, and you will have to keep greeting them.",
        axes: { a1: 1, a2: 2, a4: -2 } },
      { lead: "Keep the seed.", world: "gardeners",
        body: "Not the food — the seed. You have three mouths and a hard four months, and a store of seed-corn that is next year. A garden eaten in one winter is two winters. Charity that eats the seed is a slower harm, not a kindness.",
        cost: "You will eat in a town that watched you not share, and it will remember longer than the winter.",
        axes: { a1: -1, a2: -1, a3: 2, a4: -3, a5: -2 } },
      { lead: "Stretch what there is.", world: "maltmen",
        body: "Bones make broth, and barley that will not make bread will make small beer, and a small thing warm feeds four. You cannot make more food. You can make it go further, and warmer.",
        cost: "It is the work of every day, unpaid, and nobody thanks the person who makes thin things bearable.",
        axes: { a1: -2, a2: -1, a3: -3, a4: -1, a5: -1 } },
    ],
  },
  {
    title: "The Door You Were Told Of",
    scene:
      "You have the run of the workshop now, every bench and press and cupboard, "
      + "except the low door at the back. She was clear about it and she was not "
      + "unkind, and she gave no reason. She has been gone eleven days. Something "
      + "behind that door has begun to smell of damp.",
    options: [
      { lead: "Open it.", world: "hammermen",
        body: "Damp ruins wood and paper and iron alike, and rust does not wait for anyone's permission. A rule that costs her forty years of work is not one she would want kept. You go at the thing nobody else will touch, because somebody must.",
        cost: "You will have decided, alone, that you understood her better than her own instruction did.",
        axes: { a1: 1, a2: 2, a3: 1, a4: 2, a5: 1 } },
      { lead: "Keep it shut.", world: "skinners",
        body: "She said the door stays shut. She did not say until it was inconvenient. Where you come from, the oldest promise in the town is one nobody living understands. It has been kept three hundred years, in charity, by people who never asked what it was for.",
        cost: "Whatever is behind it may be past saving by the time she is home, and you will have let that happen.",
        axes: { a1: 2, a4: -2, a5: -3 } },
      { lead: "Send for her.", world: "barbers",
        body: "Eleven days is a long time and not a lifetime. A rider could reach her; a letter could. Half of what you know how to do is ask, and listen, and carry an answer back. It is her door and her decision.",
        cost: "You will have called her home for something you could not settle, and you will both know it.",
        axes: { a1: -1, a2: 1, a3: -3, a4: -1, a5: -1 } },
      { lead: "Work on the wall.", world: "masons",
        body: "Do not open the door. Find the leak, cut the water off outside, and dry the room through the stone. You know walls, and you know that water tells you where it came in if you are patient with it.",
        cost: "You may be too late, and you will have spent the days being clever instead of being decisive.",
        axes: { a1: 2, a2: 2, a3: 3, a4: -1, a5: 2 } },
    ],
  },

  // ===== ACT III — THE SELF: what you are when it costs ====================
  {
    title: "What the Town Is Built On",
    scene:
      "You find out the way everyone finds out: someone tells you over work, plainly, "
      + "as though it were weather. The mill leat runs through the low cottages, and "
      + "every third year it floods them. The town has known for sixty years how to "
      + "move it, and has not, because moving it takes the water off the mill. "
      + "Everything here is built on that. Your bench included.",
    options: [
      { lead: "Move the water.", world: "wrights",
        body: "A season of digging and timber framing and a bad year for everyone. Then it is done, and done for good, and nobody argues with a finished channel. You have never left a thing half-made in your life.",
        cost: "A bad year is not survivable for every household. Some of those households are in the low cottages.",
        axes: { a1: 2, a2: 1, a3: 1, a4: 1, a5: 3 } },
      { lead: "Raise the houses.", world: "masons",
        body: "You cannot move the water this year. You can get good stone under eleven floors before the next flood, starting Monday, and stone laid right does not care how many floods come after it.",
        cost: "The leat stays. You have made the wrong thing bearable, which is how it survived sixty years.",
        axes: { a1: 1, a3: 1, a4: -2, a5: 1 } },
      { lead: "Say it at the meeting.", world: "tailors",
        body: "Sixty years of not saying it out loud is what holds it up. Say it where everyone is, and make them decide in front of each other. Where you come from they turned out their own head man over elevenpence, in the open, because a rule that bends for the powerful is a decoration.",
        cost: "You will force a town to look at itself, and towns do not forgive the one who held the mirror.",
        axes: { a2: 3, a3: -1, a4: 2 } },
      { lead: "Leave.", world: "cordiners",
        body: "You will not eat from it. Take your tools and your name and walk out by the gate you came in by. Your boots did four hundred miles to get here and will do four hundred more, and a road is a kind of home.",
        cost: "The leat runs on without you. You have saved nobody but yourself, and you know it.",
        axes: { a1: 1, a2: -1, a3: 1, a5: -1 } },
    ],
  },
  {
    title: "The Apprentice",
    scene:
      "The child has been at the door four mornings running and has asked for "
      + "nothing, which is its own kind of asking. It is not a clever child. It is the "
      + "other thing, which is rarer and harder to teach: it will stand in the cold "
      + "and watch the same joint cut nine times without getting bored.",
    options: [
      { lead: "Everything, in order.", world: "weavers",
        body: "Start where you started. Seven years, the whole of it, nothing held back and nothing skipped. Where you come from a master who kept back a thread of it from an apprentice was called a thief, and rightly.",
        cost: "Seven years of your working life spent making the person who will one day take your custom.",
        axes: { a1: 3, a3: 1, a4: -2, a5: 1 } },
      { lead: "The last thing last.", world: "tailors",
        body: "Teach all of it but the one turn that makes your work yours — the thing you learned alone in a locked room, and proved alone. That, when they have earned it. Or at the end.",
        cost: "You have taught someone to almost do a thing, and left them knowing there is a door you are standing in front of.",
        axes: { a2: 3, a4: 1, a5: -1 } },
      { lead: "Put them to work.", world: "fleshers",
        body: "No lessons. A knife in the hand and real meat on the block from the first morning, ruining real material, until the hands know it and the stomach stops turning.",
        cost: "They will learn your habits before your reasons, including the habits you would not choose to pass on.",
        axes: { a1: -1, a2: -3, a3: -1, a4: 2, a5: 1 } },
      { lead: "Send them round the town.", world: "gardeners",
        body: "A season with everyone here who makes anything, and then come back. Let them find out what their hands are for. You do not know what a seed is until it comes up, and you cannot hurry it.",
        cost: "They may not come back. You will have given away the one apprentice who came to your door.",
        axes: { a1: -3, a3: -1, a4: -2, a5: -1 } },
    ],
  },
  {
    title: "The Fire",
    scene:
      "It starts in the thatch two doors down and it is in your roof before anyone "
      + "has finished shouting. You have the time it takes to cross the room once. "
      + "The smoke is at head height and dropping. Everything you own is in here, and "
      + "everything you own is not the same as everything that matters.",
    options: [
      { lead: "The tools.", world: "hammermen",
        body: "The tongs and the files and the small hammer that fits your hand, thirty years of edges ground to your own grip. Iron does not burn, but a workshop's worth of it is a puddle by morning. With them you can make all of it again.",
        cost: "Only you can use them properly, so you are saving your own future and nobody else's.",
        axes: { a1: 1, a2: 2, a3: 2, a4: 1, a5: 3 } },
      { lead: "The papers.", world: "skinners",
        body: "The charter and the books: the oldest paper in the town, older than the hall it hangs in, and the name of everyone who ever owed or was owed. Sixty years of a trade, most of it not yours.",
        cost: "Paper is the easiest thing in this room to replace with a lie, and the hardest to eat.",
        axes: { a1: 2, a2: 1, a3: -1, a4: -2, a5: -3 } },
      { lead: "The grain.", world: "bakers",
        body: "Four sacks: this winter's flour and next year's seed, and there is no next year without them, for anybody. Yours is not the only house on fire, and a town that cannot bake in the morning has lost more than a roof.",
        cost: "They are heavy and slow and you will still be in the room when the roof decides.",
        axes: { a1: -2, a2: -3 } },
      { lead: "The people next door.", world: "barbers",
        body: "There is an old man through that wall who has not come out, and things do not shout when they are burning. You have had your hands on more strangers' faces than anyone in this town. You know how a person goes quiet.",
        cost: "You will own nothing by morning. Nothing at all, and you will begin again in front of everyone.",
        axes: { a1: -2, a2: -1, a3: -3, a4: 1 } },
    ],
  },
  {
    title: "The Wall",
    scene:
      "A year, and they have asked you to stay, and there is a bench with your name "
      + "on it. They have also asked you to sit on the body that decides who else may "
      + "come in. There are more at the gate this year than last. You remember the "
      + "water gate. You remember that nobody was watching it.",
    options: [
      { lead: "Keep the standard.", world: "tailors",
        body: "Let in whoever can do the work to the mark. Not the mark you like — the mark, tested, alone in a shut room, the same for everyone. A rule that bends for a friend is a decoration, not a rule.",
        cost: "Some who would have been good in five years are turned away in their first, and go elsewhere, and are good there.",
        axes: { a2: 3, a4: 1, a5: 1 } },
      { lead: "Take the ones who need it.", world: "cordiners",
        body: "The gate is not a prize. Let it be the thing a person with nothing can walk through, as you did, on whatever they have on their feet. Feet are feet. You have shod an army that was not yours because feet are feet.",
        cost: "Work will go out under the town's name that is not good enough, and the name is all anyone here has.",
        axes: { a1: 1, a2: -3, a5: -1 } },
      { lead: "Take down the gate.", world: "dyers",
        body: "Any wall that decides who counts as a person is doing that job whatever it was built for. Let them in, and let it be difficult. You have changed your colour twice rather than die in the old one. A town can do the same.",
        cost: "You will have unmade in one season the thing that carried this town through a hundred winters.",
        axes: { a1: -3, a2: -1, a4: 3, a5: 1 } },
      { lead: "Write it down.", world: "masons",
        body: "Not who to admit — how to decide. Rules that hold when you are dead and the people deciding are worse than you. You have spent your life setting stone for people you will never meet, and this is only more of that.",
        cost: "Written rules outlive their reasons. Someone will be kept out one day by a sentence you wrote tonight.",
        axes: { a1: 3, a3: 2, a4: -2 } },
    ],
  },
];
