# Production Monitoring Checklist

Date: 2026-06-12
Status: checklist, not proof of completed external monitoring
Owner: Venviewer engineering / operations

This checklist records what production monitoring must show before a release is considered operationally observable. It does not claim that any external monitor, Sentry project, or alert route exists until the item is marked with dated evidence.

## Runtime Probes

| Probe | Purpose | Expected result |
|---|---|---|
| `GET /health/live` | Process liveness. | `200` with `status: ok`. |
| `GET /health/ready` | Database readiness. | `200` when DB is reachable, `503 DB_UNREACHABLE` when not. |
| `GET /health/version` | Release provenance. | Version, git SHA, build timestamp, environment. |
| `GET /health/observability` | Monitoring env visibility. | Public-safe Sentry and metrics configured/missing status. |
| `GET /metrics` | Prometheus scrape. | `404` unless `METRICS_TOKEN` is configured and provided. |

## Sentry

- API env: `SENTRY_DSN`, optional `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`.
- Web env: `VITE_SENTRY_DSN`, optional source-map upload env from `packages/web/src/lib/production-env.ts`.
- Missing-env status is acceptable in local/dev, but production should show configured status before real client data is handled.
- Events must scrub request bodies, auth headers, cookies, query strings, and planner/client free text.
- Alert policy: immediate alert for unhandled production exceptions; warning when sustained error rate exceeds 1 percent for 5 minutes.

Evidence to record:

| Item | Evidence |
|---|---|
| API Sentry project created | Not recorded |
| Web Sentry project created | Not recorded |
| Production DSNs configured | Not recorded |
| Source map upload verified | Not recorded |
| Test error captured and scrubbed | Not recorded |
| Alert route tested | Not recorded |

## Uptime Monitoring

Configure an external monitor, such as Better Stack, Cloudflare, or another provider Blake approves.

Required checks:

- Web home page: `https://omnitwin-web.vercel.app/`
- API liveness: `https://omnitwinapi-production.up.railway.app/health/live`
- API readiness: `https://omnitwinapi-production.up.railway.app/health/ready`
- API observability: `https://omnitwinapi-production.up.railway.app/health/observability`

Policy:

- Interval: 1 minute.
- Alert after 2 consecutive failures.
- Escalation: Blake plus engineering channel until a formal incident channel exists.
- Readiness failure is a degraded API incident even if liveness is still green.

Evidence to record:

| Item | Evidence |
|---|---|
| Monitor provider | Not recorded |
| Monitor IDs | Not recorded |
| Alert destination | Not recorded |
| Test alert received | Not recorded |
| Last green check | Not recorded |

## Production Monitoring Release Gate

A release cannot be marked SS++ operationally green unless:

- `/health/live`, `/health/ready`, `/health/version`, and `/health/observability` are reachable.
- Sentry is either configured or explicitly accepted as missing for a non-production environment.
- Metrics are token-gated.
- External uptime checks exist for web and API.
- Alert routing has been tested.
- Incident owner and rollback path are known.
