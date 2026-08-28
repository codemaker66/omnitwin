import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN,
  GrandHallT554NativeReviewJournalError,
  __testOnlyCreateGrandHallT554NativeReviewJournal,
  __testOnlyOpenGrandHallT554NativeReviewJournal,
  createGrandHallT554NativeReviewJournal,
  openGrandHallT554NativeReviewJournal,
  type GrandHallT554NativeReviewJournal,
  type GrandHallT554NativeReviewJournalScope,
  type __GrandHallT554NativeReviewJournalTestSeams,
} from "../grand-hall-t554-native-review-journal.js";

const roots: string[] = [];
const activeChildren = new Set<ChildProcess>();
const FIXED_TIME = "2026-08-26T12:34:56.789Z";
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const JOURNAL_SOURCE_URL = pathToFileURL(join(
  process.cwd(),
  "src",
  "grand-hall-t554-native-review-journal.ts",
)).href;
let childScriptSequence = 0;

function sha256(fill: string): `sha256:${string}` {
  return `sha256:${fill.repeat(64).slice(0, 64)}`;
}

function scope(
  overrides: Partial<GrandHallT554NativeReviewJournalScope> = {},
): GrandHallT554NativeReviewJournalScope {
  return {
    sessionNonceSha256: sha256("1"),
    sourceEpochSha256: sha256("2"),
    subjectSha256: sha256("3"),
    kind: "source",
    implementationSha256: sha256("4"),
    ...overrides,
  };
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function semanticSha256(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function rawSha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function eventFileName(sequence: number, digest: string): string {
  return `${String(sequence).padStart(16, "0")}-${digest.replace(":", "-")}.json`;
}

interface Harness {
  readonly root: string;
  readonly workspace: string;
  readonly scope: GrandHallT554NativeReviewJournalScope;
  readonly journal: GrandHallT554NativeReviewJournal;
}

async function harness(
  seams: __GrandHallT554NativeReviewJournalTestSeams = { nowUtc: () => FIXED_TIME },
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "t554-native-journal-"));
  roots.push(root);
  const workspace = join(root, "journal");
  await mkdir(workspace);
  const journalScope = scope();
  const journal = await __testOnlyCreateGrandHallT554NativeReviewJournal(
    { workspaceRoot: workspace, scope: journalScope },
    seams,
  );
  return { root, workspace, scope: journalScope, journal };
}

async function eventNames(workspace: string): Promise<readonly string[]> {
  return (await readdir(join(workspace, "events"))).sort();
}

async function onlyEventPath(workspace: string): Promise<string> {
  const names = await eventNames(workspace);
  expect(names).toHaveLength(1);
  const name = names[0];
  if (name === undefined) throw new Error("Expected one journal event.");
  return join(workspace, "events", name);
}

async function appendOne(journal: GrandHallT554NativeReviewJournal): Promise<void> {
  await journal.append({ expectedRevision: 0, eventType: "coverage.sample",
    payload: { renderGeneration: 7, paintedTileCount: 3 } });
}

interface ChildCompletion {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

function journalChildSource(): string {
  return `
import { access, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  GrandHallT554NativeReviewJournalError,
  __testOnlyOpenGrandHallT554NativeReviewJournal,
} from ${JSON.stringify(JOURNAL_SOURCE_URL)};

const [workspace, scopeJson, signalPath, controlPath, resultPath, phase, writer] =
  process.argv.slice(2);
if (!workspace || !scopeJson || !signalPath || !controlPath || !resultPath || !phase || !writer) {
  throw new Error("Child journal test arguments are incomplete.");
}
const scope = JSON.parse(scopeJson);
let signalled = false;
const waitForControl = async (path) => {
  for (;;) {
    try {
      await access(path);
      return;
    } catch {
      await delay(10);
    }
  }
};
const stopHere = async () => {
  if (signalled) return;
  signalled = true;
  await writeFile(signalPath, "ready", { flag: "wx" });
  if (phase === "race" || phase === "quarantine-race") {
    await waitForControl(controlPath);
    return;
  }
  await new Promise(() => undefined);
};
const stopAfterPendingWrite = async () => {
  await writeFile(signalPath + ".pending", "ready", { flag: "wx" });
  await waitForControl(controlPath + ".claim");
};
const stopWinnerAfterClaim = async () => {
  await writeFile(controlPath + ".winner-ready", writer, { flag: "wx" });
  await waitForControl(controlPath + ".winner-continue");
};
const stopLoserAfterClaimConflict = async () => {
  await writeFile(controlPath + ".loser-ready", writer, { flag: "wx" });
  await waitForControl(controlPath + ".loser-continue");
};
const journal = await __testOnlyOpenGrandHallT554NativeReviewJournal(
  { workspaceRoot: workspace, expectedScope: scope },
  {
    nowUtc: () => ${JSON.stringify(FIXED_TIME)},
    writeChunkByteLength: phase === "mid-write" ? 11 : undefined,
    afterEventWriteChunk: phase === "mid-write" ? stopHere : undefined,
    afterEventFileSynced:
      phase === "quarantine-race" ? stopAfterPendingWrite : undefined,
    afterClaimDirectorySynced:
      phase === "after-claim"
        ? stopHere
        : phase === "quarantine-race"
          ? stopWinnerAfterClaim
          : undefined,
    afterClaimConflictDetectedBeforeQuarantine:
      phase === "quarantine-race"
        ? stopLoserAfterClaimConflict
        : undefined,
    afterPendingDirectorySyncedBeforePostReplay:
      phase === "after-pending-cleanup" ? stopHere : undefined,
    afterReplayBeforeReserve:
      phase === "race" || phase === "quarantine-race"
        ? stopHere
        : undefined,
    beforeDirectorySync: phase === "during-quarantine-recovery"
      ? async ({ reason }) => {
          if (reason === "quarantine-destination") await stopHere();
        }
      : undefined,
  },
);
try {
  const replay = await journal.append({
    expectedRevision: 0,
    eventType: "coverage.sample",
    payload: { writer },
  });
  await writeFile(resultPath, JSON.stringify({ ok: true, revision: replay.revision }));
} catch (error) {
  const code = error instanceof GrandHallT554NativeReviewJournalError
    ? error.code
    : "UNKNOWN";
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(resultPath, JSON.stringify({ ok: false, code, message }));
}
`;
}

async function spawnJournalChild(
  fixture: Harness,
  phase:
    | "mid-write"
    | "after-claim"
    | "after-pending-cleanup"
    | "race"
    | "quarantine-race"
    | "during-quarantine-recovery",
  writer: string,
): Promise<{
  readonly child: ChildProcess;
  readonly completion: Promise<ChildCompletion>;
  readonly signalPath: string;
  readonly resultPath: string;
}> {
  childScriptSequence += 1;
  const scriptPath = join(
    fixture.root,
    `journal-child-${String(childScriptSequence)}.mts`,
  );
  const signalPath = join(
    fixture.root,
    `journal-child-${String(childScriptSequence)}.ready`,
  );
  const controlPath = join(fixture.root, "journal-race.go");
  const resultPath = join(
    fixture.root,
    `journal-child-${String(childScriptSequence)}.result.json`,
  );
  await writeFile(scriptPath, journalChildSource());
  const child = spawn(process.execPath, [
    TSX_CLI,
    scriptPath,
    fixture.workspace,
    JSON.stringify(fixture.scope),
    signalPath,
    controlPath,
    resultPath,
    phase,
    writer,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  activeChildren.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  const completion = new Promise<ChildCompletion>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      activeChildren.delete(child);
      resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, completion, signalPath, resultPath };
}

async function waitForPath(absolutePath: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await access(absolutePath);
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error(`Timed out waiting for subprocess evidence at ${absolutePath}.`);
}

async function waitForOnePath(
  absolutePaths: readonly string[],
): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const absolutePath of absolutePaths) {
      try {
        await access(absolutePath);
        return absolutePath;
      } catch {
        // The other candidate may be the first completed subprocess.
      }
    }
    await delay(10);
  }
  throw new Error(
    `Timed out waiting for one subprocess result: ${absolutePaths.join(", ")}.`,
  );
}

