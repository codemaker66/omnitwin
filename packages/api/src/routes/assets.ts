import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import {
  RegisterAssetVersionInputSchema,
  splatExtensionForKey,
} from "@omnitwin/types";
import { assetDefinitions, assetVersions, runtimePackages } from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { authenticate, authorize } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Asset routes
//
// 1. GET  /assets — public, read-only furniture catalogue (no PII).
// 2. POST /assets/versions — admin-only. Registers a provenance-bearing
//    AssetVersion pointing at an R2 key (a real captured/processed splat
//    bundle). Fixture/demo keys are rejected. Optionally publishes a
//    RuntimePackage in the same call so the runtime can load it.
// 3. GET  /assets/runtime-packages/latest — public read. Returns the latest
//    published RuntimePackage (with its AssetVersion + a resolved asset URL)
//    so the runtime can render it, or null so the runtime falls back to the
//    procedural room. Honesty is carried by `assetVersion.evidenceStatus`;
//    this endpoint asserts nothing about legal/safety certification.
// ---------------------------------------------------------------------------

/** Resolve an R2 object key to a fetchable public URL, or null if R2 isn't configured. */
function resolveAssetUrl(env: Env, r2Key: string): string | null {
  if (env.R2_PUBLIC_URL === undefined) return null;
  return `${env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${r2Key.replace(/^\/+/, "")}`;
}

type AssetVersionRow = typeof assetVersions.$inferSelect;
type RuntimePackageRow = typeof runtimePackages.$inferSelect;

function serializeRuntimePackage(
  env: Env,
  pkg: RuntimePackageRow,
  version: AssetVersionRow,
): Record<string, unknown> {
  return {
    id: pkg.id,
    venueId: pkg.venueId,
    spaceId: pkg.spaceId,
    assetVersionId: pkg.assetVersionId,
    status: pkg.status,
    label: pkg.label,
    publishedAt: pkg.publishedAt,
    createdAt: pkg.createdAt,
    assetVersion: version,
    assetUrl: resolveAssetUrl(env, version.r2Key),
  };
}

export async function assetRoutes(
  server: FastifyInstance,
  opts: { db: Database; env: Env },
): Promise<void> {
  const { db, env } = opts;

  // GET /assets — public furniture catalogue.
  server.get("/", async () => {
    const rows = await db.select().from(assetDefinitions).orderBy(assetDefinitions.name);
    return { data: rows };
  });

  // POST /assets/versions — register a real runtime AssetVersion (admin only).
  server.post(
    "/versions",
    { preHandler: [authenticate, authorize("admin")] },
    async (request, reply) => {
      const parsed = RegisterAssetVersionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }

      const input = parsed.data;
      const splatExtension = splatExtensionForKey(input.r2Key);
      if (splatExtension === null) {
        // Defensive — the schema already enforces this.
        return reply.status(400).send({ error: "Unsupported asset extension", code: "VALIDATION_ERROR" });
      }

      const created = await db.transaction(async (tx) => {
        const [version] = await tx.insert(assetVersions).values({
          venueId: input.venueId,
          spaceId: input.spaceId ?? null,
          source: input.source,
          r2Key: input.r2Key,
          splatExtension,
          sha256: input.sha256,
          captureDate: input.captureDate,
          evidenceStatus: input.evidenceStatus,
          sizeBytes: input.sizeBytes ?? null,
          label: input.label ?? null,
          createdBy: request.user.id,
        }).returning();

        if (version === undefined) return null;

        let runtimePackage: RuntimePackageRow | null = null;
        if (input.publish) {
          const [pkg] = await tx.insert(runtimePackages).values({
            venueId: version.venueId,
            spaceId: version.spaceId,
            assetVersionId: version.id,
            status: "published",
            label: input.label ?? null,
            publishedAt: new Date(),
            createdBy: request.user.id,
          }).returning();
          runtimePackage = pkg ?? null;
        }

        return { version, runtimePackage };
      });

      if (created === null) {
        return reply.status(500).send({ error: "Failed to register asset version", code: "ASSET_REGISTER_FAILED" });
      }

      request.log.info({
        userId: request.user.id,
        assetVersionId: created.version.id,
        venueId: created.version.venueId,
        source: created.version.source,
        evidenceStatus: created.version.evidenceStatus,
        published: created.runtimePackage !== null,
      }, "asset version registered");

      return reply.status(201).send({
        data: {
          assetVersion: created.version,
          runtimePackage: created.runtimePackage === null
            ? null
            : serializeRuntimePackage(env, created.runtimePackage, created.version),
        },
      });
    },
  );

  // GET /assets/runtime-packages/latest — latest published package (public read).
  // Optional ?spaceId=<uuid> narrows to one room. Returns { data: null } when
  // nothing is published, which tells the runtime to use the procedural room.
  server.get("/runtime-packages/latest", async (request) => {
    const rawSpaceId = (request.query as { spaceId?: unknown }).spaceId;
    const spaceId = typeof rawSpaceId === "string" && rawSpaceId.length > 0 ? rawSpaceId : null;

    const whereClause = spaceId === null
      ? eq(runtimePackages.status, "published")
      : and(eq(runtimePackages.status, "published"), eq(runtimePackages.spaceId, spaceId));

    const [row] = await db
      .select({ pkg: runtimePackages, version: assetVersions })
      .from(runtimePackages)
      .innerJoin(assetVersions, eq(runtimePackages.assetVersionId, assetVersions.id))
      .where(whereClause)
      .orderBy(desc(runtimePackages.publishedAt))
      .limit(1);

    if (row === undefined) {
      return { data: null };
    }

    return { data: serializeRuntimePackage(env, row.pkg, row.version) };
  });
}
