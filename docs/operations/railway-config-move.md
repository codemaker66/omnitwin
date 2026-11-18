# Moving the API's Railway settings (T-722)

The API's deploy settings are moving from `railway.json` to Railway's new format,
`.railway/railway.ts`. This page says why, in what order, and how we know it
worked. How to install and run Railway's tool: [`.railway/README.md`](../../.railway/README.md).

## Why

Railway's [Infrastructure as Code guide](https://docs.railway.com/infrastructure-as-code)
(read on 14 November 2026) says: "Existing Config as Code files stop being read on
2026-12-01 (hard cutoff)." `railway.json` is such a file.

Today `railway.json` is the only place that makes a deploy run the database
migration first, start with the command that works, wait for `/health/ready` and
drain for 30 seconds ([Deploy ordering](../engineering/deploy-ordering.md)).
In practice Railway's pre-deploy command is the only step applying migrations
today (the Deploy workflow's migration job has not run since late October: one
of its runs, started then, has never finished and holds the workflow's only
concurrency group), which is one more reason it must not be lost.
Railway also keeps its own stored copy of the settings, and that copy is old.
Railway's read-only plan of 14 November showed it: no migration step, an old
start command the built image cannot run, the wrong health check, and no drain.
If the file were simply ignored, the first deploy in December would most likely
fail to start, or go live without its migration.

## The three steps

1. **Add the new file (pull request 1, #440).** `.railway/railway.ts` declares the
   same thirteen settings as `railway.json`. It also declares settings
   `railway.json` never held, and after the apply the file governs those too:
   the source repository and branch (with `checkSuites: false`), the stored
   build command and build environment, the region the one replica runs in, the
   custom domain and its port, and the project, with variables left unmanaged.
   Railway's plan shows these already match what Railway has stored. After the
   move, changing any of them on Railway's dashboard shows on the next plan as a
   change to undo. The watch list lives once, in `.railway/watch-patterns.json`,
   which the production receipt reads and a CI step keeps equal to
   `railway.json`'s. CI compares only the watch lists, so until `railway.json`
   is deleted, a pull request that changes a setting in it must change
   `.railway/railway.ts` the same way. Pull request 1 touches no watched path,
   so merging it makes Railway deploy nothing and changes nothing on Railway.
   Vercel still republishes the web, unchanged, on every merge to master, as for
   any pull request.
2. **Copy the settings into Railway**, in one booked slot, with Blake's yes at
   that moment: one reviewed apply from a pinned plan. Expect it to redeploy the
   API once, with its usual migration step, running the code that is already live.
3. **Delete `railway.json` (pull request 2)**, in the same slot, and watch the
   deploy it starts. That is the first deploy with no file, and it is the proof.
   `/railway.json` stays in the watch list: harmless once the file is gone.
   Pull request 2 also corrects the three comments that name `railway.json` as
   the home of a setting: the start command in the `Dockerfile`, the health
   check path in `packages/api/src/index.ts`, and the pre-deploy command in
   `packages/api/src/scripts/migrate-before-deploy.ts`. They are watched paths,
   but pull request 2 deploys anyway.

Between steps 2 and 3 the settings exist in two places at once, which Railway's
guide says should not happen. Both hold the same values, so whichever one Railway
reads, a deploy is the same. Doing both in one slot keeps that state to minutes.

## The slot's checklist

Book it with the merge coordinator: a quiet hour, not beside a pull request that
carries a database migration, not while a deploy is running, and with no Deploy
workflow run approved or running during the slot (its migration job would run
beside Railway's own migration step). Pull request 2 is reviewed, and its
required checks pass, before the slot starts.

The slot must be done by 27 November 2026 at the latest. If it has not been
done by then, hold every pull request that touches a watched path until it is:
after 1 December such a merge would deploy with Railway's old stored settings.

On the slot's day, before step 1: merge master into pull request 2 and wait for
its required checks to pass (the Security Audit job fails on master too; that
known failure is not blocking). From then until step 7 is done, the merge
coordinator holds every merge that touches a watched path or `.railway/`.
Otherwise pull request 2 falls behind master, its checks must run again, and it
cannot merge at once.

1. On Railway's dashboard, check that the environment has no pending staged
   changes. If it has, stop.
2. From a clean checkout of master, run `railway config plan --json --out <file>`,
   with the file outside the repository. Read its change set and its `effects`.
   They must match the plan in pull request 1. Anything else, or anything
   destructive: stop. A pinned plan also pins the `.railway/` folder, so nothing
   that changes it may merge between this step and step 4. If the plan refuses
   the service because of a config-file path, stop: Railway's documented order
   then starts with its cutover, and pull request 2 must not merge.
3. Show Blake that summary and ask him by button, in these words: "this will most
   likely redeploy the API once, with its migration step".
4. Run `railway config apply --plan <file> --yes`. Never add
   `--confirm-destructive`, so the tool itself refuses anything destructive.
5. If a deployment starts, watch it to the end: the migration step ran,
   `/health/ready` passed, it is serving. If it fails, stop, and do not merge
   pull request 2: the previous deployment keeps serving.
6. Run `railway config plan --detailed-exit-code`. It must exit 0. If it does not,
   stop: `railway.json` is still there and still read.
7. Mark pull request 2 (#447) ready for review, then merge it at once, and watch
   its deploy. Until step 6 exits 0 it stays a draft, so it cannot be merged
   early. It changes the `Dockerfile` (a comment), a watched path, so the merge
   should start a deploy by itself. As a backstop: if no deployment starts
   within ten minutes, deploy the latest commit from Railway's dashboard, so the
   first deploy without the file happens while it is watched.

After a stop before 1 December, the merge coordinator releases the hold on
merges and the slot is rebooked, by 27 November. Pull request 2 stays a draft
and is brought up to date with master again on the new slot day.

## The proof

- Pull request 1: Railway's read-only `railway config plan --verbose` of this very
  file, from a clean checkout, prints eight changes and nothing else (the
  builder, the watch list, the pre-deploy command and its timeout, the start
  command, the health check path and its timeout, the drain), with 0 to add,
  0 to destroy and variables unmanaged. Its output goes in the pull request.
  It was run on 15 and 16 November 2026 and printed exactly that; the output
  is in pull request #440.
- After the copy: `railway config plan --detailed-exit-code` exits 0.
- The proof deploy's own record names no config file and maps no setting to a
  file. It shows the pre-deploy command and its 900 seconds, the start command,
  `/health/ready` and 2700, a drain of 30, the restart policy, one replica in the
  one region (recorded as a region map, not the old single number), the
  Dockerfile builder and the thirteen watch paths. Its log shows the migration
  step before the start.
- The production receipt workflow is green on that commit.
- The release lead has reviewed both pull requests.

## If the proof deploy fails

1. The previous deployment keeps serving. Confirm it on `/health/version` and
   `/health/ready`.
2. Read the failed deployment's recorded settings against the values in
   `.railway/railway.ts`.
3. Correct Railway's stored settings with another reviewed plan and apply.
4. Reverting pull request 2 is a stop-gap only: it restores the same values,
   starts another deploy, and stops working on 1 December. Railway's old stored
   values are the broken ones and are never restored.

## After the move

A setting changes by a reviewed pull request to `.railway/railway.ts`, then a
reviewed apply with Blake's yes. The file describes the whole project: anything
added on Railway's dashboard (a worker, a database) must be added to the file
first, or the next plan shows it as a deletion. Nothing yet checks that Railway's
stored settings still match the file; until something does, the production
receipt's "unchanged" verdict assumes they do.
