import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { inspect } from "node:util";
import {
  FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
  compileGuidedAdmissionDraft,
  inspectUniversalIntake,
  type FoundryGuidedAdmissionDraft,
  type FoundryGuidedAdmissionDraftInput,
  type FoundryGuidedAdmissionFileChoice,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
import {
  REFERENCE_VERIFICATION_LOCAL_TRUST_BOUNDARY_V0,
  REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
  REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
  REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0,
  ReferenceVerificationBridgeErrorV0,
  buildReferenceVerificationAdmittedSubjectV0,
  captureReferenceVerificationSourceIdentityV0,
  loadOrCreateReferenceVerificationRecordAuthenticationV0,
  prepareDefaultReferenceVerificationPrivateStateRootV0,
  type ReferenceVerificationSourceIdentityV0,
} from "../reference-verification-bridge.js";

const cleanup: string[] = [];
const REVIEWED_AT = "2026-07-13T18:00:00.000Z";

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(async (path) => rm(path, { recursive: true, force: true })));
});

interface Fixture {
  readonly base: string;
  readonly source: string;
  readonly trustedStartupSourceIdentity: ReferenceVerificationSourceIdentityV0;
  readonly privateStateRoot: string;
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly admissionDraft: FoundryGuidedAdmissionDraft;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function deferredVoid(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function admissionInput(
  receipt: FoundryUniversalIntakeReceipt,
): FoundryGuidedAdmissionDraftInput {
  const decisions: FoundryGuidedAdmissionFileChoice[] = receipt.files.map((file) => {
    if (file.path.toLowerCase().endsWith(".e57")) {
      return {
        action: "admit",
        path: file.path,
        inputType: "generic_e57",
        role: "raw_capture",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      };
    }
    if (file.path.toLowerCase().endsWith(".obj")) {
      return {
        action: "admit",
        path: file.path,
        inputType: "obj",
        role: "official_export",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      };
    }
    return {
      action: "exclude",
      path: file.path,
      reason: "provenance_unknown",
    };
  });
  return {
    schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
    receiptSha256: receipt.receiptSha256,
    projectId: "reference-verification-bridge-test",
    reviewedAt: REVIEWED_AT,
    reviewedBy: "local-test-operator",
    sourceMedia: "local",
    caseSensitivity: "insensitive",
    decisions,
  };
}

async function makeFixture(kind: "file" | "directory" = "directory"): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "foundry-reference-bridge-"));
  cleanup.push(base);
  const privateStateRoot = join(base, "private-state");
  await mkdir(privateStateRoot, { mode: 0o700 });
  let source: string;
  if (kind === "file") {
    source = join(base, "single-capture.e57");
    await writeFile(source, Buffer.from("ASTM-E57\0single-file-fixture", "ascii"));
  } else {
    source = join(base, "capture-source");
    await mkdir(source);
    await Promise.all([
      writeFile(join(source, "capture.e57"), Buffer.from("ASTM-E57\0directory-fixture", "ascii")),
      writeFile(
        join(source, "mesh.obj"),
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
      ),
      writeFile(join(source, "notes.txt"), "operator notes\n"),
    ]);
  }
  const trustedStartupSourceIdentity = await captureReferenceVerificationSourceIdentityV0(source);
  const receipt = await inspectUniversalIntake(source);
  return {
    base,
    source,
    trustedStartupSourceIdentity,
    privateStateRoot,
    receipt,
    admissionDraft: compileGuidedAdmissionDraft(receipt, admissionInput(receipt)),
  };
}

async function expectBridgeError(
  operation: () => Promise<unknown>,
  code?: string,
): Promise<ReferenceVerificationBridgeErrorV0> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ReferenceVerificationBridgeErrorV0);
    const bridgeError = error as ReferenceVerificationBridgeErrorV0;
    if (code !== undefined) expect(bridgeError.code).toBe(code);
    return bridgeError;
  }
  throw new Error("expected the reference-verification bridge to fail closed");
}

