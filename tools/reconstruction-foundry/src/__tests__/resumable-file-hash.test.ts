import { createHash, createSecretKey } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ResumableFileHashError,
  type ResumableFileHashCheckpoint,
  type ResumableFileHashCheckpointAuthentication,
  validateResumableFileHashCheckpoint,
  verifyResumableSha256File,
} from "../resumable-file-hash.js";

const cleanup: string[] = [];
const TEST_SMALL_IO = { testOnlyAllowSmallIo: true as const };
const TEST_AUTHENTICATION_KEY = Buffer.alloc(32, 0xa7);

function checkpointAuthentication(
  context = "job-test-a",
  key: Uint8Array = TEST_AUTHENTICATION_KEY,
  keyId = "test-key-v1",
): ResumableFileHashCheckpointAuthentication {
  return { key, keyId, context };
}

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function deterministicBytes(size: number): Buffer {
  const bytes = Buffer.allocUnsafe(size);
  let value = 0x6d2b79f5;
  for (let index = 0; index < size; index += 1) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    bytes[index] = value & 0xff;
  }
  return bytes;
}

function nativeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkpointSelfDigest(payload: object): string {
  return createHash("sha256")
    .update(
      "omnitwin.reconstruction-foundry/resumable-sha256-checkpoint-self-digest/v2",
      "utf8",
    )
    .update("\0", "utf8")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

async function fixture(
  bytes: Uint8Array,
  relativePath = "capture/source.bin",
): Promise<{ absolutePath: string; relativePath: string; expectedSha256: string }> {
  const root = await mkdtemp(join(tmpdir(), "foundry-resumable-hash-"));
  cleanup.push(root);
  const absolutePath = join(root, "source.bin");
  await writeFile(absolutePath, bytes);
  return { absolutePath, relativePath, expectedSha256: nativeSha256(bytes) };
}

async function expectHashError(
  promise: Promise<unknown>,
  code: ResumableFileHashError["code"],
): Promise<ResumableFileHashError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ResumableFileHashError);
    expect(error).toMatchObject({ code });
    return error as ResumableFileHashError;
  }
  throw new Error(`Expected ${code}.`);
}

async function makeCheckpoint(
  bytes: Uint8Array,
): Promise<{
  absolutePath: string;
  relativePath: string;
  expectedSha256: string;
  checkpoint: ResumableFileHashCheckpoint;
  checkpointAuthentication: ResumableFileHashCheckpointAuthentication;
}> {
  const source = await fixture(bytes);
  const authentication = checkpointAuthentication();
  let checkpoint: ResumableFileHashCheckpoint | undefined;
  await verifyResumableSha256File({
    ...source,
    ...TEST_SMALL_IO,
    expectedSizeBytes: bytes.byteLength,
    readBufferBytes: 97,
    checkpointIntervalBytes: 211,
    checkpointAuthentication: authentication,
    onCheckpoint: (candidate) => {
      checkpoint ??= candidate;
    },
  });
  expect(checkpoint).toBeDefined();
  return {
    ...source,
    checkpoint: checkpoint!,
    checkpointAuthentication: authentication,
  };
}

