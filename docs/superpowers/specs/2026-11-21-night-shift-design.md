# Night shift: cloud agents that build on API credit, and a board to watch them

Design, 21 November 2026. Status: approved by the owner on 21 November 2026, starting at step 1, with arrangement C (the night book) for the tab. Build plan: `docs/superpowers/plans/2026-11-21-night-shift-conveyor.md`. A sibling plan for the dashboard tab is kept privately.

Source tags used below: **official** = Anthropic's own pages, read 21 Nov. **measured** = from our own runs, ledger, code or workflow files. **likely** = matched from evidence but not proven. **inferred** = reasoned, not checked. **untested** = must be tried before it is relied on.

## What was asked for

The owner asked how to put the API credit that comes with a Claude plan to good use, and to be able to watch the work happen. Asked what the crew should build first, the answer was fixes first, then features.

## Why this, and why now

- Some Claude plans include a monthly API credit. Each plan has its own pot. Pots cannot be merged, and whatever a pot has not spent when its cycle ends is lost (official).
- The credit pays for the Claude API, half-price Message Batches and Claude Managed Agents, Anthropic's cloud sandbox. It does not pay for Claude Code chats, and it buys nothing that is not Claude (official).
- On 5 November four fixes were built in the cloud sandbox, for $0.84 to $1.61 and about ten minutes each (measured), and all four merged (#349 to #352). Then it stopped.
- It stopped because every step around the agents was hand-work: each job needed a hand-written brief, a chat to launch it and a person to open the pull request, and nothing showed that it had gone quiet (measured: the launcher runs one job per command, for one pot, and has no code that pushes or opens a pull request).
- A plan's weekly allowance runs out; the credit is a separate meter that does not. Work moved onto it keeps going when the chats cannot.

The limit was never money. It was the conveyor around the agents, and the supply of jobs worth doing. This design builds the conveyor, a view of it, and the supply.

## Goals

1. A night's work runs from a schedule with no chat open, and keeps running when a chat or an account's week runs out.
2. Nothing is marked ready to merge without passing three independent checks: this machine's own inspection of the returned patches (paths, file modes, binary changes, protected files and secrets, read from the patches themselves; their equality with the returned diff.patch is checked when delivery rebuilds the branch from them), a differently briefed reviewer on a different model, and CI, which is the acceptance authority. The verifier inside the sandbox is advisory: the agent controls that container, so its output is evidence the agent produced, not a trust boundary. It saves a wasted pull request and proves nothing.
3. Spending can never pass the included credit. Caps exist at four levels, and the innermost is enforced by Anthropic, not by our code.
4. The pot that expires soonest is spent first, and a pot about to lose money says so days ahead.
5. One tab answers, at a glance: is the shift alive, what is in hand, what landed, what was thrown out and why, what each pot has left, and what needs the owner.
6. Visible changes come to the owner as before and after frames. The owner accepts or rejects each look. Agents never approve a look.

## Not goals

- It does not make the chats' weekly allowance bigger, and it does not run chat work.
- It does not merge. Merges stay with the merge queue until the owner decides otherwise from a week of numbers.
- It does not judge the captured rooms or splat scenes. Those need a GPU and the production asset, so they stay with the chats.
- It is not a general agent platform. It serves this repository; the repository is a setting, not a rewrite.
- It does not spend for the sake of spending. An empty queue means an idle shift.

## What would make it a failure even if it runs

- It stalls silently. This is what happened on 5 November.
- It spends bought credit or touches a card.
- The sandbox can reach this PC, a login or a secret, or agent-written code runs on this PC.
- A public pull request describes an unfixed security or privacy hole.
- The board shows motion that no real event caused, or dresses itself up.
- Filler jobs are invented to use up a pot.

## Facts the design rests on

**Credit and limits (official).** Each Claude plan with included API credit has a linked Console organisation, one plan per organisation. A linked organisation has the platform's published rate and monthly spend limits for its tier, and a sudden burst can be refused by a ramp limit. An organisation-level monthly spend limit can be set in the Console and stops Managed Agents usage; a limit on the default workspace does not. When a pot is empty and no bought credit exists, requests stop; they are never charged to the plan.

**The cloud sandbox (measured, 5 Nov trial).** A fresh clone, `pnpm install` in 23 seconds, the Postgres suite passing 497 of 497, and the patch returned through the Files API. The session budget is a hard cap checked before every model request; a session capped at $4.70 used $1.61. Egress was limited to the package registries, github.com and nodejs.org, with no credential in the sandbox. Nearly all input was served from cache, which is why a fix costs about a dollar.

**The platform's other features (official, bundled reference).** A session streams events (tool calls, messages, per-request token counts, the grader's verdict) and exposes its running cost. A stream does not replay after a reconnect, so a follower must list past events and drop duplicates. A scheduled deployment fires the same stored message every time and starts one session per firing; a per-firing job is not documented. Webhooks need a public HTTPS address. The sandbox's CPU, memory, GPU and headless-browser support are not stated (untested).

