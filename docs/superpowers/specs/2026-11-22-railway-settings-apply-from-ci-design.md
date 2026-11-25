# Railway settings: applied from GitHub, on Blake's tap

Design, 22 November 2026. Revised the same day after an independent check of its
facts and its holes, and again after the release lead's review; sections 13 and
14 list what each changed. Ledger row T-751.

Status: **approved by Blake on 22 November 2026, with the two choices of
section 11 decided. Nothing is built yet.** Until this is built, reviewed and
set up, the rule stays as it is: a reviewed pull request to
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
   its pull request, and what changed since the last change that was applied in
   everything the tapped steps run or read: the settings folder, the workflow's
   own code and the workflow file. When the last applied change is not known,
   it shows those files in full. It also shows the versions of Railway's tool,
   its kit and the runtime. This is what the first tap trusts, with the one
   limit section 3 names.
2. **First tap.** The second step reads Railway and writes the plan in plain
   lines: `deploy.healthcheckTimeout: 2700 -> 3000`. It says: "Applying this
   redeploys the API at commit abc1234, with its migration step." It also says
   whether Railway is building or deploying just now. If nothing would change,
   it says "already up to date" and the run ends.
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

- No change to how the API itself is deployed. The Deploy workflow behaves as
  before; only a comment at its top is updated (section 12).
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
  the first tap. Step 1 cannot vouch for the workflow file itself: a changed
  workflow file is the code that runs step 1. For that file, what protects the
  token is what can be merged, and later the lock of section 11.
- **The approval is as strong as the sign-in that gives it.** Anything signed in
  to GitHub as the repository's owner can approve a run and can change the
  environment's rules. Automated tools that work under the owner's sign-in are
  therefore held by a rule, not by GitHub (6.10, and decision 1 in section 11).
- **What a leaked token would cost.** Railway describes a project token as scoped
  to one environment, best for "Deployments, service-specific automation", with
  no read-only kind, no way to narrow one and no expiry. Within production's
  environment its documented reach is wide: it can deploy any code, the tool
  can write out the values of variables that are not sealed, and an apply made
  with it can delete resources. So a leak is a leak of everything in
  production's environment. Section 8 has the steps for that day, and the token
  is replaced on a schedule so that an unnoticed leak does not last.

## 4. Facts this rests on

Each was checked against the source named, on 22 November 2026, unless marked.

**Railway** (its Infrastructure as Code guide, its CLI page and its API page)

- A project token is scoped to one environment. The tool uses it when
  `RAILWAY_TOKEN` is set. The same token plans and applies. With it the tool
  deploys code (`railway up`), runs the settings commands that need admin
  access to the environment, and can write out non-sealed variable values
  (`config pull --include-variables`). No read-only token and no expiry are
  described.
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
- Anyone with read access can read an environment's rules through the API. The
  documented answer holds the reviewers, the self-review setting and the branch
  rule. The bypass setting was seen in the answer under the owner's sign-in;
  whether a run's own token can see it is not yet proven (6.1, section 9).
- A workflow that names an environment which does not exist makes GitHub create
  it, with no rules.
- Logs, job summaries and artifacts of a public repository can be read by anyone
  with a GitHub account.
- A manual run can be started against any branch, and then that branch's copy of
  the workflow file is what runs.
- A job can be run again for up to 30 days, keeping earlier jobs' outputs.
- A run that waits for a reviewer holds its concurrency group. By default a new
  waiting run cancels an older waiting one in its group; a setting now lets up
  to 100 wait.
- When a secret of one name exists at several levels, a job in an environment
  receives the environment's copy. A run's own token cannot list secrets.
- Within a job, an earlier step can change later steps through the job's
  environment file, its path file and files they share.
- A run's name can use only the `github` and `inputs` contexts.

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
   and applies on merge. Least to build. But it plans on every pull request, so
   it needs the token as a repository secret, which any branch's workflow can
   read, and it runs each branch's own settings file beside that token. Its
   recipe also passes `--confirm-destructive`.

Blake chose the first. The second and third each allow something section 3 calls
a failure.

This reverses a reason written at the top of the Deploy workflow: Railway
deploys were kept out of GitHub so that no Railway token would live there
indefinitely. It is acceptable now for three reasons. The token is not a
repository secret: an environment releases it only on an approval, and only to
`master`. It is replaced on a schedule. And the other way has a cost of its
own: every settings change needs one computer with a full Railway sign-in.

## 6. The design

