import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FoundryGuidedAdmissionDraft, FoundryUniversalIntakeReceipt } from "@omnitwin/reconstruction-foundry";
import {
  buildReferenceVerificationAdmittedSubjectV0,
  loadOrCreateReferenceVerificationRecordAuthenticationV0,
  prepareDefaultReferenceVerificationPrivateStateRootV0,
  type ReferenceVerificationSourceIdentityV0,
} from "./reference-verification-bridge.js";
import {
  ReferenceIntegrityVerificationCoordinatorV0,
  type ReferenceVerificationJobControlV0,
  type ReferenceVerificationJobSnapshotV0,
  type ReferenceVerificationMeasuredProgressEventV0,
} from "./reference-verification-job.js";

const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/u;
const JOB_ID_PATTERN = /^riv0-[a-f0-9]{32}$/u;

export type LocalReferenceVerificationPhaseV0 =
  | "checking"
  | "stopped_for_now"
  | "finished"
  | "could_not_finish";

export type LocalReferenceVerificationOutcomeV0 =
  | "pending"
  | "stopped_by_person"
  | "all_approved_files_matched"
  | "could_not_verify";

/**
 * Deliberately small, path-free DTO. Keep this as an explicit allowlist: core
 * snapshots contain relative paths, file identities, checkpoint hashes, and
 * authentication material that must never cross the local HTTP boundary.
 */
export interface LocalReferenceVerificationPublicV0 {
  readonly jobId: string;
  readonly revision: number;
  /** Opaque run generation used to reject delayed controls from an older attempt. */
  readonly run: number;
  readonly phase: LocalReferenceVerificationPhaseV0;
  readonly outcome: LocalReferenceVerificationOutcomeV0;
  readonly totalFiles: number;
  readonly totalBytes: number;
  readonly filesChecked: number;
  readonly bytesChecked: number;
  readonly reportReady: boolean;
  readonly localOnly: true;
  readonly cost: {
    readonly currency: "GBP";
    readonly amount: "0.00";
  };
  readonly uploaded: false;
  readonly reconstructionPerformed: false;
  readonly resumeBehavior: "restarts_from_beginning";
  readonly message: string;
}

export interface CreateLocalReferenceVerificationControllerOptionsV0 {
  readonly source: string;
  readonly trustedStartupSourceIdentity: ReferenceVerificationSourceIdentityV0;
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly admissionDraft: FoundryGuidedAdmissionDraft;
  /** Trusted server configuration only. It is never accepted over HTTP. */
  readonly privateStateRoot?: string;
  /** @internal Deterministic, focused-test hooks. Production callers omit this. */
  readonly testHooks?: {
    readonly checkpointIntervalBytes?: number;
    readonly readBufferBytes?: number;
    readonly onMeasuredProgress?: (
      event: ReferenceVerificationMeasuredProgressEventV0,
    ) => void | PromiseLike<void>;
    readonly beforeShutdownConfirmation?: () => void | PromiseLike<void>;
  };
}

export class LocalReferenceVerificationErrorV0 extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "LocalReferenceVerificationErrorV0";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new LocalReferenceVerificationErrorV0(code, message);
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const parentComparable = comparablePath(parent);
  const candidateComparable = comparablePath(candidate);
  const rel = relative(parentComparable, candidateComparable);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertStateRootDisjointFromSource(source: string, stateRoot: string): void {
  if (pathIsWithin(source, stateRoot) || pathIsWithin(stateRoot, source)) {
    fail(
      "LOCAL_REFERENCE_STATE_OVERLAPS_SOURCE",
      "The private verification records cannot be stored inside the selected source or contain it.",
    );
  }
}

async function existingDirectoryOrNull(candidate: string | undefined): Promise<string | null> {
  if (candidate === undefined || candidate.trim().length === 0 || !isAbsolute(candidate)) return null;
  try {
    const metadata = await lstat(candidate);
    return metadata.isDirectory() && !metadata.isSymbolicLink() ? resolve(candidate) : null;
  } catch {
    return null;
  }
}

async function selectExistingTrustedProfileBase(): Promise<string> {
  if (process.platform === "win32") {
    return (await existingDirectoryOrNull(process.env.LOCALAPPDATA)) ?? resolve(homedir());
  }
  if (process.platform === "darwin") {
    return (await existingDirectoryOrNull(join(homedir(), "Library", "Application Support")))
      ?? resolve(homedir());
  }
  return (await existingDirectoryOrNull(process.env.XDG_STATE_HOME)) ?? resolve(homedir());
}

