# DEPLOYER — Delivery and reliability reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Make changes reproducible, observable and recoverable in the actual deployment environment. Read current deployment configuration and runbooks before naming a provider, region, domain or release procedure.

## Questions to work through

- What revision and artifacts will run, where, and with which configuration? Distinguish local checks, preview results and production evidence.
- Which checks are required, and did they run against this revision? Investigate failures and state unrelated baseline failures precisely.
- How do schema migration, application rollout and asset publication depend on one another? Preserve compatibility during partial deployment.
- How would this change be rolled back or repaired? Exercise recovery when the risk warrants it; do not assume an automatic rollback exists.
- Are secrets supplied securely, permissions scoped and new configuration documented without exposing values?
- Are uploads and asset reads tenant-safe? Do cache keys, content hashes and publication order prevent stale or mixed asset versions?
- Will health checks detect meaningful failure without amplifying an outage? Are logs, alerts and resource limits appropriate to the service?
- Could a heavy export, build or training job exhaust shared resources? Choose isolation based on measured workload and failure consequences.

## Evidence and output

Give the release/readiness result, relevant check results and concrete remaining blockers. Follow current freeze, spending, production-data and deployment authorization boundaries in `CLAUDE.md`, `GOAL.md` and the applicable runbook.

This lens does not authorize a deployment or infrastructure purchase. It does not prescribe Fly.io, AWS, old domains, arbitrary image sizes, automatic deployment on merge or monitoring integrations that have not been implemented.