describe("reference-verification admitted-subject bridge", () => {
  it("builds an exact sorted byte-only subject for a directory source", async () => {
    const fixture = await makeFixture("directory");
    const subject = await buildReferenceVerificationAdmittedSubjectV0({
      source: fixture.source,
      trustedStartupSourceIdentity: fixture.trustedStartupSourceIdentity,
      receipt: fixture.receipt,
      admissionDraft: fixture.admissionDraft,
    });

    expect(subject).toEqual({
      sourceKind: "directory",
      canonicalSourcePath: await realpath(fixture.source),
      receiptSha256: fixture.receipt.receiptSha256,
      reviewSha256: fixture.admissionDraft.review.reviewSha256.slice("sha256:".length),
      admissionResultSha256: fixture.admissionDraft.result.resultSha256.slice("sha256:".length),
      manifestSha256: fixture.admissionDraft.result.manifestSha256.slice("sha256:".length),
      files: fixture.receipt.files
        .filter((file) => file.path === "capture.e57" || file.path === "mesh.obj")
        .map((file) => ({
          relativePath: file.path,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
        })),
    });
    expect(subject.files.map((file) => file.relativePath)).toEqual(["capture.e57", "mesh.obj"]);
    expect(Object.keys(fixture.trustedStartupSourceIdentity).sort()).toEqual([
      "canonicalPathSha256",
      "ctimeNs",
      "dev",
      "inode",
      "kind",
      "mtimeNs",
      "schemaVersion",
      "size",
    ]);
    expect(JSON.stringify(fixture.trustedStartupSourceIdentity)).not.toContain(fixture.source);
    expect(subject).not.toHaveProperty("authority");
    expect(subject).not.toHaveProperty("rights");
    expect(subject).not.toHaveProperty("capabilities");
  });

  it("builds the exact receipt-labelled subject for a single-file source", async () => {
    const fixture = await makeFixture("file");
    const subject = await buildReferenceVerificationAdmittedSubjectV0({
      source: fixture.source,
      trustedStartupSourceIdentity: fixture.trustedStartupSourceIdentity,
      receipt: fixture.receipt,
      admissionDraft: fixture.admissionDraft,
    });

    expect(subject.sourceKind).toBe("file");
    expect(subject.files).toHaveLength(1);
    expect(subject.files[0]?.relativePath).toBe(basename(fixture.source));
    expect(subject.files[0]?.sha256).toBe(fixture.receipt.files[0]?.sha256);
  });

  it("rejects a same-label alternate root even when all admitted bytes are equal", async () => {
    const fixture = await makeFixture("directory");
    const alternateParent = join(fixture.base, "alternate-parent");
    const alternateSource = join(alternateParent, basename(fixture.source));
    await mkdir(alternateSource, { recursive: true });
    await Promise.all([
      writeFile(
        join(alternateSource, "capture.e57"),
        await readFile(join(fixture.source, "capture.e57")),
      ),
      writeFile(
        join(alternateSource, "mesh.obj"),
        await readFile(join(fixture.source, "mesh.obj")),
      ),
      writeFile(join(alternateSource, "notes.txt"), "changed excluded notes\n"),
      writeFile(join(alternateSource, "extra-excluded.txt"), "extra excluded file\n"),
    ]);

    await expectBridgeError(
      () => buildReferenceVerificationAdmittedSubjectV0({
        source: alternateSource,
        trustedStartupSourceIdentity: fixture.trustedStartupSourceIdentity,
        receipt: fixture.receipt,
        admissionDraft: fixture.admissionDraft,
      }),
      "REFERENCE_SOURCE_IDENTITY_MISMATCH",
    );
  });

  it("rejects a same-label hard-link alias of the exact same single-file object", async () => {
    const fixture = await makeFixture("file");
    const alternateParent = join(fixture.base, "hard-link-alias-parent");
    await mkdir(alternateParent);
    const aliasPath = join(alternateParent, basename(fixture.source));
    await link(fixture.source, aliasPath);

    await expectBridgeError(
      () => buildReferenceVerificationAdmittedSubjectV0({
        source: aliasPath,
        trustedStartupSourceIdentity: fixture.trustedStartupSourceIdentity,
        receipt: fixture.receipt,
        admissionDraft: fixture.admissionDraft,
      }),
      "REFERENCE_SOURCE_IDENTITY_MISMATCH",
    );
  });

  it("rejects stale and tampered receipt/admission digest chains", async () => {
    const first = await makeFixture("directory");
    const second = await makeFixture("directory");
    await writeFile(join(second.source, "capture.e57"), Buffer.from("ASTM-E57\0different", "ascii"));
    const changedReceipt = await inspectUniversalIntake(second.source);
    const changedDraft = compileGuidedAdmissionDraft(changedReceipt, admissionInput(changedReceipt));

    await expectBridgeError(
      () => buildReferenceVerificationAdmittedSubjectV0({
        source: first.source,
        trustedStartupSourceIdentity: first.trustedStartupSourceIdentity,
        receipt: first.receipt,
        admissionDraft: changedDraft,
      }),
      "REFERENCE_ADMISSION_STALE_DIGEST",
    );

    const tamperedReceipt = cloneJson(first.receipt);
    tamperedReceipt.source.label = "changed-label";
    await expectBridgeError(
      () => buildReferenceVerificationAdmittedSubjectV0({
        source: first.source,
        trustedStartupSourceIdentity: first.trustedStartupSourceIdentity,
        receipt: tamperedReceipt,
        admissionDraft: first.admissionDraft,
      }),
      "REFERENCE_RECEIPT_INVALID",
    );
  });

  it("rejects wrong manifest paths, hashes, sizes, missing/extra assets, and case collisions", async () => {
    const fixture = await makeFixture("directory");
    const mutationCases: Array<(draft: Record<string, unknown>) => void> = [
      (draft) => {
        const result = draft.result as { manifest: { assets: Array<{ relativePath: string }> } };
        const asset = result.manifest.assets[0];
        if (asset !== undefined) asset.relativePath = "wrong.e57";
      },
      (draft) => {
        const result = draft.result as { manifest: { assets: Array<{ sha256: string }> } };
        const asset = result.manifest.assets[0];
        if (asset !== undefined) asset.sha256 = "sha256:" + "0".repeat(64);
      },
      (draft) => {
        const result = draft.result as { manifest: { assets: Array<{ sizeBytes: number }> } };
        const asset = result.manifest.assets[0];
        if (asset !== undefined) asset.sizeBytes += 1;
      },
      (draft) => {
        const result = draft.result as { manifest: { assets: unknown[] } };
        result.manifest.assets.pop();
      },
      (draft) => {
        const result = draft.result as { manifest: { assets: unknown[] } };
        const asset = result.manifest.assets[0];
        if (asset !== undefined) result.manifest.assets.push(cloneJson(asset));
      },
      (draft) => {
        const result = draft.result as {
          manifest: { assets: Array<{ id: string; relativePath: string }> };
        };
        const asset = result.manifest.assets[0];
        if (asset !== undefined) {
          const collision = cloneJson(asset);
          collision.id += "-case-collision";
          collision.relativePath = asset.relativePath.toUpperCase();
          result.manifest.assets.push(collision);
        }
      },
      (draft) => {
        const result = draft.result as { manifest: { assets: Array<{ sha256: string }> } };
        const asset = result.manifest.assets[0];
        if (asset !== undefined) asset.sha256 = asset.sha256.slice("sha256:".length);
      },
    ];

    for (const mutate of mutationCases) {
      const draft = cloneRecord(fixture.admissionDraft);
      mutate(draft);
      await expectBridgeError(() => buildReferenceVerificationAdmittedSubjectV0({
        source: fixture.source,
        trustedStartupSourceIdentity: fixture.trustedStartupSourceIdentity,
        receipt: fixture.receipt,
        admissionDraft: draft,
      }));
    }
  });

  it("rejects an empty admission and a source kind or label mismatch", async () => {
    const fixture = await makeFixture("directory");
    const empty = cloneRecord(fixture.admissionDraft);
    const emptyReview = (empty.review as { decisions: Array<{ action: string }> }).decisions;
    for (const decision of emptyReview) decision.action = "exclude";
    (empty.result as { manifest: { assets: unknown[] } }).manifest.assets = [];
    await expectBridgeError(() => buildReferenceVerificationAdmittedSubjectV0({
      source: fixture.source,
      trustedStartupSourceIdentity: fixture.trustedStartupSourceIdentity,
      receipt: fixture.receipt,
      admissionDraft: empty,
    }));

    const otherDirectory = join(fixture.base, "wrong-source-label");
    await mkdir(otherDirectory);
    await expectBridgeError(
      () => buildReferenceVerificationAdmittedSubjectV0({
        source: otherDirectory,
        trustedStartupSourceIdentity: fixture.trustedStartupSourceIdentity,
        receipt: fixture.receipt,
        admissionDraft: fixture.admissionDraft,
      }),
      "REFERENCE_SOURCE_IDENTITY_MISMATCH",
    );

    const otherParent = join(fixture.base, "other-parent");
    await mkdir(otherParent);
    const otherFile = join(otherParent, fixture.receipt.source.label);
    await writeFile(otherFile, "not the directory source");
    await expectBridgeError(
      () => buildReferenceVerificationAdmittedSubjectV0({
        source: otherFile,
        trustedStartupSourceIdentity: fixture.trustedStartupSourceIdentity,
        receipt: fixture.receipt,
        admissionDraft: fixture.admissionDraft,
      }),
      "REFERENCE_SOURCE_IDENTITY_MISMATCH",
    );
  });
});

