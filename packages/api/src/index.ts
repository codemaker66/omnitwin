import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { validateEnv } from "./env.js";
import { createDb } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { venueRoutes } from "./routes/venues.js";
import { spaceRoutes } from "./routes/spaces.js";
import { configurationRoutes } from "./routes/configurations.js";
import { placedObjectRoutes } from "./routes/placed-objects.js";
import { enquiryRoutes } from "./routes/enquiries.js";
import { uploadRoutes } from "./routes/uploads.js";

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

  await server.register(jwt, {
    secret: env.JWT_SECRET,
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

  // --- Routes ---
  await server.register(authRoutes, { db, prefix: "/auth" });
  await server.register(venueRoutes, { db, prefix: "/venues" });
  await server.register(spaceRoutes, { db, prefix: "/venues/:venueId/spaces" });
  await server.register(configurationRoutes, { db, prefix: "/configurations" });
  await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
  await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
  await server.register(uploadRoutes, { db, env, prefix: "/uploads" });

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