describe("resumable read-only SHA-256 verification", () => {
  it("matches native crypto across SHA-256, read-buffer, and checkpoint boundaries", async () => {
    const sizes = [
      0, 1, 55, 56, 63, 64, 65, 96, 97, 98, 210, 211, 212, 255, 256, 257,
      1023, 1024, 1025, 4095, 4096, 4097,
    ];

    for (const size of sizes) {
      const bytes = deterministicBytes(size);
      const source = await fixture(bytes, `boundaries/${String(size)}.bin`);
      const checkpoints: ResumableFileHashCheckpoint[] = [];
      const result = await verifyResumableSha256File({
        ...source,
        ...TEST_SMALL_IO,
        expectedSizeBytes: size,
        readBufferBytes: 97,
        checkpointIntervalBytes: 211,
        checkpointAuthentication: checkpointAuthentication(),
        onCheckpoint: (checkpoint) => {
          checkpoints.push(checkpoint);
        },
      });

      expect(result).toMatchObject({
        verified: true,
        sha256: nativeSha256(bytes),
        sizeBytes: size,
        resumedFromBytes: 0,
        currentOffsetBytes: size,
        bytesReadThisAttempt: size,
        durablyConfirmedBytes: size,
      });
      expect(checkpoints.length).toBeGreaterThan(0);
      expect(
        validateResumableFileHashCheckpoint(
          checkpoints.at(-1),
          checkpointAuthentication(),
        ),
      ).toEqual(checkpoints.at(-1));
    }
  }, 30_000);

  it("cancels after a durable checkpoint and resumes without rereading the confirmed prefix", async () => {
    const bytes = deterministicBytes(2 * 1024 * 1024 + 73);
    const source = await fixture(bytes, "large/capture.e57");
    const controller = new AbortController();
    const authentication = checkpointAuthentication("job-large-resume");
    let durableCheckpoint: ResumableFileHashCheckpoint | undefined;

    const cancelled = await expectHashError(
      verifyResumableSha256File({
        ...source,
        ...TEST_SMALL_IO,
        expectedSizeBytes: bytes.byteLength,
        readBufferBytes: 64 * 1024,
        checkpointIntervalBytes: 256 * 1024,
        signal: controller.signal,
        checkpointAuthentication: authentication,
        onCheckpoint: (checkpoint) => {
          durableCheckpoint = checkpoint;
          controller.abort();
        },
      }),
      "HASH_CANCELLED",
    );

    expect(durableCheckpoint?.confirmedOffsetBytes).toBe(256 * 1024);
    expect(cancelled.progress).toMatchObject({
      currentOffsetBytes: 256 * 1024,
      bytesReadThisAttempt: 256 * 1024,
      durablyConfirmedBytes: 256 * 1024,
    });

    const resumed = await verifyResumableSha256File({
      ...source,
      expectedSizeBytes: bytes.byteLength,
      checkpoint: durableCheckpoint,
      checkpointAuthentication: authentication,
      resumeSafety: "strong_identity_required",
      readBufferBytes: 64 * 1024,
      ...TEST_SMALL_IO,
    });
    expect(resumed).toMatchObject({
      verified: true,
      sha256: nativeSha256(bytes),
      resumedFromBytes: 256 * 1024,
      bytesReadThisAttempt: bytes.byteLength - 256 * 1024,
      durablyConfirmedBytes: 256 * 1024,
    });
  });

  it("waits for checkpoint persistence before reporting those bytes as durable", async () => {
    const bytes = deterministicBytes(900);
    const source = await fixture(bytes);
    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolvePromise) => {
      enteredResolve = resolvePromise;
    });
    let releaseResolve: (() => void) | undefined;
    const release = new Promise<void>((resolvePromise) => {
      releaseResolve = resolvePromise;
    });
    const progress: number[] = [];
    let first = true;
    let settled = false;
    const verification = verifyResumableSha256File({
      ...source,
      ...TEST_SMALL_IO,
      expectedSizeBytes: bytes.byteLength,
      readBufferBytes: 100,
      checkpointIntervalBytes: 300,
      checkpointAuthentication: checkpointAuthentication("job-awaited-persistence"),
      onCheckpoint: async () => {
        if (!first) return;
        first = false;
        enteredResolve?.();
        await release;
      },
      onProgress: (measurement) => {
        progress.push(measurement.durablyConfirmedBytes);
      },
    }).finally(() => {
      settled = true;
    });

    await entered;
    expect(settled).toBe(false);
    expect(progress.at(-1)).toBe(0);
    releaseResolve?.();
    const result = await verification;
    expect(result.durablyConfirmedBytes).toBe(bytes.byteLength);
    expect(progress).toContain(300);
  });

  it("rejects corrupted checkpoint digest, state, path, hash, and identity bindings", async () => {
    const bytes = deterministicBytes(2048);
    const source = await makeCheckpoint(bytes);
    const corruptDigest = {
      ...source.checkpoint,
      checkpointSha256: "0".repeat(64),
    };
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: corruptDigest,
      }),
      "HASH_CHECKPOINT_INTEGRITY_MISMATCH",
    );

    const corruptState = {
      ...source.checkpoint,
      hashStateBase64: `${source.checkpoint.hashStateBase64.startsWith("A") ? "B" : "A"}${source.checkpoint.hashStateBase64.slice(1)}`,
    };
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: corruptState,
      }),
      "HASH_CHECKPOINT_INTEGRITY_MISMATCH",
    );

    const corruptPath = {
      ...source.checkpoint,
      relativePath: "capture/other.bin",
    };
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: corruptPath,
      }),
      "HASH_CHECKPOINT_INTEGRITY_MISMATCH",
    );

    await expectHashError(
      verifyResumableSha256File({
        ...source,
        relativePath: "capture/renamed.bin",
        expectedSizeBytes: bytes.byteLength,
        checkpoint: source.checkpoint,
      }),
      "HASH_CHECKPOINT_BINDING_MISMATCH",
    );
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSha256: "f".repeat(64),
        expectedSizeBytes: bytes.byteLength,
        checkpoint: source.checkpoint,
      }),
      "HASH_CHECKPOINT_BINDING_MISMATCH",
    );

    const corruptIdentity = {
      ...source.checkpoint,
      fileIdentity: {
        ...source.checkpoint.fileIdentity,
        inode: (BigInt(source.checkpoint.fileIdentity.inode) + 1n).toString(10),
      },
    };
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: corruptIdentity,
      }),
      "HASH_CHECKPOINT_INTEGRITY_MISMATCH",
    );

    const corruptOffset = {
      ...source.checkpoint,
      confirmedOffsetBytes: source.checkpoint.confirmedOffsetBytes + 1,
    };
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: corruptOffset,
      }),
      "HASH_CHECKPOINT_INTEGRITY_MISMATCH",
    );

    const unboundedIdentity = {
      ...source.checkpoint,
      fileIdentity: {
        ...source.checkpoint.fileIdentity,
        inode: "9".repeat(41),
      },
    };
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: unboundedIdentity,
      }),
      "HASH_CHECKPOINT_INVALID",
    );

    const invalidState = {
      ...source.checkpoint,
      hashStateBase64: "not-base64",
    };
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: invalidState,
      }),
      "HASH_CHECKPOINT_STATE_INVALID",
    );
  });

  it("rejects a publicly re-digested checkpoint that lies about its offset", async () => {
    const bytes = deterministicBytes(2048);
    const source = await makeCheckpoint(bytes);
    const falseOffset = source.checkpoint.confirmedOffsetBytes + 1;
    const payload = {
      domain: source.checkpoint.domain,
      checkpointVersion: source.checkpoint.checkpointVersion,
      implementationVersion: source.checkpoint.implementationVersion,
      keyId: source.checkpoint.keyId,
      context: source.checkpoint.context,
      relativePath: source.checkpoint.relativePath,
      expectedSizeBytes: source.checkpoint.expectedSizeBytes,
      expectedSha256: source.checkpoint.expectedSha256,
      fileIdentity: {
        deviceId: source.checkpoint.fileIdentity.deviceId,
        inode: source.checkpoint.fileIdentity.inode,
        sizeBytes: source.checkpoint.fileIdentity.sizeBytes,
        modifiedTimeNanoseconds: source.checkpoint.fileIdentity.modifiedTimeNanoseconds,
        statusChangedTimeNanoseconds:
          source.checkpoint.fileIdentity.statusChangedTimeNanoseconds,
      },
      confirmedOffsetBytes: falseOffset,
      hashStateBase64: source.checkpoint.hashStateBase64,
    };
    const checkpointSha256 = checkpointSelfDigest(payload);

    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: {
          ...payload,
          checkpointSha256,
          authenticationHmacSha256: source.checkpoint.authenticationHmacSha256,
        },
        readBufferBytes: 97,
        ...TEST_SMALL_IO,
      }),
      "HASH_CHECKPOINT_AUTHENTICATION_MISMATCH",
    );
  });

  it("rejects the audit forgery: approved A state rebound to live B identity with a recomputed public digest", async () => {
    const approvedA = deterministicBytes(4096);
    const liveB = Buffer.from(approvedA);
    liveB[0] = (liveB[0] ?? 0) ^ 0xff;
    const approved = await makeCheckpoint(approvedA);
    const live = await fixture(liveB, approved.relativePath);
    const liveResult = await verifyResumableSha256File({
      ...live,
      expectedSizeBytes: liveB.byteLength,
    });
    const forgedCore = {
      domain: approved.checkpoint.domain,
      checkpointVersion: approved.checkpoint.checkpointVersion,
      implementationVersion: approved.checkpoint.implementationVersion,
      keyId: approved.checkpoint.keyId,
      context: approved.checkpoint.context,
      relativePath: approved.checkpoint.relativePath,
      expectedSizeBytes: liveB.byteLength,
      expectedSha256: live.expectedSha256,
      fileIdentity: liveResult.fileIdentity,
      confirmedOffsetBytes: approved.checkpoint.confirmedOffsetBytes,
      hashStateBase64: approved.checkpoint.hashStateBase64,
    };
    const forgedCheckpoint = {
      ...forgedCore,
      checkpointSha256: checkpointSelfDigest(forgedCore),
      authenticationHmacSha256: approved.checkpoint.authenticationHmacSha256,
    };

    await expectHashError(
      verifyResumableSha256File({
        ...live,
        ...TEST_SMALL_IO,
        expectedSizeBytes: liveB.byteLength,
        checkpoint: forgedCheckpoint,
        checkpointAuthentication: approved.checkpointAuthentication,
        resumeSafety: "strong_identity_required",
      }),
      "HASH_CHECKPOINT_AUTHENTICATION_MISMATCH",
    );
  });

  it("fails closed for missing or wrong authentication, cross-job replay, unknown fields, and un-attested resume", async () => {
    const bytes = deterministicBytes(2048);
    const source = await makeCheckpoint(bytes);

    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpointAuthentication: undefined,
        resumeSafety: "strong_identity_required",
      }),
      "HASH_CHECKPOINT_AUTHENTICATION_REQUIRED",
    );
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpointAuthentication: checkpointAuthentication(
          source.checkpoint.context,
          Buffer.alloc(32, 0x55),
          source.checkpoint.keyId,
        ),
        resumeSafety: "strong_identity_required",
      }),
      "HASH_CHECKPOINT_AUTHENTICATION_MISMATCH",
    );
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpointAuthentication: checkpointAuthentication(
          "different-job-context",
          TEST_AUTHENTICATION_KEY,
          source.checkpoint.keyId,
        ),
        resumeSafety: "strong_identity_required",
      }),
      "HASH_CHECKPOINT_AUTHENTICATION_MISMATCH",
    );
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpointAuthentication: checkpointAuthentication(
          source.checkpoint.context,
          TEST_AUTHENTICATION_KEY,
          "rotated-key-id",
        ),
        resumeSafety: "strong_identity_required",
      }),
      "HASH_CHECKPOINT_AUTHENTICATION_MISMATCH",
    );
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: { ...source.checkpoint, unknownField: "reject-me" },
        resumeSafety: "strong_identity_required",
      }),
      "HASH_CHECKPOINT_INVALID",
    );
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
      }),
      "HASH_RESUME_RESTART_REQUIRED",
    );
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpointAuthentication: checkpointAuthentication(
          source.checkpoint.context,
          Buffer.alloc(31, 0x55),
          source.checkpoint.keyId,
        ),
      }),
      "HASH_CHECKPOINT_AUTHENTICATION_INVALID",
    );

    expect(
      validateResumableFileHashCheckpoint(source.checkpoint, {
        key: createSecretKey(TEST_AUTHENTICATION_KEY),
        keyId: source.checkpoint.keyId,
        context: source.checkpoint.context,
      }),
    ).toEqual(source.checkpoint);

    const noCheckpointSource = await fixture(bytes, "auth/required.bin");
    await expectHashError(
      verifyResumableSha256File({
        ...noCheckpointSource,
        expectedSizeBytes: bytes.byteLength,
        onCheckpoint: () => undefined,
      }),
      "HASH_CHECKPOINT_AUTHENTICATION_REQUIRED",
    );
  });

  it("rejects a checkpoint after the source identity changes", async () => {
    const bytes = deterministicBytes(2048);
    const source = await makeCheckpoint(bytes);
    const replacement = Buffer.from(bytes);
    replacement[0] = replacement[0] === 0 ? 1 : 0;
    const oldPath = `${source.absolutePath}.old`;
    await rename(source.absolutePath, oldPath);
    await writeFile(source.absolutePath, replacement);

    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpoint: source.checkpoint,
        resumeSafety: "strong_identity_required",
      }),
      "HASH_CHECKPOINT_BINDING_MISMATCH",
    );
  });

  it("detects source replacement during a checkpoint callback", async () => {
    const bytes = deterministicBytes(4096);
    const source = await fixture(bytes);
    let replaced = false;
    const replacement = Buffer.from(bytes);
    replacement[0] = (replacement[0] ?? 0) ^ 0xff;

    await expectHashError(
      verifyResumableSha256File({
        ...source,
        ...TEST_SMALL_IO,
        expectedSizeBytes: bytes.byteLength,
        readBufferBytes: 128,
        checkpointIntervalBytes: 512,
        checkpointAuthentication: checkpointAuthentication("job-source-mutation"),
        onCheckpoint: async () => {
          if (replaced) return;
          replaced = true;
          await rename(source.absolutePath, `${source.absolutePath}.original`);
          await writeFile(source.absolutePath, replacement);
        },
      }),
      "HASH_SOURCE_IDENTITY_CHANGED",
    );
  });

  it("rejects leaf and ancestor symlinks without reading their targets", async () => {
    const bytes = deterministicBytes(100);
    const root = await mkdtemp(join(tmpdir(), "foundry-resumable-link-"));
    cleanup.push(root);
    const realDirectory = join(root, "real");
    const linkedDirectory = join(root, "linked");
    await mkdir(realDirectory);
    await writeFile(join(realDirectory, "source.bin"), bytes);
    await symlink(
      realDirectory,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expectHashError(
      verifyResumableSha256File({
        absolutePath: join(linkedDirectory, "source.bin"),
        relativePath: "linked/source.bin",
        expectedSizeBytes: bytes.byteLength,
        expectedSha256: nativeSha256(bytes),
      }),
      "HASH_SOURCE_SYMLINK",
    );

    const leafLink = join(root, "leaf.bin");
    try {
      await symlink(
        join(realDirectory, "source.bin"),
        leafLink,
        process.platform === "win32" ? "file" : undefined,
      );
      await expectHashError(
        verifyResumableSha256File({
          absolutePath: leafLink,
          relativePath: "leaf.bin",
          expectedSizeBytes: bytes.byteLength,
          expectedSha256: nativeSha256(bytes),
        }),
        "HASH_SOURCE_SYMLINK",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES") throw error;
    }
  });

  it("rejects non-regular files, unsafe labels, and non-absolute daemon paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-resumable-invalid-"));
    cleanup.push(root);
    await expectHashError(
      verifyResumableSha256File({
        absolutePath: root,
        relativePath: "capture",
        expectedSizeBytes: 0,
        expectedSha256: nativeSha256(Buffer.alloc(0)),
      }),
      "HASH_SOURCE_NON_REGULAR",
    );
    await expectHashError(
      verifyResumableSha256File({
        absolutePath: join(root, "missing.bin"),
        relativePath: "../escape.bin",
        expectedSizeBytes: 0,
        expectedSha256: nativeSha256(Buffer.alloc(0)),
      }),
      "HASH_RELATIVE_PATH_UNSAFE",
    );
    await expectHashError(
      verifyResumableSha256File({
        absolutePath: "relative.bin",
        relativePath: "relative.bin",
        expectedSizeBytes: 0,
        expectedSha256: nativeSha256(Buffer.alloc(0)),
      }),
      "HASH_PATH_NOT_ABSOLUTE",
    );
  });

  it("enforces production minimum read and checkpoint sizes", async () => {
    const bytes = deterministicBytes(2048);
    const source = await fixture(bytes);
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        readBufferBytes: 1024,
      }),
      "HASH_ARGUMENT_INVALID",
    );
    await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        checkpointIntervalBytes: 1024,
        checkpointAuthentication: checkpointAuthentication("job-minimums"),
        onCheckpoint: () => undefined,
      }),
      "HASH_ARGUMENT_INVALID",
    );
  });

  it("rejects exact size and final SHA-256 mismatches", async () => {
    const bytes = deterministicBytes(777);
    const source = await fixture(bytes);
    const wrongSize = await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength + 1,
      }),
      "HASH_SOURCE_SIZE_MISMATCH",
    );
    expect(wrongSize.progress?.bytesReadThisAttempt).toBe(0);

    const wrongDigest = await expectHashError(
      verifyResumableSha256File({
        ...source,
        expectedSizeBytes: bytes.byteLength,
        expectedSha256: "0".repeat(64),
        readBufferBytes: 101,
        ...TEST_SMALL_IO,
      }),
      "HASH_DIGEST_MISMATCH",
    );
    expect(wrongDigest.progress?.bytesReadThisAttempt).toBe(bytes.byteLength);
  });

  it("honors cancellation before opening and preserves zero measured reads", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await expectHashError(
      verifyResumableSha256File({
        absolutePath: join(tmpdir(), "does-not-need-to-exist.bin"),
        relativePath: "cancelled.bin",
        expectedSizeBytes: 0,
        expectedSha256: nativeSha256(Buffer.alloc(0)),
        signal: controller.signal,
      }),
      "HASH_CANCELLED",
    );
    expect(cancelled.progress).toMatchObject({
      currentOffsetBytes: 0,
      bytesReadThisAttempt: 0,
      durablyConfirmedBytes: 0,
    });
  });

  it("does not modify a verified source", async () => {
    const bytes = deterministicBytes(1000);
    const source = await fixture(bytes);
    await verifyResumableSha256File({
      ...source,
      expectedSizeBytes: bytes.byteLength,
      readBufferBytes: 123,
      ...TEST_SMALL_IO,
    });
    expect(await readFile(source.absolutePath)).toEqual(bytes);
  });
});
