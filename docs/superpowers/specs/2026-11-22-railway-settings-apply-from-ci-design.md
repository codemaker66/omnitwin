# Railway settings: applied from GitHub, on Blake's tap

Design, 22 November 2026. Revised the same day after an independent check of its
facts and its holes; section 13 lists what that check changed. Ledger row T-745.

Status: **draft. Not yet approved; nothing is built.** Until this is approved,
built and reviewed, the rule stays as it is: a reviewed pull request to
`.railway/railway.ts`, then an apply by hand with Blake's yes at that moment
([the Railway config move](../../operations/railway-config-move.md)).

## 1. What this is for

The API's deploy settings live in `.railway/railway.ts` and in Railway's own
stored copy. Railway does not read the file when it deploys. A change to the file
takes effect only when someone runs `railway config apply`. On 22 November that
was done by hand, from one computer, after Blake's yes.

Blake decided that day that settings changes should be applied from GitHub, with
a stored Railway token, and that his own approval on GitHub stands between a
merged change and production. It is faster, nobody needs to be at that computer,
and nothing changes production's settings without him.

## 2. What Blake sees

A settings change is a pull request, reviewed and merged like any other. Then:

```
GitHub > Actions > "Railway settings" > the run for that merge

  1. Check the gate, show the change     Done. No tap needed.
  2. Read Railway's plan                 Waiting for review    [Review deployments]
  3. Apply this plan                     (not started)
```

1. **No tap.** The first step holds no token. Its summary shows the commit and
   its pull request, what changed in the settings folder and in this workflow
   since the last change that was applied, and the versions of Railway's tool
   and kit. This is what the first tap trusts.
2. **First tap.** The second step reads Railway and writes the plan in plain
   lines: `deploy.healthcheckTimeout: 2700 -> 3000`. It says: "Applying this
   redeploys the API at commit abc1234, with its migration step." If nothing
   would change, it says "already up to date" and the run ends.
3. **Second tap.** The third step applies exactly those lines, checks that
   nothing is left to change, and waits for Railway's own report that the new
   deployment is live. A deployment that fails can take about an hour to say so.

If the plan would remove or empty anything, the third step refuses and says the
change must be applied by hand. If he does nothing, nothing happens: a waiting
run changes nothing and GitHub fails it by itself after 30 days.

A **check now** button starts the same run by hand. It shows whether Railway and
the file agree. If they do not, the second tap brings Railway back to the file.

He opens the run's page to read the summaries; the review box itself does not
show them.

## 3. Goals, non-goals, anti-goals

**Goals**

- A merged settings change reaches production with two taps and no computer.
- The token is released only after an approval, only to a run on `master`.
- What is applied is what he read.
- Nothing private appears in this public repository's logs, summaries or files.

**Non-goals**

- No change to how the API itself is deployed. The Deploy workflow is untouched.
- No management of Railway variables. They stay unmanaged.
- No unattended check for drift (6.9).
- No deletion, and no change to anything but one service's build and deploy
  settings, from GitHub. Those stay by hand.

**Anti-goals: it has failed if any of these can happen**

- A branch, or a workflow that is not on `master`, can read the token.
- An apply runs that was not approved, or applies something other than the lines
  he read.
- Anything is removed or emptied without a person at a keyboard and his yes.
- A Railway id, a variable name or the token is printed where the public can read it.

**What this does not protect against, said plainly**

- **An approval trusts the commit.** Both tapped steps hold the token, and both
  run the settings file, which is code, with Railway's kit and tool. `master`
  asks for a pull request and passing checks but for no approving review. So
  what protects the token is what can be merged, plus his look at step 1 before
  the first tap.
- **The approval is as strong as the sign-in that gives it.** Anything signed in
  to GitHub as the repository's owner can approve a run and can change the
  environment's rules. Automated tools that work under the owner's sign-in are
  therefore held by a rule, not by GitHub (6.10, and decision 1 in section 11).
