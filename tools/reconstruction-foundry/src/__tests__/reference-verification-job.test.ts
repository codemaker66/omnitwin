import { createHash, createHmac } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  REFERENCE_INTEGRITY_VERIFY_MAX_ADMITTED_FILES_V0,
  REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0,
  ReferenceIntegrityVerificationCoordinatorV0,
  type ReferenceIntegrityVerificationCoordinatorOptionsV0,
  type ReferenceVerificationAdmittedSubjectV0,
  type ReferenceVerificationDurableCheckpointEventV0,
  type ReferenceVerificationJobControlV0,
} from "../reference-verification-job.js";

const cleanup: string[] = [];
const RECORD_AUTHENTICATION_KEY = Buffer.alloc(32, 0x5a);

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(async (path) => rm(path, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function patternedBytes(sizeBytes: number): Buffer {
  const bytes = Buffer.allocUnsafe(sizeBytes);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 17) & 0xff;
  return bytes;
}

interface Fixture {
  readonly base: string;
  readonly source: string;
  readonly evidence: string;
  readonly sourceFile: string;
  readonly sourceBytes: Buffer;
  readonly subject: ReferenceVerificationAdmittedSubjectV0;
}

async function makeFixture(sizeBytes = 512 * 1024): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "foundry-reference-job-"));
  cleanup.push(base);
  const source = join(base, "approved-source");
  const evidence = join(base, "private-evidence");
  await Promise.all([
    mkdir(source, { mode: 0o700 }),
    mkdir(evidence, { mode: 0o700 }),
  ]);
  const sourceBytes = patternedBytes(sizeBytes);
  const sourceFile = join(source, "capture.bin");
  await writeFile(sourceFile, sourceBytes);
  const canonicalSource = await realpath(source);
  return {
    base,
    source: canonicalSource,
    evidence: await realpath(evidence),
    sourceFile,
    sourceBytes,
    subject: {
      sourceKind: "directory",
      canonicalSourcePath: canonicalSource,
      receiptSha256: "a".repeat(64),
      reviewSha256: "b".repeat(64),
      admissionResultSha256: "c".repeat(64),
      manifestSha256: "d".repeat(64),
      files: [{
        relativePath: "capture.bin",
        sizeBytes: sourceBytes.length,
        sha256: sha256(sourceBytes),
      }],
    },
  };
}

function optionsFor(
  fixture: Fixture,
  extra: Partial<ReferenceIntegrityVerificationCoordinatorOptionsV0> = {},
): ReferenceIntegrityVerificationCoordinatorOptionsV0 {
  const { recordAuthenticationKey, ...remaining } = extra;
  return {
    evidenceRoot: fixture.evidence,
    subject: fixture.subject,
    recordAuthenticationKey: recordAuthenticationKey ?? RECORD_AUTHENTICATION_KEY,
    checkpointIntervalBytes: 64 * 1024,
    readBufferBytes: 16 * 1024,
    ...remaining,
  };
}

function jobDirectory(fixture: Fixture, jobId: string): string {
  return join(fixture.evidence, REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0, jobId);
}

async function writeAuthenticatedStaleWriterLock(fixture: Fixture, jobId: string): Promise<void> {
  const unsigned = {
    schemaVersion: "omnitwin.reference-integrity-verification-writer-lock/v0",
    jobId,
    processId: 2_147_483_647,
    ownerToken: "1".repeat(64),
    acquiredAt: "2026-07-13T12:00:00.000Z",
  };
  const selfDigested = {
    ...unsigned,
    lockSha256: domainSeparatedSha256(
      "OMNITWIN.REFERENCE_VERIFY.LOCK.V0",
      toCanonicalJson(unsigned),
    ),
  };
  const authenticationHmacSha256 = createHmac("sha256", RECORD_AUTHENTICATION_KEY)
    .update("OMNITWIN.REFERENCE_VERIFY.LOCK_AUTH.V0", "ascii")
    .update(Buffer.from([0]))
    .update(stableCanonicalJson(toCanonicalJson(selfDigested)), "utf8")
    .digest("hex");
  await writeFile(
    join(jobDirectory(fixture, jobId), "writer.lock.json"),
    `${stableCanonicalJson(toCanonicalJson({ ...selfDigested, authenticationHmacSha256 }))}\n`,
    { flag: "wx" },
  );
}

