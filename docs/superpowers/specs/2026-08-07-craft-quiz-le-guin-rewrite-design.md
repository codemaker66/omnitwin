# The Craft Quiz, rewritten: Jung's arc in Le Guin's voice

**Date:** 2026-08-07
**Status:** shipped — see "The world channel" below (2026-08-16)
**Supersedes:** the Dostoyevsky×D&D brief at `docs/trades-house/craft-research/17-dostoyevsky-dnd-brief.md`

## Why

The shipped twelve scenes read as twelve unrelated dilemmas. They were written to
laws L1–L10 that governed each scene *in isolation*, and nothing governed the
set. The result is competent and inert: no arc, no accumulation, no reason
question seven follows question six. Blake's verdict was that they "look like
random questions rather than carefully planned and crafted", which is a fair
reading of what the brief actually asked for.

The sorting model is not the problem and does not change. What changes is
everything a visitor reads.

## Decisions taken

| Question | Decision |
| --- | --- |
| Voice | **Everything** in Le Guin's register. The Scots Convener is retired. |
| Setting | A nameless walled town in mythic time. The Trades House appears only at the reveal. |
| Scene length | 200–450 characters, so the phone still never scrolls. |
| TTS model | `eleven_multilingual_v2`, same voice (`wteyCP7td8C5nYwWnOV1`). |

Retiring the Scots is the costliest of these: it rewrites all 107 voice lines,
not merely the twelve scenes, and it discards a character Blake liked. It was
chosen deliberately over the alternative of an earthy teller reading a lyrical
tale.

## The frame

You arrive at a walled town as a stranger with a pair of hands and no place.
Twelve scenes span about a year. At the end they ask you to stay, and to help
decide who else may. Only then does the Trades House exist.

Two alternatives were rejected. An **anthology** of unconnected tales reproduces
the exact fault being fixed. A **single dilemma explored twelve ways** would
cohere, but it exhausts the reader and telegraphs the axes it measures.

## The Jungian spine is structural

The five hidden axes already correspond to real Jungian polarities. This was
discovered, not imposed:

| Axis | Polarity |
| --- | --- |
| a3 Bench ↔ Hearth | introversion / extraversion — Jung's own coinage |
| a1 Lasting ↔ Living | Senex / Puer |
| a4 Bold ↔ Steady | Hero / Guardian |
| a5 Make ↔ Keep | Prometheus / Hestia |
| a2 Perfection ↔ Provision | the perfectionist shadow / the Great Mother |

So the twelve scenes follow individuation in three acts: **Persona → Shadow →
Self**. The arc is part of the sorting instrument, not decoration on top of it.

## The twelve scenes

### Act I — The Persona (what you show)

| # | Scene | Source | Primary axes |
| --- | --- | --- | --- |
| 1 | The River Gate — you arrive; what did you carry in? | Baucis and Philemon, inverted: *you* are the stranger | a5 |
| 2 | The Low River — a child goes in; three people closer do not move | Darley and Batson's Samaritan study; the bystander effect | a4 |
| 3 | The Fence — a task set without a reason given | Chesterton's Fence | a2 |
| 4 | The Naming — what shall they call you here | Earthsea's true names; Rumpelstiltskin | a3 |

### Act II — The Shadow (what you deny, and what tempts)

| # | Scene | Source | Primary axes |
| --- | --- | --- | --- |
| 5 | The Other One — someone does your work worse and is loved for it | Cain and Abel; Salieri | a2, a4 |
| 6 | The Ring — you could take it and never be found out | Plato's Ring of Gyges | a5, a2 |
| 7 | The Thin Winter — not enough, and a pot in the square | Stone Soup; the Ant and the Grasshopper | a2, a1 |
| 8 | The Door You Were Told Of — one room, one instruction | Bluebeard; Pandora; Psyche's lamp | a4, a3 |

### Act III — The Self (what you are when it costs)

| # | Scene | Source | Primary axes |
| --- | --- | --- | --- |
| 9 | What the Town Is Built On — the prosperity rests on one hidden cruelty | **Omelas** — Le Guin's own | a1, a2 |
| 10 | The Apprentice — someone wants what you know | Prometheus; Daedalus; the Elves and the Shoemaker | a5, a3 |
| 11 | The Fire — what do you carry out | Aeneas bearing Anchises from Troy | a1 |
| 12 | The Wall — stay, and help decide who else may enter | **The Dispossessed**; Babel | a1, a5 |

Bookending Act III with two of Le Guin's own works is deliberate: Omelas at the
moral floor, the wall of Anarres at the close.

## Voice rules

- Anglo-Saxon over Latinate. "Began", not "commenced".
- Concrete weather, objects, bodies. Never an abstraction where a thing will do.
- Short declaratives, then one longer sentence that opens out.
- No adverb propping up a weak verb.
- Moral seriousness, zero moralising. She never tells you what to feel.
- The narrator knows more than they say.
- Second person, present tense.

## Constraints that do not move

Each of these is already enforced by a test, and each stays enforced.