### 6.1 The gate

A new GitHub environment, `railway-settings`, with four rules:

- one required reviewer, Blake;
- "prevent self-review" off, or he could not approve a run he started;
- deployment branches: `master` only;
- administrators may not bypass.

It holds one secret, `RAILWAY_SETTINGS_TOKEN`: a Railway project token for the
production environment. The name is deliberately not `RAILWAY_TOKEN`, the name
Railway's guide suggests for a repository secret. What that achieves: this
workflow never picks up a `RAILWAY_TOKEN` secret that someone makes by
following the guide. It does not stop such a secret being made, and a run cannot
list secrets, so section 8 has Blake check that none exists at repository level.

It is a new environment, not the existing `Production` one: a Deploy job must
not be able to read the Railway token, and each approval should say what it is
for.

GitHub enforces the reviewer and the branch rule. The workflow also reads the
rules back at the start of every run, with the run's own token and no other,
from the environment and from its list of deployment-branch policies. It
refuses on any of these:

- an answer that is not a success, a missing field, or more than one page;
- reviewers other than exactly Blake's user;
- "prevent self-review" on;
- a branch rule in any mode but chosen branches: no branch policy at all, the
  protected-branches mode on, or custom policies off;
- branch policies other than exactly one, of type branch, named `master`;
- a bypass answer other than "no".

GitHub's published description of that answer does not list the bypass field.
It is the only field exempt from "a missing field", and only once the build has
shown that a run's token cannot see it.
The build proves once whether a run's token can see it. If it cannot, the
workflow does not check it and says so in every summary; that rule then rests on
Blake's own check in section 8, and no token with more power is ever used to
read it.

The read-back finds a wrong rule only when this workflow runs. It is not a
guard between runs.

### 6.2 The workflow

One new file, `.github/workflows/railway-settings.yml`, and one folder for its
own code, `.github/railway-settings/`: the reader of plans, the refusals, the
one script that calls Railway's tool, and the tool's version and checksum.
Everything a tapped job runs or reads is in `.railway/`, in that folder, or is
the workflow file. Those three are "the trusted places" below.

The workflow starts on a push to `master` that changes anything in the trusted
places, and by hand. Nothing else starts it. The run's name carries the commit;
step 1 looks its pull request up through GitHub's API and shows it. Every job
states its own condition (this repository, `master`) and its own permissions.

So that the trigger, the refusals and Railway's pin all mean the same folder,
`.railway/` holds only what a plan reads. Its README moves to `docs/operations/`.

**Step 1, "Check the gate, show the change".** No environment, no secret.

- Reads the environment's rules back as 6.1 says, before any later job can name
  the environment.
- Refuses unless the run is on `master` and its trusted places are the ones at
  `master`'s head now. That is "the currency check".
- Finds the last change applied from a record the commit cannot rewrite: this
  workflow's own history of runs on GitHub. Only one kind of run counts: a run
  of this workflow on `master`, started by a push or by hand in this repository
  and not in a fork, whose step 3 applied after an approval that the run's
  review history records for the `railway-settings` environment. Every other
  run is ignored. When there is none, or the history cannot be read, it shows
  the trusted places in full.
- Writes the summary described in section 2.

**Step 2, "Read Railway's plan".** In the environment.

- Repeats the currency check: it is the first job to hold the token.
- Checks out the commit. Installs the kit with `npm ci --ignore-scripts`, and
  Railway's tool as one release file compared with a SHA-256 kept in the
  workflow's folder. The runtime that evaluates the settings file is pinned.
  The token is not yet present.
- Exactly one step receives the token. It runs the workflow's own code, which
  makes two calls to Railway and no others, each with its output written to a
  file on the runner: `railway config plan --out <file>`, then
  `railway deployment list --service <name> --json`. The second lets the
  summary say whether Railway is building or deploying just now. It also means
  every run, a check included, proves the token can make both reads, before a
  real change depends on them.
- The plan's lines are rendered (6.4), with a mark on any line that touches the
  pre-deploy command, the health check, the region or sleep (6.3), and the
  summary says whether step 3 would refuse.
- Passes on: the lines, the time, and whether changes are pending.

**Step 3, "Apply this plan".** In the environment, only when changes are pending.

