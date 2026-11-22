# Credit runner

Runs one coding spec per Claude Managed Agents session in Anthropic's cloud
sandbox, charges the session to a credit pot, and brings back a patch for review.
No agent code runs on this machine.

Some Claude plans include monthly API credit. It pays for the Claude API,
Message Batches and Managed Agents sessions; it does not pay for Claude Code
chats. Credit that is not spent by the end of its cycle is lost. This package is
the part that turns such a pot into reviewed patches.

## Status: run it by hand, attended

`sandbox run` is for a person at the keyboard until the night-shift conveyor's
ledger v2 lands. Until then the ledger is written only once the launcher has
stopped a session and read its cost, so a launcher that dies or is started twice
at once can leave a running session unrecorded, and nothing locks the
check-then-spend step.
The conveyor's ledger reserves the budget before the session starts and settles
it after. Do not schedule or loop `sandbox run`.

Three independent checks stand between a run and a merge:

1. **This machine's inspection of the returned patches.** git reads the
   format-patch files themselves, not a list the agent printed: every path they
   touch, file modes (no symlinks or submodule links), protected files, deleted
   or renamed tests, binary changes and secret-shaped text, and whether they
   apply to the base. A consistency check also requires each patch's `From` line
   to match the verifier's list of commits, in order. Both are written in the
   agent's container, so this catches a stale or partial patch set, not a
   forgery. `diff.patch` must come back and is scanned, but the launcher does not
   prove it equal to the patches; the conveyor's delivery rebuilds the branch
   from the patches and compares it before anything is pushed.
2. **A differently briefed reviewer** on another model. It is not built yet;
   until it is, a person reviews every patch.
3. **CI on the pull request, which is the acceptance authority.**

The in-sandbox verifier and `precondition.json` are advisory. Both come from a
container the agent controls (the agent runs the verifier, and runs the
precondition and writes its result), so they are evidence the agent produced: a
failing, unreadable or missing result rejects a run, a passing one proves
nothing and never clears it.

## What a run can and cannot do