**The launcher (measured, this launcher).** Its tests cover the review's rejections on real format-patch files, the stop, archive and charge paths, and the verifier on real git repositories. It creates the environment and agent, starts one session with a budget and an outcome grader, follows the stream with reconnects, downloads outputs, and writes a review. The verifier checks a fix by reverting the source change, keeping the new test and requiring it to fail; its output is advisory. Its review reads the returned patches itself, with git, applying them only to a throwaway index, never to a checkout, and a session it stops following is interrupted, archived if it will not stop, and charged. Missing: more than one pot, a queue, a schedule, re-attaching to a live session after a crash, a ledger that knows pots and cycles, recording spend before a session ends, locks, a progress feed, pushing and opening a pull request, and a gitleaks scan of what it pushes.

**The supply of fixes (measured and likely).** Of the 86 defects re-checked on 5 November, about 50 look fixed since (likely: matched by commit subject and the file touched). About 36 remain. Of those, roughly 20 can be proven by a test in the sandbox and are safe to hand over. The four fixes that merged on 5 November came from separately hand-written briefs, not from that list.

**Rendering (measured, from the workflow and Playwright files).** CI already renders the web app headless on Linux with Playwright's Chromium, with every API call stubbed in the browser, so ordinary pages need no API, database or secret. The planner renders on software graphics there too. The captured rooms are not in the repository, so a sandbox frame of the planner shows the procedural hall, never a captured one.

**The owner's local dashboard** is a tool outside this repository. It only reads files, and never calls Anthropic or holds an API key.

**House rules.** The repository is public: no addresses, no secrets, protected paths stay untouched. The owner creates keys and they are never printed, logged or put in an environment variable. Only public code and synthetic data go to the sandbox.

## Approaches considered

1. **A small tick on this PC that drives cloud sandboxes (chosen).** A scheduled task wakes every minute or two during the shift, advances every job one step, and exits. The agents' work happens in Anthropic's cloud; the PC only dispatches, collects and opens pull requests. A tick cannot die silently the way a long-running process or a chat can: the next tick simply runs. It extends code that already works. Its cost: nothing new starts while the PC is off, though sessions already running finish and are collected later.
2. **Anthropic's own scheduler.** Runs with the PC off. But each firing sends the same message and starts one session, so a queue would rest on undocumented behaviour, and delivery would need a GitHub token held in Anthropic's vault. Kept as a later step, after a trial.
3. **Claude Code run headless on this PC with the API keys.** Rejected on 5 November: agent-written code would run as the owner's own Windows user with their secrets in reach, and such runs may be billed as Claude Code, which the credit does not cover.
4. **GitHub's runners calling the API.** Rejected: it puts the API keys into the secrets of a public repository and runs agent code beside them.

## The design

### The job's life

A job is waiting, then reserved against a pot, building, collected and being checked. From there it goes one of three ways: thrown out with the reason recorded, held for a chat because it is sensitive, or opened as a draft pull request. A draft becomes ready to merge when CI is green and, for a visible job, the owner has accepted the look. Merging is done by the chats' release process.

Every job is a folder holding its brief and one small state file, written atomically. A single lock lets one tick run at a time. A job that fails for a reason outside itself (a dropped connection, a refused request) is retried once; a job that fails on its merits is thrown out with the reason recorded.

### When it runs

*My call; the owner can overrule it.* The tick runs every two minutes, day and night. It starts new jobs whenever there is work in the queue, credit in a confirmed pot and room under the caps. The name is for the fact that it works while nobody has to, and running by day means there is something to watch. A quiet-hours setting can limit starts to chosen hours. The alarm fires when there was work, credit and room, and no job started for thirty minutes.

### Pots and money

A private settings file, kept outside the repository, lists the pots: a neutral name, the key file, the grant, the cycle's start and end, and whether the owner has confirmed that the organisation has no card and no bought credit. A pot without that confirmation is never used. A pot can also be marked held, and is then never used.

