# 00 — SYNTHESIS: the single working document for the sorting-quiz authoring session

> **Status:** synthesis of dossiers 01–17 in this directory. **Consumed by:** the authoring
> session that will write the quiz questions and re-profile
> `packages/web/src/features/trades-house/craft-quiz-model.ts` per `16-sorting-mechanics.md`.
> **Method:** every card below is distilled from its numbered dossier only — no new research, no
> invention. Where a dossier flags a claim as `[extrapolated]` or unverified, that flag survives
> here. All cosine figures in Part 2 were computed by hand from the §6 seed profiles of dossier 16
> (5-axis integer vectors); the census near-tie pairs are quoted from dossier 16 §11, which
> computed them by exhaustive simulation.
>
> **Updated 2026-08-05:** cards 9, 12 and 14 rewritten from the second-pass (redive) editions of
> `09-coopers.md`, `12-gardeners.md` and `14-bonnetmakers.md`; Part 2.3 amendment 1 upgraded and
> flag 4 revised; a no-move note added as 2.3 item 6; Part 4 re-rated. No axis integers moved, so
> Parts 2.2, 2.4 and 3 are unchanged. Everything else is untouched from the first synthesis.
>
> **Brief served (verbatim):** *"there is 14 crafts and we want this quizz to sort people into
> which craft they most belong to. I have given you some resources to pull from but you must go
> further afield and search the core identity of each of the 14 crafts."*
>
> Contents: **Part 1** — fourteen normalised identity cards. **Part 2** — the value-axis model
> with all 14 crafts placed, pole ownership, and the dangerously-close pairs. **Part 3** — the
> coverage matrix: which question seeds discriminate which pairs, and where the gaps are.
> **Part 4** — the honest quality report: rich vs thin dossiers, and what Blake must supply.

---

## Part 1 — Identity cards (one per craft, fixed template)

Template: **Essence** (2 sentences max) · **Values** (the 5 most load-bearing of the dossier's
5–7) · **Shadow** (one sentence) · **Lexicon** (3 best words) · **Seeds** (3 strongest question
seeds with the axes they load) · **Axis profile** `[A1 Lasting/Living, A2 Perfection/Provision,
A3 Bench/Hearth, A4 Bold/Steady, A5 Make/Keep]` from dossier 16 §6 (amendments in Part 2.3).
Disposition tags are for authors' eyes only and never ship (brief 17, L8/X7).

### 1. HAMMERMEN — "By hammer in hand all arts do stand"
*Precedence 1 · Seal of Cause 11 Oct 1536 · Patron: St Eligius (Eloi) · Dossier: `01-hammermen.md`*

- **Essence:** The federation of every fire-and-metal trade under one crowned hammer, whose double
  conviction is that nothing is true until it is *made*, and that every other art in the city
  stands on their work. Ferocious gatekeepers with a deep poor-box: searchers who smash bad work
  on Saturday, and slip unaudited mercy from the Gill Stoup on Sunday.
- **Values:** 1. Proof by the made thing (even the clerk made a pocket-knife essay, 1718) ·
  2. The standard is sacred (insufficient work seized, broken, rouped) · 3. Honest measure (St
  Eloi's two thrones from one throne's gold) · 4. Brotherhood in life and death (deid bell,
  mortcloths, Gill Stoup, pensioner visits to this day) · 5. Custody of memory (boxes, keymasters,
  the 380-folio Decree "lodged in the box").
- **Shadow:** The gate that forgets what it was guarding — credentialism (the Watt myth was
  believable *because* the gatekeeping was real), vanity litigation, and fifty years of venerating
  the wrong banner.
- **Lexicon:** **essay / sey** (the proving masterpiece) · **Gill Stoup** (the pewter vessel and
  secret instant-mercy fund) · **brod penny** (the outsider's fee to stand at market).
- **Seeds:** *The second throne* (return surplus gold when custom says keep it → Honest measure;
  A2+/A5) · *The stranger of genius* (enforce the wall against a brilliant unfree man → Standard
  vs brilliance; A2) · *The wrong banner* (publish the relic's debunking or let pious error stand
  → Custody of memory as truth; A5−/A1).
- **Axis profile:** `[+2, +3, +2, +2, +1]` — precision religion at the forge; force become
  intelligence.

### 2. TAILORS — motto unrecovered (1924 blazon gap)
*Precedence 2 · Charter 1527 / Seal of Cause 3 Feb 1546 · Patron: St Anne · Dossier: `02-tailors.md`*

- **Essence:** The craft of the measured body and the guarded door: worth proven alone, in a
  locked room, with cloth, shears and an oath that no other hand helped. Their god was fit — of
  garment to body, member to rule, conduct to office — and the same hands that barred the door
  kept the most open purse in the city (four-fifths of income to the poor in 1743–44).
- **Values:** 1. Proof by your own hand (the locked Essay Room, key with the Essaymaster) ·
  2. Fit — to the time and to the body (essays updated when fashion moved, 1713) · 3. The guarded
  threshold (oath against "packing or peeling with unfreemen") · 4. Care for the fallen
  (mortcloths to 32 parishes; famine meal for the whole city) · 5. Lawful order above persons (a
  Deacon unseated over eleven unpaid pennies, 1724).
- **Shadow:** The fitted world become a closed one — a craft that worshipped fit could not abide
  anything it had not measured, and mistook its tape for justice.
- **Lexicon:** **the Essay Room** (the locked chamber of proof) · **at the far hand** (entering as
  a total stranger, at the dearest rate) · **slatehouse** (the pub where jobless journeymen
  chalked their names).
- **Seeds:** *The locked room, twice* (expose the cheat and confess yourself → Proof by your own
  hand; A2+/A5) · *Eleven pennies* (stand down over farthings or serve well → Lawful order vs
  works; A2) · *The child's mortcloth* (waive the fee unminuted or minute it → Care vs
  stewardship; A2−/A5−).
- **Axis profile:** `[0, +3, 0, +1, +1]` — **the Perfection pole.** Poise, proportion, nothing
  careless.

### 3. CORDINERS — "God is our Hope" *(craft-reported, thin evidence)*
*Precedence 3 · Seal of Cause 27 Feb 1558/59 · Patron: St Crispin (post-Reformation: "King Crispin") · Dossier: `03-cordiners.md`*

- **Essence:** The craft of quiet royalty — "a shoemaker's son is a Prince born" — who crowned
  their own King Crispin and paraded him with champions and a Cossack while real kings looked
  shabby. Patient, close-guarded, ceremonious, stubborn about boundaries, tender about their own
  poor: leather outlasts the man who cut it.
- **Values:** 1. Dignity in humble work (the Gentle Craft's hidden royalty) · 2. Fairness inside
  the fold (masters forced to be "half shoemakers and half Barkers" forever, 1657) · 3. The
  guarded gate (House of Lords appeals against unfree boot-sellers) · 4. Provision under pressure
  (160 pairs to the army camp 1640; 6,000 for the occupying Jacobites 1745) · 5. Care for the
  fallen (tramping allowance then; "Body and Sole" children's shoes now).
- **Shadow:** Dignity becomes vainglory — a man died playing Champion in Wallace's borrowed
  armour; believing the crown above the knife is about the crown.
- **Lexicon:** **the Gentle Craft** (shoemaking's proud nickname) · **Goudie** (the unique junior
  office; walker-home of Deacons) · **King Crispin** (the secularised saint, crowned and
  processed).
- **Seeds:** *The Champion's armour* (wear the fatal magnificence → Dignity at its glorious edge;
  A4) · *The Prince's six thousand pairs* (shoe an occupying army to spare the city → Provision
  under pressure; A2−) · *The belt on the bench* (cut leather that belongs to another craft →
  skill vs statute; A5/A2).