| Guard | What it stops |
|---|---|
| The sandbox | A cloud container with limited egress (package registries, the public repository's host and the Node download host) and no credential in it. The agent's code never runs on this machine. Every `setup` and `run` reads the live environment and the agent version sessions are pinned to, and refuses to start if the networking, host list or MCP switch, or the agent's model, effort, speed, system prompt or tools (only bash and the file tools on, one config per tool, no web tool, no MCP server or toolset, no custom tool, no other agents, no skills) differ from what the code sets up, as after an edit in the Console. A change to the code's own settings updates the environment or makes a new agent version from the whole settings, so nothing set on a newer version carries over. |
| The key | Read from a file only this account can open, in a folder outside every git work tree: the CLI refuses a key folder inside the repository, or one with a `.git` file or folder in it or in any folder above it (checked where the folder really is, through junctions and links, and as written), and `setup-keys.ps1` refuses a `-KeyDir` spelled with a leading `\` or `/` (the long-path and network forms) and one whose real path reaches a `.git` (it asks node, so node must be on `PATH`); `*.key` is git-ignored. Only a workspace API key (`sk-ant-api`, two digits and a dash, then the key) is taken as the runner's key, by the CLI and the script: any other credential, such as an Admin key (`sk-ant-admin...`), an OAuth access or refresh token (`sk-ant-oat...`, `sk-ant-ort...`) or a session key (`sk-ant-sid...`), is refused without printing it. The key goes to the SDK client in-process and is never printed, logged or put in an environment variable. A key file readable by any other account is refused. The client sends it only to `https://api.anthropic.com`, as the `X-Api-Key` header, with only the other headers SDK 0.131 itself builds: an `Authorization`, `Proxy-Authorization` or `Cookie` header, or another `X-Api-Key`, refuses the request before anything is sent, and any other header is dropped. It follows redirects itself: one to another host is followed only for a file's content (a GET or HEAD of `/v1/files/<id>/content`, handed to storage), without the key, and every other endpoint refuses a redirect off `https://api.anthropic.com`, so no status, cost or event comes from another host; any other method is followed only through a same-origin 307 or 308. A refused request is not retried, whatever the redirect's target says, and the error says why without repeating anything the server sent. The launcher refuses to start while `ANTHROPIC_BASE_URL` names another host or `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_CUSTOM_HEADERS` is set. |
| The session budget | A hard cap the platform checks before every model request; the launcher also refuses a job whose whole budget does not fit under the lane and pot caps in the ledger, or under `--job-cap` for its `--job` label. A session the launcher stops following without seeing it stop (the deadline plus the grace period passed, or its stream kept failing) is interrupted again and waited for; if it still runs it is archived. Its ledger line is written as soon as the platform's final status and cost are read, before any output is downloaded, so a download that stalls or fails cannot hold it back, and a session gets one line. Whenever the platform cannot confirm a session has stopped, it is booked at its whole budget (or its last cost figure, if higher), marked `costKnown: false` in the ledger; one request already in flight can still take it past that figure. |
| The spec | Strict front matter: an unknown key is an error, `budget_usd` is at most 50 and `timeout_minutes` a whole number of at most 240. The command-line `--budget` and `--timeout` overrides obey the same limits. |
| The project rules | `src/project-rules.ts` filters AGENTS.md sentence by sentence before it reaches the agent: no deployment or live-check text, no pointer to a credentials folder, no instruction to update the task list or session logs. It refuses to continue if a secrets folder or a local path would still reach the agent. A test runs it on the real AGENTS.md. |
| The review | `review.md` is this machine's reading of the returned format-patch files (`src/sandbox/patches.ts`). git reads them in a throwaway repository that holds only the base commit's trees, and applies them only to that repository's index, never to a checkout: `mailsplit` and `mailinfo` split each file as `git am` would, `git apply --check` proves the series applies to the base, `--numstat` and `--summary` give every old and new path and file mode, `ls-tree` gives the base's own modes, and git's own diff of each commit against the one before it (the patches applied to that index one at a time), read with the base's `.gitattributes` rather than the patched ones, says which files each commit changes as binary, as `git log -p` shows them. The run is rejected if the patches do not apply, their `From` lines do not match the verifier's list of commits, they touch a protected path (deploy, environment, CI, hooks, `.gitattributes`, the task ledger, session logs; matched ignoring case, as a Windows checkout resolves names, and any path with an 8.3 short-name segment such as `CLAUDE~1`), delete or rename away a test, create or change a symlink or submodule link, change a binary file (a binary patch section, or a file whose content one commit changes and that git's diff of that commit calls binary: a NUL byte in the first 8,000 bytes of either side, or a path the base's `.gitattributes` marks `-diff` or `binary`; a rename or mode change that keeps a binary file's content is not a change to it), or add a secret-shaped string in a message, an added line or a path; also if any other `.patch` output came back, `precondition.json` is missing for a task with a precondition, says the precondition failed, or cannot be read, the verifier failed or printed no readable result, or the session ended on exhausted retries, was terminated, or would not stop. It flags lockfile, manifest, migration, script and build-config changes, new source files, and each code file the patches only add lines to. In `review.md` every string the agent or the session supplied (reasons, flags, changed paths, output names, the session's id and status, the grader's verdict) is one inline code span on its own line, fenced so nothing inside can close it, and the grader's explanation and the verifier's output are fenced blocks: none of it renders as a tag, link, image or heading in a Markdown preview or a pull-request body. |