function expectJournalError(code: GrandHallT554NativeReviewJournalError["code"]): {
  readonly code: string;
} {
  return { code };
}

async function resealEvent(
  workspace: string,
  path: string,
  mutate: (event: Record<string, unknown>) => void,
): Promise<string> {
  const event = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  mutate(event);
  const { eventSha256: _oldDigest, ...material } = event;
  void _oldDigest;
  const eventSha256 = semanticSha256(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
    material);
  const bytes = canonicalBytes({ ...material, eventSha256 });
  const sequence = material.sequence;
  if (typeof sequence !== "number") throw new Error("Fixture event sequence is missing.");
  const next = join(workspace, "events", eventFileName(sequence, eventSha256));
  if (next !== path) await rename(path, next);
  await writeFile(next, bytes);
  return next;
}

afterEach(async () => {
  const children = [...activeChildren];
  for (const child of children) child.kill("SIGKILL");
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([
      new Promise<void>((resolve) => {
        child.once("close", () => { resolve(); });
      }),
      delay(2_000).then(() => undefined),
    ]);
  }));
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("Grand Hall T-554 native-review append-only journal", () => {
  it("creates an exact fixed workspace and replays canonical scope-bound events", async () => {
    const fixture = await harness();
    expect((await readdir(fixture.workspace)).sort()).toEqual([
      "claims", "events", "pending", "quarantine", "scope.json",
    ]);
    expect(await fixture.journal.replay()).toMatchObject({
      revision: 0,
      scope: fixture.scope,
      events: [],
    });

    const first = await fixture.journal.append({
      expectedRevision: 0,
      eventType: "coverage.sample",
      payload: { b: 2, a: 1 },
    });
    expect(first).toMatchObject({ revision: 1, scope: fixture.scope });
    expect(first.events[0]).toMatchObject({
      sequence: 1,
      previousEventSha256: first.genesisSha256,
      recordedAtUtc: FIXED_TIME,
      eventType: "coverage.sample",
      payload: { a: 1, b: 2 },
    });
    const path = await onlyEventPath(fixture.workspace);
    const bytes = await readFile(path);
    expect(bytes.at(-1)).toBe(0x0a);
    expect(bytes.toString("utf8")).not.toContain("\n  ");
    expect(first.events[0]?.fileSha256).toBe(rawSha256(bytes));
    expect(path.endsWith(eventFileName(1, first.headEventSha256))).toBe(true);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    const second = await reopened.append({ expectedRevision: 1,
      eventType: "mask.edit", payload: { operation: "include_rectangle" } });
    expect(second.revision).toBe(2);
    expect(second.events[1]?.previousEventSha256).toBe(second.events[0]?.eventSha256);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);
  });

  it("derives a validated append from the exact replay held inside the serial lane", async () => {
    let countReads = false;
    let claimReads = 0;
    let eventReads = 0;
    let activeReads = 0;
    let maximumActiveReads = 0;
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      beforeCommittedContentRead: ({ kind }) => {
        if (!countReads) return;
        if (kind === "claim") claimReads += 1;
        else eventReads += 1;
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      },
      afterCommittedContentRead: () => {
        if (countReads) activeReads -= 1;
      },
    });
    await fixture.journal.append({
      expectedRevision: 0,
      eventType: "coverage.sample",
      payload: { sequence: 1 },
    });
    countReads = true;
    const observedRevisions: number[] = [];

    const advanced = await fixture.journal.appendValidated({
      expectedRevision: 1,
      eventType: "coverage.sample",
      payload: { sequence: 2 },
      validateCurrent: (current) => {
        observedRevisions.push(current.revision);
        expect(current.events.map((event) => event.payload)).toEqual([
          { sequence: 1 },
        ]);
        expect(Object.isFrozen(current)).toBe(true);
        expect(Object.isFrozen(current.events)).toBe(true);
        expect(Object.isFrozen(current.events[0]?.payload)).toBe(true);
        return {
          minimumRecordedAtUtc: FIXED_TIME,
        };
      },
    });

    expect(observedRevisions).toEqual([1]);
    expect(advanced.events.map((event) => event.payload)).toEqual([
      { sequence: 1 },
      { sequence: 2 },
    ]);
    expect({ claimReads, eventReads, activeReads }).toEqual({
      claimReads: 0,
      eventReads: 3,
      activeReads: 0,
    });
    expect(maximumActiveReads).toBeLessThanOrEqual(2);
    countReads = false;

    let staleValidatorCalled = false;
    await expect(
      fixture.journal.appendValidated({
        expectedRevision: 1,
        eventType: "coverage.sample",
        payload: { sequence: 3 },
        validateCurrent: () => {
          staleValidatorCalled = true;
          return {};
        },
      }),
    ).rejects.toMatchObject(expectJournalError("REVISION_CONFLICT"));
    expect(staleValidatorCalled).toBe(false);

    await expect(
      fixture.journal.appendValidated({
        expectedRevision: 2,
        eventType: "coverage.sample",
        payload: { sequence: 3 },
        validateCurrent: () => {
          throw new Error("semantic validation rejected the candidate");
        },
      }),
    ).rejects.toThrow("semantic validation rejected the candidate");
    expect((await fixture.journal.replay()).revision).toBe(2);
    expect(await eventNames(fixture.workspace)).toHaveLength(2);
  });

  it("drains every started parallel content reader before replay rejects", async () => {
    let instrument = false;
    let activeReads = 0;
    let releaseSecondRead!: () => void;
    let announceSecondRead!: () => void;
    let announceFirstFinished!: () => void;
    const secondReadGate = new Promise<void>((resolve) => {
      releaseSecondRead = resolve;
    });
    const secondReadStarted = new Promise<void>((resolve) => {
      announceSecondRead = resolve;
    });
    const firstReadFinished = new Promise<void>((resolve) => {
      announceFirstFinished = resolve;
    });
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      beforeCommittedContentRead: async ({ kind, sequence }) => {
        if (!instrument || kind !== "event") return;
        activeReads += 1;
        if (sequence === 2) {
          announceSecondRead();
          await secondReadGate;
        }
      },
      afterCommittedContentRead: ({ kind, sequence }) => {
        if (!instrument || kind !== "event") return;
        activeReads -= 1;
        if (sequence === 1) announceFirstFinished();
      },
    });
    await fixture.journal.append({
      expectedRevision: 0,
      eventType: "coverage.sample",
      payload: { sequence: 1 },
    });
    await fixture.journal.append({
      expectedRevision: 1,
      eventType: "coverage.sample",
      payload: { sequence: 2 },
    });
    const [firstEventName] = await eventNames(fixture.workspace);
    if (firstEventName === undefined) throw new Error("missing first event");
    await writeFile(
      join(fixture.workspace, "events", firstEventName),
      "{}\n",
      "utf8",
    );

    instrument = true;
    let replaySettled = false;
    const replayOutcome = fixture.journal.replay().then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    ).finally(() => {
      replaySettled = true;
    });
    await Promise.all([secondReadStarted, firstReadFinished]);
    await delay(25);
    expect(replaySettled).toBe(false);
    expect(activeReads).toBe(1);
    releaseSecondRead();

    expect(await replayOutcome).toMatchObject({
      status: "rejected",
      error: expectJournalError("JOURNAL_INVALID"),
    });
    expect(replaySettled).toBe(true);
    expect(activeReads).toBe(0);
  });

  it("balances content hooks and drains sibling readers when a before hook rejects", async () => {
    let instrument = false;
    let activeReads = 0;
    const completedReads: number[] = [];
    let releaseSecondRead!: () => void;
    let announceSecondRead!: () => void;
    let announceFirstAfterHook!: () => void;
    const secondReadGate = new Promise<void>((resolve) => {
      releaseSecondRead = resolve;
    });
    const secondReadStarted = new Promise<void>((resolve) => {
      announceSecondRead = resolve;
    });
    const firstAfterHook = new Promise<void>((resolve) => {
      announceFirstAfterHook = resolve;
    });
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      beforeCommittedContentRead: async ({ kind, sequence }) => {
        if (!instrument || kind !== "event") return;
        activeReads += 1;
        if (sequence === 2) {
          announceSecondRead();
          await secondReadGate;
          return;
        }
        if (sequence === 1) {
          await secondReadStarted;
          throw new Error("injected before-content hook rejection");
        }
      },
      afterCommittedContentRead: ({ kind, sequence }) => {
        if (!instrument || kind !== "event") return;
        activeReads -= 1;
        completedReads.push(sequence);
        if (sequence === 1) announceFirstAfterHook();
      },
    });
    await fixture.journal.append({
      expectedRevision: 0,
      eventType: "coverage.sample",
      payload: { sequence: 1 },
    });
    await fixture.journal.append({
      expectedRevision: 1,
      eventType: "coverage.sample",
      payload: { sequence: 2 },
    });

    instrument = true;
    let replaySettled = false;
    const replayOutcome = fixture.journal.replay().then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    ).finally(() => {
      replaySettled = true;
    });
    await firstAfterHook;
    await delay(25);
    expect(replaySettled).toBe(false);
    expect(activeReads).toBe(1);
    expect(completedReads).toEqual([1]);
    releaseSecondRead();

    expect(await replayOutcome).toMatchObject({
      status: "rejected",
      error: expectJournalError("JOURNAL_INVALID"),
    });
    expect(replaySettled).toBe(true);
    expect(activeReads).toBe(0);
    expect(completedReads.sort((left, right) => left - right)).toEqual([1, 2]);
  });

  it("enforces fixed event-count and cumulative-byte ceilings on append and replay", async () => {
    const countBound = await harness({
      nowUtc: () => FIXED_TIME,
      maximumEventCount: 2,
    });
    await countBound.journal.append({
      expectedRevision: 0,
      eventType: "coverage.sample",
      payload: { sequence: 1 },
    });
    await countBound.journal.append({
      expectedRevision: 1,
      eventType: "coverage.sample",
      payload: { sequence: 2 },
    });
    await expect(countBound.journal.append({
      expectedRevision: 2,
      eventType: "coverage.sample",
      payload: { sequence: 3 },
    })).rejects.toMatchObject(expectJournalError("JOURNAL_LIMIT_REACHED"));
    await expect(__testOnlyOpenGrandHallT554NativeReviewJournal(
      {
        workspaceRoot: countBound.workspace,
        expectedScope: countBound.scope,
      },
      { maximumEventCount: 1 },
    )).rejects.toMatchObject(expectJournalError("JOURNAL_INVALID"));

    const byteBound = await harness({
      nowUtc: () => FIXED_TIME,
      maximumTotalEventBytes: 1_024,
    });
    await expect(byteBound.journal.append({
      expectedRevision: 0,
      eventType: "coverage.sample",
      payload: { oversizedForJournal: "x".repeat(2_048) },
    })).rejects.toMatchObject(expectJournalError("JOURNAL_LIMIT_REACHED"));
    expect(await eventNames(byteBound.workspace)).toEqual([]);
  });

  it("requires one absolute empty direct root and preserves failed initialization state", async () => {
    const root = await mkdtemp(join(tmpdir(), "t554-native-journal-root-"));
    roots.push(root);
    const nonempty = join(root, "nonempty");
    await mkdir(nonempty);
    await writeFile(join(nonempty, "owner-file.txt"), "preserve me");

    await expect(createGrandHallT554NativeReviewJournal({
      workspaceRoot: "relative/journal",
      scope: scope(),
    })).rejects.toMatchObject(expectJournalError("ARGUMENT_INVALID"));
    await expect(createGrandHallT554NativeReviewJournal({
      workspaceRoot: nonempty,
      scope: scope(),
    })).rejects.toMatchObject(expectJournalError("WORKSPACE_UNSAFE"));
    expect(await readFile(join(nonempty, "owner-file.txt"), "utf8")).toBe("preserve me");

    const target = join(root, "target");
    const alias = join(root, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(createGrandHallT554NativeReviewJournal({
      workspaceRoot: alias,
      scope: scope(),
    })).rejects.toMatchObject(expectJournalError("WORKSPACE_UNSAFE"));
  });

  it("rejects scope drift and a caller opening the workspace under another scope", async () => {
    const fixture = await harness();
    await expect(openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: scope({ subjectSha256: sha256("9") }),
    })).rejects.toMatchObject(expectJournalError("WORKSPACE_UNSAFE"));

    const scopePath = join(fixture.workspace, "scope.json");
    const document = JSON.parse(await readFile(scopePath, "utf8")) as Record<string, unknown>;
    const driftedScope = scope({ sourceEpochSha256: sha256("8") });
    const material = {
      schemaVersion: document.schemaVersion,
      scope: driftedScope,
    };
    await writeFile(scopePath, canonicalBytes({
      ...material,
      scopeSha256: semanticSha256(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN,
        material),
    }));
    await expect(fixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("WORKSPACE_UNSAFE"),
    );
  });

  it("serializes two journal handles and enforces expected-revision CAS", async () => {
    let releaseFirst: (() => void) | undefined;
    let firstReachedGate: (() => void) | undefined;
    const reached = new Promise<void>((resolve) => { firstReachedGate = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let gateUsed = false;
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      afterReplayBeforeReserve: async () => {
        if (gateUsed) return;
        gateUsed = true;
        firstReachedGate?.();
        await gate;
      },
    });
    const secondHandle = await __testOnlyOpenGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    }, { nowUtc: () => FIXED_TIME });

    const first = fixture.journal.append({ expectedRevision: 0,
      eventType: "coverage.sample", payload: { tab: 1 } });
    await reached;
    const second = secondHandle.append({ expectedRevision: 0,
      eventType: "coverage.sample", payload: { tab: 2 } });
    releaseFirst?.();
    expect((await first).revision).toBe(1);
    await expect(second).rejects.toMatchObject(expectJournalError("REVISION_CONFLICT"));
    expect((await fixture.journal.replay()).revision).toBe(1);
    expect(await eventNames(fixture.workspace)).toHaveLength(1);
  });

  it("rejects noncanonical input and wall-clock rollback before reserving a file", async () => {
    const instants = [
      "2026-08-26T12:34:56.789Z",
      "2026-08-26T12:34:56.789Z",
      "2026-08-26T12:34:56.789Z",
      "2026-08-26T12:34:55.789Z",
    ];
    const fixture = await harness({ nowUtc: () => instants.shift() ?? FIXED_TIME });
    await expect(fixture.journal.append({
      expectedRevision: 0,
      eventType: "Coverage Sample",
      payload: {},
    })).rejects.toMatchObject(expectJournalError("ARGUMENT_INVALID"));
    await expect(fixture.journal.append({
      expectedRevision: 0,
      eventType: "coverage.sample",
      payload: { constructor: "browser-supplied-claim" },
    })).rejects.toMatchObject(expectJournalError("ARGUMENT_INVALID"));
    expect(await eventNames(fixture.workspace)).toEqual([]);

    await appendOne(fixture.journal);
    await expect(fixture.journal.append({ expectedRevision: 1,
      eventType: "coverage.sample", payload: { second: true } })).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
    expect(await eventNames(fixture.workspace)).toHaveLength(1);
  });

  it("quarantines a deterministic partial-write crash and retains the prior revision", async () => {
    let crashed = false;
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      quarantineToken: () => "a".repeat(32),
      writeChunkByteLength: 11,
      afterEventWriteChunk: () => {
        if (crashed) return;
        crashed = true;
        throw new Error("injected partial-write crash");
      },
    });
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("APPEND_FAILED"),
    );
    expect(await eventNames(fixture.workspace)).toEqual([]);
    const quarantined = await readdir(join(fixture.workspace, "quarantine"));
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatch(
      /^moved-0000000000000001-sha256-[0-9a-f]{64}-bytes-11-sha256-[0-9a-f]{64}-a{32}\.json$/u,
    );
    expect((await readFile(join(fixture.workspace, "quarantine", quarantined[0] ?? ""))).length)
      .toBe(11);
    expect((await fixture.journal.replay()).revision).toBe(0);
  });

  it("quarantines a post-fsync acknowledgement crash and never exposes its valid bytes", async () => {
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      quarantineToken: () => "b".repeat(32),
      afterEventFileSynced: () => { throw new Error("injected post-fsync crash"); },
    });
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("APPEND_FAILED"),
    );
    expect(await eventNames(fixture.workspace)).toEqual([]);
    const quarantined = await readdir(join(fixture.workspace, "quarantine"));
    const bytes = await readFile(join(fixture.workspace, "quarantine", quarantined[0] ?? ""));
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    expect(parsed).toBeTypeOf("object");
    expect((await fixture.journal.replay()).revision).toBe(0);
  });

  it("rejects moved-quarantine bytes that drift from their filename receipt", async () => {
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      afterEventFileSynced: () => {
        throw new Error("injected post-fsync failure");
      },
    });
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("APPEND_FAILED"),
    );
    const names = await readdir(join(fixture.workspace, "quarantine"));
    const name = names[0];
    if (name === undefined) throw new Error("Missing moved-quarantine fixture.");
    const path = join(fixture.workspace, "quarantine", name);
    const drifted = Buffer.from(await readFile(path));
    drifted[0] = (drifted[0] ?? 0) ^ 0xff;
    await writeFile(path, drifted);
    await expect(fixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
  });

  it("reserves quarantine capacity before creating another pending attempt", async () => {
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      maximumQuarantineEntryCount: 1,
      afterEventFileSynced: () => {
        throw new Error("injected post-fsync failure");
      },
    });
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("APPEND_FAILED"),
    );
    expect(await readdir(join(fixture.workspace, "quarantine"))).toHaveLength(1);
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("JOURNAL_LIMIT_REACHED"),
    );
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toHaveLength(1);
  });

  it("recovers a claim-publication crash without moving a possibly committed event", async () => {
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      quarantineToken: () => "8".repeat(32),
      afterClaimDirectorySynced: () => {
        throw new Error("injected crash after durable claim");
      },
    });
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("APPEND_AMBIGUOUS"),
    );
    expect(await readdir(join(fixture.workspace, "claims"))).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "pending"))).toHaveLength(1);
    expect(await eventNames(fixture.workspace)).toEqual([]);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    expect((await reopened.replay()).revision).toBe(1);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(await eventNames(fixture.workspace)).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);
  });

  it("keeps a published event authoritative when acknowledgement fails", async () => {
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      quarantineToken: () => "9".repeat(32),
      afterEventDirectorySynced: () => {
        throw new Error("injected crash after event publication");
      },
    });
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("APPEND_AMBIGUOUS"),
    );
    expect(await readdir(join(fixture.workspace, "claims"))).toHaveLength(1);
    expect(await eventNames(fixture.workspace)).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "pending"))).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    expect((await reopened.replay()).revision).toBe(1);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);
  });

  it("reopens the exact committed revision when acknowledgement is lost after pending cleanup", async () => {
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      afterPendingDirectorySyncedBeforePostReplay: () => {
        throw new Error("injected crash after pending cleanup");
      },
    });
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("APPEND_AMBIGUOUS"),
    );
    expect(await readdir(join(fixture.workspace, "claims"))).toHaveLength(1);
    expect(await eventNames(fixture.workspace)).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    const replay = await reopened.replay();
    expect(replay.revision).toBe(1);
    expect(replay.events).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);
  });

  it("recovers a real subprocess kill during a partial pending write", async () => {
    const fixture = await harness();
    const running = await spawnJournalChild(fixture, "mid-write", "killed-mid-write");
    await waitForPath(running.signalPath);
    expect(running.child.kill("SIGKILL")).toBe(true);
    const completion = await running.completion;
    expect(completion.code === 0).toBe(false);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    expect((await reopened.replay()).revision).toBe(0);
    expect(await eventNames(fixture.workspace)).toEqual([]);
    expect(await readdir(join(fixture.workspace, "claims"))).toEqual([]);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toHaveLength(1);
  }, 20_000);

  it("finishes an exact pending-to-quarantine hard-link residue after a real recovery kill", async () => {
    const fixture = await harness();
    const writer = await spawnJournalChild(
      fixture,
      "mid-write",
      "killed-before-quarantine",
    );
    await waitForPath(writer.signalPath);
    expect(writer.child.kill("SIGKILL")).toBe(true);
    expect((await writer.completion).code === 0).toBe(false);

    const recovery = await spawnJournalChild(
      fixture,
      "during-quarantine-recovery",
      "killed-during-quarantine",
    );
    await waitForPath(recovery.signalPath);
    const pendingBefore = await readdir(join(fixture.workspace, "pending"));
    const quarantineBefore = await readdir(
      join(fixture.workspace, "quarantine"),
    );
    expect(pendingBefore).toHaveLength(1);
    expect(quarantineBefore).toHaveLength(1);
    const pendingStats = await lstat(
      join(fixture.workspace, "pending", pendingBefore[0] ?? ""),
      { bigint: true },
    );
    const quarantineStats = await lstat(
      join(fixture.workspace, "quarantine", quarantineBefore[0] ?? ""),
      { bigint: true },
    );
    expect(pendingStats.nlink).toBe(2n);
    expect(quarantineStats.nlink).toBe(2n);
    expect(quarantineStats.dev).toBe(pendingStats.dev);
    expect(quarantineStats.ino).toBe(pendingStats.ino);
    expect(recovery.child.kill("SIGKILL")).toBe(true);
    expect((await recovery.completion).code === 0).toBe(false);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    expect((await reopened.replay()).revision).toBe(0);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    const quarantine = await readdir(join(fixture.workspace, "quarantine"));
    expect(quarantine).toHaveLength(1);
    expect(quarantine[0]).toMatch(
      /^moved-0000000000000001-sha256-[0-9a-f]{64}-bytes-11-sha256-[0-9a-f]{64}-[0-9a-f]{32}\.json$/u,
    );
    expect(
      (
        await lstat(
          join(fixture.workspace, "quarantine", quarantine[0] ?? ""),
          { bigint: true },
        )
      ).nlink,
    ).toBe(1n);
  }, 30_000);

  it("recovers a real subprocess kill after the no-replace claim commit point", async () => {
    const fixture = await harness();
    const running = await spawnJournalChild(fixture, "after-claim", "killed-after-claim");
    await waitForPath(running.signalPath);
    expect(running.child.kill("SIGKILL")).toBe(true);
    const completion = await running.completion;
    expect(completion.code === 0).toBe(false);
    expect(await readdir(join(fixture.workspace, "claims"))).toHaveLength(1);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    const replay = await reopened.replay();
    expect(replay.revision).toBe(1);
    expect(replay.events[0]?.payload).toEqual({ writer: "killed-after-claim" });
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(await eventNames(fixture.workspace)).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);
  }, 20_000);

  it("reopens the exact commit after a real kill following pending cleanup", async () => {
    const fixture = await harness();
    const running = await spawnJournalChild(
      fixture,
      "after-pending-cleanup",
      "killed-after-pending-cleanup",
    );
    await waitForPath(running.signalPath);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(running.child.kill("SIGKILL")).toBe(true);
    const completion = await running.completion;
    expect(completion.code === 0).toBe(false);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    const replay = await reopened.replay();
    expect(replay.revision).toBe(1);
    expect(replay.events[0]?.payload).toEqual({
      writer: "killed-after-pending-cleanup",
    });
    expect(await readdir(join(fixture.workspace, "claims"))).toHaveLength(1);
    expect(await eventNames(fixture.workspace)).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    expect(await readdir(join(fixture.workspace, "quarantine"))).toEqual([]);
  }, 20_000);

  it("reconciles the exact quarantine receipt when two unowned real processes clean up one losing CAS attempt", async () => {
    const fixture = await harness();
    const first = await spawnJournalChild(
      fixture,
      "quarantine-race",
      "process-a",
    );
    const second = await spawnJournalChild(
      fixture,
      "quarantine-race",
      "process-b",
    );
    await Promise.all([
      waitForPath(first.signalPath),
      waitForPath(second.signalPath),
    ]);
    await writeFile(join(fixture.root, "journal-race.go"), "go", { flag: "wx" });
    await Promise.all([
      waitForPath(`${first.signalPath}.pending`),
      waitForPath(`${second.signalPath}.pending`),
    ]);
    await writeFile(join(fixture.root, "journal-race.go.claim"), "go", {
      flag: "wx",
    });
    await Promise.all([
      waitForPath(join(fixture.root, "journal-race.go.winner-ready")),
      waitForPath(join(fixture.root, "journal-race.go.loser-ready")),
    ]);
    await writeFile(
      join(fixture.root, "journal-race.go.winner-continue"),
      "go",
      { flag: "wx" },
    );
    await waitForOnePath([first.resultPath, second.resultPath]);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    const movedBeforeLoserCleanup = await readdir(
      join(fixture.workspace, "quarantine"),
    );
    expect(movedBeforeLoserCleanup).toHaveLength(1);
    expect(movedBeforeLoserCleanup[0]).toMatch(/^moved-/u);
    await writeFile(
      join(fixture.root, "journal-race.go.loser-continue"),
      "go",
      { flag: "wx" },
    );
    const [firstCompletion, secondCompletion] = await Promise.all([
      first.completion,
      second.completion,
    ]);
    expect(firstCompletion.code).toBe(0);
    expect(secondCompletion.code).toBe(0);
    const results = await Promise.all([
      readFile(first.resultPath, "utf8"),
      readFile(second.resultPath, "utf8"),
    ]).then((values) => values.map((value) => JSON.parse(value) as {
      readonly ok: boolean;
      readonly code?: string;
    }));
    expect(results.filter((result) => result.code === "REVISION_CONFLICT"))
      .toHaveLength(1);
    // Cross-process acknowledgement belongs to the external session-root
    // owner. Without it, the committed winner may correctly fail closed as
    // APPEND_AMBIGUOUS if the losing process changes quarantine during replay.
    expect(
      results.filter(
        (result) => result.ok || result.code === "APPEND_AMBIGUOUS",
      ),
    ).toHaveLength(1);

    const reopened = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    });
    expect((await reopened.replay()).revision).toBe(1);
    expect(await readdir(join(fixture.workspace, "claims"))).toHaveLength(1);
    expect(await eventNames(fixture.workspace)).toHaveLength(1);
    expect(await readdir(join(fixture.workspace, "pending"))).toEqual([]);
    const quarantine = await readdir(join(fixture.workspace, "quarantine"));
    expect(quarantine).toEqual(movedBeforeLoserCleanup);
  }, 30_000);

  it("writes a durable ambiguity marker when the reserved path cannot be moved", async () => {
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      quarantineToken: () => "c".repeat(32),
      afterEventFileSynced: async ({ absolutePath }) => {
        await rename(absolutePath, join(fixture.root, "externally-moved-event.json"));
        throw new Error("injected path disappearance");
      },
    });
    await expect(appendOne(fixture.journal)).rejects.toMatchObject(
      expectJournalError("APPEND_AMBIGUOUS"),
    );
    const quarantine = await readdir(join(fixture.workspace, "quarantine"));
    expect(quarantine[0]).toMatch(/^marker-0000000000000001-sha256-[0-9a-f]{64}-c{32}\.json$/u);
    await expect(fixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
    await expect(__testOnlyOpenGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    }, { nowUtc: () => FIXED_TIME, quarantineToken: () => "d".repeat(32) }))
      .rejects.toMatchObject(expectJournalError("JOURNAL_INVALID"));
  });

  it("attempts an event-directory durability barrier before acknowledging", async () => {
    const reasons: string[] = [];
    const fixture = await harness({
      nowUtc: () => FIXED_TIME,
      beforeDirectorySync: ({ reason }) => { reasons.push(reason); },
    });
    reasons.splice(0);
    await appendOne(fixture.journal);
    expect(reasons).toContain("event-publication");
  });

  it.each([
    ["truncated bytes", async (fixture: Harness) => {
      const path = await onlyEventPath(fixture.workspace);
      const bytes = await readFile(path);
      await writeFile(path, bytes.subarray(0, bytes.length - 7));
    }],
    ["noncanonical bytes", async (fixture: Harness) => {
      const path = await onlyEventPath(fixture.workspace);
      const value = JSON.parse(await readFile(path, "utf8")) as unknown;
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
    }],
    ["duplicate JSON keys", async (fixture: Harness) => {
      const path = await onlyEventPath(fixture.workspace);
      const text = await readFile(path, "utf8");
      await writeFile(path, `{"sequence":1,${text.slice(1)}`);
    }],
    ["event digest drift", async (fixture: Harness) => {
      const path = await onlyEventPath(fixture.workspace);
      const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      value.payload = { altered: true };
      await writeFile(path, canonicalBytes(value));
    }],
    ["event scope drift", async (fixture: Harness) => {
      const path = await onlyEventPath(fixture.workspace);
      await resealEvent(fixture.workspace, path, (event) => {
        event.scope = scope({ subjectSha256: sha256("e") });
      });
    }],
  ] as const)("rejects %s", async (_label, corrupt) => {
    const fixture = await harness();
    await appendOne(fixture.journal);
    await corrupt(fixture);
    await expect(fixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
  });

  it("rejects gaps, duplicate sequences, and a self-consistent broken hash chain", async () => {
    const gap = await harness();
    await appendOne(gap.journal);
    await gap.journal.append({ expectedRevision: 1, eventType: "coverage.sample",
      payload: { second: true } });
    const gapNames = await eventNames(gap.workspace);
    const firstName = gapNames[0];
    if (firstName === undefined) throw new Error("Missing first gap fixture event.");
    const firstDigest = /^\d{16}-(sha256-[0-9a-f]{64})\.json$/u.exec(firstName)?.[1]
      ?.replace("sha256-", "sha256:");
    if (firstDigest === undefined) throw new Error("Missing first event digest.");
    await rename(join(gap.workspace, "events", firstName),
      join(gap.workspace, "events", eventFileName(3, firstDigest)));
    await expect(gap.journal.replay()).rejects.toMatchObject(expectJournalError("JOURNAL_INVALID"));

    const duplicate = await harness();
    await appendOne(duplicate.journal);
    const duplicatePath = await onlyEventPath(duplicate.workspace);
    const duplicateValue = JSON.parse(await readFile(duplicatePath, "utf8")) as Record<string, unknown>;
    const { eventSha256: _digest, ...duplicateMaterial } = duplicateValue;
    void _digest;
    duplicateMaterial.payload = { distinct: true };
    const duplicateDigest = semanticSha256(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
      duplicateMaterial);
    await writeFile(join(duplicate.workspace, "events", eventFileName(1, duplicateDigest)),
      canonicalBytes({ ...duplicateMaterial, eventSha256: duplicateDigest }));
    await expect(duplicate.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );

    const chain = await harness();
    await appendOne(chain.journal);
    await chain.journal.append({ expectedRevision: 1, eventType: "coverage.sample",
      payload: { second: true } });
    const chainNames = await eventNames(chain.workspace);
    const secondPath = join(chain.workspace, "events", chainNames[1] ?? "");
    await resealEvent(chain.workspace, secondPath, (event) => {
      event.previousEventSha256 = sha256("f");
    });
    await expect(chain.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
  });

  it("rejects a forged standalone claim that has no exact pending crash witness", async () => {
    const donor = await harness();
    await appendOne(donor.journal);
    const victim = await harness();
    await copyFile(
      await onlyEventPath(donor.workspace),
      join(victim.workspace, "claims", "0000000000000001.json"),
    );
    await expect(victim.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
    expect(await eventNames(victim.workspace)).toEqual([]);
    expect(await readdir(join(victim.workspace, "quarantine"))).toEqual([]);
  });

  it("rejects more than one unpublished claim even with exact pending witnesses", async () => {
    const donor = await harness();
    await appendOne(donor.journal);
    await donor.journal.append({
      expectedRevision: 1,
      eventType: "coverage.sample",
      payload: { second: true },
    });
    const victim = await harness();
    const donorNames = await eventNames(donor.workspace);
    for (const [index, donorName] of donorNames.entries()) {
      const sequence = index + 1;
      const donorPath = join(donor.workspace, "events", donorName);
      const document = JSON.parse(await readFile(donorPath, "utf8")) as Record<
        string,
        unknown
      >;
      const digest = document.eventSha256;
      if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
        throw new Error("Donor event digest is missing.");
      }
      const token = String(sequence).repeat(32);
      const pendingName = `pending-${String(sequence).padStart(16, "0")}-${digest.replace(":", "-")}-${token}.json`;
      const pendingPath = join(victim.workspace, "pending", pendingName);
      await copyFile(donorPath, pendingPath);
      await link(
        pendingPath,
        join(
          victim.workspace,
          "claims",
          `${String(sequence).padStart(16, "0")}.json`,
        ),
      );
    }

    await expect(
      openGrandHallT554NativeReviewJournal({
        workspaceRoot: victim.workspace,
        expectedScope: victim.scope,
      }),
    ).rejects.toMatchObject(expectJournalError("JOURNAL_INVALID"));
    expect(await eventNames(victim.workspace)).toEqual([]);
    expect(await readdir(join(victim.workspace, "pending"))).toHaveLength(2);
    expect(await readdir(join(victim.workspace, "quarantine"))).toEqual([]);
  });

  it("rejects an over-bound quarantine receipt before trusting its inventory", async () => {
    const fixture = await harness();
    const bytes = Buffer.alloc(
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES + 1,
    );
    const name = `moved-0000000000000001-${sha256("0").replace(":", "-")}-bytes-${String(bytes.length)}-${rawSha256(bytes).replace(":", "-")}-${"a".repeat(32)}.json`;
    await writeFile(join(fixture.workspace, "quarantine", name), bytes);
    await expect(fixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
  });

  it("rejects extra files, extra directories, unsafe case drift, and hard links", async () => {
    const extraFile = await harness();
    await writeFile(join(extraFile.workspace, "events", "extra.json"), "{}\n");
    await expect(extraFile.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );

    const extraDirectory = await harness();
    await mkdir(join(extraDirectory.workspace, "events", "extra-directory"));
    await expect(extraDirectory.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );

    const caseDrift = await harness();
    const temporary = join(caseDrift.workspace, "events-case-temporary");
    await rename(join(caseDrift.workspace, "events"), temporary);
    await rename(temporary, join(caseDrift.workspace, "EVENTS"));
    await expect(caseDrift.journal.replay()).rejects.toMatchObject(
      expectJournalError("WORKSPACE_UNSAFE"),
    );

    const hardLinked = await harness();
    await appendOne(hardLinked.journal);
    const source = await onlyEventPath(hardLinked.workspace);
    await link(source, join(hardLinked.workspace, "events", "hard-link.json"));
    await expect(hardLinked.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
  });

  it("rejects event and quarantine symlinks or reparse directories", async () => {
    const fixture = await harness();
    const eventTarget = join(fixture.root, "event-target-directory");
    await mkdir(eventTarget);
    await symlink(eventTarget, join(fixture.workspace, "events", "linked"),
      process.platform === "win32" ? "junction" : "dir");
    await expect(fixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );

    const quarantineFixture = await harness();
    const targetDirectory = join(quarantineFixture.root, "target-directory");
    await mkdir(targetDirectory);
    await symlink(targetDirectory, join(quarantineFixture.workspace, "quarantine", "linked"),
      process.platform === "win32" ? "junction" : "dir");
    await expect(quarantineFixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );

  });

  it("rejects a same-name event replacement with canonical bytes on a different inode", async () => {
    const fixture = await harness();
    await appendOne(fixture.journal);
    const path = await onlyEventPath(fixture.workspace);
    const bytes = await readFile(path);
    await rm(path);
    await writeFile(path, bytes);
    await expect(fixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
  });

  it("rejects a same-name claim replacement and an external third hard link", async () => {
    const replacedClaim = await harness();
    await appendOne(replacedClaim.journal);
    const claimPath = join(
      replacedClaim.workspace,
      "claims",
      "0000000000000001.json",
    );
    const claimBytes = await readFile(claimPath);
    await rm(claimPath);
    await writeFile(claimPath, claimBytes);
    await expect(replacedClaim.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );

    const externalAlias = await harness();
    await appendOne(externalAlias.journal);
    await link(
      await onlyEventPath(externalAlias.workspace),
      join(externalAlias.root, "external-third-link.json"),
    );
    await expect(externalAlias.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
  });
});
