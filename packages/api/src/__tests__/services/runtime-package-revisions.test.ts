import { describe, expect, it, vi } from "vitest";
import type { CreateRuntimePackageRevisionInput, RegisterRuntimePackageInput } from "@omnitwin/types";
import {
  RuntimePackageRevisionConflictError,
  RuntimePackageRevisionIntegrityError,
  canonicalRuntimePackageRevisionPayload,
  computeRuntimePackageRevisionDigest,
  createRuntimePackageRevision,
  isRuntimePackageRevisionWriteConflict,
  type LockedRuntimePackageRevisionStore,
  type RuntimePackageRevisionRow,
  type RuntimePackageRevisionStore,
} from "../../services/runtime-package-revisions.js";

const NOW = new Date("2026-07-13T12:00:00.000Z");
const PRIMARY_ID = "10000000-0000-4000-8000-000000000001";
const SECONDARY_ID = "10000000-0000-4000-8000-000000000002";
const PACKAGE_ID = "10000000-0000-4000-8000-000000000010";

function packageInput(
  visualAssetVersionIds: readonly string[] = [PRIMARY_ID, SECONDARY_ID],
): RegisterRuntimePackageInput {
  return {
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    primaryVisualAssetVersionId: PRIMARY_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: PRIMARY_ID,
        visualAssetVersionIds: [...visualAssetVersionIds],
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
      compositionBasis: {
        decisionId: "reception-room-quality-fixed-fine-frontier-v1",
        decisionRef: "docs/reports/reception-room-hd-root-investigation.md",
        hierarchySha256: "f0a4c782cc0f031830404d409f5c0accdc30ed501fa562169206962ceee64f3e",
        format: "sog",
        level: "fine",
        lodSelectionPolicy: "fixed_fine_frontier_v1",
        expectedGaussianCount: 2_002_009,
      },
      generatedAt: "2026-07-13T12:00:00.000Z",
      notes: "Immutable revision service test fixture.",
    },
    evidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
  };
}

