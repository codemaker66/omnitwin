import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  grandHallRoomOnlyRuntimeMembers,
  type GrandHallFrontierMemberSpec,
  type GrandHallRuntimeMemberSpec,
} from "../lib/grand-hall-frontier-contract.js";
import {
  GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS,
  GrandHallRuntimeIntakeError,
  commitGrandHallRuntimeIntake,
  prepareGrandHallRuntimeIntake,
  probeGrandHallRuntimeConditionalCreateConflict,
  uploadGrandHallRuntimeMember,
  verifyGrandHallRemoteObject,
  type GrandHallPrivateObjectStore,
  type GrandHallRegistrationResult,
  type GrandHallRegistrationStore,
  type GrandHallRemoteObject,
} from "../services/grand-hall-runtime-intake.js";
import type { RuntimePackageRevisionRow } from "../services/runtime-package-revisions.js";
import { syntheticGrandHallRoomOnlyAdmission } from "./fixtures/grand-hall-room-only-evidence.js";

vi.mock("../lib/grand-hall-frontier-contract.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grand-hall-frontier-contract.js")>();
  const members = Array.from({ length: 11 }, (_, memberIndex) => {
    const fileIndex = memberIndex + 100;
    const bytes = Buffer.from(`exact-grand-hall-member-${String(fileIndex)}`, "utf8");
    return {
      fileIndex,
      relativePath: `data/3dgs/test-${String(memberIndex)}.sog`,
      fileName: `test-${String(memberIndex)}.sog`,
      fileExt: ".sog",
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
    grandHallRoomOnlyRuntimeAdmissionError: (admission: unknown) =>
      admission === null ? "Synthetic room-only evidence is required." : null,
  };
});

const NOW = new Date("2026-08-22T12:00:00.000Z");
const PACKAGE_ID = "10000000-0000-4000-8000-000000000001";
const PRIMARY_ASSET_ID = "20000000-0000-4000-8000-000000000001";
const ROOM_ONLY_ADMISSION = syntheticGrandHallRoomOnlyAdmission();
const ROOM_ONLY_MEMBERS = grandHallRoomOnlyRuntimeMembers(ROOM_ONLY_ADMISSION);

function exactMemberBytes(member: GrandHallRuntimeMemberSpec): Uint8Array {
  if ("fileIndex" in member) {
    return Buffer.from(`exact-grand-hall-member-${String(member.fileIndex)}`, "utf8");
  }
  const suffix = member.fileName.endsWith("000.sog") ? "000" : "001";
  return Buffer.from(`synthetic-grand-hall-cropped-output-${suffix}`, "utf8");
}

function corruptMemberBytes(member: GrandHallRuntimeMemberSpec): Uint8Array {
  const bytes = Buffer.from(exactMemberBytes(member));
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return bytes;
}

