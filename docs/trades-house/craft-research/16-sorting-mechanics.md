# Sorting Mechanics — scoring architecture for the 14-Craft quiz

**Status:** research dossier + design proposal (no production code changed).
**Consumed by:** future authoring sessions rewriting `packages/web/src/features/trades-house/craft-quiz-model.ts` and its tests.
**Companion dossiers:** `08-wrights.md`, `13-barbers.md` (per-craft identity research; the axis loadings below cite their Values/Shadow sections).

The brief: *"there is 14 crafts and we want this quizz to sort people into which craft they most belong to."* This document researches how the best-known sorting quiz in the world actually worked, what psychometrics says about measuring values without being gamed, and then proposes a scoring architecture for the Trades House quiz: a value-axis model, option-to-axis mapping, reachability guarantees compatible with the existing exhaustive test, an adaptive tie-breaker, and a live validation program. Every number in the worked examples was computed by exhaustive simulation (4⁹ = 262,144 paths), not estimated.

---

## Part I — Research

### 1. How the Pottermore / Wizarding World Sorting quiz actually worked

The canonical reference point. Datamining and statistical reconstruction established the mechanics:

- **Question pool with per-run sampling.** Each run asks **8 questions drawn from a pool of 28**: the first and last questions are drawn from dedicated pools of three, and the middle six are drawn at random from the remaining 22 ([Bookstacked — How to game Pottermore's official Sorting Hat quiz](https://bookstacked.com/popular/jk-rowling/harry-potter/sorting-hat-quiz-pottermore-answers-questions-cheats/); [Pottermore Wiki — Sorting Quiz](https://pottermore.fandom.com/wiki/Sorting_Quiz)).
- **Hidden multi-factor weights.** Every answer option carries a hidden weight toward **all four houses simultaneously** (percentage marks per house), assigned by Rowling and the Pottermore team; some questions carry secondary weightings, others are single-loaded. The mapping was reverse-engineered first statistically — from 2,600+ recorded sortings by the *Pottermore Analysis* Tumblr ([pottermoreanalysis — quick-and-dirty Sorting Hat guide](https://www.tumblr.com/pottermoreanalysis/35873379539/as-promised-a-quick-and-dirty-sorting-hat-guide)) — and later exactly, via datamined spreadsheets (the "N1ffler" datasets) covering all 28 questions ([Bookstacked](https://bookstacked.com/popular/jk-rowling/harry-potter/sorting-hat-quiz-pottermore-answers-questions-cheats/)).
- **Tie handling.** The original quiz included a direct **house-preference question served only on a near-tie** (a "hatstall" — canonically, a sorting in which the Hat deliberates over five minutes and "sometimes took the student's personal preference into consideration in order to break such a tie"; McGonagall and Flitwick were both hatstalls). The explicit preference question was removed in later versions ([Wizarding World — Hatstall, by J.K. Rowling](https://www.harrypotter.com/writing-by-jk-rowling/hatstall); [Pottermore Wiki — Sorting Quiz](https://pottermore.fandom.com/wiki/Sorting_Quiz)).
- **The gameability lesson.** Once the weights leaked, gaming became a lookup: "select the answer that has the highest percentage mark associated with your desired house" ([Bookstacked](https://bookstacked.com/popular/jk-rowling/harry-potter/sorting-hat-quiz-pottermore-answers-questions-cheats/)). Three structural defenses delayed this for years and are worth stealing: **(a)** weights were hidden and multi-house, so no option read as "the Slytherin answer"; **(b)** per-run question sampling meant a cheat sheet had to cover the whole pool; **(c)** answers loaded houses *asymmetrically* — an option's flavor did not announce its strongest house. What ultimately failed was shipping the mapping to the client. Any client-side mapping is eventually mined; the design goal is therefore *resistance to casual steering*, not cryptographic secrecy (see §9 threat model).

Remarkably, the quiz measures something real. Two independent studies validated it: self-sorted Pottermore house membership correlates with Big Five and Dark Triad measures in the direction the books predict (n = 236 fans; Slytherins higher on Dark Triad) ([Crysel et al. 2015, *Personality and Individual Differences* — "Harry Potter and the measures of personality"](https://www.sciencedirect.com/science/article/abs/pii/S0191886915002615)), and a registered study relating quiz assignment to the Big Five *and Schwartz human values* found convergent validity — e.g. self-transcendence values predicting Hufflepuff, self-enhancement predicting Slytherin ([Jakob et al. 2019, *Collabra: Psychology* — "The Science Behind the Magic?"](https://online.ucpress.edu/collabra/article/5/1/31/113037/The-Science-Behind-the-Magic-The-Relation-of-the); [PDF](https://pure.uva.nl/ws/files/51367811/240_3358_1_PB.pdf)). A well-built entertainment sorter is a crude but genuine values instrument. That is the bar for ours.

### 2. Value models: what latent space should a 14-way sorter score?

**Schwartz's basic values circumplex** is the strongest foundation. Values are trans-situational goals organized on a **circular motivational continuum** along two bipolar axes — *openness to change ↔ conservation* and *self-enhancement ↔ self-transcendence* — with adjacent values compatible and opposing values in conflict ([i2insights — Understanding values: Schwartz theory of basic values](https://i2insights.org/2022/05/10/schwartz-theory-of-basic-values/)). The refined theory partitions the same circle into 19 values, validated by CFA across 15 samples in 10 countries (N = 6,059) ([Schwartz et al. 2012, *JPSP* — "Refining the theory of basic individual values"](https://pubmed.ncbi.nlm.nih.gov/22823292/); [PDF](https://library.scottbarrykaufman.com/uploads/2017/09/Schwartz-2012-19-values-JPSP.pdf)). Two properties matter for quiz design:

1. **Bipolarity.** Every value has a motivational opposite. A question posing tradition against stimulation is a genuine trade-off, not a "pick the nice one" item.
2. **Circular adjacency.** Similar identities sit close together; a sorter's hard cases are between *neighbors*, which tells us in advance where tie-breakers will be needed.

**Holland's RIASEC hexagon** is the second pillar, because the 14 Crafts are *occupational* identities, not just value profiles. Holland arranges six vocational interest types (Realistic, Investigative, Artistic, Social, Enterprising, Conventional) on a circumplex where adjacent types correlate positively and opposite types negatively (e.g. Realistic vs Social) — the model underlying the U.S. O*NET occupation database ([Wikipedia — Holland Codes](https://en.wikipedia.org/wiki/Holland_Codes)). The Realistic↔Social contrast (things vs people) separates crafts the Schwartz axes cannot: a Hammerman and a Maltman may share values and differ entirely in where their energy lives.

**Big Five facets** (30 facets under 5 domains in the NEO tradition) are the wrong *primary* frame for a sorter: trait language is descriptive and partly evaluative (nobody wants to be told they scored low on everything), whereas value/interest language lets all 14 outcomes flatter. But the facet lesson carries: broad domains hide the distinctions that matter — the discriminating information is one level down. Our equivalent: axes must be chosen so that crafts sharing a guild-family (the three building crafts; the three provisioning crafts) still separate on at least one axis. The Jakob et al. study demonstrates that both trait and value measures pick up sorter outcomes ([Collabra 2019](https://online.ucpress.edu/collabra/article/5/1/31/113037/The-Science-Behind-the-Magic-The-Relation-of-the)).

### 3. Forced choice, ipsativity, and social desirability

Rating-scale (Likert) personality items are trivially inflatable: respondents endorse whatever sounds best. The classical countermeasure is **multidimensional forced choice (MFC)**: present options of *matched social desirability*, each loading a different dimension, and force one pick — every answer buys one dimension at the price of the others ([Frontiers 2017 — Integration of the Forced-Choice Questionnaire and the Likert Scale](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.00806/full)). Key findings:

- A meta-analysis of 52 documents / 82 samples / N = 106,266 found forced-choice inventories meaningfully more faking-resistant than single-stimulus measures, with **quasi-ipsative formats most resistant** (faking effect on conscientiousness δ ≈ 0.49, vs δ ≈ 1.27 for purely ipsative formats and larger still for Likert) ([Martínez & Salgado 2021, *Frontiers in Psychology* — meta-analysis of FC faking resistance](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.732241/full)).
- Forced choice is not magic: a Thurstonian-IRT-scored MFC character measure showed good validity but *no more* faking resistance than its Likert twin ([Walton et al. 2020, *Journal of Personality Assessment*](https://pubmed.ncbi.nlm.nih.gov/32208939/)). The resistance comes from **desirability matching within blocks**, not from the format alone — blocks must pair options that are equally attractive ([Frontiers 2017](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.00806/full)).
- Classical ipsative scoring makes scores incomparable between people; **Thurstonian IRT** recovers normative trait estimates from forced-choice responses ([development example: PMC11673971](https://pmc.ncbi.nlm.nih.gov/articles/PMC11673971/)). Our quiz only ranks crafts *within* one respondent, so pure ipsative scoring is fine — the between-person comparability problem that motivates Thurstonian IRT does not apply. This is a genuine free lunch for sorting quizzes.

The existing Trades House quiz already has the right *surface*: every option is flattering ("the finest table", "built to last"). What it lacks is the *structure* — options map 1:1 onto named crafts, so the desirability matching protects nothing (§5).

### 4. Adaptive tie-breaking

Computerized adaptive testing selects the next item to be maximally informative about the current uncertainty — classically maximum Fisher information at the ability estimate ([Components of the item selection algorithm in CAT, PMC5968224](https://pmc.ncbi.nlm.nih.gov/articles/PMC5968224/)). For *classification* (which category, not what score), **mutual information item selection** outperforms in the multi-category setting ([Weissman 2007, *Educational and Psychological Measurement* — Mutual Information Item Selection in Adaptive Classification Testing](https://journals.sagepub.com/doi/10.1177/0013164406288164)); adaptive item selection has also been worked out for Thurstonian-IRT forced-choice pools ([Lin et al., item selection for MFC CAT](https://www.researchgate.net/publication/368341666_Item_selection_methods_in_multidimensional_computerized_adaptive_testing_for_forced-choice_items_using_Thurstonian_IRT_model)). For a nine-question leisure quiz we need exactly one adaptive step: **when the top two crafts are within a margin, ask one more question chosen to maximally separate that specific pair.** That is the same logic reduced to a single decision — and Pottermore's hatstall canon ("personal preference" as tie-break, [Wizarding World](https://www.harrypotter.com/writing-by-jk-rowling/hatstall)) gives it in-world precedent the Convener can voice.

---

## Part II — Diagnosis of the shipped quiz

Current implementation (`craft-quiz-model.ts`): 9 fixed questions × 4 options; each option carries **direct craft weights** 1–3; winner = highest total, ties broken by last-answer weight, then by fixed `CRAFT_ORDER` position. The exhaustive test (`__tests__/craft-quiz-reachability.test.ts`) enumerates all 262,144 answer paths and *pins* the pathology rather than blessing it:

| Defect | Evidence (from the pinned test) |
|---|---|
| **Starvation** | Coopers win < 0.1% of paths, Skinners < 2%; the census pin records most/least = 55,265/168 — a **329:1 spread**. |
| **No signature answers** | Coopers and Skinners have *no option anywhere* that weights them strictly above every rival — they can only draw level, then lose the tie-break. |
| **Gameable by inspection** | Options are legibly named for their crafts ("THE BROKEN MECHANISM" → hammermen; "RAISE THE TOAST" → maltmen 3, sole loading). Steering toward any non-starved craft requires no datamining at all. |
| **Biased tie-break** | Last-answer weight, then array position: `CRAFT_ORDER` seniority silently favors hammermen over barbers in exact ties. |

Root cause of all four: **options vote for crafts directly.** A craft that is never anyone's single loudest vote (Coopers — always co-billed with wrights/masons; Skinners — always behind cordiners/tailors) is unreachable *by construction*, no matter how the weights are tuned. The weights are pinned as client-supplied content (`docs/operations/trades-house-leaflet-source-2026-07-10.md`), so any change to scoring semantics must be re-blessed deliberately — see §15.

---

## Part III — Proposal

### 5. The value-axis model: five bipolar axes

Score a latent value space, not crafts. Each **option** moves the respondent along axes; each **craft** is a fixed direction in the same space; the sorter awards the craft whose direction best matches where the respondent ended up. Five bipolar axes, each grounded in a psychometric contrast and named in House vocabulary:

| Axis | Poles (+ / −) | Psychometric ancestry | The question it asks |
|---|---|---|---|
| **A1 — the Stone and the Leaf** | Lasting ↔ Living | Schwartz conservation ↔ openness/growth ([Schwartz 2012](https://pubmed.ncbi.nlm.nih.gov/22823292/)) | Is good work what *outlasts* you, or what *renews*? |
| **A2 — the Rule and the Loaf** | Perfection ↔ Provision | Schwartz achievement ↔ benevolence | Does the work serve the standard, or the fed and equipped? |
| **A3 — the Bench and the Hearth** | Bench ↔ Hearth | Holland Realistic ↔ Social ([Holland Codes](https://en.wikipedia.org/wiki/Holland_Codes)) | Is your energy with the material, or among the people? |
| **A4 — the Spark and the Loom** | Bold ↔ Steady | Schwartz stimulation/self-direction ↔ security/tradition | Strike and show, or slow work and lasting worth? |
| **A5 — the Chisel and the Key** | Make ↔ Keep | creation ↔ stewardship (guardianship values; cf. the Wrights' "proof by work" vs the Skinners' "guard what has been entrusted") | Bring the new into being, or hold the entrusted safe? |

Why five: with 9–10 forced-choice questions delivering ~2 bits each, five axes is the most the instrument can estimate; and five is the fewest that separates all 14 crafts (four collapses Coopers into Masons and Barbers into Maltmen — verified during profile fitting). A1 and A4 are *not* collinear across this fleet: Gardeners are Living+Steady, Hammermen Lasting+Bold, Dyers Living+Bold, Masons Lasting+Steady — all four quadrants are occupied.

**Crucially, the two starved crafts each own a pole.** Coopers and Skinners starve today because they are never anyone's loudest vote; in axis space they are the two great *Keepers* (A5−), split by A3: the Cooper guards contents under pressure at the bench ("HOLD FAST. LET NOTHING PRECIOUS LEAK AWAY"), the Skinner guards persons and their trust ("GUARD WHAT HAS BEEN ENTRUSTED"). Give a craft a pole and the geometry, not the tie-break, makes it reachable.

### 6. Craft profiles (seed v0.2)

Integer loadings −3..+3 per axis `[A1, A2, A3, A4, A5]`; each row cites the identity source (mottoes/archetypes from `CRAFT_PROFILES`, values from the craft dossiers).

| Craft | Profile | Reading |
|---|---|---|
| Hammermen | `[+2, +3, +2, +2, +1]` | Precision religion at the forge; "measured twice, struck once"; force becomes intelligence. |
| Wrights | `[+2, +1, +1, 0, +3]` | **Make pole.** "Give good ideas a body"; proof by work, the essay from rough wood (`08-wrights.md` Values 2). |
| Masons | `[+3, +1, +1, −2, +1]` | **Lasting pole.** "Build for those not yet here"; patient, public. |
| Coopers | `[+2, +2, +2, −1, −3]` | **Keep pole, bench side.** Exact honest work that holds precious things safe under pressure. |
| Tailors | `[0, +3, 0, +1, +1]` | **Perfection pole.** The perfect fit; poise and proportion; nothing careless. |
| Weavers | `[+1, +1, +1, −3, 0]` | **Steady pole.** Pattern, patience, threads in tension; strengthen the whole. |
| Dyers | `[−2, +1, −1, +3, +2]` | **Bold pole.** "Show the true colour"; flair, renewal, creative courage. |
| Skinners | `[+1, +1, −1, −2, −3]` | **Keep pole, hearth side.** Keeper of trust; protective, steady, principled. |
| Cordiners | `[+1, −2, +1, −1, −1]` | Provision-of-readiness at the bench; "no one goes unprepared"; skill passed hand to hand. |
| Bakers | `[−1, −3, −1, 0, +1]` | **Provision pole.** "No one is useful hungry"; care practical before poetic. |
| Fleshers | `[0, −2, 0, +2, 0]` | Provision with boldness: the plain dealer, blunt, market-quick. |
| Maltmen | `[−1, −2, −3, −1, 0]` | **Hearth pole.** The fermenter-host; fellowship; "let time do its noble work." |
| Gardeners | `[−3, 0, +1, −2, +1]` | **Living pole.** Growth as real work; patient, hopeful, hands in earth. |
| Barbers | `[−2, +1, −2, −1, −1]` | Renewal *of persons* with a steady gentle hand; care, composure, trust at the bared throat ("In the Presence of God", `13-barbers.md`). |

Design laws for this table (enforced by test, §10): every craft is within the top-2 magnitudes on at least one axis *or* occupies a unique quadrant combination; no two profiles exceed cosine 0.85 (v0.2 max pairwise cosine < 0.80, verified by simulation).

### 7. Options map to axis vectors — scoring

Each option carries a delta vector, not craft weights:

```ts
interface CraftQuizOption {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly axes: Readonly<Partial<Record<AxisId, number>>>; // e.g. { lasting: +2, bench: +1 }
  readonly convenerLine: string;
}
```

Scoring:

1. Accumulate `u = Σ Δ(option chosen)` over the run (all respondents see the same 9 questions, so raw sums are comparable; if per-run question sampling is ever added, per-axis normalization by the asked questions' total |Δ| capacity becomes mandatory).
2. Rank crafts by **cosine similarity** `cos(u, p_c)`. Cosine, not dot product: profiles are effectively unit directions (normalize by `|p_c|`), so no craft wins by having a louder profile; and respondents who answer "intensely" are not pushed toward large-magnitude crafts — only *direction* matters.
3. **Faint-signal rule:** if `|u| < τ` (seed τ = 3), treat the result as a hatstall regardless of margin. Cosine on near-zero vectors is noise: the simulation's global-maximum coopers path (cos 0.944) is a narratively incoherent zig-zag with `|u| ≈ 3.2` — exactly the artifact this rule quarantines. (7 of 262,144 paths produce `u = 0` exactly; they go to the hatstall protocol too.)
4. Ties inside the hatstall margin go to the adaptive question (§11); the *final* deterministic fallback is the 1777 Grand Decerniture order of precedence (the Court of Session ranking the House still uses, `08-wrights.md`) — lore-true, stable, and instrumented so we know if it ever actually fires.

Question authoring rules (the forced-choice discipline from §3):

- **Equal desirability within a question:** all four options must remain flattering — each is the best face of a different pole. The existing copy already achieves this; keep it.
- **Question-level axis balance:** per axis, the four options' deltas should roughly cancel (`|Σ_options Δ_a| ≤ 2`), so no question globally inflates one pole no matter what is picked.
- **Coverage:** each axis must be loaded by options in at least 4 of 9 questions, both poles reachable.

### 8. Re-expressing an existing question (worked example)

Q8 "Tradition, to you, is…" — same text, same convener lines, weights → vectors:

| Option | Old craft weights | New axis vector | Now serves |
|---|---|---|---|
| A STANDARD, to uphold exactly | masons 1, hammermen 1, coopers 1 | `{A1:+1, A2:+1, A3:+1, A4:−1, A5:−2}` | the Coopers' signature: lasting + exact + *kept* |
| A PATTERN, to reweave for today | weavers 1, dyers 2, tailors 1 | `{A1:−1, A4:+2, A5:+1}` | renewal + daring: dyers' country |
| A TABLE, with room for everyone | maltmen 1, bakers 1, fleshers 1, barbers 1 | `{A2:−1, A3:−2}` | hearth + provision |
| A SKILL, passed hand to hand | cordiners 2, skinners 1, wrights 1, gardeners 1 | `{A1:+1, A5:−2}` | stewardship of the craft itself |

Note what changed: "A STANDARD" no longer *names* three crafts and drops the coopers into a three-way split it can't win — it now points into a region of the space where the Coopers' direction is the nearest, which is checkable (§10).

### 9. Why this resists gaming — and the honest threat model

- **No option is legible as "the X answer."** The same vector serves several crafts depending on what else was picked; the winner emerges from a *pattern*, not a vote. To steer, a player must know the 14 profiles, the option vectors, and solve an argmax-over-cosines — versus today, where the option titles are the cheat sheet.
- **Bipolar axes make every pick a trade-off** (the quasi-ipsative property that carries the faking resistance in the meta-analytic evidence, [Martínez & Salgado 2021](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.732241/full)): buying Bold sells Steady. There is no "socially optimal" answer path because all poles are flattering by authoring rule.
- **Threat model, stated plainly:** the vectors ship to the browser; a determined miner recovers them, exactly as N1ffler mined Pottermore ([Bookstacked](https://bookstacked.com/popular/jk-rowling/harry-potter/sorting-hat-quiz-pottermore-answers-questions-cheats/)). The defense target is *casual steering* (a visitor picking "the coopers answers" by eye), not adversarial datamining. If the latter ever matters (prize draws), move scoring server-side behind the existing API; the architecture is transport-agnostic. Also note the Walton et al. caveat: forced-choice structure without desirability matching protects nothing ([JPA 2020](https://pubmed.ncbi.nlm.nih.gov/32208939/)) — the copy review in §14 is part of the security posture, not polish.

### 10. Reachability by construction — evolving the existing test

The current test's two ideas — exhaustive path census and the "signature answer" diagnostic — survive intact; they just operate on vectors:

1. **Census (kept):** enumerate all 4⁹ paths through the real scorer; assert every craft wins at least one path. 262,144 paths × 14 cosines runs in seconds; a 12-question future (4¹² ≈ 16.8M) is still enumerable.
2. **Balance band (new):** assert min census share ≥ 2% and max/min ≤ 12. The census weights all paths equally — it is an engineering floor, not a prediction of live shares (humans cluster) — but it bounds structural starvation. Today's 329:1 becomes a hard red line.
3. **Signature option (generalized):** for every craft, some option's delta must cosine-rank that craft strictly first among all 14 (`cos(Δ, p_c) > cos(Δ, p_r)` for all rivals). This is the vector form of `craftsWithoutASignatureAnswer()` — but as a *content law*, not a pinned pathology.
4. **Profile separation (new):** no pairwise profile cosine above 0.85.
5. **Question balance (new):** per question, per axis, `|Σ Δ| ≤ 2`.
6. **Pinned census snapshot (kept):** pin the share table like today's most/least pin, so any content edit fails tests and must be re-blessed deliberately.

### 11. Near-ties and the adaptive final question — the Hatstall protocol

After Q9, with ranked similarities `s₁ ≥ s₂ ≥ …`:

- **Trigger:** `s₁ − s₂ < ε` (seed ε = 0.02, giving a ~10% hatstall rate in the v0.2 census — tune live to hit 5–10%), or `|u| < τ` (faint signal).
- **Item selection:** for the tied pair `(c₁, c₂)`, the discriminating axis is `a* = argmax_a |p_{c₁}[a] − p_{c₂}[a]|` (after profile normalization). Serve the tie-breaker question for `a*`. This is single-step maximum-information selection — the CAT principle ([PMC5968224](https://pmc.ncbi.nlm.nih.gov/articles/PMC5968224/)) collapsed to one decision, in the multi-category classification spirit of mutual-information selection ([Weissman 2007](https://journals.sagepub.com/doi/10.1177/0013164406288164)).
- **The bank: five questions, one per axis, two options each.** Not 91 pair-specific questions — C(14,2) is unauthorable and unnecessary, since a pair's difference always projects most on one axis. Two options, both flattering, stark on exactly one axis (Δ = ±3 on `a*`, 0 elsewhere). The Convener leans in: *"The Chain cannae decide — so answer me this ONE mair…"* — Pottermore's removed preference question, rebuilt as an in-world dilemma instead of a menu ([Wizarding World — Hatstall](https://www.harrypotter.com/writing-by-jk-rowling/hatstall)).
- **Resolution:** add the tie-breaker's Δ to `u`, re-rank the *tied pair only* (the others' standings are frozen — the extra question must not flip an untied third craft into the lead).
- **Fallback chain:** still tied (both profiles equal on `a*` — impossible for any pair under the v0.2 table, asserted by test) → 1777 order of precedence, with a telemetry counter expected to read ~0.

The census says which tie-breakers matter most: the top near-tie pairs at ε = 0.02 are bakers+maltmen (A3 discriminates), barbers+skinners (A1), **coopers+skinners (A3)**, barbers+maltmen (A2). The two formerly starved crafts meet each other at the boundary — exactly where the old design silently killed the Coopers, the new one asks one more question.

### 12. Simulation: seed content, census results, and the tuning loop

The nine existing questions were re-expressed as axis vectors (v0.1), censused exhaustively, tuned once (v0.2: four option-vector edits — workbench +Make, fresh-trim retargeted at barbers, toast softened, "a standard" made the coopers signature), and re-censused. Real numbers:

| Metric | Shipped quiz | v0.1 seed | v0.2 seed |
|---|---|---|---|
| Unreachable crafts | 0 (but 2 below 2%) | 0 | 0 |
| Min share | coopers 0.06% | wrights 1.24% | wrights 1.64% |
| Max share | 21.1% | maltmen 17.9% | maltmen 15.4% |
| Max/min ratio | **329** | 14.4 | **9.4** |
| Crafts lacking a signature option | coopers, skinners | coopers, barbers | **none** |
| Near-tie rate (margin < 0.02) | n/a (integer ties) | 10.0% | 10.3% |
| Coopers share | 0.06% | 6.7% | **8.8%** |
| Skinners share | <2% | 12.3% | 13.2% |

v0.2 still fails the §10 balance band (wrights 1.64% < 2%) — deliberately left in this dossier as the open item, because the *loop* is the deliverable: **edit vectors → run census → read the three gates (reachability, band, signatures) → re-bless the pin.** Tuning is a test-driven activity with a seconds-long feedback cycle, not a taste exercise. (Wrights are thin because Make-pole options are scarce; the fix is one more A5+ loading in Q5 or Q9, next iteration.)

### 13. Worked examples (all values computed, not invented)

**A. A clear sort.** Picks: Q1 mechanism, Q2 workbench, Q3 built-to-last, Q4 staircase, Q5 raise-the-hall, Q6 patience, Q7 oak&stone, Q8 a-skill, Q9 workshop. Accumulated `u = [12, 2, 7, −2, 2]` — heavily Lasting and Bench, slightly Steady. Ranking: **masons 0.890**, wrights 0.703, hammermen 0.625. Margin 0.187 ≫ ε: the Chain grows heavy with stone, no hatstall.

**B. The Cooper exists now.** A respondent who keeps things: Q1 cracked boots, Q2 workbench, Q3 perfect fit, Q4 staircase, Q5 raise-the-hall, Q6 care, Q7 oak&stone, Q8 a-standard, Q9 workshop. `u = [8, 2, 6, −4, −3]` — Lasting, Bench, Steady, *Keep*. Ranking: **coopers 0.845**, masons 0.814, weavers 0.712. Under the shipped scorer this person cannot reach Coopers at all (no path with these leanings does); under v0.2 the Keep component (boots, care, a-standard) pulls them past the Masons.

**C. A hatstall, resolved.** Picks: Q1 mechanism, Q2 workbench, Q3 built-to-last, Q4 staircase, Q5 raise-the-toast, Q6 care, Q7 grain&green, Q8 a-standard, Q9 trimmed&tailored. `u = [5, 1, −1, 0, −3]`. Ranking: coopers 0.6751, skinners 0.6667 — margin 0.0084 < ε. Discriminating axis for (coopers, skinners): profile difference `[1, 1, 3, 1, 0]` → **A3, the Bench and the Hearth**. The Convener leans in with the A3 tie-breaker (workshop-at-dusk vs the-room-where-everyone-is); Bench (+3 on A3) re-ranks the pair to coopers, Hearth to skinners. One question, aimed exactly at the seam — instead of a silent array-order coin flip.

### 14. Live validation of question discrimination

Once real traffic flows, the census stops being the only evidence. Instrument (client events → existing API analytics path):

- **Per-option pick rates.** An option below ~5% pick rate is dead copy; an option above ~60% within its question breaks the desirability-matching assumption that carries the anti-gaming property (§3) — rewrite it, don't reweight it.
- **Option discrimination.** For each option: mutual information between "picked it" and final craft, and the correlation between the option's Δ projection and the respondent's final `u` *excluding that question* — the sorter's analog of corrected item-total / point-biserial discrimination. Classical thresholds transfer: below ~0.10 is a flag, 0.30+ is healthy ([University of Washington — ScorePak item analysis](https://www.washington.edu/assessment/scanning-scoring/scoring/reports/item-analysis/)).
- **Jackknife question influence.** Re-score every completed run with each question deleted; a question whose deletion changes < 1% of assignments is dead weight — replace it with one loading the axes that need coverage.
- **Distribution bands.** Live per-craft assignment shares, with alerting outside [2%, 25%]; hatstall rate held to 5–10% by tuning ε; fallback-chain counter expected at 0.
- **Retest agreement.** Repeat takers (same device) should land the same craft ≥ 70% of the time; the Pottermore validation literature shows even entertainment sorters can hold convergent validity ([Jakob et al. 2019](https://online.ucpress.edu/collabra/article/5/1/31/113037/The-Science-Behind-the-Magic-The-Relation-of-the)) — retest stability is the cheap proxy we can measure without a values inventory.
- **Shadow rollout.** Run the vector scorer silently alongside the shipped scorer on live traffic first; compare assignment distributions and near-tie rates against the census predictions before the switch.

### 15. Migration notes (Blake Clause)

- The current craft weights are **client-supplied content** pinned by `docs/operations/trades-house-leaflet-source-2026-07-10.md` and characterized (not blessed) by the reachability test. Replacing craft-weights with axis vectors changes scoring semantics for supplied content: **flag to Blake / the Trades House before implementation**, per the pinned-test comment's own protocol. The question text, option titles, icons, and Convener lines all survive unchanged — only the hidden numbers move.
- `rankCrafts`'s `lastAnswerWeight` tie-break and the `CRAFT_ORDER`-position fallback are replaced by the Hatstall protocol (§11); `CraftRankingEntry` gains `similarity` and `margin` fields (the reveal screen can then honestly say *how* decisively the Chain chose — and the near-tie case is a feature, voiced by the Convener, not a bug to hide).
- The five tie-breaker questions are net-new content requiring the same voice pass as the existing 36 options (Convener rules in `convener/convener-lines.ts`).

---

## Question seeds — tie-breaker bank candidates (one per axis)

Dilemmas in the dossier tradition (cf. `13-barbers.md` §Question Seeds): both horns flattering, stark on one axis, rooted in the crafts' real record.

1. **A1, the Stone and the Leaf.** The Hall grants you one legacy: your name cut into the stair that four centuries of boots will hollow but never erase — or the orchard you planted bearing fruit for strangers every autumn, your name on none of it. *(Stone = Lasting +3; orchard = Living −3. Rooted in the Masons' worn steps and the Gardeners' "growing doesnae stop at doors.")*
2. **A2, the Rule and the Loaf.** Fire in the Candleriggs, like 1652. You can save the essay-piece — the perfect window that proves what your hands can do — or the sack of meal that feeds the close till Lammas. The flames will take the other. *(Essay = Perfection +3; meal = Provision −3. Rooted in the Wrights' essay "from rough wood in the Essay Room" and the dearth of 1741 when the Barbers bought their own grain.)*
3. **A3, the Bench and the Hearth.** Your perfect evening at the Hall: the workshop after everyone has gone, one lamp, the work that will not let you go — or the Grand Hall at full roar, every glass filled, and you the reason strangers are laughing together. *(Bench +3 / Hearth −3. Rooted in "till dusk, lost in the work" and the Maltmen's arithmetic.)*
4. **A4, the Spark and the Loom.** The Deacon offers you the banner commission: dye it a colour Glasgow has never seen and be argued about by Monday — or weave it so true it hangs for a hundred years before anyone thinks to ask who made it. *(Bold +3 / Steady −3. Rooted in the Dyers' "show the true colour" and the silk that "remembers what the minute-books forget.")*
5. **A5, the Chisel and the Key.** The Master Court trusts you with one office: Essay Master, who judges what new hands bring into the world — or Gowdie, Keeper of the Gold, one of the four keys no cheat can pass, guarding the box you may never show anyone. *(Make +3 / Keep −3. Rooted in the Wrights' four-keyed Essay House and the Deacon's Box with its Big Key and Wee Key.)*
6. **The Hatstall itself (reserve, any pair).** The Chain hangs silent between two Crafts. The Convener asks the only question left: which loss would you feel in your hands for the rest of your life — never again to [c₁'s work], or never again to [c₂'s work]? *(Direct preference as last resort — the Sorting Hat's own canon tie-break, [Wizarding World](https://www.harrypotter.com/writing-by-jk-rowling/hatstall) — templated per pair from the CRAFT_PROFILES essences, served only if the axis question somehow returns equal.)*

---

## Sources

**Sorting-quiz mechanics and validation:** [Bookstacked — gaming the Sorting Hat quiz](https://bookstacked.com/popular/jk-rowling/harry-potter/sorting-hat-quiz-pottermore-answers-questions-cheats/) · [Pottermore Analysis (Tumblr)](https://www.tumblr.com/pottermoreanalysis/35873379539/as-promised-a-quick-and-dirty-sorting-hat-guide) · [Pottermore Wiki — Sorting Quiz](https://pottermore.fandom.com/wiki/Sorting_Quiz) · [Wizarding World — Hatstall (Rowling)](https://www.harrypotter.com/writing-by-jk-rowling/hatstall) · [Crysel et al. 2015, PAID](https://www.sciencedirect.com/science/article/abs/pii/S0191886915002615) · [Jakob et al. 2019, Collabra](https://online.ucpress.edu/collabra/article/5/1/31/113037/The-Science-Behind-the-Magic-The-Relation-of-the) ([PDF](https://pure.uva.nl/ws/files/51367811/240_3358_1_PB.pdf))

**Value models:** [i2insights — Schwartz theory of basic values](https://i2insights.org/2022/05/10/schwartz-theory-of-basic-values/) · [Schwartz et al. 2012, JPSP (PubMed)](https://pubmed.ncbi.nlm.nih.gov/22823292/) ([PDF](https://library.scottbarrykaufman.com/uploads/2017/09/Schwartz-2012-19-values-JPSP.pdf)) · [Holland Codes (Wikipedia)](https://en.wikipedia.org/wiki/Holland_Codes)

**Forced choice / faking:** [Martínez & Salgado 2021, Frontiers meta-analysis](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.732241/full) · [Walton et al. 2020, JPA (PubMed)](https://pubmed.ncbi.nlm.nih.gov/32208939/) · [TIRT FC inventory development (PMC11673971)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11673971/) · [FC/Likert integration, Frontiers 2017](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.00806/full)

**Adaptive testing:** [Weissman 2007, EPM — mutual information adaptive classification](https://journals.sagepub.com/doi/10.1177/0013164406288164) · [CAT item selection components (PMC5968224)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5968224/) · [MFC CAT item selection (Lin et al.)](https://www.researchgate.net/publication/368341666_Item_selection_methods_in_multidimensional_computerized_adaptive_testing_for_forced-choice_items_using_Thurstonian_IRT_model)

**Live item analysis:** [University of Washington — ScorePak item analysis](https://www.washington.edu/assessment/scanning-scoring/scoring/reports/item-analysis/)

**Repo-internal:** `packages/web/src/features/trades-house/craft-quiz-model.ts` · `packages/web/src/features/trades-house/__tests__/craft-quiz-reachability.test.ts` · `docs/operations/trades-house-leaflet-source-2026-07-10.md` · `docs/trades-house/craft-research/08-wrights.md` · `docs/trades-house/craft-research/13-barbers.md`

## Gaps

- The exact numeric weight tables of the original Pottermore quiz (N1ffler spreadsheets) were referenced but not independently retrieved; mechanics are corroborated across three secondary sources, magnitudes are not reproduced here.
- Only 2 of 14 craft dossiers (Wrights, Barbers) existed at time of writing; twelve profile rows in §6 are grounded in `CRAFT_PROFILES` copy rather than deep-researched dossiers and should be re-checked as dossiers land.
- The v0.2 seed fails its own balance band (wrights 1.64% < 2%) — one further tuning iteration is required at implementation time; the census harness for it is a throwaway session script, deliberately not committed, and must be rebuilt inside the evolved vitest suite.
- No live human data: the 5–10% hatstall-rate target and all §14 thresholds are priors to be recalibrated after the shadow rollout.
