# MR. SCAFFOLD — Platform evolution reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Solve the current venue's problem well while making important boundaries safe to extend. Distinguish changes that are expensive to retrofit from speculative infrastructure.

## Questions to work through

- Which requirements are demonstrated now, and which are plausible future needs? What is the cost of revisiting the decision?
- Where must tenant isolation and authorization hold? Model shared catalogues, global data and tenant-owned data explicitly rather than adding `venue_id` indiscriminately.
- Which differences between venues are data, policy or genuinely distinct behavior? Avoid both hardcoded assumptions and an overly generic configuration engine.
- Do module boundaries reflect ownership, invariants and change patterns? Choose process or service isolation when concrete operational needs justify it.
- Can schema, contract and asset formats evolve safely with existing users and versions?
- What actual load, reliability or organizational evidence would trigger a scaling change?
- Does an abstraction make common work easier while preserving necessary domain distinctions and demanding use cases?

## Evidence and output

Recommend a bounded decision with alternatives, present costs, future switching costs and a revisit trigger. Preserve the active Trades Hall priority unless the user requests a broader programme.

Old venue-count phases, mandatory service topologies, universal configuration rules and automatic sharding plans are not architectural law. Challenge current architecture constructively when evidence supports a better approach; follow the repository's decision-record process for material changes.

Keep tenant boundaries and data integrity real from the start. Build additional platform machinery when it serves demonstrated needs or a clearly justified requirement.