- Repeats step 1's refusals. Refuses if step 2 ran more than six hours ago.
- Exactly one step receives the token. It runs the workflow's own code, which
  makes these calls to Railway and no others, in this order, each with its
  output written to a file on the runner:
  1. `railway config plan --out <file>`. Its lines are rendered and must equal
     step 2's. Every refusal of 6.3 is worked out again here.
  2. `railway deployment list --service <name> --json`, for the look of 6.5.
  3. `railway config apply --plan <file> --yes`. Just before it, the kit is
     checked against its lockfile and the tool against its checksum once more.
  4. `railway config plan --detailed-exit-code`. It must exit 0.
  5. Only if 6.6 needs its fallback: the same list of deployments again.
- Checks `master`'s head again and says so if it moved.
- Waits for the redeploy (6.6) and writes the result.

**In the tapped jobs:** read-only permissions; no action other than a checkout
pinned to a commit; no cache; no artifact; no deployment record of their own.
The tool is called from one place, with the exact commands above and no others.
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
variables. "Resources" means what the file's project holds: services, databases
and volumes.

This rule judges the shape of a change, not its meaning. A pre-deploy command
changed to one that does nothing, a move to another region, or sleep turned on
would each pass it. Their meaning is Blake's to judge from the lines. That is
why step 2 marks any line that touches the pre-deploy command, the health
check, the region or sleep.

### 6.4 What is printed

- The tool's own output never reaches the log. It goes to files on the runner.
  A failure prints a fixed sentence and the exit code.
- The lines are built by the workflow from the plan's list of changes: the
  setting's name and its new value, which the public file already shows.
- The old value is shown only when it equals what the file declared at the last
  change applied. Otherwise the line says Railway holds something else, and
  does not show it.
- Nothing under variables is rendered. Ids read from the plan are masked.
- All of this holds for every call to Railway in both tapped jobs: the plans,
  the look at Railway's state and the apply.

### 6.5 Beside other deploys and migrations

An apply redeploys the API with its migration step. Just before applying, step 3
looks, and refuses if:

- a job of the Deploy workflow, or of another workflow that runs migrations, is
  executing (a run that only waits for review does not count);
- Railway is building or deploying (read with the token; only the verdict is
  printed). Every status that is not final counts as busy;
- the running build does not already contain `master`'s API code, worked out as
  the production receipt does. An apply would then ship undeployed changes and
  their migrations under a settings approval.

Step 2 makes the same read of Railway, and its summary says in fixed words
whether Railway is busy, so he knows before the second tap. Step 3 still looks
again just before the apply: Railway can become busy between the two taps.

This is a look, not a lock. Step 2's summary says: do not approve a Deploy run
until step 3 has finished. Blake gives both approvals. The Deploy workflow is not
changed, and this workflow has no workflow-wide concurrency group, so a run that
waits for him blocks nothing.

### 6.6 Knowing the redeploy worked

The public probes cannot tell: while a new deployment builds, and after it
fails, the previous one keeps answering. Step 3 waits for the deployment record
Railway posts to GitHub, read with the run's own token as the production
receipt reads it. It counts a record only if all four hold:

- it is in Railway's own environment on GitHub;
- Railway's app created it;
- it is for `master`'s head as read just before the apply;
- it was created after the apply.

It allows for the pre-deploy step's 900 seconds and the health check's 2700. If
no such record reports success, the job fails, and says the apply succeeded and
the redeploy is not confirmed. A production redeploy nobody confirmed does not
show green.

If the build finds that Railway posts no such record for a redeploy an apply
starts, the fallback is the tool's own list of deployments (6.2, call 5). It
counts only a deployment of the one service, created after the apply, that
ended in success, for `master`'s head. The documented list carries no commit.
If the output cannot show all four, the fallback cannot confirm, and the job
fails.

### 6.7 A check in CI

A step in CI's tooling job reads every workflow file and fails unless:

- the environment `railway-settings` is named in this one file only, and no
  environment name anywhere is built from an expression;
- this workflow starts only on a push to `master` and by hand, and every job in
  it states its condition and its permissions;
- everything its tapped jobs run or read is in the trusted places of 6.2;
- Railway's tool is called only with the exact commands of 6.2, each step held
  to its own list: step 2 can make its two reads and nothing else;
- in this workflow the `secrets` context appears only as the literal
  `secrets.RAILWAY_SETTINGS_TOKEN`, in the one token step of each tapped job,
  and as `secrets.GITHUB_TOKEN` where a step needs it. Index syntax
  (`secrets[...]`) and `toJSON(secrets)` appear nowhere in the file. No other
  workflow names a secret that begins `RAILWAY`;
