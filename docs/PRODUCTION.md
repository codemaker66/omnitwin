# OMNITWIN — Production Setup Playbook


**The single source of truth for getting OMNITWIN in front of real paying customers.**


This file is written so a non-engineer can follow it. Every step says exactly what to click and what to send back. Tick the boxes as you go.


**Two kinds of tasks in this doc:**


- **🧑 Blake does** — requires you to sign in to an account, click buttons, pay something, or make a business decision. I can't do these.
- **🤖 Claude does** — I execute via MCPs, CLI, or code. You don't need to do anything beyond telling me "go".


**How to send me a credential:** just paste it into our chat. I'll copy it into the right `.env`/Railway/Vercel variable and never print it back. If you prefer, paste `KEY=value` lines and I'll parse them.


---


## Table of contents


- [Phase 1 — Accounts & credentials to create](#phase-1--accounts--credentials-to-create)
- [Phase 2 — Domain & DNS](#phase-2--domain--dns)
- [Phase 3 — Infrastructure I provision for you](#phase-3--infrastructure-i-provision-for-you)
- [Phase 4 — Pre-launch checklist](#phase-4--pre-launch-checklist)
- [Phase 5 — Launch day](#phase-5--launch-day)
- [Phase 6 — Post-launch ongoing ops](#phase-6--post-launch-ongoing-ops)
- [Phase 7 — Enterprise readiness (SOC 2, pen test, DPA)](#phase-7--enterprise-readiness-soc-2-pen-test-dpa)
- [Appendix A — Every service with pricing](#appendix-a--every-service-with-pricing)
- [Appendix B — Emergency / on-call reference](#appendix-b--emergency--on-call-reference)
- [Appendix C — Glossary](#appendix-c--glossary)


---


## Phase 1 — Accounts & credentials to create


Tick each box when done. After each one, **paste the credential(s) into chat with Claude** and he'll wire them up.


### 1.1 🧑 Domain registrar — `[BLAKE]`


**Goal:** own the domain the product will live on. Recommended: buy at Cloudflare (it's the cheapest registrar and integrates with the rest of the stack).


1. Go to https://www.cloudflare.com/products/registrar/
2. Search for your domain (e.g. `omnitwin.com`, `omnitwin.io`, `omnitwin.app`).
3. Buy it. Use a payment method you don't mind the renewal on — domains auto-renew.
4. ✅ Send Claude: **the domain you bought**.


> If you already own the domain elsewhere (Namecheap, GoDaddy, 123reg): you can either transfer it to Cloudflare (cheaper, better DNS) or just point the nameservers at Cloudflare. Either works.


### 1.2 🧑 Cloudflare account — `[BLAKE]`


**Goal:** DNS, CDN, WAF, DDoS protection. All free-tier suffices for launch.


1. If you bought the domain at Cloudflare, you already have an account — skip to step 3.
2. Otherwise: sign up at https://dash.cloudflare.com/sign-up → add your domain → follow the wizard to change your nameservers to Cloudflare's.
3. Once your domain is managed at Cloudflare, DNS changes happen inside the Cloudflare dashboard.
4. ✅ Send Claude: **"Cloudflare is set up"**. No token needed yet — I'll ask later if I need to automate DNS.


### 1.3 🧑 Railway account — `[BLAKE]`


**Goal:** host the API (Fastify server + migrations + metrics + WebSocket).


1. Go to https://railway.app/login
2. Sign in with GitHub (use the GitHub account that owns the `omnitwin2` repo).
3. Add a payment method — Railway is ~$5–$20/month for a small API. No free tier for production, but trial credits cover setup.
4. ✅ Send Claude: **"Railway account ready, linked to GitHub org `<name>`"**. I'll create the project via MCP.

> **Alternative: Fly.io (free tier).** Fly.io has a legitimate free tier — 3 small VMs + 160 GB/mo of outbound traffic at no cost. Good if you want to minimise running cost pre-revenue. Downside: I don't have a direct MCP for Fly.io, so you'd have to paste one CLI command I give you to initialise the project (takes 30 seconds). After first deploy, it's identical to Railway for day-to-day use. If you want this instead of Railway, send Claude: **"Use Fly.io instead of Railway"** and I'll generate a `fly.toml` + CLI walkthrough. Everything else (Vercel for web, Neon for DB, etc.) stays the same.

### 1.4 🧑 Vercel account — `[BLAKE]`


**Goal:** host the React/Vite web frontend.


1. Go to https://vercel.com/signup
2. Sign in with GitHub (same account as Railway).
3. Free Hobby tier works for launch. Pro ($20/mo) if you want team seats or custom support.
4. ✅ Send Claude: **"Vercel account ready"**.


### 1.5 🧑 Clerk production workspace — `[BLAKE]`


**Goal:** authentication for production (your current test instance won't accept real users).


1. Go to https://dashboard.clerk.com/
2. In the top-left workspace switcher, click **"+ Create application"**.
3. Name: `OMNITWIN Production`.
4. Enable: **Email + Password** and **Google OAuth** (add more providers later).
5. On the left sidebar, click **API Keys**. Copy:
   - `Publishable key` (starts `pk_live_...`)
   - `Secret key` (starts `sk_live_...`) — click the eye icon to reveal.
6. On the left sidebar, click **Webhooks** → **+ Add Endpoint**.
   - Endpoint URL: `https://api.<your-domain>/webhooks/clerk` (you won't have this URL yet — come back to this step after Phase 3).
   - Events: `user.created`, `user.updated`, `user.deleted`.
   - Save. Then click the newly-created endpoint and copy its **Signing Secret** (starts `whsec_...`).
7. ✅ Send Claude:
   ```
   CLERK_PUBLISHABLE_KEY=pk_live_...
   CLERK_SECRET_KEY=sk_live_...
   CLERK_WEBHOOK_SECRET=whsec_...   # once you've set the endpoint URL
   ```


### 1.6 🧑 Resend verified domain — `[BLAKE]`


**Goal:** send transactional email from a real address (`notifications@your-domain.com`) instead of Resend's shared sender.


1. Go to https://resend.com/domains
2. Sign in (you already have an account; the existing API key in `.env` works).
3. Click **"+ Add Domain"**. Enter your production domain (from Phase 1.1).
4. Resend shows you DNS records (SPF, DKIM, DMARC). Add them in Cloudflare DNS (DNS panel → Records → Add record → paste the values).
5. Back on Resend, click **Verify**. DNS changes propagate in ~15 minutes.
6. Once verified, you can send from `<anything>@your-domain.com`.
7. ✅ Send Claude: **"Resend domain `your-domain.com` verified"** and tell me which sender address to use (suggest `notifications@your-domain.com`).


### 1.7 🧑 Cloudflare R2 production bucket — `[BLAKE]`


**Goal:** separate prod bucket from dev, with a custom public URL on your domain.


1. Go to https://dash.cloudflare.com/ → R2.
2. Click **Create bucket**. Name: `omnitwin-prod`. Location: closest to users (EU for UK customers).
3. Inside the bucket: **Settings** → **Public access** → **Connect Custom Domain** → `uploads.your-domain.com`. Cloudflare auto-adds DNS.
4. Left sidebar → **R2 overview** → **Manage R2 API tokens** → **Create API token**. Permissions: `Object Read & Write`, scoped to bucket `omnitwin-prod`. Copy:
   - Access Key ID
   - Secret Access Key
   - Account ID (visible on the R2 overview page, top right)
5. ✅ Send Claude:
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET_NAME=omnitwin-prod
   R2_PUBLIC_URL=https://uploads.your-domain.com
   ```


### 1.8 🧑 Neon production branch — `[BLAKE]` or 🤖 I can do this


**Goal:** a separate database for production (isolated from dev so you can't accidentally break prod data while developing).


**Option A — let Claude do it (faster):** just send me the message **"Create the Neon production branch"**. I'll use the Neon MCP to create a branch called `production` off the current main, and hand you back its connection string.


**Option B — DIY:**
1. Go to https://console.neon.tech/
2. Click your project (the one with `ep-dawn-glitter`...).
3. Left sidebar → **Branches** → **Create Branch**. Name: `production`. Parent: `main`.
4. Click the new branch → copy the **pooled connection string** (the one that says `-pooler` in the hostname).
5. ✅ Send Claude: `DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require&channel_binding=require`


### 1.9 🧑 Sentry project — `[BLAKE]`


**Goal:** error tracking. Anytime the API crashes, you see it in Sentry with a stack trace, which request ID caused it, and who the user was.


1. Go to https://sentry.io/signup/
2. Create project → Platform: **Node.js**. Name: `omnitwin-api`.
3. On the "Install the SDK" screen you're shown a DSN — copy it (format: `https://abc123@o123.ingest.sentry.io/456`).
4. Create a second project for the frontend: Platform **React**. Name: `omnitwin-web`. Copy its DSN too.
5. ✅ Send Claude:
   ```
   SENTRY_DSN=https://...@o....ingest.sentry.io/...    # API
   VITE_SENTRY_DSN=https://...@o....ingest.sentry.io/...  # web
   ```


### 1.10 🧑 Stripe account — `[BLAKE]`


**Goal:** accept payment from customers. Billing is the only thing that turns "usage" into "revenue".


1. Go to https://dashboard.stripe.com/register
2. Fill out the business info. You **can** do this before incorporating — Stripe lets sole traders accept payment — but for billion-dollar customers you'll eventually want a Ltd company (see Phase 7.3).
3. Enable **Stripe Tax** (Settings → Tax) so VAT/GST gets calculated automatically.
4. Settings → Developers → API Keys. Copy:
   - Publishable key (`pk_live_...` or `pk_test_...` — use test while building)
   - Secret key (`sk_...`)
5. Settings → Developers → Webhooks → **+ Add endpoint**. URL: `https://api.your-domain.com/webhooks/stripe` (you'll set this up after Phase 3). Events: `customer.subscription.*`, `invoice.*`. Copy the signing secret (`whsec_...`).
6. ✅ Send Claude:
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PUBLISHABLE_KEY=pk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
7. **Decision I need from you:** your pricing model. Options:
   - **Per-venue flat fee**, e.g. £199/mo per venue with unlimited events
   - **Per-event**, e.g. £30/event hosted
   - **Per-seat** (staff users)
   - **Hybrid** (base fee + overage)


### 1.11 🧑 Better Stack account — `[BLAKE]`


**Goal:** uptime monitoring + status page + log aggregation + alerting, all in one free-tier tool.


1. Go to https://betterstack.com/
2. Sign up (free tier is generous).
3. **Uptime** → **+ Create monitor** → HTTPS → URL `https://api.your-domain.com/health/ready` → Check every 30s. Create a second one pointing at your web URL.
4. **Status pages** → **+ Create status page** → subdomain `status.your-domain.com`. Add the monitors above.
5. **Alerts** → set up email (and optionally SMS if you want to pay) to your phone.
6. ✅ Send Claude: **"Better Stack set up, uptime monitoring live at `status.your-domain.com`"**.


### 1.12 🧑 Grafana Cloud (metrics) — `[BLAKE]` — optional but recommended


**Goal:** scrape our `/metrics` endpoint into a dashboard showing request rate, latency, error rate, hallkeeper PDF renders, state-machine transitions.


1. Go to https://grafana.com/products/cloud/ → sign up for **Free tier**.
2. Create a stack. In **Prometheus** → **Send Metrics** → **Remote Write** or **Scrape URL** settings.
3. ✅ Send Claude: your Grafana Cloud Prometheus URL + API key.
4. (Alternative if you'd rather not: skip this for now. Railway's built-in metrics view is enough for month-1 ops.)


### 1.13 🧑 Plain (support desk) — `[BLAKE]` — do before first paying customer


**Goal:** a real support email inbox with queue management, instead of your personal Gmail.


1. Go to https://plain.com/ → sign up.
2. Configure an email domain (same as Resend — `support@your-domain.com`). Plain walks you through the DNS MX records.
3. ✅ Send Claude: **"Support email `support@your-domain.com` live"** — I'll wire it into the marketing site and the in-app "Contact Support" link.


### 1.14 🧑 PostHog (product analytics) — `[BLAKE]` — optional but highly recommended


**Goal:** know which features get used, where users drop off, A/B test flows.


1. Go to https://posthog.com/ → Cloud sign-up (free up to 1M events/month).
2. Create project: `OMNITWIN`.
3. Copy **Project API Key** and **host URL**.
4. ✅ Send Claude:
   ```
   VITE_POSTHOG_KEY=phc_...
   VITE_POSTHOG_HOST=https://eu.i.posthog.com
   ```


### 1.15 🧑 Legal — Termly (ToS + Privacy Policy) — `[BLAKE]`


**Goal:** legally required pages before you take anyone's data.


1. Go to https://termly.io/ → sign up (~$10/mo).
2. Generate: Terms of Service, Privacy Policy, Cookie Policy, DPA template.
3. Answer the wizard's questions honestly (where is data stored, what analytics do you use, etc.).
4. Termly gives you a hosted URL for each policy. You can also embed.
5. ✅ Send Claude: the four URLs. I'll link them from the web footer and email footers.


### 1.16 🧑 Business insurance — `[BLAKE]`


**Goal:** before a billion-dollar customer signs, they'll ask for proof of insurance.


1. Get quotes from a broker — Hiscox, Beazley, Simply Business (UK), or Hubspot Compass (US).
2. Policies you need: **Professional Indemnity / E&O** (minimum £1M, £2M for enterprise customers) + **Cyber Liability** (minimum £1M).
3. ✅ Send Claude: nothing — just keep the certificate somewhere you can send to a customer who asks.


### 1.17 🧑 Company incorporation — `[BLAKE]` — if you haven't already


1. UK: https://www.gov.uk/limited-company-formation (takes 24 hours, £50).
2. Open a business bank account (Starling, Monzo Business, Mettle — all modern, all free).
3. Register for VAT if you'll exceed £90k/year revenue (https://www.gov.uk/register-for-vat).
4. ✅ Send Claude: **company legal name + registered address** for ToS/Privacy/invoices.


---


## Phase 2 — Domain & DNS


After you own the domain and have Cloudflare set up, you'll need these DNS records. I'll tell you each one as I provision infra, but here's the shape:


| Host | Type | Target | Who sets it |
|---|---|---|---|
| `@` (root) | A or ALIAS | Vercel IP / ALIAS | 🤖 Claude via Vercel MCP |
| `www` | CNAME | Vercel's `cname.vercel-dns.com` | 🤖 Claude via Vercel MCP |
| `api` | CNAME | Railway's subdomain | 🧑 Blake (Cloudflare DNS panel) |
| `uploads` | CNAME | R2 public bucket | 🧑 Blake (R2 wizard handles it) |
| `status` | CNAME | Better Stack's status page host | 🧑 Blake |
| `@` (TXT) | TXT | SPF record for Resend | 🧑 Blake (Resend wizard shows value) |
| `resend._domainkey` | TXT | DKIM for Resend | 🧑 Blake |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; rua=mailto:postmaster@your-domain.com` | 🧑 Blake |


---


## Phase 3 — Infrastructure I provision for you


Once you've done Phase 1 and sent me the credentials, **tell me "go"** and I'll execute:


### 3.1 🤖 Railway project
- Create Railway project `omnitwin`.
- Add service `api`.
- Connect to your GitHub repo → branch `master` → auto-deploy on push.
- Inject environment variables.
- Generate a `*.up.railway.app` URL → you'll CNAME `api.your-domain.com` to this.
- Verify first deploy is green via Railway MCP logs.


### 3.2 🤖 Vercel project
- Create Vercel project pointing at `packages/web/`.
- Inject env vars: `VITE_API_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`.
- Add custom domain `your-domain.com` + `www.your-domain.com`.
- Enable Vercel's preview deployments for every PR.


### 3.3 🤖 Neon production branch
- Via Neon MCP, create branch `production` off current main.
- Apply migrations `0012` → `0016` (currently un-applied per memory).
- Verify schema via `describe_table_schema`.
- Hand you the connection string → I also paste it into Railway.


### 3.4 🤖 GitHub Actions CI
- Workflow `.github/workflows/ci.yml`:
  - On PR: typecheck + lint + test (all three packages in parallel)
  - Integration tests against a throwaway Postgres container
  - Block merge on failure
- Workflow `.github/workflows/deploy.yml`:
  - On push to `master`: apply new migrations → Railway auto-redeploys.


### 3.5 🤖 Dockerfile (for Railway)
- Multi-stage build: pnpm install → build → prod-only node_modules → slim `node:22-alpine` runtime.
- Non-root user.
- Health check pointing at `/health/live`.
- Signal handling (already wired in `index.ts`'s graceful shutdown).


### 3.6 🤖 Integration test harness
- `docker-compose.test.yml` spins up Postgres 16.
- Vitest integration suite connects to it, applies real migrations, runs a sample of route tests against the real DB (not mocks).
- Runs in CI on every PR.


### 3.7 🤖 `.env.production.example`
- Authoritative list of every variable for prod, grouped by service, with a one-line description each.
- Referenced from this doc.


### 3.8 🤖 Stripe billing wiring
- `/webhooks/stripe` endpoint verifying Svix-style signature.
- `subscriptions` table migration.
- `/billing/portal` route that issues a Stripe customer-portal session URL.
- Web-side "Upgrade" button.
- Pricing page (after you tell me the tiers).


### 3.9 🤖 Admin panel
- Already scaffolded at `/admin` routes; tighten to admin-only + add:
  - Customer list
  - "Log in as customer" impersonation (gated by admin role, audit-logged)
  - Usage dashboard per tenant
  - Manual subscription override


### 3.10 🤖 Staff per-row annotations tier-1
- The last deferred hallkeeper-sheet feature per the project memory.


### 3.11 🤖 Runbook
- `docs/RUNBOOK.md` — common incidents + recovery. Example entries:
  - "Users can't log in" → check Clerk status → check `/health/ready` → check `/webhooks/clerk` is receiving.
  - "DB unreachable" → check Neon status → confirm connection-string env var → rotate to backup branch if needed.
  - "Rate limit runaway" → check Prom `http_requests_total` for source → adjust `@fastify/rate-limit` config.
  - "Sentry flooded with 500s" → triage by `route.url` tag → check recent deploy for correlation.


### 3.12 🤖 Data-seeding script
- `packages/api/src/scripts/seed-customer.ts`: given a customer name + admin email, creates the tenant, first venue, default spaces, invites the admin.
- Run via `pnpm --filter @omnitwin/api seed-customer --name "Trades Hall" --email blake@...`.


---


## Phase 4 — Pre-launch checklist


Before you send the first paying customer a link, every box on this list must be ticked.


### Technical
- [ ] All Phase 3 items executed + verified green
- [ ] Production DB has all migrations applied
- [ ] `NODE_ENV=production` set in Railway
- [ ] All prod secrets set in Railway (no dev `pk_test_*`, no dev `sk_test_*`)
- [ ] CORS_ORIGINS set to `https://your-domain.com,https://www.your-domain.com`
- [ ] `/health`, `/health/ready`, `/health/live` all return 200
- [ ] `/metrics` returns 200 with Bearer token, 404 without
- [ ] Sentry receives a test error when you hit `/_test/error` (dev helper)
- [ ] Web bundle builds with no warnings in CI
- [ ] Integration tests pass against real Postgres
- [ ] E2E Playwright suite passes against staging
- [ ] Load test (k6 or autocannon): 100 concurrent users hit `/hallkeeper/:id` for 60s with p99 < 500ms


### Legal
- [ ] ToS published at `https://your-domain.com/terms`
- [ ] Privacy Policy published at `https://your-domain.com/privacy`
- [ ] Cookie banner live (from Termly)
- [ ] DPA template available on request
- [ ] Business insurance certificate in hand
- [ ] Company incorporated + bank account open
- [ ] Stripe account activated (past "activation" screen)


### Ops
- [ ] Uptime monitors firing on `/health/ready` failure
- [ ] Alerts routed to your phone / email
- [ ] Status page live at `status.your-domain.com`
- [ ] Support email `support@your-domain.com` routing to Plain
- [ ] Runbook published + readable to anyone on-call
- [ ] Backup strategy documented (Neon PITR + R2 versioning)
- [ ] SPF + DKIM + DMARC validated (https://mxtoolbox.com/spf.aspx)


### Security
- [ ] All default passwords rotated
- [ ] `JWT_SECRET` regenerated (use `openssl rand -hex 32`)
- [ ] No dev credentials in prod Railway env
- [ ] Clerk production instance locked to production domain only
- [ ] R2 bucket public-URL scope limited to `omnitwin-prod` only
- [ ] `security.txt` served at `https://your-domain.com/.well-known/security.txt` with a contact email
- [ ] External pen test scheduled (even if not yet completed — see Phase 7)


### Go / no-go gates
- [ ] All the above ticked
- [ ] Soft-launch with 1 internal test tenant for 48h
- [ ] No unresolved P0/P1 in Sentry over those 48h


---


## Phase 5 — Launch day


**The hour-by-hour playbook for the day the first paying customer gets their login.**


1. **T-24h:** Final integration test run in staging. Run the full Playwright E2E suite. Any failures → hold launch.
2. **T-12h:** Confirm all Phase 4 boxes ticked. Pre-announce status page link to customer.
3. **T-1h:** Deploy latest `master` to Railway. Verify `/health/ready` green. Verify Sentry receiving events.
4. **T-0:** Create the customer's tenant via the seed script. Send them their login email.
5. **T+1h:** Watch Sentry + Better Stack continuously. Any 5xx → triage.
6. **T+24h:** Post-launch retro. What went right, what went wrong, what to fix in week 2.


---


## Phase 6 — Post-launch ongoing ops


These aren't one-off. Build a weekly / monthly cadence.


### Weekly
- Triage any P2/P3 Sentry issues (P0/P1 should be real-time).
- Review `/metrics` for traffic growth + latency regressions.
- Rotate API tokens that show signs of overuse.
- Check Stripe for failed payments → dunning.


### Monthly
- Database vacuum review (Neon handles auto-vacuum; verify no bloat).
- Cost review: Railway, Vercel, Neon, R2, Resend, Cloudflare, Stripe fees.
- Dependency updates (`pnpm -r outdated`). Patch security advisories within 48h.
- Backup rehearsal: restore a Neon branch to a scratch project + smoke test.


### Quarterly
- Security review: rotate all service-account secrets.
- Pen-test refresh (if enterprise customers).
- SLA review: did we hit 99.9%? Publish uptime number.
- Roadmap review with customers.


### Yearly
- Major dependency upgrades (Node LTS, Fastify major, Drizzle major, React major).
- Legal: ToS refresh if business model shifted. Insurance renewal.
- SOC 2 recertification if you went that route.


---


## Phase 7 — Enterprise readiness (SOC 2, pen test, DPA)


Billion-dollar customers will ask for all three. Budget + timeline:


### 7.1 External penetration test
- **Vendor options:** Cure53 (best in class, €20–40k, 2-week lead), NCC Group (enterprise, £15–30k), Bishop Fox (US, $20–50k), HackerOne Challenge (crowd-sourced, $10–25k).
- **Deliverable:** report with findings classified Critical/High/Medium/Low, with remediation advice.
- **Our path:** fix everything Critical + High before it expires. Medium + Low we track. Share the report under NDA with prospects who ask.
- **Cadence:** annually minimum; every major release for enterprise.


### 7.2 SOC 2 Type I → Type II
- **Automation:** **Vanta** (https://www.vanta.com/) or **Drata** (https://drata.com/) — they integrate with your cloud accounts and auto-collect evidence. ~$10k/year for a small company.
- **Timeline:** Type I takes ~3 months of policy-writing + evidence. Type II requires 6–12 months of continuous evidence collection after that.
- **Auditor:** you need an independent CPA firm. Vanta/Drata has preferred auditors. Budget $15–25k per audit report.
- **Requires first:** ToS, Privacy Policy, DPA, incident response plan, business continuity plan, security policy, access control policy, change management policy, vendor management policy. Vanta/Drata gives templates.


### 7.3 Data Processing Agreement (DPA)
- **Template source:** the EU Commission's SCCs (Standard Contractual Clauses) are the gold standard — https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_en
- **Or buy:** Termly generates one based on your Phase 1.15 answers.
- **Signature flow:** prospect asks → you send PDF with your DPO contact filled in → they sign → you counter-sign → store in Google Drive / Dropbox / a signed-document vault.
- **DPO:** Data Protection Officer. If you have <250 employees and don't process sensitive data at scale, you may not legally need one. But having a named point-of-contact (`privacy@your-domain.com`) is table stakes.


### 7.4 Insurance uplift for enterprise
Before signing a billion-dollar-company contract, they'll require:
- **E&O / Professional Indemnity:** minimum £5M, often £10M
- **Cyber Liability:** minimum £5M
- **General Liability:** £2M
- **D&O (Directors & Officers):** £1–2M if incorporated


Expect premiums to rise from ~£1–2k/year (small business) to £8–15k/year at these limits.


### 7.5 Vendor / sub-processor transparency
Enterprise procurement teams will ask for a sub-processor list. Ours:


| Sub-processor | Purpose | Location |
|---|---|---|
| Neon | Database | EU (AWS eu-west-2) |
| Railway | API hosting | Varies (configurable) |
| Vercel | Web hosting | Global edge |
| Cloudflare | CDN, DNS, R2 storage | Global edge |
| Clerk | Authentication | US (configurable) |
| Resend | Transactional email | US |
| Sentry | Error tracking | EU region available |
| Stripe | Payment processing | Global |
| PostHog | Product analytics | EU Cloud available |
| Plain | Support ticketing | EU |
| Better Stack | Uptime + logs | EU |


Keep this list current; publish at `https://your-domain.com/trust/sub-processors`.


---

## Phase 8 — Billing & pricing (how much you charge customers)

This is how we turn "people use the app" into "money in the bank account." Everything below is a DRAFT — you need to sign off each number before I wire it into Stripe.

### 8.1 The public pricing ladder (for anyone who finds us)

Four levels, each a clear step up. Chosen to undercut Cvent (the enemy — they start at ~$5k/year with mandatory sales calls) while still being a real business.

| Tier | Price | What you get | Who it's for |
|---|---|---|---|
| **Free trial** | £0 for 14 days, no credit card | 1 venue, 3 staff, 20 events, all features | Anyone who wants to try it |
| **Starter** | **£99 / month** | 1 venue, 3 staff, 24 events per year, email support (reply within 24h) | Single community halls, small independent venues |
| **Pro** | **£299 / month** | 1 venue, 10 staff, unlimited events, API access, priority email support (reply within 4h), private Slack channel | Busy wedding venues, commercial halls |
| **Enterprise** | **From £999 / month** (custom quote) | Multiple venues, SSO with your company login, signed DPA, SOC 2 report, dedicated customer-success person, 99.9% uptime SLA, custom onboarding | Hotel groups, universities, event-management chains |

**How we bill it:** Stripe subscriptions, monthly or annual (10% off annual). VAT automatic via Stripe Tax. Customers can upgrade / downgrade / cancel themselves from their billing portal.

**Why these numbers work:**

- **£99 Starter** is small enough that a single community-hall manager can say yes without board approval (£1,188/year is below most "ask my line manager" thresholds in the UK).
- **£299 Pro** is where most venues naturally fit. It's £3,588/year — still comfortably in "director's signing authority" territory.
- **Enterprise** is custom because big companies expect it to be; they also want to negotiate. The £999/mo floor prevents you accidentally selling your most demanding customers too cheap.

**What we could add later (not at launch):**

- Annual pricing discount (10% off for 12 months up-front)
- £49/mo "Solo" tier for freelance event planners (not venues) — only if demand materialises
- Add-ons: extra venues (£79/mo each in Pro, bundled in Enterprise), extra staff seats (£15/mo each over the cap), white-label branding (£199/mo)

### 8.2 Trades Hall Glasgow — the at-cost rate

Trades Hall is Customer 0 and contributed to development. Their rate should reflect that — it should cover our actual cost of serving them, not our public price.

**Our actual cost to serve them alone (per month):**

| Line item | Why | Cost |
|---|---|---|
| Railway (API hosting) | One small API, low traffic | ~£7 |
| Neon (database) | Under 500 MB for a while; £0 while under, £15 once over | £0 → £15 |
| Vercel (web hosting) | Free hobby tier covers 1 venue easily | £0 |
| Cloudflare (DNS + CDN + R2) | Pennies for uploaded photos/PDFs | ~£1 |
| Clerk (auth) | Well under 10k MAU free tier | £0 |
| Resend (email) | Under 3k emails/mo free tier | £0 |
| Sentry (errors) | Free dev tier | £0 |
| Better Stack (uptime) | Free tier | £0 |
| Termly (legal pages) | £8/mo split across all customers → £8 while they're only customer | £0 → £8 |
| Stripe fees | 1.4% + 20p on £29 = 60p | ~£1 |
| **TOTAL marginal cost** | | **~£10–£30/mo** |

**Three offers to choose from:**

| Option | Offer | Why choose this |
|---|---|---|
| **A — Partner rate** | **£29/month, locked in for 3 years** | Simple. Covers our cost with a small buffer. Blake's bank balance doesn't take a hit. Trades Hall feels respected, not patronised. |
| **B — Gratitude year** | **Free for 12 months, then £29/mo** | Most generous. Perfect if you want to say "thank you for trusting us" loudly. Downside: gets awkward if they start asking for Enterprise-grade features during the free period. |
| **C — Case study trade** | **£19/month forever** in exchange for a public written case study + 2-minute video testimonial | Lowest recurring cost to them. Biggest marketing payoff for us — that testimonial is worth 3 new customers over the next year. Best if you're comfortable asking them. |

**My pick:** **Option C** if you're comfortable asking — the testimonial pays for itself ~10x over the first year. **Option A** if you'd rather not ask for a favour. **Option B** is the "friendliest" but leaves the most money on the table.

**What you need to decide:** which letter (A, B, or C)?

✅ Send Claude: **"Trades Hall rate: A / B / C"** and I'll wire it into Stripe as a coupon or custom price.

### 8.3 Free trial mechanics

Here's how the 14-day free trial works in practice:

1. New customer goes to `https://omnitwin.com/pricing` → clicks "Start free trial" on any paid tier.
2. They sign up with Clerk — email + password, or Google. **No credit card asked.**
3. They get full access to whichever tier they picked. No feature gating.
4. On day 10, we email them: "Your trial ends in 4 days. Add a card to keep going."
5. On day 14, if no card added, their workspace goes **read-only** — they can still see their data but can't create new events. This is kinder than deleting and recovers ~20% of expired trials.
6. If card added → seamless conversion to paid; no interruption.

**Why no credit card up front:** it roughly doubles trial conversion rates. The downside (tyre-kickers / bot signups) is manageable because our unit economics don't suffer much from idle accounts — they cost us pennies.

**Abuse protection:** rate-limit trial creation to 1 per IP per 24h. Abuse-flagged accounts auto-suspend.

### 8.4 What I'll build once you sign off

- Pricing page at `https://omnitwin.com/pricing`
- Stripe products + prices matching the tiers above
- Free-trial logic in the API (Clerk webhook → start 14-day trial → expiry job)
- Customer-billing portal (`/billing` in-app, wraps Stripe Portal)
- Admin override: you can set any customer's price manually (for Trades Hall + future sweetheart deals)
- Invoice footer: VAT number, company name + address from Phase 1.17, ToS/Privacy links

### 8.5 Revenue math (back of envelope)

If you hit these customer counts, here's the monthly recurring revenue (MRR):

| Customers | Breakdown | MRR | Annual |
|---|---|---|---|
| 1 (Trades Hall only) | 1 × Option A £29 | £29 | £348 |
| 10 | 1 × TH + 6 × Starter + 3 × Pro | £1,520 | £18,240 |
| 50 | 1 × TH + 25 × Starter + 20 × Pro + 4 × Enterprise | £12,520 | £150,240 |
| 200 | 1 × TH + 60 × Starter + 100 × Pro + 39 × Enterprise | £74,520 | £894,240 |

Your infrastructure cost at 200 customers is ~£2–3k/mo. Gross margin: ~95%. Enterprise customers are the lever — one signed £2k/mo enterprise deal equals twenty Starter customers.

---


## Appendix A — Every service with pricing


Sorted by "need it at launch" → "need it at enterprise".


### Launch-critical (total ~£80–200/month)
| Service | URL | Price tier we use | Notes |
|---|---|---|---|
| Cloudflare | https://cloudflare.com | ~£10/yr domain + free CDN + R2 pennies/GB | Domain + DNS + CDN + WAF + R2 |
| Railway | https://railway.app | ~$5–$20/mo | API hosting |
| Vercel | https://vercel.com | Free Hobby or $20/mo Pro | Web hosting |
| Neon | https://neon.tech | Free or $19/mo Launch tier | Postgres |
| Clerk | https://clerk.com | Free up to 10k MAU | Auth |
| Resend | https://resend.com | Free up to 3k/mo, then $20/mo | Email |
| Sentry | https://sentry.io | Free Dev tier, $26/mo Team | Error tracking |
| Better Stack | https://betterstack.com | Free tier | Uptime + status |
| Termly | https://termly.io | $10/mo | Legal pages |
| Stripe | https://stripe.com | 1.4% + 20p UK / 2.9% + 30¢ US | Payments |
| Business insurance | varies | £100–£200/mo | E&O + Cyber |


### Nice-to-have at launch (~£50–200/month additional)
| Service | URL | Price | Notes |
|---|---|---|---|
| PostHog | https://posthog.com | Free up to 1M events | Analytics |
| Plain | https://plain.com | Free tier → $49/mo | Support desk |
| Grafana Cloud | https://grafana.com | Free tier | Metrics dashboards |
| Cloudflare Workers | https://workers.cloudflare.com | $5/mo | Future edge compute |


### Enterprise-grade (required after first enterprise contract)
| Service | URL | Price | Notes |
|---|---|---|---|
| Vanta or Drata | https://vanta.com / https://drata.com | ~$10k/yr | SOC 2 automation |
| Pen test vendor | (see Phase 7.1) | £10–40k/yr | Annual pen test |
| SOC 2 auditor (CPA firm) | via Vanta/Drata | £15–25k per report | Independent audit |
| Upgraded insurance | via broker | £8–15k/yr | Higher limits |
| Legal counsel (ongoing) | varies | £5–20k/yr retainer | Enterprise contract review |


**Rough monthly run-rate:**
- Pre-launch / seed: ~£100/mo
- First paying customer: ~£200/mo
- 10 paying customers: ~£500–800/mo
- First enterprise customer: +£1–2k/mo for compliance tooling


---


## Appendix B — Emergency / on-call reference


### Who to call
- **Blake (primary on-call):** [phone number you'll fill in]
- **Backup on-call:** [tbd]


### Common incident URLs
| What's broken | Where to look first | Dashboard |
|---|---|---|
| API down | Railway project → Deployments tab | `https://railway.app/project/<id>` |
| DB down | Neon console → your project → Monitoring | `https://console.neon.tech/` |
| Auth broken | Clerk dashboard → Webhooks delivery log | `https://dashboard.clerk.com/` |
| Email not sending | Resend → Emails tab | `https://resend.com/emails` |
| Uploads failing | Cloudflare R2 → Metrics | `https://dash.cloudflare.com/` |
| Sentry flooded | Sentry → Issues | `https://sentry.io/organizations/<org>/issues/` |
| Payments broken | Stripe Dashboard → Developers → Webhooks | `https://dashboard.stripe.com/` |
| Customer can't access anything | Check `status.your-domain.com` + Better Stack | — |


### Status page template messages


**Investigating:**
> We're investigating reports of elevated error rates on [service]. Next update in 15 minutes.


**Identified:**
> We've identified the cause as [brief cause]. Working on a fix. Next update in 15 minutes.


**Monitoring:**
> A fix has been deployed. We're monitoring for recovery.


**Resolved:**
> The issue is resolved. We'll publish a post-mortem within 48 hours for incidents affecting multiple customers.


---


## Appendix C — Glossary


- **MAU** — Monthly Active Users. Clerk's free tier covers 10k.
- **PITR** — Point-In-Time Recovery. Neon can restore to any second within the retention window.
- **SCC** — Standard Contractual Clauses. EU-approved contract language for transferring data outside the EU.
- **DPO** — Data Protection Officer. Required under GDPR for some orgs.
- **DPA** — Data Processing Agreement. Contract between controller (customer) and processor (us).
- **SPF / DKIM / DMARC** — Three DNS records that prove email is from who it claims. Resend walks you through all three.
- **WAF** — Web Application Firewall. Cloudflare's free tier includes basic rules.
- **MCP** — Model Context Protocol. How Claude talks to Railway, Vercel, Neon, GitHub, etc. without credentials flowing through chat.
- **SLO / SLA** — Service Level Objective (internal target) / Agreement (contractual promise).


---


## What to send Claude to unblock each phase


| Claude needs | What you paste |
|---|---|
| Start Phase 3 | "Go — use my dev creds for staging first, we'll upgrade to prod creds later" |
| Provision prod | All the `KEY=value` lines from Phase 1 |
| Set up status page & alerts | "Better Stack is up, phone `+44...` is the alert target" |
| Wire Stripe billing | Your pricing tier decision (see 1.10) |
| Launch | "All Phase 4 boxes ticked — GO" |


---


**Last updated:** 2026-04-19 · Living doc — keep it current as we go.