1. **Five axes, fourteen craft directions** — `CRAFT_AXIS_PROFILES` is untouched.
2. **All fourteen crafts reachable** by some path through the twelve scenes.
3. **No within-scene collinearity above 0.70** between any two options.
4. **Pure respondents self-sort** — someone answering consistently along one axis
   must land on a craft that faces that way.
5. **Four options per scene**, differing in kind of good, each naming a real cost.
6. **No craft nouns** in scene or option text — the sorting must not be guessable.
7. **No verdicts.** The narrator never grades an answer.

`docs/trades-house/quiz-authoring/check-geometry.mjs` proves 2–4 before any prose
ships.

## What must be rewritten

| Corpus | Count | Note |
| --- | --- | --- |
| Scenes | 12 | new arc |
| Options | 48 | new, with new axis vectors |
| Reactions | 48 | one per option; must match the new option |
| Reveals | 14 | craft history stays true, register changes |
| Acknowledgements | 12 | |
| Pokes | 8 | |
| Idle murmurs | 3 | |
| Deliberation | 3 | |
| Observations | 5 | |
| Doze, wake | 2 | |

Roughly 15,000 characters of TTS against 24,072 remaining. It fits.

## Tests that must change

The register gate at
`src/features/trades-house/__tests__/craft-quiz-convener-script.test.ts`
currently enforces the *opposite* of the new direction: it bans plain-English
spellings in favour of Scots, and asserts every scene carries a Scots marker
from an allow-list. Both invert.

The replacement must enforce the Le Guin register and must be falsifiable rather
than decorative. Proposed: a small banned list of Latinate words that have short
equivalents (commence, utilise, endeavour, subsequently, purchase-as-verb), a cap
on sentence length so the prose stays plain, and a check that no scene opens with
an abstraction. The no-verdict, no-craft-noun and distinct-cost gates carry over
unchanged.

## Order of work

1. Draft twelve scenes and forty-eight options with axis vectors.
2. Run `check-geometry.mjs`; re-vector until reachability and collinearity pass.
3. Rewrite the remaining corpora in register.
4. Invert the register test; keep every other gate.
5. Regenerate audio (`--write`), then `--prune` the orphaned Scots lines.
6. Typecheck, lint, full suite, e2e, production build.
7. Ship, and verify live on phone and desktop.

## Risks

- **The reveals carry real history.** Fourteen craft reveals cite verifiable
  facts (the 1611 charter, the blawing of muttoun, the 1724 Deacon). Changing
  register must not change fact. Re-check each against the dossiers.
- **A nameless town versus a real client.** The Trades House of Glasgow is
  paying for this. The mythic frame is a deliberate bet that arriving at the real
  institution *after* twelve archetypal scenes hits harder than starting there.
  If it reads as evasive, the fix is Act III, not the whole arc.
- **Losing the Scots loses a differentiator.** The Convener's dialect was the
  most distinctive thing about the quiz. The new register must earn that back
  through quality of prose, or the change is a downgrade.

## The world channel (added 2026-08-16)

Shipped in `847fd6a9`. Blake's follow-on brief was that all fourteen Crafts must
have an equal chance, reached through answers a scholar would recognise as the
Craft's own tenets and a lay reader could guess at ("gardeners would all be about
nature, hammermen may be about metal and strength").

Measured first (`docs/trades-house/quiz-authoring/calibrate.mjs`, 40,000
respondents against the shipped model): the R3 sorting was a lottery. Consistent
respondents landed on Coopers 15.9% of the time and Gardeners 1.3% — a **12×**
spread — and each Craft's strongest answers said nothing a lay reader could
recognise. Two causes, both measured: the fourteen directions crowd
(Masons–Weavers 0.79, Hammermen–Tailors 0.77) and coverage is uneven (Gardeners
2 options, Coopers 10). Vector nudging alone stalls at 10/14.

**The change:** every option carries `world: CraftId` — the one Craft whose
material and moral world the answer lives in. Score = temperament cosine +
`WORLD_WEIGHT` (0.9, swept not guessed) × share of that Craft's homes chosen.
Normalised per Craft, so four homes are no advantage over three.

Invariants, each held by a test in `craft-quiz-reachability.test.ts`:
four DISTINCT worlds per scene; 3–4 homes per Craft; a home answer's temperament
vector within cos 0.55 of its Craft (the two channels may never contradict);
every home answer contains at least one word of its Craft's world-lexicon (lay
legibility — a test of the writing); no Craft NAMED anywhere; a seeded
20,000-respondent dice population keeps every Craft between 4% and 11%.

Allocation was solved, not eyeballed (`allocate-worlds.mjs`, hand-scored fit
matrix from the fourteen dossiers). Vectors were then tuned with bounded moves
only (`tune-r4.mjs`: ±1 steps, ≤2 from authored, dominant axis locked).

**Result** on the shipped model: dice 5.1–8.6% (was 2.0–17.0%); consistent
respondents 4.6–9.2% (was 1.3–15.9%); pure and world-pure respondents 14/14.

**Constraint update:** the old rule "no craft nouns" (L8) is now precisely "no
Craft *name*". Its world — iron, seed, bread, razor — may and must be shown.
