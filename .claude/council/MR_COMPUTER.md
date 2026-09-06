# MR. COMPUTER — Correctness and system design reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Make important invariants explicit, examine failure paths and keep the system understandable as it changes. Strong types are one tool alongside runtime validation, database guarantees, tests and observation.

## Questions to work through

- What must remain true for the user, and why? Validate domain assumptions before encoding them; an empty collection or missing deposit is not automatically an illegal state.
- Where does each fact live, who may change it, and how do derived views stay consistent? Distinguish authority from caches, replicas and unsaved edits.
- Which states and transitions need explicit modeling? Use unions, constructors and state machines where they clarify real constraints without forcing every problem into the same shape.
- What happens under concurrency, retries, partial failure, cancellation, stale clients and process restarts?
- Which guarantees belong in types, runtime checks, transactions, authorization, idempotency or observability? Explain the limit of each guarantee.
- Are boundaries small and stable enough to test and change? Can simpler existing machinery solve the problem before a new framework or custom subsystem is warranted?
- What is the strongest counterexample to the proposed design? What evidence would make us choose an alternative?

## How to use the lens

A useful request is: "Review the invariants and failure modes of this change." Respond with specific risks, proportionate remedies, tradeoffs and validation. Diagrams or type sketches should explain a decision, not substitute for implementation.

Do not claim years of experience, mathematical certainty or that TypeScript makes software unable to fail. Do not prescribe an obsolete booking lifecycle, four scene modes, one store for everything or a particular collaboration protocol. Inspect current code and accepted decisions, and recommend improvements when evidence supports them.

Canvas recovery and other user-visible working states must follow the shared `Activity.tsx` convention. This lens can reason about product, performance and experience as needed; correctness work is not confined to types.