async function prepareStateRoot(
  configuredRoot: string | undefined,
  canonicalSourcePath: string,
): Promise<string> {
  if (configuredRoot !== undefined && !isAbsolute(configuredRoot)) {
    return fail(
      "LOCAL_REFERENCE_STATE_ROOT_NOT_ABSOLUTE",
      "The configured private verification state folder must use an absolute path.",
    );
  }
  if (configuredRoot !== undefined) {
    assertStateRootDisjointFromSource(canonicalSourcePath, configuredRoot);
    return configuredRoot;
  }
  const trustedProfileBase = await selectExistingTrustedProfileBase();
  return prepareDefaultReferenceVerificationPrivateStateRootV0({
    source: canonicalSourcePath,
    trustedProfileBase,
  });
}

function validateRequestId(requestId: string): void {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    fail("LOCAL_REFERENCE_REQUEST_ID_INVALID", "The verification request ID is invalid.");
  }
}

function validateJobReference(jobId: string, revision: number, run: number): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    fail("LOCAL_REFERENCE_JOB_ID_INVALID", "The verification job reference is invalid.");
  }
  if (!Number.isSafeInteger(revision) || revision < 1) {
    fail("LOCAL_REFERENCE_REVISION_INVALID", "The verification revision is invalid.");
  }
  if (!Number.isSafeInteger(run) || run < 1) {
    fail("LOCAL_REFERENCE_RUN_INVALID", "The verification run reference is invalid.");
  }
}

function phaseFor(snapshot: ReferenceVerificationJobSnapshotV0): LocalReferenceVerificationPhaseV0 {
  if (snapshot.phase === "paused") return "stopped_for_now";
  if (snapshot.phase === "succeeded") return "finished";
  if (snapshot.phase === "failed") return "could_not_finish";
  return "checking";
}

function outcomeFor(snapshot: ReferenceVerificationJobSnapshotV0): LocalReferenceVerificationOutcomeV0 {
  if (snapshot.phase === "paused") return "stopped_by_person";
  if (snapshot.phase === "succeeded") return "all_approved_files_matched";
  if (snapshot.phase === "failed") return "could_not_verify";
  return "pending";
}

function messageFor(snapshot: ReferenceVerificationJobSnapshotV0): string {
  if (snapshot.phase === "paused") {
    return "The check stopped safely. Continue checking to read every approved file again from the beginning.";
  }
  if (snapshot.phase === "succeeded") {
    return "All approved files matched during this check. This covers a span of time, not one instant; it does not prove completeness, measurement accuracy, safety, rights, or origin.";
  }
  if (snapshot.phase === "failed") {
    return "The approved files could not be verified. Check whether the source changed, then build a fresh check.";
  }
  return "Reading each approved file and checking its size and fingerprint. This does not improve or reconstruct the room.";
}

function toPublicState(
  snapshot: ReferenceVerificationJobSnapshotV0,
  successVerified: boolean,
  activeRun: number | null,
): LocalReferenceVerificationPublicV0 {
  const preparing = activeRun !== null && activeRun > snapshot.attempt;
  if (!preparing && snapshot.phase === "succeeded" && !successVerified) {
    return fail(
      "LOCAL_REFERENCE_SUCCESS_NOT_VERIFIED",
      "The final verification report has not passed its server-side integrity check.",
    );
  }
  return Object.freeze({
    jobId: snapshot.jobId,
    revision: snapshot.sequence,
    run: preparing ? activeRun : snapshot.attempt,
    phase: preparing ? "checking" : phaseFor(snapshot),
    outcome: preparing ? "pending" : outcomeFor(snapshot),
    totalFiles: snapshot.progress.totalFiles,
    totalBytes: snapshot.progress.totalBytes,
    filesChecked: preparing ? 0 : snapshot.progress.filesVerified,
    bytesChecked: preparing ? 0 : snapshot.progress.verifiedBytes,
    reportReady: !preparing && snapshot.phase === "succeeded" && successVerified,
    localOnly: true,
    cost: Object.freeze({ currency: "GBP", amount: "0.00" }),
    uploaded: false,
    reconstructionPerformed: false,
    resumeBehavior: "restarts_from_beginning",
    message: preparing
      ? "Preparing the new local check. No file has been approved, uploaded, improved, or reconstructed."
      : messageFor(snapshot),
  });
}

interface RememberedRequestV0 {
  readonly operation: "start" | "resume";
  readonly jobId: string;
}