- **What a leaked token would cost.** Railway describes a project token as scoped
  to one environment, best for "Deployments, service-specific automation". It
  describes no read-only kind and no way to narrow one, and does not say whether
  it can read the environment's variables. So a leak is treated as a leak of
  everything in production's environment: the token is revoked and production's
  secrets are rotated.

## 4. Facts this rests on

Each was checked against the source named, on 22 November 2026, unless marked.

**Railway** (its Infrastructure as Code guide, its CLI page and its API page)

- A project token is scoped to one environment. The tool uses it when
  `RAILWAY_TOKEN` is set. The same token plans and applies.
- `railway config plan --out <file>` pins the change set, the environment's
  state and the committed `.railway/` folder. `railway config apply --plan <file>
  --yes` applies that, and fails if the environment changed or the checked-out
  folder is not the planned one.
- Run non-interactively, the tool refuses "destructive" changes without
  `--confirm-destructive`. The guide's examples are deleting a service or a
  variable. It does not say whether emptying a setting or removing a domain counts.
- `railway config plan --detailed-exit-code` exits 0 when nothing would change
  and 2 when changes are pending.
- Seen on 22 November: the pinned plan lists each change with the setting it
  touches, a kind, a severity, whether it deploys, and the value before and
  after; it also holds Railway's id for the environment. The tool's `--json`
  output holds the names of the variables on Railway. The plan's lines for an
  unchanged difference were the same on five days running.
- Seen on 22 November: an apply that changes a build or deploy setting makes
  Railway deploy `master`'s head, with its migration step.

**GitHub** (its documentation and its public API)

- An environment's secret reaches a job only after a required reviewer approves
  that job. It reaches any job, in any workflow file, that names the environment
  and passes its rules.
- A repository secret reaches workflows run for pull requests from branches of
  the same repository, and the workflow that runs is the pull request's own.
- An environment can be limited to chosen branches. By default administrators
  may bypass its rules; that can be switched off. Only the repository's owner
  can configure an environment here.
- Anyone with read access can read an environment's rules through the API:
  reviewers, self-review, branch rule, bypass.
- A workflow that names an environment which does not exist makes GitHub create
  it, with no rules.
- Logs, job summaries and artifacts of a public repository can be read by anyone
  with a GitHub account.
- A manual run can be started against any branch, and then that branch's copy of
  the workflow file is what runs.
- A job can be run again for up to 30 days, keeping earlier jobs' outputs.
- A run that waits for a reviewer holds its concurrency group.

**This repository**

- `master`'s rules: a pull request, six status checks, no approving review.
- The Deploy workflow's migration job waits on the `Production` environment and
  runs migrations; so does Railway's pre-deploy step on every deploy. The Deploy
  workflow's approvals are being given again as of 22 November.
- `.railway/**` and `.github/workflows/**` are not watched paths.
- The kit is pinned to one exact version by `.railway/package-lock.json`: three
  packages, each with an integrity hash, none with an install script.
- The production receipt workflow already reads the deployment records Railway
  posts to GitHub, and works out whether the running build is current.

## 5. Approaches considered

1. **His approval on GitHub (chosen).** The token sits behind a protected
   environment. Two taps. No branch can reach the token.
2. **Apply on merge, no approval.** Fastest, and an unattended nightly check
   becomes possible. But a wrong merge changes production with no pause.
3. **Railway's ready-made action.** It comments the plan on every pull request
   and applies on merge. Least to build. But it needs the token as a repository
   secret, readable from any branch because the settings file is code that runs
   with it, and its recipe passes `--confirm-destructive`.

Blake chose the first. The second and third each allow something section 3 calls
a failure.

## 6. The design

### 6.1 The gate

A new GitHub environment, `railway-settings`, with four rules:

- one required reviewer, Blake;
- "prevent self-review" off, or he could not approve a run he started;
- deployment branches: `master` only;
- administrators may not bypass.

