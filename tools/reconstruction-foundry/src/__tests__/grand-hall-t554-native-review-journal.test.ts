import { createHash } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
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
const FIXED_TIME = "2026-08-26T12:34:56.789Z";

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
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("Grand Hall T-554 native-review append-only journal", () => {
  it("creates an exact fixed workspace and replays canonical scope-bound events", async () => {
    const fixture = await harness();
    expect((await readdir(fixture.workspace)).sort()).toEqual([
      "events", "quarantine", "scope.json",
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
    expect(quarantined[0]).toMatch(/^moved-0000000000000001-sha256-[0-9a-f]{64}-a{32}\.json$/u);
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
      expectJournalError("APPEND_FAILED"),
    );
    const quarantine = await readdir(join(fixture.workspace, "quarantine"));
    expect(quarantine[0]).toMatch(/^marker-0000000000000001-sha256-[0-9a-f]{64}-c{32}\.json$/u);
    expect((await fixture.journal.replay()).revision).toBe(0);

    const cleanHandle = await __testOnlyOpenGrandHallT554NativeReviewJournal({
      workspaceRoot: fixture.workspace,
      expectedScope: fixture.scope,
    }, { nowUtc: () => FIXED_TIME, quarantineToken: () => "d".repeat(32) });
    await expect(appendOne(cleanHandle)).rejects.toMatchObject(
      expectJournalError("APPEND_FAILED"),
    );
    expect((await cleanHandle.replay()).revision).toBe(0);
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

  it("rejects a replaced event filename even when copied bytes remain canonical", async () => {
    const fixture = await harness();
    await appendOne(fixture.journal);
    const path = await onlyEventPath(fixture.workspace);
    const wrong = join(fixture.workspace, "events", eventFileName(1, sha256("0")));
    await copyFile(path, wrong);
    await expect(fixture.journal.replay()).rejects.toMatchObject(
      expectJournalError("JOURNAL_INVALID"),
    );
  });
});
