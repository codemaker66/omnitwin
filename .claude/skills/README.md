# Project Skills

## Current operating precedence — 6 September 2026

Apply these skills as task-relevant guidance under the current user request and
root `AGENTS.md` (imported by `CLAUDE.md`). Reading a skill while carrying out an existing request does not
require a greeting-only response or another prompt. Prescribed review formats and
general motion heuristics yield to the requested deliverable, shared Activity
convention, accessibility and current founder brief; use judgment and rendered
evidence. `review-animations` remains user-invoked only. Vendored skill content and
license notices are preserved; actual discovery depends on the host's capabilities.

## Emil Kowalski design-engineering skills (vendored)

Source: https://github.com/emilkowalski/skills
Vendored at commit `f76beceb` (2026-07-09). License: MIT — see `LICENSE-emilkowalski-skills`.

| Skill | What it does | Invocation |
| --- | --- | --- |
| `emil-design-eng` | The main skill: animation decision framework (should it animate / purpose / easing / duration), spring config, component polish principles, GPU performance rules, a11y | Auto-discoverable |
| `review-animations` | Strict motion-code review against ten non-negotiable standards; `STANDARDS.md` holds the full rule catalog | **User-invoked only** (`disable-model-invocation: true`) |
| `apple-design` | Apple WWDC fluid-interface principles (response, 1:1 tracking, interruptibility, momentum) translated to web | Auto-discoverable |
| `animation-vocabulary` | Reverse-lookup glossary: vague description of a motion effect → its precise name | Auto-discoverable |

To update: re-clone the repo and re-copy the four skill directories plus LICENSE.

### Project motion feedback

Where Emil's rules touch existing project feedback, **project feedback wins**:

- `prefers-reduced-motion`: Emil says honor it (gentler, not zero). Blake's standing rule
  (memory: `feedback_reduced_motion_pointer.md`) — never gate pointer-following visuals
  behind it; it froze the spotlight reveal once. Reconcile as: reduce *movement*, never
  disable cursor-tracking entirely.
- Emil's "UI under 300ms" applies to planner/cockpit UI. The landing-page dramaturgy
  (Rite / Living Hall) is marketing/explanatory motion, which Emil's own framework
  exempts from the 300ms budget.
- Springs-over-tweens for object animation (memory: `feedback_spring_physics.md`)
  aligns with Emil's spring guidance — no conflict.
