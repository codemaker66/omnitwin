# Status Page Entry

Date: 2026-06-12
Status: draft component taxonomy
Owner: Venviewer engineering / operations

This document defines the public/internal component names to use when a status page is configured. It is not proof that a status page provider is active.

## Components

| Component | Dependency | Customer wording |
|---|---|---|
| Venviewer web app | Vercel web deployment | Planner and dashboard web experience. |
| Venviewer API | Railway API service | API for planner, client, and operations workflows. |
| Database | Neon Postgres | Stored venue, layout, event, and operations data. |
| Authentication | Clerk | Sign-in and role access. |
| Email delivery | Resend | Transactional notifications. |
| Runtime asset storage | Cloudflare R2 | Uploaded visual and package assets. |
| Monitoring | Sentry and uptime provider | Error and availability visibility. |

## Incident Update Template

Initial:

```text
We are investigating degraded Venviewer service on [component]. Current impact: [known impact]. Venue planning and operations data has not been declared lost. Next update by [time].
```

Update:

```text
We are continuing to investigate [component]. Current status: [finding]. Workaround: [if available]. Next update by [time].
```

Resolved:

```text
[Component] is back to expected operation. We will review monitoring, restore, and deployment evidence before closing the incident internally.
```

## Internal Closure Checklist

- Incident timeline recorded.
- Root cause or best current hypothesis recorded.
- Sentry issue or logs linked where available.
- Uptime monitor evidence linked where available.
- Data integrity checked if DB, storage, or migration paths were involved.
- Follow-up tasks created in `docs/state/tasks.md`.