- `.railway/railway.ts` still leaves variables unmanaged, and imports only
  Railway's kit and files inside `.railway/`.

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
`railway-settings` review, never change that environment. His yes in a chat
does not let anything else tap: the tap is his own, on GitHub's review page.
GitHub cannot enforce this while such tools share his sign-in, and an approval
made under his sign-in cannot be told from his own. So until the lock of
section 11, this rule is the only control.

## 7. The hand-run slot's guards

| Guard on 22 November | Here |
|---|---|
| A pinned plan, applied as read | Kept: step 3 pins its own plan and its lines must equal step 2's |
| No deletion | Kept, and wider (6.3) |
| A second plan that must be empty | Kept |
| A hold on merges | Replaced: the trusted places must be `master`'s head before, and the head is checked after |
| Not beside a migration, not while a deploy runs | Replaced by the look in 6.5 |
| A person watching the migration step | Replaced by 6.6; the first real change is still watched |
| A look at Railway's dashboard for pending staged changes | Not kept by the workflow. Railway's tool does not show them. Step 2's summary asks him to look |

## 8. Set up once, by Blake himself

No automated tool sees the token at any point. The order matters.

1. On GitHub, create the environment `railway-settings` with the four rules. No
   secret yet. Look at the bypass box himself: it must be empty.
2. Check that the repository's own secrets hold nothing named
   `RAILWAY_SETTINGS_TOKEN` or `RAILWAY_TOKEN`.
3. Press "check now". Step 1 reads the rules back and shows them. The run then
   rehearses the gate with no token: each of the two later steps asks for its
   own approval. Then one more run shows GitHub's own rule at work. A throwaway
   branch carries a copy of the workflow without its job conditions and without
   step 1's refusal of other branches, and a run is started from it. The
   environment itself must refuse that run's step 2. This is safe only because
   no token exists yet. The branch is never merged and is deleted afterwards.
4. Only then: on Railway, create a project token for the production
   environment, and paste it as the environment's secret.
5. Press "check now" again, on his phone. It must say "already up to date".

**Replacing the token.** Every 90 days, and at once after anything goes wrong
with a runner or a log: create a new token on Railway, paste it over the old
secret, delete the old token on Railway, repeat checks 1 and 2 above, and press
"check now".

**If the token may have leaked.** In this order:

1. Delete the token on Railway.
2. Read Railway's record of activity for the project.
3. Remove any deployment, service, domain or volume nobody recognises.
4. Redeploy `master`.
5. Rotate production's secrets. The database's connection string is also held
   by GitHub, as the secret `DATABASE_URL`, in two places: the repository's
   secrets and the `Production` environment's. Both are replaced.

## 9. How we will know it works

- The rehearsal of section 8 (its step 3), before any token exists.
- The first "check now" with the token says "already up to date".
- The CI check of 6.7 fails on each of these when planted, then passes without
  them: a second use of the environment, a forbidden flag, a forbidden trigger,
  a file run from outside the trusted places, a `RAILWAY` secret named outside
  the token step, a secret read by index syntax, and `toJSON(secrets)`.
- The renderer and the refusals of 6.3 are tested on plans shaped like the one
  seen on 22 November, with made-up ids: no change, a safe update, an emptied
  setting, a removed domain, an added service, a change under variables.
- The release lead reviews the workflow before it merges.
- The first real settings change is watched to the end by a person, with the
  production receipt run on its commit.

**Not yet proven. The build proves each before anything relies on it:**

- that two jobs in one run, in the same environment, each ask for an approval,
  and that a skipped job asks for none and does not create the environment;
- that a run started from another branch is refused by the environment itself
  (section 8);
- whether a run's own token can read the environment's bypass rule (6.1 says
  what happens if it cannot);
- what a project token may run, and what those calls return: the plan, the
  list of deployments, the apply;
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
- The Deploy workflow's behaviour is not changed; 6.5 is a look, not a lock.
- A change to the workflow's own code also starts a run and asks for an
  approval, because the first tap trusts that code too.
- The token is replaced every 90 days. That is a recurring job for Blake
  (section 8).

## 11. What Blake decided

Both choices were put to him on 22 November 2026, with this design in front of
him. He decided them as below and approved the design.

