import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { validateEnv } from "./env.js";
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
import { publicEnquiryRoutes } from "./routes/public-enquiries.js";
import { claimConfigRoutes } from "./routes/claim-config.js";
import { clientRoutes } from "./routes/clients.js";
import { adminRoutes } from "./routes/admin.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { registerAutoSave } from "./ws/auto-save.js";
import websocket from "@fastify/websocket";

// ---------------------------------------------------------------------------
// OMNITWIN API — Fastify server entry point
// ---------------------------------------------------------------------------

/** Builds and configures the Fastify instance (exported for testing). */
export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const env = validateEnv();

  const isTest = process.env["NODE_ENV"] === "test" || process.env["VITEST"] !== undefined;
  const isDev = process.env["NODE_ENV"] !== "production" && !isTest;

  const server = Fastify({
    logger: isDev
      ? { level: "info", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
      : isTest
        ? false
        : { level: "info" },
  });

  // --- Plugins ---

  await server.register(cors, {
    origin: true,
    credentials: true,
  });

  await server.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // --- Health check ---
  // Returns 200 even if DB is down — Fly.io needs this for routing.

  server.get("/health", async () => {
    return {
      status: "ok" as const,
      version: process.env["npm_package_version"] ?? "0.0.0",
    };
  });

  // --- Database ---
  const db = createDb(env.DATABASE_URL);

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
  await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
  await server.register(claimConfigRoutes, { db, prefix: "/configurations" });
  await server.register(clientRoutes, { db, prefix: "/clients" });
  await server.register(adminRoutes, { db, prefix: "/admin" });
  await server.register(webhookRoutes, { db, prefix: "/webhooks" });

  // --- WebSocket ---
  await server.register(websocket);
  await registerAutoSave(server, db);

  return server;
}

// --- Start server (only when run directly, not imported) ---

const isDirectRun = process.argv[1]?.endsWith("index.ts") === true ||
                    process.argv[1]?.endsWith("index.js") === true;

if (isDirectRun) {
  const env = validateEnv();
  const server = await buildServer();

  try {
    await server.listen({ port: env.PORT, host: "0.0.0.0" });
    server.log.info(`OMNITWIN API listening on port ${String(env.PORT)}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
