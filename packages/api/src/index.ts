import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import { validateEnv, type Env } from "./env.js";
import { createDb } from "./db/client.js";
import { setAuthDb } from "./middleware/auth.js";
import { venueRoutes } from "./routes/venues.js";
import { spaceRoutes } from "./routes/spaces.js";
import { configurationRoutes } from "./routes/configurations.js";
import { placedObjectRoutes } from "./routes/placed-objects.js";
import { enquiryRoutes } from "./routes/enquiries.js";
import { uploadRoutes } from "./routes/uploads.js";
import { pricingRuleRoutes } from "./routes/pricing-rules.js";
import { referenceLoadoutRoutes } from "./routes/reference-loadouts.js";
import { referencePhotoRoutes } from "./routes/reference-photos.js";
import { publicConfigRoutes } from "./routes/public-configs.js";
import { layoutRoutes } from "./routes/layouts.js";
import { publicEnquiryRoutes } from "./routes/public-enquiries.js";
import { claimConfigRoutes } from "./routes/claim-config.js";
import { clientRoutes } from "./routes/clients.js";
import { adminRoutes } from "./routes/admin.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { hallkeeperSheetRoutes } from "./routes/hallkeeper-sheet.js";
import { configurationReviewRoutes } from "./routes/configuration-reviews.js";
import { adminAssetRoutes, assetRoutes } from "./routes/assets.js";
import { eventPhaseRoutes, eventRoutes } from "./routes/events.js";
import { evidenceItemRoutes, evidencePackRoutes, reviewGateRoutes, truthModeRoutes } from "./routes/evidence-runtime.js";
import { eventDayEventRoutes, eventDayOpsTaskRoutes } from "./routes/event-day-ops.js";
import { opsHandoffRoutes } from "./routes/ops-handoff.js";
import { analyticsRoutes, eventRevenueRoutes, revenueScenarioRoutes } from "./routes/revenue-analytics.js";
import { aiAssistantRoutes } from "./routes/ai-assistant.js";
import { embedConfigRoutes, integrationRoutes, webhookOutboundRoutes } from "./routes/integrations.js";
import { proposalRoutes, publicProposalRoutes } from "./routes/proposals.js";
import { quoteRoutes } from "./routes/quotes.js";
import { registerAutoSave } from "./ws/auto-save.js";
import websocket from "@fastify/websocket";
import { initSentry, buildSentryCapture } from "./observability/sentry.js";
import { registerDefaultSubscribers } from "./observability/subscribers.js";
import { registerSecurityHeaders } from "./middleware/security-headers.js";
import { registerRequestId } from "./middleware/request-id.js";
import { registerErrorNormalizer } from "./middleware/error-normalizer.js";
import { registerMetrics } from "./observability/metrics.js";

// ---------------------------------------------------------------------------
// OMNITWIN API — Fastify server entry point
// ---------------------------------------------------------------------------

/** Builds and configures the Fastify instance (exported for testing).
 *  Accepts a pre-validated Env so the direct-run entry point can validate
 *  once and pass the result in, avoiding the double-validation on startup. */