- **Axis profile:** `[+1, −2, +1, −1, −1]` — provision-of-readiness at the bench; skill passed
  hand to hand.

### 4. MALTMEN — no motto recorded; the 1851 medal inscription serves ("Established in remote antiquity…")
*Precedence 4 · Letter of Guildry 6 Feb 1605 (records burned 1601) · Patron: none recorded — the Box, the book, the oath · Dossier: `04-maltmen.md`*

- **Essence:** The craft of patient transformation and stubborn survival: they turned dormant
  grain into sweetness the way they turned every catastrophe into continuity — twice declared
  "na craft" by Parliament, twice quietly renamed their chief and bought their liberty back. The
  only craft still led by a **Visitor**, never a Deacon, since 1555.
- **Values:** 1. Guardianship of quality (sworn "to mak Malt weill and skilfullie"; condemning
  "hot, rotten, or frost-slain stuff") · 2. Mutual burden-bearing (kist and winding sheet for a
  dead brother's widow) · 3. Tenacity of institution (the "Oversman" years, 1670–71) · 4. Ordered
  loyalty ("either discreetly silent or safely loyal"; shoes gathered for the Rebels, 1745) ·
  5. Prudent stewardship (nothing lent to a Master Court member "in any shape or form whatever").
- **Shadow:** Care becomes parochialism — the Box's mouth opens for Glasgow widows and snaps shut
  at Bengal's starving, on legal advice, unanimously; and the drink itself, conviviality sliding
  toward Robert Corss roaring in his cups.
- **Lexicon:** **Visitor** (he who visits the kilns — never "Deacon") · **bear** (the hardy
  four-row barley) · **"hot, rotten, or frost-slain stuff"** (the litany of condemned grain).
- **Seeds:** *The Oversman's silence* (fund the patient purse and hold your tongue for three years
  → Tenacity + Prudence; A4−/A5−) · *The Bengal letter* (charity with a burgh wall around it →
  bounded Mutual burden; A3−/A2) · *The frost-slain winter* (declare your own ruined crop when no
  one would know → Quality as private discipline; A2).
- **Axis profile:** `[−1, −2, −3, −1, 0]` — **the Hearth pole.** The fermenter-host; let time do
  its noble work.

### 5. WEAVERS — "Weave Trust with Truth"
*Precedence 5 · Seal of Cause 4 Jun 1528 (craft dated from 1514) · Patron: name scraped blank by the Reformation — genuinely unrecoverable · Dossier: `05-weavers.md`*

- **Essence:** The craft of interlacement — separate fragile threads, crossed patiently and
  honestly, become something none could be alone; truth is the warp, trust is the weft. The
  quietest and most democratic of the fourteen: one-year deacons "for avoiding of all
  superioritie and tyrannie," canvassing punished as sedition.
- **Values:** 1. Truth in the work (work "not sufficient" earned *no payment at all*) · 2. Mutual
  burden (freemen doubled their own dues for seven years when the poor were "like to starve") ·
  3. Equality among brethren (price floors *and* the deacon redistributing "overmeikle work") ·
  4. Perseverance (the 1528 creed: "persevere to finall end") · 5. Transmission (knowledge
  withheld from an apprentice ruled theft, 1615).
- **Shadow:** Trust woven only inside the walls — masters within the charter while the real
  weaving Glasgow, the Calton journeymen, starved on piece-rates and took the musket volley
  (1787).
- **Lexicon:** **wobster** (a weaver; the wobstercraft) · **the lyte** (the shortleet for
  election) · **overmeikle wark** (more work than a man can honestly finish).
- **Seeds:** *The Blank Saint* (copy the blank faithfully or invent a comforting name → Truth even
  as a hole in the cloth; A5/A1) · *The Volley at Parkhouse* (name the striking journeymen or
  stand with the unfree → brotherhood wider than the charter; A3/A2) · *The Third Plaid* (teach
  the apprentice the trick that will undercut you → Transmission; A5).
- **Axis profile:** `[+1, +1, +1, −3, 0]` — **the Steady pole.** Pattern, patience, threads in
  tension.

### 6. BAKERS — "Praise God for all"
*Precedence 6 · First Act of Council 6 Oct 1556 (original charter burned 1652) · Patron: none documented (St Obert `[extrapolated]`) · Dossier: `06-bakers.md`*

- **Essence:** The craft of the daily covenant: the town must be fed, every day, at an honest
  weight — and heaven help the magistrate who presumes to define it for them. Alone among the
  fourteen they ran a business as a body, grinding Glasgow's wheat at their own Kelvin mills for
  three centuries, won by one audacious act of catering before Langside.