function remoteObject(
  member: GrandHallRuntimeMemberSpec,
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
    assetVersionIds: ROOM_ONLY_MEMBERS.map((_, index) =>
      `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    ),
  };
}

describe("Grand Hall runtime intake service", () => {
  it("hashes the complete remote stream and closes it", async () => {
    const member = ROOM_ONLY_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const close = vi.fn();

    await verifyGrandHallRemoteObject(remoteObject(member, { close }), member);

    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a same-length remote object whose exact SHA-256 differs", async () => {
    const member = ROOM_ONLY_MEMBERS[0];
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
    const member = ROOM_ONLY_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const open = vi.fn(() => Promise.resolve(remoteObject(member)));
    const putCreateOnly = vi.fn(() => Promise.resolve(putResult));

    const result = await uploadGrandHallRuntimeMember(
      { open, putCreateOnly },
      0,
      exactMemberBytes(member),
      ROOM_ONLY_ADMISSION,
    );

    expect(result.created).toBe(created);
    expect(putCreateOnly).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it("rejects changed upload bytes before any private-storage call", async () => {
    const member = ROOM_ONLY_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const open = vi.fn<GrandHallPrivateObjectStore["open"]>();
    const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>();

    await expect(uploadGrandHallRuntimeMember(
      { open, putCreateOnly },
      0,
      corruptMemberBytes(member),
      ROOM_ONLY_ADMISSION,
    )).rejects.toMatchObject({
      statusCode: 409,
      code: "GRAND_HALL_STORAGE_CONFLICT",
    } satisfies Partial<GrandHallRuntimeIntakeError>);
    expect(putCreateOnly).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("supports the exact create, retry, corrupt-copy, and final-read rehearsal without changing stored bytes", async () => {
    const member = ROOM_ONLY_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const stored = new Map<string, Uint8Array>();
    const putBodies: Buffer[] = [];
    const open = vi.fn<GrandHallPrivateObjectStore["open"]>((candidate) => {
      const bytes = stored.get(candidate.relativePath);
      if (bytes === undefined) return Promise.resolve(null);
      return Promise.resolve({
        contentLength: bytes.byteLength,
        body: (async function* streamStoredBytes() {
          await Promise.resolve();
          yield bytes;
        })(),
        close: () => undefined,
      });
    });
    const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>(
      (candidate, bytes) => {
        putBodies.push(Buffer.from(bytes));
        if (stored.has(candidate.relativePath)) return Promise.resolve("exists");
        stored.set(candidate.relativePath, Buffer.from(bytes));
        return Promise.resolve("created");
      },
    );
    const objectStore: GrandHallPrivateObjectStore = { open, putCreateOnly };
    const exactBytes = exactMemberBytes(member);
    const corruptBytes = corruptMemberBytes(member);

    const initial = await prepareGrandHallRuntimeIntake(
      objectStore, ROOM_ONLY_ADMISSION,
    );
    const created = await uploadGrandHallRuntimeMember(
      objectStore, 0, exactBytes, ROOM_ONLY_ADMISSION,
    );
    const retried = await uploadGrandHallRuntimeMember(
      objectStore, 0, exactBytes, ROOM_ONLY_ADMISSION,
    );
    await probeGrandHallRuntimeConditionalCreateConflict(
      objectStore, corruptBytes, ROOM_ONLY_ADMISSION,
    );
    corruptBytes.fill(0);
    const final = await prepareGrandHallRuntimeIntake(
      objectStore, ROOM_ONLY_ADMISSION,
    );

    expect(initial).toMatchObject({ existingMemberCount: 0, uploadRequiredCount: 2 });
    expect(created.created).toBe(true);
    expect(retried.created).toBe(false);
    expect(putCreateOnly).toHaveBeenCalledTimes(3);
    expect(putBodies[2]).toEqual(corruptMemberBytes(member));
    expect(corruptBytes.every((byte) => byte === 0)).toBe(true);
    expect(final).toMatchObject({ existingMemberCount: 1, uploadRequiredCount: 1 });
    expect(final.members[0]?.status).toBe("verified_existing");
    expect(stored.get(member.relativePath)).toEqual(exactBytes);
  });

  it("fails closed when storage reports the corrupt conditional-create probe as created", async () => {
    const member = ROOM_ONLY_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    const exactBytes = exactMemberBytes(member);
    const objectStore: GrandHallPrivateObjectStore = {
      open: () => Promise.resolve(remoteObject(member)),
      putCreateOnly: () => Promise.resolve("created"),
    };

    await expect(probeGrandHallRuntimeConditionalCreateConflict(
      objectStore,
      corruptMemberBytes(member),
      ROOM_ONLY_ADMISSION,
    )).rejects.toMatchObject({
      statusCode: 500,
      code: "GRAND_HALL_INTAKE_INTEGRITY_ERROR",
    } satisfies Partial<GrandHallRuntimeIntakeError>);
    expect(exactBytes).toEqual(exactMemberBytes(member));
  });

  it("fails closed when an exists response still changes the stored canonical bytes", async () => {
    const member = ROOM_ONLY_MEMBERS[0];
    if (member === undefined) throw new Error("Test contract requires a first member.");
    let stored = Buffer.from(exactMemberBytes(member));
    const objectStore: GrandHallPrivateObjectStore = {
      open: () => Promise.resolve({
        contentLength: stored.byteLength,
        body: (async function* streamStoredBytes() {
          await Promise.resolve();
          yield stored;
        })(),
        close: () => undefined,
      }),
      putCreateOnly: (_candidate, bytes) => {
        stored = Buffer.from(bytes);
        return Promise.resolve("exists");
      },
    };

    await expect(probeGrandHallRuntimeConditionalCreateConflict(
      objectStore,
      corruptMemberBytes(member),
      ROOM_ONLY_ADMISSION,
    )).rejects.toMatchObject({
      statusCode: 409,
      code: "GRAND_HALL_STORAGE_CONFLICT",
    } satisfies Partial<GrandHallRuntimeIntakeError>);
  });

  it("aborts a hung private-storage PUT at the fixed deadline and fails generically", async () => {
    vi.useFakeTimers();
    try {
      const member = ROOM_ONLY_MEMBERS[0];
      if (member === undefined) throw new Error("Test contract requires a first member.");
      const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>(
        async () => new Promise<"created">(() => undefined),
      );
      const open = vi.fn<GrandHallPrivateObjectStore["open"]>();

      const upload = uploadGrandHallRuntimeMember(
        { open, putCreateOnly },
        0,
        exactMemberBytes(member),
        ROOM_ONLY_ADMISSION,
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
      const member = ROOM_ONLY_MEMBERS[0];
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

      const preflight = prepareGrandHallRuntimeIntake(
        { open, putCreateOnly },
        ROOM_ONLY_ADMISSION,
      );
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
      const admission = syntheticGrandHallRoomOnlyAdmission();
      const failedMember = admission.evidence.croppedVisual.members[1];
      if (failedMember === undefined) throw new Error("Test contract requires cropped output.");
      const open = vi.fn((member: GrandHallRuntimeMemberSpec) => {
        if (member.sha256 !== failedMember.sha256) {
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
        commitGrandHallRuntimeIntake(
          objectStore,
          registrationStore,
          "admin-user",
          admission,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "GRAND_HALL_STORAGE_CONFLICT",
      } satisfies Partial<GrandHallRuntimeIntakeError>);
      expect(registerExactFrontier).not.toHaveBeenCalled();
    },
  );

  it("fully verifies the distinct cropped-output inventory before registering", async () => {
    const admission = syntheticGrandHallRoomOnlyAdmission();
    const completedMembers: string[] = [];
    const open = vi.fn((member: GrandHallRuntimeMemberSpec) => Promise.resolve(remoteObject(member, {
      onComplete: () => completedMembers.push(member.fileName),
    })));
    const registerExactFrontier = vi.fn((_actorUserId: string) => {
      expect(completedMembers).toEqual(
        admission.evidence.croppedVisual.members.map((member) => member.fileName),
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
      admission,
    );

    expect(open).toHaveBeenCalledTimes(2);
    expect(registerExactFrontier).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      created: true,
      verifiedMemberCount: 2,
      verifiedTotalBytes: 78,
      gaussianCount: 303,
    });
  });

  it("re-verifies every cropped-output member on an exact idempotent retry", async () => {
    const openCounts = new Map<string, number>();
    const open = vi.fn((member: GrandHallRuntimeMemberSpec) => {
      openCounts.set(member.fileName, (openCounts.get(member.fileName) ?? 0) + 1);
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
      syntheticGrandHallRoomOnlyAdmission(),
    );
    const retry = await commitGrandHallRuntimeIntake(
      objectStore,
      registrationStore,
      "admin-user",
      syntheticGrandHallRoomOnlyAdmission(),
    );

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(open).toHaveBeenCalledTimes(4);
    expect(registerExactFrontier).toHaveBeenCalledTimes(2);
    expect([...openCounts.values()]).toEqual([2, 2]);
  });

  it("rejects missing room-only authority before reading any stored object", async () => {
    const open = vi.fn<GrandHallPrivateObjectStore["open"]>();
    const registerExactFrontier = vi.fn<GrandHallRegistrationStore["registerExactFrontier"]>();

    await expect(commitGrandHallRuntimeIntake(
      { open, putCreateOnly: vi.fn() },
      { registerExactFrontier },
      "admin-user",
      null,
    )).rejects.toMatchObject({
      code: "GRAND_HALL_ROOM_ONLY_EVIDENCE_REQUIRED",
    } satisfies Partial<GrandHallRuntimeIntakeError>);

    expect(open).not.toHaveBeenCalled();
    expect(registerExactFrontier).not.toHaveBeenCalled();
  });

  it("marks only missing members as requiring an upload", async () => {
    const missingIndexes = new Set([1]);
    const open = vi.fn((member: GrandHallRuntimeMemberSpec) => {
      const memberIndex = ROOM_ONLY_MEMBERS.findIndex(
        (candidate) => candidate.sha256 === member.sha256,
      );
      return Promise.resolve(missingIndexes.has(memberIndex) ? null : remoteObject(member));
    });
    const putCreateOnly = vi.fn<GrandHallPrivateObjectStore["putCreateOnly"]>();
    const objectStore: GrandHallPrivateObjectStore = { open, putCreateOnly };

    const result = await prepareGrandHallRuntimeIntake(
      objectStore,
      ROOM_ONLY_ADMISSION,
    );

    expect(open).toHaveBeenCalledTimes(2);
    expect(putCreateOnly).not.toHaveBeenCalled();
    expect(result.existingMemberCount).toBe(1);
    expect(result.uploadRequiredCount).toBe(1);
    for (const [memberIndex, prepared] of result.members.entries()) {
      if (missingIndexes.has(memberIndex)) {
        expect(prepared.status).toBe("upload_required");
      } else {
        expect(prepared.status).toBe("verified_existing");
      }
    }
  });
});
