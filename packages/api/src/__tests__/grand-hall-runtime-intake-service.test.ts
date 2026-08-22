import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_FRONTIER_TOTAL_BYTES,
  type GrandHallFrontierMemberSpec,
} from "../lib/grand-hall-frontier-contract.js";
import {
  GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS,
  GrandHallRuntimeIntakeError,
  commitGrandHallRuntimeIntake,
  prepareGrandHallRuntimeIntake,
  uploadGrandHallRuntimeMember,
  verifyGrandHallRemoteObject,
  type GrandHallPrivateObjectStore,
  type GrandHallRegistrationResult,
  type GrandHallRegistrationStore,
  type GrandHallRemoteObject,
} from "../services/grand-hall-runtime-intake.js";
import type { RuntimePackageRevisionRow } from "../services/runtime-package-revisions.js";

vi.mock("../lib/grand-hall-frontier-contract.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grand-hall-frontier-contract.js")>();
  const members = Array.from({ length: 11 }, (_, memberIndex) => {
    const fileIndex = memberIndex + 100;
    const bytes = Buffer.from(`exact-grand-hall-member-${String(fileIndex)}`, "utf8");
    return {
      fileIndex,
      relativePath: `data/3dgs/test-${String(memberIndex)}.sog`,
      fileName: `test-${String(memberIndex)}.sog`,
      depth: 5,
      nodeCount: 1,
      gaussianCount: memberIndex + 1,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    } satisfies GrandHallFrontierMemberSpec;
  });
  return {
    ...actual,
    GRAND_HALL_FRONTIER_MEMBERS: members,
    GRAND_HALL_FRONTIER_TOTAL_BYTES: members.reduce(
      (total, member) => total + member.sizeBytes,
      0,
    ),
    GRAND_HALL_FRONTIER_GAUSSIAN_COUNT: members.reduce(
      (total, member) => total + member.gaussianCount,
      0,
    ),
  };
});

const NOW = new Date("2026-08-22T12:00:00.000Z");
const PACKAGE_ID = "10000000-0000-4000-8000-000000000001";
const PRIMARY_ASSET_ID = "20000000-0000-4000-8000-000000000001";

function exactMemberBytes(member: GrandHallFrontierMemberSpec): Uint8Array {
  return Buffer.from(`exact-grand-hall-member-${String(member.fileIndex)}`, "utf8");
}

function corruptMemberBytes(member: GrandHallFrontierMemberSpec): Uint8Array {
  const bytes = Buffer.from(exactMemberBytes(member));
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return bytes;
}

function remoteObject(
  member: GrandHallFrontierMemberSpec,
  options: {
    readonly corrupt?: boolean;
    readonly onComplete?: () => void;
    readonly close?: () => void;
  } = {},
): GrandHallRemoteObject {
  const bytes = options.corrupt === true
    ? corruptMemberBytes(member)
    : exactMemberBytes(member);
  const splitAt = Math.max(1, Math.floor(bytes.byteLength / 2));
  return {
    contentLength: bytes.byteLength,
    body: (async function* streamExactBytes() {
      yield bytes.subarray(0, splitAt);
      await Promise.resolve();
      yield Buffer.from(bytes.subarray(splitAt)).toString("utf8");
      options.onComplete?.();
    })(),
    close: options.close ?? (() => undefined),
  };
}