async function writeAuthenticatedDeadTakeoverClaim(
  fixture: Fixture,
  jobId: string,
): Promise<void> {
  const unsigned = {
    schemaVersion: "omnitwin.reference-integrity-verification-writer-takeover-claim/v0",
    jobId,
    processId: 2_147_483_647,
    ownerToken: "2".repeat(64),
    claimedAt: "2026-07-13T12:00:01.000Z",
  };
  const selfDigested = {
    ...unsigned,
    claimSha256: domainSeparatedSha256(
      "OMNITWIN.REFERENCE_VERIFY.TAKEOVER_CLAIM.V0",
      toCanonicalJson(unsigned),
    ),
  };
  const authenticationHmacSha256 = createHmac("sha256", RECORD_AUTHENTICATION_KEY)
    .update("OMNITWIN.REFERENCE_VERIFY.TAKEOVER_CLAIM_AUTH.V0", "ascii")
    .update(Buffer.from([0]))
    .update(stableCanonicalJson(toCanonicalJson(selfDigested)), "utf8")
    .digest("hex");
  await writeFile(
    join(jobDirectory(fixture, jobId), "writer.takeover.claim"),
    `${stableCanonicalJson(toCanonicalJson({ ...selfDigested, authenticationHmacSha256 }))}\n`,
    { flag: "wx" },
  );
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const output: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else output.push(path);
    }
  }
  await walk(root);
  return output.sort();
}

async function writeSynthesizedOutputDirectory(fixture: Fixture, jobId: string): Promise<void> {
  const output = join(jobDirectory(fixture, jobId), "outputs");
  await mkdir(output, { mode: 0o700 });
  await Promise.all([
    writeFile(join(output, "deterministic-result.json"), "{}\n"),
    writeFile(join(output, "observation.json"), "{}\n"),
    writeFile(join(output, "index.json"), "{}\n"),
  ]);
}

function cancellableCheckpointGate(
  shouldHold: (event: ReferenceVerificationDurableCheckpointEventV0) => boolean = () => true,
): {
  readonly hook: (event: ReferenceVerificationDurableCheckpointEventV0) => Promise<void>;
  readonly first: Promise<ReferenceVerificationDurableCheckpointEventV0>;
  release(): void;
} {
  let resolveFirst!: (event: ReferenceVerificationDurableCheckpointEventV0) => void;
  let resolveGate!: () => void;
  let held = false;
  const first = new Promise<ReferenceVerificationDurableCheckpointEventV0>((resolve) => {
    resolveFirst = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  return {
    first,
    hook: async (event) => {
      if (held || !shouldHold(event)) return;
      held = true;
      resolveFirst(event);
      await gate;
    },
    release: resolveGate,
  };
}

async function pauseAtFirstCheckpoint(
  fixture: Fixture,
): Promise<{
  readonly control: ReferenceVerificationJobControlV0;
  readonly checkpoint: ReferenceVerificationDurableCheckpointEventV0;
  readonly coordinator: ReferenceIntegrityVerificationCoordinatorV0;
}> {
  const gate = cancellableCheckpointGate();
  const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
    onDurableCheckpoint: gate.hook,
  }));
  const control = await coordinator.startFresh();
  const checkpoint = await gate.first;
  const cancelling = control.cancel();
  gate.release();
  const paused = await cancelling;
  expect(paused.phase).toBe("paused");
  expect(paused.progress.activeFileConfirmedBytes).toBe(checkpoint.confirmedOffsetBytes);
  return { control, checkpoint, coordinator };
}