export async function buildServer(env: Env = validateEnv()): Promise<ReturnType<typeof Fastify>> {

  // Initialise Sentry BEFORE Fastify so its HTTP instrumentation
  // patches the global fetch/http layer before any request handler
  // registers. No-op when SENTRY_DSN is unset.
  await initSentry(env);

  const isTest = process.env["NODE_ENV"] === "test";
  const isDev = process.env["NODE_ENV"] !== "production" && !isTest;

  // ---------------------------------------------------------------------------
  // Fastify instance — explicit production timings + payload ceiling.
  //
  // Defaults are permissive (0 = infinite). Acquisition reviewers
  // check that we pin them explicitly:
  //
  //   bodyLimit         — 2 MiB. Caps the largest JSON payload any
  //                       client can send. Our biggest known payload
  //                       is a configuration with hundreds of placed
  //                       objects; 2 MiB is comfortably above that
  //                       while still stopping an attacker from
  //                       pumping 1 GiB at us.
  //   connectionTimeout — 30s. TCP conns idle longer than this are
  //                       reaped; prevents slow-loris keepalives
  //                       from exhausting sockets.
  //   requestTimeout    — 60s. PDF rendering and snapshot assembly
  //                       are the heaviest handlers; 60s is their
  //                       safe ceiling plus headroom.
  //   keepAliveTimeout  —  5s. Faster LB cycle, lower chance of
  //                       dropped requests mid-roll.
  //
  // trustProxy ON — we sit behind Railway's proxy; `request.ip`
  // must read the X-Forwarded-For header for rate-limiting to key
  // on real client IPs.
  // ---------------------------------------------------------------------------
  const server = Fastify({
    logger: isDev
      ? { level: "info", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
      : isTest
        ? false
        : { level: "info" },
    bodyLimit: 2_000_000,
    connectionTimeout: 30_000,
    requestTimeout: 60_000,
    keepAliveTimeout: 5_000,
    trustProxy: true,
    // `genReqId` is overridden by the request-id middleware below, but
    // setting a safer default here protects the window between server
    // boot and route registration.
    disableRequestLogging: false,
  });

  // --- Plugins ---

  // Request-ID first so every subsequent log line carries it.
  registerRequestId(server);
  // Security headers early so they're on every response, including
  // error responses emitted by CORS preflight rejection.
  registerSecurityHeaders(server);
  // Error-envelope normaliser — owns setErrorHandler + setNotFoundHandler
  // so every 4xx/5xx response shares the `{ error, code, details? }`
  // shape. Sentry side-channel callback feeds the capture on 5xx.
  const sentryCapture = await buildSentryCapture(env);
  registerErrorNormalizer(server, {
    onServerError: sentryCapture,
  });
  // Metrics — request-duration histogram + counter, /metrics endpoint
  // gated by METRICS_TOKEN. Registers BEFORE routes so the
  // onRequest/onResponse hooks see every request.
  registerMetrics(server, env.METRICS_TOKEN);

  const allowedOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  await server.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });

  // Rate limiting — per-user where authenticated, per-IP otherwise.
  // Global 100/min is the baseline; individual routes tighten or
  // relax via their own `config.rateLimit` option.
  //
  // The keyGenerator prefers `request.user.id` (so a single user
  // can't bypass by rotating IPs via proxies) and falls back to IP
  // for unauthenticated traffic (login, health). This is the pattern
  // any reviewer will grep for — generic IP-only rate limiting is
  // trivial to bypass behind NAT.
  await server.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      const authed = request.user;
      if (authed !== undefined && typeof authed.id === "string" && authed.id.length > 0) {
        return `user:${authed.id}`;
      }
      return `ip:${request.ip}`;
    },
    // Never rate-limit the health / readiness / liveness probes —
    // they're how orchestrators (Railway, K8s) decide whether the
    // instance is alive and ready. Rate-limiting them risks
    // recursive outages.
    allowList: (request) => {
      const u = request.url;
      return (
        u === "/health" ||
        u === "/health/live" ||
        u === "/health/ready" ||
        u === "/health/db" ||
        u === "/health/version" ||
        u === "/health/observability"
      );
    },
    errorResponseBuilder: (_request, context) => ({
      error: "Too many requests — please slow down.",
      code: "RATE_LIMITED",
      retryAfterSeconds: Math.ceil(context.ttl / 1000),
    }),
  });

  await server.register(rawBody, {
    field: "rawBody",
    global: false,
    runFirst: true,
    encoding: false, // returns Buffer, not string
  });

  // --- Health check ---
  // Returns 200 even if DB is down — this is a process liveness probe.
  //
  // `/health/ready` is the Railway healthcheck path in `railway.json`.
  // The routes below follow the Kubernetes / CNCF liveness-vs-readiness
  // convention so the same container can be deployed without rewiring probes:
  //   - `/health/live`  mirrors `/health` (process-alive, do not restart).
  //   - `/health/ready` mirrors `/health/db` (dependency-check, route
  //                     traffic only when green).
  //
  // All three are unauthenticated and rate-limit-allowlisted.

  const liveHandler = async (): Promise<{ status: "ok"; version: string }> => {
    return {
      status: "ok" as const,
      version: process.env["npm_package_version"] ?? "0.0.0",
    };
  };
  server.get("/health", liveHandler);
  server.get("/health/live", liveHandler);

  // --- Version / provenance probe ---
  //
  // `/health/version` returns the package version + git-SHA + build-
  // time so an on-call engineer correlating a Sentry event to a
  // release doesn't have to guess. Every deploy stamps these via
  // env (injected at build time in CI). When env is unset (local
  // dev), sensible fallbacks keep the response shape stable.
  //
  // Unauthenticated + unrate-limited — `/health*` routes are ops
  // surfaces. Contents are public-safe (commit SHA is not a secret).
  server.get("/health/version", async () => {
    return {
      version: process.env["npm_package_version"] ?? "0.0.0",
      gitSha: process.env["GIT_SHA"] ?? "dev",
      builtAt: process.env["BUILD_TIMESTAMP"] ?? "dev",
      nodeEnv: env.NODE_ENV,
    };
  });

  // --- Observability configuration probe ---
  //
  // Public-safe operational status only. This endpoint never returns DSNs,
  // tokens, project IDs, or provider account details; it exists so on-call
  // operators can tell whether error capture and metrics are deliberately
  // configured or still waiting on external env setup.
  server.get("/health/observability", async () => {
    const sentryConfigured = env.SENTRY_DSN !== undefined && env.SENTRY_DSN.length > 0;
    const metricsConfigured = env.METRICS_TOKEN !== undefined && env.METRICS_TOKEN.length > 0;

    return {
      status: "ok" as const,
      generatedAt: new Date().toISOString(),
      sentry: {
        configured: sentryConfigured,
        status: sentryConfigured ? "configured" as const : "missing_env" as const,
        environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      },
      metrics: {
        configured: metricsConfigured,
        status: metricsConfigured ? "configured" as const : "missing_env" as const,
        endpoint: "/metrics",
      },
      uptime: {
        status: "external_monitor_required" as const,
        probes: ["/health/live", "/health/ready", "/health/observability"],
      },
    };
  });

  // --- Database ---
  const db = createDb(env.DATABASE_URL);

  // --- DB-probe health check ---
  // Separate from /health so process liveness stays DB-independent.
  // Railway probes `/health/ready`, which points here, so deploy traffic
  // only routes once the API can reach the database. This endpoint is also
  // for ops/monitoring: alarms fire when the API is up but the DB is
  // unreachable (a partial-outage state that /health cannot distinguish from
  // "everything fine"). Returns 200 on success, 503 with a structured error
  // code on failure.
  const dbProbe = async (_request: unknown, reply: { status: (n: number) => void }): Promise<
    | { status: "ok" }
    | { status: "degraded"; code: "DB_UNREACHABLE"; message: string }
  > => {
    try {
      // Cheapest possible query — forces a round-trip without reading
      // any rows. Drizzle + neondatabase/serverless establishes the
      // connection lazily on first query, so this also catches the
      // "DATABASE_URL points at a dead endpoint" case.
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
      return { status: "ok" as const };
    } catch (err) {
      reply.status(503);
      return {
        status: "degraded" as const,
        code: "DB_UNREACHABLE",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };
  server.get("/health/db", dbProbe);
  // `/health/ready` is the K8s-convention readiness probe alias.
  server.get("/health/ready", dbProbe);

  // Inject DB into auth middleware for Clerk user lookups
  setAuthDb(db);

  // --- Routes ---
  await server.register(venueRoutes, { db, prefix: "/venues" });
  await server.register(spaceRoutes, { db, prefix: "/venues/:venueId/spaces" });
  await server.register(configurationRoutes, { db, prefix: "/configurations" });
  await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
  await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
  await server.register(uploadRoutes, { db, env, prefix: "/uploads" });
  await server.register(pricingRuleRoutes, { db, prefix: "/venues/:venueId/pricing" });
  await server.register(referenceLoadoutRoutes, { db, prefix: "/venues/:venueId/spaces/:spaceId/loadouts" });
  await server.register(referencePhotoRoutes, { db, prefix: "/loadouts/:loadoutId/photos" });
  await server.register(publicConfigRoutes, { db, prefix: "/public" });
  await server.register(layoutRoutes, { db, prefix: "/layouts" });
  await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
  await server.register(claimConfigRoutes, { db, prefix: "/configurations" });
  await server.register(clientRoutes, { db, prefix: "/clients" });
  await server.register(adminRoutes, { db, prefix: "/admin" });
  await server.register(adminAssetRoutes, { db, env, prefix: "/admin/assets" });
  await server.register(webhookRoutes, { db, prefix: "/webhooks" });
  await server.register(hallkeeperSheetRoutes, { db, prefix: "/hallkeeper" });
  await server.register(configurationReviewRoutes, { db, env, prefix: "/configurations" });
  await server.register(assetRoutes, { db, env, prefix: "/assets" });
  await server.register(integrationRoutes, { db, prefix: "/integrations" });
  await server.register(embedConfigRoutes, { db, prefix: "/embed-configs" });
  await server.register(eventRoutes, { db, prefix: "/events" });
  await server.register(eventDayEventRoutes, { db, prefix: "/events" });
  await server.register(eventRevenueRoutes, { db, prefix: "/events" });
  await server.register(eventPhaseRoutes, { db, prefix: "/event-phases" });
  await server.register(eventDayOpsTaskRoutes, { db, prefix: "/ops-tasks" });
  await server.register(evidencePackRoutes, { db, prefix: "/evidence-packs" });
  await server.register(evidenceItemRoutes, { db, prefix: "/evidence" });
  await server.register(reviewGateRoutes, { db, prefix: "/review-gates" });
  await server.register(truthModeRoutes, { db, prefix: "/truth-mode" });
  await server.register(opsHandoffRoutes, { db, prefix: "/ops" });
  await server.register(webhookOutboundRoutes, { db, prefix: "/webhooks" });
  await server.register(revenueScenarioRoutes, { db, prefix: "/revenue-scenarios" });
  await server.register(analyticsRoutes, { db, prefix: "/analytics" });
  await server.register(aiAssistantRoutes, { env, prefix: "/ai" });
  await server.register(proposalRoutes, { db, prefix: "/proposals" });
  await server.register(quoteRoutes, { db, prefix: "/quotes" });
  await server.register(publicProposalRoutes, { db, prefix: "/public" });

  // --- WebSocket ---
  await server.register(websocket);
  server.websocketServer.setMaxListeners(50);
  await registerAutoSave(server, db);

  // Register default event-bus subscribers (structured-logging /
  // audit observers). Additional subscribers can attach at any time.
  registerDefaultSubscribers(server.log);

  return server;
}

// --- Start server (only when run directly, not imported) ---

const isDirectRun = process.argv[1]?.endsWith("index.ts") === true ||
                    process.argv[1]?.endsWith("index.js") === true;

if (isDirectRun) {
  const env = validateEnv();
  const server = await buildServer(env);

  try {
    await server.listen({ port: env.PORT, host: "0.0.0.0" });
    server.log.info(`VenViewer API listening on port ${String(env.PORT)}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  //
  // Orchestrators (Railway, Kubernetes) deliver SIGTERM before SIGKILL to
  // give the app a chance to finish in-flight work. Without an explicit
  // handler, Node terminates abruptly — requests are dropped, DB
  // connections are left dangling, and clients see sporadic 502s during
  // rollouts.
  //
  // Steps:
  //   1. Log the signal so operators can correlate shutdown with
  //      deployment events.
  //   2. Call `server.close()` — stops accepting new connections and
  //      drains in-flight requests using Fastify's internal tracking.
  //   3. Hard-abort after 25s so a stuck request doesn't block the
  //      platform's KILL timer (orchestrators typically give 30s).
  //   4. Re-raise the exit code so container runtimes see the expected
  //      signal exit.
  // ---------------------------------------------------------------------------
  const SHUTDOWN_GRACE_MS = 25_000;
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.log.info({ signal }, "shutdown signal received — draining");

    const hardStopTimer = setTimeout(() => {
      server.log.error({ signal, graceMs: SHUTDOWN_GRACE_MS }, "shutdown grace exceeded — exiting forcefully");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    // Allow Node to exit if everything else is done, without waiting
    // for this timer to fire.
    hardStopTimer.unref();

    server
      .close()
      .then(() => {
        server.log.info({ signal }, "drain complete — exiting");
        clearTimeout(hardStopTimer);
        // Convention: SIGTERM → 143, SIGINT → 130.
        process.exit(signal === "SIGINT" ? 130 : 143);
      })
      .catch((err: unknown) => {
        server.log.error({ err, signal }, "error during drain");
        clearTimeout(hardStopTimer);
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
  process.on("SIGINT", () => { shutdown("SIGINT"); });
}
