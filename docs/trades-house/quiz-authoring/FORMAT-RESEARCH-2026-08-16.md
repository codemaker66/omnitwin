# What format should the sorting take? — research and recommendation

**Date:** 2026-08-16 · **Status:** research; nothing here is built · **Asked by:** Blake — full autonomy to
propose anything from Likert sliders to "a completely revolutionary format unique to us".

## The one number that decides everything

Every format question reduces to: how much of a respondent's true Craft can the instrument recover, and
at what cost in attention? So before reading anyone else's opinion I measured ours. Simulated
respondents with a latent temperament in axis space; *truth* = the Craft their temperament points at;
they answer each scene by softmax over option similarity (τ=0.15 consistent, τ=0.5 noisy). All runs on
the shipped model (`847fd6a9`+).

| Answer format (12 scenes) | top‑1, consistent | top‑2 | top‑1, noisy | top‑2 |
|---|---|---|---|---|
| **pick one of four (current)** | **53.6%** | 77.7% | 36.5% | 58.9% |
| most *and* least of four | 56.1% | 78.7% | 39.7% | 62.9% |
| rank all four | 56.0% | 79.9% | 42.2% | 66.0% |
| tie‑break scene from the *same* pool | 52.6% | 76.6% | 41.1% | 61.2% |

Changing *how* people answer moves the needle by 2–6 points. It is not the lever.

| Pool / selection | items | top‑1, consistent | top‑2 |
|---|---|---|---|
| **the curated twelve, fixed** | 12 | **57.3%** | 79.1% |
| random twelve from a 24 pool (12 real + 12 synthetic) | 12 | 44.8% | 72.4% |
| random sixteen from that pool | 16 | 51.2% | 78.1% |
| adaptive (best discriminator each step) from that pool | 12 | 53.9% | 78.1% |
| adaptive | 14 | 57.0% | 79.8% |

More items and adaptive selection do **not** beat the curated twelve unless the pool holds sharper
scenes than the twelve — the twelve are already tuned past what random or synthetic scenes manage.

| Authored **deliberation** (one extra scene, only when top‑2 are close) | fires on | top‑1 | vs none |
|---|---|---|---|
| threshold 0.15 | 32% of respondents | 57.6% | +3.8 |
| threshold 0.25 | 56% | 61.4% | +5.8 |

And the ceiling: **~13% of respondents have no fact of the matter** — two Crafts within 0.03 on their
own temperament. No instrument can "get them right"; an honest one *says so*.

**Reading:** the answer format is near its ceiling for this geometry (14 classes in 5 axes, with the
crowded pairs measured earlier). What has headroom is (a) a scene written to split a close pair when it
matters, (b) keeping people *consistent* — the noisy row loses ~20 points, and noise is attention —
and (c) real data instead of my Gaussians.

## What the literature says (and how it maps)

- **Pottermore/Wizarding World**: 8 questions per sitting from a pool of 28; the first and last from
  restricted sets; every answer carries a probability vector across the four houses; a *hatstall*
  (inconclusive after seven) originally offered the player a choice between the tied houses, later
  removed. Openly gameable via published answer sheets. — Our current model is already the more
  rigorous cousin of this (48 answers × 5 axes + world, all reachable, measured fair). The hatstall
  is the interesting precedent: they let you *choose*; we can do better by *asking one more thing*.
- **16Personalities**: ~60 seven‑point Likert items, 10–12 minutes, five dimensions. — Likert buys its
  reliability with length we cannot afford and a register that kills the narrator.
- **Forced‑choice vs Likert (Cao & Drasgow meta‑analysis)**: forced‑choice pick format is the most
  faking‑resistant (d≈0.05) — more than most/least (d≈0.37) and single statements. — Our format is
  already the resistant one; and Blake has since chosen *legibility over gaming resistance*, so this
  matters less than it did.
- **Computerised adaptive testing**: 50–90% item savings at equal precision in the literature — but
  only when the pool contains items sharper than a fixed form. Our simulation confirms exactly that
  condition: adaptive from a pool of equals gains nothing.
- **Completion**: quiz completion medians ~60%; drop‑off accelerates past 7–8 minutes and past ~10–12
  items; 2–3‑item microsurveys clear 85%+. — Twelve narrated scenes at 30–40 s each is 6–8 minutes.
  We are at the edge. Any format change that adds minutes must pay for them.
- **Choice overload**: the meta‑analytic mean is ~zero with strong moderators (time pressure, attribute
  count, presentation). — Four options is not the problem; the phone's height is. Six per scene would
  not fit expanded bodies on a 667px phone at all.
- **Reigns (card‑swipe)**: the design lesson is not the swipe. It is that *once a few cards visibly
  remember earlier choices, every card feels authored.* — Directly applicable and cheap.

