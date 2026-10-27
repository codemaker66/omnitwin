# Disaster recovery

Written 26 October 2026 (T-068). A living page: change it when a provider, a
setting or a measured time changes. Times marked *measured* come from a real
run; the rest are estimates from how the provider works, to be replaced by a
measurement at the next drill.

## What the service stands on

| Part | Provider | What happens when it is down |
|---|---|---|
| Front door, planner, dashboards | Vercel (`venviewer.com`) | Nothing loads. |
| API | Railway, one replica, health `/health/ready` | Pages load but nothing saves, signs in past Clerk, or sends. |
| Database | Neon Postgres, aws-eu-west-2 | The API stays up and refuses: `/health/ready` fails. |
| Sign-in | Clerk | Staff and clients cannot sign in. Guests can still plan a room and send an enquiry. |
| DNS and email routing | Cloudflare (`venviewer.com` zone) | Every name stops resolving, including the API's. |
| Files and room captures | Cloudflare R2 | Uploads fail; captured rooms do not load. The planner's drawn room still works. |
| Code and deploys | GitHub, with Vercel and Railway deploying from `master` | No new release; the running service is unaffected. |

## How we find out

- **Sentry uptime monitors** (set up 25 October): `api.venviewer.com/health/live`
  and `venviewer.com` every 60 seconds, and `/health/ready` every 30 minutes
  (it queries the database, so a one-minute check would keep Neon's compute
  awake). The alert rule emails the Sentry organisation's active members on
  down, repeat and recovery. A fire drill on 25 October fired the rule within a
  minute.
- **Sentry issues** for errors in the web app and the API.
- **The venue team.** They will often notice first, so they have Blake's number.

## Scenarios

### A bad release (the most likely)

- **Signal:** errors rise in Sentry, or `/health/ready` fails after a deploy.
- **Recover:**
  - **Web:** Vercel, the project's Deployments, the last good one, **Instant Rollback**.
  - **API:** Railway, the service's Deployments, the last good one, **Redeploy**. Railway keeps the old container
    serving until the new one is ready, and `/health/ready` refuses while the database is behind the image's
    migrations (T-653).
  - **Migrations:** a migration that did damage is a database problem: go to the next section.
- **RTO:** about 5 minutes per service (estimate). **RPO:** nothing is lost.

### Data damaged or deleted by mistake

- **Signal:** a person reports it, or a check finds it.
- **Recover:** the database keeps a 7-day point-in-time history and a daily snapshot at 04:00 UTC, kept 14 days.
  The production branch is protected, so it cannot be deleted or reset by accident. Follow
  [the restore drill](backup-restore-drill.md):
  1. Restore to a new branch just before the damage, **never finalized**.
  2. Compare it with production.
  3. Copy back the rows that were lost; or, when the damage is wide, finalize the restore so the restored branch
     takes production's place (same endpoint, so the API's `DATABASE_URL` does not change).
- **Before the service reopens:** run the retention pass (`POST /admin/cleanup`) and repeat any erasure done by hand
  since the restore point. The privacy page promises that anything deleted since a backup is deleted again before
  the service reopens.
- **RTO:** 64 seconds to verified data in the 25 October drill (*measured*); about 15 minutes with the comparison
  and the copy-back (estimate). **RPO:** to the second, within 7 days.

### Neon region failure

- **Signal:** `/health/ready` fails; Neon's status page names aws-eu-west-2.
- **Recover:** wait for Neon. Today there is **no copy outside the region**: the history and the snapshots are
  Neon's, in the same region. A weekly `pg_dump` to storage with another provider would close the gap; that is
  an open decision for Blake, because the dump holds personal data and its home needs the same care as the
  database.
- **RTO and RPO:** Neon's. Tell the venue team at once (see below).

### Railway outage

- **Signal:** `/health/live` fails; Railway's status page.
- **Recover:** wait for Railway. The API is one container built from the repository's `Dockerfile`, so it could
  run elsewhere. It would need the production variables, which today live only in Railway; keeping a copy in a
  password manager is an open decision. Pages keep loading; saves and sign-in wait.
- **RTO:** Railway's, or about an hour to stand the container up elsewhere (estimate). **RPO:** nothing is lost,
  because the database is separate.

### Vercel outage

- **Signal:** the `venviewer.com` monitor fails; Vercel's status page.
- **Recover:** wait for Vercel. The web app is a static build (`packages/web`, output `dist`) and could be served
  by another static host behind the same DNS name; that has not been rehearsed.
- **RTO:** Vercel's. **RPO:** nothing is lost.

### Cloudflare outage, DNS or R2

- **Signal:** both monitors fail at once (DNS), or room captures and uploads fail (R2).
- **Recover:** wait for Cloudflare. The domain's DNS lives there, so moving it would take the registrar's change
  time as well. R2 holds uploads and the room captures; the planner's drawn rooms do not need them.
- **RTO:** Cloudflare's. **RPO:** nothing is lost unless R2 loses objects. Neither the upload bucket nor the
  published captures has a second copy that this page can vouch for (an open item).

### Clerk outage

- **Signal:** sign-in fails while the API is healthy.
- **Recover:** wait for Clerk. Guests can still plan and send enquiries; staff can read nothing that needs sign-in.
- **RTO:** Clerk's. **RPO:** nothing is lost, because accounts are linked to our own user rows.

### GitHub account compromise

- **Signal:** unexpected pushes, settings changes, or GitHub's security email.
- **Recover:**
  1. Change the password, and check two-factor and its recovery codes.
  2. Revoke every personal access token and OAuth app you do not recognise.
  3. Check the security log.
  4. Check the `master` ruleset and the Production environment's reviewer.
- **Limits on an attacker:** the ruleset requires a pull request and passing checks, and blocks force pushes and
  deletion. The Production environment needs Blake's approval before the migration job runs.
- **If a bad change reached `master`:** roll back as for a bad release.
- **Rotate the deploy integrations' access:** the Vercel and Railway GitHub apps, and `DATABASE_URL` in the
  repository's Actions secrets.
- **RTO:** an hour (estimate). **RPO:** nothing, because the running service and the database are separate.

## Telling people

There is no status page. During any outage longer than a few minutes, Blake
tells the Trades Hall events team by phone or email: what is down, what still
works (guests can usually still plan and enquire), and when he will next update
them. After it, a short note in that day's `docs/sessions/` log: what happened,
how it was found, how long it lasted, what was lost (if anything) and what
changes.

## Open items

- No copy of the database outside Neon's region.
- The production variables exist only in Railway.
- Neither the upload bucket nor the published captures has a verified second copy.
- A web or API move to another host has not been rehearsed.
