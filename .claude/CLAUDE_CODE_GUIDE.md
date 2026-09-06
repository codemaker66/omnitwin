# Working with coding agents on Venviewer

Updated 2026-09-06. This guide applies across coding agents; the filename is retained
for existing references. Its purpose is to help an agent complete the requested
work with sound judgment, useful tools and verifiable results.

## Use the existing project instructions

The canonical project policy is the repository-root `CLAUDE.md`. `AGENTS.md` is the
entry point for agents that use it. Follow their current reading and precedence
rules, including `GOAL.md`, `.claude/AI_INTEGRITY_RULES.md`, current task state and
relevant architecture/audit records. Use dated state as a starting point and verify
facts that the task depends on against current files and available runtime evidence.

Keep policy in those existing locations. Do not create another `.claude/CLAUDE.md`
or copy the root instructions into a competing template. Package names may remain
`omnitwin` or `@omnitwin/*`; the company and product are Venviewer.

## Ask for an outcome; let the agent carry it through

A useful request describes the desired result, concrete inputs and any meaningful
constraints or acceptance criteria. For example:

> Fix the reported camera reset when the room poller updates. Find the cause in the
> current implementation, add a regression test, and verify camera movement in the
> real room. Follow the existing rendering and release constraints.

The agent should investigate, make reasonable implementation decisions, apply the
change, run checks and fix failures within that scope. Nontrivial work benefits
from a short plan and progress updates. Plans can evolve as evidence changes; there
is no fixed limit on files, function length, features or prompts per task.

Do not stop authorized work at an arbitrary chunk boundary or require Blake to
re-prompt for tests, integration or remaining implementation. If a real blocker
requires his input, describe the concrete decision and why it cannot be resolved
from existing authorization or evidence. Continue work that does not depend on it.
Respect current production, spending and deployment boundaries.

## Use references, skills and tools accurately

`.claude/SQUAD_PROTOCOL.md` maps optional engineering perspectives. The files in
`.claude/squad/` and `.claude/council/` are reference material, not installed agents
or mandatory identities. Read the useful ones; apply broad expertise without acting
out a conversation or treating a character's preference as an accepted decision.

The repository also vendors four design/motion skills under `.claude/skills/`:

| Skill | Intended use |
| --- | --- |
| `emil-design-eng` | Component polish and animation decisions |
| `apple-design` | Fluid interaction, gesture behavior and design foundations |
| `animation-vocabulary` | Naming a described motion effect |
| `review-animations` | Requested animation review; metadata sets `disable-model-invocation: true` |

See `.claude/skills/README.md` for provenance and project-specific context. Skill
files present in the repository do not prove that a particular host has loaded
them. Discover capabilities through the current environment, read a relevant skill
when applying it, and follow current user direction and project constraints when
generic examples or old aesthetic defaults conflict. Neither roleplay nor a longer
prompt raises a model's inherent capability; focused context, investigation and
independent checks help it use its capability well.

Use available independent agents for concrete parallel work or reviews that improve
the result. Give them clear file ownership and evidence requirements; integrate and
check their findings. Do not invent a specialist tool, assume a named plugin is
installed, or block on a missing preferred tool when a suitable supported path is
available. Establish actual connectivity before claiming an integration works.

For library/API uncertainty, inspect the installed package, types, source and
version-matched official documentation using available tools. Investigate the
uncertainty instead of leaving a speculative API call and asking Blake to check it.
Use current `package.json` scripts and the repository's runtime instructions rather
than assuming commands from a remembered toolchain.

## Verify what changed

Choose checks by the affected behavior and risk, while honoring required repository
checks. This monorepo defines root `typecheck`, `lint`, `test` and `build` scripts;
package-level scripts can focus iteration on the affected workspace. For example,
after checking the package's scripts:

```powershell
pnpm --filter @omnitwin/web typecheck
pnpm --filter @omnitwin/web lint
pnpm --filter @omnitwin/web test
```

Read `.claude/gotchas/windows-v8-heap.md` when its trigger applies. Add regression
coverage for changed behavior. Prefer a failing reproduction before fixing a bug;
tests should detect a plausible defect, not mirror each function mechanically.
Expand to dependent packages or broader checks when contracts or impact warrant it.
For documentation-only changes, validate the diff, references and consistency;
unrelated runtime suites do not establish that instructions are useful or correct.

For UI and 3D changes, inspect and exercise the actual rendered result with the
available browser tools. Use the shared activity convention for all affected
loading/working states and respect the splat verification gotchas. Report the
tested browser, device or environment when relevant; passing types or tests alone
does not establish visual quality or founder aesthetic acceptance.

Investigate relevant failures and rerun checks after fixing them. Identify verified
pre-existing failures separately. Source scans with `rg` can locate suspicious
patterns, but a keyword match is a lead to inspect, not proof of a defect. Enforce
TypeScript strictness and no `any`; reject fake integrations and incomplete behavior.
Use real acceptance criteria and configured budgets instead of inventing universal
coverage, bundle-size, line-count or per-function test quotas.

## Keep work recoverable and handoffs useful

Inspect the working tree before editing and preserve unrelated or concurrent work.
Coordinate ownership if other agents share files. Commit coherent, verified work
when it is appropriate and authorized, with explicit pathspecs; a completed prompt
does not itself require a commit, push or deployment.

Keep durable decisions, task status and useful evidence in the established project
records as required by the canonical workflow. Save enough context to resume a long
task: objective, decisions, changed files, checks, blockers and next concrete action.
Use available context continuation rather than forcing a new conversation because
the task is long. Memory can aid retrieval but does not override current evidence.

Finish with the outcome, meaningful changes, checks actually run and any material
limitations. Say exactly what remains when blocked. A concise, accurate report is
more useful than a fixed multi-heading ceremony or a request to prompt again for
work the agent can already complete.