- **Values:** 1. Provision as covenant (jailed "for not furnishing the mercat"; £1,320 for famine
  corn 1800–01) · 2. Honest weight (the balance under the irradiated eye of Justice on their
  arms) · 3. The well-timed act (bread to the Regent's army before the victory) · 4. Fair rotation
  (a sitting Deacon fined for grinding out of turn) · 5. Stubborn self-rule (prison chosen over
  signing bonds on the magistrates' terms, 1696).
- **Shadow:** Provision becomes monopoly and control of other people's bread — the man punished
  was the one who sold full-weight loaves *too cheap*.
- **Lexicon:** **baxter** (the craft's own old name) · **mill-day** (a 1/26 share carrying a day's
  grinding in turn) · **the ladle** (the burgh's grain tax; hence the forty-year "Ladle Plea").
- **Seeds:** *The Regent's order* (fire the ovens for an army that may lose → the well-timed act;
  A4) · *The bond in the Tolbooth* (sign the true standard dictated by others, or rot on principle
  → Honest weight vs self-rule; A2/A4) · *The deacon at your booth door* (open the door to the
  scale that ruins you → Honest weight as submission; A2).
- **Axis profile:** `[−1, −3, −1, 0, +1]` — **the Provision pole.** No one is useful hungry.

### 7. SKINNERS & GLOVERS — "To God only be all Glory"
*Precedence 7 (oldest charter) · Seal of Cause 28 May 1516 · Patron: St Christopher · Dossier: `07-skinners.md`*

- **Essence:** The craft that turns death into warmth — wet hides made into fur and glove-leather
  by lime, bark and patience — and Glasgow's eldest incorporation, wearing its seniority quietly
  at seventh place. Its founding document is two crafts promising to "unyte ourself in cherite
  togidder," and its motto hands the credit away.
- **Values:** 1. Charity as constitution ("in cherite togidder" is the charter's own phrase) ·
  2. Quiet primacy (first in age, seventh in rank, silent about both) · 3. Judgment of the hand
  ("false stuff" forfeited; fines paid in altar wax) · 4. Patience with slow transformation
  (months in the lime-holes; a member roll unbroken 1516–1936) · 5. Service before standing
  (every new member served as Officer, carrying box and candles, before full craft life).
- **Shadow:** The keeper who outlives the craft — and the tannery that served the ferryman-saint
  of clean crossings ended up accused of poisoning the Molendinar: foul work upstream, called
  someone else's water.
- **Lexicon:** **kirkmaister** (the pre-charter altar-keeping official) · **searcher of skins**
  (the sworn market inspector) · **imbuikit prenteis** (an apprentice "booked in" to the craft's
  book).
- **Seeds:** *The false-stuff fire* (seize your own brother's bad skins → Judgment of the hand
  above blood; A2) · *The packman's penny* (poind the starving outsider, waive it, or pay his
  penny yourself → Ordered hospitality's third road; A2/A3) · *The burn that carried the saint*
  (move the polluting pits and ruin three masters → stewardship vs livelihood; A5−/A2).
- **Axis profile:** `[+1, +1, −1, −2, −3]` — **Keep pole, hearth side.** Guardian of persons and
  their trust.

### 8. WRIGHTS — "Join all in one"
*Precedence 8 · Seal of Cause 3 May 1600 (1057 royal charter = legend) · Patron on arms: St Kentigern/Mungo · Dossier: `08-wrights.md`*

- **Essence:** The joiners — of wood, and of people: a confederation of a dozen timber trades
  dovetailed under one deacon, the dovetail literally cut into their shield. The craft of *fit*
  and of the whole span of life — they made the cradle, the roof-tree, the fire-engine, and at the
  end the coffin, and walked at the head of the funeral.
- **Values:** 1. Union — "Join all in one" (the motto as constitution) · 2. Proof by work (Henry
  Bell made "the usual Trade Essay" like everyone else) · 3. Right judgment by peers ("the masons
  could not judge upon our work, nor we upon theirs") · 4. Guardianship of the standard (workshop
  inspections; the four-keyed Essay House) · 5. Care from cradle to grave (mortcloths, the 1846
  choice of benevolence over cash-out).
- **Shadow:** The closed shop — a fellowship of joiners who joined everything except the people
  outside the door; 296 members admitted to steal one election.
- **Lexicon:** **pendicle** (a member who never made the essay — the craft's deadliest insult) ·
  **cardower** (an unfree botcher) · **"a penny win ye"** (the Master Court's handshake blessing
  of honest earnings).
- **Seeds:** *Five Pounds in Lieu* (make the essay or pay the fee no one checks → Proof by work as
  identity; A5+) · *The Cardower's Bairns* (prosecute the starving unfree man → Standard vs care
  beyond the walls; A2) · *The 296* (fill the roll to win the righteous cause → Union as principle
  vs arithmetic; A3/A2).
- **Axis profile:** `[+2, +1, +1, 0, +3]` — **the Make pole.** Give good ideas a body.

### 9. COOPERS — motto still unverified (London kin: "Love as Brethren")
*Precedence 9 — fixed by the 1776 Decreet despite the eighth-oldest charter · Own charter 27 Apr 1569 (from the 1551 composite seal) · Post-saint craft (St Thomas altar pre-1560; the 1569 charter redirected altar money to the poor at birth) · Arms matriculated 26 Jun 1924, blazon unrecovered · Dossier: `09-coopers.md` (redived 2026-08-05 — now RICH, see Part 4)*

- **Essence:** The whole art is bending straight things into a circle that holds — a craft with no
  façade, judged by the one merciless test of whether it leaks, and now documented policing that
  test in its own minute book: the searcher struck at a brother's door and answered with public
  penance at the mercat croce (1630), the craft's drinking of its own fines written into the
  record as shame (1643), every timber cargo off the Broomielaw divided by lot "to the poor … als
  weill as the rich alyk" (1638). The barrel and the brotherhood are the same object: separate
  staves, bound by a hoop, useless alone, watertight together.
- **Values:** 1. Tightness — work that holds ("sufficient and good and able for serving our
  sovereign lord's lieges"; the insufficient kirne seized, 1630) · 2. Honest measure (statute
  gallons 1573; the drum crying the Leith gauge through the streets 1613; barrels "not the full
  gedge" confiscated at the quay 1653) · 3. Peer accountability (the Saturday-evening search,
  weekly, from 1551; after 1643 the deacon himself audited yearly before the Convener) ·
  4. Brotherhood as infrastructure (the entry banquet converted into the poor-fund, 1569; the
  cavell — every brother his lot of the common timber, 1638/1665) · 5. Time-served patience
  (seven years minimum — eight-plus-one in the 1630 Paterson indenture — one apprentice, the croze
  handed over only at completion).
- **Shadow:** The hoop that binds also constricts — the "specialls" cornering the river timber
  against their own poor (1638), the fines owed to the poor drunk "to the great offence of God"
  (1643), a late deacon holding the Box hostage (1649), a monopoly so tight the town itself
  protested (1695) — and by 1798 tens of thousands of Clyde barrels a year carried salt herring to
  feed enslaved people, with no minute of protest surviving.
- **Lexicon:** **the gedge** (lawful measure of a barrel) · **cavell** (a brother's allotted lot
  of the common timber, poor and rich alike) · **croze** (the tool that seats the cask-head; now
  the graduation gift).
- **Seeds:** *The Saturday Search* (mark your ruined friend's short barrels → Honest measure vs
  brotherhood; A2) · *The Cavell* (buy the poor brother's lot back, clause by lawful clause →
  equality at the division vs the syndicate; A2/A3) · *The Trussing* (spare the proud fragile
  man the ordeal → belonging through ordeal vs dignity; A3/A4 — the rite itself still
  `[comparative]`, Speyside not Glasgow).
- **Axis profile:** `[+2, +2, +2, −1, −3]` — **Keep pole, bench side.** Hold fast; let nothing
  precious leak away. *(Re-examined against the redive: confirmed, no move — search, Box, gauge
  and cavell are all Keep-at-the-bench behaviours; see Part 2.3 item 6.)*

### 10. FLESHERS — no verified motto; working creed "Men must eat though Empires fall"
*Precedence 10 · Seal of Cause 6 Oct 1580 (deed lost; one council line survives) · Patron: none — born post-Reformation, policed by the sermon bell · Dossier: `10-fleshers.md`*

- **Essence:** The craft that stands between the living beast and the fed city — bloody to the
  elbow so that everyone else may eat with clean hands. Steady, loyal, litigious, unsentimental,
  and quietly kind: a strong stomach and a warm heart, in that order.
- **Values:** 1. Honest goods, honest scales (bans on "blawing of muttoun" and unmarked bull
  beef) · 2. Duty to feed, come what may ("kept a calm sough … while thrones shook") · 3. Nothing
  wasted (dung money paid a schoolmaster; a House of Lords fight over dung and blood) · 4. The
  fraternity feeds its own (widows given market stalls "of grace"; mort cloths for the unburied
  poor) · 5. Lawful stubbornness (beat the Magistrates in court, 1802 — through law, never riot).
- **Shadow:** The inspector's eye and the con-man's eye are the same eye, differently employed —
  and the necessary strong stomach can become the inability to be moved by anything at all.
- **Lexicon:** **blawing of muttoun** (inflating a carcass to fake plumpness — the signature
  fraud) · **keep a calm sough** (stay steady while thrones shake) · **Jock Tamson's bairns** (all
  members alike, no castes).
- **Seeds:** *The blown carcass* (cheat like the rest, starve honestly, or inform → Honest scales;
  A2) · *The rebel army on your haugh* (sell to the Prince's starving Highlanders at the fair
  rate → the steady scale under empire's fall; A4/A2) · *Jock Tamson's bairns* (operatives' dung
  money vs pendicles' equal claim → one fraternity, no castes; A3).
- **Axis profile:** `[0, −2, 0, +2, 0]` — provision with bluntness; the plain dealer,
  market-quick. *(Part 2.3 flags the A4 tension: the dossier's own evidence leans "calm sough"
  steady.)*

### 11. MASONS — "In the Lord is all our Trust"
*Precedence 11 · Seal of Cause 14 Oct 1551 (1057 charter = legend, so instructed by their own Master Court) · Altar: St Thomas · Dossier: `11-masons.md`*

- **Essence:** The craft that measures truth in stone: everything runs on proof — the essay before
  three of the "perfiteast men," the Saturday inspection, Mungo Naismith sleeping under his own
  doubted arch. So in love with permanence they carve a legend the Lord Lyon cannot verify (MLVII)
  into every new stone.
- **Values:** 1. Proof over promise (*show me* is the craft's deepest reflex) · 2. Permanence (the
  1684 Box still in use; records unbroken from 1600) · 3. Guardianship of standards (the cowan
  barred from hewing so much as a window) · 4. Rank earned by service (the unskippable ladder; the
  year-and-a-day rule) · 5. Care for the fallen (the rigging-stone penny: every finished roof
  triggering alms).
- **Shadow:** Permanence curdles into antiquity-vanity — public dignity staked on a musty paper
  with an impossible witness list, and the rank "3 bis" swallowed rather than let the legend go;
  proof curdles into pitilessness toward broken men.
- **Lexicon:** **cowan** (the unfree builder — the mason's shadow-rival) · **rap the shed** (the
  3–7–3 foreman's rhythm that still closes every meeting) · **rigging stane** (the roof-ridge
  stone whose hewing triggered the charity penny).
- **Seeds:** *The musty paper* (expose the false charter your craft's antiquity rests on → Proof
  over promise vs memory as load-bearing wall; A5/A1) · *Naismith's bed* (sleep under your own
  arch before the crowd → proof at its purest; A4/A2) · *The cowan in winter* (inform on the
  skilled hungry outsider as the law demands → standards vs care; A2).
- **Axis profile:** `[+3, +1, +1, −2, +1]` — **the Lasting pole.** Build for those not yet here.

### 12. GARDENERS — "Gardening — the First of Arts"
*Precedence 12 · charter c.1605, lost in the plague (craft: 1646, Deacon "cleansed"; Crawfurd: 1649, Deacon died and the charter burned — unresolved, present neither as settled) · Seal of Cause 22 Nov 1690 · Arms matriculated 25 Mar 1924, blazon verified (Lyon Register vol. 26 fol. 29) · Patron: none — Adam is on the shield · Dossier: `12-gardeners.md` (redived 2026-08-05 — no longer thinnest, see Part 4)*

- **Essence:** The only craft whose arms depict the moment everything went wrong — Adam, Eve,
  serpent, tree — and who read that picture not as a curse (London's choice) but as a *claim*:
  the one trade practised before the Fall. The claim now has an address: the city's own Letter of
  Guildry filed their whole produce — "pears, apples … onions, kail" — among the "small things"
  beneath a guild brother's honour, and the motto is the answer to that insult. They work with
  time instead of against it, were written out of the 1650 land division and never once recorded
  complaining, and the only thing they truly own is the black earth they made out of other
  people's muck — while the 1924 herald gave them the sole increasing thing on any of the
  fourteen shields: "the moon in her increment," waxing.
- **Values:** 1. Patience — planting for someone else's eyes (scholarships as trees; forty
  travelling-scholarship reports on the shelf, 1979–2012) · 2. Tending over making (the
  masterpiece grows itself if you are good enough at not being in the way) · 3. Stewardship of
  ground you do not own (a century of Rottenrow tacks; paid off in damages *for the manure
  alone*, 1792; absent from the 1650 division that eleven crafts drew income from for 350 years) ·
  4. Mercy inside the price list (Gilbert Wilson entered at £3 Scots, quarterly, "being very poor,
  old and infirm," in the same ledger as a £60 stranger; the workhouse charity apprentice, fees
  waived — benevolence in the seventeenth-century books, 130 years before the monopoly died) ·
  5. Continuity without paper (forty-four years governing on memory after the charter was lost to
  the plague-cleansing; sixty-one years of minutes missing, 1774–1835, and never a missed
  election).
- **Shadow:** Weeding becomes a moral category — the word for a self-seeded plant in the wrong
  place and the word for a working man without a freedom are, structurally, the same word;
  patience becomes the endlessly deferred spring; and the humility of the twelfth-ranked craft
  with the largest claim about itself may be a grievance kept warm for 376 years.
- **Lexicon:** **kailyard** (the archetypal Scots kitchen garden) · **stallenger** (licensed to a
  stall at the market's edge "till he be admitted Burgess" — tolerated until he could afford to
  belong) · **the Foull Moor** (the plague-cleansing ground that ate the charter; still
  unlocated — do not map it).
- **Seeds:** *The manure* (take £6 10s 6d for nine years of made soil → stewardship or grievance
  kept warm; A5−/A1) · *The weed you did not plant* (pull out the unfree man feeding four children
  → tending's shadow; A5) · *The Silver Spade and the slow tree* (bedding that wins in August or
  limes for 2085 → Patience vs beauty-now; A1/A4).
- **Axis profile:** `[−3, 0, +1, −2, +1]` — **the Living pole.** Growth as real work, hands in
  earth. *(Part 2.3 flips A5 to −1; the redive upgrades that amendment from proposal-grade to
  confirmed-grade — the Keeper reading is now in primary record.)*

### 13. BARBERS — "In the Presence of God"
*Precedence 13 · Royal Charter 29 Nov 1599 (the only craft founded by the Crown) · No saint; ancestral figure: the biblical Joseph · Dossier: `13-barbers.md`*

- **Essence:** The craft of trust at the throat — every morning half of Glasgow bared its jugular
  to a man with a razor, and talked. The smallest and least lordly craft, yoked 120 years to
  surgeons who despised them, and it beat them not with the lancet but with the law, appeal after
  patient appeal.
- **Values:** 1. Trust — the bared throat (report every violent death honestly; treat the poor
  gratis) · 2. Tenacity within the law (locked out of their own hall, they went to church and took
  minutes) · 3. Equality among brethren (Black journeymen booked 1741, women learners 1791, the
  1792 petition to abolish the slave trade) · 4. Workmanship warranted (no old hair sold as new;
  the wig stamp-master) · 5. The poor of the trade first (every fine "to the use of the poore";
  pensioners' shortbread still).
- **Shadow:** The gossip's treason — the tongue that soothes a customer can sell his secrets by
  noon; and piety curdles into sanctimony, "scadding their tongues in ither folks kale."
- **Lexicon:** **pirrie-wig** (the periwig, the second livelihood) · **moost** (hair-powder) ·
  **cardowing** (moonlighting outside the freedom).
- **Seeds:** *The Chair Hears Everything* (use what the Provost's man let slip under your razor →
  Trust vs advantage; A5−/A2) · *The Locked Hall* (the crowbar or the minute-book that takes three
  years → Tenacity within the law; A4−) · *The Journeymen's Hour* (stand with the men for one hour
  less and be struck from the roll → Equality past its comfortable border; A2/A3).
- **Axis profile:** `[−2, +1, −2, −1, −1]` — renewal *of persons* with a steady gentle hand;
  composure at the bared throat.

### 14. BONNETMAKERS & DYERS — "Give Glory to God" (verified) · chest-carved second motto "Concordia Corroborat"
*Precedence 14 (youngest, last) · Seal of Cause 29 Oct 1597; Dyers assumed 29 Sep 1760; third charter 5 Jan 1801 · Patron: none (post-Reformation — early courts met in kirkyards) · Arms registered 14 Jul 1924, formal blazon text still unpublished · Dossier: `14-bonnetmakers.md` (redived 2026-08-05 — in-house 1952 history read in full, see Part 4)*

- **Essence:** They made the one object by which a Scotsman was known anywhere on earth — the
  broad blue bonnet, the commoner's crown (James V minted a gold coin of himself wearing one) —
  and stayed the smallest, youngest, last-ranked craft: the people who crown the common man do
  not themselves wear crowns. Their own charter says why they exist: false stuff and
  "insufficient colours" left the lieges "utterly defrauded and prejudiced" — a colour that fades
  is a small public lie. And when the trade died they refused to die with it: from a box that
  stood open and empty before the whole court (1882) to £81,394 and a thousand members by 1950.
- **Values:** 1. Identity-making (the badge of a whole people, knitted from waste wool) · 2. Truth
  in colour (the 1597 charter and the 1760 merger both exist to kill false dyes) · 3. Mutual care
  as a sacred trust (the penny-a-week in the founding bargain; the lone 1809 refusal to spend the
  poor's stock on Napoleon's battalion, vindicated 1834) · 4. Adaptive survival (absorbed the
  dyers, closed the loophole 1801, chose benevolence over dissolution 1846, opened the doors in
  2003 — extinction treated as a design problem) · 5. Harmony as strength ("Concordia Corroborat"
  under clasped hands on the Charter Chest — concord as the survival strategy of the smallest
  guild).
- **Shadow:** Identity policed until it becomes exclusion (£50 Scots and permanent expulsion for
  the Kilmarnock cart), harmony kept by fines until it is merely quiet (Helen Wylie threatened
  with perpetual expulsion for carrying a complaint outside; a husband bonded over his wife's
  tongue; alms that struck the pensioner off the qualified roll) — and survival by dilution: a
  craft of bonnetmakers containing no bonnetmakers, "known as 'Dyers' only" until the original
  parchment had to be shown to the Town Clerk.
- **Lexicon:** **litster** (Scots for dyer) · **the Broad Penny** (the 12-shilling licence a
  Kilmarnock man paid for an inferior market-day stand) · **toorie** (the bright red tuft
  crowning the bonnet).
- **Seeds:** *The Norway order* (dye true for strangers who can never check → Truth in colour
  unobserved; A2) · *The Kilmarnock cart* (one contraband cartload feeds your children till
  spring; the penalty is civic death → covenant vs survival; A2/A5 — the £50 fine now sourced to
  the 1952 History, no longer a search snippet) · *The nightcap heresy* (retool for the future or
  keep faith with the bonnet and gutter out → Adaptive survival vs identity held holier than
  existence; A1/A4).
- **Axis profile:** `[−2, +1, −1, +3, +2]` — **the Bold pole**, held. *(Part 2.3 flag 4 revised
  after the redive: the Bold reading now has documented anchors — the lone 1809 stand against the
  whole House, the 1816 "Spartan severity" ultimatum, the anthem's cocked bonnet — but the
  register is defiant endurance, not swagger.)*

---

## Part 2 — The value-axis model, with all fourteen crafts placed

### 2.1 The five axes (from `16-sorting-mechanics.md` §5)

| Axis | Poles (+ / −) | The question it asks |
|---|---|---|
| **A1 — the Stone and the Leaf** | Lasting ↔ Living | Is good work what *outlasts* you, or what *renews*? |
| **A2 — the Rule and the Loaf** | Perfection ↔ Provision | Does the work serve the standard, or the fed and equipped? |
| **A3 — the Bench and the Hearth** | Bench ↔ Hearth | Is your energy with the material, or among the people? |
| **A4 — the Spark and the Loom** | Bold ↔ Steady | Strike and show, or slow work and lasting worth? |
| **A5 — the Chisel and the Key** | Make ↔ Keep | Bring the new into being, or hold the entrusted safe? |

Scoring: options carry axis-delta vectors; crafts are fixed directions; winner = highest cosine
similarity; faint-signal and near-tie runs go to the Hatstall protocol (dossier 16 §7, §11).

### 2.2 Placement table (dossier 16 §6 seed v0.2 — the baseline)

| # | Craft | A1 | A2 | A3 | A4 | A5 | Pole owned |
|---|---|---|---|---|---|---|---|
| 1 | Hammermen | +2 | +3 | +2 | +2 | +1 | — (near-Perfection, high everywhere) |
| 2 | Tailors | 0 | **+3** | 0 | +1 | +1 | **A2+ Perfection** |
| 3 | Cordiners | +1 | −2 | +1 | −1 | −1 | — |
| 4 | Maltmen | −1 | −2 | **−3** | −1 | 0 | **A3− Hearth** |
| 5 | Weavers | +1 | +1 | +1 | **−3** | 0 | **A4− Steady** |
| 6 | Bakers | −1 | **−3** | −1 | 0 | +1 | **A2− Provision** |
| 7 | Skinners | +1 | +1 | −1 | −2 | **−3** | **A5− Keep (hearth side)** |
| 8 | Wrights | +2 | +1 | +1 | 0 | **+3** | **A5+ Make** |
| 9 | Coopers | +2 | +2 | +2 | −1 | **−3** | **A5− Keep (bench side)** |
| 10 | Fleshers | 0 | −2 | 0 | +2 | 0 | — |
| 11 | Masons | **+3** | +1 | +1 | −2 | +1 | **A1+ Lasting** |
| 12 | Gardeners | **−3** | 0 | +1 | −2 | +1 | **A1− Living** |
| 13 | Barbers | −2 | +1 | −2 | −1 | −1 | — |
| 14 | Bonnetmakers & Dyers | −2 | +1 | −1 | **+3** | +2 | **A4+ Bold** |

All four A1×A4 quadrants are occupied (Gardeners Living+Steady, Hammermen Lasting+Bold, Dyers
Living+Bold, Masons Lasting+Steady), and the two historically starved crafts (Coopers, Skinners)
each own a Keep pole — reachability by geometry, not tie-break.

### 2.3 Dossier-driven amendments (proposed v0.3 — for the authoring session to bless)

Dossier 16 wrote 12 of these 14 profiles from `CRAFT_PROFILES` copy before the dossiers existed
(its own Gaps section says so). Now that all 14 dossiers are in, two amendments are strongly
evidenced and three tensions must be carried as flags. *(Re-examined 2026-08-05 against the
redived dossiers 09/12/14: amendment 1 upgraded, flag 4 revised, and one explicit no-move note
added as item 6 — no integers changed, so Parts 2.2, 2.4 and 3 stand.)*

1. **AMEND — Gardeners A5: +1 → −1** (new profile `[−3, 0, +1, −2, −1]`). The dossier's core
   values are *Tending over making*, *Stewardship of ground you do not own*, *Continuity without
   paper* — this is a Keeper, not a Maker. Checked: no new collision (nearest neighbour becomes
   Barbers at cos ≈ 0.55, still comfortable). **Upgraded by the 2026-08-05 redive from
   proposal-grade to confirmed-grade:** the Keeper pattern is now in primary record — written out
   of the 1650 land division and never once recorded complaining; two record losses (the charter,
   the 1774–1835 minutes) survived on continuous practice; and the August judging walk of Let
   Glasgow Flourish is the old visitation outliving the trade by 180 years.
2. **AMEND — Maltmen A5: 0 → −1** (new profile `[−1, −2, −3, −1, −1]`). *Prudent stewardship* and
   *Tenacity of institution* (the Box, the bonds, the Oversman years) are Keep behaviours.
   Side-benefit: reduces the worst collision, Bakers–Maltmen, from cos 0.75 to ≈ 0.65.
3. **FLAG — Fleshers A4 +2 (Bold).** The dossier's own evidence leans Steady ("kept a calm sough
   … no panic in times of crisis"; lawful stubbornness through courts, never riots). But softening
   A4 collapses Fleshers into Bakers (moving Bakers bolder instead pushes Bakers into Fleshers at
   cos ≈ 0.78 — tested, rejected). Keep +2, ground it in market-quickness and bluntness, and rely
   on an A4 seed to discriminate the Bakers–Fleshers seam.
4. **FLAG (revised 2026-08-05) — Dyers A4 +3 (Bold pole): keep, now with documentary anchors.**
   The in-house 1952 history has been read in full, and it settles the tension the first
   synthesis could not: the craft's register is confirmed as defiant endurance rather than
   swagger, but the Bold reading no longer rests on the shipped archetype alone. The dossier now
   supplies documented Bold behaviour — the lone 1809 refusal to spend the poor's stock on the
   battalion, against every other craft and against patriotism (vindicated by the Commissioners
   in 1834); the 1816 "Spartan severity" ultimatum to the non-entered dyers; extinction treated
   as a design problem; and the craft's own anthem ("cocks his bonnet on his brow / And fights").
   Keep +3; question copy feeding Dyers should draw on colour-truth and the nerve to stand alone
   against the room, not bravado.
5. **FLAG — Hammermen A5 +1.** *Custody of memory* (boxes, keymasters, relics) is a genuine Keep
   streak in a Make-flavoured craft. Not worth an integer move (it would blur the Wrights seam),
   but authors should not write Hammermen-serving options as pure Make.
6. **RE-EXAMINED, NO MOVE — Coopers `[+2, +2, +2, −1, −3]` (2026-08-05 redive).** The enriched
   dossier confirms the direction in primary record: the Saturday search, the Box, the gauge and
   the cavell are all Keep-at-the-bench behaviours. Softening A3 toward the dossier's
   brotherhood-as-infrastructure material was tested and rejected — Coopers at `[+2, +2, +1, −1,
   −3]` collides with Skinners at cos ≈ 0.80 (up from 0.69), destroying the A3 seam that
   separates the two Keepers. The bench reading stands: the Coopers guard *contents*, the
   Skinners guard *persons*.

### 2.4 The dangerously close pairs

Two independent views, both needed:

**(a) Profile space** — intrinsic geometric closeness of craft directions (pairwise cosine on the
v0.2 baseline, computed by hand for this synthesis; design law: no pair above 0.85):

| Rank | Pair | cos | What tangles them | Discriminating axis (largest normalised profile gap) |
|---|---|---|---|---|
| 1 | **Masons – Weavers** | **0.79** | both steady, patient, standard-guarding, poor-box crafts | **A1** (stone that outlasts vs web that renews/transmits), then A4 |
| 2 | **Hammermen – Tailors** | **0.77** | both locked-room proof-by-hand perfectionists | **A3** (material at the forge vs fit on the body), tied with A1 |
| 3 | **Bakers – Maltmen** | **0.75** | both grain, provision, burgh-bounded mutual care | **A3** (the mill queue vs the shared table) |
| 4 | Masons – Wrights | 0.71 | the 1551 siblings; both proof-and-standard builders | **A5** (endure/keep vs make/join), then A4 |
| 5 | Coopers – Skinners | 0.69 | the two Keepers | **A3** (guard contents at the bench vs guard persons at the hearth) |
| 6 | Hammermen – Wrights | 0.66 | both make-and-prove crafts | **A5**, then A4 |
| 7 | Fleshers – Bakers | 0.61 | both provision crafts | **A4** (market-quick vs oven-rotation) |

(Everything else sits below 0.56; Cordiners' and Dyers' nearest neighbours are ≈ 0.31 and ≈ 0.32
respectively — they are the best-isolated crafts.)

**(b) Respondent space** — where real answer-paths actually land between two crafts (census
near-tie pairs at ε = 0.02, quoted from dossier 16 §11, computed by exhaustive simulation):
**Bakers+Maltmen (A3)**, **Barbers+Skinners (A1)**, **Coopers+Skinners (A3)**,
**Barbers+Maltmen (A2)**.

**Read together:** *Bakers–Maltmen* is the most dangerous pair in the fleet — top-three in both
views. *Coopers–Skinners* appears in both. *Masons–Weavers* and *Hammermen–Tailors* are the two
closest in profile space yet absent from the census list — meaning current question content
under-samples exactly the regions where those pairs would collide; do not mistake that absence
for safety. *Barbers* are geometrically mid-distance from everyone but sit at three census
boundaries (Skinners, Maltmen, and — per dossier 16's tuning notes — they were retargeted in
v0.2), so Barbers need seeds that pull them decisively toward Living-renewal-of-persons.

---

## Part 3 — Coverage matrix: which seeds discriminate which pairs

Inventory: each craft dossier ships 6 question seeds (84 total), dossier 16 ships 5 axis
tie-breakers plus the reserve Hatstall, and brief 17 governs form and voice (its worked examples
W1–W4 are calibration standards, not quiz content). The matrix below maps the eight dangerous
pairs to the seeds that genuinely split them. A seed discriminates a pair when its options force
a trade on that pair's discriminating axis — not merely when it features either craft's lore.

| Dangerous pair | Axis | Best existing seeds (dossier · seed) | Coverage verdict |
|---|---|---|---|
| **Masons – Weavers** | A1 (then A4) | TB-1 *Stone stair vs orchard* (16) — partial: the orchard horn is Living, but Weavers are not Living-pole; Weavers *The Third Plaid* (A5 transmission) and Masons *The musty paper* (A5/A1) each probe one craft, neither forces the pair | **GAP — must author.** Needed: one scene trading the monument that outlasts against the pattern/skill that renews through other hands (stone vs web, name-cut-in-stair vs apprentice-carries-it-on) |
| **Hammermen – Tailors** | A3 (then A1) | TB-3 *Workshop at dusk vs Grand Hall at full roar* — partial (Hammermen A3 +2 vs Tailors 0 is only a 2-step gap); both crafts' own essay seeds (*second throne*, *locked room*) load A2 and do **not** separate them | **GAP — must author.** Needed: a scene splitting truth-of-the-thing (does the mechanism *work*) from truth-of-the-fit (does it *suit the body/time*) — material proof vs social measure |
| **Bakers – Maltmen** | A3 | TB-3 (16) — direct hit; Maltmen *The Bengal letter* (care bounded by the burgh wall — hearth-parochial); Bakers *Drought at the wheel* (fair rotation at the shared mill — bench-system) | **Covered**, but this is the #1 pair in both views: give it the TB-3 slot *and* keep both dossier seeds in the main flow |
| Masons – Wrights | A5 (then A4) | TB-5 *Essay Master vs Gowdie* (16) — direct hit; Wrights *Five Pounds in Lieu* (A5+ purity); Masons *The musty paper* (memory/keep vs proof) | **Well covered** |
| Coopers – Skinners | A3 | TB-3 (16); Coopers *The Trussing* (bench-brotherhood ordeal) vs Skinners *The packman's penny* (hearth-hospitality with the third road) | **Covered** — note dossier 16 §13 example C resolves exactly this pair via TB-3 |
| Barbers – Skinners | A1 | TB-1 (16); Skinners *The book flayed for a binding* (the sacred past as material — A1/A5); Barbers seeds mostly load A2/A5, none loads A1 cleanly | **Thin.** TB-1 carries it alone in the adaptive bank; author at least one main-flow A1 option pairing renewal-of-persons (fresh face, mended man) against slow-cured permanence |
| Barbers – Maltmen | A2 | TB-2 *Essay-piece vs meal sack* (16); Barbers *Old Hair, New Wig* (warranted work under hunger — A2+) vs Maltmen *Robert Corss's toast* (fellowship vs quality — A2/A3) | **Covered** |
| Hammermen – Wrights | A5 (then A4) | TB-5 (16); Wrights *Outstreking ane Void* (finish the work vs honour the compact); Hammermen *The wrong banner* (custody/keep streak) | **Covered** |
| Fleshers – Bakers (watch item) | A4 | Bakers *The Regent's order* (the bold well-timed act) vs Fleshers *The rebel army on your haugh* (the steady scale under empire's fall) — a matched A4 pair, one per craft | **Covered** — and unusually elegant: the same Jacobite winter, opposite virtues |

**Axis-by-axis seed inventory** (for question-budget planning; strongest candidates only):

- **A1 Lasting↔Living:** TB-1; Gardeners *Silver Spade and the slow tree*; Skinners *book flayed
  for a binding*; Wrights *A Single Stone*; Bonnetmakers *nightcap heresy*. *Weakest-covered axis
  in the main flow* — most dossier seeds load A2/A5.
- **A2 Perfection↔Provision:** TB-2; Hammermen *searcher's Saturday*; Tailors *the hour between
  seven and eight*; Bakers *bond in the Tolbooth*; Coopers *Saturday Search*; Bonnetmakers *Norway
  order*; Masons *cowan in winter*; Wrights *Cardower's Bairns*. *Oversupplied* — nearly every
  craft's #1 seed is a quality-vs-mercy trade; the authoring session must prune ruthlessly or the
  quiz becomes eight variations of one question (X12 risk, brief 17).
- **A3 Bench↔Hearth:** TB-3; Coopers *Banquet or the Box* and *Trussing*; Maltmen *Bengal letter*;
  Fleshers *Jock Tamson's bairns*; Weavers *Volley at Parkhouse*.
- **A4 Bold↔Steady:** TB-4; Bakers *Regent's order*; Cordiners *Champion's armour*; Masons
  *Naismith's bed*; Coopers *Proxy's Patience*; Barbers *Locked Hall* (steady-lawful pole).
- **A5 Make↔Keep:** TB-5; Wrights *Five Pounds in Lieu*; Gardeners *weed you did not plant* and
  *the manure*; Weavers *Blank Saint* and *Third Plaid*; Maltmen *Oversman's silence*; Hammermen
  *wrong banner*; Barbers *Chair Hears Everything*.

**Three authoring directives that fall out of the matrix:**
1. Write the two missing pair-splitters (Masons–Weavers on A1; Hammermen–Tailors on A3) before
   anything else — they guard the two geometrically closest pairs in the fleet.
2. Rebalance the main flow away from A2: cap quality-vs-mercy scenes at two, per the ≤2-per-form
   rule (brief 17 §4), and convert the surplus A2 lore into option-*horns* inside scenes whose
   primary trade is A1/A3/A4.
3. All seeds above are lore-anchored to specific crafts; under L8/X7 (no craft nouns, no
   telegraphy) each must be *de-crafted* in prose — the smith's forge becomes a fire, the wig
   becomes warranted work — while keeping the structural dilemma intact. The seed-to-craft
   anchoring in Part 1 is scoring metadata, never copy.

---

## Part 4 — Honest quality report

### 4.1 Ratings at a glance

| Dossier | Rating | Primary spine actually read | Verified blazon/motto? | Biggest holes |
|---|---|---|---|---|
| 01 Hammermen | **RICH** | Lumsden & Aitken 1912 + Muir 1939, both full-text | Yes (1918 arms, motto) | Falkirk-1746 banner uncorroborated; oath text lost |
| 02 Tailors | **RICH** | Lumsden 1928 (56pp) + 1902 Rules (20pp), full | **No** — 1924 blazon+motto unrecovered | Two further primary PDFs failed (>10MB) |
| 03 Cordiners | **RICH** | 2022 official Short History (48pp) + Marwick PhD thesis, full | Partial — motto craft-reported only | Campbell 1883 history unread (>10MB); essay-piece spec unknown |
| 04 Maltmen | **RICH** | Chronicles 1879, full text | Yes (1924 blazon; no motto exists) | Pre-1601 records burned (a real-world hole, not a research one) |
| 05 Weavers | **RICH** | M'Ewan 1908 records, full text | Motto yes; blazon from crest image only | Minute books 1683–1793 lost; patron genuinely blank |
| 06 Bakers | **RICH** | 1931 history (213pp), full text | Yes (1923 blazon, motto) | 2019 interim history PDF failed (>10MB) |
| 07 Skinners | **MEDIUM** | Charter transcript, officer lists, 1857 Rules, 1924 grant — but **Lumsden 1937, the definitive history, unreadable** (image-only PDF) | Yes (1924 grant read in full) | Essay `[extrapolated]`; sensory world partly `[extrapolated]`; no craft-specific demarcation case found |
| 08 Wrights | **RICH** | 1900 book + Bryce 2025 (110pp), both full | Yes (1924 blazon, motto) | 1057 charter is legend (handled correctly) |
| 09 Coopers | **RICH** *(redived 2026-08-05; was THIN)* | Lumsden's *Records of the Trades House 1605–1678* full text + Crawfurd 1858 + Cleland + Muir 1939 + the craft's own deacon roll 1587–2024, all mined | **No** — matriculation date confirmed (26 Jun 1924); blazon and motto still unrecovered (see 4.3 item 4) | Essay still `[extrapolated]` (Aberdeen comparative only); trussing-in still trade-generic `[comparative]`; Mair's standard history (2004) still inaccessible |
| 10 Fleshers | **MEDIUM** | The Clerk's 1935 Note (rich, partisan) + burgh records via Glasghu Facies | **No motto**; blazon read from the Grand Hall carving, not the Register | Early minute books destroyed after excerpting; deed of 1580 lost |
| 11 Masons | **RICH** | Cruikshank 1879 full + Bryce 2016 customs + 1917 Patent | Yes (1917 blazon, motto) | St Thomas vs St Stephen altar discrepancy flagged |
| 12 Gardeners | **MEDIUM** *(redived 2026-08-05; was self-declared thinnest)* | ~50 primary pages of the 1903 history (member roll + craft genealogy scans) + Crawfurd 1858 + *Records of the Trades House 1605–78*, mined line by line | **Yes** — blazon and grant date (25 Mar 1924, Lyon Register vol. 26 fol. 29) recovered from the Lord Lyon PDF via `pypdf` | Narrative pp. 1–178 of the 1903 history still unread; essays were taken (1745) but content unknown — do not invent; charter-loss account conflicted (1646 vs 1649); minutes 1774–1835 missing; no craft relics catalogued |
| 13 Barbers | **RICH** | Tennent 1899 Records, full text (~480KB extracted) + Lumsden's Traditions | Yes (blazon, both mottoes) | Original 1599 Royal Charter lost (real-world hole) |
| 14 Bonnetmakers & Dyers | **RICH** *(redived 2026-08-05; was THIN)* | The craft's own 1952 history (6th ed., 63pp, ed. Lindsay / Lumsden) fetched in full and mined + deacon roll 1593–2018 | **Motto yes** — "Give Glory to God" plus chest-carved "Concordia Corroborat"; arms registered 14 Jul 1924 but the formal blazon text is still unpublished | 1951–1984 chapters (7th ed., 1986) unmined; minute volume 1718–1742 missing (real-world hole); kin lore (Stewarton/Dundee) remains labelled, never Glasgow fact |
| 15 Trades House | **SOLID** | Letter of Guildry text (BHO) + Lumsden 1910 records + full museum sweep | Yes (House arms 1911, "Union is Strength") | Precedence table 1–14 is inference from three anchors (flagged) |
| 16 Sorting mechanics | **SOLID** | Simulation-backed (262,144 paths); citations to psychometrics | n/a | 12 of 14 profiles written pre-dossiers (Part 2.3 fixes); v0.2 fails own balance band (wrights 1.64%) — one more tuning pass owed |
| 17 Literary brief | **COMPLETE** | n/a (craft brief) | n/a | A handful of `[verify]` tags on secondary-literature chapter refs |

### 4.2 What the thin dossiers cost the quiz (re-assessed after the 2026-08-05 redive)

**The redive worked.** The former thin three (9, 12, 14) are no longer the problem, and no
dossier in the fleet is rated THIN any more:

- **Coopers (9): THIN → RICH.** The reachability worry (dossier 16 §II) is now answered in
  content as well as geometry: the Glasgow minutes themselves supply the search-violence of 1630,
  the cavell decreet of 1638, the drinking rebuke of 1643 and the Box held hostage in 1649 —
  Keep-pole lore in primary record. Two cautions survive into authoring: the essay is still
  `[extrapolated]` (Aberdeen comparative only) and the trussing-in remains `[comparative]` —
  Speyside colour, never Glasgow fact.
- **Gardeners (12): THIN → MEDIUM, no longer thinnest.** Blazon verified, deacon roll complete
  1626–2024, ~50 primary pages of the 1903 book in hand, and the 1650-exclusion discovery gives
  the identity a documented spine (no longer one manure episode from another craft's archive).
  Standing cautions: the Gardeners *took* essays ("produced his essay," 1745) but the content is
  unknown — **still do not invent one**; and the 1646-vs-1649 charter-loss conflict must never be
  presented as settled.
- **Bonnetmakers & Dyers (14): THIN → RICH.** The 1952 in-house history read in full: motto
  verified, all three charters verbatim, and a minute-book lore base (Helen Wylie, the capful of
  ale, the empty box of 1882, the 1809 refusal) that ends the craft's dependence on kin-guild
  colour. The Bold-pole flag is settled (Part 2.3 flag 4, revised). Kin lore (Stewarton sichters,
  wet caps, Dundee Lockit Book) stays labelled and is L8-banned from prompts anyway.

**The thinnest three NOW: Skinners (7), Fleshers (10), Gardeners (12) — all MEDIUM, in that
order:**

- **Skinners (7)** is the thinnest in the fleet: the definitive history (Lumsden 1937) is still
  an unreadable image-only scan, the essay and parts of the sensory world remain
  `[extrapolated]`, and no craft-specific demarcation case has ever been found.
- **Fleshers (10):** one rich but partisan spine (the Clerk's 1935 Note); no verified motto;
  blazon read from the Grand Hall carving, not the Register; early minute books destroyed after
  excerpting.
- **Gardeners (12):** much improved, but the narrative pp. 1–178 of the 1903 history — the
  craft's own account of the charter, the lands, the essay and the Foull Moor — is exactly the
  part still unread.

### 4.3 The Blake list — sources to supply, in priority order (re-ranked after the redive)

Like the Hammermen got (two full digitised craft histories), these would each transform a
dossier. Two of the original seven items are resolved: the Bonnetmakers 1597–1950 history has
been fetched and mined in full, and the blazon sweep has become a session task, not an
acquisition (see item 4).

1. **Gardeners** (unchanged #1, now sharpened): photograph *The History of the Incorporation of
   Gardeners of Glasgow: From 18th November 1626 to 1st September 1903* at Trades House
   shelf-mark **`338.6 GAR 1903`** (or the Mitchell) — specifically **pp. 1–178** (the narrative
   history), **p. 29** (the "Stallenger" footnote) and **p. 180** (the year-column that would
   date the three women on the earliest roll).
2. **Skinners:** Harry Lumsden, *History of the Skinners, Furriers and Glovers of Glasgow* (1937,
   xxiv+306pp) — the Trades House scan is image-only; needs OCR or a physical copy. Promoted:
   this now anchors the thinnest dossier in the fleet.
3. **Coopers:** Craig Mair, *The History of the Incorporation of Coopers of Glasgow* (2004/2013)
   — the redive went around it via the primary record, but it remains the standard modern
   history. Plus the Coopers' Patent of Arms: a facsimile is item 14 in the *Hammermen's* 1939
   relic-box inventory.
4. **Blazon sweep — now a session task, not an acquisition.** The Gardeners redive proved the
   Court of the Lord Lyon's *"The Incorporated Trades 1. Glasgow"* PDF extracts cleanly with
   `pypdf` (`pdftotext` yields garbage), and per that dossier it contains **every craft's blazon
   and grant date**. Re-run the `pypdf` extraction to close the remaining unverified blazons and
   mottoes — **Tailors (14 May 1924), Weavers (1922), Coopers (26 Jun 1924), Fleshers (25 Feb
   1924)**. *(Note: the Coopers dossier, redived the same day, still reports its blazon
   unrecovered — its heraldry search predates the `pypdf` method; reconcile next session.)*
5. **Bonnetmakers & Dyers** (largely done): the 1952 6th edition is now read in full. Remaining:
   the **7th edition (1597–1984, 109pp, GWSFHS, 1986)** for the unmined 1951–1984 chapters, and a
   formal blazon text — the 14 Jul 1924 registration is confirmed; only the wording is
   unpublished.
6. **Tailors:** the two >10MB PDFs at tradeshouselibrary.org (*Rights, Bye-Laws and Regulations*
   1938/39; *Excerpts from the Records* 1872) — charter texts and the 1924 arms.
7. **Cordiners:** Campbell's 1883 *History of the Incorporation of Cordiners* (>10MB at
   tradeshouselibrary.org) — the foundational Victorian history, currently cited only second-hand.

### 4.4 Standing cautions for the authoring session

- Every `[extrapolated]` tag in the dossiers survives into authoring: kin-guild lore (Stewarton,
  Dundee, Edinburgh, London) may inspire a scene's *structure* but must never be asserted as
  Glasgow fact in reveal copy.
- Craft-weight → axis-vector migration is a scoring-semantics change to client-supplied pinned
  content: **flag to Blake / the Trades House before implementation** (dossier 16 §15, Blake
  Clause).
- The quiz never explains an answer back to the reader (brief 17, L10); the per-seed value
  annotations in Part 1 are scoring metadata and writers'-room shorthand only.
