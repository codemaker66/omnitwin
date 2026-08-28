import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";

import {
  __testOnlyGrandHallT554NativeReviewSessionOwnerV2,
  acquireGrandHallT554NativeReviewSessionOwnerV2,
  assertGrandHallT554NativeReviewSessionOwnerV2,
  deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2,
  explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2,
  inspectGrandHallT554NativeReviewPriorOwnerV2,
  releaseGrandHallT554NativeReviewSessionOwnerV2,
  type GrandHallT554NativeReviewPriorOwnerWitnessV2,
} from "../grand-hall-t554-native-review-session-owner-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  type GrandHallT554NativeReviewSessionScopeV2,
} from "../grand-hall-t554-native-review-events-v2.js";

type Sha256 = `sha256:${string}`;

interface Fixture {
  readonly parent: string;
  readonly root: string;
  readonly scope: GrandHallT554NativeReviewSessionScopeV2;
}

interface StageSeamInfo {
  readonly kind: "control" | "transition";
  readonly stagePath: string;
  readonly canonicalPath: string;
  readonly targetFileSha256: Sha256;
}

type StageInterruption = "created" | "partial" | "synced" | "linked";

const parents: string[] = [];

function digest(seed: string): Sha256 {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function artifact(seed: string) {
  return {
    semanticSha256: digest(`${seed}-semantic`),
    fileSha256: digest(`${seed}-file`),
    byteLength: 1_024,
  };
}

const authority = {
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-authority-boundary.v2" as const,
  authority: "none" as const,
  reviewState: "human_pending" as const,
  finalDecision: "PENDING" as const,
  acceptanceAuthorized: false as const,
  reconstructionAuthorized: false as const,
  runtimeAuthorized: false as const,
  exportAuthorized: false as const,
  generatedContentAuthorized: false as const,
};

const registry = {
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-registry-binding.v2" as const,
  venueSlug: "trades-hall" as const,
  roomSlug: "grand-hall" as const,
  sourceCount: 148 as const,
  reviewPack: artifact("review-pack"),
  publicationReceipt: artifact("receipt"),
  authority: "none" as const,
  reviewState: "human_pending" as const,
  finalDecision: "PENDING" as const,
  acceptanceAuthorized: false as const,
  reconstructionAuthorized: false as const,
  runtimeAuthorized: false as const,
  exportAuthorized: false as const,
  generatedContentAuthorized: false as const,
};

const implementation = {
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
  implementationId:
    "grand-hall-t554-native-review-workbench-v1" as const,
  semanticSha256: digest("implementation-semantic"),
  fileSha256: digest("implementation-file"),
  byteLength: 8_192,
};

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

async function fixture(seed: string): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), "venviewer-t554-owner-v2-"));
  parents.push(parent);
  const root = join(parent, "session-root");
  await mkdir(root);
  const scope: GrandHallT554NativeReviewSessionScopeV2 = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "session",
    sessionIdSha256: digest(`${seed}-session`),
    subjectSha256: digest(`${seed}-subject`),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
  };
  await writeFile(
    join(root, "session-root.json"),
    canonicalBytes({
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-root-descriptor.v2",
      sessionScope: scope,
      implementationManifestFileName:
        "grand-hall-t554-native-review-implementation-manifest.json",
      coordinatorDirectoryName: "coordinator",
      childScopesDirectoryName: "child-scopes",
      childrenDirectoryName: "children",
      maskEvidenceDirectoryName: "mask-evidence",
    }),
  );
  return { parent, root, scope };
}

