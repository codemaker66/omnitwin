# Venviewer — Claude Code entry point

@AGENTS.md

The imported file is the canonical project policy shared with other coding agents.
Follow its context routing; do not load the whole documentation tree at startup.

## Reasoning effort under ultracode

Ultracode runs the main conversation at `xhigh`. Put `max` where depth decides the outcome: in workflows,
give `effort: 'max'` to the agents that judge competing designs, adversarially review or verify findings,
and make the final check before a push to master; outside workflows, hand those steps to the
`deep-reviewer` subagent (`.claude/agents/deep-reviewer.md`), which always runs at `max`. Leave mechanical
stages at the inherited level or lower, and say in reports which steps ran at `max`.
