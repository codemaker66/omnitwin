# Credit runner

Each Claude Max account comes with monthly API credit in a linked Console org
(VenViewer Batch and VenViewer Staging; VenViewer Production's credit serves live
AI only and gets no runner key). The credit
expires at the end of each grant and does not roll over. Interactive Claude Code,
the desktop app and cloud sessions never draw on it; they always bill the Max
plan. Headless `claude -p` with an org's API key does draw on it.

This runner turns that credit into VenViewer work. Each night it takes the queued
tasks in `queue/`, gives each one a fresh worktree and its own branch, runs
headless Claude Code on it within a dollar budget, re-runs the task's acceptance
command itself, and writes a morning report.

## Why a run can only bill the org's key

| Guard | What it stops |
|---|---|
| `--bare` | Claude Code authenticates with `ANTHROPIC_API_KEY` only. No hooks, plugins, memory or CLAUDE.md discovery. |
| An isolated `CLAUDE_CONFIG_DIR` per task (`E:\venviewer-runs\.claude-config\<task-id>`), emptied before every attempt except its session transcripts | That folder holds no Max login, so a fallback to the subscription has nothing to use, and nothing one run writes there (settings, a login) can steer another. |
| A scrubbed child environment | Runs get a fixed allow-list of the variables Windows, git, node and pnpm need, plus any names in the config's `passEnv`; `ANTHROPIC_*` and `CLAUDE*` names can never be passed. Everything else is dropped, including the `ANTHROPIC_BASE_URL` and session tokens a Claude Code session exports. The key is set in the claude process's own environment only, never in the runner's, the user's or the machine's. |
| A credential check at start | Claude's first stream line reports its `apiKeySource`. Anything other than `ANTHROPIC_API_KEY` kills the run before its first model request and aborts the night. |
| The Console balance | The authority. The report's costs are Claude Code's own `total_cost_usd`. |

## Why a run cannot ship anything

- **Branches stay local.** Runs work on `credit/<task-id>`. `remote.origin.pushurl` points at a dead URL and git's credential helper is emptied through the child environment, so `git push` fails. The runner then checks `git ls-remote` itself and rejects any branch that reached origin.
- **No settings or MCP servers are loaded.** `--setting-sources user` with the empty config folder means the repo's checked-in `.claude/settings.json`, which pre-approves `git push origin master` and Railway deploys, never applies. `--strict-mcp-config` loads no MCP servers.
- **Permissions are allow-list only.** `--permission-prompts none` denies anything not pre-allowed instead of waiting for a human. `runner-settings.json` adds deny rules for push, remotes, `gh`, `railway`, `vercel`, `npx`, `curl`, and edits to env, Docker, Railway, Vercel, `.github`, `.claude/settings*`, `docs/state/tasks.md` and `docs/sessions/`.
- **Hosted CLIs are disarmed.** `GH_TOKEN` and `RAILWAY_TOKEN` are set to dead values, so those CLIs fail before using a stored login. `DATABASE_URL` and the Vercel and Neon variables are dropped.
- **The diff is checked.** The runner checks the branch's diff and any uncommitted files, and rejects a branch that touches those paths, whatever the agent says.

This is policy and environment, not a sandbox. The agent runs tests, so it can run code, and code can in principle read files outside its worktree. Keep secrets out of reach of the user account, and review every branch before merging it.

## One-time setup

1. In each Console org (platform.claude.com, then Settings, then API keys), create a key named `credit-runner`.
2. In your own PowerShell window, from the repo root, run the setup script and paste each key at its hidden prompt:

   ```powershell
   .\tools\credit-runner\setup-keys.ps1
   ```

   It writes `%USERPROFILE%\.venviewer-credits\batch.key` and `staging.key` and makes the folder readable by your account only. The runner refuses a key file that any account other than yours, SYSTEM or Administrators can open, including narrow grants such as a sandbox group inherited from a temp folder.
3. Check it with:

   ```powershell
   pnpm --filter @omnitwin/credit-runner status
   ```

## Running

```powershell
pnpm --filter @omnitwin/credit-runner night --dry-run          # the plan: tasks, org, budgets; spends nothing
pnpm --filter @omnitwin/credit-runner night                    # every enabled task, within the nightly cap
pnpm --filter @omnitwin/credit-runner night --only <task-id>   # one task, even if enabled: false
pnpm --filter @omnitwin/credit-runner night --cap 40           # a different cap for tonight
```

`run-night.ps1` does the same from any directory, for a scheduled task. No
scheduled task is set up yet.

### What happens per task

1. **Worktree.** Fetch `origin/master`, then create `E:\venviewer-runs\<task-id>` on a new branch `credit/<task-id>`.
2. **Install.** Run `pnpm install --frozen-lockfile`, with no API key in the environment.
3. **Agent.** Run headless Claude Code with the spec on stdin. The fixed rules and the repo's AGENTS.md go in through `--append-system-prompt-file`; `src/project-rules.ts` first removes AGENTS.md's interactive-only parts (the credentials pointer, deployment, the task list and session logs) and refuses to run if `deploy-secrets` would still reach the agent. The run is capped by `--max-budget-usd` and the task's time limit.
   - Credit that expires first is spent first: Batch, then Staging.
   - When an org answers "credit balance too low", it is marked out of credit and the same session resumes on the next org, so no work is lost.
   - When no org has credit left, the night stops cleanly.