describe("safe default private-state root preparation", () => {
  it("rejects a profile-base junction into the source without mutating the source", async () => {
    const fixture = await makeFixture("directory");
    const redirectedBase = join(fixture.base, "redirected-profile-base");
    await symlink(
      fixture.source,
      redirectedBase,
      process.platform === "win32" ? "junction" : "dir",
    );
    const sourceEntriesBefore = (await readdir(fixture.source)).sort();

    await expectBridgeError(
      () => prepareDefaultReferenceVerificationPrivateStateRootV0({
        source: fixture.source,
        trustedProfileBase: redirectedBase,
      }),
      "REFERENCE_PRIVATE_STATE_INDIRECT_PATH",
    );
    expect((await readdir(fixture.source)).sort()).toEqual(sourceEntriesBefore);
    expect(sourceEntriesBefore).not.toContain(
      REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
    );
  });

  it("rejects a final state-root junction without writing through it", async () => {
    const fixture = await makeFixture("directory");
    const profileBase = join(fixture.base, "profile-base-final-link");
    await mkdir(profileBase, { mode: 0o700 });
    const finalPath = join(
      profileBase,
      REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
    );
    await symlink(
      fixture.source,
      finalPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    const sourceEntriesBefore = (await readdir(fixture.source)).sort();

    await expectBridgeError(
      () => prepareDefaultReferenceVerificationPrivateStateRootV0({
        source: fixture.source,
        trustedProfileBase: profileBase,
      }),
      "REFERENCE_PRIVATE_STATE_INDIRECT_PATH",
    );
    expect((await readdir(fixture.source)).sort()).toEqual(sourceEntriesBefore);
  });

  it("rejects replacement of the trusted profile base before creating the child", async () => {
    const fixture = await makeFixture("directory");
    const profileBase = join(fixture.base, "profile-base-replaced");
    const movedBase = join(fixture.base, "profile-base-original");
    await mkdir(profileBase, { mode: 0o700 });

    await expectBridgeError(
      () => prepareDefaultReferenceVerificationPrivateStateRootV0({
        source: fixture.source,
        trustedProfileBase: profileBase,
        testHooks: {
          afterBaseInspectionBeforeRecheck: async () => {
            await rename(profileBase, movedBase);
            await mkdir(profileBase, { mode: 0o700 });
          },
        },
      }),
      "REFERENCE_DEFAULT_PRIVATE_STATE_BASE_CHANGED",
    );
    expect(await readdir(profileBase)).toEqual([]);
    expect(await readdir(movedBase)).toEqual([]);
  });

  it("rejects replacement of the app-private child during final validation", async () => {
    const fixture = await makeFixture("directory");
    const profileBase = join(fixture.base, "profile-base-child-replaced");
    const finalPath = join(
      profileBase,
      REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
    );
    const movedChild = join(profileBase, "private-state-original");
    await mkdir(profileBase, { mode: 0o700 });

    await expectBridgeError(
      () => prepareDefaultReferenceVerificationPrivateStateRootV0({
        source: fixture.source,
        trustedProfileBase: profileBase,
        testHooks: {
          afterChildReadyBeforeFinalRecheck: async () => {
            await rename(finalPath, movedChild);
            await mkdir(finalPath, { mode: 0o700 });
          },
        },
      }),
      "REFERENCE_DEFAULT_PRIVATE_STATE_CHILD_CHANGED",
    );
  });

  it("converges safely when many callers create the same one-component child", async () => {
    const fixture = await makeFixture("directory");
    const profileBase = join(fixture.base, "profile-base-concurrent");
    await mkdir(profileBase, { mode: 0o700 });
    const prepared = await Promise.all(Array.from({ length: 32 }, async () =>
      prepareDefaultReferenceVerificationPrivateStateRootV0({
        source: fixture.source,
        trustedProfileBase: profileBase,
      })
    ));

    expect(new Set(prepared).size).toBe(1);
    expect(await readdir(profileBase)).toEqual([
      REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
    ]);
    expect(prepared[0]).toBe(await realpath(join(
      profileBase,
      REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
    )));
  });

  it("accepts an existing secure child without changing its identity or mode", async () => {
    const fixture = await makeFixture("directory");
    const profileBase = join(fixture.base, "profile-base-existing");
    const finalPath = join(
      profileBase,
      REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
    );
    await mkdir(profileBase, { mode: 0o700 });
    await mkdir(finalPath, { mode: 0o700 });
    const before = await lstat(finalPath, { bigint: true });

    const prepared = await prepareDefaultReferenceVerificationPrivateStateRootV0({
      source: fixture.source,
      trustedProfileBase: profileBase,
    });
    const after = await lstat(finalPath, { bigint: true });
    expect(prepared).toBe(await realpath(finalPath));
    expect(after.dev).toBe(before.dev);
    expect(after.ino).toBe(before.ino);
    expect(after.mode).toBe(before.mode);
    expect(after.ctimeNs).toBe(before.ctimeNs);
  });

  it("rejects an insecure existing POSIX child without chmodding it", async () => {
    if (process.platform === "win32") return;
    const fixture = await makeFixture("directory");
    const profileBase = join(fixture.base, "profile-base-insecure");
    const finalPath = join(
      profileBase,
      REFERENCE_VERIFICATION_DEFAULT_PRIVATE_STATE_DIRECTORY_V0,
    );
    await mkdir(profileBase, { mode: 0o700 });
    await mkdir(finalPath, { mode: 0o755 });
    await chmod(finalPath, 0o755);

    await expectBridgeError(
      () => prepareDefaultReferenceVerificationPrivateStateRootV0({
        source: fixture.source,
        trustedProfileBase: profileBase,
      }),
      "REFERENCE_PRIVATE_STATE_PERMISSIONS",
    );
    expect((await lstat(finalPath, { bigint: true })).mode & 0o777n).toBe(0o755n);
  });
});

describe("private local record-authentication key bridge", () => {
  it("creates one stable 32-byte key safely under concurrent callers", async () => {
    const fixture = await makeFixture("directory");
    const authentications = await Promise.all(Array.from({ length: 24 }, async () =>
      loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: fixture.privateStateRoot,
        source: fixture.source,
      })
    ));

    const keyIds = new Set(authentications.map((authentication) => authentication.keyId));
    const keyHexes = new Set(authentications.map((authentication) =>
      Buffer.from(authentication.copyKeyBytes()).toString("hex")
    ));
    expect(keyIds.size).toBe(1);
    expect(keyHexes.size).toBe(1);
    const keyBytes = authentications[0]?.copyKeyBytes();
    expect(keyBytes?.byteLength).toBe(32);
    expect(authentications[0]?.keyId).toBe(`sha256:${sha256(keyBytes ?? new Uint8Array())}`);
    expect(authentications[0]?.trustBoundary).toBe(REFERENCE_VERIFICATION_LOCAL_TRUST_BOUNDARY_V0);

    const keyPath = join(
      fixture.privateStateRoot,
      REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
      REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0,
    );
    expect((await readFile(keyPath)).byteLength).toBe(32);

    const loadedAgain = await loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot: fixture.privateStateRoot,
      source: fixture.source,
    });
    expect(loadedAgain.keyId).toBe(authentications[0]?.keyId);
    expect(Buffer.from(loadedAgain.copyKeyBytes())).toEqual(Buffer.from(keyBytes ?? []));
  });

  it("keeps the fixed final filename absent until an fsynced temp is atomically published", async () => {
    const fixture = await makeFixture("directory");
    const tempWasSynced = deferredVoid();
    const releaseCreator = deferredVoid();
    const creator = loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot: fixture.privateStateRoot,
      source: fixture.source,
      testHooks: {
        afterTempFileSyncBeforePublish: async () => {
          tempWasSynced.resolve();
          await releaseCreator.promise;
        },
      },
    });
    await tempWasSynced.promise;

    const namespacePath = join(
      fixture.privateStateRoot,
      REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
    );
    const keyPath = join(namespacePath, REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0);
    await expect(readFile(keyPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(namespacePath)).filter((name) => name.endsWith(".partial"))).toHaveLength(1);
    releaseCreator.resolve();
    const createdAuthentication = await creator;
    expect((await readFile(keyPath)).byteLength).toBe(32);
    expect(createdAuthentication.keyId).toBe(`sha256:${sha256(await readFile(keyPath))}`);
    expect((await readdir(namespacePath)).filter((name) => name.endsWith(".partial"))).toEqual([]);
  });

  it("does not let a follower accept the final key before the namespace commit", async () => {
    const fixture = await makeFixture("directory");
    const finalWasLinked = deferredVoid();
    const releaseCommit = deferredVoid();
    const followerObservedUncommittedFinal = deferredVoid();
    const creator = loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot: fixture.privateStateRoot,
      source: fixture.source,
      testHooks: {
        afterAtomicPublishBeforeNamespaceSync: async () => {
          finalWasLinked.resolve();
          await releaseCommit.promise;
        },
      },
    });
    await finalWasLinked.promise;

    let followerSettled = false;
    const follower = loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot: fixture.privateStateRoot,
      source: fixture.source,
      testHooks: {
        onConcurrentReadRetry: (code) => {
          if (code === "REFERENCE_AUTHENTICATION_KEY_IDENTITY_INVALID") {
            followerObservedUncommittedFinal.resolve();
          }
        },
      },
    });
    void follower.then(
      () => { followerSettled = true; },
      () => { followerSettled = true; },
    );
    await followerObservedUncommittedFinal.promise;
    expect(followerSettled).toBe(false);

    releaseCommit.resolve();
    const [createdAuthentication, followerAuthentication] = await Promise.all([creator, follower]);
    expect(followerAuthentication.keyId).toBe(createdAuthentication.keyId);
  });

  it("recovers from an abandoned fsynced temp after a pre-publication failure", async () => {
    const fixture = await makeFixture("directory");
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: fixture.privateStateRoot,
        source: fixture.source,
        testHooks: {
          afterTempFileSyncBeforePublish: () => {
            throw new Error("injected pre-publication crash");
          },
        },
      }),
      "REFERENCE_AUTHENTICATION_KEY_PRE_PUBLISH_FAILED",
    );
    const namespacePath = join(
      fixture.privateStateRoot,
      REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
    );
    const keyPath = join(namespacePath, REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0);
    await expect(readFile(keyPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(namespacePath)).filter((name) => name.endsWith(".partial"))).toHaveLength(1);

    const recovered = await loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot: fixture.privateStateRoot,
      source: fixture.source,
    });
    expect(recovered.keyId).toBe(`sha256:${sha256(await readFile(keyPath))}`);
    expect((await readdir(namespacePath)).filter((name) => name.endsWith(".partial"))).toEqual([]);
  });

  it("preserves an atomically published final key after a post-publication failure", async () => {
    const fixture = await makeFixture("directory");
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: fixture.privateStateRoot,
        source: fixture.source,
        testHooks: {
          afterAtomicPublishBeforeNamespaceSync: () => {
            throw new Error("injected post-publication sync failure");
          },
        },
      }),
      "REFERENCE_AUTHENTICATION_KEY_POST_PUBLISH_FAILED",
    );
    const namespacePath = join(
      fixture.privateStateRoot,
      REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
    );
    const keyPath = join(namespacePath, REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0);
    const publishedBytes = await readFile(keyPath);
    expect(publishedBytes.byteLength).toBe(32);
    expect((await readdir(namespacePath)).filter((name) => name.endsWith(".partial"))).toHaveLength(1);

    const recovered = await loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot: fixture.privateStateRoot,
      source: fixture.source,
    });
    expect(recovered.keyId).toBe(`sha256:${sha256(publishedBytes)}`);
    expect((await readdir(namespacePath)).filter((name) => name.endsWith(".partial"))).toEqual([]);
  });

  it("does not reveal key bytes through JSON, String, or normal object inspection", async () => {
    const fixture = await makeFixture("directory");
    const authentication = await loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot: fixture.privateStateRoot,
      source: fixture.source,
    });
    const keyBytes = Buffer.from(authentication.copyKeyBytes());
    const serialized = [
      JSON.stringify(authentication),
      String(authentication),
      inspect(authentication),
    ].join("\n");

    expect(serialized).not.toContain(keyBytes.toString("hex"));
    expect(serialized).not.toContain(keyBytes.toString("base64"));
    expect(serialized).not.toContain(keyBytes.toString("base64url"));
    expect(JSON.parse(JSON.stringify(authentication))).toEqual({
      schemaVersion: "omnitwin.reference-integrity-record-authentication/v0",
      keyId: authentication.keyId,
      trustBoundary: "local_os_user_profile",
    });
    expect(Object.keys(authentication)).toEqual(["keyId", "trustBoundary"]);
  });

  it("rejects a wrong-length persisted key without replacing it", async () => {
    const fixture = await makeFixture("directory");
    const namespacePath = join(
      fixture.privateStateRoot,
      REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
    );
    await mkdir(namespacePath, { mode: 0o700 });
    const keyPath = join(
      namespacePath,
      REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0,
    );
    const wrongBytes = Buffer.alloc(31, 0x5a);
    await writeFile(keyPath, wrongBytes, { mode: 0o600 });

    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: fixture.privateStateRoot,
        source: fixture.source,
      }),
      "REFERENCE_AUTHENTICATION_KEY_LENGTH_INVALID",
    );
    expect(await readFile(keyPath)).toEqual(wrongBytes);
  });

  it("rejects linked state paths and linked key files", async () => {
    const fixture = await makeFixture("directory");
    const stateLink = join(fixture.base, "private-state-link");
    await symlink(fixture.privateStateRoot, stateLink, process.platform === "win32" ? "junction" : "dir");
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: stateLink,
        source: fixture.source,
      }),
      "REFERENCE_PRIVATE_STATE_INDIRECT_PATH",
    );

    const namespacePath = join(
      fixture.privateStateRoot,
      REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
    );
    await mkdir(namespacePath, { mode: 0o700 });
    const target = join(namespacePath, "other.key");
    const keyPath = join(namespacePath, REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0);
    await writeFile(target, Buffer.alloc(32, 0x2a), { mode: 0o600 });
    await link(target, keyPath);
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: fixture.privateStateRoot,
        source: fixture.source,
      }),
      "REFERENCE_AUTHENTICATION_KEY_IDENTITY_INVALID",
    );
  });

  it("rejects replacement of the private state root during namespace preparation", async () => {
    const fixture = await makeFixture("directory");
    const movedRoot = join(fixture.base, "private-state-moved");
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: fixture.privateStateRoot,
        source: fixture.source,
        testHooks: {
          afterPrivateNamespacePreparedBeforeRootRecheck: async () => {
            await rename(fixture.privateStateRoot, movedRoot);
            await mkdir(fixture.privateStateRoot, { mode: 0o700 });
          },
        },
      }),
      "REFERENCE_PRIVATE_STATE_CHANGED",
    );
  });

  it("rejects replacement of the fixed private namespace object", async () => {
    const fixture = await makeFixture("directory");
    const namespacePath = join(
      fixture.privateStateRoot,
      REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
    );
    const movedNamespace = join(fixture.privateStateRoot, "verification-namespace-moved");
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: fixture.privateStateRoot,
        source: fixture.source,
        testHooks: {
          afterPrivateNamespacePreparedBeforeRootRecheck: async () => {
            await rename(namespacePath, movedNamespace);
            await mkdir(namespacePath, { mode: 0o700 });
          },
        },
      }),
      "REFERENCE_PRIVATE_NAMESPACE_CHANGED",
    );
  });

  it("rejects a fixed key pathname that changes after bytes are read", async () => {
    const fixture = await makeFixture("directory");
    await loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot: fixture.privateStateRoot,
      source: fixture.source,
    });
    const keyPath = join(
      fixture.privateStateRoot,
      REFERENCE_VERIFICATION_PRIVATE_NAMESPACE_V0,
      REFERENCE_VERIFICATION_RECORD_AUTHENTICATION_KEY_FILE_V0,
    );
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: fixture.privateStateRoot,
        source: fixture.source,
        testHooks: {
          afterKeyBytesReadBeforePathRecheck: async () => {
            const changedTime = new Date(Date.now() + 60_000);
            await utimes(keyPath, changedTime, changedTime);
          },
        },
      }),
      "REFERENCE_AUTHENTICATION_KEY_CHANGED",
    );
  });

  it("rejects identifiable Windows UNC and device-style private state roots", async () => {
    if (process.platform !== "win32") return;
    const fixture = await makeFixture("directory");
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: "\\\\example.invalid\\profile-state",
        source: fixture.source,
      }),
      "REFERENCE_PRIVATE_STATE_REMOTE_OR_DEVICE_PATH",
    );
  });

  it("rejects either direction of source/state overlap", async () => {
    const base = await mkdtemp(join(tmpdir(), "foundry-reference-overlap-"));
    cleanup.push(base);
    const source = join(base, "source");
    const nestedState = join(source, "private-state");
    await mkdir(nestedState, { recursive: true, mode: 0o700 });
    await writeFile(join(source, "capture.e57"), Buffer.from("ASTM-E57\0fixture", "ascii"));
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot: nestedState,
        source,
      }),
      "REFERENCE_SOURCE_STATE_OVERLAP",
    );

    const privateStateRoot = join(base, "private-root");
    const nestedSource = join(privateStateRoot, "capture-source");
    await mkdir(nestedSource, { recursive: true, mode: 0o700 });
    await expectBridgeError(
      () => loadOrCreateReferenceVerificationRecordAuthenticationV0({
        privateStateRoot,
        source: nestedSource,
      }),
      "REFERENCE_SOURCE_STATE_OVERLAP",
    );
  });
});
