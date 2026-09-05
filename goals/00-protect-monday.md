# 00 · Protect Monday

**Execution amendment, 2026-09-04:** the later V0 revision in [GOAL.md](../GOAL.md) supersedes this card's earlier Saturday deployment plan. There is **no Saturday planner push**. T-581 implementation and verification may proceed on its isolated branch; production qualification and deployment remain separate later work. See [EXECUTION.md](EXECUTION.md) for current ownership and evidence. The earlier W0 history below is retained as history, not deployment authorisation.

## The /goal block

Protect Monday 7 September's demo for Elaine. Complete and measure the T-581 planner coarse-first ladder on its isolated branch with exactly one renderer host; do not push the planner on Saturday. Run packages/web/scripts/demo-smoke.mjs against production Saturday, Sunday and Monday at 08:00 BST and notify Blake only on failure. Support Blake's signed-in rehearsal per docs/plan/12 §4, logging every break as a task row and following the latest GOAL.md V0 constraints. Observe the production freeze: no push to master from Saturday 18:00 until Monday 18:00, no railway up, no Diary or production-data change, no deployment of a rebuilt surface.

## Outcome, in Blake's words

"I have a goal of having an impressive workable demo to show elaine (trade's hall venue admin) on monday" (2026-09-03). The plan is docs/plan/12: three acts, the breaks and fixes in §3, the weekend in §4, never click in §5.

## Where we are (GOAL.md §3, measured 2026-09-04)

- W0 (a) the verification sweep ran: both blockers and three majors were stale (cached agents judging code that dbc9ec62 had fixed); the skeptic's own reproduction against HEAD passed with all eleven sharp tiles failing and the whole hall still drawn.
- W0 (b) T-580 done (a6743830): /living-hall fetches 5 tiles and 35.9 MB, not 8 and 62.8.
- W0 (d) demo smoke done (ff19558d): five checks, non-zero exit on failure, green against production.
- W0 (c) open: the planner on production at 20 Mbps, first captured tile 22.5 s, last 53.3 s, 106.9 MB, no coarse rung (D:/claude/ladder-sweep/planner-load.mjs). The card's 15 s trigger fired.
- The Diary, corridor, sheet and Day Board have never been clicked on production by a signed-in user.

## Decided

- The planner keeps exactly one renderer host. RoomSplatScene's delivery state machine (coarsest level first, then the served level; a failed tile never discards the room) is the reference; CockpitSplatLayer follows it, it does not fork it.
- The smoke script records the three morning checks. A passing result does not authorise a Saturday planner push.
- A resumed workflow replays cached results: check a finding's line numbers against the current file before acting on it.

## The work

1. T-581, test first: a unit test that CockpitSplatLayer mounts the coarsest level before the served level and never a second host; then the change; then `node D:/claude/ladder-sweep/planner-load.mjs` before and after at 20 Mbps, with separate browser evidence of presented pixels and usable interaction. Keep this work on its isolated branch under the later no-Saturday-planner-push instruction. Lint, Typecheck, Build and Test remain required checks; current CI/E2E defects do not waive runtime verification. If first splat pixels remain above 15 s, record the result and investigate before later production qualification.
2. The 08:00 runs: a /loop or a scheduled task that runs `node packages/web/scripts/demo-smoke.mjs` from packages/web on Saturday, Sunday and Monday at 08:00 BST, appends the five lines to docs/sessions/2026-09-0N.md, and push-notifies Blake only when the exit code is non-zero.
3. Saturday's rehearsal: Blake signs in on production and walks docs/plan/12 §4 with the session watching console and network. Every break becomes a T-row for Tuesday; only the §3 list is fixed before 18:00.
4. Monday: the 08:00 smoke, nothing else touches production; the session stands by for §5.

## Done when

The immediate V0 protection slice is complete when the three morning smoke results and rehearsal outcomes are recorded and the no-Saturday-planner-push instruction is observed. T-581's later production qualification still requires planner first splat pixels ≤ 15 s at 20 Mbps, usable interaction and the named CI checks; it is not a condition for pushing before Monday.

## Verify

```
node D:/claude/ladder-sweep/planner-load.mjs
node packages/web/scripts/demo-smoke.mjs
pnpm --filter @omnitwin/web typecheck && pnpm --filter @omnitwin/web test -- --run
gh run list --branch master --limit 1
```

## Forbidden

Any rebuilt surface before Monday. The Diary. Production data. A push after 18:00 Saturday. `railway up`. A second renderer host. Screenshots during a load.

## Human inputs

HUMAN.md item 1 (the Saturday slot; Elaine's device for the demo).

## Unlocks

Everything in 01–10 that touches production, from Tuesday 2026-09-08.