1. **Build this now, under a rule.** Automated tools never approve and never
   change the environment. This adds no power they lack today: the hand-run
   route already runs under a full Railway sign-in. It adds a second, guarded
   route.
   - *Not chosen, lock first:* store no token until automated tools work
     through a second GitHub account that is a collaborator, not the owner.
     Blake's account is then the only one able to approve or to change the
     environment, and GitHub enforces it. It touches every tool that pushes or
     merges, and is a piece of work of its own. It stays possible later.
   - *Not chosen, stay by hand:* store no token at all.
2. **Two taps.** He reads Railway's own plan before anything is applied.
   - *Not chosen, one tap:* after step 1's summary, a single tap plans and
     applies, under the refusals of 6.3. Faster, but he would see Railway's
     lines only afterwards.

## 12. Left to the builder

- Which of Railway's release files is the tool, and how the runtime is pinned.
- How the history of runs is read for the last change applied.
- The files inside `.github/railway-settings/`, and how their tests run in CI
  with no new dependency on a watched path.
- The comment at the top of the Deploy workflow that gives the old reason for
  keeping Railway tokens out of GitHub: updated to point here when this
  workflow lands.
- How step 3 reads other workflows' executing jobs.
- The rehearsal mode of section 8.
- The exact words of the summaries, in the plain style of section 2.
- The new home and text of the README, and the edit to "After the move" in the
  operations page once this is live.

## 13. What the independent check changed

The first draft was read by a reviewer who checked each fact against GitHub's
and Railway's own pages and looked for ways round the anti-goals.

- **The first tap was the dangerous one.** It gave the token to the commit's
  code before anything was shown. Now a step with no token shows what is being
  trusted, and the token reaches one step of each tapped job (section 2, 6.2).
- **"Only this workflow" was wrong.** GitHub gives an environment's secret to
  any workflow on `master` that names it. Now section 3 says so and CI checks
  every workflow file (6.7).
- **The "lock" was no lock.** A second reviewer account can be removed by the
  owner's sign-in. Section 11 now says what a real lock is.
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
- **The concurrency fact was out of date.** A run that waits for review holds
  its group, and a newer run no longer always cancels an older one. Now this
  workflow has no workflow-wide group (section 4, 6.5).

## 14. What the release lead's review changed

The release lead reviewed the text as the contract the build follows, before
any code. It found no way to the token or to production's settings without an
approval, and asked for these to be closed in words:

- **Step 1 showed only part of what the tapped steps run.** Now all of it lives
  in three trusted places, which are in the trigger, in step 1's summary and in
  the currency check. The kit and the tool are checked again just before the
  apply. Section 3 says step 1 cannot vouch for the workflow file itself (6.2,
  6.7).
- **"The token reaches one step" was true of step 2 only.** Now 6.2 lists every
  call step 3 makes to Railway, in order, and 6.4 covers each.
- **The read-back of the gate's rules was not spelled out.** Now 6.1 says what
  it reads, each thing it refuses on, what it may not be able to see, and that
  it runs only when the workflow does.
- **A redeploy could be "confirmed" by the wrong record.** Now 6.6 counts only
  Railway's own record, for the right commit, made after the apply, and an
  unconfirmed redeploy fails the run.
- **The token's reach was understated.** Now section 3 gives its documented
  reach, and section 8 has the steps for a leak and its replacement every 90
  days.
- **The reason for the secret's name was muddled.** 6.1 now says what the name
  achieves, and section 8 has the check it cannot make.
- **This design reverses a reason in the Deploy workflow's header.** Section 5
  says so, and section 12 has the header updated.
- **"Ask him instead" could be read as "approve on his yes".** 6.10 now says his
  yes in a chat lets nothing else tap.
- **The refusals judge shape, not meaning.** 6.3 says so, and step 2 marks the
  lines whose meaning matters most.
- **The token's right to list deployments was first tested by a real change.**
  Now step 2 makes that read on every run, so the first check with the token
  proves it with nothing at stake (6.2, 6.5).

Its second pass asked for these as well:

- **Which runs count as "the last change applied".** Only this workflow's own
  runs on `master`, in this repository, that applied after a recorded approval
  (6.2, step 1).
- **The gate's read-back also refuses a branch rule in the wrong mode,** and the
  bypass field is the one exemption from "a missing field" (6.1).
- **The check on secrets matched names only.** Now the workflow may name its
  one secret literally and in no other way (6.7).
- **The rehearsal could no longer show GitHub refusing a branch.** Now a
  throwaway branch copy shows it, before any token exists (section 8).
- **The fallback for confirming a redeploy had no counting rule.** 6.6 has one,
  and fails when the tool's output cannot meet it.
