# Railway settings from GitHub (T-751) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merged change to the settings folder reaches Railway's production settings from GitHub on two
approvals by the founder, and by no other route.

**Architecture:** One workflow, three jobs. The first holds no secret and runs no code of the run's own
commit, at any point: it reads that commit's files as data. It reads the gate's rules back from GitHub,
checks the run is current, and shows what the approvals trust. That page is written by code the commit
cannot change: the code of the last change this workflow applied, or, before there is one, the base code
the workflow file names. The other two jobs wait on a protected environment, and each gives the token to
one step. The settings file is first run in the second job, after the first approval, in a process that
holds no token. Everything those two jobs run, and everything they read but the two files at the
repository's root that git itself obeys, lives in three trusted places: `.railway/`,
`.github/railway-settings/` and the workflow file. Git can be told, by a file outside those places, to
rewrite a file as it checks it out. So every job proves, before it runs or reads a trusted file, that the
file on the runner is byte for byte the file git holds for its commit, and that nothing else of the
repository is on the runner, and refuses when either is not so. Every
judgement (the lines, the refusals, the gate, the look at other deploys, the words) is a small pure module
in the trusted folder. Its tests, on made-up plans, and the CI check live beside it in
`.github/railway-settings-check/`, which no job of the workflow reads. Railway's tool is started from one
function that accepts an exact list of commands.

**Tech Stack:** GitHub Actions on `ubuntu-24.04`. Node 22 as one release file checked against a SHA-256, with
built-ins only (`node:crypto`, `fetch`) in everything the workflow runs. Git's own plumbing (`ls-tree`,
`cat-file`, `hash-object`) to take and to prove files. `node:test` for the tests. Two locked packages, for the
check folder alone: `yaml`, for the CI check, and `marked`, for one test that renders a summary. Railway's
tool 5.74.0 as a release file checked against a SHA-256. Railway's kit 3.17.0 from
`.railway/package-lock.json`.

**Spec:** `docs/superpowers/specs/2026-11-22-railway-settings-apply-from-ci-design.md` (sections 6, 8, 9 and
12; section 14 lists what the release lead's two review passes changed). Read it with this plan: the plan
argues from it. The founder approved it on 22 November 2026.

Written 22 November 2026. Amended to follow the design's two review rounds, what the build of Tasks 1 to 10
found, the release lead's four reviews of this plan, on 25, 26 and 27 November, and a second review of
the build itself. Each of Tasks 1 to 10 ends
with an "As built" note. It says what the code holds beyond this plan's first wording, and what is still to
change in it, so that the plan matches the code a reviewer reads. At the build's head on 27 November its
suite held 457 tests, all passing, and the check folder's two packages were pinned. The rest of Tasks 11
onward was not yet built.

## The whole build, in order

| Part | What it holds | Who | A token exists |
|---|---|---|---|
| **1. Pull request 1** (Tasks 1 to 15) | The modules and their tests, the CI check, two proofs that need no token, the workflow in rehearsal form | The builder | No |
| **2. Set-up and rehearsal** (Tasks 16 to 18) | The environment and its four rules, the founder's two checks, the rehearsal, four read-only reads of Railway by hand | The founder, with the builder reading | No |
| **3. Pull request 2** (Tasks 19 to 24) | The two steps that hold the token, the Deploy workflow's header comment, then the token itself and the first check with it | The builder, then the founder | From Task 23 |
| **4. Pull request 3** (Tasks 25 to 27) | The folder holds only what a plan reads, the operations page, the new rule, the first real change | The builder, the founder, a person watching | Yes |

Each pull request goes to the release lead for review before it merges. Until Task 25 merges, the rule is
unchanged: a reviewed pull request to `.railway/railway.ts`, then an apply by hand with the founder's yes.

**Each of the three merges starts a run.** The workflow starts on any change to a trusted place, and each
pull request changes one. What that run does is said in Tasks 15, 22 and 26. None of them can reach a token
without the founder's approval on GitHub.

## What the design left to the builder (its section 12), decided

| Left open | Decision | Why |
|---|---|---|
| Which of Railway's release files is the tool, and how the runtime is pinned | The tool: `railway-v5.74.0-x86_64-unknown-linux-musl.tar.gz` from Railway's releases on GitHub. The runtime: Node's own Linux file for one exact version, the one the API's image pins on the day (22.23.2 on 22 November). Each is fetched with `curl` and checked against a SHA-256 kept in `.github/railway-settings/pins.json`, which also holds the SHA-256 of the program inside | Railway's CLI page lists pre-built files as an official way to install and describes no way for its install script to pin a version or check a sum. The npm route brings an installer's dependencies into a public lockfile (`.railway/README.md`). GitHub's release record gives a SHA-256 for each file and marks that release immutable. 5.74.0 made the plan seen on 22 November. No action but checkout is allowed, so the runtime cannot come from `setup-node` |
| How the history of runs is read for the last change applied | GitHub's API, with the run's own token: this workflow's runs, newest first, then a candidate's jobs and its review history. Only one kind of run counts (design 6.2): on `master`, started by a push or by hand, in this repository and not a fork, whose step `Nothing is left to change` succeeded in the job "Apply this plan", after an approval by the repository's owner that its review history records for `railway-settings`. The step's success is enough, in any attempt of the run: the job may have failed afterwards because the redeploy was not confirmed, and a later re-run of the failed job finds nothing left to apply, and the settings were applied all the same (Task 5). A run that only found Railway up to date does not count. A run that applied and whose review history is empty stops the search: who approved it cannot be read. The runs are read a page at a time until one counts, within a stated bound (Task 12). With none, or when the read fails or reaches its bound, step 1 shows the trusted places in full and old values are hidden, and it says which of the two it was | A step's name and result, and a review's record, are written by GitHub, not by the commit being run |
| The files inside `.github/railway-settings/`, and how their tests run in CI | That folder holds only what the workflow's jobs run or read: ten modules, five scripts and the pins. The tests, the fixtures, the CI check and its two packages live in `.github/railway-settings-check/`. CI's tooling job runs them with `node --test`, as it runs `.github/gpu/*.test.mjs` (`ci.yml:612-619`) | A test or a CI rule is not code the approvals trust, so changing one should not start a run or be shown in step 1. Both folders are outside the pnpm workspace (`packages/*`, `tools/*`), so no manifest or lockfile on a watched path changes |
| The comment at the top of the Deploy workflow | Rewritten in pull request 2, where the token steps land (`deploy.yml:18-21`). It says that a Railway token now lives in one protected environment, and points at the design | A comment-only change, in a file that is not a watched path and not a trusted place |
| How step 3 reads other workflows' executing jobs | GitHub's API, for the workflow files in a fixed list. (Railway's own state is the design's now: `railway deployment list --service <name> --json`, through the one tool entry, to a file on the runner, in step 2 and again in step 3; only a verdict is printed.) The running build: the production receipt's method (`production-receipt.yml:85-96` and `117-132`), with the address held in the trusted folder | Each reader is the narrowest one that answers the question. The list of workflows is checked by CI, so a new migration workflow cannot be forgotten |
| The rehearsal mode | Pull request 1's workflow is the rehearsal. Its two approved jobs name the environment, install and verify everything, read nothing from Railway and hold no reference to a secret. Going live is pull request 2, a reviewed change. The CI check judges each approved job by itself as rehearsal or live, and refuses anything between (Task 11, rule 14) | A rehearsal that cannot touch a token needs no switch to trust |
| The exact words of the summaries | The table in Task 10, tested word for word | One place to read and to change them |
| The README's new home, and "After the move" | `docs/operations/railway-settings.md`, moved in pull request 3. The same pull request edits "After the move" | Its merge changes `.railway/` without changing a setting, so the run it starts is read-only, with the founder watching |

## Who writes step 1, and what it can vouch for

The release lead's review of 25 November found that step 1's page was written by the commit's own code, in
the step that also evaluated the commit's settings file. A merged change to that code could then make the
page say anything. The design accepts one limit only: step 1 cannot vouch for the workflow file (its
section 3). This plan stays inside that limit. Nothing in the design changes. The review of 26 November
found two holes left in it, and both are closed here: git could be told to rewrite a trusted file as it
checked it out, and the job still ran the commit's settings file, and npm in the commit's own folder,
after the page was written.

**The rule.** The job `gate` runs no code of the run's own commit, before the page or after it. It makes
three checkouts, each into a folder of its own, and every program it starts is of `base/` or of `code/`:

| Folder | Which commit | What is done with it |
|---|---|---|
| `base/` | The base commit: 40 hex characters written in the workflow file, called BASE below | Its code reads the gate's rules back, checks the run is current, finds the last change applied, and says which commit's code writes the page |
| `code/` | The commit the base code named: the last change applied when there is one and it holds BASE in its history; otherwise BASE | Its code proves the files of `head/`, works out what changed, and writes the page. It does nothing after the page |
| `head/` | The run's own commit, the three trusted places | Files to read, as data: names, lists, lines, text. Nothing in this folder is ever started, imported, sourced, installed or evaluated in this job |

**Nothing of the commit runs before the first approval.** The settings file is code, and Railway's kit is
installed by npm, which takes settings from the folder it runs in. So neither happens in `gate`: no npm
runs there against a folder the commit controls, and the settings file is not evaluated there. Both happen
in the job `plan`, after the first approval, in steps that hold no token, as design 6.2 writes it. What
step 1 shows of the settings file is its text: its changed lines, or the whole file. What the file
declares, and whether an old value is the one the file declared at the last change applied, is step 2's
to read and to show (Tasks 20 and 21).

**The files on a runner are the files git holds.** Git rewrites files as it checks them out when an
attributes file says so: another text encoding, other line ends, an expanded keyword. The attributes file
at the repository's root is outside the trusted places, so a change to it starts no run and is on no page,
and git obeys it even when it is not checked out. A trusted file on a runner could then differ from the
file step 1 showed. So no job runs or reads a trusted file from a checkout as it stands. Each checkout is
followed at once by a proof, made by `exact.sh` (Task 12): for every file of the trusted places in that
checkout, the SHA that `git hash-object --no-filters` gives the file on disk must be the id of that file in
the commit's tree, each must be a plain file, and no other file may be there. One mismatch refuses the job
with a fixed sentence. The proof's own script is not trusted from the checkout either: the workflow file
takes it out of git as it is stored (`git cat-file blob`), into the runner's temporary folder, and runs
that. This holds for all four copies: `base/`, `code/`, `head/`, and the one checkout of each approved job.
Where an older commit's files are needed with no checkout (Task 12, `exact.sh last`), they are taken out
of git the same way, into an empty folder. Changed lines are worked out from files taken out of git, never
from a checkout. Task 11's rule 12 holds the workflow file to this: no trusted file is run from a checkout
that has not been proven.

**Nothing else of the repository is on a runner.** Each checkout names the places it wants, and each name
is written from the repository's root, with a slash before it and, for a folder, one after:
`/.railway/`, `/.github/railway-settings/`, `/.github/workflows/railway-settings.yml`. In git's patterns a
name with no slash in it matches at any depth, so `.railway` alone would also bring to the runner a folder
of that name anywhere in the repository, unproven and unseen. (A name with a slash inside it, such as
`.github/railway-settings`, already matches only from the root; the first slash is written on all three
so that no line depends on that.) The proof therefore also holds that the checkout's
whole working tree, everything outside git's own folder, is the files of the places and nothing more. If a
checkout cannot be narrowed like this on the runner, the build stops and the release lead is asked (Task
13): the lists are never dropped to make something work.

**Two files outside the trusted places that git obeys, and what stands against each.** The attributes file
at the root: the proof, above. The proof stands against a rewrite of bytes, and against nothing else an
attributes line can do. A line that leaves every byte as it is can still make git call the settings folder
changed, and Railway's tool then writes a plan the reader refuses: every run would end with "a shape this
workflow does not know". That fails closed and reaches no token, and Task 24's row for that sentence names
the root's attributes file as a cause to look for. The ignore file at the root: Railway's tool asks git whether the settings
folder is unchanged, and the kit's installed folder inside it must be ignored for git to say yes. If the
root's ignore file ever stopped saying so, every plan would be refused, by a change that starts no run and
is on no page. So the settings folder carries its own rule: `.railway/.gitignore`, one line,
`node_modules/`. It is a trusted file like its neighbours, shown and proven, and git lets the ignore file
nearest a path decide, so the root's cannot overrule it (Task 12 has the test).

So a change to the display code reaches the founder first as changed lines on a page that older code wrote.
It writes the page itself only after a run that held it has applied a change on his two approvals, or after
a reviewed change to the workflow file moves BASE. The second is the design's own limit: a changed workflow
file is the code that runs step 1.

**What BASE is.** In pull request 1 it is the commit of that pull request's own branch that last changed
`.github/railway-settings/`. The pull request merges with a merge commit, so that commit is in `master`'s
history (Task 15 checks it, and says what to do if the merge squashed it). The base code refuses to go on
when the run's commit does not hold BASE in its history. BASE moves only by a reviewed pull request that
changes the workflow file and nothing else, to a commit already on `master`.

**What the page is made from.** Git's own account of the two commits, taken by the `code/` copy's scripts:
the list of the commit's files in the trusted places, the names that changed, and each changed file's old
and new contents as git stores them, from which the changed lines are worked out. No file of the run's
commit is evaluated, imported or started to make the page. Every name and every text taken from the commit
is shown as text (Task 10).

**When a change to step 1's own code takes effect.** The base copy reads the gate and the history, and the
code copy writes the page. Neither is the run's own commit. So a merged change to `gate.mjs`, to the `gate`
or `show` command, to `words.mjs` or to a script does not change step 1 on the run its merge starts. It
changes the approved jobs at once, which run the commit's own copy. It reaches the page when a run that
holds it has applied a change, and it reaches the base copy only when BASE is moved. A fix that step 1
itself needs is therefore followed by a pull request that moves BASE, and its task says so.

**What step 1 can vouch for:** that the page was written by code this commit did not change; that the
changed lines, or the full files, are this commit's trusted places as git holds them, byte for byte; that
nothing of this commit was run to make it; and the gate's rules as GitHub gave them. **What it cannot
vouch for:** the workflow file, which names the three checkouts, their proofs and BASE, and is the code
that runs step 1; anything outside the trusted places; and what any change means. Task 10's sentences say
exactly this.

**If the older code cannot show the newer files** (a file in a shape it does not know, or a page too large
for GitHub): step 1 fails with a fixed sentence and nothing can be approved. The way out is a reviewed pull
request that moves BASE to a commit on `master` whose code can show them. That pull request changes the one
file step 1 cannot vouch for, and its run's page says so.

## Where this plan departs from the design's letter, and why

1. **An effect the workflow does not know is refused.** Every change seen so far says `deployEffect: "deploy"`.
   Step 3 must know whether to wait for a redeploy, so any other value is applied by hand until it is added.
2. **A refusal prints its one sentence and then fixed reasons.** The reasons are chosen from a short list and
   name settings only, never a value from Railway.
3. **The reviewer is matched by user id, not by name.** Design 6.1 asks for exactly the founder's user. A name
   can be changed; the id GitHub gives the repository's owner cannot.
4. **The reader refuses more than design 6.3 lists.** The build kept refusals for shapes that could be read
   in more than one way or that would be applied with no line to read: a plan whose keys are not exactly the
   ones seen on 22 November; a plan that is not what the settings file's own reading declares; a group or a
   setting named twice; an update with no detail; a setting that changes, at any depth, with no detail
   naming it; a setting only the file holds, at any value but the tool's own default, with no detail naming
   it; a region map only the file holds, with no detail naming it; an empty value anywhere in what the file
   declares for a changed group; a setting the file declared at the last change applied and declares no
   more, while Railway still holds it at a value that is not the tool's default; a count of replicas it
   cannot count. Tasks 1 and 2 list them. Each is applied by hand.
5. **An empty plan that the reader refuses is not called up to date.** Design section 2 says a plan with no
   change says "already up to date". A plan with no change but made for another copy of the folder, or by
   another version of the tool, proves nothing about this commit. Step 2 fails with the reason, and step 3
   checks the refusals before it looks at whether anything is pending.
6. **A read of Railway's state that returns no deployment at all is unreadable, not quiet.** The service has
   deployments, so an empty list means the read did not see them.
7. **A run counts as the last change applied only when the repository's owner approved it.** Design 6.2 asks
   for an approval that the review history records. The history also says who gave it, and the gate reads
   back only this run's rules, not the rules in force when an older run was approved. So an approval by
   anyone else does not count. It fails towards showing more.
8. **A move of the one replica to another region does not reach a plan at all.** Design 6.3 gives it as a
   change that passes and is marked. The tool's public source at 5.74.0 treats one replica in one region as
   its own default, whatever the region, and leaves it out of both sides before it compares them. Such a
   move by itself gives a plan with no change, from GitHub and by hand alike. Beside another change in the
   same group it has no line, so step 3 refuses the plan as unread, whether or not Railway holds a region
   map of its own: a map only the file holds, with no detail naming it, is refused too (Task 2). Every other change of replicas or
   regions is read and marked (Task 1). This is read from the tool's source; Task 18 step 4 settles it by
   a read-only plan made by hand. Two things follow in step 2's words. "Already up to date" is followed by
   "Railway's plan shows no change", which is what was read, and not by a claim about what Railway holds.
   And when the file declares something other than it did at the last change applied while the plan is
   empty, step 2 says so in a sentence of its own and does not say "already up to date" (Task 10,
   `changedNoPlan`). Task 25's page says it too.
9. **Step 2 passes one more thing to step 3.** Design 6.2 lists the lines, the time, and whether changes
   are pending. Step 2 also passes what the file declared at the last change applied, as it read it. Step 3
   writes its own lines with that same reading, so that the two sets of lines can differ only when Railway
   differs. It decides only how an old value is shown, and one refusal (Task 2).
10. **A plan that adds, deletes or touches variables is read, and refused by its reasons.** The earlier
    wording of this plan held every change to the keys of an update, so such a plan ended as "could not be
    read". Design 6.8 asks for "applied by hand". Each kind of change the tool writes is now held to its
    own keys (Task 1).
11. **A head that moved while step 3 ran stops the apply.** Design 6.2 says step 3 "checks `master`'s head
    again and says so if it moved". This plan is stricter: step 3 refuses before the apply unless three
    reads of `master`'s head, all made in that job, give one commit: the one the currency check saw, the
    one the look judged the running build against, and the one read just before the apply. And no read of
    the look may be more than two minutes old when the apply is made: its age is counted from before its
    first read, an older look is made again whole, and the age is checked once more just before the
    apply. The reason: an apply makes
    Railway deploy the head it finds. After a move, that is a commit the look never judged, and if the move
    changed the API's code the apply would ship it, with its migrations, under a settings approval, which
    is the one thing design 6.5's third test is there to prevent. A second read of Railway's state, when
    the look is made again, is the design's second call made twice and no new command. After the apply the
    step still says so if `master` moved, as the design asks. What no step can close is the moment between
    the last read and Railway's own. **A head that moved between the two approvals is another matter, and is
    said, not refused.** Step 2 names the commit an apply would redeploy. A merge that lands before the
    second approval moves that; step 3's own three reads then agree with each other and not with step 2.
    Refusing there would strand an approval on every unrelated merge, and the head is `master`'s, which
    deploys in any case. So step 3 says, before the redeploy, that `master` moved since step 2 named one
    commit and that the apply redeploys another (Task 9, `namedMoved`). The release lead ruled both halves:
    strict inside step 3, said between the steps, and no amendment to the design. If Tasks 17 or 24 force
    an amendment anyway, departures 8 and 11 are folded into it, dated.
12. **One proof of design section 9 is not made: what an apply does to changes left staged on Railway's
    dashboard.** Only an apply could show it, and none is run for a test. Nothing is staged on production
    for a test either (Task 18). The design's section 7 already rests on the founder's look at the
    dashboard, which step 2 prints before every second approval, and Task 25's page, item 9, says that
    the workflow never reads staged changes.

**What the three reviews of this plan did not change in the design.** Step 1 is written by code the commit
cannot change, and nothing of the commit runs before the first approval (the section above). That narrows
what a merged change can do and widens nothing step 1 claims, so the design's sentence in its section 3
stands as written, and the settings file is evaluated where design 6.2 evaluates it. Two fallbacks of the
first plan did depart from the design without saying so: giving the approved jobs deployment records of
their own, and reading Railway's state from GitHub's records. Both are gone. Where the design cannot be
built as written, Tasks 17 and 24 stop and ask for a dated amendment to the design, reviewed by the release
lead and answered by the founder, before anything else is built.

## Not in this plan

Any change to what the Deploy workflow does. Railway variables. An unattended drift check. A read of the
gate's rules between runs (design 6.1 says the read-back is not a guard between runs). A second Railway
environment to test against. A second GitHub account for automated tools (design section 11). A real settings
change: the first one is someone's later pull request, and Task 27 says how it is watched.

## Global Constraints

- **No task touches a watched path.** A merge that changes one deploys production. They are exactly:
  `/Dockerfile`, `/.railwayignore`, `/railway.json`, `/package.json`, `/pnpm-lock.yaml`,
  `/pnpm-workspace.yaml`, `/tsconfig.base.json`, `/packages/api/**`, `/packages/types/**`,
  `/packages/reconstruction-foundry/**`, `/tools/reconstruction-foundry/**`, `/tools/capture-factory/**`,
  `/tools/twin-forge/**`. Each pull request proves it with
  `git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings-check/watched.mjs`,
  which must print `No watched path is touched.`
- **No new dependency in the root `package.json` or `pnpm-lock.yaml`.** Never a `package.json` under `tools/`
  or `packages/`: both are workspace globs, so it would change the lockfile.
- **The trusted places are three:** `.railway/`, `.github/railway-settings/` and
  `.github/workflows/railway-settings.yml`. They are the trigger's paths, what step 1 shows, and what the
  currency check compares. Everything an approved job runs is in them, and everything it reads but the two
  files at the repository's root that git itself obeys (below). `.github/railway-settings/` holds no test,
  no fixture, no third-party package and no file that is not on Task 11's list.
- **The job `gate` runs no code of the run's own commit, at any point.** Its three checkouts, and what each
  is for, are in "Who writes step 1". Every program it starts is of `base/` or of `code/`. Nothing under
  `head/` is started, imported, sourced or evaluated there. **No npm runs in that job at all:** npm takes
  settings from the folder it runs in, so npm in a folder the commit controls is the commit's code.
- **The settings file is first run after the first approval.** It is evaluated in the approved jobs, in a
  step that holds no token, before the one step that does, as design 6.2 writes it. A step is not a wall:
  code run earlier in a job can change files a later step runs. What stands between the commit's code and
  the token is the first approval, which trusts the commit (design section 3), and nothing else is claimed.
- **Node's permission model is not a boundary, and nothing in this plan rests on it.** The settings file is
  evaluated with Node's permission flags set (Task 3). Node's own page says the feature does not protect
  against hostile code. Here it is a seat belt against a settings file's mistakes: a file that writes or
  starts something by accident fails loudly. No rule, no sentence and no proof of this plan leans on it.
- **Every checkout names its places from the root,** `/.railway/` and not `.railway`, and holds nothing
  else. A checkout that cannot be narrowed so is a stop, never a reason to drop the list (Task 13).
- **Two files outside the trusted places steer git on a runner:** the attributes file and the ignore file
  at the repository's root. The proof stands against a rewrite of bytes by the first; a line there that
  leaves the bytes exact can still make every plan unreadable, which fails closed. The settings folder's
  own ignore file, `.railway/.gitignore`, stands against the second ("Who writes step 1").
- **No file of a checkout is started in a job whose proof did not pass.** No step of the workflow has a
  condition of its own, but three in the live `apply` that the CI check holds letter for letter and each
  to its own step. The two of them that may run after a failure name the proof's own success (Task 11,
  rule 14).
- **npm reads its settings from four places, and each is closed.** The folder it installs into: no file
  named `npmrc` or `.npmrc` may be anywhere under `.railway/` (Task 11, rule 27). The folders above it:
  `--prefix`. Its "global" file, which with `--prefix` would be `etc/npmrc` inside the settings folder:
  `--globalconfig` names an empty file the workflow's own code wrote. The home folder's file:
  `--userconfig` names a second empty file beside it: npm refuses to load one file as both, and ends
  before it reads anything. npm's environment holds `PATH` and `HOME` and nothing else,
  so no variable sets a setting either, and npm's own built-in file is inside the runtime folder, which
  is checked against its sum before npm is started (Task 3).
- **A trusted file is run or read only as git holds it.** No job runs or reads a trusted file from a
  checkout that has not been proven byte for byte against the commit's tree, and an older commit's files
  are taken out of git as stored, into an empty folder ("Who writes step 1"). Git's `archive` is never
  used: it obeys the attributes file too.
- **Everything taken from the commit or from Railway is shown as text.** File names, file texts, changed
  lines and values go into a summary inside `<pre>` or `<code>`, with `&`, `<` and `>` escaped, the
  backslash doubled, and every character outside printable ASCII, tab and line end written as `\uXXXX`. A
  line end that JavaScript reads and a page does not (a lone carriage return, U+2028, U+2029) is drawn as
  one. A mark stands at the start of its line, never after a value.
- **The approvals are the founder's.** No automated tool approves a `railway-settings` review, creates or
  changes that environment, or sees, creates, pastes or prints the token. His yes in a chat lets nothing else
  approve: the approval is his own, on GitHub's review page. Tasks that need him say so in their title.
- **In the two approved jobs:** no action but `actions/checkout` pinned to a full commit id, with
  `persist-credentials: false`; no cache; no artifact; no deployment record of their own; their own read-only
  permissions; their own condition (this repository, `master`).
- **One step holds the token in each approved job.** In `plan` it is the step "Read Railway's plan, with the
  token". In `apply` it is the step "Plan again, look, apply, plan again, with the token". No other step, job
  or workflow names a secret whose name begins `RAILWAY`.
- **The tool is started from one function,** `runTool` in `tool.mjs`, with one of the exact argument lists of
  Task 3. Never `--confirm-destructive`, `--show-values`, `--decrypt-variables` or `--include-variables`.
- **Nothing the tool writes reaches a log, a summary, an output or a file name.** Every call's output goes to
  a file in `$RUNNER_TEMP/railway-settings/`. A failure prints a fixed sentence and the exit code. This holds
  for every call in both approved jobs.
- **The gate is read with the run's own token and no other.** Never a stronger token, and never no token.
- **No step changes a later step except through a file in the work folder or a step output.** Nothing in the
  trusted folder writes to the job's environment file or its path file.
- **Every check is an allow-list.** What is not known to be allowed is refused, and the refusal says the
  change is applied by hand.
- **Fail closed.** A read of GitHub or Railway that fails, or returns a shape the code does not know, is a
  refusal, never a pass. Two exceptions are the design's own: an unreadable history of runs means the trusted
  places are shown in full, and the bypass field as Task 5 says. A third follows from design 6.4: when what
  the file declared at the last change applied cannot be read, old values are hidden and the run goes on.
- **The repository is public.** No address, local path, account or session name, Railway id, hash or project
  name, and no Railway variable name, in code, tests, fixtures, logs, commit messages or pull request text.
  The one name the design itself gives, for the leak steps of its section 8, is repeated in Task 25's page
  and nowhere else. Fixtures use made-up values. Before each push, search the diff for an email address, a
  drive or user folder, and a UUID that does not begin `00000000-0000-`; none may match.
- **Tests never contact Railway or GitHub.** They read fixtures. Only the proof tasks read the real services,
  and they say exactly which reads.
- **No skipped test.** A test that needs Railway's kit fails with a plain message when it is missing. So does
  a test that needs `bash` and `git`. Where a guard acts on Linux only (Task 3 names two), its test asserts
  the guard on Linux and asserts on Windows only what holds there; it is never skipped.
- **Plain modules:** `.mjs`, Node built-ins only, relative imports with their extension. In the trusted
  folder a module imports only built-ins and its neighbours, and only `tool.mjs` may import
  `node:child_process`. In the check folder only `check-workflows.mjs` may import `yaml`, and only
  `words.test.mjs` may import `marked`.
- **Commits** name their files explicitly and end with the project's co-author line.

## Review Focus

Inputs and failures the design implies but does not test, most likely first. Each has its test in the task
that owns the code.

1. **A detail line in a wording Railway has not used before, or one that can be split in more than one way.**
   It must be refused, never guessed. A value that merely holds an arrow or a bracket must still be read
   whole. (Task 2: "a line the reader cannot parse is refused" and "a new value that itself holds an arrow and
   a bracket is read whole".)
2. **The tool fails, hangs or writes no plan file.** The log must hold a fixed sentence and an exit code, and
   nothing the tool wrote. (Task 9: "nothing the tool wrote is in what the flow says".)
3. **GitHub answers the gate's read with an error, with a second page, or with a field missing.** The gate
   must refuse, not pass. (Task 5: "refuses: the branch rules run to a second page" and its neighbours;
   Task 12: the wiring treats any failed read of the rules as a refusal.)
4. **Step 3 is run again by itself, days later, with step 2's old outputs.** It must refuse before it calls
   the tool. (Task 9: "step 3 refuses a first plan older than six hours before calling the tool".)
5. **A deployment record that is not Railway's own for this apply** (the job's own record, the Deploy
   workflow's, one for another commit, one made before the apply). It must not confirm a redeploy. (Task 7:
   "a record counts only when all four hold".)
6. **A file name, a file's text or a value that tries to be markup:** a code fence, a closing tag, a comment
   that hides the next line, a link, a mention, a character that reverses the reading order. It must reach
   the page as the characters it is. (Task 10: "hostile text is shown as text", and the test that renders
   the committed README.)
7. **A change to the display code that tries to hide itself, or a file of the commit that tries to run in
   step 1.** The page must be written without it. (Task 12: "`show` runs nothing of the commit"; Task 11,
   rule 12; Task 12's test of `since-last.sh`.)
8. **Two times in different forms.** The apply's time is GitHub's `Date` header; a record's time is ISO
   8601. Compared as text, every record reads as older than the apply. (Task 7: "a record made five seconds
   after the apply counts, though its text sorts before the apply's".)
9. **A line in the attributes file at the repository's root,** outside the trusted places, that makes git
   rewrite a trusted file as it checks it out. The job must refuse before it runs or reads that file.
   (Task 12: "a checkout that git rewrote is refused"; Task 11, rule 12.)
10. **A line that reads as a comment and holds live code:** a lone carriage return, U+2028 or U+2029 inside
    it, or the written form of one. The page must show where JavaScript begins a new line, and must show a
    written backslash as one. (Task 10: "a line end inside a line is drawn as a line end".)
11. **"Re-run failed jobs" pressed on a run that applied.** The newest attempt applied nothing. The run must
    still count as the last change applied. (Task 5: "a run that applied counts whatever a later attempt
    did".)
12. **`master` moves between the look and the apply,** or the look grows old while the kit is installed
    again. The apply must not be made on what was not judged. (Task 9: "step 3 does not apply unless the
    three reads of master's head give one commit", and "a look older than two minutes is made again".)
13. **A setting the file holds and Railway does not, at a value that is not the tool's default, in a plan
    whose details do not name it.** It must be refused, and nothing of it printed. (Task 2: "a key only in
    after that is not the tool's default is refused".)
14. **A settings file of npm inside the kit's own folder,** which npm would read as its "global" one once
    it is told that folder. It must not be read, and CI must refuse a commit that holds one. (Task 3: "no
    settings file of npm inside the kit's folder, or in the home folder, is read"; Task 11, rule 27.)
15. **A job whose proof refused, and a step of it with a condition of its own:** one that runs "always",
    or one whose `if` names `success()` and so sheds GitHub's own "only after success". No file of that
    checkout may be started, in any step. (Task 11: "no step of an approved job runs a file of the
    checkout when the proof did not pass", which lets no step have an `if` but three written out; Task
    13's job `proof-refused`, on a runner.)
16. **Cancel pressed while the job waits for the redeploy, or the job running out of time there.** The wait
    must stop, and the page must still say what was applied and that the redeploy is not confirmed, and
    must not say that the apply itself is unknown. (Task 11: "the long wait stops when the job is
    cancelled, and the summary is written by a step of its own"; Task 21's tests of `after` with
    `CANCELLED`; Task 13 on a runner.)
17. **A file name that holds a character which reverses the reading order, and another that holds the six
    written characters of its code.** The page must draw the two differently. (Task 10: "a name is drawn
    one to one, as the name of a removed file and as the target of a link".)

---

## File Structure

| File | Responsibility |
|---|---|
| `.github/railway-settings/plan-lines.mjs` | Read a pinned plan; build the lines (design 6.4); work out the refusals (design 6.3); say which lines to mark |
| `.github/railway-settings/tool.mjs` | The one place a process is started: the tool, by exact command; the runtime, to evaluate the settings file and to install the kit, with no token. Also the check of what was installed |
| `.github/railway-settings/evaluate-settings.mjs` | The script the runtime runs to evaluate a settings file |
| `.github/railway-settings/declared.mjs` | What the file declares, in the names Railway stores; the settings file's own check |
| `.github/railway-settings/gate.mjs` | The rules of design 6.1; the currency check; the last change this workflow applied |
| `.github/railway-settings/look.mjs` | The look of design 6.5: executing jobs, Railway's state, the running build |
| `.github/railway-settings/redeploy.mjs` | The verdict of design 6.6 from GitHub's deployment records |
| `.github/railway-settings/flow.mjs` | The order of the two token steps, with everything outside injected |
| `.github/railway-settings/words.mjs` | Every sentence and summary, and the one way text from outside is shown |
| `.github/railway-settings/cli.mjs` | Wiring only: reads the environment, calls the modules, writes outputs and summaries |
| `.github/railway-settings/exact.sh` | Prove that the trusted files of a checkout are byte for byte the files git holds; take an older commit's settings folder out of git as stored |
| `.github/railway-settings/install-runtime.sh`, `install-tool.sh`, `since-last.sh`, `run.sh` | Fetch and verify the runtime and the tool; take from git what changed since the last change applied; start `cli.mjs` under the pinned runtime |
| `.github/railway-settings/pins.json` | The tool's and the runtime's version, file name and two SHA-256 sums each |
| `.github/railway-settings-check/*.test.mjs`, `fixtures.mjs` | The tests, and made-up plans shaped like the one seen on 22 November |
| `.github/railway-settings-check/check-workflows.mjs` | The CI check of design 6.7 |
| `.github/railway-settings-check/watched.mjs` | Says whether a change touches a watched path |
| `.github/railway-settings-check/package.json`, `package-lock.json` | `yaml` and `marked`, pinned, for the check folder alone |
| `.github/workflows/railway-settings.yml` | The workflow, and the one place BASE is written |
| `.github/workflows/ci.yml` | The tooling job runs the tests and the check; the idle watch-list step is replaced |
| `.github/workflows/deploy.yml` | Its header comment only (pull request 2) |
| `docs/operations/railway-settings.md` | The README's new home (pull request 3) |

**Names every task uses.** The environment is `railway-settings`. The secret is `RAILWAY_SETTINGS_TOKEN`. The
jobs are `gate` ("Check the gate, show the change"), `plan` ("Read Railway's plan") and `apply` ("Apply this
plan"). The trusted folder is `.github/railway-settings/`; the check folder is
`.github/railway-settings-check/`. A test imports a module as `../railway-settings/<name>.mjs`. The refusal
sentence is `This change is applied by hand.`

**Copies and work folders.** A job can hold more than one copy of the trusted folder, so each copy keeps to
itself. `install-runtime.sh`, `install-tool.sh`, `run.sh` and `since-last.sh` each work out which copy they
are from where they sit under `GITHUB_WORKSPACE`: the folder `base`, the folder `code`, or the workspace's
root, which the approved jobs use and which is called `own`. Anywhere else they stop. `exact.sh` is told
which checkout to prove, because the first time a job runs it, it runs from the runner's temporary folder
and not from a checkout. The work folder on a runner is `$RUNNER_TEMP/railway-settings/`, called WORK
below. The `own` copy, in `plan` and `apply`, uses WORK itself: its runtime is `WORK/runtime/`, the tool
`WORK/tool/`, the pinned plan `WORK/plan.json`, the two readings of the settings file
`WORK/declared-now.json` and `WORK/declared-last.json`, and an older commit's settings folder, taken out of
git, `WORK/last/.railway/`. In `gate` the `base` copy uses `WORK/base/` and the `code` copy uses
`WORK/code/`, each for its own runtime, and what `exact.sh` and `since-last.sh` take from git goes to
`WORK/since/`. `run.sh` starts its own copy's `cli.mjs` under its own copy's runtime and tells it which
copy it is. BASE is the base commit, as "Who writes step 1" defines it.

**The approved jobs work inside their checkout, and must.** Railway's tool ties a plan to the settings
folder by asking git, in the folder it is run in, whether `.railway` is unchanged and what its tree id is
(the tool's public source at `v5.74.0`, `src/iac/saved_plan.rs`: `git status --porcelain -- .railway`, then
`git rev-parse HEAD:.railway`). Outside a checkout it writes another kind of id, which Task 1's reader
refuses. So the files an approved job runs are the checkout's own, proven against git before use, and not
a second copy in another folder. Note what that id does not do: it is git's id for the tree, and git calls
a file unchanged when its attributes would turn the file on disk back into the stored one. So neither the
tool's id, nor the check that a plan is what the settings file declares, binds the bytes that were run.
The proof does.

---

# Part one: pull request 1 (everything that needs no token)

Tasks 1 to 15. After it merges, a "Railway settings" workflow exists whose approved jobs do nothing with
Railway, CI checks every workflow file on every change, and nothing on Railway or in production has changed.

### Task 1: Read a plan and write its lines

**Files:**
- Create: `.github/railway-settings/plan-lines.mjs`, `.github/railway-settings-check/fixtures.mjs`
- Test: `.github/railway-settings-check/plan-lines.test.mjs`
- Modify: `.gitattributes` (add `.github/railway-settings/** text eol=lf` and
  `.github/railway-settings-check/** text eol=lf`, beside the line for `.github/gpu/**`)
- Modify: `.github/workflows/ci.yml` (`gate-tooling`, after the step at lines 621-631: a step
  `Railway settings from GitHub: the modules` running `node --test .github/railway-settings-check/*.test.mjs`)

**Interfaces:**
- Produces:
  - `HAND = 'This change is applied by hand.'`
  - `readPlan(text: string): Plan`. Parses, then checks the plan is in the shape seen on 22 November, and
    in no other. The check is an allow-list at three levels:
    - the plan holds exactly its eleven keys (`changeSet`, `changeSetHash`, `claim`, `cliVersion`,
      `configEtag`, `destructive`, `diff`, `environmentId`, `kind`, `sourceTree`, `version`), with
      `kind === 'railway.config.plan'`, `version === 1`, `cliVersion` and `diff` text, `sourceTree` 40 hex
      characters, `destructive` a boolean and `claim === true`, the value seen that day;
    - its three ids are in their forms: `environmentId` a UUID, `configEtag` 64 hex characters,
      `changeSetHash` a lower-case word, a colon and 64 hex characters;
    - `changeSet` holds exactly `changes`, `declared`, `diagnostics`, `telemetry` and `version`, with
      `version === 1`, three lists and a map. The tool can also write a key `partial` there; a plan that
      holds it is not this shape, and is not read;
    - every change is of one of the five kinds the tool writes at 5.74.0, and holds exactly that kind's
      keys, as the tool's public source writes them (`src/iac/change_set.rs` at the tag `v5.74.0`, lines
      181 to 198, 329 to 337, 806 to 841 and 1861 to 1885):

      | `kind` | Its keys, beside `kind`, `address`, `path`, `summary`, `severity` and `deployEffect` |
      |---|---|
      | `resource.update` | `field`, `before`, `after`, `details`. The tool leaves `details` out when it has none; such an update is not read |
      | `resource.create` | `resource`, and `details` or not |
      | `resource.delete` | `previous` |
      | `variable.set` | `variable`, `after`, `details`, and `before` or not |
      | `variable.delete` | `variable`, `previous` |

      A change of any other kind, or with one key more or one fewer than its row, is not read.
    Anything else throws an `Error` whose message is exactly `Railway's plan could not be read.` The
    message never quotes the text it was given. One key more at any level is a shape nobody has seen: a
    later version of the tool could put there a list of things to do that no line shows.
    **Why five kinds and not one.** Only an update is ever applied from GitHub. But a plan that adds a
    service, deletes a database or touches a variable must come through the reader, so that Task 2 can
    refuse it with its reasons and step 2 can say "this change is applied by hand" (design 6.8). Held to
    an update's keys, such a plan would end as "could not be read", and send a person to the tool or the
    token when the cause is on Railway's dashboard. Of the four other kinds `renderPlan` reads `kind`,
    `severity` and `deployEffect`, and nothing else: nothing of `resource`, `previous`, `variable`,
    `before`, `after`, `path`, `summary` or `details` reaches a line or a reason. A variable's name stands
    in four of those.
    **What a plan that was not read says.** Step 2 and step 3 say `planShape` (Task 10), which has no exit
    code: the tool exited 0. `planFailed`, with its code, is for a tool that exited otherwise.
  - `renderPlan(plan, ctx): { pending: boolean, agreed: boolean, lines: string[], refusals: string[], deploys: boolean }`,
    where `ctx = { service, sourceTree, toolVersion, declaredLast, declaredNow }`. `declaredLast` and
    `declaredNow` are `{ build: object, deploy: object }` in the names Railway stores (Task 4), or `null`.
    `agreed` is the one answer to "does Railway hold what the file declares?": true only when the plan holds
    no change and nothing is against it. Nothing else may be read as "already up to date".
  - `digestLines(lines: string[]): string`, the SHA-256 of `JSON.stringify(lines)` in hex.
  - `planIds(plan): string[]`, the values to mask: `environmentId`, `configEtag`, `changeSetHash`. A plan
    that came through `readPlan` has all three.
  - `showValue(value): string` and `writeLine(name, oldText, newValue): string`, the one way a value and a
    line are written. A value is compact JSON with keys sorted, `(not set)` for `null` or missing, and every
    character outside printable ASCII written as `\uXXXX`. So a line is printable ASCII and nothing else.
  - `lineMark(line: string): 'the pre-deploy command' | 'the health check' | 'the region' | 'sleep' | null`.
    By the line's name: `deploy.preDeploy...` is the pre-deploy command; `deploy.healthcheckPath` and
    `deploy.healthcheckTimeout` are the health check; `deploy.multiRegionConfig` and anything under it is
    the region; `deploy.sleepApplication` is sleep. The mark is added to what is shown (Task 10), never to
    the lines themselves, so the lines the two steps compare are unchanged by it.
  - In `fixtures.mjs`: `plan(changes, overrides?)`, `change(overrides?)` and `CTX`; and one maker for each
    of the four other kinds, in the tool's exact keys: `created(overrides?)`, `deleted(overrides?)`,
    `variableSet(overrides?)` and `variableDeleted(overrides?)`.

**The shape seen on 22 November,** which the fixtures copy with made-up values. A plan has `kind`, `version`,
`cliVersion`, `sourceTree`, `environmentId`, `configEtag`, `changeSetHash`, `changeSet`, `diff`, `destructive`
and `claim`. `changeSet` has `changes`, `declared`, `diagnostics`, `telemetry` and `version`. A change has
`address` (`service.<name>`), `kind` (`resource.update`), `field` (`build` or `deploy`), `path`
(`resources.service.<name>.<field>`), `severity` (`safe`), `deployEffect` (`deploy`), `summary`, `details`,
`before` and `after`. A detail is one string: `deploy.healthcheckTimeout (2700 → 3000)`, with JSON on both
sides of the arrow and `null` for "not set". `after` holds what the file declares for that group. `before`
holds what Railway runs with, including settings the file does not declare and defaults Railway fills in: one
detail that day said `null` where `before` held a default. Two things follow: a key that is in `before` and
not in `after` is not a change, and the details, not `before`, say what changes and what the old value was.

**How the tool writes a detail,** read from its public source at the tag `v5.74.0` (the file
`src/iac/change_set.rs`) and not only from the one plan seen. The fixtures and the reader follow it:
- before it compares, the tool leaves out of both sides any setting that holds its own default. The
  defaults it knows are, for `build`: `builder` `RAILPACK`, `buildEnvironment` `V3`, `buildCommand` empty
  text, `dockerfilePath` `Dockerfile`, `watchPatterns` an empty list; for `deploy`: `useLegacyStacker`
  `false`, `ipv6EgressEnabled` `false`, `runtime` `V2`, `sleepApplication` `false`, `restartPolicyType`
  `ON_FAILURE`, `restartPolicyMaxRetries` `10`, and a `multiRegionConfig` of one region with one replica;
- a detail names the deepest setting that differs, so a value that equals a default is written `null` on
  its side of the arrow;
- a count of replicas, `deploy.multiRegionConfig.<region>.numReplicas`, is written under a shorter name:
  `regions.<region>`;
- a credential for a registry is written as a marker that is not JSON;
- `before` and `after` in the change are as Railway and the file hold them, with nothing left out.

`change()` is the update above for the service `example-api`, with `before` and `after` each holding
`healthcheckPath`, `healthcheckTimeout`, `startCommand` and `multiRegionConfig` (one made-up region, one
replica), and `before` also holding `runtime`. An override of `before` or `after` is merged into the default
key by key, and an override of `undefined` removes a key: a plan read from a file holds no key with no
value. Every other override replaces the default whole. When a test's own details do not name the health
check's time, that time stays in `after` as Railway holds it. `plan(changes)` wraps them with
`cliVersion: '5.74.0'`, a `sourceTree` of forty `1`s, `environmentId: '00000000-0000-4000-8000-000000000001'`,
a made-up `configEtag` and `changeSetHash` in their forms, `claim: true`, `destructive: false`,
`declared: ['service.example-api']` and no diagnostics.

The four other makers copy the tool's shapes with made-up values. `created()` is a new service named
`made-up-worker`: `resource` holds it, `severity` is `safe`. `deleted()` is a database of that name:
`previous` holds it, `severity` is `destructive`. `variableSet()` sets `MADE_UP_NAME` on the service:
`variable` is the name, `path` ends `.variables.MADE_UP_NAME`, `summary` and its one detail name it too,
`severity` is `safe`. `variableDeleted()` deletes it: `previous` holds its value, `severity` is
`destructive`. None of the four has a `field`. A test that holds a destructive change also passes
`destructive: true` to `plan`, as the tool sets it for the whole plan.

`CTX` is `{ service: 'example-api', sourceTree: <the same forty 1s>, toolVersion: '5.74.0', declaredLast: { build: {}, deploy: <change().before without runtime> },
declaredNow: { build: {}, deploy: <change().after> } }`.

**How a line is built.** A change is read at all only when it is an update this workflow applies and its
`after` equals `ctx.declaredNow[field]`, what the settings file's own reading declares for that group
(Task 2). Then, for each of its details:

1. Read it as `<name> (<old> → <new>)`. `<name>` is `build` or `deploy` followed by one or more dotted parts
   of letters, digits, `_` and `-`. Inside a `deploy` change the tool's short name `regions.<region>` is
   read as `deploy.multiRegionConfig.<region>.numReplicas`, and the line is written under that full name. A
   name with a part `variables` is never read (design 6.4). Split the bracket's contents at an arrow so
   that both sides are JSON; exactly one split must work.
2. The name must be one the public file shows: an own path of `after`, or of `ctx.declaredLast[field]`. A
   name only Railway holds is not printed, in a line or in a reason. It could be a variable's, and printing
   it would tell the public that Railway holds a value there.
3. The new value is `after` at that name. It must equal `<new>` (deep, key order ignored), with `null` equal
   to a missing key. `<new>` may also be `null` when `after` holds the tool's own default for that name,
   from the table `TOOL_DEFAULTS`: that is how the tool writes a change back to a default. The line shows
   the file's value.
4. The old value is shown only when it equals `declaredLast` at that name. `null` equals a missing key, and
   a `null` old value equals a default that `declaredLast` holds under that name. When `declaredLast` is
   known and differs, the line says `(Railway holds something else)`. When there is no `declaredLast` at
   all, the old value reads `(hidden)`: nothing is known to compare it with.

`TOOL_DEFAULTS` is the list of defaults above, by full name, with `1` for any
`deploy.multiRegionConfig.<region>.numReplicas`. It names the tool's version it was read from, in
`TOOL_DEFAULTS_FOR`, and Task 12's test of the pins fails when the pinned tool is another version.

The lines, sorted by name, then one last line binding everything the file declares for the changed groups:

```
deploy.drainingSeconds: (not set) -> 30
deploy.healthcheckTimeout: 2700 -> 3000
deploy.multiRegionConfig.made-up-region-1.numReplicas: 1 -> 2
deploy.sleepApplication: (hidden) -> false
deploy.startCommand: (Railway holds something else) -> "node server.js"
1 change is outside what this workflow applies.
declared: 3f9a0c1e5b7d2a46
```

(The lines above show every form at once. One plan would not hold `(hidden)` beside a shown old value for
the same group.)

Values are written by `showValue`. `declared:` is the first 16 hex characters of the SHA-256 of the changes'
`after` objects, keys sorted. A change that is not allowed is counted, never described.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlan, renderPlan, digestLines, planIds, lineMark } from '../railway-settings/plan-lines.mjs';
import { plan, change, created, deleted, variableSet, variableDeleted, CTX } from './fixtures.mjs';

test('a plan with no change is not pending and has no lines', () => {
  assert.deepEqual(renderPlan(plan([]), CTX), { pending: false, agreed: true, lines: [], refusals: [], deploys: false });
});
test('a safe update reads as the design writes it', () => {
  const r = renderPlan(plan([change()]), CTX);
  assert.equal(r.lines[0], 'deploy.healthcheckTimeout: 2700 -> 3000');
  assert.match(r.lines.at(-1), /^declared: [0-9a-f]{16}$/);
  assert.deepEqual([r.pending, r.deploys, r.refusals], [true, true, []]);
});
test('an old value the file never declared is not shown', () => {
  const drifted = change({ details: ['deploy.startCommand ("node made-up-old.js" → "node server.js")'] });
  const r = renderPlan(plan([drifted]), CTX);
  assert.equal(r.lines[0], 'deploy.startCommand: (Railway holds something else) -> "node server.js"');
  assert.ok(!JSON.stringify(r).includes('made-up-old'));
});
test('a setting Railway did not hold, and the file did not declare, reads as not set', () => { /* null → 30 */ });
test('settings only Railway stores are not lines', () => { /* before.runtime never appears */ });
test('with no last agreed declaration every old value is hidden', () => { /* declaredLast: null */ });
test('the same plan gives the same lines and digest; a different after gives a different last line', () => { /* digestLines */ });
test('the ids to mask are the three the plan holds, and none of them is in a line', () => { /* planIds */ });
test('a file that is not a plan cannot be read', () => {
  for (const text of ['', '{}', '[]', JSON.stringify({ ...plan([]), kind: 'something.else' }), 'not json'])
    assert.throws(() => readPlan(text), { message: "Railway's plan could not be read." });
});
// The build review's second major. Each of these failed before the exact key sets were written.
const unreadable = (p) => assert.throws(() => readPlan(JSON.stringify(p)), { message: "Railway's plan could not be read." });
test('a plan with a key nobody has seen is not read, at any of its three levels', () => {
  unreadable({ ...plan([]), deletions: ['made-up'] });
  const p = plan([change()]);
  unreadable({ ...p, changeSet: { ...p.changeSet, partial: 'made-up' } });
  unreadable({ ...p, changeSet: { ...p.changeSet, changes: [{ ...change(), more: 'made-up' }] } });
});
test('a plan with a key missing is not read either', () => {
  const { claim, ...noClaim } = plan([]); unreadable(noClaim);
  const { details, ...noDetails } = change(); unreadable(plan([noDetails]));
});
test('a claim that is not the one seen, or an id out of its form, is not read', () => {
  unreadable(plan([], { claim: false }));
  for (const id of ['environmentId', 'configEtag', 'changeSetHash']) {
    unreadable(plan([], { [id]: 'made-up' }));
    unreadable(plan([], { [id]: undefined }));
  }
});
test('the fixture itself is read', () => assert.doesNotThrow(() => readPlan(JSON.stringify(plan([change()])))));
// Each kind of change the tool writes is read in its own keys, so that Task 2 can refuse it by its reasons.
test('the four other kinds of change are read in the tool\'s own keys', () => {
  for (const c of [created(), created({ details: ['made-up detail'] }), deleted(), variableSet(), variableSet({ before: 'x' }), variableDeleted()])
    assert.doesNotThrow(() => readPlan(JSON.stringify(plan([c]))), c.kind);
});
test('a kind the tool does not write, or a kind with another kind\'s keys, is not read', () => {
  unreadable(plan([{ ...created(), kind: 'domain.create' }]));
  unreadable(plan([{ ...created(), field: 'deploy' }]));          // a create holds no field
  unreadable(plan([{ ...deleted(), resource: {} }]));             // a delete holds previous, and no resource
  unreadable(plan([{ ...change(), kind: 'resource.create' }]));   // an update's ten keys under another kind
  const { variable, ...noName } = variableSet(); unreadable(plan([noName]));
});
// What the tool's own grammar writes (design 6.3's region mark, and a change back to a default).
test('a count of replicas written under the tool\'s short name is read, under its full name', () => {
  const more = change({ details: ['regions.made-up-region-1 (1 → 2)'], after: { multiRegionConfig: { 'made-up-region-1': { numReplicas: 2 } } } });
  const r = renderPlan(plan([more]), { ...CTX, declaredNow: { build: {}, deploy: more.after } });
  assert.deepEqual(r.refusals, []);
  assert.equal(r.lines[0], 'deploy.multiRegionConfig.made-up-region-1.numReplicas: 1 -> 2');
  assert.equal(lineMark(r.lines[0]), 'the region');
});
test('from the default of one replica, the tool writes the old side as null, and the line still reads 1', () => {
  // One replica in one region is the tool's own default, so it writes (null → 2), never (1 → 2).
  const more = change({ details: ['regions.made-up-region-1 (null → 2)'], after: { multiRegionConfig: { 'made-up-region-1': { numReplicas: 2 } } } });
  const r = renderPlan(plan([more]), { ...CTX, declaredNow: { build: {}, deploy: more.after } });   // CTX's last declaration holds one replica
  assert.deepEqual(r.refusals, []);
  assert.equal(r.lines[0], 'deploy.multiRegionConfig.made-up-region-1.numReplicas: 1 -> 2');
  assert.equal(lineMark(r.lines[0]), 'the region');
});
test('a value the tool writes as null because it is the tool\'s default is read as that default', () => {
  // sleep turned off again: Railway held true, the file declares false, and the tool writes (true → null)
  const off = change({ details: ['deploy.sleepApplication (true → null)'], before: { sleepApplication: true }, after: { sleepApplication: false } });
  const r = renderPlan(plan([off]), { ...CTX, declaredNow: { build: {}, deploy: off.after } });
  assert.deepEqual(r.refusals, []);
  assert.match(r.lines[0], /^deploy\.sleepApplication: .* -> false$/);
  // null for a setting whose value in the file is not the tool's default is still a disagreement
  const wrong = change({ details: ['deploy.healthcheckTimeout (2700 → null)'] });
  assert.ok(renderPlan(plan([wrong]), CTX).refusals.includes('a line could not be read'));
});
test('a value outside printable ASCII is written as its code, so a line is plain ASCII', () => {
  const c = change({ details: ['deploy.startCommand ("node server.js" → "a\u202eb\u2028c<b>`")'], after: { startCommand: 'a\u202eb\u2028c<b>`' } });
  const line = renderPlan(plan([c]), { ...CTX, declaredNow: { build: {}, deploy: c.after } }).lines[0];
  assert.match(line, /^[\x20-\x7e]+$/);
  assert.ok(line.includes('\\u202e') && line.includes('\\u2028'));
});
test('the four kinds of line whose meaning matters most are marked, and no other', () => {
  assert.equal(lineMark('deploy.preDeployCommand: ["a"] -> ["b"]'), 'the pre-deploy command');
  assert.equal(lineMark('deploy.preDeployTimeoutSeconds: 900 -> 1'), 'the pre-deploy command');
  assert.equal(lineMark('deploy.healthcheckPath: "/a" -> "/b"'), 'the health check');
  assert.equal(lineMark('deploy.healthcheckTimeout: 2700 -> 3000'), 'the health check');
  assert.equal(lineMark('deploy.multiRegionConfig.made-up-region-1.numReplicas: 1 -> 2'), 'the region');
  assert.equal(lineMark('deploy.sleepApplication: false -> true'), 'sleep');
  for (const line of ['deploy.drainingSeconds: 30 -> 40', 'build.builder: (not set) -> "DOCKERFILE"',
                      'declared: 3f9a0c1e5b7d2a46', '1 change is outside what this workflow applies.'])
    assert.equal(lineMark(line), null, line);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test .github/railway-settings-check/plan-lines.test.mjs`
Expected: FAIL, `Cannot find module` for `plan-lines.mjs`.

- [ ] **Step 3: Write `fixtures.mjs` and `plan-lines.mjs`** with the exports above. In this task every change
  is treated as allowed; Task 2 adds the refusals.

- [ ] **Step 4: Run the tests**

Run: `node --test .github/railway-settings-check/plan-lines.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/plan-lines.mjs .github/railway-settings-check/fixtures.mjs .github/railway-settings-check/plan-lines.test.mjs .gitattributes .github/workflows/ci.yml
git commit -m "feat(ci): read a Railway plan and write its lines (T-751)"
```

**As built** (read from the code on 27 November). `plan-lines.mjs` holds what is written above:
- `readPlan` with the exact keys of the plan and of its change set, each of the five kinds of change held
  to its own keys, the three id forms and `claim === true`, with the four makers in `fixtures.mjs`;
- the tool's short name `regions.<region>`, `TOOL_DEFAULTS` and `TOOL_DEFAULTS_FOR`, a `null` read as a
  default on either side of a detail, and `showValue` writing every character outside printable ASCII as
  its code. **The defaults are used only for a plan made by the version they were read from:** for a plan
  whose `cliVersion` is not `TOOL_DEFAULTS_FOR`, a `null` is a `null`. Such a plan is refused in any case
  (Task 2), and its lines then guess at nothing;
- a name with a part `variables` is never read, and beyond that, a change whose `after` holds a key
  `variables` at any depth has no line at all and is refused as `a line could not be read`;
- `renderPlan` returning `agreed`; `showValue` and `writeLine`, which Task 4 used too;
- a name is `build` or `deploy` and then dotted parts of letters, digits, `_` and `-`. A name every object
  answers to (`constructor`, say) is read as a setting's own key or not at all;
- rule 2, as the build review's fourth major asked: a name is printed only when it is an own path of `after`
  or of `declaredLast[field]`;
- the old value reads `(hidden)` only when there is no `declaredLast` at all. The first wording's fourth
  rule, and its line about the kit and the tool reading the file differently, are gone: such a change is
  now refused whole (Task 2, `the plan is not what the settings file declares`);
- the lines are ordered by name, whatever order Railway gives them.

Its test file holds 34 tests.

**One thing settled, and nothing still to change there.** A plan line writes a character outside printable
ASCII as its code in small letters, `\u202e`, and a page writes one in a file's text or a name in capitals,
`\u202E` (Task 10). Both stay. A line's value is JSON, and JSON's own codes are in small letters, so a line
is one text a reader could parse. A file's text is not JSON, and its codes are the page's own. Nothing
compares the two, and each form is pinned by its own test.

**What a person sees:** nothing yet. CI's tooling job runs these tests.

### Task 2: What step 3 refuses

**Files:**
- Modify: `.github/railway-settings/plan-lines.mjs`
- Test: `.github/railway-settings-check/plan-refusals.test.mjs`

**Interfaces:**
- Produces: `renderPlan(...).refusals`, a list of fixed reasons, empty when the plan may be applied. The
  reasons, each at most once, in this order:
  - `the plan is for another version of the tool` (`cliVersion !== ctx.toolVersion`)
  - `the plan is for another copy of the settings folder` (`sourceTree !== ctx.sourceTree`)
  - `Railway marks the plan as destructive` (`destructive !== false`)
  - `Railway attached a note to the plan` (`diagnostics` not empty)
  - `it is not an update to this service's build or deploy settings` (a change whose `kind` is not
    `resource.update`, whose `field` is not `build` or `deploy`, whose `address` is not
    `service.<ctx.service>`, or whose `path` is not `resources.service.<ctx.service>.<field>`; or `declared`
    is not exactly `['service.<ctx.service>']`)
  - `the plan is not what the settings file declares` (an update of this service whose `after` does not
    equal `ctx.declaredNow[field]`, or there is no such reading to hold it to). Nothing of that change is
    read into a line or a reason
  - `Railway does not mark it safe` (`severity !== 'safe'`)
  - `it has an effect this workflow does not know` (`deployEffect !== 'deploy'`)
  - `a line could not be read` (a detail fails rule 1, 2 or 3 of Task 1; or one of the rules of "What must have a line" below)
  - `it empties <name>`, once per name. A value is empty when it is not set, blank text, or a list or map
    that holds nothing but empty values; nought and `false` are values. The reason is given for: a detail
    whose new value is empty; any empty value in `after`, whether or not a detail names it; and any setting
    that `ctx.declaredLast[field]` holds with a value, that `after` holds empty or not at all, and that
    `before` still holds at a value other than the tool's own default ("A setting the file stops
    declaring", below)
  - `it lowers the number of replicas` (the sum of `numReplicas` over `after.multiRegionConfig` is below the
    sum over `before.multiRegionConfig`, or `after` has no `multiRegionConfig` and `before` has)
- A change that fails the fifth reason is never rendered: it adds one to the line
  `<n> change(s) is/are outside what this workflow applies.` Its address, summary and details are never read
  into a line.
- "Resources" in design 6.3 means what the file's project holds: services, databases and volumes. The fifth
  reason covers them: the file declares one service, so a plan that adds, removes or touches any other
  resource is not "an update to this service".
- The refusals are worked out for a plan with no change too. A plan for another copy of the folder holds no
  line and one reason, and Task 9 reads the reasons before it asks whether anything is pending.

**What must have a line, said exactly** (the release lead's review, and the build review's first and third
majors). Everything a plan would write is shown only through its details, so:

- **An update with nothing a line can be built from is refused:** a change with an empty `details` list.
  It would be applied with no line to read.
- **A setting that changes with no detail naming it is refused, at every depth.** For a key that `before`
  and `after` both hold at different values, every place under it where the two differ must be a detail's
  name or lie under one. A detail that names the key itself covers all of it. A detail that names one
  place under it covers that place and no other: with two regions that differ and a detail for one, the
  plan is refused. A name that only begins like the key's does not name it.
- **A key that is only in `after`, with no detail naming it, passes only when its value is the tool's own
  default for that key.** This is the one case in which the tool writes no detail for something the file
  declares: the file declares a setting at the value Railway already runs with as the tool's default, so
  nothing changes, and `before` does not hold the key. The plan seen on 22 November carried four such keys,
  and each held exactly its default. So the rule is as narrow as its reason: the key's full name must be in
  `TOOL_DEFAULTS` (Task 1), for a plan made by the version that table was read from, and the value must
  equal the default. **Anything else is refused as `a line could not be read`:** a value that is not the
  default, and a key for which no default is known. **A region map is always among them.** The tool calls
  one replica in one region its default whatever the region, and writes no detail for it. A map only the
  file holds would then pass with no line and no mark, and the apply would set that region: a move of
  region that nobody read, which design 6.3 wants marked. The plan seen on 22 November had no such key, so
  nothing real is lost by refusing it. So `multiRegionConfig` has no default in this rule, though its
  counts of replicas have one in a detail (Task 1). Nothing of that key is printed, its name no more than its value. Without this, a new
  start command, a pre-deploy command, sleep turned on, a cron schedule or nought replicas could be applied
  behind one harmless line, if a plan's details ever failed to name them. The last line, `declared:`, binds
  the whole of `after` in any case. (An earlier wording of this rule let any value through. The build's
  second review showed what that passed, and the rule was tightened.)
- **A key that is only in `before` is not the file's to change,** and is never a line: Railway stores
  settings the file does not declare.
- **A setting the file stops declaring is refused, with or without a line for it, while applying would
  clear something on Railway.** Leaving a setting out of the file clears it, and `before` cannot say which
  of its settings were ever the file's. The file's own declaration at the last change applied can, so the
  rule reads `ctx.declaredLast`. It refuses, `it empties <name>`, when three things hold: `declaredLast`
  holds the setting with a value; `after` holds it empty or not at all; and `before` still holds it, at a
  value that is not the tool's own default for it (`TOOL_DEFAULTS`, for a plan of that version; a setting
  with no known default counts as not a default). **When Railway no longer holds the setting, or holds only
  the tool's default, nothing would be cleared and there is no refusal.** Without that last test the rule
  would refuse a plan that empties nothing, and go on refusing: the last change applied moves only when a
  run applies, so after a setting at its default was tidied out of the file, or after any refused change
  was made by hand as its sentence asks, every later change to that group would be refused for good with
  a reason that is false. With no `declaredLast` (every run until the first change is applied) this rule
  cannot fire, and the refusal rests on the detail the tool writes for a cleared setting,
  `(<old> → null)`, which 5.74.0 does write for any setting that is not one of its defaults.
  **There are two ways out of this refusal, and the file is the first.** While Railway holds the dropped
  setting at a value of its own, every plan for that group is refused, and that is right: applying would
  clear it. Two things end it. Name the setting in the file again, at the value Railway holds, in a reviewed pull request; or
  clear it on Railway by hand, with his yes, after which Railway no longer holds it and the rule is
  silent. A region map counts as held at a value of its own whatever it holds, one replica in one region
  included: this rule knows no default for a map, as the rule above knows none. And Railway holds a map
  for every running service, so a map is never cleared: for it the first way is the only one. Task 25's
  page says both ways out, and this, beside the refusal's row.

The equality with `declaredNow` is the one link between everything checked with no token and what the tool
applies. It is also why a new value may be printed: the public file shows it.

**As built** (read from the code on 27 November). The reasons are the eleven sentences above, in that
order, each at most once. Beyond the list, the build kept these, each under one of those sentences:
- `a line could not be read` also when: a group (`build`, `deploy`) is updated twice in one plan; a setting
  is named twice; a detail names another group than its change's `field`; `before` is not an object; a
  count of replicas cannot be counted; an empty value sits under a key that is not a name the reader could
  print;
- `it lowers the number of replicas` also when replicas are given as one number (`numReplicas`), and when a
  detail's own old value says there were more than `before` shows;
- `it is not an update to this service's build or deploy settings` also when the run names no service;
- `the plan is for another version of the tool` and `... another copy of the settings folder` also when the
  context holds no version or no tree to compare with.
The build review's four majors are in the code as this task now words them, each with tests written first:
the plan must be what the file declares; the exact shape (Task 1); a setting the file stops
declaring; a name only Railway holds. The first build's test that expected
`it empties deploy.constructor` is turned round, as below.

The refusal of a name with a part `variables`, and of any `variables` key inside a change's `after`, is
built, and so are the short name and the defaults of Task 1.

Both rules the build's second review asked for are built: a key only in `after` passes only at the
tool's default, and a difference under a key needs its own detail. And the build kept one thing stricter
than the plan then asked, which the plan now asks too: a region map only in `after`, with no detail
naming it, is always refused. The dropped-setting rule refuses only while `before` still holds the
setting at a value that is not the tool's default, with the two tests below, both ways, and the test of
the real shape takes the four real keys. Its test file holds 53 tests.

**Still to change there:** nothing.

- [ ] **Step 1: Write the failing tests**

```js
// In these tests the file's own reading agrees with what each update of the service declares, unless a
// test gives another context: what a plan is refused for here is something else.
const inScope = (c) => c?.kind === 'resource.update' && c.address === 'service.example-api' && c.path === `resources.service.example-api.${c.field}`;
function reading(changes, ctx = CTX) {
  const declaredNow = {};
  for (const c of changes) if (inScope(c) && c.after && !Object.hasOwn(declaredNow, c.field)) declaredNow[c.field] = c.after;
  return { ...ctx, declaredNow: { ...ctx.declaredNow, ...declaredNow } };
}
const refusals = (changes, over) => renderPlan(plan(changes, over), reading(changes)).refusals;
const text = (changes, over) => JSON.stringify(renderPlan(plan(changes, over), reading(changes)));
const replicas = (n, region = 'made-up-region-1') => ({ [region]: { numReplicas: n } });
const mapDetail = (from, to) => `deploy.multiRegionConfig (${JSON.stringify(from)} → ${JSON.stringify(to)})`;
const declaredThen = (more) => ({ ...CTX, declaredLast: { build: {}, deploy: { ...CTX.declaredLast.deploy, ...more } } });

test('a safe update is not refused', () => assert.deepEqual(refusals([change()]), []));
test('an emptied setting is refused by name', () => {
  // `after: {}` merges nothing in, so the command is missing from `after`. The name may be printed
  // because the file declared the command at the last change applied (Task 1, rule 2).
  const emptied = change({ details: ['deploy.preDeployCommand (["node migrate.js"] → null)'],
    before: { preDeployCommand: ['node migrate.js'] }, after: {} });
  const ctx = declaredThen({ preDeployCommand: ['node migrate.js'] });
  assert.deepEqual(renderPlan(plan([emptied]), reading([emptied], ctx)).refusals, ['it empties deploy.preDeployCommand']);
});
test('a removed domain is refused, however Railway words it', () => {
  for (const c of [change({ field: 'domains', path: 'resources.service.example-api.domains' }),
                   change({ field: 'networking', path: 'resources.service.example-api.networking' }),
                   change({ kind: 'resource.delete', address: 'domain.made-up.example' })])
    assert.deepEqual(refusals([c]), ["it is not an update to this service's build or deploy settings"]);
});
test('an added service, database or volume is refused and its name is never printed', () => {
  for (const address of ['service.made-up-worker', 'database.made-up-worker', 'volume.made-up-worker']) {
    const added = change({ kind: 'resource.create', address, summary: 'Create made-up-worker' });
    assert.ok(refusals([added]).length > 0, address);
    assert.ok(!text([added]).includes('made-up-worker'), address);
  }
});
test('anything under variables is refused and nothing of it is rendered', () => {
  for (const c of [change({ kind: 'variable.set', address: 'service.example-api', path: 'resources.service.example-api.variables.MADE_UP_NAME', summary: 'Set variable MADE_UP_NAME' }),
                   change({ kind: 'variable.delete', path: 'resources.service.example-api.variables.MADE_UP_NAME' })]) {
    assert.ok(refusals([c]).length > 0);
    assert.ok(!text([c]).includes('MADE_UP_NAME'));
  }
});
// Design 6.8: a plan that adds, deletes or touches variables is applied by hand, with its reasons. These go
// through the reader first, in the tool's own shapes. Held to an update's keys, they were never read at all.
const read = (changes, over) => renderPlan(readPlan(JSON.stringify(plan(changes, over))), CTX);
test('an added service, a deleted database and a variable change are read, refused by their reasons, and never described', () => {
  const OUT = "it is not an update to this service's build or deploy settings";
  const GONE = ['Railway marks the plan as destructive', OUT, 'Railway does not mark it safe'];
  assert.deepEqual(read([created()]).refusals, [OUT]);
  assert.deepEqual(read([deleted()], { destructive: true }).refusals, GONE);
  assert.deepEqual(read([variableSet()]).refusals, [OUT]);
  assert.deepEqual(read([variableDeleted()], { destructive: true }).refusals, GONE);
  for (const c of [created(), deleted(), variableSet(), variableDeleted()]) {
    const r = read([c]);
    assert.deepEqual(r.lines, ['1 change is outside what this workflow applies.'], c.kind);
    assert.ok(!/made-up-worker|MADE_UP_NAME/.test(JSON.stringify(r)), c.kind);
  }
});
test('a safe update beside an added service: the update has its line, the other is counted, and the plan is refused', () => {
  const r = read([change(), created()]);
  assert.deepEqual(r.lines.slice(0, 2), ['deploy.healthcheckTimeout: 2700 -> 3000', '1 change is outside what this workflow applies.']);
  assert.deepEqual(r.refusals, ["it is not an update to this service's build or deploy settings"]);
});
test('fewer replicas are refused; more are not', () => {
  // Each case gives its own maps: the fixture's merge would otherwise keep the default one.
  const fewer = change({ details: [mapDetail(replicas(2), replicas(1))], before: { multiRegionConfig: replicas(2) } });
  assert.deepEqual(refusals([fewer]), ['it lowers the number of replicas']);
  const more = change({ details: [mapDetail(replicas(1), replicas(2))], after: { multiRegionConfig: replicas(2) } });
  assert.deepEqual(refusals([more]), []);
  const removed = change({ details: [mapDetail(replicas(1), null)], after: { multiRegionConfig: undefined } });
  assert.deepEqual(refusals([removed]), ['it empties deploy.multiRegionConfig', 'it lowers the number of replicas']);
  // The rule is the sum: one replica named in another region is not fewer.
  const moved = change({ details: [mapDetail(replicas(1), replicas(1, 'made-up-region-2'))], after: { multiRegionConfig: replicas(1, 'made-up-region-2') } });
  assert.deepEqual(refusals([moved]), []);
  // As the tool itself writes them: under the short name, with null for the default of one replica.
  const fewerShort = change({ details: ['regions.made-up-region-1 (2 → null)'], before: { multiRegionConfig: replicas(2) } });
  assert.deepEqual(refusals([fewerShort]), ['it lowers the number of replicas']);
});
test('a change Railway does not mark safe, or a plan it marks destructive, is refused', () => { /* severity, destructive */ });
test('an effect this workflow does not know is refused', () => { /* deployEffect: 'restart' */ });
test('a plan made by another version of the tool, or for another copy of the folder, is refused', () => { /* cliVersion, sourceTree */ });
test('a line the reader cannot parse is refused', () => {
  for (const d of ['deploy.startCommand changed', 'deploy.startCommand ("a" → "b" → "c")', 'source.branch ("a" → "b")',
                   'deploy.healthcheckTimeout (2700 → 9999)' /* disagrees with after */])
    assert.ok(refusals([change({ details: [d] })]).includes('a line could not be read'));
});
test('a new value that itself holds an arrow and a bracket is read whole', () => {
  // `after` here is the default `after` with the start command replaced: the fixture merges key by key.
  const c = change({ details: ['deploy.startCommand ("old" → "run (a → b)")'], after: { startCommand: 'run (a → b)' } });
  assert.deepEqual(refusals([c]), []);
});
test('a safe update beside a refused change: the safe one is rendered, the other only counted', () => { /* two changes */ });
test('a change of meaning only is not refused: a pre-deploy command that does nothing passes, and is marked', () => {
  const c = change({ details: ['deploy.preDeployCommand (["node migrate.js"] → ["true"])'],
    before: { preDeployCommand: ['node migrate.js'] }, after: { preDeployCommand: ['true'] } });
  const r = renderPlan(plan([c]), reading([c]));
  assert.deepEqual(r.refusals, []);
  assert.equal(lineMark(r.lines[0]), 'the pre-deploy command');
});

// The build review's four majors. Each test failed before its rule was written.
// The first: the plan must be what the file's own reading declares.
test('a plan that is not what the settings file declares is refused, and nothing of that change is printed', () => {
  const c = change({ details: ['deploy.startCommand ("node server.js" → "node made-up-other.js")'], after: { startCommand: 'node made-up-other.js' } });
  const r = renderPlan(plan([c]), CTX);   // CTX's reading still says node server.js
  assert.deepEqual(r.refusals, ['the plan is not what the settings file declares']);
  assert.ok(!JSON.stringify(r).includes('made-up-other'));
});
test('with no reading of the file to hold the plan to, the plan is refused', () => {
  assert.deepEqual(renderPlan(plan([change()]), { ...CTX, declaredNow: null }).refusals, ['the plan is not what the settings file declares']);
});
// What changes must have a line.
test('an update with nothing a line can be built from is refused', () => {
  assert.deepEqual(refusals([change({ details: [] })]), ['a line could not be read']);
});
test('a setting that changes with no detail naming it is refused', () => {
  // The one detail names the health check. The start command changes too, in silence.
  assert.deepEqual(refusals([change({ after: { startCommand: 'node something-else.js' } })]), ['a line could not be read']);
  // A difference deep inside a setting is a difference: the one replica named in another region.
  assert.deepEqual(refusals([change({ after: { multiRegionConfig: replicas(1, 'made-up-region-2') } })]), ['a line could not be read']);
  // Named by a detail of something below it: read.
  const below = change({ details: ['deploy.healthcheckTimeout (2700 → 3000)', 'deploy.multiRegionConfig.made-up-region-1.numReplicas (1 → 2)'], after: { multiRegionConfig: replicas(2) } });
  assert.deepEqual(refusals([below]), []);
  // A name that only begins like the setting's does not name it.
  const beside = change({ details: ['deploy.healthcheckTimeout (2700 → 3000)', 'deploy.startCommandMore (null → "x")'], after: { startCommand: 'node something-else.js', startCommandMore: 'x' } });
  assert.deepEqual(refusals([beside]), ['a line could not be read']);
});
test('the shape seen on 22 November still passes: a key only in after, at the tool\'s default, needs no detail', () => {
  // `after` holds the four keys that plan held with no detail, each at the tool's own default: a word, a
  // number and `false` in deploy, and a path in build. `before` lacks all four.
  const c = change({ after: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10, sleepApplication: false } });
  assert.ok(Object.hasOwn(c.before, 'runtime') && !Object.hasOwn(c.after, 'runtime'));
  const r = renderPlan(plan([c]), reading([c]));
  assert.deepEqual(r.refusals, []);
  assert.deepEqual(r.lines.slice(0, -1), ['deploy.healthcheckTimeout: 2700 -> 3000']);
  const b = change({ field: 'build', path: 'resources.service.example-api.build', details: ['build.buildCommand (null → "npm run made-up")'],
    after: { buildCommand: 'npm run made-up', dockerfilePath: 'Dockerfile' } });
  assert.deepEqual(renderPlan(plan([c, b]), reading([c, b])).refusals, []);
  // The same four keys at any other value are refused: the number as much as the words.
  for (const more of [{ restartPolicyMaxRetries: 11 }, { dockerfilePath: 'made-up/Dockerfile' }]) {
    const field = Object.hasOwn(more, 'dockerfilePath') ? b : c, other = change({ ...field, after: { ...field.after, ...more } });
    assert.ok(renderPlan(plan([other]), reading([other])).refusals.includes('a line could not be read'), JSON.stringify(more));
  }
});
test('a key only in after that is not the tool\'s default is refused, and nothing of it is printed', () => {
  // The one detail names the health check. Each of these is also in `after`, in no detail, and not in `before`.
  for (const more of [{ madeUpCommandKey: 'node made-up-other.js' }, { preDeployCommand: ['node made-up-other.js'] }, { sleepApplication: true },
                      { cronSchedule: '5 4 * * *' }, { restartPolicyType: 'NEVER' }, { restartPolicyMaxRetries: 3 }, { numReplicas: 0 },
                      { drainingSeconds: 30 } /* a real setting with no known default */]) {
    const c = change({ after: more });
    const r = renderPlan(plan([c]), reading([c]));
    assert.deepEqual(r.refusals, ['a line could not be read'], JSON.stringify(more));
    assert.ok(!r.lines.join('\n').includes(Object.keys(more)[0]) && !JSON.stringify(r.lines).includes('made-up-other'));
  }
  // The same key with a detail naming it is read, like any other.
  const named = change({ details: ['deploy.healthcheckTimeout (2700 → 3000)', 'deploy.drainingSeconds (null → 30)'], after: { drainingSeconds: 30 } });
  assert.deepEqual(renderPlan(plan([named]), reading([named])).refusals, []);
});
test('a region map only in after, with no detail naming it, is always refused', () => {
  // Railway holds no map. The tool calls one replica in any one region its default and writes no detail,
  // so without this refusal the apply would set a region that no line showed and no mark marked.
  const only = (map) => change({ before: { multiRegionConfig: undefined }, after: { multiRegionConfig: map } });
  for (const map of [replicas(1), replicas(1, 'made-up-region-2'), replicas(0), replicas(2), { ...replicas(1), ...replicas(1, 'made-up-region-2') }]) {
    const c = only(map);
    const r = renderPlan(plan([c]), reading([c]));
    assert.ok(r.refusals.includes('a line could not be read'), JSON.stringify(map));
    assert.ok(!r.lines.join('\n').includes('made-up-region'), JSON.stringify(map));
  }
  // With a detail that names the region's count, it is read, and marked as the region.
  const named = change({ details: ['deploy.healthcheckTimeout (2700 → 3000)', 'regions.made-up-region-2 (null → 2)'],
    before: { multiRegionConfig: undefined }, after: { multiRegionConfig: replicas(2, 'made-up-region-2') } });
  const r = renderPlan(plan([named]), reading([named]));
  assert.ok(!r.refusals.includes('a line could not be read'));
  assert.ok(r.lines.some((line) => lineMark(line) === 'the region'));
});
test('a default is a default only for a plan made by the version the table was read from', () => {
  const c = change({ after: { sleepApplication: false } });
  const r = renderPlan(plan([c], { cliVersion: '5.75.0' }), { ...reading([c]), toolVersion: '5.75.0' });
  assert.ok(r.refusals.includes('a line could not be read'));
});
test('one detail under a setting does not cover another difference under it', () => {
  const two = { ...replicas(1), ...replicas(1, 'made-up-region-2') };
  // Region 1 rises and has its detail. Region 2 is taken out of the map, with no detail.
  const dropped = change({ details: ['regions.made-up-region-1 (1 → 2)'], before: { multiRegionConfig: two }, after: { multiRegionConfig: replicas(2) } });
  assert.ok(refusals([dropped]).includes('a line could not be read'));
  // With a detail for each region that differs, every line is read. (The file declared both regions at the
  // last change applied, so both names may be printed; the second region is then refused as emptied.)
  const both = change({ details: ['regions.made-up-region-1 (1 → 2)', 'regions.made-up-region-2 (1 → null)'], before: { multiRegionConfig: two }, after: { multiRegionConfig: replicas(2) } });
  const r = renderPlan(plan([both]), reading([both], declaredThen({ multiRegionConfig: two })));
  assert.ok(!r.refusals.includes('a line could not be read'));
  assert.ok(r.refusals.includes('it empties deploy.multiRegionConfig.made-up-region-2.numReplicas'));
});
// The third: leaving a setting out of the file clears it, and Railway may write no line for that.
test('a setting the file declared at the last change applied, and declares no more, is refused with or without a line for it', () => {
  const ctx = declaredThen({ preDeployCommand: ['node migrate.js'] });
  const silent = change({ before: { preDeployCommand: ['node migrate.js'] } });   // the one detail speaks of the health check
  const r = renderPlan(plan([silent]), ctx);
  assert.deepEqual(r.refusals, ['it empties deploy.preDeployCommand']);
  assert.deepEqual(r.lines.slice(0, -1), ['deploy.healthcheckTimeout: 2700 -> 3000']);
});
// The rule refuses only while applying would clear something on Railway. Both ways:
test('a dropped setting that Railway no longer holds, or holds only at the tool\'s default, is not refused', () => {
  // The file declared the command; Railway holds it no more (it was changed by hand, as a refusal asks).
  const gone = declaredThen({ preDeployCommand: ['node migrate.js'] });
  assert.deepEqual(renderPlan(plan([change()]), gone).refusals, []);
  // The file declared sleep off, which is the tool's default, and a tidy-up dropped the line. Railway
  // holds `false`, or nothing. Beside a change to the health check, nothing is emptied and nothing refused.
  const tidied = declaredThen({ sleepApplication: false });
  assert.deepEqual(renderPlan(plan([change({ before: { sleepApplication: false } })]), tidied).refusals, []);
  assert.deepEqual(renderPlan(plan([change()]), tidied).refusals, []);
});
test('a dropped setting that Railway still holds at a value of its own is refused', () => {
  // sleep was on, and declared on. Dropping the line would turn it off: that is a change, and it has no line here.
  const on = declaredThen({ sleepApplication: true });
  assert.deepEqual(renderPlan(plan([change({ before: { sleepApplication: true } })]), on).refusals, ['it empties deploy.sleepApplication']);
  // a setting with no known default counts as held at a value of its own
  const drain = declaredThen({ drainingSeconds: 30 });
  assert.deepEqual(renderPlan(plan([change({ before: { drainingSeconds: 30 } })]), drain).refusals, ['it empties deploy.drainingSeconds']);
  // and for a plan made by another version of the tool no default is known at all
  const other = renderPlan(plan([change({ before: { sleepApplication: false } })], { cliVersion: '5.75.0' }), { ...declaredThen({ sleepApplication: false }), toolVersion: '5.75.0' });
  assert.ok(other.refusals.includes('it empties deploy.sleepApplication'));
});
test('what the file still declares, and what it never declared, is not called emptied', () => { /* declaredLast holds it and so does after; before holds it and declaredLast never did */ });
// The fourth: a name only Railway holds is never printed.
test('a name only Railway holds is never printed, in a line or in a reason', () => {
  const c = change({ details: ['deploy.healthcheckTimeout (2700 → 3000)', 'deploy.madeUpStoredName ("x" → null)'], before: { madeUpStoredName: 'x' } });
  const r = renderPlan(plan([c]), reading([c]));
  assert.deepEqual(r.refusals, ['a line could not be read']);
  assert.ok(!JSON.stringify(r).includes('madeUpStoredName'));
});
test('a name every object answers to is not a setting the file declares', () => {
  // The first build printed "it empties deploy.constructor" here. It must print nothing of the name.
  const c = change({ details: ['deploy.constructor ("x" → null)'] });
  const r = renderPlan(plan([c]), reading([c]));
  assert.deepEqual(r.refusals, ['a line could not be read']);
  assert.ok(!JSON.stringify(r).includes('constructor'));
});
test('a name with a part "variables" is never read, even when the file declares it', () => {
  // A change whose `after` holds variables anywhere has no line at all. Task 4 refuses such a file as well.
  const c = change({ details: ['deploy.variables.MADE_UP_NAME ("x" → "y")'], before: { variables: { MADE_UP_NAME: 'x' } }, after: { variables: { MADE_UP_NAME: 'y' } } });
  const r = renderPlan(plan([c]), reading([c]));
  assert.deepEqual(r.refusals, ['a line could not be read']);
  assert.ok(!JSON.stringify(r).includes('MADE_UP_NAME'));
});
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/plan-refusals.test.mjs`.
  Expected: FAIL, every `refusals` is `[]`.
- [ ] **Step 3: Add the refusals to `renderPlan`.**
- [ ] **Step 4: Run both test files.** `node --test .github/railway-settings-check/plan-*.test.mjs`. Expected:
  PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/plan-lines.mjs .github/railway-settings-check/plan-refusals.test.mjs
git commit -m "feat(ci): the changes the Railway settings workflow refuses to apply (T-751)"
```

**What a person sees:** nothing yet.

### Task 3: The one place a process is started

**Files:**
- Create: `.github/railway-settings/tool.mjs`, `.github/railway-settings/evaluate-settings.mjs`
- Test: `.github/railway-settings-check/tool.test.mjs`

**Interfaces:**
- Produces:
  - `allowedCommands(workdir, service): string[][]`, exactly these five. The last four are every call to
    Railway that design 6.2 lists; the first contacts nothing.

```
--version
config plan --out <workdir>/plan.json
config apply --plan <workdir>/plan.json --yes
config plan --detailed-exit-code
deployment list --service <service> --json
```

    The last is written as design 6.2 writes it. Its flags are the tool's own (`railway deployment list
    --help`: `-s, --service`, `--json`). It takes no `--limit`: the tool's default of 20 is more than the look
    needs, and a flag the design does not write is a flag the list does not allow.
  - `commandsFor(step, workdir, service): string[][]`, the calls to Railway each approved job may make
    (design 6.2). For `'plan'`: `config plan --out`, then `deployment list`. For `'apply'`: `config plan --out`,
    `deployment list`, `config apply --plan ... --yes`, `config plan --detailed-exit-code`. So step 2 cannot
    apply, whatever calls it.
  - `assertAllowed(argv, workdir, service, step?): void`. Throws `not an allowed command` unless `argv` equals
    one of the five, element for element. With a `step` it must also be `--version` or one of
    `commandsFor(step, ...)`. `service` must match `^[@A-Za-z0-9._/-]+$`.
  - `runTool(argv, { toolPath, runtimeDir, token, workdir, folder, service, timeoutMs, step, standIn? }): Promise<{ code: number }>`.
    It calls `assertAllowed` first, with `step`. A call to Railway must say which step makes it: with no
    `step` it is refused, and only `--version`, which contacts nothing and gets no token, needs none. It
    also requires `toolPath`, `runtimeDir` (without it the tool would evaluate the settings file with
    whatever `node` the runner has), a time limit, and a token for every call to Railway (without one the
    tool could fall back to a sign-in it finds in the home folder); it starts nothing when one is missing.
    It starts `toolPath` with no shell, `stdin` closed, and standard output and error written to
    `tool-<n>.out` and `tool-<n>.err` in `workdir`, where `n` is the command's place among the five, from 1
    (`toolOutputPaths(argv, workdir, service)` gives the two paths; a command run again writes over its own
    files). The child's environment is built from nothing: `PATH` (the pinned runtime's `bin` first, then
    the tool's folder, then this process's own), `HOME`, `_` set to `toolPath`, `RAILWAY_NO_AUTO_UPDATE=1`,
    `CI=true`, `NO_COLOR=1`, and `RAILWAY_TOKEN` set to `token` for every command but `--version`. It returns
    the exit code and nothing else: `124` when the child was stopped at the time limit, `127` when it could
    not be started, `125` when it ended without a code. `standIn` is for the tests alone: a Node script
    started in the tool's place with the same arguments and environment. `cli.mjs` never passes it, and
    Task 11's check refuses the word in `cli.mjs`. It is honoured only while Node's own test runner is
    running the process; anywhere else a call that passes it starts nothing.
    **The step is tied to the job.** `step` is a word the caller passes, and by itself it is tied to
    nothing. So on a runner a call to Railway is refused unless `GITHUB_JOB` equals `step`: the job `plan`
    can make step 2's calls and no others, whatever `cli.mjs` passes. The jobs' ids are `plan` and `apply`
    for that reason (Task 11, rule 9). A process is on a runner when it holds `GITHUB_JOB`, or
    `GITHUB_ACTIONS` with any value at all: a runner gives every process both, and one of them unset or
    set to another word must not switch the tie off.
    **The token's form** is checked before use: 1 to 512 printable characters with no space. No error can
    quote it.
    **Nothing the tool started outlives it.** On Linux the tool is started as the leader of its own process
    group, and the whole group is stopped in both cases: at the time limit, and when the tool ends by
    itself, before `runTool` answers. The tool starts Node on the settings file, and a process that file
    left running would otherwise live on into the job's later steps with the token in its environment.
    This acts on Linux only: Windows has no such group, and there the one process is stopped. The runner
    is Linux. The tests assert the group stop on Linux, and on Windows assert only the stop and the code.
    **Every path is absolute.** `toolPath`, `runtimeDir`, `workdir` and `folder` must each be an absolute
    path, or nothing is started. `folder` is where the tool is started: the checkout's root, where
    `.railway` is and where the tool asks git about it ("The approved jobs work inside their checkout").
    It is given, never taken from wherever the caller happens to stand. Of this process's own PATH the
    child is given only the entries that are absolute: an empty or a relative one would let a file in the
    current folder be found as a program.
  - `evaluateSettings(file, { runtimePath }?): Promise<{ project: object, partial: string | null, takesContext: boolean }>`.
    It starts `runtimePath` (or `process.execPath` when none is given, as in tests) on
    `evaluate-settings.mjs <file>` with an environment that holds `PATH` only, and reads its answer. The
    flags are `--experimental-strip-types --disable-warning=ExperimentalWarning`, and Node's permission
    flags: `--permission`, with `--allow-fs-read` for the settings file's own folder and for the script, and
    nothing else allowed. A settings file that writes a file, starts a process or opens a worker by mistake
    then fails with Node's own error. **This is a seat belt and not a wall.** Node's page on the feature
    says it "does not protect against malicious code", and that links and open files get round it. So
    nothing rests on it: where the file is run is decided by the rules of "Who writes step 1" and by
    nothing here. The flags read `*` in a path as "anything", so a settings folder whose path holds a `*`
    is not evaluated at all.
    **It is never started beside a token.** Before it starts anything it looks at the environment of the
    process it is in, and refuses when a name there begins `RAILWAY`. On Linux it reads the kernel's own
    record of that environment (`/proc/self/environ`), which code in the process cannot edit; this check
    acts on Linux only, and elsewhere it reads the process's own table. The runner is Linux.
    **The file cannot write its own answer.** The caller sends a random word on standard input; the script
    builds the answer itself, as text, around that word, and the caller takes no answer without it. An
    answer longer than a fixed limit is refused.
  - `reinstallKit(dir, { runtimeDir, runtimePath? }): Promise<{ code: number }>`. It starts the pinned
    runtime on its own npm (`<runtimeDir>/lib/node_modules/npm/bin/npm-cli.js`) with
    `ci --ignore-scripts --prefix <dir> --globalconfig <empty> --userconfig <second empty>`, in `dir`, which must
    be an absolute path, never the bare word: the checkout's root joined with `.railway`, and, for the
    older commit's reading in `declared`, the work folder's `last/.railway` (Task 12). **`--prefix` holds npm to that folder.** Without it npm looks upward for a `package.json` that
    names the folder as a workspace, and would then install from that file and take its npm settings:
    files outside the trusted places, which step 1 never shows. In a checkout held to the trusted places
    there is none ("Who writes step 1"); the word makes that no longer something the install rests on.
    **`--prefix` also moves npm's "global" settings file into the folder:** with it, npm reads
    `<dir>/etc/npmrc` as that file (npm's own config code: `globalconfig` is `etc/npmrc` under the prefix).
    One line there can name a program for npm to start, and `recheck` runs this install inside step 3's
    token step. So each of npm's two settings files that are not the folder's own is given a file that
    holds nothing. `reinstallKit` itself writes the two into one new folder of the runner's temporary
    space just before it starts npm, each made anew and for its owner alone, and removes them afterwards.
    They are two files and not one: npm refuses to load one file as both, and ends with code 1 before it
    reads anything. A temporary space that is the kit's folder or lies under it, or a folder or a file
    that cannot be made, refuses with a fixed sentence, and npm is not started. No file of the commit,
    and no file that code run earlier in the job could have left in the home folder, is then read as
    npm's settings.
    (The folder's own `.npmrc` is refused where the files are checked, Task 11's rule 27.) It runs with an
    environment that holds `PATH` and `HOME` only. npm checks every package against the
    lockfile's hash, so this is both the install and design 6.2's "checked against its lockfile". The
    runtime's program is `<runtimeDir>/bin/node` unless `runtimePath` names another: the tests give the Node
    that runs them, with a stand-in for npm under a made-up `runtimeDir`. npm's own words go to the log; it
    holds no token, and they say why an install failed.
  - `verifyPinned({ toolPath, runtimeDir, pins }): Promise<string[]>`. The SHA-256 of the tool's one program
    must equal `binarySha256` of its entry in `pins` (Task 12). For the runtime the whole unpacked folder is
    checked, not only `bin/node`: `treeSha256` of its entry is a SHA-256 over every file under `runtimeDir`,
    taken in the order of their paths, each as its path, its kind (file or link, and a link's target) and
    its content's SHA-256. npm is JavaScript inside that folder, so a check of `bin/node` alone would let a
    changed npm run. It returns plain problems, empty when both match. A file that cannot be read, a file
    that is neither a plain file nor a link, and a pin that is not a checksum are each a problem. It starts
    no process. **It always runs before the runtime's npm does** (Task 12's `kit` and `declared`; Task 21's
    `recheck`). **It always needs the tool's path:** a path that is missing or not text is a problem, never
    a reason to check less. For the steps that run before the tool is installed there is a second
    function, `verifyRuntime({ runtimeDir, pins })`, which checks the runtime's folder alone and says so by
    its name. The function that takes the folder's sum is exported as `treeDigest(dir)`, so that the pin
    is made by the code that will check it (Task 12).

**Why `_` and `PATH` are set.** The kit checks the tool's version by running the program named in `_`, or
`railway` from `PATH` (`.railway/node_modules/railway/dist/iac/index.js`, `assertMinimumIacCliVersion`). Both
must reach the pinned tool. The tool starts `node` from `PATH` to evaluate the settings file, so the pinned
runtime comes first: that is how "the runtime that evaluates the settings file is pinned" (design 6.2).
`RAILWAY_NO_AUTO_UPDATE=1` is the tool's own switch for its update check (its README).

**What `evaluate-settings.mjs` does.** The same as the tool does when it plans: the tool starts Node on a
short script that imports the file, takes its default export, calls it when it is a function, and prints the
result as JSON (the same file's `isNativeCliEvaluation` names that script's marks). This script answers with
the caller's random word, then `takesContext`, `partial` and `project`. `takesContext` is true when the
file's function uses the context in any way: the context is handed over wrapped, so that a use is noted
even when the function declares no parameter. It passes the context
`{ environment: 'production', environmentName: 'production' }` through `createRailwayContext` from
`railway/iac`. It needs the kit installed in the file's folder, and loads it from there.

- [ ] **Step 1: Write the failing tests**

```js
const W = '/work', S = 'example-api', P = '/work/plan.json';
// The five commands, written out. Design 6.2 lists the last four. A change to any word of any of them
// must change this list, in this file, where a reviewer sees it.
const FIVE = [
  ['--version'],
  ['config', 'plan', '--out', P],
  ['config', 'apply', '--plan', P, '--yes'],
  ['config', 'plan', '--detailed-exit-code'],
  ['deployment', 'list', '--service', S, '--json'],
];
test('the five commands are these, word for word, and each is allowed', () => {
  assert.deepEqual(allowedCommands(W, S), FIVE);
  for (const argv of FIVE) assert.doesNotThrow(() => assertAllowed(argv, W, S));
});
test('each step\'s own calls are these, word for word', () => {
  assert.deepEqual(commandsFor('plan', W, S), [FIVE[1], FIVE[4]]);
  assert.deepEqual(commandsFor('apply', W, S), [FIVE[1], FIVE[4], FIVE[2], FIVE[3]]);
});
for (const argv of [
  ['config', 'apply', '--yes'],
  ['config', 'apply', '--plan', P, '--yes', '--confirm-destructive'],
  ['config', 'plan', '--out', P, '--show-values'],
  ['config', 'plan', '--out', P, '--decrypt-variables'],
  ['config', 'pull', '--include-variables'],
  ['config', 'plan', '--json'],
  ['config', 'plan', '--out', '/elsewhere/plan.json'],
  ['config', 'plan', '--out', P, '--environment', 'other'],
  ['deployment', 'list', '--service', 'another', '--json'],
  ['deployment', 'list', '--service', S, '--json', '--limit', '5'],
  ['deployment', 'list', '--json'],
  ['up'], ['redeploy'], ['variables'], ['config', 'migrate', '--apply'], [],
]) test(`refuses: ${argv.join(' ') || '(nothing)'}`, () => assert.throws(() => assertAllowed(argv, W, S), /not an allowed command/));
test('step 2 may read the plan and the state, and nothing else', () => {
  assert.deepEqual(commandsFor('plan', W, S).map((a) => a.slice(0, 2).join(' ')), ['config plan', 'deployment list']);
  for (const argv of commandsFor('plan', W, S)) assert.doesNotThrow(() => assertAllowed(argv, W, S, 'plan'));
  assert.doesNotThrow(() => assertAllowed(['--version'], W, S, 'plan'));
  for (const argv of [['config', 'apply', '--plan', P, '--yes'], ['config', 'plan', '--detailed-exit-code']])
    assert.throws(() => assertAllowed(argv, W, S, 'plan'), /not an allowed command/);
});
test('step 3 may make the four calls of design 6.2; a step this workflow does not have gets none', () => {
  assert.equal(commandsFor('apply', W, S).length, 4);
  for (const argv of commandsFor('apply', W, S)) assert.doesNotThrow(() => assertAllowed(argv, W, S, 'apply'));
  assert.throws(() => commandsFor('another', W, S));
});

test('the tool gets the token under its own name, and nothing else from this process', async () => {
  // A stand-in tool: a script that writes its environment's key names to the file given in STAND_IN_OUT.
  // Assert: the keys are exactly PATH, HOME, _, RAILWAY_NO_AUTO_UPDATE, CI, NO_COLOR, RAILWAY_TOKEN;
  // GITHUB_TOKEN set in this process does not arrive; for --version, RAILWAY_TOKEN does not arrive either.
});
test('the tool finds the pinned runtime before any other node', async () => { /* PATH begins with <runtimeDir>/bin, then the tool's folder */ });
test('what the tool prints goes to files and is not returned', async () => { /* result is { code: 0 } and nothing more */ });
test('a tool that does not finish is stopped and reported as 124', async () => { /* timeoutMs: 200 */ });
test('a command that is not allowed never starts a process', async () => { /* the stand-in leaves no file */ });
test('the kit is installed from its own folder, whatever stands above it', async () => {
  // A made-up parent folder holds a package.json that names the kit's folder as a workspace, and npm settings of
  // its own that name a registry. The stand-in npm records its arguments and the folder it stands in:
  // the arguments are exactly ci --ignore-scripts --prefix <the kit's folder> --globalconfig <a file>
  // --userconfig <a second file>. And with the real npm of the Node that runs this test, offline: what is
  // installed is the kit folder's own lockfile's, and no node_modules appears in the parent.
});
test('no settings file of npm inside the kit\'s folder, or in the home folder, is read', async () => {
  // The kit's folder holds etc/npmrc, which with --prefix alone npm would take as its "global" settings, and
  // the made-up home folder holds .npmrc. Each names a made-up registry and a made-up program for git.
  // 1. The stand-in npm records its arguments: the files given as --globalconfig and --userconfig are two
  //    different absolute paths in one folder, outside the kit's folder and outside the home folder. Each
  //    is there and holds nothing while npm runs, and both are gone when reinstallKit has answered.
  // 2. With the real npm of the Node that runs this test, started with the arguments reinstallKit gives and
  //    `config get` in place of `ci`: globalconfig and userconfig are those two empty files, and neither
  //    made-up registry nor the made-up program is in force. With --prefix alone, the kit folder's
  //    etc/npmrc is in force: that is the state this test fails on first. (This half runs on Linux, where
  //    the Node that runs the test has its own npm beside it; elsewhere the test checks the arguments.)
});
test('installing the kit gets no token and runs no script', async () => {
  // A stand-in npm-cli.js under a made-up runtimeDir records its arguments and its environment's key names.
  // Assert: arguments begin ci --ignore-scripts --prefix <the folder>; keys are exactly PATH and HOME.
  // A folder given as a relative path, the bare word .railway among them, starts nothing.
});
test('a program that is not the pinned one is found out', async () => {
  // A small file stands in for the tool, and a small folder (bin/node, lib/node_modules/npm/bin/npm-cli.js) for the runtime.
  // With pins made from them: []. Then, one at a time, each must give a problem: one byte of the tool changed;
  // one byte of bin/node changed; one byte of npm-cli.js changed; a file added under the runtime; a file removed.
});
test('on a runner, a call to Railway is made only by the job its step names', async () => {
  // with GITHUB_ACTIONS=true in this process: GITHUB_JOB=plan and step 'apply' starts nothing, and the other way
  // round; GITHUB_JOB=gate starts nothing for either step; GITHUB_JOB=plan and step 'plan' starts the stand-in;
  // --version needs neither
});
test('a process that holds either of a runner\'s two names is on a runner', async () => {
  // GITHUB_JOB=plan with GITHUB_ACTIONS unset, set to 'false' or set to '': step 'apply' still starts nothing;
  // GITHUB_ACTIONS=true with no GITHUB_JOB: no call to Railway is started for either step
});
test('a tool stopped at its limit takes what it started with it', async () => {
  // the stand-in starts a child that would write a file after two seconds; timeoutMs: 200.
  // On Linux: code 124 and the file never appears. On Windows: code 124 is all that is asserted.
});
test('a tool that ends by itself takes what it started with it too', async () => {
  // the stand-in starts the same child and exits 0 at once. On Linux: runTool answers { code: 0 }, and when it
  // has answered the child is gone and its file never appears. On Windows: { code: 0 } is all that is asserted.
});
test('every path the tool\'s entry is given must be absolute', async () => {
  // a relative or empty toolPath, runtimeDir, workdir or folder, each in turn: rejected, and the stand-in leaves no file;
  // with '', '.', 'bin' and './made-up' among this process's PATH, the child's PATH holds none of them;
  // the child is started in `folder`, whatever folder this process stands in
});
test('the check of what was installed never checks less than it was asked', async () => {
  // verifyPinned with toolPath undefined, null, '' or a number: a problem, though the runtime matches;
  // verifyRuntime({ runtimeDir, pins }) checks the runtime's folder alone, and is the only call that may
});
test('a settings file that writes, reads outside its folder or starts something by mistake fails', async () => {
  // The seat belt, and no more than that: this test is of mistakes, not of a file that sets out to get round it.
  // made-up settings files in a temporary folder, each trying one thing as it is evaluated, through
  // process.getBuiltinModule so that none holds the word "require" or "node:": write a file beside itself;
  // append to a file outside; read a file outside its folder; start a process; open a worker.
  // Each: evaluateSettings rejects with its one plain sentence, and nothing was written anywhere.
  // A file that only reads a JSON file beside itself evaluates.
});
test('a settings folder with a star in its path is not evaluated', async () => {
  // the permission flags would read the star as "anything": evaluateSettings rejects before it starts anything
});
test('the settings file is not evaluated in a process that holds a Railway name', async () => {
  // start a child of this test with a made-up RAILWAY_ name in its environment; in it evaluateSettings
  // rejects before it starts anything. On Linux the child first deletes the name from process.env, and
  // it still rejects: the kernel's record is what is read.
});
test('a settings file cannot write its own answer', async () => {
  // a made-up file that prints a whole answer of its own to standard output and then exits; one that prints
  // more than the limit; one that throws a made-up message. None is taken as the answer, and none of their text is quoted.
});
test('a call to Railway that does not say which step makes it is not started', async () => {
  for (const argv of allowedCommands(W, S).slice(1))
    await assert.rejects(runTool(argv, { ...options, step: undefined }), /not an allowed command/);
  assert.deepEqual(await runTool(['--version'], { ...options, step: undefined, token: undefined }), { code: 0 });
});
test('a tool with no time limit, no path, no pinned runtime or no token is not started', async () => { /* each rejects; the stand-in leaves no file */ });
test('each of the five commands writes to files of its own', async () => {
  // toolOutputPaths gives tool-1 ... tool-5 for the five, in the order of allowedCommands
});
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/tool.test.mjs`. Expected:
  FAIL, module not found.
- [ ] **Step 3: Write `tool.mjs` and `evaluate-settings.mjs`.** The stand-ins in the tests are small Node
  scripts the test writes to a temporary folder. The tool's stand-in is started through `runTool`'s
  `standIn`; npm's through `reinstallKit`'s `runtimePath`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/tool.mjs .github/railway-settings/evaluate-settings.mjs .github/railway-settings-check/tool.test.mjs
git commit -m "feat(ci): one entry for Railway's tool, by exact command (T-751)"
```

**As built** (read from the code on 27 November). `tool.mjs` holds what is written above:
- `toolOutputPaths` and the numbered output files: `tool-1` is `--version`, `tool-2` the plan with `--out`,
  `tool-3` the apply, `tool-4` the closing plan, `tool-5` the list of deployments. Tasks 20 and 21 read
  Railway's state from `tool-5.out` and nothing else from these files;
- the list of deployments without `--limit`, as design 6.2 writes it;
- the tests-only `standIn`, honoured only under the test runner, and `reinstallKit`'s `runtimePath`;
- a work folder or a service name that begins with `-` allows no command at all: it could be read as a flag;
- a step that is not `'plan'` or `'apply'` gets no command, not even the version;
- the token's form, and errors that cannot quote it;
- the group stop at the time limit, on Linux;
- `evaluateSettings` with the random word, the answer's limit, and the refusal beside a Railway name. It
  rejects with one of three fixed sentences and never with anything the script printed. A runtime that is
  named and cannot be started is never replaced by another;
- `evaluateSettings` with Node's permission flags, and the refusal of a folder with `*` in its path;
- `runTool` tied to `GITHUB_JOB`, with either of a runner's two names counting as "on a runner";
- `verifyPinned` over the tool's program and the whole runtime folder (`runtimeDir`, `treeSha256`), with
  `treeDigest` exported. It treats a pin that is not a checksum, or a file that cannot be read, as a
  problem;
- the five commands pinned word for word in the tests;
- the whole process group stopped when the tool ends by itself, as at the time limit; every path absolute,
  the tool started in `folder`, and only the absolute entries of PATH passed on; `verifyPinned` always
  needing the tool, with `verifyRuntime` for the runtime alone;
- `reinstallKit` with `--prefix`, `--globalconfig` and `--userconfig`, and refusing a folder that is not an
  absolute path. The first wording of this plan gave npm one empty file under both names. The build found
  that npm (10.9.8 was tried) then ends with code 1 and the words "double-loading config", so the code
  writes two, and refuses, as written above, when it cannot make them outside the kit's folder;
- its own limits of time: 120 seconds for an evaluation of the settings file, and ten minutes for an
  install of the kit. `runTool` has none of its own: the caller must give one, and Task 21 gives each.
`evaluate-settings.mjs` is the one module that imports a path it is given (Task 11, rule 18). Its test file
runs 99 tests. (The counts in these notes are of tests run at the build's head, where one written test can
run many times over a list of cases; the ten files together run 457.)

**Where each read of a trusted file stands.** The release lead's second review moved where the settings
file is run, not how, so no function of `tool.mjs` and nothing in `evaluate-settings.mjs` changed for it.
The build's second review listed every read these two files make from a checkout. Each stays where it is,
with the checkout proven before the first of them (`exact.sh`, Task 12):

| The read | Made by | In which jobs, from now on |
|---|---|---|
| `evaluate-settings.mjs`, by its path beside `tool.mjs`, given to the runtime to run | `evaluateSettings` | The approved jobs, in the command `declared`. Never in `gate` |
| The settings file, what it imports inside `.railway/`, and the kit beside it | `evaluateSettings`, through `evaluate-settings.mjs` | The same |
| `package.json` and `package-lock.json` in the folder it is given. Of npm's settings files, only the folder's own `.npmrc` could still be read, and rule 27 lets none be there; `etc/npmrc` under the folder and the home folder's file are each replaced by an empty one | `reinstallKit`, through npm | The approved jobs, in `kit`, `declared` and `recheck`. Never in `gate` |
| `.railway/`, in the folder the tool is started in, and the settings file the tool starts Node on | `runTool`, through Railway's tool | The approved jobs' token steps |
| Each module's own `import` of its neighbours | Node | Every job, each from its own proven copy |

**Still to change there:** nothing. The two arguments were the last change, with their test written
first: until then `reinstallKit` gave `--prefix` alone, and npm read `etc/npmrc` under the settings folder
as its own "global" settings, inside step 3's token step.

**What a person sees:** nothing yet.

### Task 4: What the file declares, read with no token

**Files:**
- Create: `.github/railway-settings/declared.mjs`
- Test: `.github/railway-settings-check/declared.test.mjs`
- Modify: `.github/workflows/ci.yml` (`gate-tooling`: before the step added in Task 1, a step
  `Install Railway's kit, without scripts` running `npm ci --ignore-scripts --prefix .railway`)

**Interfaces:**
- Consumes: `evaluateSettings(file)` from Task 3.
- Produces:
  - `storedSettings(project): { service: string, build: object, deploy: object }`. It reads the one resource
    of type `service` and returns its `name`, `build` and `deploy`. No table of names is written here: the kit
    already turns the file into the names Railway stores (`normalizeBuild` and `normalizeDeploy` in
    `.railway/node_modules/railway/dist/iac/index.js`: `start` becomes `deploy.startCommand`, `healthcheck`
    becomes `deploy.healthcheckPath`, `preDeploy` becomes the list `deploy.preDeployCommand`, `replicas`
    becomes `deploy.multiRegionConfig`). Those are the names in the `after` objects of the plan of
    22 November. Task 2's refusal `the plan is not what the settings file declares` catches a kit that
    stops matching the tool.
  - `checkSettingsProject(evaluated): string[]`. Problems in plain words, empty when the file may be applied
    from GitHub: variables are not `{ managed: false }`; the project does not declare exactly one resource;
    that resource is not a service; the file exports a partial; the file's function takes the context (the
    token-free evaluation could then differ from the tool's); `build` or `deploy` holds a key `variables`
    at any depth (design 6.4: nothing under variables is rendered, so the file may not put any there).
  - No `expectedLines`. The first plan had step 1 predict the lines from the two declarations, and step 2
    compare. Design section 2 asks for neither, the prediction needed step 1 to evaluate the commit's file
    before the page was written, and each line already says when Railway holds something other than the
    file last declared. It is removed.
  - `declarationChanged(last, now): boolean`. `last` and `now` are each `{ build, deploy }` as
    `storedSettings` gives them, or `null`. True only when both are known and they differ, key order
    ignored. Step 2 uses it for one sentence: the file declares something other than at the last change
    applied, and Railway's plan shows no change (Task 10, `changedNoPlan`). With either side unknown it is
    false, and nothing is said.

- [ ] **Step 1: Write the failing tests**

```js
// The shape the kit's project() and service() return, with made-up values.
const SERVICE = { address: 'service.example-api', type: 'service', kind: 'github', name: 'example-api',
  build: { builder: 'DOCKERFILE', watchPatterns: ['/a/**'] },
  deploy: { startCommand: 'node server.js', healthcheckPath: '/ready', healthcheckTimeout: 2700,
    preDeployCommand: ['node migrate.js'], multiRegionConfig: { 'made-up-region-1': { numReplicas: 1 } },
    drainingSeconds: 30 } };
const PROJECT = { name: 'made-up', variables: { managed: false }, resources: [SERVICE] };
const evaluated = (over) => ({ project: PROJECT, partial: null, takesContext: false, ...over });

test('what the file declares is its one service\'s build and deploy groups', () => {
  assert.deepEqual(storedSettings(PROJECT), { service: 'example-api', build: SERVICE.build, deploy: SERVICE.deploy });
});
test('the committed file evaluates with no token, passes its own check, and uses the names the plan of 22 November used', async () => {
  const real = await evaluateSettings('.railway/railway.ts');   // fails with a plain message if the kit is not installed
  assert.deepEqual(checkSettingsProject(real), []);
  const { build, deploy } = storedSettings(real.project);
  assert.deepEqual(Object.keys(build).sort(), ['buildCommand', 'buildEnvironment', 'builder', 'dockerfilePath', 'watchPatterns']);
  assert.deepEqual(Object.keys(deploy).sort(), ['drainingSeconds', 'healthcheckPath', 'healthcheckTimeout', 'multiRegionConfig',
    'preDeployCommand', 'preDeployTimeoutSeconds', 'restartPolicyMaxRetries', 'restartPolicyType', 'sleepApplication', 'startCommand']);
  assert.ok(Array.isArray(deploy.preDeployCommand));
});
for (const [name, bad] of [
  ['variables managed', evaluated({ project: { ...PROJECT, variables: { managed: true } } })],
  ['variables left out', evaluated({ project: { ...PROJECT, variables: undefined } })],
  ['a second resource', evaluated({ project: { ...PROJECT, resources: [SERVICE, { ...SERVICE, name: 'second', address: 'service.second' }] } })],
  ['a resource that is not a service', evaluated({ project: { ...PROJECT, resources: [{ ...SERVICE, type: 'database' }] } })],
  ['a partial', evaluated({ partial: 'made-up' })],
  ['a function that takes the context', evaluated({ takesContext: true })],
]) test(`the settings file is refused: ${name}`, () => assert.notDeepEqual(checkSettingsProject(bad), []));
test('a group that holds variables is refused, and the problem names none', () => {
  for (const group of ['build', 'deploy']) {
    const bad = evaluated({ project: { ...PROJECT, resources: [{ ...SERVICE, [group]: { ...SERVICE[group], variables: { MADE_UP_NAME: 'x' } } }] } });
    const problems = checkSettingsProject(bad);
    assert.notDeepEqual(problems, []);
    assert.ok(!problems.join(' ').includes('MADE_UP_NAME'));
  }
});
test('the file\'s declaration has changed only when both readings are known and differ', () => {
  const last = { build: SERVICE.build, deploy: SERVICE.deploy };
  const moved = { build: SERVICE.build, deploy: { ...SERVICE.deploy, multiRegionConfig: { 'made-up-region-2': { numReplicas: 1 } } } };
  assert.equal(declarationChanged(last, moved), true);
  assert.equal(declarationChanged(last, { deploy: { ...SERVICE.deploy }, build: { ...SERVICE.build } }), false);   // key order is not a difference
  for (const [a, b] of [[null, moved], [last, null], [null, null], [undefined, moved], ['made-up', moved]])
    assert.equal(declarationChanged(a, b), false);
});
```

  The two lists of keys in the second test are what `.railway/railway.ts` declares today. A pull request that
  adds or removes a setting changes them in the same commit.

- [ ] **Step 2: Run it to see it fail.** `npm ci --ignore-scripts --prefix .railway`, then
  `node --test .github/railway-settings-check/declared.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Write `declared.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS. Also run
  `node -e "import('./.github/railway-settings/tool.mjs').then(async (m) => console.log(JSON.stringify((await m.evaluateSettings('.railway/railway.ts')).project, null, 1)))"`
  and read what it prints: one service, variables unmanaged, no value that is not already in the file. (The
  script itself is not run by hand: it answers only a caller that sends it a random word.)
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/declared.mjs .github/railway-settings-check/declared.test.mjs .github/workflows/ci.yml
git commit -m "feat(ci): what the Railway settings file declares, read with no token (T-751)"
```

**As built** (read from the code on 27 November). Beyond the interfaces above, `declared.mjs` holds:
- `checkSettingsProject` also refuses: a `variables` map with any key beside `managed: false`; a service
  whose name `tool.mjs` would not give to Railway's tool; a service that declares variables of its own; a
  `build` or `deploy` that is not a map. A problem never names a variable;
- `storedSettings` throws when the project is not exactly one service, and gives an empty map for a group the
  file leaves out;
- the refusal of a key `variables` inside `build` or `deploy`, at any depth;
- no `expectedLines`: it and its test are gone;
- `declarationChanged`.
Its test file runs 34 tests.

**Still to change there:** nothing. `storedSettings` and `checkSettingsProject` are called from the
approved jobs' `declared`, `render` and `apply` commands (Tasks 12, 20 and 21) and from the CI check, never
from `gate`.

**What a person sees:** nothing yet.

### Task 5: The gate

**Files:**
- Create: `.github/railway-settings/gate.mjs`
- Test: `.github/railway-settings-check/gate.test.mjs`

**Interfaces:**
- Produces:
  - `ENVIRONMENT = 'railway-settings'`
  - `TRUSTED_PLACES = ['.railway', '.github/railway-settings', '.github/workflows/railway-settings.yml']`
  - `BYPASS_VISIBLE`, a constant `true` or `false`. Task 13 proves which and Task 14 sets it. Until then it
    is `true`.
  - `AGREED_JOBS = { plan: "Read Railway's plan", apply: 'Apply this plan' }`, the two approved jobs' names
    as the workflow file writes them.
  - `AGREED_STEPS = { apply: 'Nothing is left to change' }`, the one step whose success means a change was
    applied and nothing was left.
  - `checkEnvironmentRules({ environment, branchPolicies, ownerId, bypassVisible }): string[]`. `environment`
    is the answer of `GET /repos/{owner}/{repo}/environments/railway-settings`, or `null` when the answer was
    not a success. `branchPolicies` is the answer of
    `GET .../environments/railway-settings/deployment-branch-policies`, or `null` when that answer was not a
    success or had a further page. `ownerId` is the user id of the repository's owner, as a whole number
    above nought: text never matches, so the caller converts it (Task 12). It returns problems in plain
    words, empty when the rules are as design 6.1. It refuses on each of these:
    1. `environment` or `branchPolicies` is `null`, or the answer's `name` is not the environment's;
    2. a field it reads is missing or of the wrong kind: `protection_rules`, a reviewers rule's `reviewers`
       and `prevent_self_review`, `deployment_branch_policy` and its two booleans, `total_count`,
       `branch_policies`. The bypass field is the only exemption, and only as refusal 8 says;
    3. more than one page: `total_count` is not the number of `branch_policies` returned;
    4. reviewers other than exactly the founder's user: not exactly one rule of type `required_reviewers`,
       or not exactly one reviewer in it, or that reviewer's `type` is not `User`, or its `reviewer.id` is
       not `ownerId`;
    5. "prevent self-review" on: `prevent_self_review` is not exactly `false`;
    6. a branch rule in any mode but chosen branches: `deployment_branch_policy` is `null` (no branch policy
       at all), or its `protected_branches` is not exactly `false`, or its `custom_branch_policies` is not
       exactly `true`, or it holds any other key;
    7. branch policies other than exactly one, of type branch, named `master`: `branch_policies` is not one
       entry whose `name` is `master` and whose `type` is `branch`;
    8. a bypass answer other than "no": `can_admins_bypass` is present and is not exactly `false` (an
       explicit `null` is present, and refuses); or it is missing and `bypassVisible` is not `false`.
    A rule of another type (a wait timer, say) is not a refusal: design 6.1 does not list one, and it can
    only add a wait.
  - `bypassChecked(environment): boolean`. True when the answer holds the key `can_admins_bypass`, whatever
    its value. When it is false the summaries say so (Task 10).
  - `checkRunIsCurrent({ ref, placesAtRun, placesAtMasterHead }): string[]`. The currency check. Each
    `places` is `{ settings, code, workflow }`: the git id of each trusted place, in `TRUSTED_PLACES`' order,
    two tree ids and one file id. Empty when `ref` is `refs/heads/master` and all three ids are 40 hex
    characters and equal on both sides.
  - `lastAgreedCommit({ runs, jobsByRunId, approvalsByRunId, currentRunId, repository, ownerId }): { sha: string, runId: number } | null`.
    The last change applied (design 6.2, step 1). The function keeps its first name; what it means is "the
    newest run that applied". `runs` is `workflow_runs` from
    `GET .../actions/workflows/railway-settings.yml/runs`, newest first. `jobsByRunId[id]` is `jobs` from
    `GET .../actions/runs/{id}/jobs?filter=all`: the jobs of every attempt of the run, not only of the
    newest. `approvalsByRunId[id]` is the answer of `GET .../actions/runs/{id}/approvals`, the run's review
    history. `repository` is this repository's full name. Only one kind of run counts. All of these must
    hold:
    1. it is not the current run;
    2. its `path` is `.github/workflows/railway-settings.yml`;
    3. its `event` is `push` or `workflow_dispatch`;
    4. its `head_branch` is `master`;
    5. it ran in this repository and not in a fork: `repository.full_name` and `head_repository.full_name`
       both equal `repository`;
    6. its `head_sha` is 40 hex characters;
    7. its step 3 applied: in a job named `Apply this plan`, of any attempt of the run, the step named
       `Nothing is left to change` has conclusion `success`. **The step's success alone decides; the job's
       own conclusion is not read, and nor is which attempt it was.** That step runs only when the apply
       call succeeded and the closing plan was empty, so its success means Railway holds the change. The
       job can still fail afterwards, when the redeploy is not confirmed (Task 21's last step). The
       settings were applied all the same, and design 6.2 counts a run "whose step 3 applied". If such a
       run did not count, the next run would compare with an older commit, show a change that Railway
       already holds, and hide old values with no reason anyone could find. **Why every attempt.** A run
       that ends red invites GitHub's own "Re-run failed jobs". The new attempt of the apply job finds
       Railway up to date, or finds its plan too old, and applies nothing, or its review is rejected and
       no step runs. Read by its newest attempt alone, the run would stop counting, and the next page
       would say that no run ever applied a change, which is false;
    8. after an approval by the owner: its review history holds an entry whose `state` is `approved`, whose
       `environments` name `railway-settings` (any letter case), and whose `user.id` is `ownerId`, the same
       whole number `checkEnvironmentRules` takes. The gate reads back this run's rules, not the rules in
       force when an older run was approved, so who approved is read from the record.
    Every other run is ignored: a run that only found Railway up to date, a rehearsal, a refused or failed
    apply, a pull-request run from a fork under the same workflow path. With none it is `null`. There is no
    fixed commit to fall back on: a commit could rewrite one. A history that was not read in a shape this
    code knows is `null` too, and so is a run that passes 1 to 6 whose jobs were not read, or one that
    passes 7 whose review history was not read: an older run is never given in a newer one's place.
    **A run that applied and has no review at all on record stops the search.** Every apply waits for a
    review, so a run that passes 1 to 7 and whose review history is an empty list was approved, and GitHub
    did not keep who approved it. That is not "ignored": the answer is `null`, never an older run, and
    the next function tells the caller why.
  - `approvalUnrecorded(the same input): boolean`. True when the search ended at a run that passes 1 to 7
    and has an empty review history. That need not be the newest run of all: newer runs that are ignored
    for another reason (a check, a refusal, a run on another branch) may stand in front of it. The caller then says the history could not be read, not that no run applied a
    change (Task 12). This is how the workflow behaves if GitHub records no approvals for a job that makes
    no deployment record, which Task 17 finds out: it needs no switch and no later change, so it holds in
    the base copy from the first day.
    **A tag named `master`.** GitHub's run object gives `head_branch: "master"` for a tag of that name as
    for the branch, so this function cannot tell them apart. The caller's containment check carries it
    (Task 12): the run's own commit must contain the commit this returns, or the answer is dropped.

**The bypass field's special case** (design 6.1). GitHub's REST page "Get an environment" does not list
`can_admins_bypass` in its answer, though the answer to the owner's sign-in has it. Task 13 proves once
whether a run's own token sees it. If it does, `BYPASS_VISIBLE` stays `true` and a missing field is a refusal
like any other. If the key is not in the answer at all, `BYPASS_VISIBLE` becomes `false`: the workflow does
not check that rule, every summary says so, and the rule rests on the founder's own look at the box
(Task 16). It is the only field exempt from "a missing field", and only then. A key that is there with the
value `null` is not missing: it refuses, and Task 13 says what follows if that is what a run's token is
given. No stronger token is ever used to read it.

The fields of refusals 2 to 7 are in GitHub's REST pages "Get an environment" and "List deployment branch
policies". The review history is "Get the review history for a workflow run", on the page "REST API endpoints
for workflow runs"; its answer is a list of `{ state, environments: [{ name }], user, comment }`, and
`state` is `approved`, `rejected` or `pending`. The jobs endpoint is on the page "REST API endpoints for
workflow jobs" (`docs.github.com/en/rest/actions/workflow-jobs`): read it before writing the fixture.

- [ ] **Step 1: Write the failing tests**

```js
const good = () => ({ ownerId: 1001, bypassVisible: true,
  environment: { name: 'railway-settings', can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { id: 1001, login: 'the-owner' } }] },
                       { type: 'branch_policy' }] },
  branchPolicies: { total_count: 1, branch_policies: [{ id: 7, name: 'master', type: 'branch' }] } });
const reviewers = (g) => g.environment.protection_rules[0];

test('the rules as the design sets them pass', () => assert.deepEqual(checkEnvironmentRules(good()), []));
for (const [name, spoil] of [
  ['the environment could not be read', (g) => { g.environment = null; }],
  ['the branch rules could not be read', (g) => { g.branchPolicies = null; }],
  ['the branch rules run to a second page', (g) => { g.branchPolicies.total_count = 31; }],
  ['the list of rules is missing', (g) => { delete g.environment.protection_rules; }],
  ['no reviewer rule', (g) => { g.environment.protection_rules.shift(); }],
  ['a second reviewer', (g) => { reviewers(g).reviewers.push({ type: 'User', reviewer: { id: 2002, login: 'another' } }); }],
  ['a team as the reviewer', (g) => { reviewers(g).reviewers[0].type = 'Team'; }],
  ['a reviewer who is not the owner', (g) => { reviewers(g).reviewers[0].reviewer.id = 2002; }],
  ['a reviewer with the owner\'s name and another id', (g) => { reviewers(g).reviewers[0].reviewer = { id: 2002, login: 'the-owner' }; }],
  ['self-review prevented', (g) => { reviewers(g).prevent_self_review = true; }],
  ['the self-review answer missing', (g) => { delete reviewers(g).prevent_self_review; }],
  ['no branch policy at all: any branch may deploy', (g) => { g.environment.deployment_branch_policy = null; }],
  ['the branch policy missing from the answer', (g) => { delete g.environment.deployment_branch_policy; }],
  ['the protected-branches mode on', (g) => { g.environment.deployment_branch_policy = { protected_branches: true, custom_branch_policies: false }; }],
  ['the protected-branches mode on beside custom policies', (g) => { g.environment.deployment_branch_policy.protected_branches = true; }],
  ['custom policies off', (g) => { g.environment.deployment_branch_policy = { protected_branches: false, custom_branch_policies: false }; }],
  ['a branch mode this code does not know', (g) => { g.environment.deployment_branch_policy.made_up_mode = true; }],
  ['a second branch rule', (g) => { g.branchPolicies = { total_count: 2, branch_policies: [{ name: 'master', type: 'branch' }, { name: 'release/*', type: 'branch' }] }; }],
  ['a tag named master', (g) => { g.branchPolicies.branch_policies[0].type = 'tag'; }],
  ['a branch rule with no type', (g) => { delete g.branchPolicies.branch_policies[0].type; }],
  ['administrators may bypass', (g) => { g.environment.can_admins_bypass = true; }],
  ['the bypass answer missing, when a run can see it', (g) => { delete g.environment.can_admins_bypass; }],
  ['the bypass answer given as null', (g) => { g.environment.can_admins_bypass = null; }],
  ['the bypass answer given as null, when the build proved a run cannot see it', (g) => { g.environment.can_admins_bypass = null; g.bypassVisible = false; }],
  ['the owner\'s id given as text', (g) => { g.ownerId = '1001'; }],
  ['no owner\'s id given', (g) => { g.ownerId = undefined; }],
  ['the answer is for another environment', (g) => { g.environment.name = 'production'; }],
]) test(`refuses: ${name}`, () => { const g = good(); spoil(g); assert.notDeepEqual(checkEnvironmentRules(g), []); });

test('when the build has proven a run cannot see the bypass answer, its absence is not a refusal', () => {
  const g = good(); delete g.environment.can_admins_bypass; g.bypassVisible = false;
  assert.deepEqual(checkEnvironmentRules(g), []);
  assert.equal(bypassChecked(g.environment), false);
});
test('a bypass answer that is there and is not "no" refuses whatever the build proved', () => {
  const g = good(); g.environment.can_admins_bypass = true; g.bypassVisible = false;
  assert.notDeepEqual(checkEnvironmentRules(g), []);
});
test('a wait timer beside the two rules is not a refusal', () => {
  const g = good(); g.environment.protection_rules.push({ type: 'wait_timer', wait_timer: 5 });
  assert.deepEqual(checkEnvironmentRules(g), []);
});
const places = (over) => ({ settings: 'a'.repeat(40), code: 'b'.repeat(40), workflow: 'c'.repeat(40), ...over });
test('a run is current only on master, with all three trusted places as master has them', () => {
  assert.deepEqual(checkRunIsCurrent({ ref: 'refs/heads/master', placesAtRun: places(), placesAtMasterHead: places() }), []);
  for (const bad of [{ ref: 'refs/heads/other', placesAtRun: places(), placesAtMasterHead: places() },
                     { ref: 'refs/heads/master', placesAtRun: places(), placesAtMasterHead: places({ settings: 'd'.repeat(40) }) },
                     { ref: 'refs/heads/master', placesAtRun: places(), placesAtMasterHead: places({ code: 'd'.repeat(40) }) },
                     { ref: 'refs/heads/master', placesAtRun: places(), placesAtMasterHead: places({ workflow: 'd'.repeat(40) }) },
                     { ref: 'refs/heads/master', placesAtRun: places({ code: '' }), placesAtMasterHead: places({ code: '' }) }])
    assert.notDeepEqual(checkRunIsCurrent(bad), []);
});

// The last change applied. Made-up runs, jobs and review histories, in GitHub's shapes.
const REPO = 'made-up-owner/made-up-repo';
const applied = (id, over) => ({ id, path: '.github/workflows/railway-settings.yml', event: 'push', head_branch: 'master',
  head_sha: String(id % 10).repeat(40), repository: { full_name: REPO }, head_repository: { full_name: REPO }, ...over });
const jobsApplied = [{ name: "Read Railway's plan", conclusion: 'success', steps: [] },
  { name: 'Apply this plan', conclusion: 'success', steps: [{ name: 'Nothing is left to change', conclusion: 'success' }] }];
const approved = [{ state: 'approved', environments: [{ name: 'railway-settings' }], user: { id: 1001, login: 'the-owner' } }];
const last = (runs, jobs = {}, approvals = {}) => lastAgreedCommit({ runs, currentRunId: 99, repository: REPO, ownerId: 1001,
  jobsByRunId: Object.fromEntries(runs.map((r) => [r.id, jobs[r.id] ?? jobsApplied])),
  approvalsByRunId: Object.fromEntries(runs.map((r) => [r.id, approvals[r.id] ?? approved])) });

test('the last change applied is the newest run on master that applied after a recorded approval', () => {
  assert.deepEqual(last([applied(3), applied(2)]), { sha: '3'.repeat(40), runId: 3 });
  assert.deepEqual(last([applied(4, { event: 'workflow_dispatch' })]), { sha: '4'.repeat(40), runId: 4 });
});
// Design 6.2 names these four. Each is ignored, and the older run that applied is the answer.
test('a pull-request run from a fork, under the same workflow path, is ignored', () => {
  const fork = applied(5, { event: 'pull_request', head_repository: { full_name: 'another-owner/made-up-repo' } });
  assert.equal(last([fork, applied(2)]).runId, 2);
  // and a fork that names itself a push on master, under the same path
  assert.equal(last([applied(6, { head_repository: { full_name: 'another-owner/made-up-repo' } }), applied(2)]).runId, 2);
});
test('a run on another branch is ignored', () => assert.equal(last([applied(5, { head_branch: 'other' }), applied(2)]).runId, 2));
test('a run whose apply was skipped is ignored: finding Railway up to date applies nothing', () => {
  const skipped = [{ name: "Read Railway's plan", conclusion: 'success', steps: [{ name: 'Already up to date', conclusion: 'success' }] },
                   { name: 'Apply this plan', conclusion: 'skipped', steps: [] }];
  assert.equal(last([applied(5), applied(2)], { 5: skipped }).runId, 2);
});
test('a run whose review history holds no approval for the environment is ignored', () => {
  // An empty history is another matter, and has its own test below.
  for (const history of [[{ state: 'rejected', environments: [{ name: 'railway-settings' }] }],
                         [{ state: 'approved', environments: [{ name: 'production' }] }], [{ state: 'pending', environments: [{ name: 'railway-settings' }] }]])
    assert.equal(last([applied(5), applied(2)], {}, { 5: history }).runId, 2);
});
test('a run that applied counts even when its job then failed: the redeploy was not confirmed', () => {
  // the step succeeded, a later step of the same job failed, and so the job's conclusion is failure
  const unconfirmed = [{ name: "Read Railway's plan", conclusion: 'success', steps: [] },
    { name: 'Apply this plan', conclusion: 'failure', steps: [{ name: 'Nothing is left to change', conclusion: 'success' },
      { name: "Wait for Railway's report of the new deployment", conclusion: 'success' }, { name: 'Say what was done', conclusion: 'failure' }] }];
  assert.equal(last([applied(5), applied(2)], { 5: unconfirmed }).runId, 5);
});
test('a run that applied counts even when its job was then cancelled while it waited', () => {
  // Cancel was pressed, or the job ran out of time, in the wait: the job's conclusion is cancelled, and the change is on Railway
  const cutShort = [{ name: "Read Railway's plan", conclusion: 'success', steps: [] },
    { name: 'Apply this plan', conclusion: 'cancelled', steps: [{ name: 'Nothing is left to change', conclusion: 'success' },
      { name: "Wait for Railway's report of the new deployment", conclusion: 'cancelled' }, { name: 'Say what was done', conclusion: 'success' }] }];
  assert.equal(last([applied(5), applied(2)], { 5: cutShort }).runId, 5);
  // and a job cancelled inside the token step applied nothing that anyone can read: it does not count
  const inTheApply = [{ name: 'Apply this plan', conclusion: 'cancelled', steps: [{ name: 'Plan again, look, apply, plan again, with the token', conclusion: 'cancelled' },
    { name: 'Nothing is left to change', conclusion: 'skipped' }, { name: 'Say what was done', conclusion: 'success' }] }];
  assert.equal(last([applied(5), applied(2)], { 5: inTheApply }).runId, 2);
});
test('a run that applied counts whatever a later attempt did', () => {
  // The jobs of every attempt are given. Attempt 1 applied; attempt 2, a re-run of the failed job, applied nothing.
  const waited = { name: 'Say what was done', conclusion: 'failure' };
  const first = { name: 'Apply this plan', run_attempt: 1, conclusion: 'failure', steps: [{ name: 'Nothing is left to change', conclusion: 'success' }, waited] };
  const upToDate = { name: 'Apply this plan', run_attempt: 2, conclusion: 'failure', steps: [{ name: 'Nothing is left to change', conclusion: 'skipped' }] };
  const rejected = { name: 'Apply this plan', run_attempt: 2, conclusion: 'failure', steps: [] };
  for (const jobs of [[first, upToDate], [upToDate, first], [first, rejected]])
    assert.equal(last([applied(5), applied(2)], { 5: jobs }).runId, 5);
  assert.equal(last([applied(5), applied(2)], { 5: [upToDate, rejected] }).runId, 2);   // no attempt applied
});
test('a run that applied with no review on record stops the search, and says why', () => {
  const input = (history) => ({ runs: [applied(5), applied(2)], currentRunId: 99, repository: REPO, ownerId: 1001,
    jobsByRunId: { 5: jobsApplied, 2: jobsApplied }, approvalsByRunId: { 5: history, 2: approved } });
  assert.equal(lastAgreedCommit(input([])), null);   // never run 2 in run 5's place
  assert.equal(approvalUnrecorded(input([])), true);
  assert.equal(approvalUnrecorded(input(approved)), false);
  // A review that is on record and is not the owner's approval is another matter: that run is ignored, as before.
  const refusedIt = [{ state: 'rejected', environments: [{ name: 'railway-settings' }], user: { id: 1001, login: 'the-owner' } }];
  assert.equal(approvalUnrecorded(input(refusedIt)), false);
  assert.equal(lastAgreedCommit(input(refusedIt)).runId, 2);
});
test('the search can end at an applied run with no review though a newer run stands in front of it', () => {
  // Three runs. The newest only found Railway up to date, and is ignored. The next applied, and GitHub kept
  // no review for it. The oldest applied after the owner's approval. The search ends at the middle one.
  const upToDate = [{ name: "Read Railway's plan", conclusion: 'success', steps: [] }, { name: 'Apply this plan', conclusion: 'skipped', steps: [] }];
  const three = { runs: [applied(7), applied(5), applied(2)], currentRunId: 99, repository: REPO, ownerId: 1001,
    jobsByRunId: { 7: upToDate, 5: jobsApplied, 2: jobsApplied }, approvalsByRunId: { 7: approved, 5: [], 2: approved } };
  assert.equal(lastAgreedCommit(three), null);
  assert.equal(approvalUnrecorded(three), true);   // "the newest run of all" would have answered false here
});
test('an approval by anyone but the owner does not count', () => {
  const by = (user) => [{ state: 'approved', environments: [{ name: 'railway-settings' }], user }];
  for (const user of [{ id: 2002, login: 'another' }, { id: 2002, login: 'the-owner' }, { id: '1001', login: 'the-owner' }, undefined])
    assert.equal(last([applied(5), applied(2)], {}, { 5: by(user) }).runId, 2);
  // and with no owner's id given, or one given as text, no run counts
  assert.equal(lastAgreedCommit({ runs: [applied(2)], currentRunId: 99, repository: REPO, ownerId: '1001', jobsByRunId: { 2: jobsApplied }, approvalsByRunId: { 2: approved } }), null);
});
test('a rehearsal, a refused or failed apply, another workflow\'s path, another kind of start and this run itself are ignored', () => { /* ... */ });
test('an approval for the environment in other letters still counts', () => { /* 'Railway-Settings' */ });
test('with no run that applied there is no last change applied', () => assert.equal(last([applied(5, { head_branch: 'other' })]), null));
test('a history that could not be read gives none: never an older run in a newer one\'s place, never an error', () => {
  // runs not a list; a candidate's jobs missing; a run that applied whose review history is missing
});
test('no commit is fixed in the code to fall back on', () => { /* the module's text holds no 40 hex characters */ });
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/gate.test.mjs`. Expected:
  FAIL.
- [ ] **Step 3: Write `gate.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/gate.mjs .github/railway-settings-check/gate.test.mjs
git commit -m "feat(ci): read the Railway settings gate's rules back (T-751)"
```

**As built** (read from the code on 27 November). `gate.mjs` holds, beyond the first wording:
- `AGREED_JOBS`; `AGREED_STEPS` with its one key, `apply`; a refusal when the answer's `name` is not the
  environment's (other letters are the same environment to GitHub, so the name is compared without regard
  to case); a refusal when `protection_rules` is not a list of typed rules, or holds more than one
  `branch_policy` rule; `deployment_branch_policy` must hold exactly its two booleans;
- a bypass answer that is present must be exactly `false`: `true` and any other value, `null` included, each
  refuse with their own plain sentence;
- `ownerId` must be a whole number above nought. The code never converts text;
- `checkRunIsCurrent` never takes an id that could not be read as unchanged, even when both sides hold the
  same unreadable value;
- `lastAgreedCommit` as the design's second review round asked: it takes `approvalsByRunId` and
  `repository`, reads a run's `path`, `repository` and `head_repository`, needs this run's own number so
  that it cannot take itself for an earlier run, and no longer counts a run that only found Railway up to
  date. Condition 7 is the step's success alone, with the test above for a job that failed afterwards;
- condition 8 with `ownerId`: an approval counts only when the owner gave it.
- condition 7 over every job named `Apply this plan` that it is given, so that any attempt counts;
- `approvalUnrecorded`, true wherever the search ends at a run which applied with no review on record,
  whether or not newer runs that are ignored stand in front of it.
Its test file runs 98 tests.

**Still to change there:** nothing. Two tests were added last, and the code passed both as it stood: the
three-run case above, which tells that definition from "the newest run of all"; and the job cancelled
while it waited, which counts by its step, against the job cancelled inside the token step, which does
not. Two fixtures of older tests name the step that fails as the workflow now has it, the last step.
`gate.mjs` itself reads nothing: the paging of the history, and the answers "none" and "could not be read", are the wiring's
(Task 12).

**What a person sees:** nothing yet.

### Task 6: Proof, with no token: Railway's record of a redeploy that an apply starts

Design section 9, not yet proven: that Railway posts a deployment record to GitHub for a redeploy an apply
starts. Design 6.6 relies on it, and Task 7 builds on its shape.

**Files:** none in the repository. The result goes into Task 7's fixture and the day's session log.

- [ ] **Step 1: Read the public records of 22 November.** The hand apply ran at 14:09 UTC that day
  (`docs/operations/railway-config-move.md`, "The outcome"). Nothing merged in that minute, so a record made
  then, for the commit `master` was already at, can only be the apply's redeploy.

```bash
gh api "repos/{owner}/{repo}/deployments?per_page=100" \
  --jq '.[] | select(.created_at | startswith("2026-11-22T14:09")) | [.id, .created_at, .sha[0:9], .creator.type, .task] | @tsv'
```

Expected: one line, made by a `Bot`, with the task `deploy`, for the commit `master` was at.

- [ ] **Step 2: Read its statuses.**

```bash
gh api "repos/{owner}/{repo}/deployments/<the id from step 1>/statuses" --jq '.[] | [.created_at, .state] | @tsv'
```

Expected: `in_progress` in the same second as the record, `success` about a minute later, and a later
`inactive` when the next deployment replaced it.

- [ ] **Step 3: Write down what Task 7 needs,** the four things design 6.6 tests:
  - the record's `environment`. It should read as the project's name as `.railway/railway.ts` declares it,
    then ` / `, then Railway's name for the environment;
  - the creator's login and that its `type` is `Bot` (the constant `RAILWAY_APP_LOGIN`);
  - that the record's commit is `master`'s head at the apply;
  - that it was created after the apply began;
  and the three states and their order. No id goes into the repository.

**If it is false** (no such record, or it was not made by Railway's app): design 6.6's own fallback.
`FALLBACK_READ` of Task 7 is set to `true`: step 3 reads the tool's list of deployments again, through the
fifth call of design 6.2, counts it by `listVerdict` (Task 7), and prints only the verdict. If that list
cannot show all four things design 6.6 asks of it, the fallback cannot confirm, and every apply ends as not
confirmed: say so to the release lead and the founder before pull request 2.

**As built: the proof was run on 22 November, and it held.** The public record shows exactly one deployment
record from that minute. Railway's app made it (a `Bot`), with the task `deploy`, for the commit `master`
was at, in Railway's own environment on GitHub. Its statuses were `in_progress` and then, 72 seconds later,
`success`. So `FALLBACK_READ` stays `false`, design 6.2's fifth call is not made, and
the fallback's counting rule (`listVerdict`, Task 7) is not built. It would be needed only if Task 27, the
second sighting, shows no such record.

**To run the proof again,** ask for the commit, not for a page of the newest records: step 1's query reads
the newest 100 deployments, and that minute will have left the first page. Use
`gh api "repos/{owner}/{repo}/deployments?sha=<the commit master was at>&per_page=100"` with the same
`--jq`. An empty first page is not a "no": never set `FALLBACK_READ` to `true` on it.

**What a person sees:** a paragraph in the session log saying what the record showed.

### Task 7: Other deploys, and the redeploy: the verdicts

**Files:**
- Create: `.github/railway-settings/look.mjs`, `.github/railway-settings/redeploy.mjs`
- Test: `.github/railway-settings-check/look.test.mjs`, `.github/railway-settings-check/redeploy.test.mjs`

**Interfaces:**
- Produces, in `look.mjs`:
  - `MIGRATION_WORKFLOWS = ['deploy.yml', 'apply-migration-0018.yml']` (the Deploy workflow's job at
    `deploy.yml:49-106`, and the one other workflow that applies a migration).
  - `VERSION_PROBE`, the address of the API's public version probe: the one `production-receipt.yml:69` and
    `119` build. It is written here because an approved job reads nothing outside the trusted places.
  - `executingJobs(jobsByRunId): number`. The number of jobs that are executing, over the runs it is given.
    Task 21 gives it every run of `MIGRATION_WORKFLOWS` that is not completed, whatever that run's own
    status. The check is an allow-list on both sides. A job whose `status` is `in_progress`, `queued`,
    `requested` or `pending` counts. A job that is `completed` or `waiting` does not: `waiting` is a job
    that waits for a review (design 6.5). **That reading of `waiting` holds only while no environment a
    migration workflow uses has a wait timer:** a job that waits out a timer starts by itself, with no
    approval. None has one today, and Task 25's page says that giving one a timer means changing this
    function first. Any other status, a job with no status, or a list of jobs that is
    not a list, throws: the caller reads that as unreadable and step 3 refuses.
    **Why jobs are counted and runs are not.** Design 6.5 asks whether a job is executing. And on
    25 November the repository held a stale `queued` run and a `pending` run of these workflows, neither
    with any job, and a `waiting` run whose one job waits for review. Counting runs by their own status
    would refuse every apply while they stand. A run with no job counts nothing.
  - `railwayBusy(list): 'idle' | 'busy' | 'unreadable'`. `list` is the parsed output of `deployment list`.
    Steps 2 and 3 both use it: step 2 to tell him before the second approval, step 3 just before the apply.
    Every status that is not final counts as busy (design 6.5). **The final ones are five:** `SUCCESS`,
    `FAILED`, `CRASHED`, `REMOVED` and `SKIPPED`. `REMOVED` and `SKIPPED` were both seen in the real list on
    22 November. A merge that touches no watched path leaves a `SKIPPED` deployment, so without that word
    the look would call Railway busy after most merges. So `BUILDING`, `DEPLOYING`, `INITIALIZING`,
    `WAITING`, `QUEUED` and `REMOVING` are busy, and so is a word this code has never seen. Idle only when
    every entry's status is final. Unreadable when the input is not a list, is an empty list, or holds an
    entry that is not an object with a `status` of text.
  - `watchedPathChanged(patterns, files): boolean`. The production receipt's rule
    (`production-receipt.yml:93`): drop the leading `/`, a dot is a dot, `**` is anything, and the whole path
    must match. A pattern with a `*` that is not part of `**` throws: the receipt's rule gives it no
    meaning, and a guess could miss a watched path.
  - `buildContainsHead({ relation, patterns, files }): 'contains' | 'unchanged' | 'behind' | 'unknown'`.
    `relation` is the `status` of GitHub's `compare/<master's head>...<the commit the API reports>`.
    `identical` or `ahead` is `contains`. `files` are the names, old names included, that differ from the
    reported commit to `master`'s head. `behind` with no watched path among them is `unchanged`; with one it
    is `behind`. `files` of 300 or more, or `null`, or any other relation, is `unknown`. This is
    `production-receipt.yml:117-132` and `85-96`.
- Produces, in `redeploy.mjs`:
  - `RAILWAY_APP_LOGIN`, from Task 6.
  - `FALLBACK_READ`, `false`: Task 6 held. It is the switch of design 6.2's fifth call.
  - `railwayEnvironmentOnGitHub(projectName, environmentName = 'production'): string`, the name Task 6 read:
    `<projectName> / <environmentName>`. The project's name comes from the evaluated settings file, so it is
    not written a second time.
  - `redeployVerdict(records, { environment, head, appliedAt }): { state: 'none' | 'waiting' | 'live' | 'failed' }`.
    `records` is a list of `{ environment, created_at, sha, creator: { login, type }, statuses: [{ state, created_at }] }`.
    A record counts only when all four hold (design 6.6):
    1. its `environment` equals `environment`;
    2. its creator's `login` is `RAILWAY_APP_LOGIN` and its `type` is `Bot`;
    3. its `sha` equals `head`, `master`'s head as read just before the apply;
    4. it was created after the apply: its `created_at` is a later instant than `appliedAt`.
    **Both times are parsed to instants before they are compared, never compared as text.** They come in
    two forms. `appliedAt` is the `Date` header of the read that gave `head`, in HTTP's form
    (`Thu, 01 Jan 2026 10:00:00 GMT`). A record's `created_at` is ISO 8601 (`2026-01-01T10:00:05Z`). As
    text the second sorts before the first whatever the times, so a textual comparison would call every
    record older than the apply. Each form is accepted only when it matches its exact pattern; a time in
    any other form is not a time, and a record whose time cannot be read does not count. When `appliedAt`
    itself cannot be read, no record counts. Both are GitHub's clock. Both have whole seconds, and "after"
    is strict: a record stamped in the same second as the read does not count.
    **Every record that counts speaks.** When any of them holds a `failure` or an `error` status the
    verdict is `failed`. It is `live` only when each of them holds a `success`, even when a later
    `inactive` follows it. Otherwise it is `waiting`. None that counts is `none`. Two records can count:
    a merge and an apply close together give two deployments of one head, and the apply's own cannot be
    told from the other. The first build let the oldest decide, and a tie fell to the order of GitHub's
    list; a failed deployment of the head must never read as live.
- **Not built, and built only if Task 27 shows it is needed:** the fallback's own counting rule.
  - `LIST_FIELDS = { createdAt, status, commit }`, the names of the fields of one entry of the tool's list.
    The tool's public source at `v5.74.0` (`src/commands/deployment.rs`) writes each entry as `id`,
    `status`, `createdAt` and `meta`, and nothing else. So `status` is `'status'` and `createdAt` is
    `'createdAt'`. The list is already of the one service, because the command names it, so design 6.6's
    first condition needs no field. The commit, if it is there at all, is inside `meta`, whose keys the
    source does not fix: `commit` is `null` until Task 18 has seen a key and Task 19 has written it.
  - `listVerdict(list, { head, appliedAt, fields = LIST_FIELDS }): 'live' | 'failed' | 'waiting' | 'cannot'`.
    An entry counts only when it was created after `appliedAt` and is for `head`. Then its status decides:
    `SUCCESS` is `live`; another final status is `failed`; a status that is not final is `waiting`, and so
    is a list in which no entry counts yet. `cannot` when `commit` is `null`, when the list is unreadable
    as `railwayBusy` reads it, or when an entry lacks a field. Times are parsed to instants as above.
    `createdAt` is Railway's clock and `appliedAt` is GitHub's. No allowance is made for the two: an entry
    Railway stamps earlier than GitHub's time for the apply does not count, and the job ends as not
    confirmed, which is the safe side.
  While `FALLBACK_READ` is `false`, nothing calls either. `flow.mjs` takes the verdict as an injected
  function (Task 9), so the order of the calls is tested without them.

- [ ] **Step 1: Write the failing tests**

```js
const PATTERNS = ['/Dockerfile', '/.railwayignore', '/railway.json', '/package.json', '/pnpm-lock.yaml', '/pnpm-workspace.yaml',
  '/tsconfig.base.json', '/packages/api/**', '/packages/types/**', '/packages/reconstruction-foundry/**',
  '/tools/reconstruction-foundry/**', '/tools/capture-factory/**', '/tools/twin-forge/**'];

test('watched paths are matched as the production receipt matches them', () => {
  for (const f of ['Dockerfile', 'package.json', 'packages/api/src/index.ts', 'tools/twin-forge/a/b.py'])
    assert.equal(watchedPathChanged(PATTERNS, [f]), true, f);
  for (const f of ['.railway/railway.ts', '.github/workflows/ci.yml', 'docs/a.md', 'packages/web/src/a.ts',
                   'packages/apiary/a.ts', 'tools/package.json', 'xDockerfile', 'Dockerfile.dev'])
    assert.equal(watchedPathChanged(PATTERNS, [f]), false, f);
});
test('the committed watch list is the thirteen paths this plan was written against', () => {
  assert.deepEqual(JSON.parse(readFileSync('.railway/watch-patterns.json', 'utf8')), PATTERNS);
});
test('a Deploy job that is executing counts; one that waits for review does not', () => {
  assert.equal(executingJobs({ 1: [{ status: 'waiting' }, { status: 'completed' }] }), 0);
  assert.equal(executingJobs({ 1: [{ status: 'in_progress' }], 2: [{ status: 'queued' }] }), 2);
});
test('a job that is requested or pending is executing too; a run with no job counts nothing', () => {
  assert.equal(executingJobs({ 1: [{ status: 'requested' }], 2: [{ status: 'pending' }] }), 2);
  assert.equal(executingJobs({ 1: [], 2: [] }), 0);   // the two stale runs seen on 25 November
});
test('a job status this code does not know, or jobs that are not a list, cannot be counted', () => {
  for (const bad of [{ 1: [{ status: 'a_new_word' }] }, { 1: [{}] }, { 1: [{ status: 7 }] }, { 1: null }, { 1: 'queued' }, null])
    assert.throws(() => executingJobs(bad));
});
test('a watch list with a lone star is refused, not guessed', () => {
  assert.throws(() => watchedPathChanged(['/packages/*/src'], ['packages/api/src']));
});
test('every status that is not final counts as busy', () => {
  assert.equal(railwayBusy([{ status: 'SUCCESS' }, { status: 'REMOVED' }, { status: 'FAILED' }, { status: 'CRASHED' }, { status: 'SKIPPED' }]), 'idle');
  for (const s of ['BUILDING', 'DEPLOYING', 'INITIALIZING', 'WAITING', 'QUEUED', 'REMOVING', 'A_NEW_WORD'])
    assert.equal(railwayBusy([{ status: 'SUCCESS' }, { status: s }]), 'busy', s);
});
test('a state that cannot be read is unreadable, never quiet', () => {
  for (const bad of [null, {}, 'SUCCESS', [], [{}], [{ status: 7 }], [{ state: 'SUCCESS' }], [{ status: 'SUCCESS' }, null]])
    assert.equal(railwayBusy(bad), 'unreadable');
});
// The fallback's counting rule. NOT BUILT: these are written only if Task 27 shows the fallback is needed.
// The entry is in the shape the tool's source writes, with a made-up key for the commit inside meta.
const F = { createdAt: 'createdAt', status: 'status', commit: 'meta.made_up_commit' };
const APPLIED = 'Thu, 01 Jan 2026 10:00:00 GMT';   // GitHub's Date header, in its own form
const entry = (over) => ({ id: 'made-up', createdAt: '2026-01-01T10:00:05Z', status: 'SUCCESS', meta: { made_up_commit: 'e'.repeat(40) }, ...over });
const listed = (list, fields = F) => listVerdict(list, { head: 'e'.repeat(40), appliedAt: APPLIED, fields });
test('the fallback counts only a deployment made after the apply, for master\'s head', () => {
  assert.equal(listed([entry()]), 'live');
  assert.equal(listed([entry({ status: 'FAILED' })]), 'failed');
  assert.equal(listed([entry({ status: 'DEPLOYING' })]), 'waiting');
  for (const over of [{ createdAt: '2026-01-01T09:59:59Z' }, { createdAt: '2026-01-01T10:00:00Z' }, { meta: { made_up_commit: 'f'.repeat(40) } }])
    assert.equal(listed([entry(over)]), 'waiting', JSON.stringify(over));   // it does not count, so nothing is confirmed yet
});
test('when the list cannot show the commit, or cannot be read, the fallback cannot confirm', () => {
  assert.equal(listed([entry()], { ...F, commit: null }), 'cannot');   // the documented list carries no commit
  assert.equal(listVerdict([entry()], { head: 'e'.repeat(40), appliedAt: APPLIED }), 'cannot');   // LIST_FIELDS as committed: no commit seen yet
  for (const lacking of [entry({ createdAt: undefined }), entry({ status: undefined }), entry({ meta: {} }), entry({ createdAt: 'made-up' })])
    assert.equal(listed([lacking]), 'cannot');
  assert.equal(listed([]), 'cannot');
});
test('the running build contains master, or nothing the API is built from changed since', () => {
  assert.equal(buildContainsHead({ relation: 'identical', patterns: PATTERNS, files: [] }), 'contains');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: ['docs/a.md'] }), 'unchanged');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: ['packages/api/a.ts'] }), 'behind');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: Array(300).fill('docs/a.md') }), 'unknown');
  assert.equal(buildContainsHead({ relation: 'diverged', patterns: PATTERNS, files: [] }), 'unknown');
});

// redeploy.test.mjs: records shaped as Task 6 found them, with made-up ids, names and commits.
// The two times are in the two forms they really come in.
const HEAD = 'e'.repeat(40), ENV = railwayEnvironmentOnGitHub('made-up');
const AT = 'Thu, 01 Jan 2026 10:00:00 GMT';        // the Date header of the read that gave master's head
const record = (over) => ({ environment: ENV, sha: HEAD, created_at: '2026-01-01T10:00:05Z',   // ISO 8601, as GitHub writes a record
  creator: { login: RAILWAY_APP_LOGIN, type: 'Bot' }, statuses: [{ state: 'in_progress' }, { state: 'success' }], ...over });
const verdict = (records, appliedAt = AT) => redeployVerdict(records, { environment: ENV, head: HEAD, appliedAt }).state;

test('Railway\'s environment on GitHub is the project\'s name, a slash, the environment\'s name', () => assert.equal(ENV, 'made-up / production'));
test('Railway\'s own record for this apply decides', () => assert.equal(verdict([record()]), 'live'));
test('a record counts only when all four hold', () => {
  for (const [name, over] of [
    ['the job\'s own environment', { environment: 'railway-settings' }],
    ['the Deploy workflow\'s environment', { environment: 'production' }],
    ['made by a person', { creator: { login: 'the-owner', type: 'User' } }],
    ['made by another app', { creator: { login: 'another-app[bot]', type: 'Bot' } }],
    ['for another commit', { sha: 'f'.repeat(40) }],
    ['made one second before the apply', { created_at: '2026-01-01T09:59:59Z' }],
    ['made in the same second as the read before the apply', { created_at: '2026-01-01T10:00:00Z' }],
  ]) assert.equal(verdict([record(over)]), 'none', name);
  assert.equal(verdict([record({ created_at: '2026-01-01T10:00:01Z' })]), 'live', 'made one second after the apply');
});
test('a record made five seconds after the apply counts, though its text sorts before the apply\'s', () => {
  // The case that fails on string order: "2026-..." < "Sun, ..." as text, whatever the two times are.
  const at = 'Sun, 22 Nov 2026 14:09:12 GMT', made = '2026-11-22T14:09:17Z';
  assert.ok(made < at, 'as text, the later time sorts first');
  assert.equal(verdict([record({ created_at: made })], at), 'live');
  // and a record made a day before that apply does not count
  assert.equal(verdict([record({ created_at: '2026-11-21T14:09:17Z' })], at), 'none');
});
test('a time that is in neither form is not a time', () => {
  for (const created_at of ['', 'yesterday', '2026-01-01', '1767261605', 1767261605, undefined])
    assert.equal(verdict([record({ created_at })]), 'none', String(created_at));
  for (const appliedAt of ['', 'made-up', '2026-01-01', undefined, 1767261600])
    assert.equal(verdict([record()], appliedAt), 'none', String(appliedAt));   // no record counts when the apply's own time cannot be read
  assert.equal(verdict([record()], '2026-01-01T10:00:00Z'), 'live');           // an ISO time for the apply is read too
});
test('in progress is waiting; a failure or an error is failed', () => { /* ... */ });
test('a deployment later replaced still counts as live', () => { /* in_progress, success, inactive → live */ });
test('a record that does not count beside one that does changes nothing', () => { /* the wrong one says success, the right one in_progress → waiting */ });
test('with two records that count, a failure in either is failed, and live needs both', () => {
  const ok = record({ created_at: '2026-01-01T10:00:05Z' }), bad = record({ created_at: '2026-01-01T10:00:09Z', statuses: [{ state: 'failure' }] });
  const going = record({ created_at: '2026-01-01T10:00:09Z', statuses: [{ state: 'in_progress' }] });
  for (const records of [[ok, bad], [bad, ok]]) assert.equal(verdict(records), 'failed');   // whichever is older, in either order of the list
  for (const records of [[ok, going], [going, ok]]) assert.equal(verdict(records), 'waiting');
  assert.equal(verdict([ok, record({ created_at: '2026-01-01T10:00:09Z' })]), 'live');
});
```

- [ ] **Step 2: Run them to see them fail.** `node --test .github/railway-settings-check/look.test.mjs
  .github/railway-settings-check/redeploy.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write the two modules.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/look.mjs .github/railway-settings/redeploy.mjs .github/railway-settings-check/look.test.mjs .github/railway-settings-check/redeploy.test.mjs
git commit -m "feat(ci): verdicts on other deploys and on the redeploy an apply starts (T-751)"
```

**As built** (read from the code on 27 November). `look.mjs` and `redeploy.mjs` hold what is written above:
the two sides of `executingJobs` as allow-lists, with an unknown status thrown; the five final statuses; an
empty list of deployments unreadable; the lone star refused; `FALLBACK_READ` `false`; both times parsed to
instants, each from its one exact form, with tests in both directions that fail on the order of the texts.
`listVerdict` and `LIST_FIELDS` are not in the code, and stay out unless Task 27 shows the fallback is
needed.

In `redeploy.test.mjs` the apply's time in the shared fixture is in the `Date` header's own form, so every
test of the four conditions crosses the two forms. In `redeployVerdict` every record that counts speaks.
The two test files hold 17 and 18 tests.

**Still to change there:** nothing. What the build's second review found about a run that lists no job
yet is answered in the wiring (Task 21).

**What a person sees:** nothing yet.

### Task 8: The watched-path check as a command

**Files:**
- Create: `.github/railway-settings-check/watched.mjs`
- Test: `.github/railway-settings-check/watched.test.mjs`

**Interfaces:**
- Consumes: `watchedPathChanged` from Task 7.
- Produces: `node .github/railway-settings-check/watched.mjs`. It reads file names from standard input, one a
  line, and the list from `.railway/watch-patterns.json`. With none watched it prints
  `No watched path is touched.` and exits 0. Otherwise it prints each watched name and exits 1. It is a
  builder's tool. No approved job runs it, so it is not in the trusted folder.

- [ ] **Step 1: Write the failing test:** start the command with `docs/a.md` and `.railway/railway.ts` on
  standard input and expect the sentence and exit 0; with `packages/api/a.ts` among them expect that name and
  exit 1.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL, no `watched.mjs`.
- [ ] **Step 3: Write `watched.mjs`.**
- [ ] **Step 4: Run it, then use it on this branch.**

Run: `git fetch origin master && git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings-check/watched.mjs`
Expected: `No watched path is touched.`

- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings-check/watched.mjs .github/railway-settings-check/watched.test.mjs
git commit -m "feat(ci): a command that says whether a change touches a watched path (T-751)"
```

**As built** (read from the code on 25 November). Beyond the above, `watched.mjs`:
- exits 2, and does not print the sentence, when it was given no name at all: nothing was checked, so it
  does not say that nothing is touched;
- exits 2 when the watch list cannot be read, never reading it as an empty one;
- takes names that end as Windows ends lines, and skips blank lines;
- refuses a name git wrote in quotes, which is how git writes a name with unusual characters: it is not
  guessed at.
Nothing is still to change there.

**What a person sees:** a builder can check any branch against the watch list with one command.

### Task 9: The two token steps as one tested sequence

**Files:**
- Create: `.github/railway-settings/flow.mjs`
- Test: `.github/railway-settings-check/flow.test.mjs`

**Interfaces:**
- Consumes: `renderPlan`, `readPlan` (Tasks 1 and 2); `commandsFor` (Task 3); `executingJobs`,
  `railwayBusy`, `buildContainsHead` (Task 7).
- Produces:
  - `SIX_HOURS = 21600`, and `LOOK_MAX_AGE = 120`: the most seconds that may pass between the moment before
    the look's first read and the apply.
  - `planStep(deps): Promise<{ ok: boolean, key: string, code?: number }>`. When `ok` is true the key is
    `stateQuiet` or `stateBusy`, the sentence step 2's summary will carry.
  - `applyStep(deps, { lines, plannedAt, namedHead }): Promise<{ outcome: 'applied' | 'refused' | 'failed' | 'left-over', key: string, code?: number, appliedAt?: string, head?: string, named?: string, reasons?: string[], after?: 'live' | 'failed' | 'cannot' }>`.
    `reasons` are Task 2's, given with the key `hand`. `namedHead` is the commit step 2's page named as the
    one an apply would redeploy. `named` is that commit again, in the answer, when the apply call was made
    at another: it comes with `head` and `appliedAt`, on every outcome that follows the apply call, a failed
    one included. An outcome from before the apply call, every refusal among them, holds none of the three.
  - `deps = { token, tool, readText, context, workdir, gateHead, github, probe, recheck, now, wait, say, fallbackRead, afterVerdict }`.
    `tool(argv)` returns `{ code }`. `readText(name)` reads a file in WORK. `context` is Task 1's `ctx`.
    `workdir` is WORK, from which the step's own commands are built (`commandsFor`, Task 3).
    `gateHead` is `master`'s head as this job's currency check read it (`gate again`, Task 21).
    `say(key, values)` writes one fixed sentence of Task 10 to the step's log, which a person can read
    while the job still runs. (A summary is not such a place: GitHub shows a job's summaries only when the
    job has ended, and the last step writes that one, once.) The flow uses `say` for one thing, said just
    before the apply call (step 10).
    `github.executing()` returns `jobsByRunId` for every run of `MIGRATION_WORKFLOWS` that is not completed
    (Task 21 says how they are read). `github.head()` returns `{ sha, at }`: `master`'s head and GitHub's
    own time for that read, the `Date` header as it came. `probe()` returns
    `{ relation, patterns, files, head }`: `head` is the commit of `master` it judged the running build
    against. `recheck()` returns a list of problems (Task 21 wires it to
    `verifyPinned`, then `reinstallKit`). `now()` is seconds. `wait(seconds)` is the one way the flow lets
    time pass, so a test can run 75 minutes of it at once. `fallbackRead` is the switch of design 6.2's
    fifth call; `afterVerdict(text, { head, appliedAt })` reads that call's output, and is Task 7's
    `listVerdict` if it is ever built. `key` names a sentence of Task 10.

**The order, which the tests pin.** It is design 6.2's, with the two stops of departure 11: a head that
moved, and a look that grew old.

`planStep`: with an empty `token`, call nothing and return `noToken`. Otherwise two calls to Railway and no
others, in this order, each with its output in a file:

1. `config plan --out`. A non-zero exit returns `planFailed` with the code, and the second call is not made.
   **Then the plan file is read, here, in the step that made it.** A file that is missing, or that
   `readPlan` does not read, returns `planShape`, and the second call is not made: a tool that exits 0 and
   writes no plan has not read Railway's plan, and step 2 must not answer that it did. Nothing of the plan
   is returned; the next step renders it.
2. `deployment list`. A non-zero exit returns `stateFailed` with the code. Its output is read from its file
   and given to `railwayBusy`: `unreadable` returns `stateUnknown`; `busy` returns `ok` with `stateBusy`;
   `idle` returns `ok` with `stateQuiet`. A state that cannot be read fails the step. It is never guessed.

So every run, a check included, proves the token can make both reads before a real change depends on them
(design 6.2). A busy Railway does not fail step 2: the summary says so, and step 3 looks again.

`applyStep`, stopping at the first that fails:

1. `plannedAt` is a whole number, not in the future by more than 300 seconds, and at most `SIX_HOURS` old.
   Else `refused`, `stale`. No tool call yet.
2. An empty `token`: `refused`, `noToken`. Then the two commits this step was handed, before any call to
   Railway: `gateHead`, and `namedHead`, the head step 2 named. Either one missing, or not 40 hex
   characters: `refused`, `unread`. A head that was never read has not moved, and the page must not say
   it did.
3. **First call:** `config plan --out`. Non-zero: `failed`, `planFailed`, with the code.
4. Read it and render it. A plan file that is missing, or that `readPlan` does not read: `failed`,
   `planShape`, with no code, because the tool exited 0. Its lines must equal `lines` exactly. Else
   `refused`, `linesDiffer`.
5. It must have no refusals, and then it must be pending, in that order. Refusals: `refused`, `hand`, with
   the reasons. Only then, not pending: `refused`, `upToDate`. The order matters: a plan with no change that
   was made for another copy of the folder holds a refusal and nothing pending, and it must never read as
   up to date.
6. **The look.** `now()` is kept first, before any read of it: the look's age is counted from there, so
   that it bounds the oldest thing the look saw and not the newest. Then the **second call,**
   `deployment list`. `executingJobs(await github.executing()) > 0`, or `railwayBusy` is `busy`: `refused`,
   `busy`. Then `probe()`. The `head` it answers must be 40 hex characters, or `refused`, `unread`; and it
   must be `gateHead`, or `refused`, `moved`: the look is held to the currency check's head as soon as it
   has one of its own. `buildContainsHead` of the probe is `behind`: `refused`, `behind`. Anything that
   could not be read (`github.executing` or `probe` throws, `deployment list` exits non-zero, `railwayBusy`
   is `unreadable`, `buildContainsHead` is `unknown`): `refused`, `unread`.
7. `recheck()`. Any problem: `refused`, `notAsInstalled`.
8. **The look must still be fresh.** `recheck` installs the kit again and can take minutes. If more than
   `LOOK_MAX_AGE` seconds have passed since the moment step 6 kept, the whole of step 6 is made again, the
   moment kept anew and the second call to Railway included, and judged as before.
9. `github.head()`, kept as `head` and `appliedAt`. It throws, or what it answers is not a commit and a
   time: `refused`, `unread`. **The head must not have moved.** Three reads of `master`'s head are now in
   hand, all made in this job: `gateHead`, the `head` of the newest look's `probe()`, and this one. The
   first two already agree. Unless this one is the same commit: `refused`, `moved`, and nothing is
   applied. An apply makes Railway deploy the head it finds; after a move that is a commit the look never
   judged (departure 11).
10. **Three last things, in this order, and then the third call.**
    - **The plan file is read once more** and must hold the very text that was judged: the file that was
      judged is the one applied. If it does not: `refused`, `unread`.
    - **The look's age is checked once more.** If more than `LOOK_MAX_AGE` seconds have passed since the
      newest look's kept moment: `refused`, `unread`. A look is not made a third time. So no read the apply
      rests on is more than two minutes old when the apply is made.
    - **A head that moved between the two approvals is said.** When `head` is not `namedHead`, the commit
      step 2's page named, `deps.say('namedMoved', { named: namedHead, sha: head })` is called, last of
      all, so that nothing can refuse between the sentence and the apply call: a log must never say "this
      apply redeploys" above a refusal. It is not itself a refusal (departure 11): step 3's own three reads
      agree, and the look judged this head. But it must be said. With no `say` given, or a `say` that
      throws: `refused`, `unread`, and nothing is applied. From here on the answer carries `named`.
    **Third call:** `config apply --plan ... --yes`. The call's exit code decides:
    - `0`: go on;
    - `124` or `125` (the tool was started, and was stopped at its limit or ended with no code): **the
      apply did not finish, and whether Railway took it is not known.** The fourth call is still made,
      because it only reads. If it exits `0`, Railway holds what the file declares: the outcome is
      `applied`, like any other. Otherwise the outcome is `left-over`, `applyUnknown`, with the apply's
      code;
    - `126` (the call was never made: the tool's entry refused it, or threw, before anything was
      started): nothing reached Railway. `failed`, `applyFailed`, with the code, and no fourth call;
    - any other code: the tool itself says the apply failed. `failed`, `applyFailed`, with the code, and
      no fourth call.
11. **Fourth call:** `config plan --detailed-exit-code`. `0`: `applied`. `2`: `left-over`, `leftOver`. Other:
    `left-over`, `closingUnread`, with the code. (After an apply that did not finish, as step 10 says.)
12. **Fifth call, only when `fallbackRead` is true, and then after every apply call that may have reached
    Railway:** that is the outcomes `applied` and `left-over` alike, the one with `applyUnknown` among
    them. An apply that leaves something over, or whose closing plan could not be read, has still started
    a redeploy with its migration step, and design 6.6 lets no redeploy go unconfirmed. The same list of
    deployments is read again, with `wait(30)` between reads, until `afterVerdict` says `live`, `failed` or `cannot`, for at most 75 minutes: 150 waits. The answer
    is `after`; still `waiting` at the end is `cannot`. A call that exits non-zero is `cannot` at once.
    Anything but `live` fails the job in Task 21.

`appliedAt` and `head` are returned with every outcome that followed an apply call that may have reached
Railway, so that Task 21's wait can be made for the redeploy in each of them.

- [ ] **Step 1: Write the failing tests.** A fake `tool` records each `argv` and answers from a script; a fake
  `readText` returns a plan from `fixtures.mjs`. `applying(over)` builds the fakes for one run of step 3,
  with a pending plan, a quiet Railway and all three reads of `master`'s head giving `HEAD`, and `over`
  changes one thing; `input` is step 2's `{ lines, plannedAt, namedHead }` for that plan, with `HEAD` as the
  head it named. The fake `say` keeps what it was given in `run.said`, and logs `say:<key>` among the events.

```js
const calls = (run) => run.tool.calls.map((argv) => argv.slice(0, 3).join(' '));

test('step 2 with no token stored calls nothing', async () => { /* key 'noToken', calls [] */ });
test('step 2 makes two calls to Railway and no others: the plan, then the state', async () => {
  assert.deepEqual(calls(run), ['config plan --out', 'deployment list --service']);
  assert.deepEqual([r.ok, r.key], [true, 'stateQuiet']);
});
test('step 2 does not read the state when the plan could not be read', async () => {
  assert.deepEqual([r.ok, r.key, r.code, calls(run)], [false, 'planFailed', 1, ['config plan --out']]);
});
test('step 2 fails when the tool exits 0 and leaves no plan the reader reads', async () => {
  // no plan.json at all; one that is not JSON; one that holds a key more. Each time:
  assert.deepEqual([r.ok, r.key, Object.hasOwn(r, 'code'), calls(run)], [false, 'planShape', false, ['config plan --out']]);
});
test('step 2 says Railway is busy without failing; step 3 will look again', async () => { /* a BUILDING entry: ok true, key 'stateBusy' */ });
test('step 2 fails, and does not guess, when the state cannot be read', async () => {
  // the state call exits 1: ok false, key 'stateFailed', code 1
  // the state call exits 0 with a shape railwayBusy does not know: ok false, key 'stateUnknown'
});
test('nothing the state call wrote is in what step 2 says', async () => {
  // the fake tool writes [{ "status": "SUCCESS", "id": "MADE-UP-STATE-OUTPUT" }] to the state's output file
  assert.ok(!JSON.stringify(r).includes('MADE-UP-STATE-OUTPUT'));
});
test('step 3 refuses a first plan older than six hours before calling the tool', async () => {
  const r = await applyStep(run.deps, { lines, plannedAt: run.deps.now() - SIX_HOURS - 1 });
  assert.deepEqual([r.outcome, r.key, calls(run)], ['refused', 'stale', []]);
});
test('step 3 refuses a time from the future, or one that is not a number', async () => { /* ... */ });
test('step 3 does not apply when its own lines differ from step 2\'s', async () => {
  // step 2 read 2700 -> 3000; Railway now plans 2700 -> 3000 and one more line
  assert.deepEqual([r.outcome, r.key, calls(run)], ['refused', 'linesDiffer', ['config plan --out']]);
});
test('step 3 does not apply a plan it refuses, and says why', async () => { /* an emptied setting: key 'hand', reasons, no apply */ });
test('an empty plan for another copy of the folder is refused, never called up to date', async () => {
  // step 2 passed on no lines; step 3's own plan holds no change and a sourceTree that is not this commit's
  assert.deepEqual([r.outcome, r.key, r.reasons], ['refused', 'hand', ['the plan is for another copy of the settings folder']]);
});
test('an empty plan with nothing against it is up to date, and nothing is applied', async () => {
  assert.deepEqual([r.outcome, r.key, calls(run)], ['refused', 'upToDate', ['config plan --out']]);
});
for (const [name, spoil] of [['a Deploy job is executing', /* ... */], ['Railway is building', /* ... */],
  ['Railway\'s state cannot be read', /* ... */], ['production is behind master\'s API code', /* ... */],
  ['the running build cannot be placed', /* ... */], ['master\'s head cannot be read', /* ... */]])
  test(`step 3 does not apply when ${name}`, async () => { /* no 'config apply' among calls */ });
test('step 3 does not apply when the kit, the tool or the runtime is not as installed', async () => {
  // recheck returns one problem
  assert.deepEqual([r.outcome, r.key], ['refused', 'notAsInstalled']);
  assert.ok(!calls(run).includes('config apply --plan'));
});
test('the check of what was installed comes after the look and just before the apply', async () => {
  // the fakes share one log of events: every tool call, both halves of the look, the check and the read of master's head
  assert.deepEqual(run.events, ['tool:config plan --out', 'tool:deployment list --service', 'executing', 'probe', 'recheck', 'head',
    'tool:config apply --plan', 'tool:config plan --detailed-exit-code']);
});
test('the look comes before the apply: when a Deploy job is executing, nothing after the look happens', async () => {
  assert.deepEqual(run.events, ['tool:config plan --out', 'tool:deployment list --service', 'executing']);
});
// A head that moved stops the apply (departure 11). HEAD is the commit all three reads give unless a test says otherwise.
test('step 3 does not apply unless the three reads of master\'s head give one commit', async () => {
  const OTHER = 'f'.repeat(40);
  for (const [name, spoil] of [['the head read just before the apply is another commit', { head: OTHER }],
                               ['the look judged against another commit', { probeHead: OTHER }],
                               ['the currency check saw another commit', { gateHead: OTHER }]]) {
    const run = applying(spoil), r = await applyStep(run.deps, input);
    assert.deepEqual([r.outcome, r.key], ['refused', 'moved'], name);
    assert.ok(!calls(run).includes('config apply --plan'), name);
  }
});
test('a head that was not read is unread, never moved', async () => {
  // the currency check left no head, or text that is not a commit: refused before any call to Railway
  for (const gateHead of ['', undefined, 'master', HEAD.slice(1)]) {
    const run = applying({ gateHead }), r = await applyStep(run.deps, input);
    assert.deepEqual([r.outcome, r.key, calls(run)], ['refused', 'unread', []], String(gateHead));
  }
  // step 2 handed over no named head: the same
  const none = applying({}), a = await applyStep(none.deps, { ...input, namedHead: undefined });
  assert.deepEqual([a.outcome, a.key, calls(none)], ['refused', 'unread', []]);
  // the look answered no head, or the last read answered none: unread, and nothing is applied
  for (const spoil of [{ probeHead: undefined }, { probeHead: 'made-up' }, { head: undefined }]) {
    const run = applying(spoil), r = await applyStep(run.deps, input);
    assert.deepEqual([r.outcome, r.key, calls(run).includes('config apply --plan')], ['refused', 'unread', false], JSON.stringify(spoil));
  }
});
test('a head that moved between the two approvals is said before the apply, and does not stop it', async () => {
  const NAMED = 'd'.repeat(40);   // step 2 named this; master has moved to HEAD since, and all three reads here give HEAD
  const run = applying({}), r = await applyStep(run.deps, { ...input, namedHead: NAMED });
  assert.deepEqual([r.outcome, r.head, r.named], ['applied', HEAD, NAMED]);
  assert.deepEqual(run.said, [['namedMoved', { named: NAMED, sha: HEAD }]]);
  // It is said last of all before the apply call: after everything that could still refuse.
  assert.deepEqual(run.events.slice(-4), ['head', 'say:namedMoved', 'tool:config apply --plan', 'tool:config plan --detailed-exit-code']);
  // with the head step 2 named, nothing is said and the answer holds no `named`
  const same = applying({}), s = await applyStep(same.deps, input);
  assert.deepEqual([same.said, Object.hasOwn(s, 'named')], [[], false]);
  // whatever the apply then comes to, what step 2 named goes with the answer: a failed apply included
  for (const [over, outcome] of [[{ closingExits: 2 }, 'left-over'], [{ applyExits: 124, closingExits: 2 }, 'left-over'], [{ applyExits: 1 }, 'failed']]) {
    const other = await applyStep(applying(over).deps, { ...input, namedHead: NAMED });
    assert.deepEqual([other.outcome, other.head, other.named], [outcome, HEAD, NAMED]);
  }
  // a refusal says nothing of a move, and holds no `named`: Railway is busy, and step 2 had named another commit
  const busy = applying({ state: [{ status: 'BUILDING' }] }), b = await applyStep(busy.deps, { ...input, namedHead: NAMED });
  assert.deepEqual([b, busy.said], [{ outcome: 'refused', key: 'busy' }, []]);
});
test('a move that cannot be said is not applied', async () => {
  const NAMED = 'd'.repeat(40);
  // no way to say it was given, or saying it throws: refused, and the apply call is not made
  for (const say of [undefined, null, 'made-up', async () => { throw new Error('made-up'); }]) {
    const run = applying({ say }), r = await applyStep(run.deps, { ...input, namedHead: NAMED });
    assert.deepEqual([r, calls(run).includes('config apply --plan')], [{ outcome: 'refused', key: 'unread' }, false], String(say));
    // when master did not move there is nothing to say, and the apply is made without one
    assert.equal((await applyStep(applying({ say }).deps, input)).outcome, 'applied');
  }
});
test('a look older than two minutes is made again before the apply, and judged again', async () => {
  // the fake recheck moves the fake clock on by 121 seconds
  const slow = applying({ recheckTakes: 121 });
  await applyStep(slow.deps, input);
  assert.deepEqual(slow.events, ['tool:config plan --out', 'tool:deployment list --service', 'executing', 'probe', 'recheck',
    'tool:deployment list --service', 'executing', 'probe', 'head', 'tool:config apply --plan', 'tool:config plan --detailed-exit-code']);
  // at 120 seconds it is not made again
  const quick = applying({ recheckTakes: 120 });
  await applyStep(quick.deps, input);
  assert.equal(quick.events.filter((e) => e === 'probe').length, 1);
  // Railway became busy meanwhile: the second look refuses, and nothing is applied
  const busy = applying({ recheckTakes: 121, secondState: [{ status: 'BUILDING' }] }), r = await applyStep(busy.deps, input);
  assert.deepEqual([r.outcome, r.key, calls(busy).includes('config apply --plan')], ['refused', 'busy', false]);
  // master moved between the two looks: the three heads no longer agree
  const moved = applying({ recheckTakes: 121, secondProbeHead: 'f'.repeat(40) });
  assert.deepEqual((({ outcome, key }) => [outcome, key])(await applyStep(moved.deps, input)), ['refused', 'moved']);
  // a look that is stale a second time is not made a third time
  const slower = applying({ recheckTakes: 121, lookTakes: 121 });
  assert.deepEqual((({ outcome, key }) => [outcome, key])(await applyStep(slower.deps, input)), ['refused', 'unread']);
});
test('an apply that did not finish is not called failed: the closing plan says what Railway holds', async () => {
  for (const code of [124, 125]) {
    const took = applying({ applyExits: code, closingExits: 0 }), a = await applyStep(took.deps, input);
    assert.deepEqual([a.outcome, a.key, a.head], ['applied', 'applied', HEAD], String(code));
    const open = applying({ applyExits: code, closingExits: 2 }), b = await applyStep(open.deps, input);
    assert.deepEqual([b.outcome, b.key, b.code, b.head], ['left-over', 'applyUnknown', code, HEAD], String(code));
    assert.deepEqual(calls(open).slice(-2), ['config apply --plan', 'config plan --detailed-exit-code']);
  }
  // an apply the tool itself calls failed, and one that was never started, is failed: the closing plan is not read
  for (const code of [1, 126]) {
    const failed = applying({ applyExits: code }), c = await applyStep(failed.deps, input);
    assert.deepEqual([c.outcome, c.key, c.code, calls(failed).at(-1)], ['failed', 'applyFailed', code, 'config apply --plan'], String(code));
  }
});
test('step 3 makes four calls to Railway, in the design\'s order, and that is all', async () => {
  assert.deepEqual(calls(run), ['config plan --out', 'deployment list --service', 'config apply --plan', 'config plan --detailed-exit-code']);
  assert.deepEqual([r.outcome, r.head, r.appliedAt], ['applied', HEAD, AT]);
});
test('with the fallback switched on, the fifth call is the state read again, after the closing plan', async () => {
  assert.deepEqual(calls(run).slice(4), ['deployment list --service']);
  assert.equal(r.after, 'live');
});
test('the fallback read is not made when the apply call failed', async () => { /* config apply exits 1: four calls, no r.after */ });
test('the fallback read is made after an apply that left something over, or whose closing plan could not be read', async () => {
  // the closing plan exits 2, then exits 1: each time calls(run).slice(4) is ['deployment list --service'],
  // r.outcome is 'left-over', r.after is 'live', and r.head and r.appliedAt are given
});
test('a fallback that cannot confirm says so, and does not go on asking', async () => {
  // afterVerdict answers 'cannot' at the first read: one fifth call, r.after 'cannot'
  // the fifth call exits 1: r.after 'cannot'
});
test('the fallback waits 30 seconds between reads, and gives up after 75 minutes', async () => {
  // afterVerdict always answers 'waiting'; the fake wait records its argument and moves the fake clock
  assert.equal(run.waits.length, 150);
  assert.ok(run.waits.every((seconds) => seconds === 30));
  assert.equal(r.after, 'cannot');
});
test('without the fallback, an apply that exited 0 still says when it was made and for which commit', async () => {
  // fallbackRead false; outcomes 'applied', 'left-over' (exit 2) and 'left-over' (exit 1): each has r.head and r.appliedAt, none has r.after
});
test('a plan the reader does not read is a shape nobody knows, with no exit code', async () => {
  // the tool exits 0 and writes a plan that holds one key more; then one that is not JSON; then no file at all
  assert.deepEqual([r.outcome, r.key, Object.hasOwn(r, 'code'), calls(run)], ['failed', 'planShape', false, ['config plan --out']]);
});
test('a closing plan that is not empty is left-over, not applied', async () => { /* exit 2: leftOver; exit 1: closingUnread */ });
test('a failed apply never reaches the closing plan, and reports its exit code', async () => { /* ... */ });
test('every command the flow gives the tool is one its own step may make', async () => {
  for (const argv of planRun.tool.calls) assert.doesNotThrow(() => assertAllowed(argv, W, S, 'plan'));
  for (const argv of applyRun.tool.calls) assert.doesNotThrow(() => assertAllowed(argv, W, S, 'apply'));
});
test('nothing the tool wrote is in what the flow says', async () => {
  // the fake tool writes the text MADE-UP-TOOL-OUTPUT to its output files and into plan.json's summary fields
  assert.ok(!JSON.stringify(r).includes('MADE-UP-TOOL-OUTPUT'));
});
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/flow.test.mjs`. Expected:
  FAIL.
- [ ] **Step 3: Write `flow.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/flow.mjs .github/railway-settings-check/flow.test.mjs
git commit -m "feat(ci): the order of the two Railway settings token steps (T-751)"
```

**As built** (read from the code at the build's head, 27 November). `flow.mjs` holds the order above, and
beyond the first wording:
- `workdir` and `wait` in `deps`; the step's own commands come from `commandsFor`, so the flow cannot name a
  command its step may not make;
- step 5 reads `agreed`, not only `pending`: refusals first, then `upToDate` when the plan is agreed, and a
  plan that is neither pending nor agreed is `unread`;
- the plan file's text is compared just before the apply, as step 10 says;
- a call that could not be made, or ended with no whole-number code, is never read as `0`;
- `head` and `appliedAt` come back with every outcome after an apply call, a failed one included;
- `planStep` reading the plan it made; `planShape` in both steps; the closing plan after an apply that
  did not finish; the fifth call after every apply call that may have reached Railway.
- a head that was not read refusing `unread`, and `moved` kept for readable heads that differ; `namedHead`,
  `say` and `named`; `126` as a failed apply and not as one that did not finish.
The build also kept these stricter than the plan first asked, and the plan asks them as steps 6, 8, 9 and
10 word them: the look's age runs from before its first read, the state call; that age is checked once
more just before the apply, after the last read of the head; the probe's head is held to `gateHead` inside
the look, so a look that judged another commit refuses at once; the sentence about a move between the
approvals is said last of all before the apply call, after everything that could still refuse; and with
no `say` given, or one that throws, a move that must be said refuses `unread`. Its test file runs 56
tests. The test "a move that cannot be said is not applied" has this plan's title, cases and assertions,
written with the test file's own helpers and not the helper names of the text above.

**Still to change there:** nothing.

**What a person sees:** nothing yet.

### Task 10: The words

**Files:**
- Create: `.github/railway-settings/words.mjs`
- Test: `.github/railway-settings-check/words.test.mjs`. It needs the package `marked`, which Task 11's
  step 3 adds to the check folder. That step was done first, and is done.

**Interfaces:**
- Consumes: `lineMark` (Task 1).
- Produces: `SENTENCES`, by key; `sentence(key, values)`; `asText(text)` and `asName(text)`, the one way
  text from outside reaches a summary; and three functions that each return one summary:
  `gateWords(facts)`, `planWords(facts)`, `applyWords(facts)`. A summary is one text, not a list of lines:
  its parts with an empty line between every two, and an empty line after the last, so that nothing written
  after it joins its last sentence. A fact that is missing or in the wrong form is never printed as a word:
  the function throws, and the summary is written whole or not at all.

| Key | The sentence |
|---|---|
| `noEnvironment` | The environment railway-settings could not be read. Nothing was started. |
| `gateWrong` | The environment's rules are not as they should be. Nothing was started. |
| `notCurrent` | This run is not for master's trusted places as they are now. Approve the newer run. |
| `baseNotOnMaster` | The workflow's base code is not part of master's history. Nothing was started. |
| `notExact` | A trusted file on the runner is not the file git holds for its commit. Nothing was started. |
| `cannotShow` | The code that writes this page could not show this commit's files. Nothing was started. |
| `tooLarge` | What changed is too large to show on one page. Nothing was started. |
| `bypassUnseen` | This run cannot see whether administrators may bypass the gate. That rule rests on the founder's own check. |
| `writtenByLast` | This page was written by the code of commit {sha}, which an earlier run of this workflow applied, and not by this run's own copy of the files. |
| `writtenByBase` | This page was written by the code of commit {sha}, which the workflow file names as its base, and not by this run's own copy of the files. |
| `asText` | It shows this commit's files as text and runs none of them. |
| `vouch` | This step cannot vouch for the workflow file itself: a changed workflow file is the code that ran this step. |
| `vouchBase` | The workflow file also names the base code. A change to that file can change who writes this page. |
| `workflowChanged` | The workflow file changed. It is the one file this page cannot vouch for. Read its changed lines first. |
| `trust` | Approving "Read Railway's plan" gives this commit's code the Railway token. |
| `noneApplied` | No earlier run of this workflow applied a change. Everything the next steps run or read is shown in full. |
| `historyUnread` | The history of this workflow's runs could not be read in full, so the last change applied is not known. Everything the next steps run or read is shown in full. |
| `rehearsal` | Rehearsal. No token is stored. Nothing was read from Railway. This step waited for its own approval. |
| `settingsRefused` | The settings file is not one this workflow applies. Nothing was read from Railway. |
| `noToken` | No token is stored in the environment. Nothing was read from Railway. |
| `planFailed` | Railway's plan could not be read. Exit code {code}. |
| `planShape` | Railway's plan is in a shape this workflow does not know. This change is applied by hand. |
| `stateFailed` | Railway's own state could not be read. Exit code {code}. |
| `stateUnknown` | Railway answered about its own state in a shape this workflow does not know. |
| `stateQuiet` | Railway is not building or deploying just now. |
| `stateBusy` | Railway is building or deploying just now. Wait for it to finish before the second approval. |
| `upToDate` | Already up to date. Railway's plan shows no change. |
| `changedNoPlan` | Railway's plan shows no change, though the settings file declares something other than at the last change applied. Compare Railway's dashboard with the file. Nothing is applied from GitHub. |
| `redeploys` | Applying this redeploys the API at master's head, which is commit {sha} now, with its migration step. |
| `shape` | The workflow judges the shape of a change, not its meaning. What the marked lines mean is yours to judge. |
| `staged` | Before the second approval, look at Railway's dashboard. If it shows staged changes, do not approve. |
| `deployRun` | Do not approve a Deploy run until "Apply this plan" has finished. |
| `hand` | This change is applied by hand. |
| `stale` | The plan was read more than six hours ago. Start a new run. |
| `linesDiffer` | Railway changed since the plan was read. Nothing was applied. Start a new run. |
| `busy` | A deploy or a migration is under way. Nothing was applied. Start a new run later. |
| `behind` | Production does not yet run master's API code. Nothing was applied. |
| `unread` | Something this step must read before it applies could not be read. Nothing was applied. |
| `moved` | master moved while this step ran. Nothing was applied. "Re-run failed jobs" tries again on one approval. "Run workflow" starts afresh. |
| `namedMoved` | master moved since step 2 named commit {named}. This apply redeploys the API at commit {sha}. |
| `applyUnknown` | The apply did not finish. Exit code {code}. Whether Railway took it is not known. A person looks. "Run workflow" shows what Railway holds. |
| `notAsInstalled` | The kit, the tool or the runtime on the runner is not what was installed. Nothing was applied. |
| `applyFailed` | The apply failed. Exit code {code}. "Run workflow" shows what Railway holds. |
| `leftOver` | Applied, but something still differs. A person looks. |
| `closingUnread` | Applied, but the plan that should now be empty could not be read. Exit code {code}. A person looks. |
| `applied` | Applied. Nothing is left to change. |
| `headMoved` | master moved while this ran. If the newer commit changed a trusted place, it has its own run. |
| `live` | Railway reports the new deployment live at commit {sha}. |
| `redeployFailed` | Railway reports that the new deployment failed. The previous deployment keeps serving. |
| `notConfirmed` | The redeploy is not confirmed: no record of it by Railway, for master's head, reached GitHub. |
| `cannotConfirm` | The redeploy is not confirmed: Railway's own list could not show that it is live. |
| `noOutcome` | This job ended without a record of what it did. A person reads the failed step. "Run workflow" shows what Railway holds. |
| `cutShort` | This job was cancelled or ran out of time. Whether Railway took the apply is not known. "Run workflow" shows what Railway holds. |
| `waitCutShort` | This job was cancelled or ran out of time while it waited for the redeploy. The redeploy is not confirmed. "Run workflow" shows what Railway holds. |

The four sentences about the redeploy (`live`, `redeployFailed`, `notConfirmed`, `cannotConfirm`) do not
begin "Applied". Each follows the sentence of an outcome whose apply call may have reached Railway:
`applied`, `leftOver`, `closingUnread` or `applyUnknown`. That outcome's sentence says what is known of the
apply. Read after `applied`, `notConfirmed` still says what design 6.6 asks: the apply succeeded and the
redeploy is not confirmed.

**The two sentences for a job that was cut short never contradict the outcome's own.** `cutShort` is said
only when the job left no record of what it did: nothing is known, and it says so. `waitCutShort` is said
after the sentence of an outcome whose apply call may have reached Railway, when the wait for the redeploy
was stopped before it had an answer: what is known of the apply has just been said, and only the redeploy
is unconfirmed. After a refusal or a failed apply neither is said: "nothing was applied" is the whole
truth, cut short or not.

**What step 1 says of itself** (the release lead's blocker). Exactly one of `writtenByLast` and
`writtenByBase`, with the commit whose code wrote the page; then `asText`. Both name the commit and say how
it came to be trusted, and neither says "not this commit's code": on a run for the very commit that was
last applied, the code that writes the page is that commit's, and the sentence must still be true. `asText`
is true of the whole job, not only of the page: nothing of the commit runs in `gate` (Task 12). Near the
end, always `vouch`, the design's own sentence, and then `vouchBase`. When the workflow file is among the changed files,
`workflowChanged` stands before the list and that file's lines come first. Together they say what the page
can vouch for (it was written by code this commit did not change, and shows the commit's files as text) and
what it cannot (the workflow file, which is the code that ran the step and which names the base code).
Nothing on the page says or implies more than that.

**How text from outside is shown.** Anything that comes from the commit or from Railway is outside text: a
file's name, a file's text, changed lines, a line of the plan, a reason. Two functions write it, and nothing
else may put outside text into a summary:
- `asText(text)` writes, in this order: the backslash as two backslashes; every character other than
  printable ASCII, tab and line feed as `\uXXXX`; and `&`, `<` and `>` as `&amp;`, `&lt;` and `&gt;`. Its
  result goes between `<pre>` and `</pre>`. The `<pre>` stands at the start of a line with an empty line
  before it, so that it opens a block of its own that only `</pre>` ends; the escaped text cannot hold
  one. Empty lines in the text therefore end nothing.
  - **Why the backslash is doubled.** Without it a file that holds the six characters `\u000D` and a file
    that holds a real carriage return are drawn alike. With it the first reads `\\u000D` and the second
    `\u000D`, and every `\uXXXX` on a page is a character the page drew, never one the file wrote.
  - **A line end that is not a line feed is drawn as a line end.** JavaScript ends a line at a carriage
    return, at U+2028 and at U+2029, as well as at a line feed. Git and a page end one only at a line
    feed. So a line can read as a comment on the page and hold live code after such a character. After
    the code of one of the three, `asText` therefore breaks the line, and begins the rest with the fixed
    mark `[new line] `. A carriage return that stands just before a line feed gets no extra break: the
    line ends there anyway. So `// a note`, a carriage return and `o.a = 2;` is drawn as two lines,
    `// a note\u000D` and `[new line] o.a = 2;`.
  - **The mark is always the page's.** A file could hold the mark's own words at the start of a line. So
    `asText` writes a `[` that begins a line as its code, `\u005B`: a line on the page that begins
    `[new line] ` was begun by the page, never by the file.
  - **Codes are written in capitals,** `\u202E`. A plan line writes its own in small letters (Task 1).
- `asLine(text)` is for one line inside a `<pre>`: a line of the plan, or a reason. It doubles the
  backslash, writes every character other than printable ASCII as `\uXXXX`, tab and every kind of line end
  among them, and escapes the three marks of markup. So it is one line, whatever it holds.
- `asName(text)` is for a name on a line that is not inside a `<pre>`: a file's name in a block's header,
  in the line for a removed file, in the line for a link. Such a line can be read as Markdown, whose marks
  would turn a name into a link, a picture, emphasis or code. **One rule, in two passes, in this order.**
  First, what `asLine` does to the text but for the three marks of markup: the backslash doubled, then
  every character outside printable ASCII written as `\uXXXX`. Second, an allow-list over the result:
  letters, digits, the space, `/` and `-` are written as they are, and every other character is written
  as its numbered HTML entity, `.` as `&#46;`, `_` as `&#95;`, `[` as `&#91;`, `$` as `&#36;`, and every
  backslash as `&#92;`. A page shows an entity as the character it stands for, and no renderer reads one as
  a mark. Its result goes between `<code>` and `</code>`, on one line.
  - **The order is what keeps a name one to one.** A backslash the name itself holds is doubled in the
    first pass, so it reaches the page as two entities, `&#92;&#92;`; the backslash of a code the page
    drew is one. So a name that holds the character U+202E is written `a&#92;u202Eb`, and a name that
    holds the six written characters of that code is written `a&#92;&#92;u202Eb`: two names, two pages. An
    earlier wording applied the allow-list with no doubling, and the two were drawn alike.
So a code fence, a closing tag, a comment mark, a link, a mention or a character that reverses the reading
order reaches the page as the characters it is. Fixed sentences are never mixed into such a block. Every
fixed sentence is a paragraph of its own, with an empty line before and after, so that no renderer joins
two.

**The three summaries.** Each ends with `bypassUnseen` when the gate could not see the bypass answer
(`bypassChecked` of Task 5 is false).

Step 1, `gateWords({ sha, pullRequest, bypassChecked, writtenBy, history, lastAgreed, changed, full, versions })`.
`writtenBy` is `{ is: 'last' | 'base', sha }`. `history` is `'found'`, `'none'` or `'unread'`. `changed` is a
list of `{ status: 'changed' | 'added' | 'removed', path, diff }`, where `diff` is git's own text for that
file. `full` is a list of `{ path, text }` or `{ path, link }`. It takes no `rules`: this summary is written
only when the gate's rules were as they should be, so its line about the gate is fixed, but for the bypass
answer. With a last change applied:

```
## Railway settings: what this run trusts

Commit abc1234 (pull request #123), on master.

The gate: one reviewer, the repository's owner. Self-review allowed. master only. Administrators cannot bypass.

This page was written by the code of commit def5678, which an earlier run of this workflow applied, and not by this run's own copy of the files.

It shows this commit's files as text and runs none of them.

This workflow last applied a change at commit def5678 (run 456).

Changed since then, in what the next steps run or read: 1 file.

<details open><summary>changed: <code>&#46;railway/railway&#46;ts</code></summary>

<pre>
@@ -40,7 +40,7 @@
-    healthcheckTimeout: 2700,
+    healthcheckTimeout: 3000,
</pre>

</details>

Railway's tool 5.74.0, kit 3.17.0, runtime v22.23.2.

This step cannot vouch for the workflow file itself: a changed workflow file is the code that ran this step.

The workflow file also names the base code. A change to that file can change who writes this page.

Approving "Read Railway's plan" gives this commit's code the Railway token.
```

(The page's source writes the file's name by `asName`, so each `.` in it is the entity `&#46;`; the reader
sees `.railway/railway.ts`.)

Every changed file has a block: its status and name as the header, then its changed lines as git wrote them,
unfolded. An added file's lines are its whole text. A removed file has no block: it is named in one line
of its own, `removed:` and its name. No unchanged file is listed. The files come in the order of the
trusted places, the workflow file first when it changed. With nothing changed it says
`Nothing changed in what the next steps run or read.`

With `history` `'none'` it says `noneApplied` in place of the "last applied" and "changed since" lines; with
`'unread'`, `historyUnread`. Either way it then shows every file of `full`: the name and its number of lines
as the header of a folded block, and its text inside. A link is not followed and has no block: one line of
its own says it is a link and names its target with `asName`. (The proof of `head/` refuses a link before
the page is written, Task 12; this form is the page's own second guard.) That is every run until this workflow has applied its first change: a
run that only finds Railway up to date does not count as one (design 6.2). With no pull request found it
names the commit alone. When the bypass answer was not seen, the gate's line ends
`Whether administrators can bypass: not seen by this run.` A version that is not three numbers with dots
reads `(unreadable)`.

Step 1 holds no line about what the settings file's change will do on Railway. The first plan had one,
"What the file changes". It needed the commit's file to be run before the page was written, and design
section 2 does not ask for it. The changed lines of `.railway/railway.ts` are on the page; what Railway
makes of them is step 2's.

Step 2, `planWords({ render, sha, state, fileChanged, bypassChecked })`: the heading `## Railway's plan`,
then the lines of Task 1 in one `<pre>`, each line through `asLine` so that it stays one line whatever it
holds. For a plan to apply, a line that `lineMark` marks begins `[yours to judge: <the mark>] `, before its
name: a mark at the start of a line cannot be pushed out of sight or swallowed by what a value holds. Then
`redeploys`, then `shape` when any line is marked, then the sentence for `state` (`stateQuiet` or
`stateBusy`), then `staged` and `deployRun`. For a plan with refusals, whether or not it holds a change:
the lines, then `hand`, then `Why:` and the reasons in a `<pre>`, then the sentence for `state`. **A refused
plan's lines carry no marks, and `shape` is not said.** A mark asks him to judge a line before he approves
it, and a refused plan is not his to approve from GitHub; the build chose this and the plan follows it.
Only for a plan that is `agreed` (Task 1): `upToDate`, or `changedNoPlan` in its place when `fileChanged`
is `true`; then the sentence for `state`. `fileChanged` is Task 4's `declarationChanged` of the two
readings step 2 made. The refusals are looked at first, as in Task 9. There is no sentence that compares
the plan with a prediction: step 1 makes none.

When the settings file is refused, or the plan is not read, step 2 has no plan to show: the command that
found it writes the heading and the one sentence, `settingsRefused` with `Why:` and the plain problems in
a `<pre>`, or `planShape` alone (Tasks 12 and 20).

Step 3, `applyWords({ result, redeploy, headMoved, bypassChecked })`: the heading `## Apply this plan`, the
sentence for `result.key` (`planShape` is one of its keys, with the outcome `failed`; `moved`, with
`refused`; `applyUnknown`, with `left-over`), then for `hand` the line `Why:` and `result.reasons` in a
`<pre>`. What follows goes by the outcome, not by an exit code:
- **`applied` or `left-over`:** the apply call may have reached Railway. When the answer carries `named`,
  the sentence `namedMoved` comes next, before anything about the redeploy: he reads which commit was
  redeployed, and that it is not the one step 2 named, before he reads what became of it. It is in the
  summary once, here. Then the sentence for the redeploy's state: `live`, `redeployFailed`, `notConfirmed`,
  or `cannotConfirm` when the fallback's list could not show it. When the job was cut short before the
  wait had an answer, `waitCutShort` stands in that sentence's place.
- **`refused` or `failed`:** nothing reached Railway, or the tool itself said the apply failed. Nothing is
  said of a redeploy, and nothing of a move between the approvals even when a failed apply's answer
  carries `named`: "this apply redeploys" must never stand beside "the apply failed". Nothing is said of a
  job cut short either.
Then `headMoved` when true. With no `result` at all it is the heading and `noOutcome`, or `cutShort` in its
place when the job was cut short. The function takes one more fact for this, `cutShort`, which is `true`
only when the job was cancelled or ran out of time: `applyWords({ result, redeploy, headMoved, cutShort,
bypassChecked })`. It counts only as exactly `true`: any other value is a job that was not cut short.
With an outcome that needs a redeploy's sentence, exactly one of `redeploy` and `cutShort` must be given,
or the summary is not written.

In `redeploys` and `live` the commit is `master`'s head, because that is what Railway deploys. It can be
newer than the run's commit when the trusted places are the same in both.

- [ ] **Step 1: Write the failing tests.**
  - One that holds the table above as data and compares every key.
  - One for each summary comparing the whole text for the examples above.
  - One for each row of design 6.8 that `applyWords` or `planWords` gives the sentence that row calls for.
  - **With a last change applied:** the summary shows the changed lines of a changed `.mjs` and of
    `pins.json`, each under its own name; an added file's whole text; a removed file's name with no lines;
    and no unchanged file. With the workflow file among them, `workflowChanged` comes before the list and
    that file's block is first.
  - **With none:** each file's name and text, `noneApplied`; with `history` `'unread'`, `historyUnread` and
    not `noneApplied`. A link is named with its target and no text.
  - **Who wrote the page:** `writtenByLast` with the commit when `writtenBy.is` is `'last'`,
    `writtenByBase` when `'base'`, never both, never neither; `asText`, `vouch` and `vouchBase` in every
    form of the summary, word for word. With the run's own commit the same as the commit whose code wrote
    the page, as on a check run made just after an apply, each sentence on the page is still true: neither of
    the two sentences about who wrote the page, nor `asText`, holds the words "not by this commit's code".
    (`trust` does speak of this commit's code, and rightly: the approval gives it the token.)
  - **A line end inside a line is drawn as a line end.** A file's text and a changed line that each hold
    `// a note`, then a lone carriage return, then `o.a = 2;`: the page shows `// a note\u000D`, a line
    break, and `[new line] o.a = 2;`. The same with U+2028 and with U+2029. A carriage return just before a
    line feed adds no line. And a text that holds the six written characters of `\u000D` is drawn with its
    backslash doubled, so the two pages differ. In a name, all four stay on the one line, as their codes.
    And a file whose line begins with the mark's own words, `[new line] x`, after a line that ends in a
    carriage return and a line feed, is not drawn like a lone carriage return before `x`: its `[` is
    written as a code.
  - **A name is drawn one to one.** Two names, as the name of a removed file and as the target of a link:
    `.railway/a`, the character U+202E, `b`; and `.railway/a`, a backslash, `u202Eb`. The two are written
    differently, the first with one `&#92;` before `u202E` and the second with two. And for every name of
    the cases below, the text inside the page's `<code>`, with its entities turned back and then its
    doubled backslashes and codes turned back, is the name again.
  - **A name cannot be markup.** Each of these is the name of a changed file, of an added one, of a removed
    one, of a file shown in full and of a link, and the target of a link: `[x](https://example.invalid)`;
    `![x](https://example.invalid/x.png)`; `*x*` and `_x_`; a name in backticks; `<b>x</b>`;
    `www.example.invalid`; a word, an at sign and `example.invalid`, as a mail address is written; `~~x~~`;
    `a|b`; `$x$`, which GitHub reads as mathematics. Rendered with `marked`, the block's header, the
    removed line and the link line each hold no `<a>`, no `<img>`, no `<em>`, no `<strong>`, no `<del>` and
    no `<code>` but the one the page wrote, and the text inside that `<code>` is the name, character for
    character. And in the page's source no `$`, `.`, `_`, `*`, backtick or bracket of a name stands as
    itself: each is its entity.
  - **Hostile text is shown as text.** Each of these is put, in turn, into a file's name, a file's text, a
    changed line, a value in a plan line and a reason: three backticks on a line of their own; `</pre>`;
    `</details>`; `<!--` on one line and `-->` on a later one; `[x](https://example.invalid)`;
    `@made-up-name`; `<img src=x>`; a line of `#` heading; the character U+202E; a carriage return; a
    backslash. The summary is then rendered with `marked`, and the test asserts on the result: the number
    of `<pre>` elements is the number of blocks the facts hold; no `<a>`, `<img>` or heading comes from the
    text; no HTML comment is in the result; every fixed sentence after the block is still there, each in a
    `<p>` of its own and none inside a `<pre>`; and the text of each `<pre>`, with its escapes turned back
    in the reverse of `asText`'s order and its `[new line] ` breaks taken out, is `asText`'s input again.
  - **A mark cannot be hidden.** A plan whose health-check value holds `<!--`, and whose next line is the
    pre-deploy command: both marks are in the rendered result, each at the start of its line.
  - **The committed README renders whole.** `full` is built from the real files of the three trusted
    places, `.railway/README.md` among them, whose own code fences broke the first build's page. Rendered
    with `marked`: one `<pre>` for each file and no more; the README's fences appear as characters inside
    its `<pre>`; `vouch`, `vouchBase` and `trust` come after the last block, outside any `<pre>`. (Task 25
    moves the README; the test then reads it from its new place, as one more made-up trusted file.)
  - Each of the four marks appears at the start of its line and brings `shape`; a plan with no marked line
    has neither; and a refused plan that holds a line `lineMark` would mark shows that line with no mark,
    and no `shape`.
  - A plan that is agreed reads `upToDate`, word for word, with `fileChanged` false or left out; with
    `fileChanged` true it reads `changedNoPlan` and the words "Already up to date" are nowhere in it. A plan
    to apply and a refused plan read the same whatever `fileChanged` is.
  - `applyWords` with the key `planShape` and the outcome `failed` gives that sentence, with no exit code
    in it and no redeploy's sentence after it.
  - Each summary is one text that ends with exactly one empty line.
  - Step 2's summary carries `stateQuiet` or `stateBusy`, word for word, in each of its three forms (a plan
    to apply, a refused plan, already up to date), and never both.
  - A plan with no change and one refusal reads `hand` and its reason, and never `upToDate`.
  - After `leftOver`, after `closingUnread` and after `applyUnknown`, `applyWords` gives the redeploy's
    sentence too; after a refusal or a failed apply it gives none; with no result it gives `noOutcome`.
  - `namedMoved`, with both commits, stands once, after the outcome's sentence and before the redeploy's,
    for `applied` and for each key of `left-over`. After a failed apply whose answer carries `named`, and
    after a refusal, it is nowhere in the summary.
  - **A job cut short.** With no result and `cutShort` true: the heading and `cutShort`, and not
    `noOutcome`. With an outcome of `applied`, and of each key of `left-over`, no `redeploy` and `cutShort`
    true: the outcome's sentence, then `waitCutShort`, and neither `cutShort` nor any sentence that says
    whether Railway took the apply. With a refusal, and with a failed apply, and `cutShort` true: the
    outcome's sentence and nothing about the job being cut short. With an outcome that needs a redeploy's
    sentence and neither `redeploy` nor `cutShort`, and with both, the function throws.
  - All three summaries end with `bypassUnseen` when the answer was not seen, and none does when it was.
  - No sentence holds a `{` once its values are filled, and a value that is not a commit id or a whole
    number is never filled in.
- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/words.test.mjs`.
  Expected: FAIL.
- [ ] **Step 3: Write `words.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/words.mjs .github/railway-settings-check/words.test.mjs
git commit -m "feat(ci): every sentence the Railway settings workflow says (T-751)"
```

**As built** (read from the code at the build's head, 27 November). `words.mjs` holds the three summaries as
this task words them, with these things the build settled and the plan follows:
- a summary is one text that ends in an empty line, not a list of lines;
- a removed file, and a link, are each one line of their own and not a folded block's header;
- a refused plan's lines carry no marks;
- `gateWords` takes no `rules`: its line about the gate is fixed but for the bypass answer;
- **`asName` is the one rule above, and was so in the build before this plan said it rightly:** the
  backslash doubled, then the codes, then the allow-list with numbered entities. The plan's last wording
  left the doubling out; the build kept it, and the plan now follows the build;
- `namedMoved` is said only after an apply that may have reached Railway. A failed apply's answer can
  carry `named`, and nothing is said of it.
It also holds `asLine`, a `[` that begins a line written as its code, the line ends drawn with their
mark, the who-wrote sentences, `planShape`, `settingsRefused`, `notExact`, `changedNoPlan`, `moved`,
`redeploys`, `applyUnknown`, `namedMoved`, `cutShort` and `waitCutShort` in the words of the table,
`{named}` filled as `{sha}` is, and `fileChanged`. Its codes are in capitals, `\u202E`, which stays (Task
1's note says why).
The check folder's two packages are pinned: `marked` 15.0.12 and `yaml` 2.9.1. Its test file holds 40
tests.

**Still to change there:** nothing. The last changes, each with its test written first, were:
- one new sentence, `waitCutShort`;
- `applyWords` taking `cutShort`: `cutShort` in place of `noOutcome` when there is no result, and
  `waitCutShort` in place of the redeploy's sentence when the wait was stopped. Until then `applyWords`
  had no such fact, and the sentence `cutShort` was in the table with nothing that said it;
- two tests that the code passed as it stood: the pair of names that differ only by a written code
  against the character, and `$` among the marks of a name.

**What a person sees:** nothing yet. These are the words the founder will read on the run's page.

### Task 11: The CI check, and the idle step retired

Design 6.7. It reads every workflow file as YAML and checks structure. It holds no list of banned words.

**Files:**
- Create: `.github/railway-settings-check/check-workflows.mjs`, `.github/railway-settings-check/package.json`,
  `.github/railway-settings-check/package-lock.json`
- Test: `.github/railway-settings-check/check-workflows.test.mjs`,
  `.github/railway-settings-check/trusted-folder.test.mjs`
- Modify: `.github/workflows/ci.yml`: the header comment at lines 13-15; `gate-tooling`'s `timeout-minutes`
  from 5 to 10; the kit step of Task 4 also runs
  `npm ci --ignore-scripts --prefix .github/railway-settings-check`; the step at lines 633-672 is replaced by
  `Railway settings: every workflow file, the trusted places, the watch list`, running
  `node .github/railway-settings-check/check-workflows.mjs`

**What parses YAML.** The `yaml` package, in the check folder's own `package.json` and `package-lock.json`,
installed with `npm ci --ignore-scripts`. It is not a root dependency and the folder is outside the pnpm
workspace, so no watched path changes. It is not in a trusted place: only CI's tooling job installs it, and
no approved job reads that folder. It reads YAML 1.2, so the key `on` stays a string, and it reports
duplicate keys. `package.json` is `private`, with two `devDependencies`, each at an exact version: `yaml`
2.9.1 and `marked` 15.0.12, the newest 2.x and 15.x releases on the day the build pinned them.

**What renders a summary, in one test.** `marked`, with GitHub's flavour switched on. Task 10's test file
uses it to render a summary as a reader's page would, and asserts on the result. It is the same line of
that package the release lead's review ran against the committed README. It is not GitHub's own renderer,
so it is a second opinion and not a proof: the founder's own look at the real page in Task 17 is the proof.
Neither package has dependencies of its own; if a release ever gains one, pin the last that has none.

**What becomes of the idle step** ("Railway watch list is valid, and equals railway.json's if that file
exists", `ci.yml:633-672`). `railway.json` was deleted on 22 November, so the step compares nothing. Its two
duties move into the new check: the watch list must be a non-empty list of paths that each begin with `/`
(the production receipt and Task 7 read it), and `railway.json` must not exist at the repository's root. A
file that came back would be read by Railway until 1 December 2026 and ignored after; either is a mistake.

**Interfaces:**
- Produces:
  - `checkWorkflows(files: { [name: string]: string }): string[]`, problems as `file: what is wrong`.
  - `TRUSTED_FILES`, the names the trusted folder may hold: `cli.mjs`, `declared.mjs`,
    `evaluate-settings.mjs`, `exact.sh`, `flow.mjs`, `gate.mjs`, `install-runtime.sh`, `install-tool.sh`,
    `look.mjs`, `pins.json`, `plan-lines.mjs`, `redeploy.mjs`, `run.sh`, `since-last.sh`, `tool.mjs`,
    `words.mjs`.
  - `checkTrustedFolder(entries: { [name: string]: string }): string[]`, over the folder's names and texts.
  - `checkSettingsImports(source: string): string[]`, over the text of `.railway/railway.ts`.
  - `checkWatchList(list: unknown): string[]` and `checkNoOldFile(names: string[]): string[]`.
  - `RUN_LINES`, every `run` line the workflow may hold, and `FIVE_COMMANDS`, the five commands written out
    for a made-up work folder and service (rule 16).
  - `PROOF_LINES = { base, code, own }`, the three lines that take `exact.sh` out of git as stored and run
    it, each written out whole (rule 12). They are among `RUN_LINES`.
  - `REHEARSAL` and `LIVE`, in `workflow-fixtures.mjs`: the workflow's text in its two forms, with made-up
    ids. They are fixtures and stay as they are when the committed file changes. The tests of the rules
    plant their violations in them. Three tests tie them to the committed file, one at each stage of the
    build (Tasks 14, 20 and 21).
  - `checkWorkflows` takes the repository's full name as a second argument, so that a fixture can carry a
    made-up one; run as a program it gives `GITHUB_REPOSITORY`.
  - `checkNoLinks(entries: { path: string, isLink: boolean }[]): string[]` (rule 26). Run as a program, the
    check reads each entry of the three trusted places without following links.
  - `checkNoNpmSettings(paths: string[]): string[]`, over the path of every file under `.railway/` as git
    lists them, folders within it included (rule 27).
  - Run as a program, it reads `.github/workflows/*.yml` and `*.yaml`, the trusted folder, and
    `.railway/railway.ts`; evaluates that file (Tasks 3 and 4); reads the watch list; prints each problem as
    `::error file=<file>::<problem>` and exits 1 when there is any. With none it prints
    `Railway settings: <n> workflow files checked.`

**The rules.** In every workflow file:

1. It parses with no error, and its top level is a map with `jobs`.
2. Every job's `environment`, when present, is a plain string or a map whose `name` is a plain string. A
   value holding `${{` is refused.
3. An environment name that equals `railway-settings`, ignoring case and outer spaces, is allowed only in
   `railway-settings.yml`.
4. No job calls a reusable workflow (`jobs.<id>.uses`) from outside `./.github/workflows/`.
5. No workflow but `railway-settings.yml` names a secret that begins `RAILWAY`. **The rule reads the file's
   text, not only its parsed values,** so it holds wherever the words stand: a `run` text, a `with`, an
   `env` at any level, a container's or a service's credentials, a step's name. Every place the word
   `secrets` stands as a name by itself, in any letter case, is found, and what follows it decides:
   - a dot and a name that begins `RAILWAY`, in any letter case, fails;
   - index syntax (`[`, with any spacing) fails: the name inside could be computed;
   - the object filter (`.*`) fails: GitHub's expressions allow it on an object, and
     `join(secrets.*, ',')` gives every secret's value;
   - the bare word handed to a function (`toJSON(secrets)`) fails.
   And no job passes `secrets: inherit`. Any of these could name such a secret without writing it.
6. A file whose `run` text holds `db:migrate`, `drizzle-kit migrate` or `apply-migration-` is in
   `MIGRATION_WORKFLOWS` (Task 7).

In `railway-settings.yml`, also:

7. `on` is exactly `push` with `branches: [master]` and `paths` equal to the three trusted places
   (`.railway/**`, `.github/railway-settings/**`, `.github/workflows/railway-settings.yml`), and
   `workflow_dispatch` with no inputs. No other key.
8. The top-level `permissions` is the empty map. There is no top-level `concurrency`, `env` or `defaults`.
9. The jobs are exactly `gate`, `plan` and `apply`, by those ids, named as in "Names every task uses". The
   ids matter: `runTool` lets a job make only the calls of the step its id names (Task 3). `plan` needs
   `gate`; `apply` needs `gate` and `plan`. Each runs on `ubuntu-24.04` and has `timeout-minutes`. None has
   `container`, `services`, `strategy`, `continue-on-error`, `concurrency` or `env`.
10. Every job states its own condition and its own permissions. Its `if`, with spaces squeezed, is the fixed
    text `github.repository == '<this repository>' && github.ref == 'refs/heads/master'`, with the same full
    name in all three jobs; when CI runs the check, that name must be the one in `GITHUB_REPOSITORY`. For
    `apply` the text is followed by `&&` and a bracketed test of `needs.plan.outputs`, which rule 14 fixes
    by the job's form. Its `permissions` is a map whose keys are among `contents`, `actions` and
    `deployments` and whose values are all `read`.
11. `gate` has no `environment`. `plan` and `apply` each have exactly
    `environment: { name: railway-settings, deployment: false }`, so they make no deployment record.
12. **What each job runs.** Every `uses` in the file is `actions/checkout@` followed by 40 hex characters,
    the same 40 everywhere, with `persist-credentials: false` and `sparse-checkout-cone-mode: false`. Every
    `run` is, after trimming, one of the lines in `RUN_LINES`, a list held in the check, and holds no `${{`.
    No step sets `shell`, `working-directory` or `continue-on-error`.
    - **No trusted file is run from a checkout that has not been proven.** The step straight after each
      checkout is that checkout's proof, and no `run` line of that copy stands before it. For `base`,
      `code` and an approved job's own checkout the proof is one of `PROOF_LINES`, word for word:
      `git -C base cat-file blob HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-base.sh" && bash "$RUNNER_TEMP/exact-base.sh" base`,
      the same with `code` in all four places, and for an approved job
      `git cat-file blob HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-own.sh" && bash "$RUNNER_TEMP/exact-own.sh" own`.
      These three are the only `run` lines of the file that do not begin `bash` and a copy's folder. They
      run nothing from a checkout: they take one file out of git as it is stored and run that. For `head`
      the proof is the line `bash code/.github/railway-settings/exact.sh head`, run by the copy already
      proven. A line that reads the file with `cat`, or takes it with `git show` and a flag that turns
      conversion on, or runs `exact.sh` from the checkout, is not one of the lines and fails.
    - **Every sparse list is written from the root.** Its lines are, letter for letter, `/.railway/`,
      `/.github/railway-settings/` and `/.github/workflows/railway-settings.yml` for the three places, and
      `/.github/railway-settings/` alone for the trusted folder. Any other line fails: a line with no slash
      in it would match a folder of that name at any depth, and the check does not weigh which other
      spellings git would happen to read the same way. No checkout is without its list.
    - **In `plan` and `apply`:** one checkout, with a sparse checkout of exactly the three trusted places
      and no `ref`, `path` or `repository`. After the proof, every `run` begins
      `bash .github/railway-settings/`. So everything an approved job runs or reads is in the trusted
      places, at the run's own commit, as git holds it.
    - **In `gate`:** exactly three checkouts, in this order, with exactly these inputs beside the two
      above. First `path: base`, `ref:` 40 hex characters written out, sparse checkout of the trusted
      folder alone. Second `path: code`, `ref` exactly
      `${{ steps.gate.outputs.display_sha }}`, the same sparse checkout; its step has no `if` and comes
      after the step whose `id` is `gate`. Third `path: head`, no `ref`, sparse checkout of exactly the
      three trusted places. None has `repository`. Beside the two proof lines, every `run` begins
      `bash base/.github/railway-settings/` or `bash code/.github/railway-settings/`. None begins
      `bash .github/`, and none holds `head/`: the run's own commit is never started in this job. The one
      mention of `head` in a `run` line is the last word of its proof. **No line of this job is the kit
      line, a `declared` line or any line that evaluates or installs:** the job's lines are exactly the
      eight of Task 14, in the job's own order: the base copy's proof, its `install-runtime.sh`, its
      `run.sh gate`; then the code copy's proof, `exact.sh head`, the code copy's `install-runtime.sh`,
      `since-last.sh` and `run.sh show`. Every line that begins `bash base/` comes before the second
      checkout. The step whose `id` is `gate` runs the base copy's `run.sh gate`, and its
      `env.BASE_SHA` is the same 40 hex characters as the first checkout's `ref`, a literal in both places.
13. **The `secrets` context, as an allow-list over the file's text.** As in rule 5, every place the word
    `secrets` stands as a name by itself is found, in any letter case, inside an expression or outside
    one. Each must be one of two things, spelled exactly so, in lower case and upper case as written here:
    - `secrets.RAILWAY_SETTINGS_TOKEN`, as the whole value `${{ secrets.RAILWAY_SETTINGS_TOKEN }}` of
      `env.RAILWAY_SETTINGS_TOKEN` of the one token step rule 14 names: at most once in `plan` and at most
      once in `apply`, and never in `gate`;
    - `secrets.GITHUB_TOKEN`, as the whole value of a step's `env.GITHUB_TOKEN`, where a step needs it.
    Everything else fails: another name; `Secrets.RAILWAY_SETTINGS_TOKEN` or any other letter case of an
    allowed form; index syntax; the object filter `.*`; `toJSON(secrets)`; the word anywhere else in the
    file, a step's name or a comment included. Design 6.7 asks for the two literals and nothing else.
14. **Each approved job is whole, in one of two forms, and is judged by itself.** In both forms its steps
    begin with the checkout, its proof, the runtime and then `gate again`, before the kit, the tool or
    anything else. Then come the kit, the tool, the check of the tool, in `plan` the line `exact.sh last`,
    and the line `run.sh declared`, which reads what the settings file declares with no token. In both
    forms that line stands before any step that names a secret. **In both forms no step of `plan` or of
    `apply` is named `Nothing is left to change`, in any letter case, but the one step the live form of
    `apply` gives that name below:** that name on a step that succeeded is the whole evidence that a
    change was applied (Task 5).
    **No file of a checkout is started when its proof did not pass: no step of the file has an `if`, but
    three.** In both forms the proof step has the `id` `proof` and the step that installs the runtime has
    the `id` `runtime`. A step with no `if` is skipped once an earlier step has failed or the job is
    cancelled, so it cannot run after a proof that refused. A step with an `if` may: GitHub leaves its own
    "only after success" out of any condition that names a status function, `success()` as much as
    `always()`, so `${{ success() || true }}` runs after a failure as surely as `${{ always() }}` does.
    The check therefore weighs no condition. It is an allow-list: **in all three jobs, in both forms, the
    key `if` on a step fails**, whatever it holds, with three exceptions, all in the live `apply` and all
    written out below. Each must be its text letter for letter, with spaces squeezed, and each stands on
    its own step and on no other:
    - the step that runs the `agreed` line: `steps.apply.outputs.outcome == 'applied'`. It names no status
      function, so GitHub still holds it to the success of every step before it;
    - the step that runs the `wait` line, and the step that runs the `after` line: the two conditions
      below. Both name the proof's and the runtime's success.
    So a plain `if: true` fails; so does any of the three on another step, the wait's on the token step
    among them; and so does one of the three steps with its `if` changed or taken away. `gate` has none
    at all: a page written after a proof that refused would show files nobody proved.
    - `plan` in rehearsal form: its last step's `run` is the `rehearse plan` line. It names no secret and
      holds neither the `plan` line nor the `render` line.
    - `plan` live: exactly one step runs the `plan` line. It is named "Read Railway's plan, with the token"
      and holds the token as rule 13 says. The next step runs the `render` line, has the `id` `render` and
      names no secret. The job holds no `rehearse` line.
    - `apply` in rehearsal form: its last step's `run` is the `rehearse apply` line. It names no secret and
      holds none of the `apply`, `agreed`, `wait` and `after` lines. The bracketed test of its `if` is
      `(needs.plan.outputs.pending == 'true' || needs.plan.outputs.mode == 'rehearsal')`.
    - `apply` live: exactly one step runs the `apply` line. It is named "Plan again, look, apply, plan
      again, with the token", has the `id` `apply`, and holds the token as rule 13 says. The next step is
      named `Nothing is left to change` (`AGREED_STEPS`, Task 5), its `if` is
      `steps.apply.outputs.outcome == 'applied'`, and it runs the `agreed` line. Then two last steps, in
      this order, and each names no secret:
      - the `wait` line, with the `if`
        `${{ !cancelled() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}`. It
        holds the long wait for the redeploy. Its condition stops being true when the job is cancelled or
        runs out of time, and the runner then stops the step: a step under `always()` would be left
        running until the runner is killed, with nothing said;
      - the `after` line, with the `if`
        `${{ always() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}` and, in
        its `env`, `CANCELLED` as exactly `${{ cancelled() }}`. It waits for nothing and reads nothing from
        GitHub: it writes the summary from the work folder, so it also runs, briefly, when the job was
        cancelled or ran out of time, and is told so (Task 21).
      The job holds no `rehearse` line. The bracketed test of its `if` is
      `(needs.plan.outputs.pending == 'true')`.
    A job that is in neither form fails, and the problem names what is missing or left over. The two jobs
    need not be in the same form. Pull request 2 makes `plan` live in one commit and `apply` in the next
    (Tasks 20 and 21), and the check passes at each of them. The approved jobs are named as `AGREED_JOBS`
    names them.
15. The file uses no anchor, alias, merge key or tag.
16. **Each step is held to its own calls** (design 6.7). The check holds the five commands written out, as
    literal lists of words for a made-up work folder and service, in its own text. Run as a program it
    asks `tool.mjs` itself, and `allowedCommands(...)` must equal the five, word for word;
    `commandsFor('plan', ...)` must be exactly the plan with `--out` and the list of deployments; and
    `commandsFor('apply', ...)` exactly design 6.2's four, in its order. In `cli.mjs` every call of
    `runTool` passes a `step` written as the literal `'plan'` or `'apply'`, the `plan` command passes
    `'plan'` and the `apply` command `'apply'`, and none passes `standIn`.

In the trusted folder (`checkTrustedFolder`):

17. It holds no name that is not in `TRUSTED_FILES`, and no folder.
18. Each `.mjs` imports only `node:` built-ins and `./<a name in TRUSTED_FILES>`. Only `tool.mjs` imports
    `node:child_process`. No import is computed, with one exception the check knows by the file's name:
    `evaluate-settings.mjs`. Its whole job is to import the settings file it is given, and to load Railway's
    kit from beside that file. So in that one file the check allows exactly one computed `import(` and
    exactly one `createRequire(`, whose one use asks for the literal `railway/iac`. A second of either
    fails. So does either in any other module. And no module imports `evaluate-settings.mjs`: it is only
    started, by `tool.mjs`, as Task 3 says.
19. No file names the job's environment file or its path file (`GITHUB_ENV`, `GITHUB_PATH`).
20. No shell script names a path of the repository outside the trusted places: every word in it that begins
    `.github/` or `.railway` begins with one of `TRUSTED_PLACES`, and it holds no `../`. (A script finds its
    own copy with `dirname`, not with `..`.)
21. **No shell script starts Railway's tool, or names its token.** `run.sh` runs both token steps, so a
    script is as much a way to the tool as `cli.mjs` is. Only `install-tool.sh` may name the unpacked
    program at all, and only on a line that unpacks it, takes its checksum or tests that it is there. No
    script holds the words of one of the five commands (`config plan`, `config apply`,
    `deployment list`), one of the four forbidden flags, or a name that begins `RAILWAY` and ends `TOKEN`.
    `run.sh` starts the pinned runtime on its own copy's `cli.mjs`, and that is the only program it starts.
22. No script sources, evaluates or starts a file under `head/`. `exact.sh` and `since-last.sh` give `head`
    to git as a folder to read (`git -C`), and to nothing else. **And no script uses git in a way that
    obeys the attributes file or starts a program the commit names:** the git commands a script may hold
    are `ls-tree`, `cat-file`, `hash-object --no-filters`, `rev-parse`, `fetch`, `diff-tree` and
    `diff --no-index`. `archive`, `checkout`, `show`, `status`, `ls-files` and a plain `diff` of two
    commits are refused, and so is `cat-file` with `--filters` or `--textconv`.

In the settings folder, and across the trusted places:

23. `checkSettingsProject` (Task 4) passes on the evaluated file.
24. `.railway/railway.ts` imports only Railway's kit (`railway`, `railway/iac`) and files inside `.railway/`
    (a relative path with no `..`). A `require`, a computed `import(` or a `node:` built-in is refused.
    **This rule catches mistakes and limits nothing.** A file can reach Node's built-ins with none of those
    words, through `process.getBuiltinModule`. Node's permission flags do not limit it either (Task 3).
    What limits the file is where it is run: never in `gate`, and in the approved jobs only after an
    approval, which trusts the commit (design section 3).
25. `checkWatchList` and `checkNoOldFile` pass.
26. No entry of the three trusted places is a link. Each is a plain file. A link would put a file from
    elsewhere under a trusted name. (On a runner `exact.sh` refuses one too, Task 12; this rule says so on
    the pull request.)
27. No file named `npmrc` or `.npmrc` is anywhere under `.railway/`, at any depth, in any letter case. npm
    takes settings from the folder it runs in, and one of them names a program to start; and with
    `--prefix` it would take `etc/npmrc` under that folder as its "global" file. The kit is installed
    there, after the first approval. (On the runner `reinstallKit` gives npm an empty file in place of
    each of its two other settings files, Task 3; this rule is the pull request's half.)
28. `exact.sh` holds the sentence `notExact` word for word as `words.mjs` does. A shell script cannot import
    it, so the check compares the two.

**What these rules do not do.** They run on a pull request, on the code the pull request brings. They catch
mistakes and they make a hostile change show itself in a pull request; they are not what stands on the
runner. On the runner stand the proofs of rule 12, which the workflow file carries, and the workflow file
is the one file step 1 cannot vouch for (design section 3).

- [ ] **Step 1: Write the failing tests.** `files()` reads the committed workflows. `plant(name, edit)` returns
  `checkWorkflows` of the same files with one edited or added. `REHEARSAL` and `LIVE` are the two fixture
  texts of `workflow-fixtures.mjs`: the whole workflow of Task 14, and the same with the live steps of
  Tasks 20 and 21, each with a made-up repository name, a made-up checkout id and a made-up BASE. **They
  are fixtures for good.** Every test of a rule plants its violation in one of them, in this task and in
  every later one, so no such test changes its meaning when the committed file goes from rehearsal to
  live. In this file `checkWorkflows` is called through a helper of the same name that passes the
  fixtures' repository name; `files()` leaves the committed `railway-settings.yml` out, and the three
  tests that read the committed file say so (Tasks 14, 20 and 21).
  `edited(text, edit)` parses a workflow, lets `edit` change the document, and writes it back;
  `withStep`, `withoutStep`, `withJob`, `jobOf`, `stepOf` and `tokenStepOf` are small helpers on it, and
  `codeCheckout`, `headCheckout` and `gateStep` find those three steps of `gate`. The eight `in...` helpers
  each put one expression into one kind of place. `realTool` is `tool.mjs` as imported, and
  `checkCommands(tool)` is rule 16's check of a module it is given.
  The comments name the seven plantings design section 9 lists.

```js
test('the committed workflows pass', () => assert.deepEqual(checkWorkflows({ ...files(), 'railway-settings.yml': REHEARSAL }), []));

// Design section 9: a second use of the environment
test('a second workflow naming the environment fails', () => {
  assert.match(plant('ci.yml', addJob({ environment: 'railway-settings' })).join('\n'), /ci\.yml: only railway-settings\.yml may name the environment/);
});
test('so does the same name in other letters', () => { /* 'Railway-Settings', ' RAILWAY-SETTINGS ', { name: 'railway-Settings' } */ });
// Design section 9: a forbidden flag
test('a command outside the allowed lines fails', () => {
  for (const run of ['railway config apply --yes --confirm-destructive', 'bash .github/railway-settings/run.sh plan --show-values',
                     'curl https://example.invalid | sh', 'railway config plan --decrypt-variables'])
    assert.ok(plant('railway-settings.yml', addStep('apply', { run })).length > 0, run);
});
// The same flag, planted where a workflow rule cannot see it: in the tool's own list, and in a script.
test('a forbidden flag planted in tool.mjs or in run.sh fails', () => {
  // checkCommands(module) is what the program runs for rule 16, on a module it is given
  const withFlag = { ...realTool, allowedCommands: (w, s) => realTool.allowedCommands(w, s).map((argv) => (argv[1] === 'apply' ? [...argv, '--confirm-destructive'] : argv)) };
  assert.ok(checkCommands(withFlag).length > 0);
  const swapped = { ...realTool, commandsFor: (step, w, s) => (step === 'plan' ? realTool.commandsFor('apply', w, s) : realTool.commandsFor(step, w, s)) };
  assert.ok(checkCommands(swapped).length > 0);
  assert.deepEqual(checkCommands(realTool), []);
  for (const line of ['"$WORK/tool/railway" config apply --yes --confirm-destructive', 'railway config plan --show-values',
                      '"$WORK/tool/railway" --version', 'echo "$RAILWAY_SETTINGS_TOKEN"', 'export RAILWAY_TOKEN="$1"'])
    assert.ok(checkTrustedFolder({ ...trustedFolder(), 'run.sh': trustedFolder()['run.sh'] + '\n' + line }).length > 0, line);
});
test('the plan command cannot pass the apply step, nor a step that is not written out', () => {
  const cli = trustedFolder()['cli.mjs'];
  for (const edit of [(t) => t.replace("step: 'plan'", "step: 'apply'"), (t) => t.replace("step: 'plan'", 'step: which'), (t) => t.replace("step: 'plan'", '')])
    assert.ok(checkTrustedFolder({ ...trustedFolder(), 'cli.mjs': edit(cli) }).length > 0);
});
// Design section 9: a forbidden trigger
for (const trigger of ['pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'workflow_call', 'repository_dispatch', 'issue_comment', 'release'])
  test(`a forbidden trigger fails: ${trigger}`, () => { /* added beside the two allowed */ });
// Design section 9: a file run from outside the trusted places
test('a file run or read from outside the trusted places fails', () => {
  for (const step of [{ run: 'bash tools/made-up.sh' }, { run: 'node packages/api/scripts/made-up.js' },
                      { run: 'bash .github/railway-settings-check/watched.mjs' },
                      { run: 'bash .github/railway-settings/run.sh gate', 'working-directory': 'packages/api' },
                      { uses: 'actions/checkout@' + 'a'.repeat(40), with: { 'persist-credentials': false } } /* no sparse list */])
    assert.ok(plant('railway-settings.yml', addStep('plan', step)).length > 0, JSON.stringify(step));
});
// The release lead's blocker: the gate job runs no code of the run's own commit.
test('in the gate job, nothing of the run\'s own commit is started', () => {
  for (const run of ['bash .github/railway-settings/run.sh show', 'bash head/.github/railway-settings/run.sh show',
                     'bash code/.github/railway-settings/run.sh show && bash head/.github/railway-settings/run.sh show',
                     'node head/.github/railway-settings/cli.mjs show', 'bash code/.github/railway-settings/../../../head/x.sh'])
    assert.ok(plant('railway-settings.yml', addStep('gate', { run })).length > 0, run);
});
test('the gate job\'s three checkouts are exactly the three, in their order', () => {
  for (const edit of [
    (doc) => { delete doc.jobs.gate.steps[0].with.ref; },                                  // the base copy would be the run's own commit
    (doc) => { doc.jobs.gate.steps[0].with.ref = 'master'; },                              // not a commit
    (doc) => { doc.jobs.gate.steps[0].with.ref = '${{ github.sha }}'; },
    (doc) => { codeCheckout(doc).with.ref = '${{ github.sha }}'; },                        // the page would be written by the commit it shows
    (doc) => { delete codeCheckout(doc).with.ref; },
    (doc) => { codeCheckout(doc).with.ref = "${{ steps.gate.outputs.display_sha || github.sha }}"; },
    (doc) => { codeCheckout(doc).if = "steps.gate.outputs.display_sha != ''"; },
    (doc) => { codeCheckout(doc).with.path = 'head'; },
    (doc) => { headCheckout(doc).with.path = 'code'; },
    (doc) => { headCheckout(doc).with['sparse-checkout'] = '.'; },
    (doc) => { gateStep(doc).env.BASE_SHA = 'f'.repeat(40); },                             // not the commit the base copy is at
    (doc) => { gateStep(doc).run = 'bash code/.github/railway-settings/run.sh gate'; },    // the gate read by code not yet chosen
    (doc) => { const s = doc.jobs.gate.steps; s.splice(1, 0, s.splice(s.indexOf(codeCheckout(doc)), 1)[0]); },   // the code copy before the gate
    (doc) => { doc.jobs.gate.steps.push({ uses: 'actions/checkout@' + 'a'.repeat(40), with: { 'persist-credentials': false } }); },
  ]) assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': edited(REHEARSAL, edit) }).length > 0, String(edit));
});
// The release lead's second blocker: git can rewrite a trusted file as it checks it out.
test('a checkout that is not followed at once by its proof fails, in every job', () => {
  const noProof = (job, which) => edited(REHEARSAL, (doc) => { const s = doc.jobs[job].steps; s.splice(s.findIndex((x) => x.run === PROOF_LINES[which]), 1); });
  for (const [job, which] of [['gate', 'base'], ['gate', 'code'], ['plan', 'own'], ['apply', 'own']])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': noProof(job, which) }).length > 0, `${job}: ${which}`);
  // head's proof is the code copy's own line
  assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': withoutStep(REHEARSAL, 'gate', 'exact.sh head') }).length > 0);
  // a proof that comes after a line of the copy it proves is no proof
  const late = edited(REHEARSAL, (doc) => { const s = doc.jobs.plan.steps; const at = s.findIndex((x) => x.run === PROOF_LINES.own); s.splice(at + 1, 0, s.splice(at, 1)[0]); });
  assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': late }).length > 0);
});
test('a proof line in any other words fails', () => {
  for (const run of ['bash .github/railway-settings/exact.sh own',                                              // the script as the checkout wrote it
                     'cat .github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-own.sh" && bash "$RUNNER_TEMP/exact-own.sh" own',
                     'git cat-file --filters HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-own.sh" && bash "$RUNNER_TEMP/exact-own.sh" own',
                     'git show HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-own.sh" && bash "$RUNNER_TEMP/exact-own.sh" own',
                     PROOF_LINES.own + ' || true'])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': REHEARSAL.replace(PROOF_LINES.own, () => run) }).length > 0, run);
});
test('a sparse list that is not written from the root fails, in every checkout', () => {
  const lists = (doc) => Object.values(doc.jobs).flatMap((job) => job.steps).filter((s) => s.uses).map((s) => s.with);
  for (const [was, now] of [['/.railway/', '.railway'], ['/.railway/', '.railway/'], ['/.railway/', '/.railway'],
                            ['/.github/railway-settings/', '.github/railway-settings'], ['/.github/workflows/railway-settings.yml', 'railway-settings.yml']])
    for (const at of [0, 1, 2, 3, 4]) {   // base, code, head, and the one checkout of plan and of apply
      if (!lists(parse(REHEARSAL))[at]['sparse-checkout'].includes(was)) continue;
      const spoilt = edited(REHEARSAL, (doc) => { const w = lists(doc)[at]; w['sparse-checkout'] = w['sparse-checkout'].split(was).join(now); });
      assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': spoilt }).length > 0, `${at}: ${now}`);
    }
  // and a checkout with no list at all
  assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': edited(REHEARSAL, (doc) => { delete lists(doc)[4]['sparse-checkout']; }) }).length > 0);
});
// The two last steps of a live apply. WAIT_IF and AFTER_IF are the two conditions rule 14 writes out.
const GUARD = "steps.proof.outcome == 'success' && steps.runtime.outcome == 'success'";
const WAIT_IF = '${{ !cancelled() && ' + GUARD + ' }}', AFTER_IF = '${{ always() && ' + GUARD + ' }}';
test('the last step of a live apply runs whatever became of the job, and is told when it was cut short', () => {
  assert.equal(stepOf(parse(LIVE), 'apply', 'after').if, AFTER_IF);
  for (const edit of [(doc) => { stepOf(doc, 'apply', 'after').if = '${{ !cancelled() }}'; }, (doc) => { delete stepOf(doc, 'apply', 'after').if; },
                      (doc) => { delete stepOf(doc, 'apply', 'after').env.CANCELLED; }, (doc) => { stepOf(doc, 'apply', 'after').env.CANCELLED = 'false'; }])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': edited(LIVE, edit) }).length > 0, String(edit));
});
const AGREED_IF = "steps.apply.outputs.outcome == 'applied'";
test('no step of an approved job runs a file of the checkout when the proof did not pass', () => {
  // The rule is an allow-list. These are every `if` of the two fixtures, by job, by the last word of the step's line, and by text:
  const ifs = (text) => Object.entries(parse(text).jobs).flatMap(([job, { steps }]) => steps.filter((s) => 'if' in s).map((s) => [job, s.run.split(' ').at(-1), s.if]));
  assert.deepEqual(ifs(REHEARSAL), []);
  assert.deepEqual(ifs(LIVE), [['apply', 'agreed', AGREED_IF], ['apply', 'wait', WAIT_IF], ['apply', 'after', AFTER_IF]]);
  const fails = (text, edit, why) => assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': edited(text, edit) }).length > 0, why);
  // 1. Any `if` at all on any other step: of gate, plan or apply, in either form. The check does not weigh what the
  //    condition would do. The token steps are among these steps, and so are the kit's and the page's.
  const ANY = ['true', '${{ true }}', '${{ success() }}', '${{ success() || true }}', '${{ !success() }}', '${{ always() }}', '${{ !cancelled() }}',
               '${{ failure() }}', "github.ref == 'refs/heads/master'", AGREED_IF, WAIT_IF, AFTER_IF];
  for (const [text, form] of [[LIVE, 'live'], [REHEARSAL, 'rehearsal']])
    for (const [job, { steps }] of Object.entries(parse(text).jobs))
      steps.forEach((step, at) => {
        if ('if' in step) return;
        for (const cond of ANY) fails(text, (doc) => { doc.jobs[job].steps[at].if = cond; }, `${form} ${job} step ${at}: ${cond}`);
      });
  // 2. Each of the three holds its own text and no other: another's text, a bare status function, a guard that
  //    names one id, the wrong property or the wrong comparison, a condition widened with ||, and no `if` at all.
  const OTHER = ['true', '${{ always() }}', '${{ !cancelled() }}', '${{ failure() }}', '${{ cancelled() }}', '${{ Always() }}', 'always()',
                 '${{ success() || true }}', '${{ !success() }}',
                 "${{ always() && steps.proof.outcome == 'success' }}", "${{ always() && steps.runtime.outcome == 'success' }}",
                 "${{ always() || " + GUARD + ' }}', "${{ always() && steps.proof.outcome != 'failure' && steps.runtime.outcome == 'success' }}",
                 "${{ always() && steps.proof.conclusion == 'success' && steps.runtime.outcome == 'success' }}",
                 "${{ always() && steps.apply.outputs.outcome == 'applied' }}", AGREED_IF + ' || true', AGREED_IF, WAIT_IF, AFTER_IF];
  for (const [which, own] of [['agreed', AGREED_IF], ['wait', WAIT_IF], ['after', AFTER_IF]]) {
    for (const cond of OTHER.filter((cond) => cond !== own)) fails(LIVE, (doc) => { stepOf(doc, 'apply', which).if = cond; }, `${which}: ${cond}`);
    fails(LIVE, (doc) => { delete stepOf(doc, 'apply', which).if; }, `${which}: no if`);
  }
  // 3. The proof and the runtime steps must carry the ids the two conditions name
  for (const id of ['proof', 'runtime'])
    for (const job of ['plan', 'apply'])
      assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': edited(LIVE, (doc) => { delete doc.jobs[job].steps.find((s) => s.id === id).id; }) }).length > 0, `${job}: ${id}`);
});
test('the long wait stops when the job is cancelled, and the summary is written by a step of its own', () => {
  const doc = parse(LIVE), steps = doc.jobs.apply.steps;
  assert.equal(stepOf(doc, 'apply', 'wait').if, WAIT_IF);
  assert.equal(steps.indexOf(stepOf(doc, 'apply', 'wait')) + 1, steps.indexOf(stepOf(doc, 'apply', 'after')));
  assert.equal(steps.at(-1), stepOf(doc, 'apply', 'after'));
  for (const edit of [(d) => { stepOf(d, 'apply', 'wait').if = AFTER_IF; },                      // the wait under always(): a Cancel would not stop it
                      (d) => { const s = d.jobs.apply.steps; s.splice(s.indexOf(stepOf(d, 'apply', 'wait')), 1); },
                      (d) => { const s = d.jobs.apply.steps; s.push(s.splice(s.indexOf(stepOf(d, 'apply', 'wait')), 1)[0]); }])   // the wait after the summary
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': edited(LIVE, edit) }).length > 0, String(edit));
});
test('nothing is installed or evaluated in the gate job', () => {
  for (const run of ['bash code/.github/railway-settings/run.sh kit', 'bash code/.github/railway-settings/run.sh declared',
                     'bash base/.github/railway-settings/run.sh declared', 'bash code/.github/railway-settings/install-tool.sh'])
    assert.ok(plant('railway-settings.yml', addStep('gate', { run })).length > 0, run);
});
test('no step but the live apply\'s own may be named "Nothing is left to change"', () => {
  const named = (text, job, at, name) => edited(text, (doc) => { doc.jobs[job].steps.at(at).name = name; });
  for (const name of ['Nothing is left to change', 'nothing is left to change', 'NOTHING IS LEFT TO CHANGE'])
    for (const [text, job, at] of [[REHEARSAL, 'apply', -1], [REHEARSAL, 'plan', -1], [LIVE, 'plan', -1], [LIVE, 'apply', 0], [LIVE, 'apply', -1]])
      assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': named(text, job, at, name) }).length > 0, `${job} ${at} ${name}`);
});
test('an approved job checks out the run\'s own commit, at the root, and nothing else', () => {
  for (const withMore of [{ ref: 'a'.repeat(40) }, { path: 'elsewhere' }, { repository: 'another-owner/made-up-repo' }])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': edited(REHEARSAL, (doc) => Object.assign(doc.jobs.plan.steps[0].with, withMore)) }).length > 0);
});
// Design section 9: a RAILWAY secret named outside the token step
test('a RAILWAY secret named outside the token step fails, in any workflow and any letter case', () => {
  for (const [file, expr] of [['ci.yml', '${{ secrets.RAILWAY_TOKEN }}'], ['deploy.yml', '${{ secrets.RAILWAY_SETTINGS_TOKEN }}'],
                              ['cleanup.yml', '${{ secrets.railway_api_token }}'], ['ci.yml', "${{ secrets['RAILWAY_TOKEN'] }}"],
                              ['ci.yml', '${{ toJSON(secrets) }}'], ['ci.yml', "${{ secrets[format('RAILWAY_{0}', 'TOKEN')] }}"],
                              ['ci.yml', "${{ join(secrets.*, ',') }}"], ['ci.yml', '${{ toJSON(secrets.*) }}'],
                              ['deploy.yml', '${{ Secrets.Railway_Token }}'], ['ci.yml', '${{ SECRETS . RAILWAY_TOKEN }}']])
    // Each form is planted in every place a workflow can hold text, not only in an env map.
    for (const place of [inRunText, inWith, inStepEnv, inJobEnv, inTopEnv, inContainerCredentials, inServiceCredentials, inStepName])
      assert.ok(plant(file, place(expr)).length > 0, `${file}: ${expr} ${place.name}`);
});
test('a railway command given a secret on its command line fails in another workflow', () => {
  assert.ok(plant('deploy.yml', addStep('deploy', { run: 'railway up --token ${{ secrets.RAILWAY_TOKEN }}' })).length > 0);
});
test('another workflow may still name secrets that are not Railway\'s', () => {
  // the committed workflows name other secrets by the dotted form; none of them fails rule 5
  assert.deepEqual(checkWorkflows({ ...files(), 'railway-settings.yml': REHEARSAL }), []);
});
test('the token outside its one step fails inside the settings workflow too', () => { /* a second step; the gate job; a step whose run is not the plan or apply line; another secret's name */ });
test('the two literal ways of naming a secret pass in the live form', () => {
  assert.deepEqual(checkWorkflows({ ...files(), 'railway-settings.yml': LIVE }), []);
  // and with ${{ secrets.GITHUB_TOKEN }} in place of ${{ github.token }} as a step's env.GITHUB_TOKEN
});
// Design section 9: a secret read by index syntax
test('a secret read by index syntax fails in the settings workflow, even the allowed one in its own step', () => {
  for (const expr of ["${{ secrets['RAILWAY_SETTINGS_TOKEN'] }}", '${{ secrets["RAILWAY_SETTINGS_TOKEN"] }}', "${{ secrets [ 'GITHUB_TOKEN' ] }}",
                      "${{ secrets[format('RAILWAY_{0}_TOKEN', 'SETTINGS')] }}", '${{ SECRETS[env.NAME] }}'])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': LIVE.replace('${{ secrets.RAILWAY_SETTINGS_TOKEN }}', () => expr) }).length > 0, expr);
});
// The object filter, and the allowed name in other letters: GitHub reads a context's name in any case.
test('the object filter, and any other letter case of an allowed name, fail in the settings workflow', () => {
  for (const expr of ["${{ join(secrets.*, ',') }}", '${{ toJSON(secrets.*) }}', '${{ secrets.* }}', '${{ Secrets.RAILWAY_SETTINGS_TOKEN }}',
                      '${{ SECRETS.RAILWAY_SETTINGS_TOKEN }}', '${{ secrets.railway_settings_token }}', '${{ secrets . RAILWAY_SETTINGS_TOKEN }}'])
    for (const [job, step] of [['plan', { name: 'a second step', run: RUN_LINES[0], env: { X: expr } }],     // a second step of an approved job
                               ['gate', { name: 'a step of another job', run: RUN_LINES[0], env: { X: expr } }]])
      assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': withStep(LIVE, job, step) }).length > 0, `${job}: ${expr}`);
  // and in the token step itself, in place of the one allowed spelling
  for (const expr of ['${{ Secrets.RAILWAY_SETTINGS_TOKEN }}', '${{ secrets.railway_settings_token }}'])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': LIVE.replace('${{ secrets.RAILWAY_SETTINGS_TOKEN }}', () => expr) }).length > 0, expr);
});
// Design section 9: toJSON(secrets)
test('toJSON(secrets) fails anywhere in the settings workflow', () => {
  for (const [job, step] of [['gate', { run: RUN_LINES[0], env: { ALL: '${{ toJSON(secrets) }}' } }],
                             ['plan', { run: RUN_LINES[0], env: { ALL: '${{ tojson( secrets ) }}' } }],
                             ['apply', { name: 'a step named toJSON(secrets)', run: RUN_LINES[0] }]])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': withStep(LIVE, job, step) }).length > 0, job);
});
test('a secret that is neither of the two fails in the settings workflow', () => { /* secrets.MADE_UP_NAME; secrets.GITHUB_TOKEN as anything but env.GITHUB_TOKEN */ });
test('each step is held to its own calls', () => {
  // FIVE_COMMANDS is written out in the check, and equals Task 3's FIVE for the same made-up folder and service;
  // the check fails when cli.mjs calls runTool with no step, and when cli.mjs names standIn
});
// Rule 14: each approved job is whole, rehearsal or live, and is judged by itself.
test('each approved job is rehearsal or live, never between', () => {
  const half = { plan: withJob(REHEARSAL, 'plan', jobOf(LIVE, 'plan')), apply: withJob(REHEARSAL, 'apply', jobOf(LIVE, 'apply')) };
  assert.deepEqual(checkWorkflows({ ...files(), 'railway-settings.yml': half.plan }), []);   // plan live, apply still rehearsal: pull request 2's middle commit
  for (const [name, text] of [
    ['a token step in a plan job that still rehearses', withStep(REHEARSAL, 'plan', tokenStepOf(LIVE, 'plan'))],
    ['a live plan with no step that writes the lines', withoutStep(LIVE, 'plan', 'render')],
    ['a live apply with no step named Nothing is left to change', withoutStep(LIVE, 'apply', 'agreed')],
    ['a live apply whose agreed step runs whatever the outcome', edited(LIVE, (doc) => { delete stepOf(doc, 'apply', 'agreed').if; })],
    ['a live apply with no wait for the redeploy', withoutStep(LIVE, 'apply', 'wait')],
    ['a live apply with no step that writes its summary', withoutStep(LIVE, 'apply', 'after')],
    ['a live apply that still runs in a rehearsal', edited(LIVE, (doc) => { doc.jobs.apply.if += " || needs.plan.outputs.mode == 'rehearsal'"; })],
    ['a rehearsal apply that runs only when changes are pending', edited(REHEARSAL, (doc) => { doc.jobs.apply.if = doc.jobs.apply.if.replace(" || needs.plan.outputs.mode == 'rehearsal'", ''); })],
    ['a live job that also rehearses', withStep(LIVE, 'apply', { run: 'bash .github/railway-settings/run.sh rehearse apply' })],
    ['an approved job that reads Railway before it reads the gate again', edited(LIVE, (doc) => { const s = doc.jobs.plan.steps; s.push(s.splice(s.findIndex((x) => /gate again$/.test(x.run ?? '')), 1)[0]); })],
  ]) assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': text }).length > 0, name);
});

test('an environment name built from an expression fails in any workflow', () => { /* '${{ inputs.target }}', { name: '${{ vars.E }}' } */ });
test('a push that is not master and the three trusted places fails', () => { /* another branch; no paths; one place missing; a fourth path; tags */ });
test('a manual start with inputs fails', () => { /* ... */ });
test('a job without its own condition, or with another one, fails', () => { /* no if; only the master test; an || added; another repository's name in one job */ });
test('a job without its own permissions, or with a write, fails; so do top-level permissions', () => { /* ... */ });
test('an approved job that would make a deployment record fails', () => { /* environment: railway-settings as a plain string; deployment: true; deployment built from an expression */ });
test('an action other than the pinned checkout fails', () => { /* setup-node; checkout@v5; checkout by a short id; upload-artifact; cache */ });
test('a concurrency group, a container or a matrix fails', () => { /* ... */ });
test('a reusable workflow from elsewhere fails', () => { /* jobs.x.uses: other/repo/.github/workflows/a.yml@main */ });
test('a workflow that runs migrations and is not on the look\'s list fails', () => { /* a new file with pnpm db:migrate */ });
test('an anchor or a duplicate key in the settings workflow fails', () => { /* ... */ });

// trusted-folder.test.mjs
test('the trusted folder as committed passes', () => assert.deepEqual(checkTrustedFolder(trustedFolder()), []));
test('a file that is not on the list fails', () => { /* a test file; a package.json; a node_modules folder */ });
test('a module that reaches outside its folder fails', () => {
  for (const line of ["import x from '../railway-settings-check/fixtures.mjs';", "import y from '../../packages/api/src/a.js';",
                      "import z from 'yaml';", "const m = await import(name);", "import { spawn } from 'node:child_process';" /* in flow.mjs */])
    assert.ok(checkTrustedFolder({ ...trustedFolder(), 'flow.mjs': trustedFolder()['flow.mjs'] + '\n' + line }).length > 0, line);
});
test('only evaluate-settings.mjs may import a path it is given, and only once', () => {
  const folder = trustedFolder(), script = folder['evaluate-settings.mjs'];
  assert.deepEqual(checkTrustedFolder(folder), []);   // as committed: one computed import, one createRequire for 'railway/iac'
  for (const more of ["await import(process.argv[3]);", "createRequire(fileUrl)('made-up-package');", "createRequire(import.meta.url)(name);"])
    assert.ok(checkTrustedFolder({ ...folder, 'evaluate-settings.mjs': script + '\n' + more }).length > 0, more);
  assert.ok(checkTrustedFolder({ ...folder, 'cli.mjs': folder['cli.mjs'] + "\nimport './evaluate-settings.mjs';" }).length > 0);
});
test('a file that writes to the job\'s environment file or path file fails', () => { /* GITHUB_ENV in run.sh; GITHUB_PATH in cli.mjs */ });
test('a script that names a repository path outside the trusted places fails', () => { /* cat .github/workflows/deploy.yml; cat ../x; cat .github/railway-settings-check/a */ });
test('a script that would start a file of the run\'s own commit fails', () => {
  for (const line of ['bash "$GITHUB_WORKSPACE/head/.github/railway-settings/run.sh"', '. head/.github/railway-settings/since-last.sh',
                      'source "$HEAD/.github/railway-settings/run.sh"', 'node head/.github/railway-settings/cli.mjs', 'eval "$(cat head/.railway/railway.ts)"'])
    assert.ok(checkTrustedFolder({ ...trustedFolder(), 'since-last.sh': trustedFolder()['since-last.sh'] + '\n' + line }).length > 0, line);
});
test('install-tool.sh may unpack the tool and take its checksum, and may not start it', () => {
  assert.deepEqual(checkTrustedFolder(trustedFolder()), []);
  for (const line of ['"$WORK/tool/railway" --version', '"$WORK/tool/railway" login', 'exec "$WORK/tool/railway" "$@"'])
    assert.ok(checkTrustedFolder({ ...trustedFolder(), 'install-tool.sh': trustedFolder()['install-tool.sh'] + '\n' + line }).length > 0, line);
});
test('a script that asks git to obey the attributes file, or to start a program the commit names, fails', () => {
  for (const line of ['git -C "$HEAD" archive HEAD .railway | tar -x', 'git -C "$HEAD" show HEAD:.railway/railway.ts',
                      'git -C "$HEAD" cat-file --filters HEAD:.railway/railway.ts', 'git -C "$HEAD" cat-file --textconv HEAD:.railway/railway.ts',
                      'git -C "$HEAD" diff "$LAST" HEAD', 'git -C "$HEAD" checkout "$LAST" -- .railway', 'git -C "$HEAD" hash-object -- "$path"',
                      'git -C "$HEAD" status --porcelain', 'git -C "$HEAD" ls-files -z'])
    for (const script of ['exact.sh', 'since-last.sh'])
      assert.ok(checkTrustedFolder({ ...trustedFolder(), [script]: trustedFolder()[script] + '\n' + line }).length > 0, `${script}: ${line}`);
});
test('the proof says its one sentence in the words of words.mjs', () => {
  assert.ok(trustedFolder()['exact.sh'].includes(SENTENCES.notExact));
  assert.ok(checkTrustedFolder({ ...trustedFolder(), 'exact.sh': trustedFolder()['exact.sh'].replace(SENTENCES.notExact, () => 'Something went wrong.') }).length > 0);
});
test('the settings folder may hold no settings for npm, at any depth', () => {
  const four = ['.railway/package-lock.json', '.railway/package.json', '.railway/railway.ts', '.railway/watch-patterns.json'];
  assert.deepEqual(checkNoNpmSettings(four), []);
  // the folder's own file; the file --prefix would make npm's "global" one; and either name, deeper or in other letters
  for (const path of ['.railway/.npmrc', '.railway/etc/npmrc', '.railway/etc/.npmrc', '.railway/made-up/deeper/npmrc', '.railway/etc/NPMRC', '.railway/.Npmrc'])
    assert.notDeepEqual(checkNoNpmSettings([...four, path]), [], path);
  // a name that only holds the word is not one of them
  assert.deepEqual(checkNoNpmSettings([...four, '.railway/made-up-npmrc-notes.md']), []);
});
test('a link in a trusted place fails', () => {
  assert.deepEqual(checkNoLinks([{ path: '.railway/railway.ts', isLink: false }]), []);
  assert.notDeepEqual(checkNoLinks([{ path: '.railway/railway.ts', isLink: false }, { path: '.railway/made-up', isLink: true }]), []);
});
test('the settings file may import only the kit and its own folder', () => {
  assert.deepEqual(checkSettingsImports(readFileSync('.railway/railway.ts', 'utf8')), []);
  for (const line of ['import a from "../packages/api/src/a.js";', 'import fs from "node:fs";', 'import b from "made-up-package";',
                      'const c = await import(name);', 'const d = require("./watch-patterns.json");'])
    assert.ok(checkSettingsImports(line).length > 0, line);
});
test('the watch list must be a non-empty list of rooted paths', () => { /* [], {}, [''], ['packages/api/**'], [1] */ });
test('railway.json must stay deleted', () => assert.notDeepEqual(checkNoOldFile(['railway.json', 'package.json']), []));
test('the two packages are pinned exactly, each with an integrity hash, no install script and no dependency of its own', () => { /* the check folder's package.json and package-lock.json */ });
test('only the check imports yaml, and only the words test imports marked', () => { /* over the check folder's own files */ });
```

- [ ] **Step 2: Run them to see them fail.**

Run: `node --test .github/railway-settings-check/check-workflows.test.mjs .github/railway-settings-check/trusted-folder.test.mjs`
Expected: FAIL, module not found.

- [x] **Step 3: Add the packages.** In `.github/railway-settings-check/`: write `package.json`; run
  `npm install --ignore-scripts --save-exact --save-dev yaml marked@15`; then `npm audit`. Expected: two
  packages added, `found 0 vulnerabilities`. Read `package-lock.json`: two packages besides the root, each
  with `integrity`, without `hasInstallScript` and without dependencies.
  **Done ahead of the rest of this task,** because Task 10's test needs `marked`: the two files are
  committed, with `marked` 15.0.12 and `yaml` 2.9.1. The other steps of this task are not yet done, and
  step 6 no longer adds these two files.
- [ ] **Step 4: Write `workflow-fixtures.mjs` and `check-workflows.mjs`,** then edit `ci.yml` as listed.
- [ ] **Step 5: Run the tests and the check itself.**

Run: `node --test .github/railway-settings-check/*.test.mjs` then `node .github/railway-settings-check/check-workflows.mjs`
Expected: PASS; then `Railway settings: 9 workflow files checked.` (ten once Task 14 adds the workflow).

- [ ] **Step 6: Commit**

```bash
git add .github/railway-settings-check/check-workflows.mjs .github/railway-settings-check/workflow-fixtures.mjs .github/railway-settings-check/check-workflows.test.mjs .github/railway-settings-check/trusted-folder.test.mjs .github/workflows/ci.yml
git commit -m "feat(ci): check every workflow file and the trusted places against the Railway settings gate (T-751)"
```

**What a person sees:** a pull request that names the environment in a second workflow, names a Railway
secret anywhere else, adds a trigger, runs a file from outside the trusted places or manages variables now
fails CI's tooling job, with the file and the reason beside it.

### Task 12: The scripts and the wiring

**Files:**
- Create: `.railway/.gitignore`, holding the one line `node_modules/` ("Who writes step 1": the settings
  folder's own ignore rule; not a watched path)
- Create: `.github/railway-settings/pins.json`, `.github/railway-settings/exact.sh`,
  `.github/railway-settings/install-runtime.sh`, `.github/railway-settings/install-tool.sh`,
  `.github/railway-settings/since-last.sh`, `.github/railway-settings/run.sh`,
  `.github/railway-settings/cli.mjs`
- Test: `.github/railway-settings-check/pins.test.mjs`, `.github/railway-settings-check/cli.test.mjs`,
  `.github/railway-settings-check/exact.test.mjs`, `.github/railway-settings-check/since-last.test.mjs`
- (`tool.mjs` already exports `treeDigest`.)

**Interfaces:**
- Produces:
  - `pins.json`, two entries:
    `{ "tool": { "version": "5.74.0", "asset": "railway-v5.74.0-x86_64-unknown-linux-musl.tar.gz", "sha256": "<64 hex>", "binarySha256": "<64 hex>" }, "runtime": { "version": "<x.y.z>", "asset": "node-v<x.y.z>-linux-x64.tar.xz", "sha256": "<64 hex>", "treeSha256": "<64 hex>" } }`.
    `sha256` is of the file fetched. `binarySha256` is of the tool's one program, `railway`. `treeSha256`
    is of the whole unpacked runtime, as `verifyPinned` takes it (Task 3): `tool.mjs` exports the function
    that takes it, `treeDigest(dir)`, so the pin is made by the code that will check it.
  - `install-runtime.sh` and `install-tool.sh`: each, with `set -euo pipefail`, works out which copy it is
    ("Copies and work folders"); reads its own copy's entry with `jq`; fetches the file
    (`https://nodejs.org/dist/v<version>/<asset>`, and
    `https://github.com/railwayapp/cli/releases/download/v<version>/<asset>`) with
    `curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 300`; checks it with
    `sha256sum --check --strict`; unpacks it into its copy's `runtime/` or `tool/`; `install-tool.sh` then
    checks the program inside against `binarySha256`; each prints
    `Runtime <version>: the checksum matches.` or `Railway's tool <version>: the checksum matches.` Neither
    starts what it installs. `--max-time` is the fetch's own limit, five minutes: a fetch that hangs fails
    its step with curl's own code, and does not eat the job's time unseen.
  - **Most waits on something outside the runner have a limit of their own,** so that a job's time can be
    added up (Task 21 adds it up). Each fetch by `curl`: five minutes, as above. Each `git fetch` written
    in a script: two minutes, by `timeout 120`. Each read of GitHub by `cli.mjs`: thirty seconds, by an
    abort signal on the fetch; a read that passes it is a failed read, and is treated as that read's task
    says. Each call to Railway's tool: the limit Task 21 gives it. An evaluation of the settings file and
    an install of the kit: Task 3's two limits. The history, and the wait for the redeploy: each by its
    command's own clock. **Four have none, and the job's own `timeout-minutes` is all that bounds them.**
    A checkout, which is GitHub's action. A file's contents that git fetches by itself when `cat-file`
    asks for one the sparse checkout did not bring: that fetch is git's own and is not under
    `timeout 120`. The number of reads in one look: one for each run that is open, and nothing caps how
    many are open. And the fallback's rounds, which are counted and not timed (Task 9). Task 21 counts
    these four as estimates and says so. A job that overruns them is cancelled at its limit, and in
    `apply`, once the proof and the runtime have passed, the last step then says so (Task 21).
  - `run.sh <command...>`: works out which copy it is, and starts that copy's `runtime/bin/node` on that
    copy's `cli.mjs` with its arguments, telling it the copy in `SETTINGS_COPY`. It starts nothing else. It
    is how every step runs the workflow's code under a pinned runtime.
  - `exact.sh <which>`: the proof that the files on the runner are the files git holds ("Who writes step
    1"), and the one way an older commit's files are taken. It uses `bash`, its plain file tools and git,
    with `set -euo pipefail`, and with git told to read no settings but the checkout's own
    (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_ATTR_NOSYSTEM=1`,
    `GIT_LITERAL_PATHSPECS=1`). `<which>` is one of five words, and anything else stops it:
    - `base`, `code`: the checkout in that folder of the workspace, and the one place
      `.github/railway-settings`;
    - `own`: the checkout at the workspace's root, and the three trusted places;
    - `head`: the checkout in `head`, and the three trusted places. It also writes the list of the files
      it proved, as their paths with a NUL after each, to `WORK/since/tracked.z`. `gate` runs it from the
      code copy;
    - `last`: see below.
    **The proof,** for the first four. It reads `git ls-tree -r -z HEAD` for the places: each entry's
    mode, kind, id and path. Then every one of these must hold, or it refuses:
    1. every entry is a file (`blob`) with the mode `100644` or `100755`. A link, and a folder that is
       another repository, are refused;
    2. no part of a path is empty, `.`, `..` or `.git`;
    3. on disk the path is a plain file and not a link, and `git hash-object --no-filters -- <path>` gives
       exactly the entry's id. `--no-filters` hashes the bytes as they are, with no conversion on the way
       in, so the two ids are equal only when the file on disk is byte for byte the file git stores;
    4. on disk, **in the whole of the checkout's working tree,** there is no file and no link beside the
       entries. Everything in the checkout's folder but git's own folder, `.git`, is looked at, not only
       what lies under the places: a checkout that brought anything else to the runner is refused. (A
       sparse line with no slash before it would bring a folder named `.railway` from any depth, a
       workspace's `package.json` or npm settings would steer the kit's install, and none of it would be
       on step 1's page.)
    It prints `<n> files of <which> are the files git holds.` A refusal prints the sentence `notExact`
    (Task 10), and the number of entries that failed, to the log and to the step's summary, and exits
    non-zero. It prints no file's name: a name is the commit's text, and a log is not escaped. To find
    which file, a person runs the same three git commands by hand.
    **What the proof is a proof of.** That whatever the attributes file says, at the root or anywhere,
    checked out or not, it changed no byte of a trusted file on this runner. It does not forbid an
    attributes file. A line that would rewrite a trusted file makes every job refuse, step 1 first, until
    the line is taken out again: it fails closed, and it shows.
    **`last`,** in the job `plan` only. With `LAST_AGREED_SHA` empty it does nothing. Otherwise that must
    be 40 hex characters. It fetches that one commit (`timeout 120 git fetch --no-tags --depth=1 origin <sha>`), reads
    `git ls-tree -r -z <sha> -- .railway`, holds every entry to rules 1 and 2, and writes each file out
    of git as it is stored, `git cat-file blob <id>`, under the empty folder `WORK/last/`. It refuses
    when that folder is already there. Nothing is checked out and git's `archive` is not used, so no
    attributes file, of that commit or of this one, has any say in the bytes. If the fetch or a read
    fails it removes what it wrote, prints one fixed line, and exits 0: old values are then hidden (design
    6.4), and the run goes on.
  - `since-last.sh`, run only from the `code` copy in `gate`, after `exact.sh head`. It takes from git
    what changed since the last change applied, with the same settings for git as `exact.sh`. It treats
    the `head` checkout as a store of git's objects and reads none of its files: every git command but
    the last is `git -C "$GITHUB_WORKSPACE/head"`. With `LAST_AGREED_SHA` empty it does nothing: the page
    then shows every file in full, from `tracked.z`. Otherwise that must be 40 hex characters, or the
    script fails, and it writes into `WORK/since/`:
    - it fetches that one commit with `--no-tags --depth=1`, under `timeout 120`;
    - `changed.z`: from `git diff-tree -r -z --no-renames --no-abbrev <that commit> HEAD` over the three
      places, each entry's status and path. That command also gives each entry's two modes and its two
      ids, the old file's and the new one's;
    - for the `n`-th entry, the two files as git stores them, `git cat-file blob <id>`, written to
      `pair/<n>/old` and `pair/<n>/new`. An added file has an empty `old`, and a removed one an empty
      `new`. A side that is not a plain file (a link, say) is left empty and the entry is marked, so the
      page names it and shows no lines for it;
    - `diff/<n>.diff`: the changed lines, from
      `git diff --no-index --text --no-color --no-ext-diff --no-textconv --unified=3 -- pair/<n>/old pair/<n>/new`,
      run inside `WORK/since/`, which is no checkout. Its exit code is 1 when the two differ, which is the
      usual case and not an error; any other code but 0 fails the script.
    **Why the lines are worked out from two plain files.** The two files are the bytes git stores, under
    names the script chose, in a folder that holds no attributes file and belongs to no repository. So no
    attribute can call a file binary, turn its text into another encoding, or name a program to show it,
    and `--text`, `--no-ext-diff` and `--no-textconv` say the same a second time. And no name from the
    commit is ever given to git as a pattern: git would read `*`, `?` and `[` in one as wildcards, and a
    file named to match another would be shown with that other file's lines. Names are read between NUL
    characters and are only ever written to `changed.z`.
  - `cli.mjs` commands. Each reads `GITHUB_*`, `RUNNER_TEMP` and `SETTINGS_COPY`, calls the modules,
    appends to `GITHUB_STEP_SUMMARY` and `GITHUB_OUTPUT`, and exits non-zero on a refusal. A command that
    reads GitHub does so with the run's own token (`GITHUB_TOKEN`) and no other. Each command runs only in
    the copy it belongs to and refuses anywhere else.
    - `gate`, in the `base` copy. It makes every read of GitHub that step 1 needs, so that no later step of
      the job holds a token.
      1. **The owner's id** arrives as text, in `GITHUB_REPOSITORY_OWNER_ID`, and `checkEnvironmentRules`
         takes a number. The conversion is here and nowhere else: text that is one or more digits with no
         leading nought becomes that number; anything else (empty, a sign, a space, a letter) is a refusal
         before any rule is read.
      2. It reads the environment and its branch rules, both with their status and any further page; and
         the git id of each trusted place at the run's commit and at `master`'s head, by walking GitHub's
         git trees endpoint down from each commit, so no process is started. It refuses by
         `checkEnvironmentRules`, with `bypassVisible` from `BYPASS_VISIBLE`, and by `checkRunIsCurrent`.
         Any failed read here is a refusal.
      3. **The base.** `BASE_SHA` must be 40 hex characters. GitHub's compare of BASE with the run's commit
         must say the run's commit is `ahead` of it or `identical`. Anything else, a failed read included,
         is the refusal `baseNotOnMaster`.
      4. **The history.** It reads this workflow's runs on `master`
         (`.../actions/workflows/railway-settings.yml/runs?branch=master&per_page=100`), newest first, a
         page at a time. For each run that passes conditions 1 to 6 of Task 5 it reads the jobs of every
         attempt (`.../actions/runs/<id>/jobs?filter=all&per_page=100`); for one that passes condition 7,
         the review history. It stops at the first run that counts, and at a run that applied with no
         review on record (`approvalUnrecorded`, Task 5). **The bounds:** at most 5 pages of runs, at most
         200 reads of jobs, one page of jobs for a run (a run with more than 100 jobs over all its
         attempts is not read), and five minutes in all by the command's own clock. Its answer, the
         output `history`, is one of three words:
         - `found`: a run counted, and the run's own commit contains that run's commit (GitHub's compare
           says `ahead` or `identical`). **That containment check is also what carries a tag named
           `master`:** GitHub's run object cannot tell such a tag from the branch, so `lastAgreedCommit`
           cannot (Task 5). A commit that only a tag reached is not in `master`'s history;
         - `none`: the pages were read to their end (a page came back with fewer than 100 runs), every
           candidate's jobs and review history were read, and no run counted;
         - `unread`: a read failed, an answer was in a shape this code does not know, a bound was reached,
           the newest run that applied has no review on record, or the run that counted is not contained
           in the run's commit. An older run is never given in a newer one's place.
         Only `found` gives `last_agreed_sha` and `last_agreed_run`. Step 1 says `noneApplied` for `none`
         and `historyUnread` for `unread`, so "no run ever applied a change" is said only when it was
         read to be true.
      5. **Whose code writes the page.** With a last change applied, GitHub's compare of BASE with that
         commit: `ahead` or `identical` means that commit holds BASE in its history, so the output
         `display_sha` is that commit and `display_is` is `last`. In every other case, a failed read
         included, `display_sha` is BASE and `display_is` is `base`. BASE is always safe to use: the
         workflow file names it.
      6. It reads the number of the pull request that brought the run's commit, when GitHub gives one.
      Its outputs are `last_agreed_sha`, `last_agreed_run`, `history`, `display_sha`, `display_is`,
      `pull_request` and `bypass_checked`. **It never exits 0 without a `display_sha` of 40 hex
      characters:** the second checkout takes its `ref` from it, and an empty `ref` would mean the run's
      own commit. On a refusal it writes the refusal's sentence, and for `gateWrong` the plain problems,
      to its step's summary.
    - `gate again`, in an approved job's own copy: the refusals of 1 and 2, and nothing else. It writes
      `master`'s head, the commit it compared the trusted places against, to `WORK/gate-head`: step 3
      holds its later reads of the head to it (Task 9, steps 6 and 9).
    - `show`, in the `code` copy. It holds no token and reads nothing but files: the answers of `gate`,
      given to it in its environment (`LAST_AGREED_SHA`, `LAST_AGREED_RUN`, `HISTORY`, `DISPLAY_SHA`,
      `DISPLAY_IS`, `PULL_REQUEST`, `BYPASS_CHECKED`), what `exact.sh head` and `since-last.sh` wrote, and
      the files of `head/` that `tracked.z` names, which `exact.sh head` has just proven to be the files
      git holds. It writes step 1's summary with `gateWords`. **It starts no process, imports nothing but
      its own copy's modules, and evaluates nothing.** With a last change applied the page shows each
      changed file's lines from `diff/<n>.diff`, and an added file's whole text. With none it shows every
      tracked file in full, read from `head/` by the names in `tracked.z`; a name there that is a link on
      disk is shown as a link and not followed. So both forms of the page show the same bytes: the ones git
      stores. The three versions are read as text from `head/`'s `pins.json` and
      `.railway/package-lock.json`. **It is the last thing the job does:** no step follows it. Each input
      must be in its form (40 hex characters, digits, or one of its words), and each file it is told of
      must be there: otherwise it refuses with `cannotShow`. If
      the page would be more than 900,000 bytes it refuses with `tooLarge`; GitHub's limit for one step's
      summary is a little above that.
    - `kit`, in an approved job: `verifyRuntime`, then `reinstallKit` on the checkout's root joined with
      `.railway`, an absolute path (Task 3 takes no other). The tool is not installed yet, so this is the
      runtime-only check.
    - `tool-version`: `runTool(['--version'])`; its output file must hold exactly `railway <version>`.
    - `declared`, in an approved job, after the kit and before any step that holds the token. **This is
      where the workflow's own code first runs the commit's settings file: after the first approval, in a
      process that holds no token** (design 6.2). It refuses to run in the `base` or the `code` copy, and
      `evaluateSettings` refuses beside a Railway name (Task 3).
      1. Now: `verifyPinned`, for the tool and the runtime, then `evaluateSettings` on `.railway/railway.ts`. If
         `checkSettingsProject` finds a problem it writes the heading `## Railway's plan`, the sentence
         `settingsRefused`, `Why:` and the plain problems to the step's summary, and exits non-zero: the
         token step never runs. Otherwise it writes the evaluated answer to `WORK/declared-now.json`.
      2. At the last change applied, only when `WORK/last/.railway/` is there (`exact.sh last` put it
         there): `reinstallKit` in that folder, `evaluateSettings` on its `railway.ts`, and the `build`
         and `deploy` of `storedSettings` to `WORK/declared-last.json`. If any of that fails no file is
         written, the log says so in one fixed sentence, and the step still passes: old values are then
         hidden (design 6.4).
      In the job `apply` there is no `WORK/last/`, so it makes the first reading only; step 3 takes the
      second from step 2 (Task 21).
    - `rehearse plan` and `rehearse apply`: write the `rehearsal` sentence, and for `plan` the outputs
      `mode=rehearsal`, `pending=false`.
    There is no `declared-last` and no `declared-now` command, and nothing of the kind in the `base` or
    the `code` copy. An earlier wording of this plan had both in `gate`; the release lead's second review
    found that they ran the commit's code, and npm in the commit's folder, before any approval.

**What moved, function by function.** The build's second review listed what step 1's job ran of the commit
under the earlier wording, and every place a trusted file is read from a checkout. This is where each
stands now:

| Function | Under the earlier wording | Now |
|---|---|---|
| `reinstallKit` | Called in `gate`, in the commit's `.railway/` and in the older commit's | Called only in the approved jobs: by `kit`, by `declared` for the older commit's folder, and by `recheck` |
| `evaluateSettings`, with `evaluate-settings.mjs` | Called in `gate`, on the commit's settings file and on the older one | Called only in the approved jobs, by `declared`, before the token step. And by CI's check, on a pull request |
| `checkSettingsProject`, `storedSettings` | Called in `gate` on what the evaluation answered | Called in the approved jobs, by `declared`, `render` and `apply`. And by CI's check |
| What hung on their answers: `ctx.declaredNow`, `ctx.declaredLast`, `ctx.service`, the project's name for the redeploy's record | Two outputs of the job `gate` | `WORK/declared-now.json` and `WORK/declared-last.json`, written in the job that uses them; and one output of `plan` to `apply`, the second reading |
| `gateWords`' `full`, and the three versions | Read from `head/` as checked out | Read from `head/` after `exact.sh head` has proven it |
| `gateWords`' `changed` | From git's comparison of two commits, by name | From files taken out of git as stored, under names the script chose |
| The older commit's settings folder | Unpacked with git's `archive`, which obeys the attributes file | Taken out of git as stored, by `exact.sh last`, in the job `plan` |
| The pins, given to `verifyPinned` and read by the install scripts; the watch list, given to `buildContainsHead` | Read from the checkout | Read from the copy's own checkout, after its proof |
| Every module's `import` of its neighbours; every script | Run from the checkout | Run from the copy's own checkout, after its proof. The proof's own script is run from git |

So `gate` calls none of the first three rows, and no row reads a trusted file from a checkout that has not
been proven.

- [ ] **Step 1: Find the four sums, and check each twice.**

```bash
gh api repos/railwayapp/cli/releases/tags/v5.74.0 \
  --jq '.immutable, (.assets[] | select(.name == "railway-v5.74.0-x86_64-unknown-linux-musl.tar.gz") | .digest)'
grep -E '^ARG NODE_VERSION=' Dockerfile
curl --fail --silent --show-error --max-time 60 "https://nodejs.org/dist/v<that version>/SHASUMS256.txt" | grep 'linux-x64.tar.xz'
```

Expected: `true`, then `sha256:` and 64 hex characters; the version the API's image pins; one line with 64
hex characters. Then fetch both files and run `sha256sum` on each: the same sums. Unpack the tool and run
`sha256sum` on `railway`: that is its `binarySha256`. Unpack the runtime, on Linux, and take
`treeDigest(<the unpacked folder>)` twice, from two separate unpackings: the same 64 hex characters both
times are its `treeSha256`. If Railway's release is not marked immutable, or any pair differs, stop and say
so.

- [ ] **Step 2: Write the failing tests.**
  - `pins.test.mjs`: each entry's `version` is `x.y.z`; the tool's `asset` is
    `railway-v<version>-x86_64-unknown-linux-musl.tar.gz` and the runtime's is
    `node-v<version>-linux-x64.tar.xz`; all four sums are 64 lower-case hex characters; neither install
    script holds a line that starts what it installed; the tool's version equals `TOOL_DEFAULTS_FOR`
    (Task 1), so a new version of the tool cannot be pinned without its defaults being read again.
  - `cli.test.mjs`, the gate, with an injected `fetch`:
    - `gate` refuses when the environment's read answers 500, when the branch rules have a further page,
      and when a trusted place differs from `master`'s;
    - with `GITHUB_REPOSITORY_OWNER_ID` set to the text `1001` it passes against a reviewer whose id is the
      number 1001, and with it empty, `01001`, `1001x`, ` 1001` or `-1` it refuses and reads no rule;
    - it refuses with `baseNotOnMaster` when `BASE_SHA` is not 40 hex characters, when the compare says
      `behind` or `diverged`, and when the compare cannot be read;
    - the history is `found`, with the run's commit as `last_agreed_sha`, only when GitHub's compare says
      this run's commit contains it; a commit that only a tag named `master` reached gives `unread` and no
      commit;
    - the history is `none` only when the last page was short and every candidate was read; it is
      `unread`, and `gate` still passes, when the runs' read fails, when a candidate's jobs or a review
      history cannot be read, when five full pages were read, and when the 201st candidate would need its
      jobs read. In none of these is an older run that applied given as the answer;
    - a run that counts on the second page is found;
    - the jobs are asked for with `filter=all`: a run whose first attempt applied and whose second, a
      re-run of the failed job, applied nothing gives `found` and that run's commit;
    - a run that applied and whose review history is an empty list gives `unread`, never `none` and never
      an older run's commit; so does a run whose jobs come back as a full page of 100;
    - `display_is` is `last` when the last change applied holds BASE in its history; it is `base`, with
      BASE as `display_sha`, when there is no last change applied, when BASE is newer than it, when the two
      have diverged, and when that compare cannot be read;
    - whenever `gate` exits 0, its outputs hold a `display_sha` of 40 hex characters;
    - it sends the run's own token and no other header of authority;
    - every read `gate` and `gate again` make carries an abort signal of thirty seconds, and a read that
      is aborted is a failed read: of a rule or a tree, a refusal; in the history, `unread`;
    - the history's own clock: with a fake clock that passes five minutes while candidates are still
      being read, the history is `unread`, and no further read is made.
  - `cli.test.mjs`, the page. Each test builds a made-up `head/` and `WORK/since/` in a temporary folder.
    - **`show` runs nothing of the commit.** `head/` holds a `cli.mjs`, a `words.mjs`, a `run.sh` and a
      `railway.ts` that would each write a marker file if started, imported or evaluated. `show` is given
      spies for `runTool`, `evaluateSettings` and `reinstallKit` that fail the test when called. After it:
      no marker file, no spy was called, and the page holds those four files' texts, escaped.
    - with no last change applied it writes each tracked file's name and text; a `node_modules` folder that
      is on disk under `head/.railway` and is not in `tracked.z` is not on the page; a tracked name that is
      a link on disk is named as a link and its target's text is not on the page;
    - with a last change applied it writes one block for each entry of `changed.z`, with that file's lines
      from its `diff/<n>.diff`, and no other file;
    - it says `noneApplied` for `HISTORY=none`, `historyUnread` for `unread`, and `writtenByLast` or
      `writtenByBase` as `DISPLAY_IS` says;
    - it refuses with `cannotShow` when an input is not in its form, when `HISTORY` is `found` and
      `changed.z` is missing, and when a file `tracked.z` names is not there; with `tooLarge` when the
      page would pass the bound. In each case the summary holds the one sentence and nothing of the files;
    - `show` reads no `GITHUB_TOKEN` and calls no `fetch`.
  - `cli.test.mjs`, the reading of the settings file. `declared` refuses to run when `SETTINGS_COPY` is
    `base` or `code`, and starts nothing. In the `own` copy: on a folder whose file manages variables it
    writes `settingsRefused` and its reasons and exits non-zero, and no `declared-now.json` is written; on
    a good folder it writes `declared-now.json`; with a `WORK/last/.railway` it also writes
    `declared-last.json`, and when that older file throws, or its kit cannot be installed, it writes none
    and still exits 0; with no `WORK/last/` it calls `reinstallKit` not at all. And over the whole of
    `cli.mjs`: no command that runs in the `base` or the `code` copy calls `evaluateSettings` or
    `reinstallKit`. The test reads which commands each copy allows, calls each with spies for the two, and
    fails if either is called.
  - `exact.test.mjs`, which needs `bash` and `git` and says so plainly when either is missing. Each test
    makes a small repository in a temporary folder, checks a commit out of it as the workflow does, with
    the three places as its sparse list, and runs the committed `exact.sh`.
    - a plain checkout is proven: it prints the count of files and exits 0;
    - **a checkout that git rewrote is refused.** The commit holds an attributes file at its root, outside
      the three places and so not checked out, with one line for a trusted file. Three lines are tried in
      turn, each on `.railway/railway.ts` and on `.github/railway-settings/cli.mjs`: `text eol=crlf`;
      `ident`, on a file that holds `$Id$`; and `working-tree-encoding=UTF-16`. The test first asserts
      what makes the case real: `git status --porcelain` prints nothing, and yet the file on disk is not
      the bytes of `git cat-file blob`. Then `exact.sh own` must exit non-zero with the sentence
      `notExact`, and print no file's name. **This is the test that fails first:** before `exact.sh` is
      written there is nothing to refuse, and a job would run the rewritten file;
    - a trusted file changed by one byte after the checkout, a trusted file replaced by a link, a trusted
      file removed, and a file added under a trusted place: each is refused;
    - a tree that holds a link, or a folder that is another repository, under a trusted place is refused
      though the checkout wrote it faithfully;
    - **nothing else of the repository is on the runner.** The commit also holds two more folders named
      `.railway`, deeper down, `packages/made-up/.railway/made-up.ts` and
      `node_modules/made-up/.railway/made-up.txt`; a `package.json` at its root that names `.railway` as a
      workspace; npm settings beside it; and a file under `tools/made-up/.github/railway-settings/`.
      Three checkouts are made, and each is named here by its three sparse lines:
      1. all three written from the root, as the workflow writes them: none of the five is on disk, and
         the proof passes;
      2. the first as the bare word `.railway`, which has no slash in it, and the other two as the
         workflow writes them: the two nested `.railway` files are on disk, and the proof refuses, though
         each is byte for byte what git holds;
      3. the first as the workflow writes it, and the other two without their first slash,
         `.github/railway-settings/` and `.github/workflows/railway-settings.yml`: these hold a slash
         inside them, so git still matches them only from the root. The file under `tools/` is not on
         disk, and the proof passes.
      The file under `tools/` is on disk in none of the three. The third checkout is there so that
      nobody later reads the first slash as doing more than it does; the CI check still holds all three
      lines to their first slash (Task 11, rule 12). With no sparse list at all, the proof refuses. This
      case fails before rule 4 looks at the whole tree;
    - **the kit's folder stays ignored whatever the root's ignore file says.** The commit holds
      `.railway/.gitignore`, and a root ignore file whose last line is `!node_modules/`. With a made-up
      `node_modules` folder written under `.railway` after the proof, `git status --porcelain -- .railway`
      prints nothing. Without `.railway/.gitignore` it prints the folder: that is the state the tool
      would answer with an id the reader refuses;
    - `head` writes `tracked.z`: the committed files of the three places, each followed by a NUL, and not
      a `node_modules` folder made on disk after the proof;
    - an argument that is not one of the five words stops it before any git command;
    - every git the test itself starts is given the settings the script gives its own, with no settings
      of the system's or of the person's: the builder's own git may be set to rewrite line ends, and the
      plain case must not fail for that. The hostile cases are run for `own` and for `head` alike;
    - `last` writes an older commit's `.railway` files into the empty `WORK/last/`, and each is byte for
      byte `git cat-file blob` of that commit's entry, **with the same three attribute lines in that older
      commit and in the newer one**: no attributes file has any say. With `WORK/last/` already there, with
      a commit id that is not 40 hex characters, or with a link in that older folder, it writes nothing;
      when the fetch fails it leaves no `WORK/last/` and exits 0.
  - `since-last.test.mjs`, which needs `bash` and `git` in the same way. It makes a small repository with
    two commits in a temporary folder, lays it out as `head/`, and runs the committed script from a folder
    laid out as `code/`:
    - the entries that changed are in `changed.z`, and each `diff/<n>.diff` holds that file's changed lines;
    - a file named with a space, with a line end, with a leading dash, with a leading colon and with a
      backtick is handled as a name: each has its own diff, and nothing was started;
    - **a name that is a pattern matches only itself.** The newer commit changes `.railway/railway.ts` and
      adds `.railway/rail[w]ay.ts`, `.railway/railway.t?` and `.railway/*.ts`. Each of the four has its
      own `diff/<n>.diff`, and each holds its own file's lines and no other's;
    - an attributes file in the newer commit, at the root or inside a trusted place, that marks a trusted
      file as binary, gives it another encoding, or names a program to show it, changes no line of any
      `diff/<n>.diff`, and starts nothing;
    - the changed lines are the lines of the files as git stores them: with `text eol=crlf` on a changed
      file, no carriage return is in its diff;
    - a `since-last.sh` and a `run.sh` planted in `head/`, which would each write a marker file, are never
      started;
    - the script's text holds no `git archive` and no `tar`;
    - with `LAST_AGREED_SHA` empty nothing is written; with one that is not 40 hex characters the script
      fails and writes nothing.
- [ ] **Step 3: Run them to see them fail.** Expected: FAIL.
- [ ] **Step 4: Write the seven files.**
- [ ] **Step 5: Run every test.** `node --test .github/railway-settings-check/*.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add .railway/.gitignore .github/railway-settings/pins.json .github/railway-settings/exact.sh .github/railway-settings/install-runtime.sh .github/railway-settings/install-tool.sh .github/railway-settings/since-last.sh .github/railway-settings/run.sh .github/railway-settings/cli.mjs .github/railway-settings-check/pins.test.mjs .github/railway-settings-check/cli.test.mjs .github/railway-settings-check/exact.test.mjs .github/railway-settings-check/since-last.test.mjs
git commit -m "feat(ci): fetch and verify the runtime and Railway's tool; wire the gate's commands (T-751)"
```

**What a person sees:** nothing yet.

### Task 13: Proof, with no token: the runner, the run's own token, and a job that never starts

Design section 9, not yet proven: that a job which is skipped does not create its environment, and whether a
run's own token can read the environment's bypass rule. Task 14's workflow relies on both. The same run
settles what this plan could not read anywhere: that the pinned runtime and the tool install on a real
runner; that checkouts can sit side by side, each held to its folders; that `exact.sh`, taken out of git by
the workflow's own line, proves a checkout there; that git in one of them can take an older commit's files
with no saved credentials; that the settings file evaluates there, with Node's permission flags set; that
after the kit is installed git still calls the settings folder unchanged, which Railway's tool will ask;
that a long wait under `!cancelled()` is stopped when its job is cancelled or runs out of time, and that a
last step under `always()` then runs and is told so; that a step whose condition names the proof's success
is held back when the proof fails; and that a run's own token can read an environment at all.

**What this proof cannot settle, and where that is settled instead.** The gate also reads an environment's
branch rules. No environment of this repository has a custom branch rule yet, and GitHub answers `404` for
the rules of an environment that has none, to any token. So no read made here can prove that one, and a
`404` here says nothing against it. It is first made, by a run's own token, in Task 17 step 1, against
`railway-settings` itself, once the founder has given it its rule. Task 17 says what follows if that read
is refused.

**Files:** one scratch workflow on a scratch branch, in a draft pull request that is never merged. Nothing
from it reaches `master`.

- [ ] **Step 1: Find and verify the checkout action's commit id.** The repository runs `actions/checkout@v5`.

```bash
TAG=$(gh api "repos/actions/checkout/releases?per_page=30" --jq '[.[] | select(.tag_name | startswith("v5."))][0].tag_name')
ID=$(gh api "repos/actions/checkout/commits/$TAG" --jq .sha)
gh api "repos/actions/checkout/commits/$ID" --jq '.commit.verification.verified'
echo "$TAG $ID"
```

Expected: `true`, then a tag `v5.x.y` and 40 hex characters. Open the release page for that tag and check it
shows the same commit. This id, with `# v5.x.y` beside it, is the only action in Task 14's workflow.

- [ ] **Step 2: Make the scratch branch** from this branch, and add `.github/workflows/proof-only.yml`:

```yaml
name: Proof only, never merge
on: pull_request
permissions: {}
jobs:
  side-by-side:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@<the id of step 1>
        with:
          path: code
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: /.github/railway-settings/
      - uses: actions/checkout@<the id of step 1>
        with:
          path: head
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: |
            /.railway/
            /.github/railway-settings/
            /.github/workflows/railway-settings.yml
      - run: ls -A . code code/.github head head/.github head/.github/workflows
      - run: git -C code cat-file blob HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-code.sh" && bash "$RUNNER_TEMP/exact-code.sh" code
      - run: bash code/.github/railway-settings/exact.sh head
      - run: bash code/.github/railway-settings/install-runtime.sh
      - env:
          LAST_AGREED_SHA: ${{ github.event.pull_request.base.sha }}
        run: |
          bash code/.github/railway-settings/since-last.sh
          cd "$RUNNER_TEMP/railway-settings/since"
          tr '\0' '\n' < changed.z
          ls diff | wc -l
          tr '\0' '\n' < tracked.z | wc -l
      - env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          for path in environments/Production environments/Production/deployment-branch-policies; do
            curl --silent --show-error --max-time 30 --output "$RUNNER_TEMP/answer.json" --write-out "$path %{http_code}\n" \
              -H "Authorization: Bearer $GITHUB_TOKEN" "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/$path"
          done
          curl --silent --show-error --max-time 30 -H "Authorization: Bearer $GITHUB_TOKEN" \
            "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/environments/Production" \
            | jq '{present: has("can_admins_bypass"), kind: (.can_admins_bypass | type), policy: (.deployment_branch_policy | type), rules: [.protection_rules[]?.type]}'
  at-the-root:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<the id of step 1>
        with:
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: |
            /.railway/
            /.github/railway-settings/
            /.github/workflows/railway-settings.yml
      - run: ls -A . .github .github/workflows
      - run: git cat-file blob HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-own.sh" && bash "$RUNNER_TEMP/exact-own.sh" own
      - run: bash .github/railway-settings/install-runtime.sh
      - run: bash .github/railway-settings/run.sh kit
      - run: git status --porcelain -- .railway | wc -l && git rev-parse HEAD:.railway
      - run: bash .github/railway-settings/install-tool.sh
      - run: bash .github/railway-settings/run.sh tool-version
      - env:
          LAST_AGREED_SHA: ${{ github.event.pull_request.base.sha }}
        run: bash .github/railway-settings/exact.sh last && ls -A "$RUNNER_TEMP/railway-settings/last/.railway"
      - run: bash .github/railway-settings/run.sh declared && ls "$RUNNER_TEMP/railway-settings" | grep declared
  cut-short:
    runs-on: ubuntu-24.04
    permissions: {}
    timeout-minutes: 1
    steps:
      - id: proof
        run: echo "stands for the proof"
      - id: runtime
        run: echo "stands for the runtime"
      - if: ${{ !cancelled() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}
        run: sleep 300 && echo "the long wait ran to its end"
      - if: ${{ always() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}
        env:
          CANCELLED: ${{ cancelled() }}
        run: echo "the last step ran; cancelled=$CANCELLED"
  cancelled-by-hand:
    runs-on: ubuntu-24.04
    permissions: {}
    timeout-minutes: 30
    steps:
      - id: proof
        run: echo "stands for the proof"
      - id: runtime
        run: echo "stands for the runtime"
      - if: ${{ !cancelled() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}
        run: sleep 1500 && echo "the long wait ran to its end"
      - if: ${{ always() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}
        env:
          CANCELLED: ${{ cancelled() }}
        run: echo "the last step ran; cancelled=$CANCELLED"
  proof-refused:
    runs-on: ubuntu-24.04
    permissions: {}
    steps:
      - id: proof
        run: exit 1
      - id: runtime
        run: echo "the runtime step must be skipped"
      - if: ${{ !cancelled() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}
        run: echo "this must never run"
      - if: ${{ always() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}
        run: echo "this must never run either"
  fails:
    runs-on: ubuntu-24.04
    permissions: {}
    steps:
      - run: exit 1
  never:
    needs: fails
    runs-on: ubuntu-24.04
    permissions: {}
    environment:
      name: proof-never-created
      deployment: false
    steps:
      - run: echo "this must never run"
```

  The first job lays two copies side by side as `gate` will, both at this pull request's commit, and takes
  the pull request's base as the older commit. It runs nothing of the settings file. The second lays one
  copy at the root, as the approved jobs will, and there the settings file is run, as it will be after an
  approval: this is the builder's own branch, in a job with no environment and no secret. The reads of
  GitHub are of the existing `Production` environment, because `railway-settings` does not exist yet. They
  use the run's own token, as the gate will. The three jobs after those are the shape of step 3's two last
  steps (Task 21), with `sleep` in place of the wait: one runs out of its own time, one is cancelled by
  hand, and in one the step that stands for the proof fails. The builder cancels the run by hand, with
  `gh run cancel <run id>`, once every other job has ended and `cancelled-by-hand` is in its long step.

- [ ] **Step 3: Open a draft pull request** titled "Proof only, never merge", and read the run.

| What is read | Expected | If it is not so |
|---|---|---|
| The listing in `side-by-side` | The workspace holds `code` and `head` and nothing else. `code` holds only `.github/railway-settings`. `head` holds only `.railway`, `.github/railway-settings` and the one workflow file. The proofs below then pass: they look at each checkout's whole tree | **Stop, and take it to the release lead.** If the checkout action does not narrow a checkout to lines written from the root, or two checkouts cannot sit side by side, "Who writes step 1" cannot be built as written. The sparse lists are not dropped to go on: a full checkout would put the repository's own `package.json`, its npm settings and every other folder on the runner beside the token, unshown and unproven, and the proof would refuse it in any case |
| The runtime's install, in both jobs | `Runtime <version>: the checksum matches.` Each copy has its own, in its own work folder | Stop. Read Node's release page for that version before changing anything |
| The two proofs in `side-by-side`, and the one in `at-the-root` | Each prints its count: `<n> files of code are the files git holds.`, and the same for `head` and for `own` | Read the error. If a plain checkout of this branch is refused, an attributes line in the repository already rewrites a trusted file on Linux: find it with `git check-attr -a` by hand and take it to the release lead. Nothing is loosened to make the proof pass |
| `since-last.sh` | The entries this pull request changed in the trusted places; the same number of diff files; a count of tracked files | Read the error. With no saved credentials, the fetch of a public commit must still work, and so must the fetch of an older file's contents when `cat-file` asks for one. **If that second fetch cannot be made to work: stop, and take it to the release lead.** The sparse lists are not dropped to make git hold the contents from the start |
| `git status` and `git rev-parse`, after the kit | `0`, then 40 hex characters. Railway's tool asks git these two things to tie a plan to the settings folder: with the kit installed, git must still call the folder unchanged. The settings folder's own ignore file is what makes it so, and Task 12's test holds that against any root ignore file | Anything but `0`: read which path git names. `.railway/.gitignore` is missing from the checkout or does not hold its line. No flag is added to the tool's commands |
| `exact.sh last`, then `declared` | The older commit's settings files are listed; then both `declared-now.json` and `declared-last.json` are named. The settings file ran with no token, with Node's permission flags, on Linux | Read the error. If Node on the runner refuses a read that the kit needs outside the settings folder, the flags are widened by exactly that path, or dropped: they are a seat belt and nothing rests on them (Task 3). If the older commit's kit cannot be installed, old values will be hidden until a run of this workflow's own applies; say so in the session log |
| The listing in `at-the-root` | Only `.railway`, `.github/railway-settings` and the one workflow file | As the first row: a stop |
| `kit` | Passes, under the pinned runtime, after the whole runtime folder was checked against its sum | Read the error. If the sum differs on the runner from the one taken in Task 12, the unpacked folder is not the same there: read what differs before changing anything |
| The tool's install and `tool-version` | `Railway's tool 5.74.0: the checksum matches.`, then a pass | Stop. The file is not the tool it claims to be |
| The read of the environment | `environments/Production 200` | Add `deployments: read` to the job and run again. The least read-only set that gives `200` becomes the permissions of all three jobs. **If no read-only set gives it:** stop. Design 6.1's read-back cannot be built with the run's own token. Take it back to the release lead and the founder; no stronger token and no read without a token is used |
| The read of that environment's branch rules | `environments/Production/deployment-branch-policies 404`, and `"policy": "null"`. That is GitHub's answer for an environment with no custom rule, to any token. Record it as "not provable here; first made in Task 17" | `200`: an environment has gained a custom rule since this plan was written. Then read the answer's keys and check them against Task 5's fixture (`total_count`, `branch_policies`, and in each `name` and `type`). Any other code: record it and read it again in Task 17 |
| The bypass field. `jq`'s `type` says `null` for a key that is missing and for one that holds `null`, so the proof prints `present` beside it to tell them apart | `"present": true, "kind": "boolean"`: a run's token sees the answer | `"present": false`: a run's token cannot see it. Task 14 sets `BYPASS_VISIBLE` to `false`. The workflow then does not check that rule, says so in every summary, and the rule rests on the founder's own look (Task 16). `"present": true, "kind": "null"`: the key is there with no answer in it. The gate refuses that on every run (Task 5), and the design's exemption is for a missing field only. Stop, and take it to the release lead: the choice is between treating an explicit `null` as "cannot see" and not building the read-back of that rule at all |
| `cut-short` | GitHub cancels the job at one minute. The long step is stopped within seconds of that, and its log never holds "ran to its end". The last step then runs and prints `cancelled=true` | If the long step is not stopped: a wait under `!cancelled()` does not end at a time-out as the runner's source says, and Task 21's wait is then bounded only by its own clock; raise job `apply`'s limit so that the last step always gets its turn, and say so to the release lead. If the last step does not run, or prints `cancelled=false`: Task 21's last step cannot say that the job was cut short in that case. Task 25's page and Task 27's row then say that a job which ran out of time may end with no sentence, and that "Run workflow" shows what Railway holds |
| `cancelled-by-hand`, after `gh run cancel` | The same: the long step is stopped at once, and the last step runs and prints `cancelled=true` | If the long step is not stopped by a person's Cancel: **stop, and take it to the release lead.** A longer limit does not help here: a wait that Cancel cannot end is the very thing the two steps were written to prevent, and Task 21 is not built on it. If the long step stops and the last step does not run, or prints `cancelled=false`: Task 25's page and Task 27's row say that a cancelled job may end with no sentence, and that "Run workflow" shows what Railway holds |
| `proof-refused` | The first step fails; the step that stands for the runtime is skipped; and both last steps are skipped: neither "this must never run" line is in the log | **Stop, and take it to the release lead.** A condition that names the proof's success does not hold a step back. Task 21's two last steps would then start a file of a checkout whose proof refused, and no token is stored until another guard is agreed |
| `never` | Skipped | (it cannot run: its need failed) |

- [ ] **Step 4: Read whether GitHub created the environment.**

Run: `gh api "repos/{owner}/{repo}/environments/proof-never-created" --jq .name`
Expected: an error, `Not Found (HTTP 404)`.

**If it is false** (the environment exists): a skipped job does create its environment, with no rules. Then
the founder creates `railway-settings` and its rules (Task 16) before pull request 1 merges, so no run can
ever be the first to name it. Task 16's list then has one more item, the deletion of
`proof-never-created`. The token is in any case stored only after Tasks 16 and 17.

- [ ] **Step 5: Close the draft pull request and delete the scratch branch.** Record the results in the
  session log.

**What a person sees:** a closed draft pull request whose run shows the results.

### Task 14: The workflow, in rehearsal form

**Files:**
- Create: `.github/workflows/railway-settings.yml`
- Modify: `.github/railway-settings/gate.mjs` (`BYPASS_VISIBLE`, as Task 13 found)
- Modify: `.github/railway-settings-check/check-workflows.mjs` (`formOf`),
  `.github/railway-settings-check/check-workflows.test.mjs` (the tests below; `REHEARSAL` stays the fixture
  it is, and one test holds the committed file to it)

**Interfaces:**
- Consumes: every command of Task 12; the commit id, the permissions and the bypass answer of Task 13.
- Produces: the workflow below. It holds eighteen different `run` values, the three `PROOF_LINES` among
  them. `RUN_LINES` (Task 11) is those eighteen and the six lines of the live form (Tasks 20 and 21):
  every line either form may hold, with rule 14 deciding which form a job is in. Also
  `formOf(text, job): 'rehearsal' | 'live' | null` in the check, rule 14's judgement of one approved job.
  `REHEARSAL` in `workflow-fixtures.mjs` (Task 11) is this same text with a made-up repository name,
  checkout id and BASE.

**BASE, and the order of this task's two commits.** The workflow file names the commit whose trusted folder
is the base code, so that commit must exist before the file that names it. This task therefore makes two
commits. The first holds everything this task changes in the trusted folder (`gate.mjs`, with
`BYPASS_VISIBLE`), and is pushed. The second holds the workflow, which names as BASE the commit that last
changed the trusted folder on this branch:

```bash
git log -1 --format=%H -- .github/railway-settings
```

If a later commit of pull request 1 changes the trusted folder again (a review fix, say), BASE is moved to
that commit in a commit after it. If the branch is rebased, every id changes: set BASE again. Task 15 checks
both before the merge.

```yaml
name: Railway settings
run-name: "Railway settings: ${{ github.sha }}"

on:
  push:
    branches: [master]
    paths:
      - '.railway/**'
      - '.github/railway-settings/**'
      - '.github/workflows/railway-settings.yml'
  workflow_dispatch:

permissions: {}

jobs:
  gate:
    name: Check the gate, show the change
    if: github.repository == '<this repository>' && github.ref == 'refs/heads/master'
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    permissions:
      contents: read
      actions: read
    outputs:
      last_agreed_sha: ${{ steps.gate.outputs.last_agreed_sha }}
    steps:
      - name: Checkout the workflow's base code
        uses: actions/checkout@<the id of Task 13> # v5.x.y
        with:
          ref: <BASE, 40 hex characters>
          path: base
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: /.github/railway-settings/
      - name: Prove the base code on the runner is the code git holds
        run: git -C base cat-file blob HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-base.sh" && bash "$RUNNER_TEMP/exact-base.sh" base
      - name: Install the base code's runtime, verified
        run: bash base/.github/railway-settings/install-runtime.sh
      - name: Read the gate's rules back, check this run is current, find the last change applied
        id: gate
        env:
          GITHUB_TOKEN: ${{ github.token }}
          BASE_SHA: <BASE, the same 40 hex characters>
        run: bash base/.github/railway-settings/run.sh gate
      - name: Checkout the code that writes this page
        uses: actions/checkout@<the id of Task 13> # v5.x.y
        with:
          ref: ${{ steps.gate.outputs.display_sha }}
          path: code
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: /.github/railway-settings/
      - name: Prove that code on the runner is the code git holds
        run: git -C code cat-file blob HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-code.sh" && bash "$RUNNER_TEMP/exact-code.sh" code
      - name: Checkout this commit's trusted places, as files to read
        uses: actions/checkout@<the id of Task 13> # v5.x.y
        with:
          path: head
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: |
            /.railway/
            /.github/railway-settings/
            /.github/workflows/railway-settings.yml
      - name: Prove this commit's files on the runner are the files git holds
        run: bash code/.github/railway-settings/exact.sh head
      - name: Install that code's runtime, verified
        run: bash code/.github/railway-settings/install-runtime.sh
      - name: Take from git what changed since the last change applied
        env:
          LAST_AGREED_SHA: ${{ steps.gate.outputs.last_agreed_sha }}
        run: bash code/.github/railway-settings/since-last.sh
      - name: Show what the approvals trust
        env:
          LAST_AGREED_SHA: ${{ steps.gate.outputs.last_agreed_sha }}
          LAST_AGREED_RUN: ${{ steps.gate.outputs.last_agreed_run }}
          HISTORY: ${{ steps.gate.outputs.history }}
          DISPLAY_SHA: ${{ steps.gate.outputs.display_sha }}
          DISPLAY_IS: ${{ steps.gate.outputs.display_is }}
          PULL_REQUEST: ${{ steps.gate.outputs.pull_request }}
          BYPASS_CHECKED: ${{ steps.gate.outputs.bypass_checked }}
        run: bash code/.github/railway-settings/run.sh show

  plan:
    name: Read Railway's plan
    needs: gate
    if: github.repository == '<this repository>' && github.ref == 'refs/heads/master'
    runs-on: ubuntu-24.04
    environment:
      name: railway-settings
      deployment: false
    timeout-minutes: 75
    permissions:
      contents: read
      actions: read
    outputs:
      mode: ${{ steps.render.outputs.mode }}
      pending: ${{ steps.render.outputs.pending }}
      lines: ${{ steps.render.outputs.lines }}
      planned_at: ${{ steps.render.outputs.planned_at }}
      declared_last: ${{ steps.render.outputs.declared_last }}
      named_head: ${{ steps.render.outputs.named_head }}
    steps:
      - name: Checkout the trusted places
        uses: actions/checkout@<the id of Task 13> # v5.x.y
        with:
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: |
            /.railway/
            /.github/railway-settings/
            /.github/workflows/railway-settings.yml
      - name: Prove the files on the runner are the files git holds
        id: proof
        run: git cat-file blob HEAD:.github/railway-settings/exact.sh > "$RUNNER_TEMP/exact-own.sh" && bash "$RUNNER_TEMP/exact-own.sh" own
      - name: Install the pinned runtime, verified
        id: runtime
        run: bash .github/railway-settings/install-runtime.sh
      - name: Read the gate's rules back, and check this run is current, again
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: bash .github/railway-settings/run.sh gate again
      - name: Install Railway's kit, without scripts
        run: bash .github/railway-settings/run.sh kit
      - name: Install Railway's tool, verified
        run: bash .github/railway-settings/install-tool.sh
      - name: Check the tool is the pinned one
        run: bash .github/railway-settings/run.sh tool-version
      - name: Take the settings folder of the last change applied, as git holds it
        env:
          LAST_AGREED_SHA: ${{ needs.gate.outputs.last_agreed_sha }}
        run: bash .github/railway-settings/exact.sh last
      - name: Read what the file declares, with no token
        run: bash .github/railway-settings/run.sh declared
      - name: Rehearsal, nothing is read from Railway
        id: render
        run: bash .github/railway-settings/run.sh rehearse plan

  apply:
    name: Apply this plan
    needs: [gate, plan]
    if: github.repository == '<this repository>' && github.ref == 'refs/heads/master' && (needs.plan.outputs.pending == 'true' || needs.plan.outputs.mode == 'rehearsal')
    runs-on: ubuntu-24.04
    environment:
      name: railway-settings
      deployment: false
    timeout-minutes: 180
    permissions:
      contents: read
      actions: read
      deployments: read
    steps:
      # The same seven steps as in plan, down to the check of the tool: the checkout, its proof (id: proof),
      # the runtime (id: runtime), the gate again, the kit, the tool and its check. Then, with no step for
      # the last change:
      - name: Read what the file declares, with no token
        run: bash .github/railway-settings/run.sh declared
      - name: Rehearsal, nothing is applied
        run: bash .github/railway-settings/run.sh rehearse apply
```

`<this repository>` is the repository's full name, written out. The comment in `apply` shortens this page
only: in the committed file its first seven steps are written out as `plan` has them, the ids `proof` and
`runtime` among them, and the fixtures hold them so. Each job's permissions are the least that
Task 13 found, and Task 17 confirms them for the read of the branch rules. No `run` line holds an
expression. A value from another step reaches a script through `env`, as `LAST_AGREED_SHA` does, so rule 12
can compare every line with a fixed one. `plan` repeats the gate's two refusals because it is the first job
to hold the token (design 6.2); `apply` repeats them as design 6.2 says. In both, that is the first thing
the job's own code does.

**The two kinds of job.** `gate` starts nothing of the run's own commit: beside its two proof lines its
lines begin `bash base/` or `bash code/`, `head/` is read, and the page is the last thing it does. Nothing
is installed and nothing is evaluated there. The approved jobs run the run's own commit, from the
workspace's root, and only after his approval: that is what the design means by "an approval trusts the
commit". The settings file is first run in `plan`, in the step named "Read what the file declares, with no
token", which stands before the step that will hold the token.

**Every checkout is followed at once by its proof,** and no file of a checkout is run before it. The three
proof lines that begin `git` run no file of a checkout at all: each takes `exact.sh` out of git as it is
stored and runs that. In the approved jobs the proof and the runtime's install carry the ids `proof` and
`runtime`. No step of this rehearsal form has an `if`, in any of the three jobs, so every step after a
failed one is skipped. The live form adds three steps that have one, and rule 14 lets no other step have
any: the step "Nothing is left to change", whose condition names no status function, so GitHub still
holds it to the success of every step before it; and the two last steps, which do run after a failure
and name both ids in their condition (Task 21).

**Each job's time limit** is the sum of its steps' own limits, and of four estimates, with room to spare: 45
minutes for `gate`, 75 for `plan`, 180 for `apply`. Task 21 adds the limits up: 33, 56 and 153.

**What crosses from `gate` to the approved jobs** is one job output: `last_agreed_sha`, the commit of the
last change applied, as the base code read it from GitHub's records, or nothing. `exact.sh last` takes it
only as 40 hex characters. Nothing that was worked out from the commit's own files crosses: `gate` works
nothing out from them but the page.

- [ ] **Step 1: Write the failing tests** in `check-workflows.test.mjs`:

```js
// The committed file, read here and in two later tasks. `committed()` reads it; `asFixture(text)` puts the
// fixtures' made-up repository name, checkout id and BASE in place of the real ones, and parses it.
const STAGE = { plan: 'rehearsal', apply: 'rehearsal' };   // Task 20 makes plan 'live'; Task 21 makes apply 'live'
test('the settings workflow is committed, passes the check, and is the fixture for its stage', () => {
  const text = committed();
  assert.ok(text, 'railway-settings.yml is missing');
  assert.deepEqual(checkWorkflows({ ...files(), 'railway-settings.yml': text }, process.env.GITHUB_REPOSITORY ?? repositoryOf(text)), []);
  assert.deepEqual({ plan: formOf(text, 'plan'), apply: formOf(text, 'apply') }, STAGE);
  // gate from either fixture; each approved job from the fixture of its form
  const expected = parse(REHEARSAL);
  for (const job of ['plan', 'apply']) if (STAGE[job] === 'live') expected.jobs[job] = parse(LIVE).jobs[job];
  assert.deepEqual(asFixture(text), expected);
});
test('its two approved jobs are gated exactly as the live ones will be', () => {
  // both have environment { name: railway-settings, deployment: false }; apply needs plan; plan needs gate;
  // both run the second gate read before anything else of their own
});
test('the gate job starts nothing of the run\'s own commit, and names one base', () => {
  const doc = parse(committed());
  const runs = doc.jobs.gate.steps.map((s) => s.run).filter(Boolean);
  assert.deepEqual(runs.filter((run) => !run.startsWith('bash ')), [PROOF_LINES.base, PROOF_LINES.code]);
  assert.ok(runs.filter((run) => run.startsWith('bash ')).every((run) => /^bash (base|code)\/\.github\/railway-settings\//.test(run)));
  assert.equal(runs.at(-1), 'bash code/.github/railway-settings/run.sh show');   // the page is the last thing the job does
  assert.ok(!runs.some((run) => /\b(kit|declared)\b/.test(run)));
  const base = doc.jobs.gate.steps[0].with.ref;
  assert.match(base, /^[0-9a-f]{40}$/);
  assert.equal(doc.jobs.gate.steps.find((s) => s.id === 'gate').env.BASE_SHA, base);
});
test('the trusted folder holds every file on the list, and no other', () => { /* TRUSTED_FILES equals the folder's names */ });
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL, `railway-settings.yml is missing`.
- [ ] **Step 3: Set `BYPASS_VISIBLE`, commit and push that; then write the workflow** with BASE as above.
- [ ] **Step 4: Run every test and the check.**

Run: `node --test .github/railway-settings-check/*.test.mjs && node .github/railway-settings-check/check-workflows.mjs`
Expected: PASS; `Railway settings: 10 workflow files checked.`

- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/gate.mjs
git commit -m "feat(ci): whether a run can see the Railway settings gate's bypass rule (T-751)"
git push
git add .github/workflows/railway-settings.yml .github/railway-settings-check/check-workflows.mjs .github/railway-settings-check/check-workflows.test.mjs
git commit -m "feat(ci): the Railway settings workflow, in rehearsal form (T-751)"
```

**What a person sees:** after pull request 1 merges, "Railway settings" is listed under Actions with a "Run
workflow" button, and one run of it, refused at its first step (Task 15).

### Task 15: Pull request 1

**Files:**
- Modify: `docs/engineering/README.md` (one row in "Find the implementation": "Railway settings from GitHub",
  pointing at the design, the workflow and the two folders, with the boundaries "three trusted places; step
  1 written by code the commit cannot change; the token in one step per job; one entry for the tool;
  allow-lists; rehearsal only until the founder's set-up")
- Modify: `docs/state/tasks.md` (row T-751), `docs/sessions/<the day>.md`

- [ ] **Step 1: The checks a public repository needs.**

```bash
git fetch origin master
git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings-check/watched.mjs
git diff origin/master...HEAD | grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
git diff origin/master...HEAD | grep -nE '[A-Za-z]:[\\/][A-Za-z_]|[/\\][U]sers[/\\]'
git diff origin/master...HEAD | grep -nE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | grep -v '00000000-0000-'
BASE=<the 40 hex characters the workflow file names>
test "$(git log -1 --format=%H -- .github/railway-settings)" = "$BASE" && echo "BASE is the commit that last changed the trusted folder."
git merge-base --is-ancestor "$BASE" HEAD && echo "BASE is in this branch's history."
git log --format='%s%n%b' origin/master..HEAD | grep -noE 'T-[0-9]+' | grep -v 'T-751$'
```

Expected: `No watched path is touched.`, then nothing from each of the three searches, then the two
sentences about BASE, then nothing from the last search. If the first sentence does not print, a later
commit changed the trusted folder: move BASE to it (Task 14) and run this step again. The last search reads
every commit message of the branch, because this pull request merges with a merge commit and so carries
every one of them to `master`. A message that names another task's number must not go there. If one does,
do not rewrite the branch, which would change BASE: tell the release lead, who decides between a squash
followed by the BASE move at the end of this task, and leaving it.

- [ ] **Step 2: Open the pull request and send it to the release lead.** It carries, as evidence:
  - the count of tests and that all pass, from CI's tooling job;
  - the name of each test that plants a violation (Task 11), with the seven of design section 9 named first;
  - the results of Task 13, with a link to the closed draft pull request's run, and what they decided: the
    jobs' permissions, and whether the bypass rule is checked;
  - what Task 6 found in the public record;
  - the output of step 1;
  - how the checkout's id and the four sums were found and verified (Task 13 step 1, Task 12 step 1);
  - BASE, the two sentences of step 1 about it, and a request that the pull request be merged with a merge
    commit, not squashed and not rebased, with the reason: the workflow file names a commit of this branch;
  - a sentence that every fixture value is made up, and that it touches no watched path;
  - a sentence that the merge will start one run, and what it will do (step 3).
- [ ] **Step 3: After review, merge with a merge commit** ("Create a merge commit" on GitHub). A squash or a
  rebase would leave BASE outside `master`'s history. **The merge starts one run,** because it adds the
  trusted places. Its first step must refuse: the environment does not exist yet.

Run: `gh run list --workflow railway-settings.yml --limit 5`, then
`gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .conclusion] | @tsv'`, then
`gh api "repos/{owner}/{repo}/environments/railway-settings" --jq .name`, then
`gh api "repos/{owner}/{repo}/compare/<BASE>...master" --jq .status`, then
`git fetch origin master && git diff --quiet <BASE> origin/master -- .github/railway-settings && echo same`
Expected: one run; `Check the gate, show the change` failed and the other two skipped; `Not Found (HTTP 404)`;
`ahead`; `same`. The run's page says "The environment railway-settings could not be read. Nothing was
started." That sentence was written by the base code: the gate job ran nothing else.

  This is the gate's first refusal on a real run. If Task 13 found that a skipped job creates its
  environment, Task 16 came first and this run instead waits for a review. The founder leaves that review
  alone: Task 17 starts its own run.

**If the pull request was squashed or rebased after all:** the compare says `diverged`. Once the
environment exists, every run's first step would then say "The workflow's base code is not part of master's
history." Nothing can be approved, and nothing is at risk. Put it right before Task 16. Open a pull request that changes two things in the workflow file and nothing else: the
two places BASE is written, to the commit on `master` that the merge made. Check first that the trusted
folder is the same in both (`git diff --quiet <old BASE> <that commit> -- .github/railway-settings`). It
goes to the release lead like any other, and it merges with a merge commit or a squash alike: the commit it
names is already on `master`.

**What a person sees:** the workflow in the Actions list with one refused run, and more steps in CI's
tooling job.

---

# Part two: the founder's set-up, and the rehearsal (no token exists)

Tasks 16 to 18. Nothing in this part stores, creates or reads a token for the new route.

### Task 16 (the founder alone): create the environment and its four rules, and make his two checks

Design section 8, steps 1 and 2. No automated tool does any part of this, changes it afterwards, or reads
the rules with the owner's sign-in in his place. The rules are read back by the run's own token in Task 17.

**What he is asked, in these words:**

1. On GitHub, open the repository's Settings, then Environments, then press "New environment". Name it
   `railway-settings` and press "Configure environment".
2. Tick "Required reviewers" and add yourself. Leave "Prevent self-review" unticked.
3. Untick "Allow administrators to bypass configured protection rules". Then look at that box once more
   yourself: it must be empty.
4. Press "Save protection rules". That button saves items 2 and 3; the branch rule below saves by itself.
5. Under "Deployment branches and tags" choose "Selected branches and tags". Press "Add deployment branch
   or tag rule", leave the kind as a branch, type `master` and press "Add rule".
6. Add no secret: leave "Environment secrets" empty.
7. Open Settings, then "Secrets and variables", then Actions, and read the list under "Repository secrets".
   Nothing in it may be named `RAILWAY_SETTINGS_TOKEN` or `RAILWAY_TOKEN`.
8. Only if Task 13 found that a skipped job makes its environment: on the Environments page, delete the
   environment named `proof-never-created`.

GitHub's words for these buttons change from time to time. If a button reads otherwise, he says what it
reads and the builder corrects this list; nothing else is pressed on a guess.

**What he should see:** the environment's page showing one reviewer, the bypass box empty, and one branch
rule, `master`, with no secrets listed; and a list of repository secrets with neither name in it.

- [ ] **Step 1: The founder does the things above,** and says that the bypass box is empty and that
  neither name is among the repository's secrets. The builder writes both answers, and the day, into the
  session log. They are the only check of those two things when a run cannot see them.

### Task 17 (the founder taps; the builder reads): the rehearsal

Design section 8, step 3. It proves three things design section 9 lists as not yet proven: that each of two
jobs in one run asks for its own approval; that a run started from another branch is refused by the
environment itself; and what GitHub's phone app shows. It also shows that the approved jobs make no
deployment record of their own, whether GitHub still records their approvals, whether a run's own token
can read the environment's branch rules, which Task 13 could not prove, and that a re-run of an approved
job waits for a review of its own.

- [ ] **Step 1: The founder presses "Run workflow" on `master`,** on his phone: under Actions he opens
  "Railway settings", presses "Run workflow", leaves the branch as `master`, and presses the green "Run
  workflow". He uses GitHub's app if it offers the button, otherwise the phone's browser. He makes this
  press even when a run from a merge is already waiting for review: the press is one of the things being
  proven.
  **What he should see:** step 1 finishes by itself. Its summary shows the gate's rules as he set them and
  the commit. It says the page was written by the workflow's base code, and "No earlier run of this
  workflow applied a change". Then it shows every file of the trusted places, each folded under its name.
  The settings folder's README is one of them, and its code fences show as plain characters. The page ends
  with the two sentences about the workflow file and the one about the token. If Task 13 found the bypass
  answer is not seen by a run, it says so. Step 2 then waits for review.

| If step 1 refuses, saying | Then |
|---|---|
| "The environment's rules are not as they should be", with reasons | He reads the reasons and puts the rule right in Task 16's own words. The usual causes: "Prevent self-review" was ticked; the branch rule is missing; "Save protection rules" was not pressed. Then he presses "Run workflow" again. Nothing was started |
| "The environment railway-settings could not be read" | The builder reads the step's log for the status code. `404`: the environment is not there under that exact name; he looks at its name. `403`: a run's token may not read it; the fix is a reviewed pull request that adds the missing read-only permission to all three jobs, before Task 23 |
| Reasons that say the branch rules could not be read | This is the read Task 13 could not prove. The builder reads the log for the status code. The fix is a reviewed pull request, before Task 23, that adds `deployments: read` to the two jobs that lack it; then this step again. **Only if no read-only set lets a run's own token read them:** stop. Design 6.1's read-back cannot be built with the run's own token. Take it to the release lead and the founder; no stronger token and no read without a token is used |
| "This run is not for master's trusted places as they are now" | A newer merge changed a trusted place. He presses "Run workflow" again |
| "The workflow's base code is not part of master's history" | Task 15's last paragraph |
| "A trusted file on the runner is not the file git holds for its commit" | An attributes file in the repository makes git rewrite a trusted file as it checks it out. The builder finds the line by hand (`git check-attr -a -- <each trusted file>` in a checkout of `master`) and says which to the release lead. It is taken out by a reviewed pull request. Nothing is approved meanwhile, and nothing could be: every job makes the same proof first |
| "The code that writes this page could not show this commit's files", or that the change is too large | Not expected here: the base code is this commit's own. The builder reads the log. Nothing is approved |

- [ ] **Step 2: He approves step 2:** on the run's page he presses "Review deployments", ticks
  `railway-settings`, and presses "Approve and deploy". It finishes and says: Rehearsal. No token is stored.
  **Step 3 must then wait for a second review.** He approves it the same way. It says the same.
- [ ] **Step 3: The builder reads the run.**

```bash
gh api "repos/{owner}/{repo}/actions/runs/<run id>/approvals" --jq '[.[] | {state, environments: [.environments[].name], by: .user.id}]'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .conclusion] | @tsv'
gh api "repos/{owner}/{repo}/deployments?environment=railway-settings" --jq length
```

Expected: two approvals, each for `railway-settings`, each by the owner's id; three jobs, each `success`;
`0` deployment records.

**If the list of approvals is empty although he approved twice:** GitHub keeps no review history for a job
that makes no deployment record. The last change applied is found only through that history (Task 5), so
no run can ever count. **Nothing is changed to work round it.** The design asks for approved jobs with no
deployment record of their own (its 6.2), and says what happens when the history cannot be read: the
trusted places are shown in full. So the set-up goes on as designed, and this is where it ends:
- **nothing is built for it, and no switch is set.** The gate that pull request 1 merged already answers
  this case by itself: a run that applied and has no review at all on record ends the search, and the
  answer is `unread` (Task 5, `approvalUnrecorded`). That matters, because the gate is run from the base
  copy: a switch set in a later pull request would not reach step 1 until BASE moved ("Who writes step
  1"). Until a run has applied, step 1 goes on saying that no earlier run applied a change, which is true.
  From the first applied change on it says that the history could not be read in full, which is also the
  truth: the part that says who approved is not there. It never says "no run applied" of a run that did;
- every run's step 1 shows every file in full, and every old value in step 2 reads `(hidden)`, for good;
- Task 25's page says so, under what the workflow does not check.
Whether to change the design so that old values can be shown is the founder's to decide, on a dated
amendment to the design reviewed by the release lead. Until he has, nothing is built for it.

**If step 3 did not ask for its own approval:** stop here. No token is stored. The two approvals the design
promises cannot come from one environment. The nearest thing that can is a second environment for step 3,
with the same four rules and its own copy of the secret. That changes design 6.1. It needs a dated
amendment to the design, reviewed by the release lead and answered by the founder, before anything else is
built.

- [ ] **Step 4: One more run shows GitHub's own rule at work** (design section 8, step 3). This is safe only
  because no token exists yet: check first that the environment's page still lists no secret. The builder
  pushes a throwaway branch. Its copy of the workflow differs from `master`'s in exactly two things:
  1. no job has a condition: the `if` of `gate`, `plan` and `apply` is taken out;
  2. nothing refuses another branch before the environment does: `gate` is cut down to one step that
     prints a fixed line, and the `gate again` step is taken out of `plan` and `apply`.
  Nothing else changes: `plan` still needs `gate`, and both approved jobs still name the environment as
  `master`'s copy does. GitHub's own branch rule is then the only thing between that branch and the
  environment. That copy fails the CI check, as it should, and is never in a pull request. The builder
  starts a run from the branch and reads it. Nobody approves anything. **The run is cancelled as soon as it
  has been read,** whatever it showed: a run left waiting can be approved for 30 days, and this copy of the
  workflow has no gate. Then the branch is deleted. It is never merged.

```bash
gh workflow run railway-settings.yml --ref <throwaway branch>
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .status, .conclusion, (.steps | length)] | @tsv'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/pending_deployments" --jq length
gh run cancel <run id>
gh api "repos/{owner}/{repo}/actions/runs/<run id>" --jq '[.status, .conclusion] | @tsv'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/pending_deployments" --jq length
git push origin --delete <throwaway branch>
```

  (`gh run cancel` answers that a run which has already ended cannot be cancelled; that is the expected
  answer here. The branch is deleted only when the run reads `completed` and no review is pending.)

Expected: `Check the gate, show the change` succeeded; `Read Railway's plan` failed with no step run, refused
by the environment itself; `Apply this plan` skipped; `0` reviews pending. The run's page says the branch may
not deploy to the environment.

**If GitHub let that job wait for review or run:** store no token, and stop. The branch rule is what keeps a
branch from the token, which is the design's first anti-goal, and the design relies on GitHub holding to it
for a job that makes no deployment record. GitHub's page "Deploying with GitHub Actions" says that for such
a job reviewers "must still approve" and that branch policies restrict "which branches can use certain
secrets", but its table of rules has no row for the branch rule. The builder makes one more run, to learn
the cause and to change nothing: the same throwaway branch with both approved jobs naming the environment
as a plain string. Each of the two runs is cancelled as soon as it has been read, and no review is left
pending. What both runs showed goes to the release lead and the founder as a dated amendment to
design 6.1 and 6.2. Nothing is changed on `master`, no token is stored and no later task is begun until
the founder has answered it. If the plain form is let through as well, the environment's rule is not what
Task 16 set: read it again with him first.

- [ ] **Step 5: The phone.** Record whether GitHub's phone app showed the summaries, the review button and the
  "Run workflow" button. **If it lacks any of the three:** design section 9's own fallback. He uses the
  browser on his phone, and Task 25's page says so. **If the phone's browser lacks it too:** that one thing
  is done at a computer, under his own sign-in, with no agent session running on that computer, and Task
  25's page says which thing. That is the last stop. The design's goal of two taps and no computer is then
  not met for that one thing, and the builder says so to the release lead and the founder.

- [ ] **Step 6: A re-run of an approved job asks for its own review.** Task 27's rows, Task 25's page and
  the sentence for a head that moved all send him to GitHub's "Re-run failed jobs" as the cheapest way on,
  and say that the new attempt waits for a review of its own. GitHub's page on re-running jobs implies it
  and does not say it for a job in a protected environment. It is proven here, on the rehearsal run of
  steps 1 to 3, while no token exists: check first that the environment's page still lists no secret.
  1. The founder opens that run's page, opens the job "Apply this plan", and presses "Re-run this job" and
     then "Re-run jobs". (If the page words it otherwise he says what it reads, and nothing is pressed on a
     guess.)
  2. The builder reads the run:

     ```bash
     gh api "repos/{owner}/{repo}/actions/runs/<run id>" --jq '[.run_attempt, .status] | @tsv'
     gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs?filter=latest" --jq '.jobs[] | [.name, .status, .conclusion, (.steps | length)] | @tsv'
     gh api "repos/{owner}/{repo}/actions/runs/<run id>/pending_deployments" --jq '[.[].environment.name]'
     ```

     Expected: attempt `2`, the run `waiting`; `Apply this plan` `waiting`, with no step run; one review
     pending, for `railway-settings`.
  3. The founder rejects that review: "Review deployments", tick `railway-settings`, "Reject". The builder
     reads the same three lines again. Expected: `Apply this plan` ended with no step run, and no review
     pending. The first attempt's two approvals are still in the run's review history.

  **If the new attempt did not wait for a review** (its steps ran): stop, and take it to the release lead.
  Here it ran a rehearsal step and nothing else. With a token stored it would mean that a re-run of a red
  apply job applies with no second approval of its own. So no token is stored until this is settled, and in
  any case every mention of "Re-run failed jobs" as a way on is taken out in pull request 2: from the
  sentence `moved` (Task 10), from Task 27's rows and from Task 25's page, which then say that a red run is
  never re-run and that "Run workflow" starts afresh.

**What a person sees:** one green rehearsal run with two approvals on it and a rejected second attempt, and
one refused run from a branch.

### Task 18 (needs the founder's yes): four read-only reads of Railway, by hand

These use the existing by-hand route and its sign-in, outside the repository. Each command only reads. Their
output stays outside the repository; only the words named below are written down. His yes here is for these
reads alone; it approves nothing on GitHub.

**What he is asked:** may the builder run read-only commands of Railway's tool, the way plans were read
before the move: plans, and one list of deployments. Nothing is applied, and nothing is committed.

**What is no longer asked.** An earlier wording had a step in which the founder staged a change on Railway's
dashboard and left it undeployed while the builder read a plan, then discarded it. That step is taken out.
It named no setting and no value. It gave no quiet window in which nothing else could ship the staged
change, and Railway's own page says a deploy from the dashboard deploys every staged change at once. And
nothing this plan builds depends on its answer: design section 7 already rests on his look at the
dashboard before the second approval, and step 2 prints that rule every time. Whether the tool can see
staged changes stays unknown, and the table at the end says so. Nothing is staged on production for a test.

- [ ] **Step 1: A plan from the file, as today.** From a clean checkout of `master` in the by-hand route's
  folder: `railway config plan --out <A>`. Expected: exit 0, and `A` holds no change.
- [ ] **Step 2: A plan from a file evaluated beforehand** (design section 9, not yet proven: whether the tool
  can plan from a settings file evaluated beforehand).

```bash
node -e "import('./.github/railway-settings/tool.mjs').then(async (m) => { const fs = require('fs'); const e = await m.evaluateSettings('.railway/railway.ts'); fs.mkdirSync(process.argv[1], { recursive: true }); fs.writeFileSync(process.argv[1] + '/railway.ts', 'export default ' + JSON.stringify(e.project) + ';\n'); })" <G>
railway config plan --file <G>/railway.ts --out <B>
node -e "const [a,b]=process.argv.slice(1).map(f=>JSON.parse(require('fs').readFileSync(f,'utf8')));for(const k of ['sourceTree','configEtag','changeSetHash','destructive'])console.log(k,a[k]===b[k]?'same':'DIFFERENT');console.log('changes',a.changeSet.changes.length,b.changeSet.changes.length)" <A> <B>
```

Expected, if the tool can: exit 0, four lines ending `same`, and `changes 0 0`.
**If it can:** in pull request 2 the token step plans from a file of plain data, which the step before it
wrote from its own reading of the settings file. The process that holds the token then runs neither the
settings file nor the kit. That is design section 9's own form: "the file and the kit are evaluated with no
token present". It is no more than that. They still run earlier in the same job, and a step is not a wall.
Task 19 has the details, and says exactly what the form does and does not give.
**If it cannot** (an error, a different tree, or changes in `B`): the design's own fallback. The token step
plans from `.railway/railway.ts`, as design 6.2 is written.

- [ ] **Step 3: The shape of Railway's own state.**

```bash
railway deployment list --service <the one service the file declares> --json > <L>
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const keys=(o,p='')=>Object.entries(o??{}).flatMap(([k,v])=>v&&typeof v==='object'&&!Array.isArray(v)?[p+k,...keys(v,p+k+'.')]:[p+k]);console.log(Array.isArray(d),d.length,keys(d[0]).sort().join(','),[...new Set(d.map(x=>x.status))].join(','))" <L>
```

  The command is the one design 6.2 writes, with the flags the tool's own help gives (`--service`, `--json`).
  It prints the names of an entry's fields, nested ones too, and the status words: no value but those words.

Expected: `true`, a count, the key names `createdAt`, `id`, `status` and whatever keys `meta` holds, and
status words among those Task 7 names. That is what the tool's public source says an entry is. From the
names under `meta`, write down whether one carries the commit: the source shows none anywhere else.
**If the status field has another name, or a final word is missing from Task 7's five:** Task 19 corrects
`railwayBusy` to what was seen.
**If no key carries the commit:** `LIST_FIELDS.commit` stays `null`, and the fallback could never confirm a
redeploy (Task 7). That matters only if Task 27 shows the fallback is needed; Task 6 says it is not.

- [ ] **Step 4: Two plans from a copy of the file changed by hand, to settle how the tool writes replicas
  and regions** (departure 8). The tool's source says that one replica in one region is its own default
  whatever the region, so that a move of that one replica gives no plan at all, and that a rise from one
  replica is written with `null` for the old side. This step reads both from Railway's tool itself. In
  the by-hand route's folder, with nothing committed:
  1. edit `.railway/railway.ts` so that the one replica is in another region from Railway's own list, and
     run `railway config plan --out <D>`;
  2. edit it again so that the first region has two replicas, and run `railway config plan --out <E>`;
  3. put the file back with `git checkout -- .railway/railway.ts`, and plan once more to see `A`'s state.

```bash
node -e "for (const f of process.argv.slice(1)) { const c=JSON.parse(require('fs').readFileSync(f,'utf8')).changeSet.changes; const d=c.flatMap(x=>x.details??[]).filter(x=>x.startsWith('regions.')); console.log('changes',c.length,'region details',d.length,d.map(x=>x.slice(x.indexOf(' ('))).join(' ')); }" <D> <E>
```

  It prints, for each plan, the number of changes, the number of details that begin `regions.`, and those
  details' two sides, which are numbers or `null`. It prints no name.

| What is seen | What follows |
|---|---|
| `<D>`: `changes 0`. `<E>`: one change, one region detail, ` (null → 2)` | The source was read rightly. Departure 8 stands, and Task 1's reader and fixtures are right as built |
| `<D>` holds a change | A move of the one replica does reach a plan. Departure 8 is struck in pull request 2, with what the detail looked like, and Task 1's reader is given that form, test first (Task 19) |
| `<E>`'s detail has another form | Task 1's reader and its two replica tests are corrected to the form seen, test first (Task 19) |

**What a person sees:** four short results in the session log, in neutral words, with no id or name from
Railway.

---

# Part three: pull request 2 (the two steps that hold the token)

Tasks 19 to 24. The token is stored only after pull request 2 has merged.

### Task 19: Settle the commands and the reader, from what Task 18 found

**Files:**
- Modify, in the trusted folder: `tool.mjs`, `look.mjs`, `gate.mjs`, `cli.mjs`; the workflow; in the check
  folder: the check and the tests (each only where a result of Task 17 or Task 18 calls for it)

- [ ] **Step 1: For each result of Tasks 17 and 18 that differs from what pull request 1 assumed, write the
  failing test first.**
  - **Plan from a generated file** (only if Task 18 step 2 found the tool can). `allowedCommands` becomes
    `config plan --file <workdir>/evaluated/railway.ts --out <workdir>/plan.json` and
    `config plan --file <workdir>/evaluated/railway.ts --detailed-exit-code`. The three other commands stay.
    Task 3's five commands written out, and the check's own copy of them (Task 11, rule 16), change in the
    same commit. New tests: the old two forms are refused; `--file` with any other path is refused. And:
    - `declared` (Task 12), once `checkSettingsProject` has passed, also writes
      `WORK/evaluated/railway.ts` as `export default <the project as JSON>;`, and that file's SHA-256
      beside it. It starts no process for this;
    - `recheck` (Task 21) also holds the generated file to that SHA-256, after `verifyPinned` and before
      the apply. A file that differs is `notAsInstalled`.
    **What this form gives, and what it does not.** The token step then runs Railway's tool on a file that
    holds data and no code: the process that holds the token starts neither the settings file nor the kit.
    That is design section 9's own form ("the file and the kit are evaluated with no token present"), so
    it needs no amendment, and the pull request says which of the two forms was built. It does not make
    the step a wall. The settings file and the kit still run earlier in the same job, where code can
    change what a later step runs; `recheck` narrows that and does not close it. What stands between the
    commit's code and the token in either form is the first approval. An earlier wording of this plan
    claimed more for this form, and the release lead's reviews struck it twice.
  - **The state's shape.** `railwayBusy`'s tests use what Task 18 step 3 saw. A final word that was missing
    from the five is added, with the day it was seen.
  - **Replicas and regions** (only if Task 18 step 4 saw another form than Task 1 reads): the reader and
    its two replica tests take the form that was seen. If a lone move of the one replica does reach a
    plan, departure 8 and `changedNoPlan`'s place on Task 25's page are corrected in the same pull request.
  - **Permissions** (only if Task 17 step 1 needed more): the three jobs' permissions as found there.
  - **Re-runs** (only if Task 17 step 6 found that a re-run does not wait for a review, and after the
    release lead has answered): every mention of "Re-run failed jobs" as a way on is taken out, of the
    sentence `moved`, of Task 27's rows and of Task 25's page.
  **Nothing here changes what step 1 itself does.** Step 1 is run by the base copy and the code copy, so a
  change in this task to a module they share reaches the approved jobs at once and step 1 only later
  ("Who writes step 1"). Nothing in this list needs to reach step 1: Task 17's finding about recorded
  approvals is already answered by the gate that pull request 1 merged. If a result of Tasks 17 or 18 does
  call for a change to the `gate` or the `show` command, it lands here like the rest, and a pull request
  that changes the workflow file alone then moves BASE to the commit that holds it, before Task 23. That
  pull request carries one more test: the trusted folder at BASE, read from git, holds the fix.
  Staged changes are not in this list: Task 18 no longer reads them.
- [ ] **Step 2: Run to see them fail, change the modules, run to see them pass.**
- [ ] **Step 3: Commit,** naming the files changed, with the message
  `feat(ci): settle the Railway commands on what the read-only proofs showed (T-751)`.

**What a person sees:** nothing yet.

### Task 20: Step 2, live

**Files:**
- Modify: `.github/workflows/railway-settings.yml` (job `plan`), `.github/railway-settings/cli.mjs`
- Modify: `.github/railway-settings-check/cli.test.mjs`,
  `check-workflows.test.mjs`

**Interfaces:**
- Consumes: `planStep` (Task 9), `readPlan`, `renderPlan`, `planIds`, `lineMark`, `planWords`,
  `checkSettingsProject`, `storedSettings`, `declarationChanged`; and the two files the step before wrote,
  `WORK/declared-now.json` and, when there is a last change applied, `WORK/declared-last.json` (Task 12,
  `declared`).
- Produces, in `cli.mjs`:
  - `plan`: builds `deps` and calls `planStep`, with its `tool` held to step 2's two commands
    (`runTool`'s `step: 'plan'`, Task 3, with the checkout's root as its `folder`). That makes two calls to
    Railway and no others, each with its output in a file in WORK: `config plan --out`, then
    `deployment list`. The service's name for the second comes from `WORK/declared-now.json`, checked as below. On success it writes `WORK/planned-at` and
    `WORK/state`, which holds one word, `quiet` or `busy`. On a failure it writes the fixed sentence for the result's key
    (`noToken`, `planFailed`, `planShape`, `stateFailed` or `stateUnknown`) to the log and the summary, and exits
    non-zero, so the step fails. It writes nothing else, and nothing either call printed.
  - `render`: reads `WORK/plan.json`. A file that `readPlan` does not read is written as the one sentence
    `planShape`, and the step fails: the tool exited 0, so there is no exit code to give, and the change,
    if there is one, is applied by hand. Otherwise it prints `::add-mask::` for each of `planIds`, and
    renders with the two readings of the settings file that the step before made. Neither file is
    trusted for its form. `declared-now.json` must pass `checkSettingsProject` again, here, and its `build`
    and `deploy` come through `storedSettings`; if it is missing or does not pass, `declaredNow` is `null`,
    and `renderPlan` then refuses every change as `the plan is not what the settings file declares`.
    `declared-last.json` is missing, or JSON that holds exactly two maps, `build` and `deploy`; anything
    else is `null`, and old values are hidden. `toolVersion` comes from the pins, and `sourceTree` is read
    as the gate reads it for the run's commit. It reads `master`'s head for the `redeploys` sentence, reads
    the word in `WORK/state` for the sentence about Railway, gives `planWords` its `fileChanged` as
    `declarationChanged` of the two readings, writes step 2's summary, and outputs `mode=live`, `pending`,
    `lines` (the JSON of the list, without marks), `planned_at`, `declared_last` (the second reading as
    JSON, or empty) and `named_head`: the commit of `master`'s head that it has just read and that its
    `redeploys` sentence names. Step 3 is handed that commit, and says so before it applies if `master` has
    moved from it (Task 9, step 10). It never reads the state call's own output. It looks at the refusals before it looks
    at whether anything is pending, as Task 9 does: a plan with no change and a refusal is written as
    `hand` with its reason, never as `upToDate`, and the step fails, because such a plan proves nothing
    about this commit. Only a plan that is `agreed` is written as `upToDate`, or as `changedNoPlan` when
    the file's declaration has changed since the last change applied. A plan with changes and refusals is
    written as `hand` and the step passes with `pending=true`: step 3 is then asked for, and refuses.
- **What step 2 shows that step 1 does not.** Step 1 shows the settings file as text. Everything that needs
  the file to be run is here, after the first approval: whether the file is one this workflow applies at
  all (`settingsRefused`, from the step before); whether Railway's plan is what the file declares (the
  refusal of Task 2); each old value, shown only when it is the one the file declared at the last change
  applied (design 6.4); and whether the file's declaration changed while the plan is empty
  (`changedNoPlan`).
- In the workflow, job `plan`'s last step becomes two, and the job is then live as rule 14 of Task 11
  defines it. The first of the two is the one step of this job that holds the token. `gate again` stays
  where it is, first after the runtime, and the step that reads what the file declares stays just before
  the token step. There is no step for "already up to date": the summary says it, and such a run is not
  a change applied (Task 5). Two of the job's outputs are filled for the first time: `declared_last`,
  which step 3 takes (departure 9), and `named_head`, the commit this step's page named (departure 11).

```yaml
      - name: Read Railway's plan, with the token
        env:
          RAILWAY_SETTINGS_TOKEN: ${{ secrets.RAILWAY_SETTINGS_TOKEN }}
        run: bash .github/railway-settings/run.sh plan
      - name: Write the plan's lines, with no token
        id: render
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: bash .github/railway-settings/run.sh render
```

  The job's two outputs `declared_last` and `named_head` have been in the workflow since Task 14, empty in
  the rehearsal; `render` now fills them.

  If Task 19 chose the generated file, the step before the token step also writes the file to plan from, as
  Task 19 says. The steps and their order are the same in both forms.

- [ ] **Step 1: Write the failing tests.** In `check-workflows.test.mjs`, `STAGE` of Task 14's first test
  becomes `{ plan: 'live', apply: 'rehearsal' }`: `plan` is live after this task and `apply` is not yet.
  That test then holds the committed file to `REHEARSAL` with `LIVE`'s `plan` job in it. No test of a rule
  changes: each plants its violation in a fixture, never in the committed file. And:

```js
// A step holds a secret when the word stands anywhere in it, in any letter case.
const holdsSecret = (step) => /secrets/i.test(JSON.stringify(step));
const NAMED = { plan: "Read Railway's plan, with the token", apply: 'Plan again, look, apply, plan again, with the token' };
const liveJobs = () => Object.keys(STAGE).filter((job) => STAGE[job] === 'live');
test('the token is in exactly one step of each live job, and the step is the named one', () => {
  const doc = parse(committed());
  for (const job of liveJobs()) {
    const holders = doc.jobs[job].steps.filter(holdsSecret);
    assert.equal(holders.length, 1, job);
    assert.equal(holders[0].name, NAMED[job]);
    assert.match(holders[0].run, /^bash \.github\/railway-settings\/run\.sh (plan|apply)$/);
  }
  assert.ok(!holdsSecret(doc.jobs.gate));
  for (const job of ['plan', 'apply'].filter((j) => !liveJobs().includes(j))) assert.ok(!holdsSecret(doc.jobs[job]), job);
});
test('in each live job the proof, the second gate read and the reading of the settings file come before the token step, in that order', () => { /* by step order */ });
test('the step that writes the lines comes after the token step and holds no secret', () => { /* ... */ });
```

  In `cli.test.mjs`: `render` on a fixture plan writes the lines of Task 1 into the summary file and the
  outputs file; a plan that changes the health check has its line marked at its start in the summary,
  unmarked in the outputs, and the `shape` sentence below; neither file holds any of `planIds`. `render` on
  a file that is not a plan, and on a plan with one key more, exits non-zero and writes only the
  `planShape` sentence, with no "Exit code" in it. On a plan that adds a service, in the tool's own shape
  (Task 1's `created()`), it writes `hand` with its reason and not `planShape`, and the service's name is
  nowhere in the summary or the outputs. A plan with no change made for another copy of the folder is
  written as `hand` with its reason, the words "up to date" are nowhere in the summary, and `render` exits
  non-zero; a plan with no change and nothing against it is written as `upToDate`, with `pending=false`.
  For a plan to apply, the output `named_head` is the whole commit the fake gave as `master`'s head, and the
  `redeploys` sentence names its first seven characters. With `declared-now.json` missing, not JSON, or the answer of a file that manages variables, a plan with
  a change is written as `hand` with the reason `the plan is not what the settings file declares`. With
  `declared-last.json` missing, not JSON, or holding a third key, old values read `(hidden)`, the output
  `declared_last` is empty and nothing fails; with a good one the output is that JSON. **With two readings
  that differ and a plan with no change** (the one replica named in another region): the summary reads
  `changedNoPlan` and not `upToDate`, `pending=false`, and the step passes; with two readings that are
  equal, and with no second reading, it reads `upToDate`. With `WORK/state` holding `quiet` the summary has
  `stateQuiet`; with `busy` it has `stateBusy`; with the file missing or holding any other word `render`
  exits non-zero. `plan`, with an injected tool whose state call exits 1, exits non-zero and writes only
  `stateFailed` with the code; with one whose state call writes a shape `railwayBusy` does not know, it
  exits non-zero and writes only `stateUnknown`; with one that writes the text `MADE-UP-STATE-OUTPUT` among
  readable entries, that text is in no log, summary or output. The state is read from `tool-5.out` (Task 3)
  and from no other file.
- [ ] **Step 2: Run to see them fail.** Expected: FAIL, in exactly these: Task 14's first test (the
  committed `plan` job is still in rehearsal form); the three tests above (no step of the committed `plan`
  holds a secret yet); and the new tests of `cli.test.mjs` (there is no `plan` or `render` command yet).
  Every other test passes, and every test of a rule among them: those read the fixtures.
- [ ] **Step 3: Edit the workflow and `cli.mjs`.** `RUN_LINES` does not change: since Task 11 it holds every
  line either form may hold, because both fixtures must pass the check.
- [ ] **Step 4: Run every test and the check.** Expected: PASS, every test, and
  `Railway settings: 10 workflow files checked.` Rule 14 judges each approved job by itself, so a live
  `plan` beside an `apply` still in rehearsal form passes. This commit is never merged alone: pull request
  2 merges with Task 21 in it.
- [ ] **Step 5: Commit,** naming the files, with the message
  `feat(ci): step 2 reads Railway's plan and its state with the token in one step (T-751)`.

**What a person sees:** nothing until the token is stored. A run approved before then says: No token is
stored in the environment. After that, every run's second step says, in the same fixed words, whether Railway
is building or deploying just now.

### Task 21: Step 3, live

**Files:**
- Modify: `.github/workflows/railway-settings.yml` (job `apply`), `.github/railway-settings/cli.mjs`
- Modify: `.github/railway-settings-check/cli.test.mjs`,
  `check-workflows.test.mjs`

**Interfaces:**
- Consumes: `applyStep` (Task 9), `reinstallKit`, `verifyPinned` (Task 3), `redeployVerdict`,
  `railwayEnvironmentOnGitHub`, `FALLBACK_READ` (Task 7), `applyWords`.
- Produces, in `cli.mjs`:
  - `apply`: builds `deps`, with its `tool` held to step 3's commands (`runTool`'s `step: 'apply'`), and
    calls `applyStep` with `LINES` and `PLANNED_AT` from job `plan`'s outputs. Its context holds two
    readings of the settings file, each checked for its form as Task 20's `render` checks them. What the
    file declares now is this job's own reading, `WORK/declared-now.json`, which its step "Read what the
    file declares, with no token" wrote just before: step 3 works every refusal of 6.3 out again, and the
    refusal that the plan is what the file declares needs a reading made here. What the file declared at
    the last change applied is `DECLARED_LAST`, step 2's reading, from job `plan`'s output (departure 9):
    step 3 writes its lines with the same old values step 2 showed, so that the two sets of lines differ
    only when Railway does. So this one step makes design 6.2's calls to Railway, in its order, each to a
    file in WORK: the plan, the state, the apply, the closing plan, and the same list of deployments again
    only if `FALLBACK_READ` is `true`. Its `readText` prints `::add-mask::` for each of `planIds` the
    moment the second plan is read.
    - **`recheck` is `verifyPinned` first, then `reinstallKit`** on the checkout's root joined with
      `.railway`, an absolute path, with npm's two other settings files replaced by an empty one (Task 3):
      this install runs inside the step that holds the token. `verifyPinned` checks the
      tool's program and the whole runtime folder. npm is JavaScript inside that folder, so the folder is
      checked before npm is started, never after. Then npm checks the kit against its lockfile. That is
      design 6.2's "just before it, the kit is checked against its lockfile and the tool against its
      checksum once more". A problem from the first means the second is not run. (In the generated-file
      form it also holds the generated file to its SHA-256: Task 19.)
    - **`github.executing` reads every run that is not completed.** For each file of `MIGRATION_WORKFLOWS`
      it reads `GET .../actions/workflows/<file>/runs?status=<status>&per_page=100` once for each of
      `queued`, `requested`, `pending`, `waiting` and `in_progress`: every status GitHub gives a run before
      it is completed. An answer whose `total_count` is more than the runs it returned, or that is not in
      the shape this code knows, is a failed read. Then it reads each such run's jobs (`filter=latest`: here
      the question is what is executing now, so only the newest attempt matters), and returns the jobs by
      run. Any failed read throws, and step 3 refuses with `unread`. One read of "the
      newest runs" would miss an old run that is still open, so the reads are by status. `executingJobs`
      then counts jobs, not runs (Task 7 says why). **A run that has just started lists no job for its
      first moments.** So a run with no job that GitHub made less than five minutes before the read, by
      the run's `created_at` and the read's own `Date` header, is given one job of the status `queued`,
      and counts. An older run with no job is one of the stale ones Task 7 names, and counts nothing.
    - `gateHead` is the text of `WORK/gate-head`, which this job's `gate again` wrote.
    - `github.head` reads `master`'s head and keeps the answer's `Date` header exactly as it came.
    - `probe` reads `master`'s head, reads `VERSION_PROBE`, compares that commit with that head through
      GitHub, lists the files between them, and answers that head with the rest.
    - its `tool` gives `runTool` the checkout's root as `folder`, and absolute paths for the rest (Task 3).
    - `wait(seconds)` sleeps. `afterVerdict` answers `cannot` while `listVerdict` is not built; with
      `FALLBACK_READ` `false` it is never called.
    - `namedHead` is `NAMED_HEAD`, job `plan`'s output. `say` writes the sentence it is given to this
      step's log, which a person can read while the job runs. It writes nothing to a summary: GitHub
      shows a job's summaries only when the job has ended, and the last step puts the sentence there, once.
    - **Each call to the tool has its limit,** given to `runTool` as `timeoutMs`: the plan five minutes,
      the list of deployments two, the apply ten, the closing plan five. Step 2's two calls have the same
      two limits, and `tool-version` thirty seconds.
    It writes `WORK/outcome.json` (`outcome`, `key`, `code`, `reasons`, `appliedAt`, `head`, `named`,
    `after`) and outputs `outcome`. It exits non-zero unless the outcome is `applied`.
  - **The limits, added up, fit each job's own.** Most waits on something outside the runner have a
    limit of their own (Task 12), and those are added here as limits, in minutes. Four have none, and are
    added as estimates, each named as one: a checkout, counted as one minute; a file's contents that git
    fetches by itself, counted inside the step that asks for it; the reads of a look; and the fallback's
    rounds. The room each job has to spare is what covers them, and the job's own limit is what ends a
    job that outruns them.
    - `gate`: three checkouts and their proofs, 4; two installs of the runtime, 5 each; the gate's reads
      of the rules and the trees, some twenty of them at thirty seconds each, 10; the history, 5 by its
      own clock; what changed, 3 (a fetch of 2); the page, 1. That is 33, and the job has 45.
    - `plan`: the checkout and its proof, 2; the runtime, 5; the gate again, 8; the kit, 10; the tool and
      its check, 6; the older commit's settings folder, 3; the reading of the file, 14 (two evaluations of
      2 each, and the older commit's kit, 10); the token step, 7 (5 for the plan, 2 for the state); the
      lines, 1. That is 56, and the job has 75. (An earlier wording gave this job thirty and left the older
      commit's kit out of the count.)
    - `apply`: before its token step as `plan` without the older commit: 2, 5, 8, 10, 6, and 2 for the one
      evaluation. That is 33. The token step: 5 for the plan; 10 for the look, which is an estimate (2 for
      Railway's list, and some fifteen reads of GitHub when few runs are open; every open run adds one);
      11 for `recheck`; 2 for a look made again, since an apply is refused when its look is older than
      that; 10 for the apply; 5 for the closing plan. That is 43. The wait, 76 by its own clock. The last
      step, 1. That is 153, and the job has 180. With `FALLBACK_READ` the token step's own fifth call
      does the waiting in the wait step's place, which then reads nothing. That is an estimate of about
      as long: it counts 150 rounds of thirty seconds and no clock, so answers that come slowly make it
      longer, and the job's limit is what ends it.
    A job that still runs out of time is cancelled by GitHub. The wait is then stopped, and the last step
    says so, as below.
  - `wait`: the long wait, in a step of its own, so that a Cancel or a time-out can stop it. It reads
    `WORK/outcome.json` and writes `WORK/redeploy.json`. It writes no summary, and it exits 0 whatever it
    found: the last step gives the job its result.
    - With no outcome file, one that cannot be read, or an outcome from before the apply call (every
      refusal): it reads nothing and writes nothing.
    - When the outcome holds a `head` (an apply call was made): it reads `master`'s head again, and writes
      `{ headMoved }` at once, whether it moved from that `head`.
    - **After every apply call that may have reached Railway** (the outcome `applied`, and `left-over`
      with any of its three keys, `applyUnknown` among them) it then waits for the redeploy. It reads
      GitHub's deployment records for `head` every 30 seconds, with the run's own token, as the production
      receipt reads them (`production-receipt.yml:105-111`), and gives them to `redeployVerdict` with
      `environment` from `railwayEnvironmentOnGitHub(<the project's name in WORK/declared-now.json>)` and
      `appliedAt` as the outcome holds it. With no counted record after 10 minutes: `notConfirmed`. A
      record that fails: `redeployFailed`. Every record that counts live: `live`. Still waiting after 75
      minutes by its own clock (900 seconds of pre-deploy, 2700 of health check, and the build):
      `notConfirmed`. With `FALLBACK_READ` it uses `after` from the outcome in place of the records:
      `live` is `live`; `failed` is `redeployFailed`; `cannot` is `cannotConfirm`. As soon as it has its
      answer it writes the file again, as `{ headMoved, redeploy }`.
    - A read of the records that fails, or that passes its thirty seconds, is a round with no record: the
      wait goes on to its two bounds. A read of the head that fails leaves `headMoved` false: the page
      says a move only when one was read.
    When the job is cancelled or runs out of time the runner stops this step where it stands, and the file
    holds no `redeploy`.
  - `after`: writes step 3's summary and gives the job its result. It reads the two files of the work
    folder and `CANCELLED`, and nothing else: no read of GitHub, no wait. So it is short enough to run in
    the moments GitHub leaves a job that was cancelled. `CANCELLED` counts as true only as the exact text
    `true`.
    - **With no outcome file, one that cannot be read, or an outcome it does not know:** `noOutcome`, or
      `cutShort` in its place when `CANCELLED` is true: the token step may have been stopped in the middle
      of an apply, and the page must say that whether Railway took it is not known. It exits 1.
    - **After a refusal, or an apply call that failed:** that outcome's sentence, and `headMoved` when the
      second file says so. Nothing about a redeploy, and nothing about the job being cut short: nothing
      was applied, and that is the whole truth. It exits 1; the step before has already failed the job.
    - **After an apply call that may have reached Railway:** the outcome's sentence; `namedMoved` when the
      outcome holds `named`; then the redeploy's sentence from the second file. With no answer there:
      `waitCutShort` when `CANCELLED` is true, and `notConfirmed` when it is not, for a wait that ended
      some other way without one. Then `headMoved`. It exits 0 only when the outcome is `applied` and the
      redeploy is `live`. An apply that left something over fails the job whatever the redeploy did, and
      its summary says both. So `applyWords` is given the redeploy's answer when the second file holds
      one, and `cutShort` only when it holds none and `CANCELLED` is true: never both (Task 10). A wait
      that had its answer before the cancel came is reported as what it found.
    It writes step 3's summary in every case in which it runs. **It does not run, and the job's page holds
    no sentence of step 3, when the proof or the runtime's install did not succeed:** when either failed,
    and when the job was cancelled or ran out of time before both had passed. That is the guard at work.
    Nothing was applied then, because the token step comes after both, and a refused proof has written
    its own sentence (Task 27 has the row). An unconfirmed redeploy fails the job, and the run still
    counts as a change applied (Task 5, condition 7): so does a run cancelled after its step "Nothing is
    left to change" had succeeded.
  - `agreed`: prints `A change was applied and nothing is left to change.` It is the step whose success
    Task 5's `lastAgreedCommit` looks for.
- In the workflow, job `apply`'s last step becomes four, and the job is then live as rule 14 defines it.
  The first of the four is the one step of this job that holds the token. The other three are the only
  steps of the whole workflow that have an `if`, and rule 14 holds each to its text and to its own step.
  The second's names no status function, so it runs only after the token step succeeded. The last two
  may run after a failure, and each names the proof and the runtime: a job whose proof refused starts no
  file of its checkout, in any step (rule 14, and Task 13's job `proof-refused`).

```yaml
      - name: Plan again, look, apply, plan again, with the token
        id: apply
        env:
          RAILWAY_SETTINGS_TOKEN: ${{ secrets.RAILWAY_SETTINGS_TOKEN }}
          GITHUB_TOKEN: ${{ github.token }}
          LINES: ${{ needs.plan.outputs.lines }}
          PLANNED_AT: ${{ needs.plan.outputs.planned_at }}
          DECLARED_LAST: ${{ needs.plan.outputs.declared_last }}
          NAMED_HEAD: ${{ needs.plan.outputs.named_head }}
        run: bash .github/railway-settings/run.sh apply
      - name: Nothing is left to change
        if: steps.apply.outputs.outcome == 'applied'
        run: bash .github/railway-settings/run.sh agreed
      - name: Wait for Railway's report of the new deployment
        if: ${{ !cancelled() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: bash .github/railway-settings/run.sh wait
      - name: Say what was done
        if: ${{ always() && steps.proof.outcome == 'success' && steps.runtime.outcome == 'success' }}
        env:
          CANCELLED: ${{ cancelled() }}
        run: bash .github/railway-settings/run.sh after
```

  **Why two steps.** GitHub does not stop a step whose condition is `always()` when the run is cancelled
  or the job runs out of time: the step runs on until GitHub ends the whole job some minutes later. So a
  wait of up to 75 minutes under `always()` could not be stopped by the person who pressed Cancel, and a
  job at its limit would be ended with its page unwritten. The wait is therefore under `!cancelled()`,
  which lets it run after a failed step and stops it at a cancel. The last step is under `always()`,
  holds no token, reads no network and is done in seconds, so it fits in the time GitHub leaves. Task 13
  proves each of these three behaviours on a runner before this task is built.

  The bracketed test at the end of the job's `if` becomes `(needs.plan.outputs.pending == 'true')`. The
  step "Read what the file declares, with no token" stays where the rehearsal form has it, just before
  the token step.

- [ ] **Step 1: Write the failing tests.** In `check-workflows.test.mjs`: `STAGE` becomes
  `{ plan: 'live', apply: 'live' }`, so Task 14's first test now holds the committed file to `LIVE`; and one
  new test, that the committed file holds no `rehearse`. **No test of a rule is touched:** the cases of
  rule 14 that start from a rehearsal job plant their violations in the fixture `REHEARSAL`, which still
  holds one, so none of them goes stale now that the committed file holds none. In `cli.test.mjs`, with
  an injected `fetch` and a fake clock. The
  fake's answer for `master`'s head carries a `Date` header in the header's own form,
  `Thu, 01 Jan 2026 10:00:00 GMT`, and records carry ISO times.
  **The wait.** Each of these also holds that `wait` exits 0 and writes nothing to the summary.
  - `wait` on an applied outcome with a counted live record made five seconds after that header leaves
    `{ headMoved: false, redeploy: 'live' }` in `WORK/redeploy.json`;
  - with a failed record the file holds `redeployFailed`; with none for 10 minutes, `notConfirmed`; with
    only records that do not count (the job's own environment, another commit, made one second before the
    apply), `notConfirmed`;
  - with a counted record still in progress when 75 minutes have passed: `notConfirmed`, after 150 waits
    of 30 seconds;
  - with two records that count, one live and one failed: `redeployFailed`;
  - on a `left-over` outcome, with each of its three keys, `applyUnknown` among them: it does read the
    records;
  - **the file is there before the first wait:** stopped after its first read of the records, with none
    that counts yet, `WORK/redeploy.json` holds `headMoved` and no `redeploy`. This is the state a
    cancelled wait leaves, and the last step reads it;
  - on a failed apply with `master` moved: the file holds `{ headMoved: true }` and no `redeploy`, and no
    deployment record is read;
  - on a refused outcome, with no `outcome.json`, with one that is not JSON, and with one whose outcome is
    a word it does not know: no `fetch` at all, and no file is written;
  - a read of the records that throws, and one that is aborted at thirty seconds, is a round with no
    record: the next round is made, and the bounds are the same two;
  - with the fallback switched on, an outcome whose `after` is `cannot` gives `cannotConfirm`, one whose
    `after` is `live` gives `live`, and no deployment record is read.
  **The last step.** Each of these also holds that `after` calls `fetch` not once and waits for nothing:
  the injected `fetch` and the fake clock's `wait` throw when called.
  - `after` with an applied outcome and `{ headMoved: false, redeploy: 'live' }` prints `applied` then
    `live` and exits 0; with `redeployFailed`, `notConfirmed` or `cannotConfirm` there, it prints `applied`
    and that sentence and exits 1;
  - on a `left-over` outcome, with each of its three keys: the summary holds `leftOver`, `closingUnread`
    or `applyUnknown` with its code, and then the redeploy's sentence; it exits 1 even when the redeploy is
    `live`;
  - on a refused outcome it writes that outcome's sentence and no other;
  - on a failed apply with `{ headMoved: true }`: `applyFailed` with its code, then `headMoved`;
  - with no `outcome.json`, with one that is not JSON, and with one whose outcome is a word it does not
    know: `noOutcome` alone, exit 1;
  - **with `CANCELLED` set to `true`:** with no `outcome.json` it writes `cutShort` alone, and not
    `noOutcome`. With an outcome of `applied`, and of each key of `left-over`, and a second file that
    holds no `redeploy`, or no second file: the outcome's sentence, then `waitCutShort`, and not
    `cutShort`. With those outcomes and a `redeploy` in the second file: that redeploy's sentence, and
    neither of the two. With an outcome of `refused` or `failed`: that outcome's sentence and neither of
    the two. It exits 1 in every one of these but `applied` with `live`;
  - with `CANCELLED` set to `false`, to nothing, or to any other word, and an applied outcome with no
    `redeploy` in the second file: `applied`, then `notConfirmed`, exit 1.
  **The token step.**
  - `apply`'s look: ten reads of runs are made, five statuses for each of the two workflows; a `queued` run
    whose one job is `queued` refuses with `busy`, and so does a `pending` run with a `requested` job; a
    `waiting` run whose one job is `waiting` does not refuse, and nor does a `queued` run with no job; an
    answer with `total_count` 101 and 100 runs refuses with `unread`; a failed read of one run's jobs
    refuses with `unread`; a job with a status the code does not know refuses with `unread`. In none of the
    refusals is the apply call made.
  - `apply`'s `recheck`: `verifyPinned` is called before `reinstallKit`; when the runtime folder holds one
    changed byte in npm's own file, the outcome is `notAsInstalled`, npm is never started and nothing is
    applied.
  - `apply` keeps the `Date` header as it came: the `appliedAt` in `outcome.json` is that text.
  - `apply`'s two readings: with `declared-now.json` missing, or the answer of a file that manages
    variables, a plan with a change is refused as `hand` with
    `the plan is not what the settings file declares`, and nothing is applied; with `DECLARED_LAST` empty,
    not JSON, or holding a third key, old values are hidden, so a step 2 that showed them gives
    `linesDiffer`, and nothing is applied; with the JSON step 2 put out, the lines are step 2's.
  - `apply` on a plan the reader does not read: `outcome.json` holds `failed` and `planShape`, with no
    code, and `after` writes that sentence with no "Exit code" in it.
  - `apply` when `master` moved: with `WORK/gate-head` holding another commit than the two later reads
    give, and with the probe's read giving another commit than the last read, the outcome is `refused`,
    `moved`, the apply call is not made, `wait` reads no deployment record, and `after` writes that
    sentence. With `WORK/gate-head` missing, or `NAMED_HEAD` empty or not a commit, the outcome is
    `refused`, `unread`, and no call to Railway is made at all.
  - `apply` when `master` moved between the two approvals: `NAMED_HEAD` is another commit than the three
    reads give. The sentence `namedMoved`, with both commits, is written to the step's log, and to no
    summary, before the apply call is made; the apply is made; `outcome.json` holds `named`; and `after`
    writes `applied`, then `namedMoved`, then the redeploy's sentence, so the summary holds `namedMoved`
    once. When the log cannot be written to, the outcome is `refused`, `unread`, and the apply call is not
    made.
  - each call `apply` and `plan` make reaches `runTool` with its limit: 300,000, 120,000, 600,000 and
    300,000 milliseconds for the four of step 3, and none without one.
  - `apply`'s look, for a run that lists no job: one made two minutes before the read refuses with `busy`;
    one made an hour before does not.
  - each read of GitHub that `apply` and `wait` make carries an abort signal of thirty seconds, and none
    is made without one. In `apply` a read that is aborted is a failed read, and refuses with `unread`.
- [ ] **Step 2: Run to see them fail.** Expected: FAIL, in exactly these: Task 14's first test (the
  committed `apply` job is still in rehearsal form); Task 20's first test, for `apply` (no step of the
  committed job holds a secret yet); the new test that the committed file holds no `rehearse`; and the new
  tests of `cli.test.mjs` (there is no `apply`, `agreed`, `wait` or `after` command yet). Every other test
  passes, and every test of a rule among them.
- [ ] **Step 3: Edit the workflow and `cli.mjs`.** The committed `apply` job takes its four live steps
  and loses its rehearsal step; `cli.mjs` gains `apply`, `agreed`, `wait` and `after` and loses the two
  `rehearse` commands. `RUN_LINES` and the two fixtures do not change.
- [ ] **Step 4: Run every test and the check.** Expected: PASS, every test, the cases of rule 14 among
  them, and `Railway settings: 10 workflow files checked.`
- [ ] **Step 5: Commit,** naming the files, with the message
  `feat(ci): step 3 applies exactly the lines that were read, then waits for the redeploy (T-751)`.

**What a person sees:** nothing until the token is stored.

### Task 22: Pull request 2, with the Deploy workflow's header comment

**Files:**
- Modify: `.github/workflows/deploy.yml` (the comment at lines 18-21 only)
- Modify: `docs/state/tasks.md` (row T-751), `docs/sessions/<the day>.md`

**The comment.** Today it says Railway deploys are kept out of this workflow so that no Railway token lives
on GitHub. That reason is reversed by the design (its section 5), so the comment is rewritten to say three
things: this workflow still triggers no Railway deploy and holds no Railway token; since this change one
Railway token does live on GitHub, in the `railway-settings` environment, released only on the founder's
approval and only to `master`, for settings changes alone; and the design's path, for the reasons. It is a
comment-only change. `deploy.yml` is not a watched path and not a trusted place, and no line that runs is
touched.

- [ ] **Step 1: Write the check first.** It must print nothing before the edit and nothing after it: every
  changed line of the file is a comment.

Run: `git diff -U0 origin/master...HEAD -- .github/workflows/deploy.yml | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*#'`
Expected: nothing. After the edit, `git diff --stat origin/master...HEAD -- .github/workflows/deploy.yml`
also names the file.

- [ ] **Step 2: Edit the comment. Run the four checks of Task 15, step 1,** and
  `node .github/railway-settings-check/check-workflows.mjs`. Expected: the same as there; the check passes.
- [ ] **Step 3: Commit** `.github/workflows/deploy.yml` with the message
  `docs(ci): the Deploy workflow's header no longer says no Railway token lives on GitHub (T-751)`.
- [ ] **Step 4: Open the pull request and send it to the release lead.** It carries, as evidence:
  - the rehearsal: the run with two approvals and no deployment record, and the run from a branch that
    GitHub refused (Task 17);
  - the four results of Task 18, in neutral words, and which commands and which form they led to;
  - what Task 17 found about recorded approvals and about the read of the branch rules, and what was changed
    for each;
  - the workflow's diff, showing the token in the one named step of each job and in no other place;
  - the count of tests, and the names of the tests of Task 9 that pin the order of the calls;
  - step 1's output for `deploy.yml`, and that the pull request touches no watched path and nothing in
    `.railway/`;
  - a sentence that the merge will start one run, and what the founder does with it (step 5).
- [ ] **Step 5: After review, merge. The merge starts one run,** because it changes the workflow file and its
  folder. Its first step passes and its second waits for review. No token is stored yet. Step 1's page is
  written by the base code, the code pull request 1 merged, and says so. It shows every file in full, the
  changed workflow file and the changed modules among them: this is the first page on which the display
  code of one commit shows the code of another.
  **What the founder is asked:** reject that review, or leave it. If he approves it, it says "No token is
  stored in the environment." and fails. Either way nothing is read from Railway.
  **If step 1 refuses:** the rows of Task 17 step 1 apply. If it says the code that writes the page could
  not show this commit's files, the base code cannot read something pull request 2 added. The builder
  reads the log and says what to the release lead; the way out is the reviewed move of BASE that "Who
  writes step 1" describes.

**What a person sees:** one waiting or rejected run. The workflow is live in code and has no token.

### Task 23 (the founder alone): the token

Design section 8, step 4. No automated tool sees the token at any point, in any form.

**Where he does it.** For a moment the token is on a screen and on a clipboard. So:
- he does this on his phone. He does it at a computer only when no agent session is running on that
  computer: nothing with a browser, a screen, a clipboard or a terminal of its own. If one is running, he
  closes it first or uses the phone;
- **a clipboard can be shared between his devices.** Before he copies the token he turns that sharing off
  on the device he uses, so that the token is not copied to a computer where a session may read it later.
  If he cannot turn it off, he clears the clipboard and its history on every device that shares it, the
  computer among them, as soon as the token is pasted;
- when the token is pasted, he clears the clipboard and its history on the device he used;
- he sends the token to nobody and to nothing, and pastes it into GitHub's one field and nowhere else.
The builder is told only that it is done.

**GitHub's page first, the token last.** While the token is on the screen is no time to find out that a
button reads otherwise. So he opens GitHub's form and checks its words before any token exists. If a
button or a field reads otherwise than below, he says what it reads, the builder corrects this list, and
nothing is pressed on a guess. Only then does he make the token.

**What he is asked, in these words:**

1. On GitHub, open Settings, then Environments, then `railway-settings`. Under "Environment secrets" press
   "Add Secret". A form opens with a name and a value. Type the name `RAILWAY_SETTINGS_TOKEN`. Leave the
   value empty, and leave the form open. Its last button reads "Add secret". (These are the words of
   GitHub's own page on managing environments as it read on 22 November.)
2. Only now, on Railway, open the project's settings, then Tokens. Create a project token, and choose the
   production environment for it. Railway shows which environment a token is for: read that it says
   production.
3. Copy the token, paste it as the value in GitHub's open form, and press "Add secret".
4. Close Railway's page that shows the token. Keep no copy. Clear the clipboard and its history, as above.
5. Check that it is not under "Repository secrets", and that nothing there is named `RAILWAY_TOKEN`. Look
   again at the two things of Task 16: the bypass box is empty, and the repository's own secrets hold
   nothing named `RAILWAY_SETTINGS_TOKEN` or `RAILWAY_TOKEN`.
6. Note the day. The token is replaced every 90 days, and at once after anything goes wrong with a runner or
   a log (Task 25's page has the steps).

**What he should see:** `RAILWAY_SETTINGS_TOKEN` listed under the environment's secrets, with no value shown;
the repository's own secrets list unchanged; the four rules still as he set them.

- [ ] **Step 1: The founder does the six things above,** and says only that it is done, on which day, and
  that Railway named production as the token's environment. The builder writes the day into the session
  log and into the ledger row, as the start of the 90 days.

**When the secret is already there.** A replacement of the token (Task 24's first row, and every 90 days
by Task 25's page) does not use the form above: GitHub changes a stored secret from that secret's own row,
in another form, whose words this plan has not read. So the first replacement reads them before any new
token exists. These six steps are the one order for every replacement: Task 24's first row and Task 25's
item 7 point here and give no order of their own.

1. **In two cases only, the old token is deleted first,** at once, on Railway. When the token may have
   leaked: that is the design's own order for that case (its section 8, "If the token may have leaked"),
   and this step is the first of that list, which Task 25's page repeats as its item 8. And when the
   token has failed, so that Task 24's first row sent him here: a token that does not work is no loss.
   A deleted token leaks nothing more, and until the new one is saved every run fails at step 2 with
   nothing read. **In every other case he skips this step,** and the old token is deleted in step 6, as
   the design's section 8 orders a replacement: at its 90 days, and at once after anything went wrong
   with a runner or a log when nothing shows that the token itself was shown.
2. On GitHub he opens Settings, then Environments, then `railway-settings`, and under "Environment
   secrets" finds the row of `RAILWAY_SETTINGS_TOKEN`. He presses nothing yet, and says what the row's
   buttons read.
3. **The stop.** One of those buttons must open a form that replaces the value of that secret under its
   own name. If none does, or he cannot tell, he stops here and no token is made. The builder rewrites
   these steps from what he read, the release lead reads the change, and he begins again at step 2. He
   does not remove the secret to add it again on a guess: between the two presses the environment would
   hold no secret, and what GitHub then asks of him has not been read.
4. The builder writes the words he read into the session log and into Task 25's page: into its draft
   while pull request 3 is not yet open, into the page itself after. From the second replacement on the
   page holds them, and steps 2 and 3 are the check that they still read the same.
5. He opens that form and leaves its value empty. Only now, on Railway, he creates a project token for
   production and reads that it says production, as in the list above. He pastes it as the value, saves,
   closes Railway's page, and clears the clipboard and its history.
6. He deletes the old token on Railway, if step 1 did not. Then he repeats the design's two checks, which
   are Task 16's: the bypass box is empty, and the repository's own secrets hold nothing named
   `RAILWAY_SETTINGS_TOKEN` or `RAILWAY_TOKEN`. Only after both does he press "Run workflow" and approve
   step 2: "Already up to date" shows that the new token reads. He notes the day, and the 90 days start
   again.

That is the design's order for a replacement, step for step: a new token, pasted over the old secret,
the old token deleted, checks 1 and 2 repeated, and then the check by "Run workflow". Steps 2 to 4 only
come before it, and put no token on a screen.

Nothing is pressed on a guess while a token is on the screen, and no step has a token on the screen
before the form it goes into is open.

### Task 24 (the founder, on his phone): the first check with the token

Design section 8, step 5, and design section 9's "a skipped job asks for none". Nothing before this task
relies on that: until now step 3 ran in every rehearsal.

With nothing at stake, this run also proves two of the things design section 9 lists under what a project
token may run and what those calls return: the plan, and the list of deployments, which step 3 will need
just before a real apply. The third, the apply, is first made in Task 27.

- [ ] **Step 1: He presses "Run workflow" on `master` and approves step 2.**
  **What he should see:** step 1 still shows every file in full, and says the base code wrote the page: no
  run has applied a change yet. Step 2 says "Already up to date. Railway's plan shows no change." and
  "Railway is not building or deploying just now." Step 3 is skipped and asks for nothing. The run ends
  green.
- [ ] **Step 2: The builder reads the run,** and nothing of the token.

```bash
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .conclusion] | @tsv'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/approvals" --jq length
```

Expected: `Check the gate, show the change` and `Read Railway's plan` success; `Apply this plan` skipped; `1`.
This run does not count as a change applied (design 6.2), so the next run's first step shows the files in
full again. That lasts until Task 27.

**A fix that changes a command, or what is read, changes the design.** Design 6.2 writes the exact calls,
and 6.5 says Railway's state is read with the token. So where a row below ends in a stop, it is not a pull
request the builder opens by himself: it is a dated amendment to the design, reviewed by the release lead
and answered by the founder, and then one named pull request, "pull request 2b", before any real change.
Until it has merged and this task has passed, settings are applied by hand as today, and he approves
nothing.

**Telling a bad token from a bad command.** The tool's words never reach a log, so a failed call gives
the builder an exit code and no reason. Three things are known without them. The same commands, run by
hand under the by-hand route's own sign-in, worked in Task 18: so the commands are right for the tool. The
tool's public source at `v5.74.0` says where a project token's environment comes from: the tool asks
Railway for the token's own project and environment (`src/config.rs`, `get_linked_project`), and for a
project token `--environment` is only checked against that and changes nothing
(`src/commands/config/runner.rs`, `target_linked_environment`). So naming the environment on the command
cannot mend anything, and is not tried. And step 2 makes two calls with the one token: when the first
passes and the second fails, the token is good. That leaves the order below: a failed first call is taken
for a bad token until a fresh token has failed the same way.

| If instead | Then |
|---|---|
| Step 1 refuses | The rows of Task 17 step 1. He approves nothing |
| Step 2 says the plan could not be read, with an exit code | First take it for the token: made for another environment, cut short in the pasting, or already deleted. He looks at Railway's Tokens page and reads which environment the token is for. Then he replaces it by the six steps of Task 23's "When the secret is already there", its step 1 included: the old token is deleted first. Its step 6 is the new run. **Only if a fresh token for production fails in the same way** is it the command: a project token may not be allowed to plan. Then the builder stops, with both exit codes written down. Design 6.2's first call cannot be made as written, and what replaces it is an amendment for the founder to answer. Naming the environment on the command is not that amendment: the tool's source rules it out |
| Step 2 says the plan is in a shape this workflow does not know | The token worked and the tool exited 0. There are three causes, and neither the page nor the log says which: one sentence stands for all of them. The tool wrote no plan file at all. Or with a project token it writes a plan Task 1's reader does not read: another key, another form of id. Or a line of the attributes file at the repository's root makes git call a file of the settings folder changed though its bytes are exact: the proof passes, the tool then ties its plan to the folder in another form of id, and the reader refuses that form ("Who writes step 1"). So the builder first reads whether the root attributes file changed since the last run that read a plan, and whether a line of it matches a path under `.railway/`. If so, that line is taken out in a reviewed pull request and the check is run again. Nothing is applied. The builder makes the same plan by hand as in Task 18 step 1 and compares its keys with Task 1's lists, names only. The reader is corrected in a reviewed pull request, test first, and the check is run again |
| Step 2 says Railway's own state could not be read, with an exit code | The plan was read with the same token a moment before, so the token is good, and for production. A project token is not allowed to list deployments, or not this way. The builder stops, with the exit code written down. Design 6.2's second call and 6.5's read cannot be made as written with a project token, and the amendment must say what replaces them: that is the founder's choice, not the builder's. Naming the environment on the command is not tried: the tool's source rules it out |
| Step 2 says Railway answered in a shape this workflow does not know | A project token is given a different answer from the one Task 18 saw. This is inside the design: only the verdict is printed. The builder reads the shape by hand as in Task 18 step 3, corrects `railwayBusy` in a reviewed pull request, and the check is run again |
| Step 2 says Railway is building or deploying just now | Nothing is wrong with the workflow. He waits and presses "Run workflow" again |
| Step 2 shows lines | Railway and the file differ, which nobody expects. He does not approve step 3. A person reads the lines against `.railway/railway.ts` |
| Step 2 says the change is applied by hand, with "the plan is not what the settings file declares" | The workflow's own reading of the file, made in the step before the token step, and the tool's reading of it differ. He approves nothing. The builder compares the two readings by hand as in Task 18 step 2 |
| Step 2 says the settings file is not one this workflow applies | The file was run, after his approval and with no token, and its own check refused it; the token step did not run. CI's check makes the same check on every pull request, so this is not expected. A person reads the reasons on the page against `.railway/railway.ts` |
| Step 3 waits for review although nothing is pending | A skipped job does ask. He rejects it or leaves it; it starts nothing either way. Task 25's page says so |

**What a person sees:** the first green run that read Railway from GitHub, one approval on it.

---

# Part four: pull request 3 (the folder, the pages, the rule)

### Task 25: The folder holds only what a plan reads; the pages; the rule

**Files:**
- Move: `.railway/README.md` to `docs/operations/railway-settings.md` (`git mv`), then rewrite it
- Modify: `.railway/railway.ts` (comments only: lines 9-14 no longer speak of `railway.json` as present, and
  say a setting changes by a reviewed pull request and two approvals on GitHub)
- Modify: `.github/railway-settings-check/check-workflows.mjs` and its test (`checkFolder`)
- Modify: `.github/railway-settings-check/words.test.mjs` (the test that renders the committed README reads
  it from `docs/operations/railway-settings.md`, as one more file of a made-up listing; the README is no
  longer a trusted file, and the test still holds a real page with code fences against the renderer)
- Modify: `docs/operations/railway-config-move.md` (the link at line 8; "After the move", lines 192-199)
- Modify: `docs/superpowers/specs/2026-11-22-railway-settings-apply-from-ci-design.md` (the status line only)
- Modify: `docs/engineering/README.md` (the row of Task 15), `docs/state/tasks.md`, `docs/sessions/<the day>.md`

**Interfaces:**
- Produces: `checkFolder(names: string[], ignoreText: string): string[]`. The files of `.railway/` must be
  exactly `.gitignore`, `package-lock.json`, `package.json`, `railway.ts` and `watch-patterns.json`. The
  first is the settings folder's own ignore rule (Task 12), and `ignoreText` is that file's text: it must
  be exactly the one line `node_modules/` and its line end, and nothing more. A second line could take
  the first back (`!node_modules/`), or hide a file of the folder from git and so from the proof. The
  check, run as a program, reads the folder's own entries and that file's text, and leaves out
  `node_modules`, which git ignores. It starts no process.

**The page, `docs/operations/railway-settings.md`,** in this order:

1. What the settings folder is, and the three trusted places.
2. How a setting changes now: a pull request, then the run's three steps, with design section 2's picture.
3. What each summary means, the marked lines and why they are his to judge, and what to do for each row of
   design 6.8 and for each refusal this plan adds to them: every key of Task 10's table that step 2 or
   step 3 can say has its row, in the words of Task 24's and Task 27's tables. Among them, word for word
   as Task 27 has it, the row for "master moved while this step ran": nothing was applied; "Re-run failed
   jobs" within six hours of step 2 tries again on one approval, and "Run workflow" starts afresh. (If
   Task 17 step 6 found that a re-run does not wait for a review, the page says none of this about
   re-runs, here or below: it says a red run is never re-run, as Task 19 settled it.) And
   the sentence that says, before a redeploy, that `master` moved since step 2 named a commit: it is said
   and not refused, and it names the commit that is redeployed. The row for "something it must read could
   not be read", with every cause Task 27 lists. The two sentences for a job that was cancelled or ran out
   of time, and what each leaves known: the first, that the job was stopped before the token step
   recorded anything, with the run's page showing whether that step had begun; the second, an apply that
   was made and a redeploy this run did not confirm, in a run that still counts when its step "Nothing
   is left to change" shows as succeeded. And the case with no sentence of step 3 at all: a job cancelled
   or out of time before its proof and its runtime's install had both passed, in which nothing was
   applied. **The two
   ways out of the refusal that a change empties a setting** (Task 2): when the file stopped naming a
   setting that Railway still holds at a value of its own, the refusal comes back on every later change
   to the same group of settings, for as long as Railway holds it. Naming the setting in the file again,
   at the value Railway holds, ends it. So does clearing it on Railway by hand, with his yes. For the
   region map only the first works: Railway holds a map for every running service. Why step 1 shows every file in full, and step 2 shows `(hidden)` for old values, until this
   workflow has applied a change: only such a run counts as the last change applied, and a run that found
   Railway up to date does not. Who writes step 1's page: the code of the last change applied, or the base
   code the workflow file names, never the run's own copy of the files; that nothing of a commit is run
   before the first approval, and the settings file is first run in step 2; what the page can vouch for
   and what it cannot; how the base is moved, by a reviewed pull request that changes the workflow file
   alone, when the older code cannot show newer files; and that a change to step 1's own code does not
   change step 1 until a run that holds it has applied, or the base is moved. What "a trusted file on the
   runner is not the file git holds" means, and that the cure is to take the attributes line out. **What
   "Re-run failed jobs" does, in its two cases.** After a run whose step "Nothing is left to change"
   succeeded, a re-run applies nothing and the run goes on counting; it is never needed. After any other
   red run, a re-run of the apply job within six hours of step 2 is a real second approval: it makes
   every check again and applies if they pass. He approves it only as he would approve a new run, or
   rejects it and presses "Run workflow". **What moves the last change applied, and what does not.** Only
   a run of this workflow that applies. A change made by hand on Railway leaves it where it was: old
   values may then read "Railway holds something else", and step 2 may say that the file changed and the
   plan shows nothing, until the next change is applied from GitHub.
4. What is still applied by hand, and how (the old README's "Install the kit", "Preview" and "Apply", kept).
5. Who may approve. Only the founder approves a `railway-settings` review, and only he changes that
   environment. His yes in a chat lets nothing else approve: the approval is his own, on GitHub's review
   page. GitHub cannot tell an approval made under his sign-in from his own, so until the lock of design
   section 11 this rule is the only control (design 6.10).
6. The set-up as it was done, with its days and no secret, and his two standing checks: the bypass box is
   empty; the repository's own secrets hold nothing named `RAILWAY_SETTINGS_TOKEN` or `RAILWAY_TOKEN`. When a
   run cannot see the bypass answer, his look is the only check of it.
7. Replacing the token, every 90 days and at once after anything goes wrong with a runner or a log. The
   page repeats the six steps of Task 23's "When the secret is already there", in their order and with
   their stop, and gives no order of its own. The old token is deleted first in two cases only: when it
   may have leaked, which is item 8's own first step, and when it has failed. Then the row of the stored
   secret is opened and its buttons read before any new token exists; the words GitHub's form showed at
   the first replacement are written here; the new token is made, pasted over the old secret and saved;
   the old token is deleted, if it was not already; the two checks of item 6 are made again; and only
   then "Run workflow" checks the new token. That is the design's order (its section 8), also for a
   replacement made at once because something went wrong with a runner or a log and nothing shows that
   the token itself was shown. The page gives the day the next one is due. It also repeats where Task 23
   is done: on his phone, or at a computer with no agent
   session running on it; clipboard sharing between devices off, or the clipboard and its history cleared
   on every device that shares it; the token goes into GitHub's one field and nowhere else; and he reads
   on Railway that the token is for production.
8. If the token may have leaked, in this order: delete the token on Railway; read Railway's record of
   activity for the project; remove any deployment, service, domain or volume nobody recognises; redeploy
   `master`; rotate production's secrets. The database's connection string is also held by GitHub, as the
   secret `DATABASE_URL`, in two places: the repository's secrets and the `Production` environment's. Both
   are replaced.
9. What the workflow does not check: drift between runs (design 6.9); the gate's rules between runs (design
   6.1); staged changes on Railway's dashboard, which it never reads, and what an apply does to them, which
   nobody has proven, so his look before the second approval is the only check; the meaning of a change
   (design 6.3); and a move of the one replica to another region, which Railway's tool at this version
   does not put in a plan at all, as Task 18 step 4 found. **When step 2 says that the file changed and
   Railway's plan shows nothing,** there are four causes, and three need nothing done: a change made by
   hand since the last change applied (nothing: Railway already holds it); an apply that Railway took in
   a run that did not count, because it did not finish or the job was cut short (nothing, once the
   dashboard shows it); a setting at the tool's own default that the file newly names or no longer names
   (nothing: it is the same setting either way); and the move of the one replica to another region, which
   alone must be made by hand, on Railway's dashboard, with his yes. The sentence comes back on every run
   until a change is applied from GitHub. If Task 17 found
   that GitHub records no approval for these jobs, also this: no run ever counts as the last change
   applied, so step 1 always shows every file in full and old values always read `(hidden)`. And whatever
   Task 17 step 5 found the phone cannot do. And one thing that must be changed in the code first: a
   `waiting` job of a migration workflow is read as waiting for a review, which holds only while none of
   their environments has a wait timer (Task 7).
10. The watch list; variables.

- [ ] **Step 1: Write the failing test.**

```js
const FIVE = ['.gitignore', 'package-lock.json', 'package.json', 'railway.ts', 'watch-patterns.json'];
const ONE_LINE = 'node_modules/\n';

test('the settings folder holds only what a plan reads', () => {
  assert.deepEqual(checkFolder(FIVE, ONE_LINE), []);
  assert.notDeepEqual(checkFolder(['README.md', ...FIVE], ONE_LINE), []);
  assert.notDeepEqual(checkFolder(FIVE.filter((name) => name !== 'package-lock.json'), ONE_LINE), []);
  assert.notDeepEqual(checkFolder(FIVE.filter((name) => name !== '.gitignore'), ONE_LINE), []);   // without it the root's ignore file would decide
});
test('the settings folder\'s ignore file is its one line and nothing more', () => {
  for (const text of ['', 'node_modules\n', 'node_modules/\n!node_modules/\n', 'node_modules/\nrailway.ts\n',
    '# a note\nnode_modules/\n', 'node_modules/\r\n', 'node_modules/']) {
    assert.notDeepEqual(checkFolder(FIVE, text), [], JSON.stringify(text));
  }
});
```

- [ ] **Step 2: Run it and the check to see them fail.** Expected: the test fails (no `checkFolder`); after it
  is written, `node .github/railway-settings-check/check-workflows.mjs` fails on `.railway/README.md` until
  the move.
- [ ] **Step 3: Move and rewrite the page; edit the comments and the other pages.** Check every relative link
  in the changed pages opens a file that exists. Check the page against items 1 to 10, one by one.
- [ ] **Step 4: Prove the comment edit changes no setting.**

Run: `node -e "import('./.github/railway-settings/tool.mjs').then(async (m) => console.log(JSON.stringify(await m.evaluateSettings('.railway/railway.ts'))))"`
before and after the edit, and compare the two outputs. Expected: identical.

- [ ] **Step 5: Run every test, the check, and the four checks of Task 15 step 1.** Expected: PASS;
  `No watched path is touched.`
- [ ] **Step 6: Commit,** naming the files, with the message
  `docs(railway): settings are applied from GitHub on the founder's approval (T-751)`.
- [ ] **Step 7: Send it to the release lead.** It carries: the run of Task 24; the output of step 4; that it
  touches no watched path; and that its merge will start one run of "Railway settings", which is Task 26.

**What a person sees:** one page that says how a setting changes now, and a settings folder with five files.

### Task 26 (the founder taps once; a person watches): the run that pull request 3's merge starts

- [ ] **Step 1: Merge pull request 3.** A run of "Railway settings" starts by itself, because the merge
  changes `.railway/`.
  **What the founder should see:** step 1's summary names the pull request and, as no run has applied a
  change yet, shows every file of the trusted places in full: `.railway/` now holds five files and no
  README.
- [ ] **Step 2: He approves step 2.** Expected: "Already up to date." and whether Railway is busy. Step 3 is
  skipped.
- [ ] **Step 3: The builder reads the run** with the two commands of Task 24, step 2. Expected: the same.

**If step 2 shows lines:** a comment-only change produced a plan, which step 4 of Task 25 says cannot be. He
does not approve step 3. A person compares the lines with the file.

**If step 1 refuses:** the rows of Task 17 step 1. The likeliest here is "This run is not for master's
trusted places as they are now": another merge changed a trusted place first, and the newer run is the one
to approve. He approves nothing on a run whose first step refused; the other two jobs are skipped anyway.

**What a person sees:** a merged pull request, then one run with one approval, ending green.

### Task 27 (a person watches): the first real settings change

Design section 9: the first real settings change is watched to the end by a person. This task has no date:
it is done when someone's pull request first changes a setting in `.railway/railway.ts`. Until then the
apply itself has run only against the fakes of Task 9, and what a project token may do with an apply is not
yet seen (design section 9). Both reads it leans on, the plan and Railway's own state, have been made with
the token on every run since Task 24.

This is also the first run that can count as a change applied. So on this run step 1 still shows every file
in full, written by the base code, and step 2's lines show `(hidden)` where an old value would be. From the
next run on, step 1 is written by this run's code, shows the lines that changed since this run, and old
values are shown again.

- [ ] **Step 1: Before the first approval,** a person reads the pull request's diff beside step 1's summary:
  the settings file shown in full must be the merged one, and nothing else in the trusted places may differ
  from what `master` held before the pull request. If step 1 refuses, the rows of Task 17 step 1 apply and
  nothing is approved.
- [ ] **Step 2: Before the second approval,** the founder reads step 2's lines, judges any marked line, reads
  whether Railway is busy just now, and looks at Railway's dashboard for staged changes. If Railway is busy
  he waits. No Deploy run is approved until step 3 has finished.
- [ ] **Step 3: A person watches step 3 to its end:** "Applied. Nothing is left to change.", then "Railway
  reports the new deployment live at commit ...".
- [ ] **Step 4: Run the production receipt on that commit** (`production-receipt.yml`, with `sha` set to the
  commit step 3 named). Expected: green.
- [ ] **Step 5: Record in the session log** what was seen, and anything the lines or the wait got wrong. This
  is also the second sighting of Task 6's record, the first made by this workflow.
- [ ] **Step 6: Read that the run now counts.** Press "Run workflow" once more, or wait for the next run.
  Its first step must say "This workflow last applied a change at commit ..." and name this run, and that
  the page was written by the code of that commit, which an earlier run applied. If it shows the files in
  full again, the page's own sentence says where to look first:
  - it says the history could not be read in full: read the gate step's log for the read that failed, and
    run again. If no read failed, read this run's review history as Task 17 step 3 does: an empty list
    means GitHub kept no record of the approvals, which is the case Task 17 names, and there is nothing to
    mend;
  - it says no earlier run applied a change: this run did not count. Read its jobs, with every attempt,
    and its review history. Either the step named `Nothing is left to change` succeeded in no attempt (the
    closing plan was not empty, so the apply left something over: a person looks at Railway), or the
    review history holds reviews and none is an approval by the owner for `railway-settings`.
  Three things are not causes, and are not to be looked for: a job that failed only because the redeploy
  was not confirmed; a job that was cancelled, or ran out of time, while it waited for the redeploy; and
  "Re-run failed jobs" pressed afterwards. A run that applied counts in all three (Task 5, condition 7).

| If instead | Then |
|---|---|
| Step 3 says a deploy or a migration is under way | Railway became busy between the two approvals, or a Deploy job started. Nothing was applied. Start a new run later |
| Step 3 says something it must read could not be read | Nothing was applied. One sentence stands for every cause, and the page does not say which. Step 2 made the same read of Railway minutes earlier, so look first at the reads of GitHub: its answer about executing jobs, the public version probe, and `master`'s head, any of them failed or slower than thirty seconds. Then at the commits the step was handed: the head its own currency check wrote down, and the head step 2 named, either one missing or not a commit. Then at three things that are not failed reads and are said in the same words: the look was more than two minutes old at the apply even after it had been made again, because its own reads were slow; the plan file on the runner was no longer the text that had been judged; or a head that moved between the approvals could not be written to the log. Start a new run in every case |
| Step 3 says the apply failed, with an exit code | This is the first apply a project token has made. Nothing is known to be applied. He presses "Run workflow": step 2 then shows what Railway holds. If the lines are still there, the token may not be allowed to apply; that goes to the release lead and the founder, and the change is applied by hand |
| Step 3 says applied, but something still differs | The apply ran and its closing plan was not empty. The job still waits for the redeploy, and its last step says what became of it. A person reads step 2 of a new run to see what is left |
| Step 3 says the redeploy is not confirmed | The apply succeeded, and the run still counts as the last change applied. A person reads Railway's own page for the deployment, and the session log records why no record counted: `master` moved in those seconds, or Railway posted none. If Railway posted none, this is the case Task 6's note names: the fallback's counting rule (Task 7) is then built, in a reviewed pull request |
| Step 3 says master moved while this step ran | A merge landed while the apply job ran, between its currency check and its last read of the head. Nothing was applied: an apply would have made Railway deploy a commit the look had not judged. The cheapest way on is GitHub's "Re-run failed jobs": within six hours of step 2 it runs the apply job again on one approval of its own, with every check made anew, and it applies if the trusted places are still `master`'s. Task 17 step 6 proved, before any token existed, that such a new attempt waits for that approval; had it not, this row and the sentence would say "Run workflow" alone (Task 19). If the merge changed a trusted place, its own run is the one to approve. "Run workflow" starts afresh |
| Step 3 says, before the redeploy, that master moved since step 2 named a commit | A merge landed between the two approvals. Nothing is wrong and nothing was refused: step 3 judged the newer head by its own look, and the apply redeploys `master`'s head, which is the commit the sentence names. He reads which commit that is |
| The last step says the job was cancelled or ran out of time, and that whether Railway took the apply is not known | The job was stopped before the token step recorded anything: before that step began, or in the middle of it. The sentence is the same for both, and warns of the worse. The run's page tells them apart. With the step "Plan again, look, apply, plan again, with the token" shown as not run, nothing was applied. With it shown as cancelled, whether Railway took the apply is not known. Either way he presses "Run workflow": step 2 shows what Railway holds. If Railway did take the apply, this run does not count as the last change applied, and step 2 may say that the file changed and the plan shows nothing: the second cause in the last row |
| The last step says the job was cancelled or ran out of time while it waited for the redeploy | The apply was made, and the sentence above this one says how it ended. Only the wait was stopped. When that sentence says the change was applied, and the run's page shows the step "Nothing is left to change" as succeeded, the run counts as the last change applied although GitHub shows the job as cancelled (Task 5, condition 7). If the sentence says the change was applied and that step shows as not run, the cancel fell in the moment between the two steps: the change is on Railway and the run does not count, which is the second cause in the last row. After any other sentence (something still differs, or the apply did not finish) that step is left out by its own condition, the run does not count, and that sentence's own row says what to do. The redeploy is not confirmed by this run in any of these: a person reads Railway's own page for the deployment |
| The apply job is shown as cancelled and its page holds no sentence of step 3 at all | There are two cases, and the run's page shows which by the step the job reached. **The job was cancelled, or ran out of time, before its proof and its runtime's install had both succeeded.** The last step is then left out on purpose: it would have to start a file of a checkout that was not proven (Task 11, rule 14). Nothing was applied, because the token step comes after both. This case is certain, and Task 25's page names it. **Or the job was stopped later, and GitHub ended it before its last step ran:** only if Task 13 found that this can happen, and Task 25's page then says so. That one is read as the first of the two rows above: the token step's own state on the run's page says whether anything could have been applied, and "Run workflow" shows what Railway holds. (A job whose proof refused holds no sentence of step 3 either. It holds the proof's own, and the rows of Task 17 step 1 apply) |
| Step 3 says the apply did not finish | The tool was stopped at its limit or ended with no code, and the plan read afterwards was not empty or could not be read. The job still waits for the redeploy, and its last step says what became of it. A person presses "Run workflow": step 2 shows what Railway holds now |
| The last step says the job ended without a record of what it did | A step failed before the token step had written its outcome. Either the token step itself, named "Plan again, look, apply, plan again, with the token", stopped on an error of its own; or a step before it failed (the second gate read, the kit, the tool, or the reading of the file), and then the token step never ran and nothing was applied. The run's page shows which step is red. A person reads that step's log, and presses "Run workflow" to see what Railway holds |
| The run ended red after its step "Nothing is left to change" had succeeded, and someone pressed GitHub's "Re-run failed jobs" | Nothing is lost and nothing is applied twice. The new attempt asks for a review; approved, it finds Railway up to date, or its plan more than six hours old, and applies nothing. The run still counts as the last change applied, by its first attempt. It need not be done: "Run workflow" starts a clean run that shows what Railway holds |
| Any other red run, and someone pressed "Re-run failed jobs" | **This re-run can apply.** After a refusal, a failed apply or a job cut short, nothing was applied, or nobody knows. The new attempt of the apply job asks for a review (Task 17 step 6 proved that it waits for one), makes every check again, and within six hours of step 2 applies the plan if they pass. So its review is a real second approval: he approves it only as he would approve a new run, having read step 2's lines again, or he rejects it and presses "Run workflow" |
| Step 2 says Railway's plan shows no change though the file's declaration changed | Four causes, and the sentence names none. A change made by hand since the last change applied: nothing to do. An apply Railway took in a run that did not count, because it did not finish or was cut short: nothing to do once the dashboard shows the setting. A setting at the tool's own default that the file newly names or no longer names: nothing to do. A move of the one replica to another region (Task 18 step 4): this one is made on Railway's dashboard, by hand, with his yes. He compares the dashboard with the file to tell which. The sentence comes back on every run until a change is applied from GitHub |

**What a person sees:** the changed setting live in production, a green run with two approvals, and a green
receipt.

---

## What this plan could not verify, and where it is handled

| Not verified | Handled in |
|---|---|
| That the pinned runtime and the tool install and run on the `ubuntu-24.04` runner | Task 13 |
| That checkouts can sit side by side in one job, each held to its folders, and that git in one of them can show what changed since an older commit with no saved credentials | Task 13; if they cannot sit side by side, stop: "Who writes step 1" cannot be built as written |
| That the settings file and the kit evaluate with Node's permission flags set, on the runner. It was tried on one computer with Node 22, not on Linux | Task 13. The flags are a seat belt and nothing rests on them, so if the kit needs one more read they are widened by that path, and if it cannot be done they are dropped |
| That `exact.sh`'s proof refuses every way an attributes file can make git rewrite a file. Three ways are tested (line ends, an expanded keyword, another encoding), and the proof does not go by ways: it compares bytes | Task 12's test; Task 13 on the runner. A way nobody thought of changes bytes too, or changes nothing |
| That git on the runner still calls the settings folder unchanged once the kit is installed in it, in a sparse checkout. Railway's tool asks git exactly that (read from its public source), and writes another kind of id when the answer is no | Task 13, with no token. If not: find the ignore rule; no flag is added to the tool's commands |
| That a run's own token can read an environment at all, and with which read-only permissions | Task 13; if none does, stop: design 6.1 cannot be built as written |
| That a run's own token can read an environment's branch rules. No environment of the repository has a custom rule yet, so every such read answers `404` today | Task 17 step 1, against `railway-settings` itself, with a named fix; a stop only if no read-only set works |
| Whether a run's own token sees the bypass answer | Task 13; if not, design 6.1's own special case |
| That a job which never starts does not create its environment | Task 13; if false, Task 16 moves before pull request 1's merge |
| That two jobs in one environment each ask for an approval, with `deployment: false` | Task 17; if false, stop for a design amendment |
| That GitHub records a run's approvals in its review history when the job makes no deployment record | Task 17 step 3. If not, nothing is changed and nothing is built: no run ever counts, every file is shown in full for good, and from the first applied change on the page says the history could not be read. The gate of pull request 1 answers so by itself. Changing that is the founder's choice, by a design amendment |
| That a run from another branch is refused by the environment itself, and that the branch rule still holds with `deployment: false`. GitHub's page implies it and its table of rules has no row for it | Task 17 step 4, from a throwaway branch, before any token exists; if not, no token is stored and the plan stops for a design amendment |
| What GitHub's phone app shows | Task 17 step 5; if lacking, the phone's browser; if that lacks it too, a computer with no agent session, as the last stop |
| GitHub's exact words for its buttons. They are written from what its pages said when this plan was written, and were not read again from the pages | Tasks 16, 17 and 23: if a button reads otherwise he says so, and the list is corrected before anything is pressed |
| That a long step under `!cancelled()` is stopped when its job is cancelled or runs out of time, and that a last step under `always()` then runs and is told so | Task 13, in the job `cut-short`, of one minute, and in the job `cancelled-by-hand`. If the long step is not stopped at a time-out, job `apply`'s limit is raised so the last step always gets its turn, and the release lead is told. If it is not stopped by a person's Cancel: stop, and Task 21 is not built on it. If the last step does not run, the page and Task 27's row say that such a job may end with no sentence |
| That a step whose condition names the proof's success is held back when the proof failed, under `always()` too | Task 13's job `proof-refused`. If not: stop. No token is stored until another guard is agreed |
| That a re-run of an approved job waits for a review of its own. GitHub's page on re-running jobs implies it and does not say it for a protected environment. **If it were false it would fail open:** a re-run of a red apply job would apply on no approval of its own | Task 17 step 6, on the rehearsal run, before any token exists. If it does not wait: no token is stored until the release lead has answered, and every mention of a re-run as a way on is taken out (Task 19) |
| That such a re-run is handed the first attempt's step 2: its lines, its time and the head it named | Not proven before a token exists: it is GitHub's own page on re-running jobs. If it is handed nothing, step 3 refuses before any call to Railway: a time that is no number, or a head that is no commit (Task 9, steps 1 and 2) |
| GitHub's words for the form that replaces a stored secret. They were not read at all | Task 23's "When the secret is already there": he reads them before any new token exists, and stops if no button replaces the value |
| That npm, told `--globalconfig` and `--userconfig`, reads no settings file in the kit's folder or the home folder | Task 3's test, with the real npm of the Node that runs the tests, on the builder's computer and in CI. It is not run with the pinned runtime's own npm, which is first started in Task 13. Rule 27 forbids such a file under the settings folder in any case |
| That GitHub's summary page shows `<pre>` and `<details>` as Task 10 expects, and the size it allows one step | Task 17 step 1, on the real page. `marked` in Task 10's test is a second opinion and not GitHub's renderer |
| How the tool writes a detail for replicas, for a value that is its default, and for a cleared setting. Read from the tool's public source at its tag; one real plan was seen | Task 1's fixtures and reader follow the source. A detail in any other shape is refused |
| That a move of the one replica to another region gives no plan at all, and that a rise from one replica is written with `null` for its old side. Both are read from the tool's source | Task 18 step 4, by two read-only plans made by hand. Until then Task 1 follows the source, and step 2 says so when a file changed and the plan shows nothing |
| That the tool can plan from a file evaluated beforehand | Task 18 step 2; if not, design 6.2 as written |
| What an entry of `railway deployment list --json` holds beyond the four keys its source names, and whether `meta` carries the commit | Task 18 step 3, then Task 19. It matters only if the fallback is ever needed |
| What a project token may do with an apply, and what the apply returns | Not before Task 27, which is watched. A failed apply ends with a fixed sentence and its exit code, and nothing it wrote |
| What a present bypass answer of `null` would mean for a run's token | Task 13 tells it apart from a missing one; if that is what a run is given, stop |
| Whether the tool can see staged changes, and what an apply does to them | Not read and not proven by this plan: nothing is staged on production for a test. Held by a rule printed before every second approval |
| That the tool plans with only a project token | Task 24. A fix that changes a command is a design amendment, and the plan stops for it |
| That a project token can list deployments, and in the shape Task 18 saw | Task 24: step 2 makes that read on every run, a check included, so it is proven with nothing at stake. A change of shape is a reviewed fix; a change of command or of what is read is a design amendment |
| The shape of a plan that removes, empties or adds something. One real plan was seen, and it held updates only. The keys of the four other kinds of change are read from the tool's public source at its tag, not from a plan | Task 1 holds each kind to those keys, and Task 2 refuses each by its reasons: applied by hand. A plan in any other shape is not read, and step 2 says so in a sentence that also says applied by hand. If the source was read wrongly, Task 24's row for a shape nobody knows is where it shows, with nothing applied |
| That Railway posts a record for every redeploy an apply starts, for `master`'s head | Seen once (Task 6). Task 27 is the second sighting; without a counted record the run fails as not confirmed, and the fallback's counting rule is built only then |
