# OmniTwin Foundry provider recommendation V0 — independent audit

Date: 2026-07-14

## Frozen artifacts

| Artifact | SHA-256 |
| --- | --- |
| `packages/reconstruction-foundry/src/provider-recommendation.ts` | `f30095cb40df138c52d99f479c8a0e22ce01f9a6b5898b6ee76295a5589b1747` |
| `packages/reconstruction-foundry/src/__tests__/provider-recommendation.test.ts` | `886a4050e60050d353fcee5c196d3f569e61e43ee57546eb1fcf7c2d94c25586` |
| `docs/specs/omnitwin-foundry-provider-recommendation-v0.md` | `6b81074afa0d36692fa939eddc0c4a7f6b0f0a18ef63cf76b7681038d0856e30` |
| `packages/reconstruction-foundry/src/index.ts` | `95b35dc7fedbf3106c57abd05dfb4012e7dc8761975fcde5b1ec82e0a6966cf0` |

## Verdict

- P0: none.
- P1: none after the repair below.
- P2: none.
- P3: none.
- Recommendation-only V0: **GO.**
- Execution or activation authority: **NO-GO.**

This was a read-only review by an agent that did not author the recommender.
The record is unsigned and authority-none; it does not authenticate reviewer
identity, wall-clock time, immutable custody or unique execution.

## Negative finding and repair history

The first independent review returned NO-GO. It proved that a caller could
change a candidate cost, recompute the PlanOnly dossier digest, and change the
winner even though the bound route estimate and embedded JobSpec retained the
original economics. The original 13-test suite only rejected a stale digest.

The repaired request validator now derives route economics from the exact
PlanOnly request: local routes cost zero; remote cost is the six-decimal rounded
sum of all six declared breakdown fields. It also derives budget, storage
profile and the canonical plan-only JobSpec, then rejects candidate/JobSpec
substitutions before recommendation. Ranking consumes the request-derived cost,
not a caller-substituted candidate field.

## Independent adversarial replay

The final reviewer reproduced the historical attack with a schema-valid,
self-consistent dossier: AWS candidate and JobSpec cost changed from `6` to
`4`, with matching evidence, candidate binding and recomputed dossier digest.
The baseline recommended RunPod; the repaired recommendation-request validator
rejected the substituted dossier. An independent harness also rejected
re-digested route, budget, stage, output-prefix and storage substitutions.

The reviewer additionally confirmed:

- exact observation/expiry freshness boundaries;
- missing and unknown privacy, queue and software hard blocks;
- exact RAM, VRAM and cost fixed-point handling;
- all nine required factors in every candidate evaluation;
- explicit operator priority with route-order invariance;
- exact ties return `no_recommendation` and sorted binding digests;
- output factor, blocker and decision substitution is re-derived and rejected;
- fixed `authority: none` and false execution, dispatch, provider, network,
  storage, spend, signing, publication and promotion capabilities;
- no filesystem, process, credential, provider-SDK, network or mutation path.

Verification was 18/18 focused tests, full Reconstruction Foundry 215 passed
with one existing skip, plus TypeScript typecheck, ESLint and build. The root
agent separately reran the frozen focused suite at 18/18.

## Residual limitations

Route evidence is caller-supplied and unauthenticated; privacy-policy content
is referenced by ID/hash rather than interpreted; capacity, price, duration,
queue and compatibility are not reserved and may change after evaluation.
Manifest-dependent input totals and rights decisions are preserved from the
exact digest-bound PlanOnly dossier because the ingest manifest is not embedded
and therefore cannot be independently recompiled here. These limitations keep
the output advisory and authority-none.