export class LocalReferenceVerificationControllerV0 {
  readonly #coordinator: ReferenceIntegrityVerificationCoordinatorV0;
  readonly #admissionResultSha256: string;
  readonly #beforeShutdownConfirmation: (() => void | PromiseLike<void>) | undefined;
  readonly #requests = new Map<string, RememberedRequestV0>();
  #transition: Promise<void> = Promise.resolve();
  #currentJobId: string | null = null;
  #currentControl: ReferenceVerificationJobControlV0 | null = null;
  #currentRun = 0;
  #successVerified = false;
  #closed = false;

  private constructor(
    coordinator: ReferenceIntegrityVerificationCoordinatorV0,
    admissionResultSha256: string,
    beforeShutdownConfirmation: (() => void | PromiseLike<void>) | undefined,
  ) {
    this.#coordinator = coordinator;
    this.#admissionResultSha256 = admissionResultSha256;
    this.#beforeShutdownConfirmation = beforeShutdownConfirmation;
  }

  public static async create(
    options: CreateLocalReferenceVerificationControllerOptionsV0,
  ): Promise<LocalReferenceVerificationControllerV0> {
    const subject = await buildReferenceVerificationAdmittedSubjectV0({
      source: options.source,
      trustedStartupSourceIdentity: options.trustedStartupSourceIdentity,
      receipt: options.receipt,
      admissionDraft: options.admissionDraft,
    });
    const privateStateRoot = await prepareStateRoot(
      options.privateStateRoot,
      subject.canonicalSourcePath,
    );
    const authentication = await loadOrCreateReferenceVerificationRecordAuthenticationV0({
      privateStateRoot,
      source: options.source,
    });
    const keyBytes = authentication.copyKeyBytes();
    try {
      const coordinator = new ReferenceIntegrityVerificationCoordinatorV0({
        evidenceRoot: privateStateRoot,
        subject,
        recordAuthenticationKey: keyBytes,
        resumePolicy: "restart_full_verification",
        ...(options.testHooks?.checkpointIntervalBytes === undefined
          ? {}
          : { checkpointIntervalBytes: options.testHooks.checkpointIntervalBytes }),
        ...(options.testHooks?.readBufferBytes === undefined
          ? {}
          : { readBufferBytes: options.testHooks.readBufferBytes }),
        ...(options.testHooks?.onMeasuredProgress === undefined
          ? {}
          : { onMeasuredProgress: options.testHooks.onMeasuredProgress }),
      });
      return new LocalReferenceVerificationControllerV0(
        coordinator,
        options.admissionDraft.result.resultSha256,
        options.testHooks?.beforeShutdownConfirmation,
      );
    } finally {
      keyBytes.fill(0);
    }
  }

  public get admissionResultSha256(): string {
    return this.#admissionResultSha256;
  }

  public isActive(): boolean {
    return this.#currentControl !== null;
  }

