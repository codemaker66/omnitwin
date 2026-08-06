import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  __testOnlyCreateLocalOfflinePreviewPermitLeaseStore,
  LocalOfflinePreviewPermitLeaseError,
} from "../local-offline-normalization-preview-permit-lease-store.js";

const roots: string[] = [];
const NOW = Date.parse("2026-07-18T12:00:00.000Z");
const DIGEST = `sha256:${"a".repeat(64)}`;
const POLICY = `sha256:${"b".repeat(64)}`;
const REQUEST = "c".repeat(32);

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "omnitwin-permit-ledger-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (value) => {
    await rm(value, { recursive: true, force: true });
  }));
});

function input(expiresAt = "2026-07-18T12:05:00.000Z") {
  return {
    permitPayloadSha256: DIGEST,
    requestId: REQUEST,
    policyDigest: POLICY,
    expiresAt,
  } as const;
}

function code(error: unknown): string | null {
  return error instanceof LocalOfflinePreviewPermitLeaseError ? error.code : null;
}

describe("durable offline-preview permit lease store", () => {
  it("allows exactly one winner when many reservations race", async () => {
    const directory = await root();
    let entropy = 0;
    const store = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW,
      randomBytes: (size) => {
        const bytes = Buffer.alloc(size);
        bytes.writeUInt32BE(entropy, Math.max(0, size - 4));
        entropy += 1;
        return bytes;
      },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 64 }, async () => await store.reserve(input())),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => code(result.reason)),
    ).toEqual(Array.from({ length: 63 }, () => "PERMIT_ALREADY_CONSUMED"));

    const files = await readdir(directory);
    expect(files.filter((name) => name.endsWith(".lease.json"))).toEqual([
      `${"a".repeat(64)}.lease.json`,
    ]);
    expect(files.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("survives process-style reconstruction and contains no source material", async () => {
    const directory = await root();
    const first = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW,
    });
    await first.reserve(input());

    const second = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW + 1,
    });
    await expect(second.reserve(input())).rejects.toMatchObject({
      code: "PERMIT_ALREADY_CONSUMED",
    });

    const bytes = await readFile(join(directory, `${"a".repeat(64)}.lease.json`));
    const text = bytes.toString("utf8");
    expect(text).toContain(DIGEST);
    expect(text).not.toMatch(/source|absolutePath|permitEnvelope|publicKey|privateKey|glb/iu);
  });

  it("retains expired tombstones so clock rollback cannot revive a permit", async () => {
    const directory = await root();
    const store = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW,
    });
    await store.reserve(input("2026-07-18T12:00:01.000Z"));

    const later = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW + 2_000,
    });
    await expect(later.audit()).resolves.toEqual({
      totalPermanentTombstones: 1,
      unexpiredTombstones: 0,
      expiredTombstonesRetained: 1,
    });

    const rolledBack = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW,
    });
    await expect(rolledBack.reserve(input("2026-07-18T12:00:01.000Z"))).rejects
      .toMatchObject({ code: "PERMIT_ALREADY_CONSUMED" });
  });

  it("fails closed on a corrupted permanent record but ignores partial temp files", async () => {
    const directory = await root();
    await writeFile(join(directory, ".interrupted.tmp"), "partial");
    await writeFile(
      join(directory, `${"a".repeat(64)}.lease.json`),
      "{\"corrupt\":true}\n",
    );
    const store = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW,
    });
    await expect(store.audit()).rejects.toMatchObject({
      code: "LEDGER_ENTRY_REJECTED",
    });
    await expect(store.reserve(input())).rejects.toMatchObject({
      code: "PERMIT_ALREADY_CONSUMED",
    });
  });

  it("rejects expired, malformed, and over-specified reservation inputs", async () => {
    const directory = await root();
    const store = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW,
    });
    await expect(store.reserve(input("2026-07-18T12:00:00.000Z"))).rejects
      .toMatchObject({ code: "LEASE_INPUT_REJECTED" });
    await expect(store.reserve({ ...input(), sourcePath: "C:\\secret.glb" } as never)).rejects
      .toMatchObject({ code: "LEASE_INPUT_REJECTED" });
    await expect(store.reserve({ ...input(), requestId: "not-canonical" })).rejects
      .toMatchObject({ code: "LEASE_INPUT_REJECTED" });
  });

  it("snapshots data properties once and rejects accessors or hidden extras", async () => {
    const directory = await root();
    const store = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW,
    });
    let getterReads = 0;
    const accessor = {
      ...input(),
      get permitPayloadSha256() {
        getterReads += 1;
        return DIGEST;
      },
    };
    await expect(store.reserve(accessor)).rejects.toMatchObject({
      code: "LEASE_INPUT_REJECTED",
    });
    expect(getterReads).toBe(0);

    const hiddenExtra = { ...input() } as Record<PropertyKey, unknown>;
    Object.defineProperty(hiddenExtra, Symbol("hidden"), {
      value: "not allowed",
      enumerable: false,
    });
    await expect(store.reserve(hiddenExtra as never)).rejects.toMatchObject({
      code: "LEASE_INPUT_REJECTED",
    });
  });

  it("cannot be redirected by a proxy whose normal property reads change", async () => {
    const directory = await root();
    const store = __testOnlyCreateLocalOfflinePreviewPermitLeaseStore({
      rootDirectory: directory,
      now: () => NOW,
    });
    let directReads = 0;
    const target = { ...input() };
    const changing = new Proxy(target, {
      get(object, property, receiver): unknown {
        if (property === "permitPayloadSha256") {
          directReads += 1;
          return directReads === 1 ? DIGEST : `sha256:${"d".repeat(64)}`;
        }
        return Reflect.get(object, property, receiver) as unknown;
      },
    });

    await store.reserve(changing);
    expect(directReads).toBe(0);
    expect(await readdir(directory)).toContain(`${"a".repeat(64)}.lease.json`);
    expect(await readdir(directory)).not.toContain(`${"d".repeat(64)}.lease.json`);
    await expect(store.reserve(changing)).rejects.toMatchObject({
      code: "PERMIT_ALREADY_CONSUMED",
    });
  });
});
