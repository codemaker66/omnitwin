# Project Skills

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

### Precedence note (OMNITWIN-specific)

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
