import type { FastifyInstance, FastifyReply } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  AdminRoomsQuerySchema,
  AssetVersionSchema,
  CaptureSessionSchema,
  LatestRuntimePackageQuerySchema,
  PublicRoomRuntimeVisualSchema,
  RegisterCaptureSessionInputSchema,
  RegisterAssetVersionInputSchema,
  RegisterRuntimePackageInputSchema,
  RoomManifestQuerySchema,
  RoomManifestSchema,
  RoomAssetStatusSchema,
  RuntimeFileExtensionSchema,
  RuntimePackageSchema,
  TRADES_HALL_RUNTIME_ROOMS,
  assetKindAllowsExtension,
  isForbiddenAssetFixtureKey,
  splatExtensionForKey,
  type AssetVersion,
  type CaptureSession,
  type PublicRoomRuntimeVisual,
  type RegisterRuntimePackageInput,
  type RoomManifest,
  type RoomAssetStatus,
  type RuntimePackage,
} from "@omnitwin/types";
import {
  assetDefinitions,
  assetVersions,
  captureSessions,
  roomManifests,
  runtimePackages,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { authenticate, authorize } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Asset routes
//
// Public:
//   GET /assets
//   GET /assets/runtime-packages/latest?venue=trades-hall&room=grand-hall
//   GET /assets/runtime-packages/public-room-visual?venue=trades-hall&room=grand-hall
//
// Admin:
//   POST /admin/assets/capture-session
//   POST /admin/assets/register-version
//   POST /admin/assets/register-runtime-package
//   GET  /admin/assets/rooms?venue=trades-hall
//   GET  /admin/assets/room-manifests
// ---------------------------------------------------------------------------

type AssetVersionRow = typeof assetVersions.$inferSelect;
type CaptureSessionRow = typeof captureSessions.$inferSelect;
type RoomManifestRow = typeof roomManifests.$inferSelect;
type RuntimePackageRow = typeof runtimePackages.$inferSelect;

function dateToIso(value: Date): string {
  return value.toISOString();
}

function r2PublicPath(r2Key: string): string {
  return r2Key.replace(/^r2:/, "").replace(/^\/+/, "");
}

function resolveAssetUrl(env: Env, row: AssetVersionRow): string | null {
  if (row.externalUrl !== null) return row.externalUrl;
  if (row.r2Key === null) return null;
  if (env.R2_PUBLIC_URL === undefined) return null;
  return `${env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${r2PublicPath(row.r2Key)}`;
}

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

function serializeAssetVersion(row: AssetVersionRow): AssetVersion {
  return AssetVersionSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    captureSessionId: row.captureSessionId,
    assetKind: row.assetKind,
    sourceType: row.sourceType,
    fileName: row.fileName,
    fileExt: row.fileExt,
    r2Key: row.r2Key,
    externalUrl: row.externalUrl,
    mimeType: row.mimeType,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    evidenceStatus: row.evidenceStatus,
    runtimeStatus: row.runtimeStatus,
    notes: row.notes,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function serializeCaptureSession(row: CaptureSessionRow): CaptureSession {
  return CaptureSessionSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    captureSource: row.captureSource,
    captureDevice: row.captureDevice,
    captureDate: row.captureDate,
    operatorName: row.operatorName,
    sourceProjectName: row.sourceProjectName,
    notes: row.notes,
    status: row.status,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function serializeRoomManifest(row: RoomManifestRow): RoomManifest {
  return RoomManifestSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    displayName: row.displayName,
    matterportMasterReference: row.matterportMasterReference,
    alignmentStatus: row.alignmentStatus,
    primaryCaptureSource: row.primaryCaptureSource,
    notes: row.notes,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function assetStorageReferences(version: AssetVersionRow): readonly string[] {
  return [version.r2Key, version.externalUrl].filter((value): value is string => value !== null);
}

function isServablePrimaryVisualAsset(version: AssetVersionRow): boolean {
  if (version.assetKind !== "splat" || version.runtimeStatus !== "usable") return false;
  if (version.evidenceStatus === "rejected") return false;
  if (version.roomSlug === null) return false;
  const references = assetStorageReferences(version);
  if (references.length === 0 || references.some(isForbiddenAssetFixtureKey)) return false;

  const extensions = references.map(splatExtensionForKey);
  if (extensions.some((extension) => extension === null)) return false;

  const parsedFileExt = RuntimeFileExtensionSchema.safeParse(version.fileExt);
  if (!parsedFileExt.success) return false;

  return extensions.every((extension) => extension === parsedFileExt.data) &&
    assetKindAllowsExtension("splat", parsedFileExt.data);
}

function runtimePackageCanLoad(pkg: RuntimePackageRow): boolean {
  if (pkg.evidenceStatus === "rejected") return false;
  return pkg.runtimeStatus === "internal_ready" || pkg.runtimeStatus === "published";
}

function serializeRuntimePackage(
  env: Env,
  pkg: RuntimePackageRow,
  primaryVisualAssetVersion: AssetVersionRow | null,
): RuntimePackage {
  const serializedAsset = primaryVisualAssetVersion === null ? null : serializeAssetVersion(primaryVisualAssetVersion);
  return RuntimePackageSchema.parse({
    id: pkg.id,
    venueSlug: pkg.venueSlug,
    roomSlug: pkg.roomSlug,
    primaryVisualAssetVersionId: pkg.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: pkg.semanticMeshAssetVersionId,
    collisionAssetVersionId: pkg.collisionAssetVersionId,
    pointCloudAssetVersionId: pkg.pointCloudAssetVersionId,
    manifestJson: pkg.manifestJson,
    evidenceStatus: pkg.evidenceStatus,
    runtimeStatus: pkg.runtimeStatus,
    createdAt: dateToIso(pkg.createdAt),
    updatedAt: dateToIso(pkg.updatedAt),
    primaryVisualAssetVersion: serializedAsset,
    primaryVisualAssetUrl: primaryVisualAssetVersion === null ? null : resolveAssetUrl(env, primaryVisualAssetVersion),
  });
}

function unavailablePublicRoomRuntimeVisual(venueSlug: string, roomSlug: string): PublicRoomRuntimeVisual {
  return PublicRoomRuntimeVisualSchema.parse({
    venueSlug,
    roomSlug,
    runtimeVisualAvailable: false,
    visualUrl: null,
    visualLabel: "Visual preview",
    safeCopy: "Runtime room visual is not currently available for this public preview. Final details are confirmed by the venue team.",
    humanReviewRequired: true,
  });
}

function availablePublicRoomRuntimeVisual(
  venueSlug: string,
  roomSlug: string,
  visualUrl: string,
): PublicRoomRuntimeVisual {
  return PublicRoomRuntimeVisualSchema.parse({
    venueSlug,
    roomSlug,
    runtimeVisualAvailable: true,
    visualUrl,
    visualLabel: "Runtime visual preview",
    safeCopy: "Runtime visual available for planning preview. Final details are confirmed by the venue team.",
    humanReviewRequired: true,
  });
}

function isClientSafeVisualUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function resolvePublicRoomVisualUrl(row: AssetVersionRow): string | null {
  if (row.externalUrl === null) return null;
  return isClientSafeVisualUrl(row.externalUrl) ? row.externalUrl : null;
}

async function findAssetVersion(db: Database, id: string | null | undefined): Promise<AssetVersionRow | null> {
  if (id === null || id === undefined) return null;
  const [row] = await db
    .select()
    .from(assetVersions)
    .where(eq(assetVersions.id, id))
    .limit(1);
  return row ?? null;
}

function validateAssetReference(
  input: RegisterRuntimePackageInput,
  row: AssetVersionRow | null,
  field: "primaryVisualAssetVersionId" | "semanticMeshAssetVersionId" | "collisionAssetVersionId" | "pointCloudAssetVersionId",
): string | null {
  const requestedId = input[field] ?? null;
  if (requestedId === null) return null;
  if (row === null) return `${field} does not exist.`;
  if (row.venueSlug !== input.venueSlug || row.roomSlug !== input.roomSlug) {
    return `${field} must reference an asset from the same venue and room.`;
  }
  if (row.evidenceStatus === "rejected" || row.runtimeStatus === "rejected" || row.runtimeStatus === "archived") {
    return `${field} must not reference a rejected or archived asset.`;
  }
  if (runtimePackageInputCanLoad(input) && row.runtimeStatus !== "usable") {
    return `${field} must reference a usable asset before the package can be loadable.`;
  }
  return null;
}

function runtimePackageInputCanLoad(input: RegisterRuntimePackageInput): boolean {
  return input.runtimeStatus === "internal_ready" || input.runtimeStatus === "published";
}

function validatePrimaryVisualAsset(input: RegisterRuntimePackageInput, row: AssetVersionRow | null): string | null {
  const baseError = validateAssetReference(input, row, "primaryVisualAssetVersionId");
  if (baseError !== null) return baseError;
  if ((input.primaryVisualAssetVersionId ?? null) === null) return null;
  if (row === null) return "primaryVisualAssetVersionId does not exist.";
  if (!isServablePrimaryVisualAsset(row)) {
    return "primaryVisualAssetVersionId must reference a non-fixture splat asset with a supported Spark file extension.";
  }
  return null;
}

function firstValidationMessage(messages: readonly (string | null)[]): string | null {
  return messages.find((message): message is string => message !== null) ?? null;
}

function latestPackageByRoom(rows: readonly RuntimePackageRow[]): Map<string, RuntimePackageRow> {
  const byRoom = new Map<string, RuntimePackageRow>();
  for (const row of rows) {
    if (!byRoom.has(row.roomSlug)) {
      byRoom.set(row.roomSlug, row);
    }
  }
  return byRoom;
}

function roomSplatStatus(defaultCopy: string, splatExists: boolean): string {
  return splatExists ? "registered splat asset" : defaultCopy;
}

function runtimePackageStatusCopy(pkg: RuntimePackageRow | undefined): string {
  if (pkg === undefined) return "no runtime package registered";
  switch (pkg.runtimeStatus) {
    case "draft":
      return "runtime package draft";
    case "internal_ready":
      return "runtime package internal ready";
    case "published":
      return "runtime package published";
    case "archived":
      return "runtime package archived";
  }
  return "runtime package status unavailable";
}

function runtimePackageSafeCopy(defaultCopy: string, pkg: RuntimePackageRow | undefined): string {
  if (pkg === undefined) return defaultCopy;
  if (!runtimePackageCanLoad(pkg)) return "Runtime package registered, not ready to load";
  switch (pkg.evidenceStatus) {
    case "unverified":
      return "Runtime asset loaded, not yet verified/signed";
    case "machine_checked":
      return "Runtime asset loaded, machine checked; human review required";
    case "human_reviewed":
      return "Runtime asset loaded, human reviewed";
    case "rejected":
      return "Runtime asset rejected in review - not loaded";
  }
  return "Runtime package registered, human review required";
}

function roomStatusNextAction(defaultAction: string, splatExists: boolean, pkg: RuntimePackageRow | undefined): string {
  if (!splatExists) return defaultAction;
  if (pkg === undefined) return "Register a runtime package for this room";
  if (!runtimePackageCanLoad(pkg)) return "Review runtime package status before loading";
  return "Open the internal runtime view";
}

function buildRoomAssetStatuses(
  venueSlug: string,
  manifests: readonly RoomManifestRow[],
  splatRows: readonly AssetVersionRow[],
  packageRows: readonly RuntimePackageRow[],
): readonly RoomAssetStatus[] {
  const manifestByRoom = new Map(manifests.map((manifest) => [manifest.roomSlug, manifest]));
  const splatRooms = new Set(splatRows
    .filter((row) => row.assetKind === "splat" && row.roomSlug !== null && row.runtimeStatus !== "archived")
    .map((row) => row.roomSlug as string));
  const packageByRoom = latestPackageByRoom(packageRows);
  const defaults = venueSlug === "trades-hall" ? TRADES_HALL_RUNTIME_ROOMS : [];

  return defaults.map((room) => {
    const manifest = manifestByRoom.get(room.slug);
    const pkg = packageByRoom.get(room.slug);
    const splatExists = splatRooms.has(room.slug);
    return RoomAssetStatusSchema.parse({
      venueSlug,
      roomSlug: room.slug,
      displayName: manifest?.displayName ?? room.displayName,
      roomGroup: room.roomGroup,
      defaultStatus: room.defaultStatus,
      captureStatus: room.captureStatus,
      registryRuntimeStatus: room.registryRuntimeStatus,
      publicShowcaseEnabled: room.publicShowcaseEnabled,
      internalVisualEnabled: room.internalVisualEnabled,
      primaryCaptureSource: manifest?.primaryCaptureSource ?? room.primaryCaptureSource,
      currentState: room.currentState,
      splatStatus: roomSplatStatus(room.safeCopy, splatExists),
      splatExists,
      runtimePackageStatus: runtimePackageStatusCopy(pkg),
      runtimePackageExists: pkg !== undefined,
      evidenceStatus: pkg?.evidenceStatus ?? null,
      runtimeStatus: pkg?.runtimeStatus ?? null,
      nextAction: roomStatusNextAction(room.nextAction, splatExists, pkg),
      safeCopy: runtimePackageSafeCopy(room.safeCopy, pkg),
    });
  });
}

export async function assetRoutes(
  server: FastifyInstance,
  opts: { db: Database; env: Env },
): Promise<void> {
  const { db, env } = opts;

  server.get("/", async () => {
    const rows = await db.select().from(assetDefinitions).orderBy(assetDefinitions.name);
    return { data: rows };
  });

  server.get("/runtime-packages/latest", async (request, reply) => {
    const parsedQuery = LatestRuntimePackageQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return validationError(reply, parsedQuery.error.issues);
    }

    try {
      const [row] = await db
        .select({ pkg: runtimePackages, primaryVisualAssetVersion: assetVersions })
        .from(runtimePackages)
        .innerJoin(assetVersions, eq(runtimePackages.primaryVisualAssetVersionId, assetVersions.id))
        .where(and(
          eq(runtimePackages.venueSlug, parsedQuery.data.venue),
          eq(runtimePackages.roomSlug, parsedQuery.data.room),
          inArray(runtimePackages.runtimeStatus, ["internal_ready", "published"]),
          eq(assetVersions.runtimeStatus, "usable"),
        ))
        .orderBy(desc(runtimePackages.updatedAt), desc(runtimePackages.createdAt))
        .limit(1);

      if (
        row === undefined ||
        !runtimePackageCanLoad(row.pkg) ||
        !isServablePrimaryVisualAsset(row.primaryVisualAssetVersion)
      ) {
        return { data: null };
      }

      return { data: serializeRuntimePackage(env, row.pkg, row.primaryVisualAssetVersion) };
    } catch (error: unknown) {
      request.log.warn({
        err: error,
        venueSlug: parsedQuery.data.venue,
        roomSlug: parsedQuery.data.room,
      }, "runtime package registry lookup unavailable; returning empty runtime package state");
      return { data: null };
    }
  });

  server.get("/runtime-packages/public-room-visual", async (request, reply) => {
    const parsedQuery = LatestRuntimePackageQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return validationError(reply, parsedQuery.error.issues);
    }

    const unavailable = unavailablePublicRoomRuntimeVisual(parsedQuery.data.venue, parsedQuery.data.room);

    try {
      const [row] = await db
        .select({ pkg: runtimePackages, primaryVisualAssetVersion: assetVersions })
        .from(runtimePackages)
        .innerJoin(assetVersions, eq(runtimePackages.primaryVisualAssetVersionId, assetVersions.id))
        .where(and(
          eq(runtimePackages.venueSlug, parsedQuery.data.venue),
          eq(runtimePackages.roomSlug, parsedQuery.data.room),
          inArray(runtimePackages.runtimeStatus, ["internal_ready", "published"]),
          eq(assetVersions.runtimeStatus, "usable"),
        ))
        .orderBy(desc(runtimePackages.updatedAt), desc(runtimePackages.createdAt))
        .limit(1);

      if (
        row === undefined ||
        !runtimePackageCanLoad(row.pkg) ||
        !isServablePrimaryVisualAsset(row.primaryVisualAssetVersion)
      ) {
        return { data: unavailable };
      }

      const visualUrl = resolvePublicRoomVisualUrl(row.primaryVisualAssetVersion);
      if (visualUrl === null) {
        return { data: unavailable };
      }

      return {
        data: availablePublicRoomRuntimeVisual(parsedQuery.data.venue, parsedQuery.data.room, visualUrl),
      };
    } catch (error: unknown) {
      request.log.warn({
        err: error,
        venueSlug: parsedQuery.data.venue,
        roomSlug: parsedQuery.data.room,
      }, "public room runtime visual lookup unavailable; returning safe fallback state");
      return { data: unavailable };
    }
  });
}

export async function adminAssetRoutes(
  server: FastifyInstance,
  opts: { db: Database; env: Env },
): Promise<void> {
  const { db, env } = opts;

  server.post(
    "/capture-session",
    { preHandler: [authenticate, authorize("admin")] },
    async (request, reply) => {
      const parsed = RegisterCaptureSessionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data;
      const [session] = await db.insert(captureSessions).values({
        venueSlug: input.venueSlug,
        roomSlug: input.roomSlug ?? null,
        captureSource: input.captureSource,
        captureDevice: input.captureDevice ?? null,
        captureDate: input.captureDate ?? null,
        operatorName: input.operatorName ?? null,
        sourceProjectName: input.sourceProjectName ?? null,
        notes: input.notes ?? null,
        status: input.status,
      }).returning();

      if (session === undefined) {
        return reply.status(500).send({ error: "Failed to register capture session", code: "CAPTURE_SESSION_REGISTER_FAILED" });
      }

      request.log.info({
        userId: request.user.id,
        captureSessionId: session.id,
        venueSlug: session.venueSlug,
        roomSlug: session.roomSlug,
        captureSource: session.captureSource,
        status: session.status,
      }, "capture session registered");

      return reply.status(201).send({ data: serializeCaptureSession(session) });
    },
  );

  server.get(
    "/rooms",
    { preHandler: [authenticate, authorize("admin")] },
    async (request, reply) => {
      const parsedQuery = AdminRoomsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error.issues);
      }

      const venueSlug = parsedQuery.data.venue;
      const [manifestRows, splatRows, packageRows] = await Promise.all([
        db
          .select()
          .from(roomManifests)
          .where(eq(roomManifests.venueSlug, venueSlug))
          .orderBy(roomManifests.roomSlug),
        db
          .select()
          .from(assetVersions)
          .where(and(eq(assetVersions.venueSlug, venueSlug), eq(assetVersions.assetKind, "splat")))
          .orderBy(desc(assetVersions.updatedAt), desc(assetVersions.createdAt)),
        db
          .select()
          .from(runtimePackages)
          .where(eq(runtimePackages.venueSlug, venueSlug))
          .orderBy(desc(runtimePackages.updatedAt), desc(runtimePackages.createdAt)),
      ]);

      return { data: buildRoomAssetStatuses(venueSlug, manifestRows, splatRows, packageRows) };
    },
  );

  server.post(
    "/register-version",
    { preHandler: [authenticate, authorize("admin")] },
    async (request, reply) => {
      const parsed = RegisterAssetVersionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data;
      const [version] = await db.insert(assetVersions).values({
        venueSlug: input.venueSlug,
        roomSlug: input.roomSlug ?? null,
        captureSessionId: input.captureSessionId ?? null,
        assetKind: input.assetKind,
        sourceType: input.sourceType,
        fileName: input.fileName,
        fileExt: input.fileExt,
        r2Key: input.r2Key ?? null,
        externalUrl: input.externalUrl ?? null,
        mimeType: input.mimeType ?? null,
        sha256: input.sha256 ?? null,
        sizeBytes: input.sizeBytes ?? null,
        evidenceStatus: input.evidenceStatus,
        runtimeStatus: input.runtimeStatus,
        notes: input.notes ?? null,
      }).returning();

      if (version === undefined) {
        return reply.status(500).send({ error: "Failed to register asset version", code: "ASSET_REGISTER_FAILED" });
      }

      request.log.info({
        userId: request.user.id,
        assetVersionId: version.id,
        venueSlug: version.venueSlug,
        roomSlug: version.roomSlug,
        assetKind: version.assetKind,
        sourceType: version.sourceType,
        runtimeStatus: version.runtimeStatus,
      }, "asset version registered");

      return reply.status(201).send({ data: serializeAssetVersion(version) });
    },
  );

  server.post(
    "/register-runtime-package",
    { preHandler: [authenticate, authorize("admin")] },
    async (request, reply) => {
      const parsed = RegisterRuntimePackageInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data;
      const primaryVisualAsset = await findAssetVersion(db, input.primaryVisualAssetVersionId);
      const semanticMeshAsset = await findAssetVersion(db, input.semanticMeshAssetVersionId);
      const collisionAsset = await findAssetVersion(db, input.collisionAssetVersionId);
      const pointCloudAsset = await findAssetVersion(db, input.pointCloudAssetVersionId);
      const assetError = firstValidationMessage([
        validatePrimaryVisualAsset(input, primaryVisualAsset),
        validateAssetReference(input, semanticMeshAsset, "semanticMeshAssetVersionId"),
        validateAssetReference(input, collisionAsset, "collisionAssetVersionId"),
        validateAssetReference(input, pointCloudAsset, "pointCloudAssetVersionId"),
      ]);
      if (assetError !== null) {
        return validationError(reply, assetError);
      }

      const values = {
        venueSlug: input.venueSlug,
        roomSlug: input.roomSlug,
        primaryVisualAssetVersionId: input.primaryVisualAssetVersionId ?? null,
        semanticMeshAssetVersionId: input.semanticMeshAssetVersionId ?? null,
        collisionAssetVersionId: input.collisionAssetVersionId ?? null,
        pointCloudAssetVersionId: input.pointCloudAssetVersionId ?? null,
        manifestJson: input.manifestJson,
        evidenceStatus: input.evidenceStatus,
        runtimeStatus: input.runtimeStatus,
        updatedAt: new Date(),
      };
      const [existingPackage] = await db
        .select()
        .from(runtimePackages)
        .where(and(
          eq(runtimePackages.venueSlug, input.venueSlug),
          eq(runtimePackages.roomSlug, input.roomSlug),
        ))
        .orderBy(desc(runtimePackages.updatedAt), desc(runtimePackages.createdAt))
        .limit(1);

      const [pkg] = existingPackage === undefined
        ? await db.insert(runtimePackages).values(values).returning()
        : await db
          .update(runtimePackages)
          .set(values)
          .where(eq(runtimePackages.id, existingPackage.id))
          .returning();

      if (pkg === undefined) {
        return reply.status(500).send({ error: "Failed to register runtime package", code: "RUNTIME_PACKAGE_REGISTER_FAILED" });
      }

      request.log.info({
        userId: request.user.id,
        runtimePackageId: pkg.id,
        venueSlug: pkg.venueSlug,
        roomSlug: pkg.roomSlug,
        runtimeStatus: pkg.runtimeStatus,
      }, "runtime package registered");

      return reply.status(201).send({ data: serializeRuntimePackage(env, pkg, primaryVisualAsset) });
    },
  );

  server.get(
    "/room-manifests",
    { preHandler: [authenticate, authorize("admin")] },
    async (request, reply) => {
      const parsedQuery = RoomManifestQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error.issues);
      }

      const filters = parsedQuery.data.venue === undefined
        ? undefined
        : parsedQuery.data.room === undefined
          ? eq(roomManifests.venueSlug, parsedQuery.data.venue)
          : and(
            eq(roomManifests.venueSlug, parsedQuery.data.venue),
            eq(roomManifests.roomSlug, parsedQuery.data.room),
          );

      const baseQuery = db.select().from(roomManifests);
      const rows = filters === undefined
        ? await baseQuery.orderBy(roomManifests.venueSlug, roomManifests.roomSlug)
        : await baseQuery.where(filters).orderBy(roomManifests.venueSlug, roomManifests.roomSlug);

      return { data: rows.map(serializeRoomManifest) };
    },
  );
}