Four caps, innermost first:

1. **Per job:** the session budget, enforced by Anthropic.
2. **Per day:** a ceiling across all pots.
3. **Per pot per cycle:** the grant less a small reserve. The amount is reserved in the ledger when a job starts and settled at the platform's own figure when it ends, so parallel jobs cannot all pass the same check.
4. **Per organisation per month:** a spend limit the owner sets once in the Console.

The ledger gains the pot and the cycle on every line, and old lines are still read.

*My call; the owner can overrule it.*

- **The outside check is read by hand.** Once a week, and at the end of the first unattended night, our totals are compared with the Console's billing page, which the owner reads by hand. No admin key is created. Each session's cost in our ledger is already the platform's own figure, so the Console read checks the sum, not each line.

### Builders

One session per job, as on 5 November: Opus 5.5 at high effort, a fresh clone, the outcome grader, a hard budget. Two or three at once per pot to begin with, raised slowly because of ramp limits. The session id is saved the moment it exists, so a tick can re-attach after any interruption.

### Breakers

- **This machine's inspection of the returned patches.** The paths, file modes (no symlinks or submodule links), binary changes, protected files, deleted tests and renames are read from the format-patch files themselves, applied only to a throwaway index, never to a checkout, so nothing the agent prints can change that list; secret-shaped text is searched in what they add. Their equality with the returned diff.patch is checked when delivery rebuilds the branch from them, before anything is pushed.
- **A reviewer on a different model with a different brief** ("find the defect in this patch"), run through half-price batches. On 5 November the same prompt run twice agreed every time, so a second pass counts only when the model or the framing changes. Most batches return within an hour and the longest take a day (official), so a job can wait in "being checked"; a job still waiting after ninety minutes is reviewed by an ordinary full-price request instead.
- **CI** on the pull request, on GitHub's machines. CI is the acceptance authority.

The verifier inside the sandbox is a fourth, advisory check. It runs in a container the agent controls, so a passing result is not proof the change is right; it is there to stop a wasted pull request.

Two controls run every night: a job whose defect is already fixed, which must stop at its precondition for a few cents, and a patch with a planted defect, which the reviewer must reject. A failed control pauses the shift and raises an alarm. If fewer than half of a kind's last ten jobs survive, that kind pauses and says why.

### Delivery

Once this machine's inspection and the reviewer have passed, the PC rebuilds the branch from the returned patch without a checkout, runs gitleaks and the address check, pushes `credit/<job>` and opens a draft pull request carrying the evidence: the brief, the verifier's result, the reviewer's finding, the cost. Once the reviewer exists, the tick marks a draft ready when CI is green. Until the reviewer joins in step 4, every pull request stays a draft and says that the second review is missing, and a chat reviews it as on 5 November. Dispatch pauses while eight or more night-shift pull requests are open, so the release process is never buried. "The merge queue" in this document means the chats' own release process, which merges one at a time; it is not GitHub's feature of that name. The GitHub token used here never has the workflows permission, so a pull request cannot add or change a workflow file.

*My calls; the owner can overrule them.*

- **Who the PC acts as.** The sandbox never holds a GitHub credential. The PC pushes and opens pull requests with a token limited to this one repository, for contents and pull requests only, which the owner creates and which is stored like the API keys. An unattended process then cannot reach other repositories or the owner's account. Until the token exists, delivery stops at "ready for review" and a chat opens the pull request, as on 5 November.
- **What counts as sensitive.** A brief is sensitive when it touches sign-in, permissions, one venue seeing another's data, share links and tokens, personal data, payments or deletion, or when its source rated it high. The step that writes the brief marks it, a fixed rule over paths and keywords can only raise the mark, and an unmarked brief counts as sensitive. A sensitive job is still built and checked in the sandbox, but its patch is held on this PC for a chat to open and merge in one sitting, so the public never sees the hole before the fix.

Some work is never handed to an unattended agent at all: retention sweeps and deletion, migrations and deploy scripts, anything that needs a real credential or live third-party data, legal and privacy copy, and anything an open pull request already touches.

### Frames, for visible work

Because CI already renders ordinary pages with a stubbed API, the trial tests one thing (untested): that the sandbox can do what CI does. It needs two more hosts on its allow-list, for the browser download. The trial passes if one session returns a before and after frame of one ordinary page at the owner's three window sizes, for under $3 and thirty minutes, close enough to a local Chrome frame to judge by.