  public async canDetachForNewAdmission(): Promise<boolean> {
    return this.#serialized(async () => {
      if (this.#currentControl !== null) return false;
      if (this.#currentJobId === null) return true;
      const snapshot = await this.#inspectCurrent();
      return snapshot.phase === "paused" || snapshot.phase === "succeeded" || snapshot.phase === "failed";
    });
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#transition;
    let release: (() => void) | undefined;
    this.#transition = new Promise<void>((resolveTransition) => {
      release = resolveTransition;
    });
    await previous;
    try {
      if (this.#closed) return fail("LOCAL_REFERENCE_CONTROLLER_CLOSED", "This verification session is closed.");
      return await operation();
    } finally {
      release?.();
    }
  }

  #rememberRequest(
    requestId: string,
    operation: RememberedRequestV0["operation"],
    jobId: string,
  ): void {
    this.#requests.set(requestId, { operation, jobId });
    if (this.#requests.size > 64) {
      const oldest = this.#requests.keys().next().value;
      if (oldest !== undefined) this.#requests.delete(oldest);
    }
  }

  async #verifiedPublic(snapshot: ReferenceVerificationJobSnapshotV0): Promise<LocalReferenceVerificationPublicV0> {
    if (snapshot.phase === "succeeded") {
      await this.#coordinator.verifyOutput(snapshot.jobId);
      this.#successVerified = true;
    }
    const activeRun = this.#currentJobId === snapshot.jobId && this.#currentRun > snapshot.attempt
      ? this.#currentRun
      : null;
    return toPublicState(snapshot, this.#successVerified, activeRun);
  }

  #attachControl(control: ReferenceVerificationJobControlV0): void {
    this.#currentControl = control;
    void control.completion.then(() => {
      // The authenticated coordinator inspection remains authoritative. This
      // callback only releases the in-process control after it settles.
      if (this.#currentControl === control) this.#currentControl = null;
    }).catch(() => {
      if (this.#currentControl === control) this.#currentControl = null;
    });
  }

  public async start(
    admissionResultSha256: string,
    requestId: string,
  ): Promise<LocalReferenceVerificationPublicV0> {
    return this.#serialized(async () => {
      validateRequestId(requestId);
      if (admissionResultSha256 !== this.#admissionResultSha256) {
        return fail("LOCAL_REFERENCE_ADMISSION_STALE", "Build the verification from the current review draft.");
      }
      const remembered = this.#requests.get(requestId);
      if (remembered !== undefined) {
        if (remembered.operation !== "start" || remembered.jobId !== this.#currentJobId) {
          return fail("LOCAL_REFERENCE_REQUEST_REUSED", "That verification request is no longer current.");
        }
        return this.#statusCurrent();
      }
      if (this.#currentControl !== null) {
        return fail("LOCAL_REFERENCE_ALREADY_RUNNING", "The approved-file check is already running.");
      }
      if (this.#currentJobId !== null) {
        const latest = await this.#inspectCurrent();
        if (latest.phase === "ready" || latest.phase === "running") {
          return fail("LOCAL_REFERENCE_RUN_INTERRUPTED", "The previous check is not active in this local session.");
        }
        if (latest.phase === "paused") {
          return fail("LOCAL_REFERENCE_RESUME_REQUIRED", "Continue the stopped check or build a new review first.");
        }
      }
      const control = await this.#coordinator.startFresh();
      this.#currentJobId = control.jobId;
      this.#currentRun = control.attempt;
      this.#successVerified = false;
      this.#rememberRequest(requestId, "start", control.jobId);
      this.#attachControl(control);
      return this.#statusCurrent();
    });
  }

  async #inspectCurrent(): Promise<ReferenceVerificationJobSnapshotV0> {
    if (this.#currentJobId === null) {
      return fail("LOCAL_REFERENCE_JOB_MISSING", "Start the approved-file check first.");
    }
    const snapshot = await this.#coordinator.inspect(this.#currentJobId);
    return snapshot;
  }

  async #statusCurrent(): Promise<LocalReferenceVerificationPublicV0> {
    const snapshot = await this.#inspectCurrent();
    return this.#verifiedPublic(snapshot);
  }

  #assertCurrentJobId(jobId: string, revision: number, run: number): void {
    validateJobReference(jobId, revision, run);
    if (jobId !== this.#currentJobId) {
      fail("LOCAL_REFERENCE_JOB_STALE", "That approved-file check is no longer current.");
    }
  }

  #assertCurrentSnapshotReference(
    snapshot: ReferenceVerificationJobSnapshotV0,
    revision: number,
    run: number,
  ): void {
    if (revision > snapshot.sequence) {
      fail("LOCAL_REFERENCE_REVISION_AHEAD", "That approved-file check revision is invalid.");
    }
    const expectedRun = this.#currentJobId === snapshot.jobId
      ? this.#currentRun
      : snapshot.attempt;
    if (run !== expectedRun) {
      fail("LOCAL_REFERENCE_RUN_STALE", "That control belongs to an older run of this approved-file check.");
    }
  }

  public async status(jobId: string, revision: number, run: number): Promise<LocalReferenceVerificationPublicV0> {
    return this.#serialized(async () => {
      this.#assertCurrentJobId(jobId, revision, run);
      const snapshot = await this.#inspectCurrent();
      this.#assertCurrentSnapshotReference(snapshot, revision, run);
      return this.#verifiedPublic(snapshot);
    });
  }

  /** Server-selected current job only; never discovers a browser-supplied ID. */
  public async current(): Promise<LocalReferenceVerificationPublicV0 | null> {
    return this.#serialized(async () => {
      if (this.#currentJobId === null) return null;
      return this.#statusCurrent();
    });
  }

  public async cancel(jobId: string, revision: number, run: number): Promise<LocalReferenceVerificationPublicV0> {
    return this.#serialized(async () => {
      this.#assertCurrentJobId(jobId, revision, run);
      const before = await this.#inspectCurrent();
      this.#assertCurrentSnapshotReference(before, revision, run);
      if (before.phase === "paused" || before.phase === "failed" || before.phase === "succeeded") {
        return this.#verifiedPublic(before);
      }
      const control = this.#currentControl;
      if (control === null || control.jobId !== jobId || control.attempt !== run) {
        return fail("LOCAL_REFERENCE_RUN_INTERRUPTED", "The check is not active in this local session.");
      }
      let snapshot: ReferenceVerificationJobSnapshotV0;
      try {
        snapshot = await control.cancel();
      } catch {
        // The read may have won the cancel race. Inspect the authenticated state
        // and report the real terminal outcome instead of claiming it stopped.
        snapshot = await this.#coordinator.inspect(jobId);
      }
      return this.#verifiedPublic(snapshot);
    });
  }

  public async resume(
    jobId: string,
    revision: number,
    run: number,
    admissionResultSha256: string,
    requestId: string,
  ): Promise<LocalReferenceVerificationPublicV0> {
    return this.#serialized(async () => {
      validateRequestId(requestId);
      this.#assertCurrentJobId(jobId, revision, run);
      if (admissionResultSha256 !== this.#admissionResultSha256) {
        return fail("LOCAL_REFERENCE_ADMISSION_STALE", "Build the verification from the current review draft.");
      }
      const remembered = this.#requests.get(requestId);
      if (remembered !== undefined) {
        if (remembered.operation !== "resume" || remembered.jobId !== jobId) {
          return fail("LOCAL_REFERENCE_REQUEST_REUSED", "That verification request is no longer current.");
        }
        return this.#statusCurrent();
      }
      const before = await this.#inspectCurrent();
      this.#assertCurrentSnapshotReference(before, revision, run);
      if (this.#currentControl !== null) {
        return fail("LOCAL_REFERENCE_ALREADY_RUNNING", "The approved-file check is already running.");
      }
      if (before.phase === "ready" || before.phase === "running") {
        return fail("LOCAL_REFERENCE_ALREADY_RUNNING", "The approved-file check is already running.");
      }
      if (before.phase === "succeeded") return this.#verifiedPublic(before);
      if (before.phase === "failed") {
        return fail("LOCAL_REFERENCE_FRESH_REQUIRED", "This check failed. Build a fresh check after correcting the source.");
      }
      const control = await this.#coordinator.resume(jobId);
      this.#currentRun = control.attempt;
      this.#successVerified = false;
      this.#rememberRequest(requestId, "resume", jobId);
      this.#attachControl(control);
      return this.#statusCurrent();
    });
  }

  public async report(jobId: string, revision: number, run: number): Promise<LocalReferenceVerificationPublicV0> {
    return this.#serialized(async () => {
      this.#assertCurrentJobId(jobId, revision, run);
      const snapshot = await this.#inspectCurrent();
      this.#assertCurrentSnapshotReference(snapshot, revision, run);
      if (snapshot.phase !== "succeeded") {
        return fail("LOCAL_REFERENCE_REPORT_NOT_READY", "The approved-file check must finish before its report is ready.");
      }
      return this.#verifiedPublic(snapshot);
    });
  }

  public async shutdown(): Promise<void> {
    const previous = this.#transition;
    let release: (() => void) | undefined;
    this.#transition = new Promise<void>((resolveTransition) => {
      release = resolveTransition;
    });
    await previous;
    try {
      if (this.#closed) return;
      const control = this.#currentControl;
      if (control !== null) {
        try {
          await control.cancel();
        } catch {
          try {
            await control.completion;
          } catch {
            // Authentication inspection below is the final authority. A
            // rejected observer/control promise is never treated as proof.
          }
        }
      }
      if (this.#currentJobId !== null) {
        await this.#beforeShutdownConfirmation?.();
        const confirmed = await this.#coordinator.inspect(this.#currentJobId);
        if (
          confirmed.phase !== "paused" &&
          confirmed.phase !== "failed" &&
          confirmed.phase !== "succeeded"
        ) {
          return fail(
            "LOCAL_REFERENCE_SHUTDOWN_UNCONFIRMED",
            "The approved-file check did not reach a confirmed stopped or finished state.",
          );
        }
        if (confirmed.phase === "succeeded") {
          await this.#coordinator.verifyOutput(this.#currentJobId);
        }
      }
      this.#closed = true;
      this.#currentControl = null;
      this.#currentJobId = null;
      this.#currentRun = 0;
      this.#requests.clear();
    } finally {
      release?.();
    }
  }
}

export const LOCAL_REFERENCE_VERIFICATION_PRIVATE_RECORD_NOTICE_V0 =
  "No full capture file is staged or uploaded. A small private resume record is saved in Foundry's private state area on this computer and may contain tiny pieces of source data.";