async function subprocessAcquire(
  built: Fixture,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number }> {
  const modulePath = fileURLToPath(
    new URL("../grand-hall-t554-native-review-session-owner-v2.ts", import.meta.url),
  );
  const script = `
    import { acquireGrandHallT554NativeReviewSessionOwnerV2 } from ${JSON.stringify(pathToFileURL(modulePath).href)};
    const scope = JSON.parse(Buffer.from(process.env.VENVIEWER_SCOPE_B64, "base64url").toString("utf8"));
    try {
      await acquireGrandHallT554NativeReviewSessionOwnerV2({ sessionRoot: process.env.VENVIEWER_ROOT, expectedSessionScope: scope });
      process.stdout.write("winner");
    } catch (error) {
      process.stdout.write("loser:" + String(error && typeof error === "object" && "code" in error ? error.code : "unknown"));
    }
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        VENVIEWER_ROOT: built.root,
        VENVIEWER_SCOPE_B64: Buffer.from(JSON.stringify(built.scope)).toString(
          "base64url",
        ),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (exitCode) => {
      resolvePromise(exitCode ?? -1);
    });
  });
  return { stdout, stderr, code };
}

async function requiredWitness(
  built: Fixture,
): Promise<GrandHallT554NativeReviewPriorOwnerWitnessV2> {
  const witness = await inspectGrandHallT554NativeReviewPriorOwnerV2({
    sessionRoot: built.root,
    expectedSessionScope: built.scope,
  });
  if (witness === null) throw new Error("fixture has no prior owner witness");
  return witness;
}

async function interruptAcquireAtStage(
  built: Fixture,
  kind: StageSeamInfo["kind"],
  interruption: StageInterruption,
): Promise<void> {
  const stop = (stage: StageSeamInfo): void => {
    if (stage.kind === kind) {
      throw new Error(`simulated ${kind} ${interruption} interruption`);
    }
  };
  const attempt = {
    sessionRoot: built.root,
    expectedSessionScope: built.scope,
  };
  const promise = interruption === "created"
    ? __testOnlyGrandHallT554NativeReviewSessionOwnerV2.acquire(attempt, {
        afterStageCreated: stop,
      })
    : interruption === "partial"
      ? __testOnlyGrandHallT554NativeReviewSessionOwnerV2.acquire(attempt, {
          afterStagePartialWrite: stop,
        })
      : interruption === "synced"
        ? __testOnlyGrandHallT554NativeReviewSessionOwnerV2.acquire(attempt, {
            afterStageFileSynced: stop,
          })
        : __testOnlyGrandHallT554NativeReviewSessionOwnerV2.acquire(attempt, {
            afterCanonicalLinkedBeforeDirectorySync: stop,
          });
  await expect(promise).rejects.toThrow(
    `simulated ${kind} ${interruption} interruption`,
  );
}

async function replaceRootWithExactDescriptor(built: Fixture): Promise<string> {
  const displaced = `${built.root}-displaced`;
  const descriptor = await readFile(join(built.root, "session-root.json"));
  await rename(built.root, displaced);
  await mkdir(built.root);
  await writeFile(join(built.root, "session-root.json"), descriptor);
  return displaced;
}

async function restoreRoot(built: Fixture, displaced: string): Promise<void> {
  await rm(built.root, { recursive: true, force: true });
  await rename(displaced, built.root);
}

afterEach(async () => {
  await Promise.all(
    parents.splice(0).map((parent) =>
      rm(parent, { recursive: true, force: true }),
    ),
  );
});

describe("Grand Hall T-554 session-root owner v2", () => {
  it("gives exactly one of two processes the atomic acquisition slot", async () => {
    const built = await fixture("process-race");
    const results = await Promise.all([
      subprocessAcquire(built),
      subprocessAcquire(built),
    ]);
    expect(results.every((result) => result.code === 0)).toBe(true);
    expect(results.filter((result) => result.stdout === "winner")).toHaveLength(1);
    expect(results.filter((result) => result.stdout.startsWith("loser:"))).toHaveLength(1);
    expect(results.map((result) => result.stderr).join("")).toBe("");
    expect(await requiredWitness(built)).toMatchObject({ transitionSequence: 1 });
  });

  it("requires an exact branded witness and makes the prior lease stale", async () => {
    const built = await fixture("takeover");
    const priorLease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
    });
    const witness = await requiredWitness(built);
    await expect(
      explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2({
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
        priorOwnerWitness: structuredClone(witness),
      }),
    ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });

    const other = await fixture("other-root");
    await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: other.root,
      expectedSessionScope: other.scope,
    });
    await expect(
      explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2({
        sessionRoot: other.root,
        expectedSessionScope: other.scope,
        priorOwnerWitness: witness,
      }),
    ).rejects.toMatchObject({ code: "STALE_WITNESS" });

    const successor =
      await explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2({
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
        priorOwnerWitness: witness,
      });
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease: priorLease,
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
      }),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease: successor,
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
      }),
    ).resolves.toBeUndefined();
  });

  it("recovers both pre-publication and post-publication takeover interruption", async () => {
    const before = await fixture("before-publication");
    await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: before.root,
      expectedSessionScope: before.scope,
    });
    const beforeWitness = await requiredWitness(before);
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionOwnerV2.takeOver(
        {
          sessionRoot: before.root,
          expectedSessionScope: before.scope,
          priorOwnerWitness: beforeWitness,
        },
        {
          afterRecordDurable: () => {
            throw new Error("simulated pre-publication crash");
          },
        },
      ),
    ).rejects.toThrow("simulated pre-publication crash");
    const recoveredBefore = await requiredWitness(before);
    const beforeLease =
      await explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2({
        sessionRoot: before.root,
        expectedSessionScope: before.scope,
        priorOwnerWitness: recoveredBefore,
      });
    expect(beforeLease.transitionSequence).toBe(2);

    const after = await fixture("after-publication");
    await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: after.root,
      expectedSessionScope: after.scope,
    });
    const afterWitness = await requiredWitness(after);
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionOwnerV2.takeOver(
        {
          sessionRoot: after.root,
          expectedSessionScope: after.scope,
          priorOwnerWitness: afterWitness,
        },
        {
          afterTransitionPublished: () => {
            throw new Error("simulated post-publication crash");
          },
        },
      ),
    ).rejects.toThrow("simulated post-publication crash");
    const committedCrashOwner = await requiredWitness(after);
    expect(committedCrashOwner.transitionSequence).toBe(2);
    const afterLease =
      await explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2({
        sessionRoot: after.root,
        expectedSessionScope: after.scope,
        priorOwnerWitness: committedCrashOwner,
      });
    expect(afterLease.transitionSequence).toBe(3);
  });

  it("makes release and takeover compete for one slot without deleting the winner", async () => {
    const built = await fixture("release-race");
    const lease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
    });
    const witness = await requiredWitness(built);
    let winner:
      | Awaited<
          ReturnType<
            typeof explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2
          >
        >
      | undefined;
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionOwnerV2.release(
        {
          lease,
          sessionRoot: built.root,
          expectedSessionScope: built.scope,
        },
        {
          beforeTransitionPublish: async () => {
            winner =
              await explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2({
                sessionRoot: built.root,
                expectedSessionScope: built.scope,
                priorOwnerWitness: witness,
              });
          },
        },
      ),
    ).rejects.toMatchObject({ code: "RACE_LOST" });
    if (winner === undefined) throw new Error("takeover did not win release race");
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease: winner,
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
      }),
    ).resolves.toBeUndefined();
    expect(await readdir(join(
      deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(built.root),
      "transitions",
    ))).toEqual(["0000000000000001.json", "0000000000000002.json"]);
  });

  it("releases without unlinking history and permits one later acquisition", async () => {
    const built = await fixture("release-reacquire");
    const first = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
    });
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease: first,
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
    });
    expect(await inspectGrandHallT554NativeReviewPriorOwnerV2({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
    })).toBeNull();
    const second = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
    });
    expect(second.transitionSequence).toBe(3);
  });

  it("rejects external hardlink aliases in the sibling control history", async () => {
    const built = await fixture("hardlink-alias");
    const lease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
    });
    const control = deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(
      built.root,
    );
    const recordName = (await readdir(join(control, "records")))[0];
    if (recordName === undefined) throw new Error("owner record is absent");
    await link(join(control, "records", recordName), join(built.parent, "alias"));
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease,
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
      }),
    ).rejects.toMatchObject({ code: "ROOT_UNSAFE" });
  });

  it("rejects control extras, unsafe case, missing members, and sequence holes", async () => {
    const extra = await fixture("control-extra");
    const extraLease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: extra.root,
      expectedSessionScope: extra.scope,
    });
    const extraControl =
      deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(extra.root);
    await writeFile(join(extraControl, "extra.json"), "x");
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease: extraLease,
        sessionRoot: extra.root,
        expectedSessionScope: extra.scope,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_INVALID" });

    const unsafeCase = await fixture("unsafe-case");
    const unsafeLease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: unsafeCase.root,
      expectedSessionScope: unsafeCase.scope,
    });
    await writeFile(
      join(
        deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(
          unsafeCase.root,
        ),
        "records",
        "UPPER.json",
      ),
      "x",
    );
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease: unsafeLease,
        sessionRoot: unsafeCase.root,
        expectedSessionScope: unsafeCase.scope,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_INVALID" });

    const missing = await fixture("missing-control");
    const missingLease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: missing.root,
      expectedSessionScope: missing.scope,
    });
    await rm(
      join(
        deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(
          missing.root,
        ),
        "control.json",
      ),
    );
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease: missingLease,
        sessionRoot: missing.root,
        expectedSessionScope: missing.scope,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_INVALID" });

    const hole = await fixture("sequence-hole");
    const holeLease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: hole.root,
      expectedSessionScope: hole.scope,
    });
    const transitionDirectory = join(
      deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(hole.root),
      "transitions",
    );
    await rename(
      join(transitionDirectory, "0000000000000001.json"),
      join(transitionDirectory, "0000000000000002.json"),
    );
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease: holeLease,
        sessionRoot: hole.root,
        expectedSessionScope: hole.scope,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_INVALID" });
  });

  it("recovers exact control and transition stages at every publication interruption", async () => {
    for (const kind of ["control", "transition"] as const) {
      for (const interruption of ["created", "partial", "synced", "linked"] as const) {
        const built = await fixture(`${kind}-${interruption}`);
        await interruptAcquireAtStage(built, kind, interruption);
        const lease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
          sessionRoot: built.root,
          expectedSessionScope: built.scope,
        });
        await expect(
          assertGrandHallT554NativeReviewSessionOwnerV2({
            lease,
            sessionRoot: built.root,
            expectedSessionScope: built.scope,
          }),
        ).resolves.toBeUndefined();
      }
    }
  });

  it("never removes a replacement installed before exact stage cleanup", async () => {
    const built = await fixture("stage-cleanup-replacement");
    let replacementPath: string | undefined;
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionOwnerV2.acquire(
        { sessionRoot: built.root, expectedSessionScope: built.scope },
        {
          beforeStageCleanup: async (stage: StageSeamInfo) => {
            if (stage.kind !== "control" || replacementPath !== undefined) return;
            replacementPath = stage.stagePath;
            await rename(stage.stagePath, `${stage.stagePath}-displaced`);
            await writeFile(stage.stagePath, "replacement");
          },
        },
      ),
    ).rejects.toMatchObject({ code: "RACE_LOST" });
    if (replacementPath === undefined) throw new Error("cleanup seam did not run");
    expect(await readFile(replacementPath, "utf8")).toBe("replacement");
  });

  it("fails closed when the session root is replaced before or after head publication", async () => {
    const before = await fixture("root-swap-before-head");
    let beforeDisplaced: string | undefined;
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionOwnerV2.acquire(
        { sessionRoot: before.root, expectedSessionScope: before.scope },
        {
          beforeTransitionPublish: async () => {
            beforeDisplaced = await replaceRootWithExactDescriptor(before);
          },
        },
      ),
    ).rejects.toMatchObject({ code: "RACE_LOST" });
    if (beforeDisplaced === undefined) throw new Error("root replacement seam did not run");
    await restoreRoot(before, beforeDisplaced);
    await expect(
      acquireGrandHallT554NativeReviewSessionOwnerV2({
        sessionRoot: before.root,
        expectedSessionScope: before.scope,
      }),
    ).resolves.toMatchObject({ transitionSequence: 1 });

    const after = await fixture("root-swap-after-head");
    let afterDisplaced: string | undefined;
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionOwnerV2.acquire(
        { sessionRoot: after.root, expectedSessionScope: after.scope },
        {
          afterTransitionPublished: async () => {
            afterDisplaced = await replaceRootWithExactDescriptor(after);
          },
        },
      ),
    ).rejects.toMatchObject({ code: "RACE_LOST" });
    if (afterDisplaced === undefined) throw new Error("post-head root seam did not run");
    await restoreRoot(after, afterDisplaced);
    const committedCrashOwner = await requiredWitness(after);
    await expect(
      explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2({
        sessionRoot: after.root,
        expectedSessionScope: after.scope,
        priorOwnerWitness: committedCrashOwner,
      }),
    ).resolves.toMatchObject({ transitionSequence: 2 });
  });

  it("detects an exact-topology control-directory clone before publishing the head", async () => {
    const built = await fixture("control-clone-race");
    const control = deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(
      built.root,
    );
    const displaced = `${control}-displaced`;
    let replaced = false;
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionOwnerV2.acquire(
        { sessionRoot: built.root, expectedSessionScope: built.scope },
        {
          beforeTransitionPublish: async () => {
            await rename(control, displaced);
            await mkdir(control);
            await Promise.all([
              mkdir(join(control, "records")),
              mkdir(join(control, "staging")),
              mkdir(join(control, "transitions")),
            ]);
            await writeFile(
              join(control, "control.json"),
              await readFile(join(displaced, "control.json")),
            );
            const stageNames = await readdir(join(displaced, "staging"));
            for (const stageName of stageNames) {
              const match = /^transition-sha256-([0-9a-f]{64})-nonce-[0-9a-f]{32}\.stage$/u.exec(
                stageName,
              );
              if (match?.[1] === undefined) continue;
              const stagePath = join(control, "staging", stageName);
              await writeFile(stagePath, await readFile(join(displaced, "staging", stageName)));
              await link(
                stagePath,
                join(control, "records", `transition-sha256-${match[1]}.json`),
              );
            }
            replaced = true;
          },
        },
      ),
    ).rejects.toMatchObject({ code: "RACE_LOST" });
    expect(replaced).toBe(true);
    await rm(control, { recursive: true, force: true });
    await rename(displaced, control);
    await expect(
      acquireGrandHallT554NativeReviewSessionOwnerV2({
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
      }),
    ).resolves.toMatchObject({ transitionSequence: 1 });
  });

  it("rejects a record-only orphan that has no exact staging residue", async () => {
    const built = await fixture("record-only-orphan");
    const lease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
    });
    const transitions = join(
      deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(built.root),
      "transitions",
    );
    await rm(join(transitions, "0000000000000001.json"));
    await expect(
      assertGrandHallT554NativeReviewSessionOwnerV2({
        lease,
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
      }),
    ).rejects.toMatchObject({ code: "ROOT_UNSAFE" });
  });
});