If it passes, a visible job also returns frames, its pull request stays a draft, and the board shows the pair for the owner to accept or reject. A rejection, with a note, becomes a new job. Looks that depend on the captured rooms stay with the chats, because the sandbox can only show the procedural hall. If the trial fails, visible work stays with the chats and the shift keeps to fixes and tests.

### Feeds

1. **Checked defects.** The roughly 20 that remain and suit the sandbox. Each is re-checked against today's code by a half-price batch before a brief is written. This is a night or two of work.
2. **Tests** for the money and privacy modules that have none.
3. **Features the owner names.** A chat cuts each into jobs with an acceptance test and the pages to frame.
4. **Scouts**, which keep the queue fed: flaky tests, accessibility scans, coverage gaps, and production errors with all user data removed.

A brief is refused by the queue unless it has a cheap precondition that proves the defect is still there, an acceptance command, and a rule for proving a test-only change.

*My call; the owner can overrule it.* Briefs for fixes and tests are written and queued without a person approving each one, because hand-written briefs are what stalled 5 November. Three things stand in for that approval. Every brief must name its source (a checked defect, a failing or flaky test, an untested module, a production error, or a feature the owner named), and a brief with no source is refused. The kinds of scout are approved by the owner once, in the settings. And the precondition stops a job for a few cents when the defect is not there. The board shows each job's source.

### The board

A fifth tab in the owner's local dashboard, "Night shift", in the dashboard's own type and one colour. The tick writes a small snapshot file and each job's event log; the dashboard only reads them. It shows one plain sentence about the night, the jobs in hand with what each is doing and what it has cost, what landed and what was thrown out, the pots with what is left and when each ends, and what needs the owner. Motion comes only from real events. If the tick's heartbeat is stale during the shift, the tab says the shift did not run and the dashboard's existing notification fires.

*My call; the owner can overrule it.* The tab may write one thing, through the dashboard's existing keyed actions: a decision dropped in the shift's inbox folder, to accept or reject a look with a note, or to pause or resume the shift. It never calls Anthropic or GitHub and never holds a key. The first version of the tab is read-only; the decisions arrive with steps 4 and 5, and until then pause and resume are commands.

The arrangement is the owner's pick from three true-size stills:

- **A, the board.** Beside the dashboard's existing status view: the sentence and the soonest expiry on top, a cell per pot across, jobs in hand on the left and what landed on the right.
- **B, the line.** Three stations joined by a wire (waiting, in hand, landed), with the queue listed by name and the pots as a strip along the bottom.
- **C, the night book.** Jobs in hand on top and one running record of the night beneath, newest first, with the pots and what needs the owner in a side column.

The stills are in the mockups folder of the shift's design folder (`r3-*.png`, at 1536 by 704 and 1366 by 641), drawn with the dashboard's own stylesheet and invented sample figures.

## Order of work

1. **Keep what exists safe, and learn two things.** Land the launcher through the public-repository checks. For each pot the shift will use, the owner reads its balance and end date, creates its API key and confirms it has no card. The owner also creates the repository-limited GitHub token. Run the frames trial, since its answer shapes the queue.
2. **The conveyor.** Job folders, the tick, pots with reserve and settle, re-attach, delivery, the controls, the scheduled task. Done when a night runs unattended with every chat closed, its pull requests carry green CI, and the ledger matches the Console within fifty cents.
3. **The board.** The snapshot, the tab, the stale-heartbeat alarm. Done when it passes the dashboard's tests and true-size checks, and stopping the task makes the alarm fire.
4. **The reviewer in the loop**, the pause rules and a morning summary.
5. **Visible jobs** and the owner's accept or reject on the board, if the trial passed.
6. **Scouts**, so the queue does not run dry.

Steps 2 and 3 can run side by side. Building this uses the chats' allowance, not the credit.

## What it will cost to run

A fix is $0.84 to $1.61 (measured, four runs). A review should be about 35 cents (inferred from batch prices). A visible job is unmeasured. The checked backlog is about twenty jobs. Fixes alone will use a small part of the credit; features and the scouts use the rest. An idle shift is better than a padded queue.

## Decisions that are the owner's, later

- Whether proven-safe kinds of change may merge themselves.
- Whether to trial Anthropic's scheduler so nights run with the PC off.

## Left to the builder

Module boundaries inside `tools/credit-runner`, file names and schemas beyond what is fixed above, the tick's interval and the test plan. The old local lane in that package has been removed.