4. **Inspection.** The runner inspects the branch itself: commits, changed files, uncommitted files, protected paths, and whether it reached origin.
5. **Acceptance.** The runner re-runs the acceptance command in a fresh process with no API key. The agent's own claim is not trusted.
6. **Recording.** It appends one line to `D:\venviewer-runs\ledger.jsonl` and rewrites the morning report.

A task passes only if:

- the acceptance command passes;
- the agent made at least one commit (read-only tasks: none);
- nothing is left uncommitted;
- no protected path was touched;
- nothing reached origin.

### The nightly cap

A task starts only if its whole `budget_usd` fits under the cap together with
what has already been spent that night (the night is the local date the run
started). A task that does not fit stays queued, and smaller tasks after it can
still run. A run killed at its time limit has not reported its cost, so it is
counted at its whole budget; the cap can over-count but never under-count.
`--max-budget-usd` is checked between turns, so one run can overshoot its budget
by up to one turn.

## Output

| Path | What |
|---|---|
| `D:\venviewer-runs\reports\<date>.md` | The morning report. Per task: outcome, branch, the runner's own acceptance result, `total_cost_usd`, turns, the org billed and its reported credential, commits, files, violations, permission denials, and the agent's summary. |
| `D:\venviewer-runs\ledger.jsonl` | One JSON line per run, all nights. |
| `D:\venviewer-runs\logs\<date>\` | Per task: `<id>.claude.jsonl` (the full stream, with the key redacted), `<id>.install.log`, `<id>.acceptance.log`, `<id>.system-prompt.md`. |
| `E:\venviewer-runs\<task-id>\` | The worktree. Review the branch from here or from any checkout (`git log credit/<id>`). |

## Adding a task

Add a markdown file to `queue/`. File names set the order, so prefix them (`010-…`, `020-…`). The frontmatter sets the run and the body is the spec the agent receives.

```markdown
---
id: t582-splat-poller-deadline
title: Stop the splat progress poller when a tile hangs (T-582)
budget_usd: 5
acceptance: "pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx"
---
What to build, where, the constraints, the tests to add, and what done looks like.
```

| Key | Default | Meaning |
|---|---|---|
| `id` | required | Lowercase letters, digits and dashes. It names the branch `credit/<id>` and the folder `E:\venviewer-runs\<id>`. |
| `title` | the id | Shown in the report. |
| `enabled` | `true` | `false` runs the task only with `--only <id>`. |
| `model` | `claude-opus-5-5` | Any Claude Code model name or alias. |
| `effort` | `high` | `low`, `medium`, `high`, `xhigh` or `max`. |
| `budget_usd` | `5` | Passed as `--max-budget-usd` (at most 50). |
| `timeout_minutes` | `60` | Wall-clock limit for the agent (at most 240). |
| `acceptance` | required | A shell command run at the worktree root. Quote it if it contains `#` or `:`. |
| `install` | `true` | Run `pnpm install --frozen-lockfile` first. |
| `read_only` | `false` | Inspection tools only. Any commit or change fails the run. |
| `base` | `origin/master` | The ref the branch starts from. |
| `allowed_tools` | see `src/task.ts` | Replaces the default allow list. |
| `extra_allowed_tools` | `[]` | Adds to the default allow list, e.g. `[WebFetch]`. |

Unknown keys are rejected, so a typo cannot silently fall back to a default.
Lists can be inline (`[a, b]`) or block (`- a` on following lines).

**Writing a spec that works unattended:**

- Name the files, the behaviour, the tests to add, and the definition of done.
- Pick an acceptance command that needs no database, network, GPU or browser. Unit tests, typecheck and lint work. Scope it to the package or file the task touches, because the whole monorepo suite is slow on Windows.
- Leave out anything that needs Blake's judgement: design, copy, look. Leave out deploy or env changes, because the runner rejects them.

## Re-running a task

A task whose branch already exists is skipped. After reviewing or salvaging the branch, run:

```powershell
pnpm --filter @omnitwin/credit-runner credit-runner clean <task-id>
```

This removes `E:\venviewer-runs\<task-id>` and deletes `credit/<task-id>`. It refuses branches outside `credit/`. Make any review notes first, because the work is deleted with the branch.

## Unattended overrides of AGENTS.md

Runs get AGENTS.md without its interactive-only parts (on master CLAUDE.md is only an `@AGENTS.md` import, which bare mode does not expand). These fixed rules win where the two disagree:

- Do not read `docs/state/tasks.md` whole (about 500 KB); grep it for the T-number.
- Do not edit `docs/state/tasks.md` or `docs/sessions/`, so overnight branches do not collide with the day's sessions. The morning report records status instead.
- Do not ask questions; report a blocker in the final message.
- Skip instructions that need plugins or MCP servers, which bare mode does not load.

## Tests

```powershell
pnpm --filter @omnitwin/credit-runner test
pnpm --filter @omnitwin/credit-runner typecheck
pnpm --filter @omnitwin/credit-runner lint
```

`src/__tests__/night.test.ts` drives whole nights against temporary git repos,
using a stand-in for `claude` (`test-fixtures/fake-claude.mjs`). It covers:

- the org switch on "credit balance too low", resuming the same session;
- the credential check killing a run that reports the wrong credential;
- push blocking;
- protected-path rejection;
- the nightly cap;
- the ledger and report.