It holds one secret, `RAILWAY_SETTINGS_TOKEN`: a Railway project token for the
production environment. The name is deliberately not `RAILWAY_TOKEN`, the name
Railway's guide suggests for a repository secret, so that following the guide by
mistake cannot create a secret every branch can read.

It is a new environment, not the existing `Production` one: a Deploy job must
not be able to read the Railway token, and each approval should say what it is
for.

GitHub enforces the reviewer and the branch rule. The workflow reads all four
rules back at the start of every run and refuses to go on if any differs.

### 6.2 The workflow

One new file, `.github/workflows/railway-settings.yml`. It starts on a push to
`master` that changes anything in `.railway/`, and by hand. Nothing else starts
it. The run's name carries the commit and its pull request.

So that the trigger, the refusals and Railway's pin all mean the same folder,
`.railway/` holds only what a plan reads. Its README moves to `docs/operations/`.

**Step 1, "Check the gate, show the change".** No environment, no secret.

- Reads the environment's four rules through GitHub's API. Refuses unless all
  four are as 6.1, before any later job can name the environment.
- Refuses unless the run is on `master` and its `.railway/` folder is the one at
  `master`'s head now.
- Writes the summary described in section 2.

**Step 2, "Read Railway's plan".** In the environment.

- Checks out the commit. Installs the kit with `npm ci --ignore-scripts` and
  Railway's tool at one exact version, verified. The token is not yet present.
- One step, and only that step, receives the token and runs
  `railway config plan --out <file>`. The file stays on the runner.
- A later step, without the token, renders the plan's lines (6.4), works out
  whether step 3 would refuse (6.3), and writes the summary.
- Passes on: the lines, the time, and whether changes are pending.

**Step 3, "Apply this plan".** In the environment, only when changes are pending.

- Repeats step 1's refusals. Refuses if step 2 ran more than six hours ago.
- Plans again to a pinned file, renders its own lines, and refuses unless they
  equal step 2's. It works out every refusal of 6.3 itself.
- Looks for other deploys and migrations (6.5).
- Runs `railway config apply --plan <file> --yes`.
- Runs `railway config plan --detailed-exit-code`. It must exit 0.
- Checks `master`'s head again and says so if it moved.
- Waits for the redeploy (6.6) and writes the result.

**In the tapped jobs:** read-only permissions; no action other than a checkout
pinned to a commit; no cache; no artifact. The tool is called from one place.
**Never:** `--confirm-destructive`, `--show-values`, `--decrypt-variables`,
`--include-variables`, the tool's own output in a log.

### 6.3 What step 3 refuses

Beside Railway's own refusal of "destructive" changes, the workflow has its own
rule, and applies only a plan in which every change:

- is an update to the build or deploy settings of the one service the file
  declares, and
- is marked safe and not destructive by Railway, and
- leaves no stored value empty, and
- does not lower the number of domains, replicas or resources.

Anything else is refused with one sentence: this change is applied by hand.
That includes a new service, a domain, a change of source, and anything under
variables.

### 6.4 What is printed

- The tool's own output never reaches the log. It goes to files on the runner.
  A failure prints a fixed sentence and the exit code.
- The lines are built by the workflow from the plan's list of changes: the
  setting's name and its new value, which the public file already shows.
- The old value is shown only when it equals what the file declared at the last
  change applied. Otherwise the line says Railway holds something else, and
  does not show it.
- Nothing under variables is rendered. Ids read from the plan are masked.

### 6.5 Beside other deploys and migrations

An apply redeploys the API with its migration step. Just before applying, step 3
looks, and refuses if:

- a job of the Deploy workflow, or of another workflow that runs migrations, is
  executing (a run that only waits for review does not count);
- Railway is building or deploying (read with the token; only the verdict is
  printed);
- the running build does not already contain `master`'s API code, worked out as
  the production receipt does. An apply would then ship undeployed changes and
  their migrations under a settings approval.

This is a look, not a lock. Step 2's summary says: do not approve a Deploy run
until step 3 has finished. Blake gives both approvals. The Deploy workflow is not
changed, and this workflow has no workflow-wide concurrency group, so a run that
waits for him blocks nothing.