describe("durable reference integrity verification", () => {
  it("rejects 501 admitted files at the bounded V0 guided-workflow limit", async () => {
    const fixture = await makeFixture(1);
    const files = Array.from(
      { length: REFERENCE_INTEGRITY_VERIFY_MAX_ADMITTED_FILES_V0 + 1 },
      (_, index) => ({
        relativePath: `file-${String(index).padStart(3, "0")}.bin`,
        sizeBytes: 0,
        sha256: "0".repeat(64),
      }),
    );
    expect(() => new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      subject: { ...fixture.subject, files },
    }))).toThrow(expect.objectContaining({ code: "REFERENCE_TOO_MANY_ADMITTED_FILES" }));
  });

  it("finishes an uninterrupted read-only verification with exact bound output", async () => {
    const fixture = await makeFixture(192 * 1024);
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const control = await coordinator.startFresh();
    const completed = await control.completion;

    expect(completed.phase).toBe("succeeded");
    expect(completed.progress).toMatchObject({
      totalFiles: 1,
      filesVerified: 1,
      totalBytes: fixture.sourceBytes.length,
      verifiedBytes: fixture.sourceBytes.length,
      sourcePayloadBytesStaged: 0,
      checkpointMayContainSourceFragments: true,
    });
    const output = await coordinator.verifyOutput(control.jobId);
    expect(output.result).toMatchObject({
      authority: "none",
      operation: "read_only_reference_integrity_verification",
      reconstructionPerformed: false,
      trainingPerformed: false,
      gpuUsed: false,
      externalProviderUsed: false,
      sourceFilesStaged: false,
      sourcePayloadBytesStaged: 0,
      checkpointMayContainSourceFragments: true,
      totalFiles: 1,
      totalBytes: fixture.sourceBytes.length,
    });
    expect(output.result.files).toEqual([{
      relativePath: "capture.bin",
      sizeBytes: fixture.sourceBytes.length,
      expectedSha256: sha256(fixture.sourceBytes),
      measuredSha256: sha256(fixture.sourceBytes),
      status: "exact_match",
    }]);
    expect(output.observation.note).toContain("not a reconstruction result");
    expect(output.index.artifacts.map((artifact) => artifact.name)).toEqual([
      "deterministic-result.json",
      "observation.json",
    ]);
  });

  it("isolates best-effort observer failures from verification authority", async () => {
    const fixture = await makeFixture(128 * 1024);
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      onDurableCheckpoint: () => {
        throw new Error("display observer failed");
      },
      onMeasuredProgress: () => {
        throw new Error("progress observer failed");
      },
    }));
    const control = await coordinator.startFresh();
    expect((await control.completion).phase).toBe("succeeded");
    await expect(coordinator.verifyOutput(control.jobId)).resolves.toBeDefined();
  });

  it("does not let a never-settling observer block cancellation", async () => {
    const fixture = await makeFixture(256 * 1024);
    let resolveObserved!: () => void;
    const observed = new Promise<void>((resolve) => {
      resolveObserved = resolve;
    });
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      onDurableCheckpoint: () => {
        resolveObserved();
        return new Promise<void>(() => undefined);
      },
    }));
    const control = await coordinator.startFresh();
    await observed;
    const startedAt = Date.now();
    const paused = await control.cancel();
    expect(paused.phase).toBe("paused");
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("cancels mid-file, then a new coordinator resumes without rereading the confirmed prefix", async () => {
    const fixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(fixture);
    expect(paused.checkpoint.confirmedOffsetBytes).toBe(64 * 1024);

    const resumedCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      resumePolicy: "strong_local_filesystem_attested",
    }));
    const recovered = await resumedCoordinator.recover(paused.control.jobId);
    expect(recovered.phase).toBe("paused");
    const resumed = await resumedCoordinator.resume(paused.control.jobId);
    const completed = await resumed.completion;

    expect(completed.phase).toBe("succeeded");
    expect(completed.attempt).toBe(2);
    expect(completed.progress.resumedFromBytesThisAttempt).toBe(64 * 1024);
    expect(completed.progress.measuredBytesReadThisAttempt).toBe(
      fixture.sourceBytes.length - 64 * 1024,
    );
    expect(completed.progress.minimumMeasuredBytesReadAcrossAttempts).toBe(fixture.sourceBytes.length);
    const output = await resumedCoordinator.verifyOutput(paused.control.jobId);
    expect(output.observation.resumedFromBytesInCompletedAttempt).toBe(64 * 1024);
    expect(output.observation.measuredBytesReadInCompletedAttempt).toBe(
      fixture.sourceBytes.length - 64 * 1024,
    );
  });

  it("restarts the full verification from byte zero unless strong local identity is explicitly attested", async () => {
    const fixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(fixture);
    const defaultCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const resumed = await defaultCoordinator.resume(paused.control.jobId);
    const completed = await resumed.completion;

    expect(completed.phase).toBe("succeeded");
    expect(completed.progress.resumedFromBytesThisAttempt).toBe(0);
    expect(completed.progress.measuredBytesReadThisAttempt).toBe(fixture.sourceBytes.length);
    expect(completed.progress.minimumMeasuredBytesReadAcrossAttempts).toBe(
      fixture.sourceBytes.length + 64 * 1024,
    );
  });

  it("re-reads completed files by default but reuses them only under explicit strong identity attestation", async () => {
    const fixture = await makeFixture(128 * 1024);
    const laterBytes = patternedBytes(256 * 1024);
    await writeFile(join(fixture.source, "later.bin"), laterBytes);
    const subject: ReferenceVerificationAdmittedSubjectV0 = {
      ...fixture.subject,
      files: [
        fixture.subject.files[0]!,
        {
          relativePath: "later.bin",
          sizeBytes: laterBytes.length,
          sha256: sha256(laterBytes),
        },
      ],
    };
    const pauseAfterFirstFile = async (): Promise<ReferenceVerificationJobControlV0> => {
      const gate = cancellableCheckpointGate((event) => event.fileIndex === 1);
      const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
        subject,
        onDurableCheckpoint: gate.hook,
      }));
      const control = await coordinator.startFresh();
      const checkpoint = await gate.first;
      expect(checkpoint.fileIndex).toBe(1);
      const cancelling = control.cancel();
      gate.release();
      const paused = await cancelling;
      expect(paused.completedFiles).toHaveLength(1);
      return control;
    };

    const defaultJob = await pauseAfterFirstFile();
    const defaultReadFiles = new Set<number>();
    const defaultCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      subject,
      onMeasuredProgress: (event) => {
        defaultReadFiles.add(event.fileIndex);
      },
    }));
    const defaultResume = await defaultCoordinator.resume(defaultJob.jobId);
    const defaultComplete = await defaultResume.completion;
    expect(defaultComplete.phase).toBe("succeeded");
    expect(defaultReadFiles).toEqual(new Set([0, 1]));
    expect(defaultComplete.progress.resumedFromBytesThisAttempt).toBe(0);
    expect(defaultComplete.progress.measuredBytesReadThisAttempt).toBe(
      fixture.sourceBytes.length + laterBytes.length,
    );

    const strongJob = await pauseAfterFirstFile();
    const strongReadFiles = new Set<number>();
    const strongCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      subject,
      resumePolicy: "strong_local_filesystem_attested",
      onMeasuredProgress: (event) => {
        strongReadFiles.add(event.fileIndex);
      },
    }));
    const strongResume = await strongCoordinator.resume(strongJob.jobId);
    const strongComplete = await strongResume.completion;
    expect(strongComplete.phase).toBe("succeeded");
    expect(strongReadFiles).toEqual(new Set([1]));
    expect(strongComplete.progress.resumedFromBytesThisAttempt).toBe(64 * 1024);
    expect(strongComplete.progress.measuredBytesReadThisAttempt).toBe(
      laterBytes.length - 64 * 1024,
    );
  });

  it("adopts an authenticated checkpoint tail left by a crash before its state snapshot", async () => {
    const fixture = await makeFixture();
    const gate = cancellableCheckpointGate((event) => event.confirmedOffsetBytes === 128 * 1024);
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      onDurableCheckpoint: gate.hook,
    }));
    const control = await coordinator.startFresh();
    const secondCheckpoint = await gate.first;
    const cancelling = control.cancel();
    gate.release();
    const paused = await cancelling;
    expect(paused.phase).toBe("paused");

    // Model a process crash after checkpoint 2 was promoted but before its state
    // pointer: retain the authenticated checkpoint tail and remove later states.
    const stateRoot = join(jobDirectory(fixture, control.jobId), "state");
    for (const name of await readdir(stateRoot)) {
      const sequence = Number(name.slice(0, 12));
      if (sequence >= secondCheckpoint.snapshot.sequence) {
        await unlink(join(stateRoot, name));
      }
    }

    const newCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      resumePolicy: "strong_local_filesystem_attested",
    }));
    const resumed = await newCoordinator.resume(control.jobId);
    const complete = await resumed.completion;
    expect(complete.phase).toBe("succeeded");
    expect(complete.progress.resumedFromBytesThisAttempt).toBe(128 * 1024);
    expect(complete.progress.measuredBytesReadThisAttempt).toBe(
      fixture.sourceBytes.length - 128 * 1024,
    );
    expect(complete.progress.minimumMeasuredBytesReadAcrossAttempts).toBe(
      fixture.sourceBytes.length,
    );
  });

  it("does not reuse or count an older-attempt checkpoint again after a retry is cancelled early", async () => {
    const fixture = await makeFixture();
    const firstPause = await pauseAtFirstCheckpoint(fixture);
    const checkpointRoot = join(
      jobDirectory(fixture, firstPause.control.jobId),
      "checkpoints",
    );
    const checkpointCountBeforeRetry = (await readdir(checkpointRoot)).length;

    const retryCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      checkpointIntervalBytes: fixture.sourceBytes.length,
    }));
    const retry = await retryCoordinator.resume(firstPause.control.jobId);
    const secondPause = await retry.cancel();
    expect(secondPause.phase).toBe("paused");
    expect(secondPause.attempt).toBe(2);
    expect(secondPause.completedFiles).toEqual([]);
    expect(secondPause.latestCheckpointEnvelopeSha256).toBeNull();
    expect(await readdir(checkpointRoot)).toHaveLength(checkpointCountBeforeRetry);

    const finalCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const finalResume = await finalCoordinator.resume(firstPause.control.jobId);
    const completed = await finalResume.completion;
    expect(completed.phase).toBe("succeeded");
    expect(completed.progress.resumedFromBytesThisAttempt).toBe(0);
    expect(completed.progress.minimumMeasuredBytesReadAcrossAttempts).toBe(
      secondPause.progress.minimumMeasuredBytesReadAcrossAttempts + fixture.sourceBytes.length,
    );
  });

  it("ignores a torn staged record that crashed before atomic publication", async () => {
    const fixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(fixture);
    await writeFile(
      join(jobDirectory(fixture, paused.control.jobId), ".pending-state-injected.json"),
      "{\"torn\":",
    );

    const recoveredCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const recovered = await recoveredCoordinator.recover(paused.control.jobId);
    expect(recovered.phase).toBe("paused");
    const resumed = await recoveredCoordinator.resume(paused.control.jobId);
    expect((await resumed.completion).phase).toBe("succeeded");
  });

  it("reports bytes actually read after the last durable checkpoint when cancelled", async () => {
    const fixture = await makeFixture();
    let releaseProgress!: () => void;
    let resolveProgress!: () => void;
    let held = false;
    const progressReached = new Promise<void>((resolve) => {
      resolveProgress = resolve;
    });
    const progressGate = new Promise<void>((resolve) => {
      releaseProgress = resolve;
    });
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      checkpointIntervalBytes: 256 * 1024,
      onMeasuredProgress: async (event) => {
        if (held || event.currentOffsetBytes !== 320 * 1024) return;
        held = true;
        resolveProgress();
        await progressGate;
      },
    }));
    const control = await coordinator.startFresh();
    await progressReached;
    const cancelling = control.cancel();
    releaseProgress();
    const paused = await cancelling;

    expect(paused.phase).toBe("paused");
    expect(paused.progress.activeFileConfirmedBytes).toBe(256 * 1024);
    expect(paused.progress.durablyConfirmedBytes).toBe(256 * 1024);
    expect(paused.progress.measuredBytesReadThisAttempt).toBe(320 * 1024);
    expect(paused.progress.minimumMeasuredBytesReadAcrossAttempts).toBe(320 * 1024);
  });

  it("produces identical deterministic result bytes after resume and a fresh run", async () => {
    const fixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(fixture);
    const resumedCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const resumed = await resumedCoordinator.resume(paused.control.jobId);
    expect((await resumed.completion).phase).toBe("succeeded");

    const freshCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const fresh = await freshCoordinator.startFresh();
    expect((await fresh.completion).phase).toBe("succeeded");

    const resumedBytes = await readFile(join(
      jobDirectory(fixture, paused.control.jobId),
      "outputs",
      "deterministic-result.json",
    ));
    const freshBytes = await readFile(join(
      jobDirectory(fixture, fresh.jobId),
      "outputs",
      "deterministic-result.json",
    ));
    expect(resumedBytes).toEqual(freshBytes);
  });

  it("fails closed when a private checkpoint or final output is corrupted", async () => {
    const checkpointFixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(checkpointFixture);
    const checkpointPath = join(
      jobDirectory(checkpointFixture, paused.control.jobId),
      "checkpoints",
      "000000000001.json",
    );
    await writeFile(checkpointPath, Buffer.concat([await readFile(checkpointPath), Buffer.from(" ")]));
    const checkpointReader = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(checkpointFixture));
    await expect(checkpointReader.recover(paused.control.jobId)).rejects.toMatchObject({
      code: "REFERENCE_EVIDENCE_NOT_CANONICAL",
    });

    const outputFixture = await makeFixture(128 * 1024);
    const outputWriter = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(outputFixture));
    const complete = await outputWriter.startFresh();
    expect((await complete.completion).phase).toBe("succeeded");
    const resultPath = join(
      jobDirectory(outputFixture, complete.jobId),
      "outputs",
      "deterministic-result.json",
    );
    await writeFile(resultPath, Buffer.concat([await readFile(resultPath), Buffer.from(" ")]));
    await expect(outputWriter.verifyOutput(complete.jobId)).rejects.toMatchObject({
      code: "REFERENCE_EVIDENCE_NOT_CANONICAL",
    });
  });

  it("rejects synthesized output for ready, paused, and failed authenticated states", async () => {
    const pausedFixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(pausedFixture);
    await writeSynthesizedOutputDirectory(pausedFixture, paused.control.jobId);
    const pausedReader = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(pausedFixture));
    await expect(pausedReader.verifyOutput(paused.control.jobId)).rejects.toMatchObject({
      code: "REFERENCE_JOB_NOT_VERIFIED_SUCCEEDED",
    });

    const pausedJob = jobDirectory(pausedFixture, paused.control.jobId);
    for (const name of await readdir(join(pausedJob, "state"))) {
      if (name !== "000000000001.json") await unlink(join(pausedJob, "state", name));
    }
    for (const name of await readdir(join(pausedJob, "checkpoints"))) {
      await unlink(join(pausedJob, "checkpoints", name));
    }
    await expect(pausedReader.verifyOutput(paused.control.jobId)).rejects.toMatchObject({
      code: "REFERENCE_JOB_NOT_VERIFIED_SUCCEEDED",
    });

    const failedFixture = await makeFixture(128 * 1024);
    const failedCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(failedFixture, {
      subject: {
        ...failedFixture.subject,
        files: [{ ...failedFixture.subject.files[0]!, sha256: "0".repeat(64) }],
      },
    }));
    const failedControl = await failedCoordinator.startFresh();
    expect((await failedControl.completion).phase).toBe("failed");
    await writeSynthesizedOutputDirectory(failedFixture, failedControl.jobId);
    await expect(failedCoordinator.verifyOutput(failedControl.jobId)).rejects.toMatchObject({
      code: "REFERENCE_JOB_NOT_VERIFIED_SUCCEEDED",
    });
  });

  it("quarantines tampered orphan output and creates a newly authenticated output set", async () => {
    const fixture = await makeFixture(192 * 1024);
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const control = await coordinator.startFresh();
    const succeeded = await control.completion;
    expect(succeeded.phase).toBe("succeeded");
    const stateRoot = join(jobDirectory(fixture, control.jobId), "state");
    await unlink(join(stateRoot, `${String(succeeded.sequence).padStart(12, "0")}.json`));
    const originalOutput = join(jobDirectory(fixture, control.jobId), "outputs");
    await writeFile(join(originalOutput, "observation.json"), "{}\n");
    await writeFile(join(originalOutput, "index.json"), "{}\n");

    const recoveryCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const recovery = await recoveryCoordinator.resume(control.jobId);
    expect(recovery.attempt).toBe(succeeded.attempt + 1);
    const recovered = await recovery.completion;
    expect(recovered.phase).toBe("succeeded");
    expect(recovered.attempt).toBe(succeeded.attempt + 1);
    expect(recovered.progress.resumedFromBytesThisAttempt).toBe(0);
    expect(recovered.progress.measuredBytesReadThisAttempt).toBe(fixture.sourceBytes.length);
    const output = await recoveryCoordinator.verifyOutput(control.jobId);
    expect(output.observation.completedAttempt).toBe(recovered.attempt);
    expect(recovered.outputIndexSha256).toBe(output.index.indexSha256);
    const orphanNames = (await readdir(jobDirectory(fixture, control.jobId)))
      .filter((name) => name.startsWith("outputs.orphan-"));
    expect(orphanNames).toHaveLength(1);
    expect(await readFile(
      join(jobDirectory(fixture, control.jobId), orphanNames[0]!, "observation.json"),
      "utf8",
    )).toBe("{}\n");
    expect(await readFile(
      join(jobDirectory(fixture, control.jobId), orphanNames[0]!, "index.json"),
      "utf8",
    )).toBe("{}\n");
  });

  it("requires the same caller-held authentication key to trust durable resume records", async () => {
    const fixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(fixture);
    const wrongKeyCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      recordAuthenticationKey: Buffer.alloc(32, 0x6b),
    }));
    await expect(wrongKeyCoordinator.recover(paused.control.jobId)).rejects.toMatchObject({
      code: "REFERENCE_RECORD_AUTHENTICATION_FAILED",
    });
  });

  it("rejects source mutation and linked source entries without a success report", async () => {
    const mutationFixture = await makeFixture();
    const gate = cancellableCheckpointGate();
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(mutationFixture, {
      onDurableCheckpoint: gate.hook,
    }));
    const control = await coordinator.startFresh();
    await gate.first;
    const changed = Buffer.from(mutationFixture.sourceBytes);
    changed[0] = changed[0] === 0 ? 1 : 0;
    await writeFile(mutationFixture.sourceFile, changed);
    gate.release();
    const failed = await control.completion;
    expect(failed.phase).toBe("failed");
    expect(failed.failure?.code).toMatch(/(?:HASH|REFERENCE)_SOURCE_/u);
    await expect(stat(join(jobDirectory(mutationFixture, control.jobId), "outputs"))).rejects.toMatchObject({ code: "ENOENT" });

    const linkFixture = await makeFixture(64 * 1024);
    const outside = join(linkFixture.base, "outside");
    await mkdir(outside);
    const outsideFile = join(outside, "linked.bin");
    await writeFile(outsideFile, patternedBytes(64 * 1024));
    const linkedDirectory = join(linkFixture.source, "linked");
    await symlink(outside, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
    const linkedSubject: ReferenceVerificationAdmittedSubjectV0 = {
      ...linkFixture.subject,
      files: [{
        relativePath: "linked/linked.bin",
        sizeBytes: 64 * 1024,
        sha256: sha256(await readFile(outsideFile)),
      }],
    };
    const linkedCoordinator = new ReferenceIntegrityVerificationCoordinatorV0({
      ...optionsFor(linkFixture),
      subject: linkedSubject,
    });
    const linkedControl = await linkedCoordinator.startFresh();
    const linkedFailure = await linkedControl.completion;
    expect(linkedFailure.phase).toBe("failed");
    expect(linkedFailure.failure?.code).toBe("REFERENCE_SOURCE_SYMLINK");
  });

  it("rechecks every completed file immediately before success", async () => {
    const fixture = await makeFixture(128 * 1024);
    const laterBytes = patternedBytes(192 * 1024);
    const laterPath = join(fixture.source, "later.bin");
    await writeFile(laterPath, laterBytes);
    const subject: ReferenceVerificationAdmittedSubjectV0 = {
      ...fixture.subject,
      files: [
        fixture.subject.files[0]!,
        {
          relativePath: "later.bin",
          sizeBytes: laterBytes.length,
          sha256: sha256(laterBytes),
        },
      ],
    };
    const gate = cancellableCheckpointGate((event) => event.fileIndex === 1);
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0({
      ...optionsFor(fixture),
      subject,
      onDurableCheckpoint: gate.hook,
    });
    const control = await coordinator.startFresh();
    await gate.first;
    const changedEarlierFile = Buffer.from(fixture.sourceBytes);
    changedEarlierFile[7] = changedEarlierFile[7] === 0 ? 1 : 0;
    await writeFile(fixture.sourceFile, changedEarlierFile);
    gate.release();
    const failed = await control.completion;

    expect(failed.phase).toBe("failed");
    expect(failed.failure?.code).toBe("REFERENCE_COMPLETED_SOURCE_CHANGED");
    await expect(stat(join(jobDirectory(fixture, control.jobId), "outputs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a second writer while the first coordinator owns the job", async () => {
    const fixture = await makeFixture();
    const gate = cancellableCheckpointGate();
    const firstCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture, {
      onDurableCheckpoint: gate.hook,
    }));
    const first = await firstCoordinator.startFresh();
    await gate.first;

    const secondCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    await expect(secondCoordinator.resume(first.jobId)).rejects.toMatchObject({
      code: "REFERENCE_JOB_ALREADY_RUNNING",
    });
    const cancelling = first.cancel();
    gate.release();
    expect((await cancelling).phase).toBe("paused");
  });

  it("recovers a canonical authenticated takeover claim left by a dead coordinator", async () => {
    const fixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(fixture);
    await writeAuthenticatedStaleWriterLock(fixture, paused.control.jobId);
    await writeAuthenticatedDeadTakeoverClaim(fixture, paused.control.jobId);

    const recoveryCoordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const recovery = await recoveryCoordinator.resume(paused.control.jobId);
    expect((await recovery.completion).phase).toBe("succeeded");

    const directoryNames = await readdir(jobDirectory(fixture, paused.control.jobId));
    expect(directoryNames).toContainEqual(
      expect.stringMatching(/^writer-takeover-claim-stale-[0-9a-f-]+\.json$/u),
    );
    await expect(stat(
      join(jobDirectory(fixture, paused.control.jobId), "writer.takeover.claim"),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows exactly one contender to take over an authenticated stale writer lock", async () => {
    const fixture = await makeFixture();
    const paused = await pauseAtFirstCheckpoint(fixture);
    await writeAuthenticatedStaleWriterLock(fixture, paused.control.jobId);
    const first = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const second = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));

    const contenders = await Promise.allSettled([
      first.resume(paused.control.jobId),
      second.resume(paused.control.jobId),
    ]);
    const winners = contenders.filter(
      (result): result is PromiseFulfilledResult<ReferenceVerificationJobControlV0> =>
        result.status === "fulfilled",
    );
    const losers = contenders.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((await winners[0]!.value.completion).phase).toBe("succeeded");
    expect(losers[0]!.reason).toMatchObject({
      code: expect.stringMatching(
        /REFERENCE_(?:LOCK_TAKEOVER_IN_PROGRESS|JOB_ALREADY_RUNNING|JOB_ALREADY_SUCCEEDED)/u,
      ),
    });
  });

  it("records zero staged source payload, no source-file replica, and no absolute source path", async () => {
    const fixture = await makeFixture(256 * 1024);
    const coordinator = new ReferenceIntegrityVerificationCoordinatorV0(optionsFor(fixture));
    const control = await coordinator.startFresh();
    const complete = await control.completion;
    expect(complete.phase).toBe("succeeded");
    const output = await coordinator.verifyOutput(control.jobId);
    expect(output.result.sourcePayloadBytesStaged).toBe(0);
    expect(output.result.checkpointMayContainSourceFragments).toBe(true);
    expect(output.observation.sourcePayloadBytesStaged).toBe(0);
    expect(output.observation.checkpointMayContainSourceFragments).toBe(true);

    const files = await collectFiles(jobDirectory(fixture, control.jobId));
    const fullSourceCopies: string[] = [];
    for (const path of files) {
      const bytes = await readFile(path);
      if (sha256(bytes) === sha256(fixture.sourceBytes)) fullSourceCopies.push(path);
      if (path.endsWith(".json")) {
        expect(bytes.toString("utf8")).not.toContain(fixture.source);
      }
    }
    expect(fullSourceCopies).toEqual([]);
  });
});