function packageRow(): RuntimePackageRevisionRow {
  return {
    id: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    revision: 1,
    identityKind: "content_sha256",
    contentDigest: "a".repeat(64),
    primaryVisualAssetVersionId: PRIMARY_ASSET_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: PRIMARY_ASSET_ID,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function registrationResult(created: boolean): GrandHallRegistrationResult {
  return {
    packageRow: packageRow(),
    contentDigest: "a".repeat(64),
    created,
    assetVersionIds: GRAND_HALL_FRONTIER_MEMBERS.map((_, index) =>
      `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    ),
  };
}

describe("Grand Hall runtime intake service", () => {
  it("hashes the complete remote stream and closes it", async () => {
    const member = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const close = vi.fn();

    await verifyGrandHallRemoteObject(remoteObject(member, { close }), member);

    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a same-length remote object whose exact SHA-256 differs", async () => {
    const member = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const close = vi.fn();

    await expect(
      verifyGrandHallRemoteObject(remoteObject(member, { corrupt: true, close }), member),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "GRAND_HALL_STORAGE_CONFLICT",
    } satisfies Partial<GrandHallRuntimeIntakeError>);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ["created", true],
    ["exists", false],
  ] as const)("conditionally stores, then fully reads back a %s member", async (putResult, created) => {
    const member = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const open = vi.fn(() => Promise.resolve(remoteObject(member)));
    const putCreateOnly = vi.fn(() => Promise.resolve(putResult));

    const result = await uploadGrandHallRuntimeMember(
      { open, putCreateOnly },
      0,
      exactMemberBytes(member),
    );

    expect(result.created).toBe(created);
    expect(putCreateOnly).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it("rejects changed upload bytes before any private-storage call", async () => {
    const member = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const open = vi.fn<GrandHallPrivateObjectStore["open"]>();
    const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>();

    await expect(uploadGrandHallRuntimeMember(
      { open, putCreateOnly },
      0,
      corruptMemberBytes(member),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: "GRAND_HALL_STORAGE_CONFLICT",
    } satisfies Partial<GrandHallRuntimeIntakeError>);
    expect(putCreateOnly).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("aborts a hung private-storage PUT at the fixed deadline and fails generically", async () => {
    vi.useFakeTimers();
    try {
      const member = GRAND_HALL_FRONTIER_MEMBERS[0];
      if (member === undefined) throw new Error("Test contract requires a first member.");
      const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>(
        async () => new Promise<"created">(() => undefined),
      );
      const open = vi.fn<GrandHallPrivateObjectStore["open"]>();

      const upload = uploadGrandHallRuntimeMember(
        { open, putCreateOnly },
        0,
        exactMemberBytes(member),
      );
      const rejected = expect(upload).rejects.toMatchObject({
        statusCode: 502,
        code: "GRAND_HALL_STORAGE_FAILED",
      } satisfies Partial<GrandHallRuntimeIntakeError>);

      await vi.advanceTimersByTimeAsync(GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS);
      await rejected;

      expect(putCreateOnly.mock.calls[0]?.[2].aborted).toBe(true);
      expect(open).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a hung private-storage response stream at the deadline and fails generically", async () => {
    vi.useFakeTimers();
    try {
      const member = GRAND_HALL_FRONTIER_MEMBERS[0];
      if (member === undefined) throw new Error("Test contract requires a first member.");
      const close = vi.fn();
      const next = vi.fn<() => Promise<IteratorResult<Uint8Array>>>(
        async () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
      );
      const open = vi.fn<GrandHallPrivateObjectStore["open"]>((_member, _signal) =>
        Promise.resolve({
          contentLength: member.sizeBytes,
          body: {
            [Symbol.asyncIterator]: () => ({ next }),
          },
          close,
        }),
      );
      const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>();

      const preflight = prepareGrandHallRuntimeIntake({ open, putCreateOnly });
      const rejected = expect(preflight).rejects.toMatchObject({
        statusCode: 502,
        code: "GRAND_HALL_STORAGE_FAILED",
      } satisfies Partial<GrandHallRuntimeIntakeError>);
      await vi.advanceTimersByTimeAsync(0);
      expect(next).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS);
      await rejected;

      expect(open.mock.calls[0]?.[1].aborted).toBe(true);
      expect(close).toHaveBeenCalledOnce();
      expect(putCreateOnly).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["missing", "corrupt"] as const)(
    "fails on a %s member before registration",
    async (failureKind) => {
      const failedMember = GRAND_HALL_FRONTIER_MEMBERS[4];
      if (failedMember === undefined) throw new Error("Test contract requires eleven members.");
      const open = vi.fn((member: GrandHallFrontierMemberSpec) => {
        if (member.fileIndex !== failedMember.fileIndex) {
          return Promise.resolve(remoteObject(member));
        }
        return Promise.resolve(
          failureKind === "missing" ? null : remoteObject(member, { corrupt: true }),
        );
      });
      const registerExactFrontier = vi.fn(
        (_actorUserId: string) => Promise.resolve(registrationResult(true)),
      );
      const objectStore: GrandHallPrivateObjectStore = {
        open,
        putCreateOnly: () => Promise.reject(new Error("Commit must never write an object.")),
      };
      const registrationStore: GrandHallRegistrationStore = { registerExactFrontier };

      await expect(
        commitGrandHallRuntimeIntake(objectStore, registrationStore, "admin-user"),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "GRAND_HALL_STORAGE_CONFLICT",
      } satisfies Partial<GrandHallRuntimeIntakeError>);
      expect(registerExactFrontier).not.toHaveBeenCalled();
    },
  );

  it("fully verifies all eleven ordered members before registering", async () => {
    const completedMembers: string[] = [];
    const open = vi.fn((member: GrandHallFrontierMemberSpec) => Promise.resolve(remoteObject(member, {
      onComplete: () => completedMembers.push(member.fileName),
    })));
    const registerExactFrontier = vi.fn((_actorUserId: string) => {
      expect(completedMembers).toEqual(
        GRAND_HALL_FRONTIER_MEMBERS.map((member) => member.fileName),
      );
      return Promise.resolve(registrationResult(true));
    });
    const objectStore: GrandHallPrivateObjectStore = {
      open,
      putCreateOnly: () => Promise.reject(new Error("Commit must never write an object.")),
    };

    const result = await commitGrandHallRuntimeIntake(
      objectStore,
      { registerExactFrontier },
      "admin-user",
    );

    expect(open).toHaveBeenCalledTimes(11);
    expect(registerExactFrontier).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      created: true,
      verifiedMemberCount: 11,
      verifiedTotalBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
      gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
    });
  });

  it("re-verifies all eleven members on an exact idempotent retry", async () => {
    const openCounts = new Map<number, number>();
    const open = vi.fn((member: GrandHallFrontierMemberSpec) => {
      openCounts.set(member.fileIndex, (openCounts.get(member.fileIndex) ?? 0) + 1);
      return Promise.resolve(remoteObject(member));
    });
    let registrationAttempt = 0;
    const registerExactFrontier = vi.fn((_actorUserId: string) => {
      registrationAttempt += 1;
      return Promise.resolve(registrationResult(registrationAttempt === 1));
    });
    const objectStore: GrandHallPrivateObjectStore = {
      open,
      putCreateOnly: () => Promise.reject(new Error("Commit must never write an object.")),
    };
    const registrationStore: GrandHallRegistrationStore = { registerExactFrontier };

    const first = await commitGrandHallRuntimeIntake(
      objectStore,
      registrationStore,
      "admin-user",
    );
    const retry = await commitGrandHallRuntimeIntake(
      objectStore,
      registrationStore,
      "admin-user",
    );

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(open).toHaveBeenCalledTimes(22);
    expect(registerExactFrontier).toHaveBeenCalledTimes(2);
    expect([...openCounts.values()]).toEqual(Array.from({ length: 11 }, () => 2));
  });

  it("marks only missing members as requiring an upload", async () => {
    const missingIndexes = new Set([1, 5, 9]);
    const open = vi.fn((member: GrandHallFrontierMemberSpec) => {
      const memberIndex = GRAND_HALL_FRONTIER_MEMBERS.findIndex(
        (candidate) => candidate.fileIndex === member.fileIndex,
      );
      return Promise.resolve(missingIndexes.has(memberIndex) ? null : remoteObject(member));
    });
    const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>();
    const objectStore: GrandHallPrivateObjectStore = { open, putCreateOnly };

    const result = await prepareGrandHallRuntimeIntake(objectStore);

    expect(open).toHaveBeenCalledTimes(11);
    expect(putCreateOnly).not.toHaveBeenCalled();
    expect(result.existingMemberCount).toBe(8);
    expect(result.uploadRequiredCount).toBe(3);
    for (const [memberIndex, prepared] of result.members.entries()) {
      if (missingIndexes.has(memberIndex)) {
        expect(prepared.status).toBe("upload_required");
      } else {
        expect(prepared.status).toBe("verified_existing");
      }
    }
  });
});