## Options considered

**A. Likert sliders.** Rejected. Needs ~60 items for reliability, kills the voice and the scene, invites
acquiescence and central‑tendency bias, and the format lever is worth ≤6 points anyway.

**B. More options per scene / more scenes.** Rejected as primary levers. Sim: rank‑all +2, most+least
+3; sixteen random scenes < twelve curated; length costs completion. Keep twelve, keep four.

**C. The Ledger (boldest, unique).** Give the visitor a small stock at the gate — five days, or coins —
and make the *cost line* literal: some answers spend more than others; across the year you must budget.
What someone is willing to *pay* for reveals values better than what they would pick for free
(willingness‑to‑pay beats stated preference). Genuinely novel; also turns a reading experience into a
resource game, adds a UI, and taxes older visitors and the phone. **Not recommended as the first move**;
worth a prototype later if the data shows noise is our real problem.

**D. The Deliberation (recommended, psychometric).** When the top two are close after twelve, the
Convener says so — and asks one more thing, written *for that pair*. Six authored pair‑breakers cover the
crowded pairs (Masons/Weavers, Hammermen/Tailors, Coopers/Skinners, Bakers/Maltmen, Barbers/Maltmen,
Cordiners/Bakers); a generic form covers the rest. Sim upper bound: +4–6 top‑1 on the third of visitors
it fires for, and it is the Sorting Hat's own best beat ("difficult… very difficult"). For the ~13% with
no fact of the matter, the reveal *says* it: "It hung between two. It chose the Weavers, and it was not
wrong about the Masons." Honest and more memorable than false certainty.

**E. The Town Remembers (recommended, experience).** Later scenes carry a clause that references an
earlier choice: if you carried the iron in at the gate, the fire in scene eleven names "the iron you
carried four hundred miles". Authored variants keyed on earlier *worlds* — the Reigns lesson. No model
change; the same twelve become 4^12 felt‑authored years.

**F. Your Year (recommended, share).** The result gains a twelve‑line ledger of the choices in Le Guin's
voice — "Came in with iron. Went straight in. Mended it better…" — plus the Craft. Every path is unique
(16.7 million of them); it is the shareable artefact, and it is what makes a second run mean something.

**G. Real data (recommended, foundation).** Anonymised path + result + time telemetry, no PII, so
calibration runs on humans instead of Gaussians. Nobody at this scale has that; it is the difference
between "measured fair in simulation" and "measured fair".

## Recommendation

Do not change the answering format. Change what surrounds it: **D + E + F**, with **G** underneath.
That is one authoring job (six pair‑breaker scenes and a set of remembering clauses), one small model
addition (a `deliberate(progress)` that returns the pair to split, or null), one result‑screen
component, and one privacy‑clean event log. It keeps every gate we have, adds the only psychometric
lever with headroom, and turns the format into something no other sorting quiz has: a year the town
remembers, a Convener who admits when it was close, and a ledger of you that is yours alone.

## Sources

- Pottermore mechanics: [Bookstacked — how the Pottermore quiz works](https://bookstacked.com/popular/jk-rowling/harry-potter/sorting-hat-quiz-pottermore-answers-questions-cheats/); [Pottermore Wiki — Hatstall](https://pottermore.fandom.com/wiki/Hatstall); [Pottermore Wiki — Sorting Quiz](https://pottermore.fandom.com/wiki/Sorting_Quiz)
- Forced‑choice vs Likert: [Cao & Drasgow, Does Forcing Reduce Faking? (meta‑analysis)](https://gwern.net/doc/psychology/personality/2019-cao.pdf); [Frontiers meta‑analysis of faking resistance](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.732241/full)
- Adaptive testing: [Gibbons et al., CAT to reduce assessment burden](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2916927/); [CAT for the 4DSQ, simulation](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5340924/)
- Completion and length: [Survicate completion benchmarks](https://survicate.com/reports/survey-completion-rate-benchmarks/); [Outgrow quiz engagement benchmarks](https://outgrow.co/blog/quiz-engagement-benchmarks-completion-rates); [Lensym drop‑off](https://lensym.com/blog/survey-completion-rates-drop-off)
- 16Personalities format: [16Personalities free test](https://www.16personalities.com/free-personality-test)
- Choice overload: [Scheibehenne, Greifeneder & Todd meta‑analysis](https://scheibehenne.com/ScheibehenneGreifenederTodd2010.pdf); [Chernev et al. review](https://chernev.com/wp-content/uploads/2017/02/ChoiceOverload_JCP_2015.pdf)
- Reigns: [Game Developer — adaptive narrative in Reigns](https://www.gamedeveloper.com/design/game-design-deep-dive-creating-an-adaptive-narrative-in-i-reigns-i-)
