# Venviewer AI instruction review — 6 September 2026

Task: T-598. Requested by Blake: review outdated CLAUDE instructions, integrity
rules and personas such as Architect and Mr. Computer, then remove constraints
that hamper the agents' best work.

## Result

The operating instructions now ask agents to investigate, exercise judgment and
complete the authorized outcome. All 17 personas remain available by their existing
names as optional domain references. They no longer claim credentials, dictate
obsolete architecture or make the user coordinate fictional specialists.

This removes identifiable instruction conflicts. It does not increase a model's
underlying intelligence, change its model/reasoning settings, or establish a
measured improvement in task performance.

## Findings and changes

| Previous constraint | Why it could impede work | Replacement |
| --- | --- | --- |
| Estimate lines and prompts, stop after a chunk, ask the user to continue | Assumed short responses rather than sustained tool-assisted execution | Complete the objective through implementation, integration, review and checks |
| Mandatory role announcements, specialist vetoes and eight-person signoff | Persona performance and agreement substituted for judgment and evidence | Optional focused questions; real independent delegation when useful |
| Implement a flawed specification exactly before flagging it | Discouraged early investigation and useful technical disagreement | Investigate, recommend improvements and resolve routine choices within scope |
| Frozen council, visual and renderer prescriptions | Conflicted with newer founder direction and current code | Current-user precedence, actual ADR status, manifests and measured behavior |
| Required named plugins and active memory systems | Assumed capabilities the host might not have | Discover actual tools; use supported source/docs/verification alternatives |
| Mental tracing called verification, universal helper tests and arbitrary size quotas | Mixed weak evidence with expensive ritual | Behavioral regressions, real boundary checks and validation proportionate to risk |
| Full task ledger and global surveillance every session | Repeated unrelated context and maintenance | Relevant rows/dependencies, accurate status and affected diagram updates |
| July cards prescribed immediate GPU spending and fixed session limits | Could conflict with the current programme and freeze | Explicit historical status and current operational constraints |
| Duplicate CLAUDE setup and overlapping handoff templates | Created competing policy sources | One root operating policy and one evidence standard |

The review also removed unsupported technical certainty, invented performance and
market figures, old hosting/authentication mandates, degraded mobile targets and
rendering hierarchy from the persona files. Their useful domain questions remain.

## Scope and retained requirements

Updated [CLAUDE.md](../../CLAUDE.md), [AGENTS.md](../../AGENTS.md),
[the integrity rules](../../.claude/AI_INTEGRITY_RULES.md),
[the collaboration protocol](../../.claude/SQUAD_PROTOCOL.md),
[the coding-agent guide](../../.claude/CLAUDE_CODE_GUIDE.md), all eight squad and
nine council references, and the project skills README precedence note.

Aligned the instruction sections of [GOAL.md](../../GOAL.md),
[the task shepherd protocol](../state/tasks.md#shepherd-protocol),
[the authority map](../strategy/authority-map.md),
[the card protocol](../plan/cards/README.md), the task graph maintenance note and
a supersession header on the historical execution playbook.

The September 5 founder aesthetic paragraphs were moved verbatim into
[the product experience convention](../../.claude/conventions/product-experience.md).
Burke's sublime, clear agency, rejected/unapproved targets and Blake's aesthetic
judgment remain explicit. The shared Activity mandate, strict TypeScript/no
`any`, truthful claims, meaningful regression tests, tenancy/authorization,
provenance, current reconstruction/device targets and explicit commit pathspecs
remain. The latest GOAL amendment and freeze/spending paragraph are unchanged.

Application source, dependency manifests, model settings, permission settings,
vendored skill bodies/licenses and other worktrees were not edited by this task.
Existing changes in the shared tree were preserved, including the recent loading
and aesthetic additions. Another session allocated T-597 while this review ran;
its Blender task was preserved and this work uses T-598.

## Evidence and validation

- Read-only independent policy review and separate workflow review checked the
  final instructions and all persona headers. One retained trigger-only reading
  restriction was caught and changed to relevance-based routing.
- Documentation validation checks local Markdown links, persona precedence,
  retained gotcha references, verbatim founder paragraphs, GOAL constraints and
  preservation of all 551 task rows present at the start.
- `git diff --check` passes under the repository's normal Windows Git settings.
  An initial validator run incorrectly disabled CRLF normalization; the validator
  was corrected and the original failed receipt retained.
- Core plus integrity text decreased from 4,218 to 2,680 whitespace-delimited words
  (about 36%). Persona files decreased from 90,855 bytes at HEAD to 39,641 working
  bytes (about 56%). These are instruction-size measurements, not quality scores.
- No application test suite was run because no executable behavior changed.
  This is a policy/consistency review, not a model benchmark or product acceptance.

The independent review considered small prerequisite fixes, unavailable plugins,
stale design/spending cards, documentation-only changes, substantive auth/UI work,
local architecture experiments and protected external actions. The resulting
rules permit useful autonomy while keeping evidence and authorization boundaries.

Local validation script and receipts:
`D:/claude/ai-instructions-20260906/validate_policy.py` and
`D:/claude/ai-instructions-20260906/validation.json`. Pre-edit policy snapshots are
under that directory's `before/` folder. An existing duplicate T-484 in the task
ledger was observed and left outside this scoped revision.

## Documentation basis and adoption

Current OpenAI guidance recommends auditing conflicting instructions, explicitly
encouraging follow-through, purposeful delegation and proportionate testing.
These recommendations support the direction of the rewrite; they do not prove
a performance gain for this repository.
[OpenAI model prompting guidance](https://developers.openai.com/api/docs/guides/latest-model).

Codex assembles its instruction chain at run/session startup. Existing sessions
should reread the changed policy; separate worktrees need the revision applied
before it can govern their files. No other session or worktree was restarted or
updated by this task.
[Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

Changes are local and uncommitted. No push, deployment, external communication or
paid compute was performed for this instruction review.