### 6.6 Knowing the redeploy worked

The public probes cannot tell: while a new deployment builds, and after it
fails, the previous one keeps answering. Step 3 waits for the deployment record
Railway posts to GitHub for that commit, newer than the apply, as the production
receipt reads it. It allows for the pre-deploy step's 900 seconds and the health
check's 2700. If no record appears, it says the apply succeeded and the redeploy
is not confirmed.

### 6.7 A check in CI

A step in CI's tooling job reads every workflow file and fails unless:

- the environment `railway-settings` is named in this one file only, and no
  environment name anywhere is built from an expression;
- this workflow starts only on a push to `master` and by hand;
- Railway's tool is called only with the exact commands of 6.2;
- `.railway/railway.ts` still leaves variables unmanaged.

It catches mistakes. It is not a lock: see section 3.

### 6.8 When something goes wrong

| What happens | What the workflow does | Production |
|---|---|---|
| The environment's rules are not as 6.1 | Step 1 refuses | Unchanged |
| The plan cannot be read | Step 2 fails with a fixed sentence | Unchanged |
| The plan removes, empties or adds something | Step 3 refuses: by hand | Unchanged |
| Railway changed between the two taps | Step 3 refuses: the lines differ | Unchanged. Run again |
| A newer settings change merged meanwhile | The older run refuses | Unchanged. Approve the newer run |
| A deploy or migration is under way | Step 3 refuses | Unchanged. Run again later |
| The apply fails | Step 3 fails | "Check now" shows what Railway holds |
| The apply works, the redeploy fails | Step 3 fails and says so | The previous deployment keeps serving |
| The second plan is not empty | Step 3 fails | Applied; something still differs. A person looks |

To undo a setting: a pull request that reverts the file, then the same two taps.

### 6.9 The limit on checking for drift

Planning needs the token, and the token needs an approval. So nothing checks,
unattended, that Railway's stored settings still match the file. Every apply
ends with an empty plan, and "check now" answers on one tap.

### 6.10 Who may approve

Only Blake approves, and only Blake changes the environment. For anything else
working under the owner's sign-in this is a rule: never approve a
`railway-settings` review, never change that environment, ask him instead.
GitHub cannot enforce it while such tools share his sign-in. Decision 1 in
section 11 is about that.

## 7. The hand-run slot's guards

| Guard on 22 November | Here |
|---|---|
| A pinned plan, applied as read | Kept: step 3 pins its own plan and its lines must equal step 2's |
| No deletion | Kept, and wider (6.3) |
| A second plan that must be empty | Kept |
| A hold on merges | Replaced: the folder must be `master`'s head before, and is checked after |
| Not beside a migration, not while a deploy runs | Replaced by the look in 6.5 |
| A person watching the migration step | Replaced by 6.6; the first real change is still watched |
| A look at Railway's dashboard for pending staged changes | Not kept by the workflow. Railway's tool does not show them. Step 2's summary asks him to look |

## 8. Set up once, by Blake himself

No automated tool sees the token at any point. The order matters.

1. On GitHub, create the environment `railway-settings` with the four rules. No
   secret yet.
2. Press "check now". Step 1 reads the rules back and shows them. The run then
   rehearses the gate with no token: each of the two later steps asks for its
   own approval, and a run started from another branch is refused by GitHub.
3. Only then: on Railway, create a project token for the production
   environment, and paste it as the environment's secret.
4. Press "check now" again, on his phone. It must say "already up to date".

## 9. How we will know it works

- The rehearsal of step 2 above, before any token exists.
- The first "check now" with the token says "already up to date".
- The CI check of 6.7 fails on a planted second use of the environment, a
  planted forbidden flag and a planted trigger, then passes without them.
- The renderer and the refusals of 6.3 are tested on plans shaped like the one
  seen on 22 November, with made-up ids: no change, a safe update, an emptied
  setting, a removed domain, an added service, a change under variables.