Nothing here is pushed. The launcher never holds a GitHub credential; the patch
comes back as files and a person (or the conveyor's delivery step) opens the pull
request.

## One-time setup

1. In each Console organisation that holds a pot, create an API key for the runner.
2. In your own PowerShell window, from the repo root, run the setup script and paste each key at its hidden prompt:

   ```powershell
   .\tools\credit-runner\setup-keys.ps1 -Pot pot-1
   ```

   It writes `<keyDir>\pot-1.key` and makes the folder readable by your account only. `-KeyDir` picks another folder (a relative one is taken from your window's location; one inside any git work tree, or spelled with a leading `\` or `/`, is refused, and the check needs node on `PATH`); keep it equal to `keyDir` in your config. It takes only a workspace API key (`sk-ant-api`, two digits and a dash, then the key) at the prompt, and names an Admin key, an OAuth token or a session key when it refuses one. The runner refuses a key file that any account other than yours, SYSTEM or Administrators can open, including narrow grants such as a sandbox group.
3. Copy `sandbox.config.example.json` to `sandbox.config.json` (git-ignored) and fill in your own folders, key file and caps.
4. Check it:

   ```powershell
   pnpm --filter @omnitwin/credit-runner sandbox status
   pnpm --filter @omnitwin/credit-runner sandbox setup
   ```

`status` shows whether the key file is present and private, the sandbox ids and the spend against the lane and pot caps. `setup` creates the environment and the agent from the project rules at master.

## Running

```powershell
pnpm --filter @omnitwin/credit-runner sandbox run <spec.md> --job <label> [--budget <usd>] [--timeout <min>] [--job-cap <usd>]
pnpm --filter @omnitwin/credit-runner sandbox collect <session-id> <spec.md> --run-dir <dir> --base <sha> [--budget <usd>]
```

`run` looks up master's commit with `git ls-remote` and fetches it, trees only, into a throwaway repository (the review reads the patches the same way), so it writes no `FETCH_HEAD`, ref or object into the checkout it is run from and downloads only the blobs it reads. It then checks the spend and starts a session with a single create call (no SDK retry, one minute for the whole call, response body included; after any failure other than a refusal by the server, such as a broken connection, a timeout, a server error or a success response whose body broke, it looks the session up by its metadata, follows it if found and otherwise books the whole budget as unknown, since a create still in flight may yet start it; the error then names the per-run id the session's metadata carries, which `kickoff.md` in the run folder also holds). It follows the session's events, reconnecting and dropping duplicates; it stops after thirty reconnects in a row that bring nothing new. It denies any tool call that asks for approval, and sends the deny again after a reconnect if it did not arrive; from the deadline's interrupt on, and while it stops a session, it answers no ask, since a confirmation would wake the agent. Once it has stopped following, it reads the platform's final status and cost and writes the ledger line, before any download. It downloads only what the review reads, the format-patch files (in the order of their base names), `diff.patch` and `precondition.json`, streamed to disk under names it chooses (`patch-0001.patch`, ..., `diff.patch`, `precondition.json`), never the agent's. A file listed over 16 MiB (or past 64 MiB for the run), or with an invalid size, is refused before it is downloaded; a download is cut off at the cap, and abandoned after 5 minutes, its partial file removed. Each of those rejects the run, as do any of these outputs that the API lists but will not serve, any other `.patch` output, more than 50 `.patch` outputs, and, among the outputs it would download, a name Windows opens as a device (`NUL`, `CON`, `COM1`, ...). Every other output (logs, the verifier's own JSON) stays in the sandbox. It writes `review.md` and `result.json` under `<workRoot>/runs/<task-id>/<stamp>/`. The exit code is 0 for ready-for-review, 2 for rejected, 1 for a job that did not start.

`collect` rebuilds a finished session's record and review from its history. It starts and charges nothing, and says whether the ledger already holds a line for the session (a launcher that died may have left none). A session whose cost cannot be read is shown at the whole budget it was counted at, not as zero.

## The in-sandbox verifier

`sandbox/verify.mjs` is uploaded to the container and run by the agent on its final commit. It checks that the branch sits on the base commit, is clean and carries the task trailer; that the acceptance command passes; and that it fails when the fix is taken away (changed non-test files put back to the base, or, for a test-only change, the spec's `mutation` command breaking the code under test). Only a numeric, non-zero exit that did not time out counts as failing without the fix; a timeout, a signal or a command that never started proves nothing. It prints one `VERIFY_RESULT {json}` line, with the branch's commits oldest first, the end of the run without the fix (which `review.md` shows) and a flag when the change adds a non-test file or only adds lines to a code file. The agent must run it as a bash call of its own, exactly `node /mnt/session/uploads/verify.mjs` (only spaces, tabs and newlines around it are ignored); the launcher reads the line only from such a call, and only when it is the only `VERIFY_RESULT` line in that call's result. That rule rejects anything appended or wrapped around the command; it cannot rule out a function named `node` defined in an earlier call of a persistent shell, which is one reason the result is advisory (see the status section above). It is typed (`checkJs`) and linted with the package.

## Adding a spec

A spec is a markdown file: front matter that sets the run, and a body that is the brief the agent receives.

```markdown
---
id: t582-splat-poller-deadline
title: Stop the splat progress poller when a tile hangs
budget_usd: 5
acceptance: "pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx"
---
What to build, where, the constraints, the tests to add, and what done looks like.
```

| Key | Default | Meaning |
|---|---|---|
| `id` | required | Lowercase letters, digits and dashes. It names the branch `credit/<id>`. |
| `title` | the id | Shown in the review. |
| `budget_usd` | `5` | The session's hard cap (at most 50). |
| `timeout_minutes` | `60` | Wall-clock limit before the agent is interrupted (whole minutes, at most 240). |
| `acceptance` | required | A shell command run at the repository root in the container. Quote it if it contains `#` or `:`. |
| `mutation` | none | For a test-only change: a command that breaks the code under test; the tests must then fail. |
| `precondition` | none | A cheap check, run right after checkout, that the code the brief cites has not moved. The agent runs it and records its result in `precondition.json`, in its own container, so the file is advisory like the verifier: a false, unreadable or missing one rejects the run, and a true one proves nothing. |
| `model` | `claude-opus-5-5` | Only that value: the sandbox agent runs one model, so `run` and `collect` refuse any other. |
| `effort` | `high` | Only that value, for the same reason. |
| `enabled` | `true` | Only `true`: the lane runs every spec it is given, so `run` and `collect` refuse `false`. |
| `read_only` | `false` | Only `false`: the sandbox agent always has its full toolset, so `run` and `collect` refuse `true`. |
| `install` | `true` | Only `true`: the agent always installs, so `run` and `collect` refuse `false`. |
| `base` | master | Only master, spelled `master`, `origin/master`, `refs/heads/master` or `refs/remotes/origin/master`: every run starts from master, so `run` and `collect` refuse any other base. |
| `allowed_tools`, `extra_allowed_tools` | none | Not at all: the sandbox agent has one fixed toolset, so `run` and `collect` refuse a spec that has either key, even with an empty list. |

Every key above `model` takes effect; the rest are accepted only at the value the lane runs, and anything else is refused with the key named. Unknown keys are rejected, so a typo cannot silently fall back to a default.

**Writing a spec the agent can finish on its own:**

- Name the files, the behaviour, the tests to add, and the definition of done.
- Pick an acceptance command that needs no network, GPU or browser. Unit tests, typecheck and lint work; the container has Postgres for the database suites.
- Leave out anything that needs a person's judgement (design, copy, look) and anything that changes deployment or environment: the review rejects those paths.

## Tests

```powershell
pnpm --filter @omnitwin/credit-runner test
pnpm --filter @omnitwin/credit-runner typecheck
pnpm --filter @omnitwin/credit-runner lint
```

`src/__tests__/sandbox.test.ts` drives the launcher against a fake API (`fake-api.ts`) and real format-patch files that `patch-fixture.ts` makes with git: the happy path; the review's rejections (a forged verifier line, a protected path, symlink, submodule link, binary change or secret that only the patches show, a deleted or renamed test, an incomplete or reordered patch set, patches that do not apply); `review.md`'s code spans, read as CommonMark reads them; reconnects; a session that never stops, a failing interrupt, create or deny; the ledger line written before any download, and once; the spend caps; collecting; agent versioning and the live boundary check (networking, model, effort, system prompt, tools); the output plan (names, sizes, caps, deadlines, outputs the API will not serve); and, through the real SDK client over a fake fetch, the create's one attempt and deadline, the lookup after an unclear create, and streamed downloads. `sandbox-keys.test.ts` covers the header allow-list, the redirect rule, refused requests not being retried, the refused key kinds, and the key-folder checks of the CLI and `setup-keys.ps1`. `units.test.ts` covers the front matter, the protected paths, git's limits and the key-file gate on a real file (its ACL on Windows, its mode elsewhere). `sandbox-verify.test.ts` runs the real verifier against temporary git repositories. `sandbox-cli.test.ts` covers the command-line limits, the CLI's own words, the key folder inside the repository, the example config and the master lookup. `project-rules.test.ts` covers the AGENTS.md filter, including on the real file.