function revisionRow(
  input: RegisterRuntimePackageInput,
  revision: number,
  contentDigest = computeRuntimePackageRevisionDigest(input),
): RuntimePackageRevisionRow {
  return {
    id: PACKAGE_ID,
    venueSlug: input.venueSlug,
    roomSlug: input.roomSlug,
    revision,
    identityKind: "content_sha256",
    contentDigest,
    primaryVisualAssetVersionId: input.primaryVisualAssetVersionId ?? null,
    semanticMeshAssetVersionId: input.semanticMeshAssetVersionId ?? null,
    collisionAssetVersionId: input.collisionAssetVersionId ?? null,
    pointCloudAssetVersionId: input.pointCloudAssetVersionId ?? null,
    manifestJson: input.manifestJson,
    evidenceStatus: input.evidenceStatus,
    runtimeStatus: input.runtimeStatus,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface FakeStoreState {
  readonly byDigest: RuntimePackageRevisionRow | null;
  readonly latestRevision: number | null;
  readonly insertedRow?: RuntimePackageRevisionRow;
  readonly insertError?: Error;
}

function fakeStore(
  attempts: readonly FakeStoreState[],
  retryable = false,
): {
  readonly store: RuntimePackageRevisionStore;
  readonly locks: ReturnType<typeof vi.fn>;
  readonly inserts: ReturnType<typeof vi.fn>;
} {
  const inserts = vi.fn();
  let attemptIndex = 0;
  const locks = vi.fn(async (
    _venueSlug: string,
    _roomSlug: string,
    operation: (locked: LockedRuntimePackageRevisionStore) => Promise<unknown>,
  ): Promise<unknown> => {
    const state = attempts[Math.min(attemptIndex, attempts.length - 1)];
    attemptIndex += 1;
    if (state === undefined) throw new Error("Fake store requires at least one attempt state.");
    const locked: LockedRuntimePackageRevisionStore = {
      findByDigest: () => Promise.resolve(state.byDigest),
      findLatestRevision: () => Promise.resolve(state.latestRevision),
      insertRevision: (_input, _revision, _contentDigest) => {
        inserts(_input, _revision, _contentDigest);
        return state.insertError === undefined
          ? Promise.resolve(state.insertedRow ?? revisionRow(_input, _revision, _contentDigest))
          : Promise.reject(state.insertError);
      },
    };
    return operation(locked);
  });
  return {
    store: {
      withRoomLock: locks as RuntimePackageRevisionStore["withRoomLock"],
      isRetryableWriteConflict: () => retryable,
    },
    locks,
    inserts,
  };
}

describe("immutable runtime-package revisions", () => {
  it("computes deterministic SHA-256 over canonical manifest, assets, and statuses", () => {
    const first = packageInput();
    const sameContentDifferentConstructionOrder = {
      runtimeStatus: "internal_ready",
      evidenceStatus: "unverified",
      manifestJson: first.manifestJson,
      pointCloudAssetVersionId: null,
      collisionAssetVersionId: null,
      semanticMeshAssetVersionId: null,
      primaryVisualAssetVersionId: PRIMARY_ID,
      roomSlug: "reception-room",
      venueSlug: "trades-hall",
    } satisfies RegisterRuntimePackageInput;

    expect(canonicalRuntimePackageRevisionPayload(first)).toBe(
      canonicalRuntimePackageRevisionPayload(sameContentDifferentConstructionOrder),
    );
    expect(computeRuntimePackageRevisionDigest(first)).toMatch(/^[a-f0-9]{64}$/u);
    expect(computeRuntimePackageRevisionDigest(first)).toBe(
      computeRuntimePackageRevisionDigest(sameContentDifferentConstructionOrder),
    );
    expect(computeRuntimePackageRevisionDigest(first)).not.toBe(
      computeRuntimePackageRevisionDigest(packageInput([SECONDARY_ID, PRIMARY_ID])),
    );
  });

  it("assigns revision one when the room has no earlier package", async () => {
    const input: CreateRuntimePackageRevisionInput = { package: packageInput() };
    const harness = fakeStore([{ byDigest: null, latestRevision: null }]);
    const beforeInsert = vi.fn(() => Promise.resolve());

    const result = await createRuntimePackageRevision(harness.store, input, { beforeInsert });

    expect(result.created).toBe(true);
    expect(result.row.revision).toBe(1);
    expect(result.row.id).toBe(PACKAGE_ID);
    expect(result.contentDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(beforeInsert).toHaveBeenCalledTimes(1);
    expect(harness.inserts).toHaveBeenCalledWith(input.package, 1, result.contentDigest);
  });

  it("server-assigns the next monotonic room revision", async () => {
    const input: CreateRuntimePackageRevisionInput = { package: packageInput() };
    const harness = fakeStore([{ byDigest: null, latestRevision: 7 }]);

    const result = await createRuntimePackageRevision(harness.store, input);

    expect(result.row.revision).toBe(8);
    expect(harness.inserts).toHaveBeenCalledWith(input.package, 8, result.contentDigest);
  });

  it("returns an existing matching digest without inserting", async () => {
    const input: CreateRuntimePackageRevisionInput = { requestedRevision: 99, package: packageInput() };
    const existing = revisionRow(input.package, 4);
    const harness = fakeStore([{ byDigest: existing, latestRevision: 4 }]);
    const beforeInsert = vi.fn(() => Promise.reject(new Error("must not validate an existing digest")));

    const result = await createRuntimePackageRevision(harness.store, input, { beforeInsert });

    expect(result).toEqual({ row: existing, contentDigest: existing.contentDigest, created: false });
    expect(beforeInsert).not.toHaveBeenCalled();
    expect(harness.inserts).not.toHaveBeenCalled();
  });

  it("rejects a requested revision that is not the next number", async () => {
    const input: CreateRuntimePackageRevisionInput = { requestedRevision: 9, package: packageInput() };
    const harness = fakeStore([{ byDigest: null, latestRevision: 4 }]);
    const beforeInsert = vi.fn(() => Promise.resolve());

    await expect(createRuntimePackageRevision(harness.store, input, { beforeInsert })).rejects.toMatchObject({
      code: "RUNTIME_PACKAGE_REVISION_CONFLICT",
      requestedRevision: 9,
      expectedRevision: 5,
    });
    expect(beforeInsert).not.toHaveBeenCalled();
    expect(harness.inserts).not.toHaveBeenCalled();
  });

  it("retries a known concurrent write conflict and resolves a duplicate digest idempotently", async () => {
    const input: CreateRuntimePackageRevisionInput = { package: packageInput() };
    const existing = revisionRow(input.package, 5);
    const harness = fakeStore([
      { byDigest: null, latestRevision: 4, insertError: new Error("digest raced") },
      { byDigest: existing, latestRevision: 5 },
    ], true);

    const result = await createRuntimePackageRevision(harness.store, input);

    expect(result.created).toBe(false);
    expect(result.row).toBe(existing);
    expect(harness.locks).toHaveBeenCalledTimes(2);
    expect(harness.inserts).toHaveBeenCalledTimes(1);
  });

  it("retries a known conflict and server-assigns the next revision for different content", async () => {
    const input: CreateRuntimePackageRevisionInput = { package: packageInput() };
    const harness = fakeStore([
      { byDigest: null, latestRevision: 4, insertError: new Error("revision raced") },
      { byDigest: null, latestRevision: 5 },
    ], true);

    const result = await createRuntimePackageRevision(harness.store, input);

    expect(result.created).toBe(true);
    expect(result.row.revision).toBe(6);
    expect(harness.inserts).toHaveBeenCalledTimes(2);
  });

  it("does not disguise an unknown database failure as a revision conflict", async () => {
    const input: CreateRuntimePackageRevisionInput = { package: packageInput() };
    const failure = new Error("database unavailable");
    const harness = fakeStore([{ byDigest: null, latestRevision: 4, insertError: failure }]);

    await expect(createRuntimePackageRevision(harness.store, input)).rejects.toBe(failure);
  });

  it("fails closed if a stored digest points to different package content", async () => {
    const input: CreateRuntimePackageRevisionInput = { package: packageInput() };
    const digest = computeRuntimePackageRevisionDigest(input.package);
    const conflicting = revisionRow(
      { ...input.package, runtimeStatus: "published" },
      4,
      digest,
    );
    const harness = fakeStore([{ byDigest: conflicting, latestRevision: 4 }]);

    await expect(createRuntimePackageRevision(harness.store, input)).rejects.toBeInstanceOf(
      RuntimePackageRevisionIntegrityError,
    );
  });

  it("exposes a typed conflict error for callers", () => {
    const error = new RuntimePackageRevisionConflictError(7, 6);

    expect(error.code).toBe("RUNTIME_PACKAGE_REVISION_CONFLICT");
    expect(error.requestedRevision).toBe(7);
    expect(error.expectedRevision).toBe(6);
  });

  it("retries only named revision races, serialization failures, or deadlocks", () => {
    expect(isRuntimePackageRevisionWriteConflict({
      code: "23505",
      constraint: "runtime_packages_venue_room_digest_unique",
    })).toBe(true);
    expect(isRuntimePackageRevisionWriteConflict({
      cause: {
        code: "23514",
        constraint: "runtime_packages_revision_monotonic",
      },
    })).toBe(true);
    expect(isRuntimePackageRevisionWriteConflict({ code: "40001" })).toBe(true);
    expect(isRuntimePackageRevisionWriteConflict({ code: "40P01" })).toBe(true);
    expect(isRuntimePackageRevisionWriteConflict({
      code: "23505",
      constraint: "users_email_unique",
    })).toBe(false);
    expect(isRuntimePackageRevisionWriteConflict(new Error("network unavailable"))).toBe(false);
  });
});