- The release lead reviews the workflow before it merges.
- The first real settings change is watched to the end by a person, with the
  production receipt run on its commit.

**Not yet proven. The build proves each before anything relies on it:**

- that two jobs in one run, in the same environment, each ask for an approval,
  and that a skipped job asks for none and does not create the environment;
- that GitHub's phone app shows job summaries and offers the review and "run
  workflow" buttons (if not, he uses the browser on his phone);
- that Railway posts a deployment record to GitHub for a redeploy an apply
  starts (if not, step 3 reads the deployment's state with the token and prints
  only the verdict);
- what an apply does to changes left staged on Railway's dashboard;
- whether the tool can plan from a settings file evaluated beforehand. If it
  can, the file and the kit are evaluated with no token present.

## 10. Calls made in this design, for Blake to check while reading

- A new environment and a secret name of its own (6.1).
- Three steps: one with no token that shows what the first tap trusts, then two
  tapped ones.
- From GitHub, only updates to one service's build and deploy settings.
  Everything else stays by hand (6.3).
- An old value that differs from the file's history is not shown publicly (6.4).
- `.railway/` holds only what a plan reads; its README moves (6.2).
- "Check now" can go on to apply, on the second tap.
- No second Railway environment to test against. Tests use made-up plans; the
  first live run is read-only.
- The Deploy workflow is not changed; 6.5 is a look, not a lock.

## 11. What only Blake decides

1. **Build this now under a rule, or lock first.**
   - *Now, under a rule (recommended):* build as designed. Automated tools never
     approve and never change the environment. This adds no power they lack
     today: the hand-run route already runs under a full Railway sign-in. It adds
     a second, guarded route.
   - *Lock first:* store no token until automated tools work through a second
     GitHub account that is a collaborator, not the owner. Blake's account is
     then the only one able to approve or to change the environment, and GitHub
     enforces it. It touches every tool that pushes or merges, and is a piece of
     work of its own. Settings stay by hand until it is done.
2. **Two taps or one.**
   - *Two (recommended):* he reads Railway's own plan before anything is applied.
   - *One:* after step 1's summary, a single tap plans and applies, under the
     refusals of 6.3. Faster. He sees Railway's lines only afterwards.

## 12. Left to the builder

- How Railway's tool is installed at an exact, verified version.
- How "the last change that was applied" is found without a token.
- Where the renderer and its tests live, off every watched path.
- How step 3 reads other workflows' executing jobs and Railway's state.
- The rehearsal mode of section 8.
- The exact words of the summaries, in the plain style of section 2.
- The new home and text of the README, and the edit to "After the move" in the
  operations page once this is live.

## 13. What the independent check changed

The first draft was read by a reviewer who checked each fact against GitHub's
and Railway's own pages and looked for ways round the anti-goals.

- **The first tap was the dangerous one.** It gave the token to the commit's
  code before anything was shown. Now a step with no token shows what is being
  trusted, and the token reaches one step only (section 2, 6.2).
- **"Only this workflow" was wrong.** GitHub gives an environment's secret to
  any workflow on `master` that names it. Now section 3 says so and CI checks
  every workflow file (6.7).
- **The "lock" was no lock.** A second reviewer account can be removed by the
  owner's sign-in. Decision 1 now says what a real lock is.
- **The rules were set once and never read again.** Now every run reads all
  four, and the token is pasted only after they are proven (6.1, section 8).
- **A hash did not bind what he read.** Now step 3 compares the lines (6.2).
- **"Deletion" was Railway's word, and may be narrow.** Now the workflow has its
  own rule (6.3).
- **The public probes cannot see a failed redeploy.** Now step 3 waits on
  Railway's own record (6.6).
- **A README edit could strand a waiting run.** Now the folder holds only what a
  plan reads (6.2).
- **The by-hand slot had seven guards, not three.** Section 7 says what became
  of each.
- **Old values and the tool's own output could leak.** 6.4.
