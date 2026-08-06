import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  commitAtomicOutputDirectory,
  parseCliArguments,
  renameDirectoryWithRetry,
  startCleanupWatchdog,
  verifyPinnedProfile,
} from "../run_captured_quality_comparison.mjs";

function absoluteFixtureArguments(root) {
  return [
    "--repo-root",
    path.join(root, "repo"),
    "--quality-root",
    path.join(root, "quality"),
    "--mobile-root",
    path.join(root, "mobile"),
    "--output-root",
    path.join(root, "output"),
    "--request-id",
    "capture-20260718-001",
  ];
}

test("parseCliArguments accepts one absolute value for every required option", () => {
  const root = path.resolve(tmpdir(), "captured-quality-cli");
  const parsed = parseCliArguments([
    ...absoluteFixtureArguments(root),
    "--verify-only",
  ]);

  assert.deepEqual(parsed, {
    help: false,
    verifyOnly: true,
    repoRoot: path.join(root, "repo"),
    qualityRoot: path.join(root, "quality"),
    mobileRoot: path.join(root, "mobile"),
    outputRoot: path.join(root, "output"),
    requestId: "capture-20260718-001",
  });
});

test("parseCliArguments permits help without the execution arguments", () => {
  assert.deepEqual(parseCliArguments(["--help"]), {
    help: true,
    verifyOnly: false,
  });
});

for (const [label, mutate, pattern] of [
  [
    "missing option",
    (args) => args.slice(0, -2),
    /missing required option: --request-id/i,
  ],
  [
    "unknown option",
    (args) => [...args, "--surprise"],
    /unknown option: --surprise/i,
  ],
  [
    "duplicate option",
    (args) => [...args, "--repo-root", args[1]],
    /duplicate option: --repo-root/i,
  ],
  [
    "missing value",
    (args) => [...args.slice(0, 1), "--quality-root", ...args.slice(2)],
    /option --repo-root requires exactly one value/i,
  ],
  [
    "relative path",
    (args) => args.map((value, index) => (index === 1 ? "." : value)),
    /--repo-root must be an absolute path/i,
  ],
  [
    "unsafe request id",
    (args) => args.map((value, index) =>
      index === args.length - 1 ? "..\\outside" : value
    ),
    /--request-id must match/i,
  ],
  [
    "repeated flag",
    (args) => [...args, "--verify-only", "--verify-only"],
    /duplicate option: --verify-only/i,
  ],
]) {
  test(`parseCliArguments rejects ${label}`, () => {
    const root = path.resolve(tmpdir(), "captured-quality-cli");
    assert.throws(() => parseCliArguments(mutate(absoluteFixtureArguments(root))), pattern);
  });
}

test("verifyPinnedProfile verifies exact file bytes and returns stable bindings", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "captured-quality-sources-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const first = Buffer.from("quality-one");
  const second = Buffer.from("quality-two");
  await writeFile(path.join(root, "one.sog"), first);
  await writeFile(path.join(root, "two.sog"), second);

  const assets = [
    {
      fileName: "one.sog",
      sizeBytes: first.byteLength,
      sha256: createHash("sha256").update(first).digest("hex"),
    },
    {
      fileName: "two.sog",
      sizeBytes: second.byteLength,
      sha256: createHash("sha256").update(second).digest("hex"),
    },
  ];

  assert.deepEqual(await verifyPinnedProfile(root, "quality", assets), [
    {
      candidateId: "quality",
      fileName: "one.sog",
      sizeBytes: first.byteLength,
      sha256: assets[0].sha256,
    },
    {
      candidateId: "quality",
      fileName: "two.sog",
      sizeBytes: second.byteLength,
      sha256: assets[1].sha256,
    },
  ]);
});

test("verifyPinnedProfile rejects a missing pinned source", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "captured-quality-missing-"));
  t.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(
    verifyPinnedProfile(root, "mobile", [
      { fileName: "missing.spz", sizeBytes: 1, sha256: "00".repeat(32) },
    ]),
    /mobile source missing: missing\.spz/i,
  );
});

test("verifyPinnedProfile rejects size and digest drift", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "captured-quality-drift-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(path.join(root, "tile.spz"), "actual");

  await assert.rejects(
    verifyPinnedProfile(root, "mobile", [
      { fileName: "tile.spz", sizeBytes: 99, sha256: "00".repeat(32) },
    ]),
    /mobile source size mismatch for tile\.spz/i,
  );

  await assert.rejects(
    verifyPinnedProfile(root, "mobile", [
      {
        fileName: "tile.spz",
        sizeBytes: Buffer.byteLength("actual"),
        sha256: "00".repeat(32),
      },
    ]),
    /mobile source sha-256 mismatch for tile\.spz/i,
  );
});

test("verifyPinnedProfile refuses pinned names that escape the named root", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "captured-quality-escape-"));
  t.after(() => rm(parent, { force: true, recursive: true }));
  const root = path.join(parent, "root");
  await mkdir(root);
  await writeFile(path.join(parent, "outside.sog"), "outside");

  await assert.rejects(
    verifyPinnedProfile(root, "quality", [
      {
        fileName: "../outside.sog",
        sizeBytes: Buffer.byteLength("outside"),
        sha256: createHash("sha256").update("outside").digest("hex"),
      },
    ]),
    /quality source path escapes its named root/i,
  );
});

test("commitAtomicOutputDirectory stops the active watchdog before a real directory rename", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "captured-quality-commit-"));
  t.after(() => rm(parent, { force: true, recursive: true }));
  const temporary = path.join(parent, ".request.tmp-123");
  const final = path.join(parent, "request");
  await mkdir(temporary);
  await writeFile(path.join(temporary, "payload.json"), "{\"complete\":true}\n");
  const watchdog = await startCleanupWatchdog(temporary);

  await commitAtomicOutputDirectory(temporary, final, watchdog);

  assert.equal(await readFile(path.join(final, "payload.json"), "utf8"), "{\"complete\":true}\n");
  await assert.rejects(lstat(temporary), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(final, ".captured-quality-owner.json")), { code: "ENOENT" });
});

test("renameDirectoryWithRetry retries bounded transient Windows rename failures", async () => {
  let attempts = 0;
  const waits = [];
  await renameDirectoryWithRetry("temporary", "final", {
    pathExists: async () => false,
    wait: async (milliseconds) => waits.push(milliseconds),
    renameDirectory: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("simulated Windows handle contention");
        error.code = attempts === 1 ? "EPERM" : "EBUSY";
        throw error;
      }
    },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [25, 75]);
});

test("renameDirectoryWithRetry never attempts to replace an existing final directory", async () => {
  let renameAttempted = false;
  await assert.rejects(
    renameDirectoryWithRetry("temporary", "final", {
      pathExists: async () => true,
      wait: async () => undefined,
      renameDirectory: async () => {
        renameAttempted = true;
      },
    }),
    /will not be replaced/i,
  );
  assert.equal(renameAttempted, false);
});

test("commitAtomicOutputDirectory stops before rename when cancellation arrives with watchdog shutdown", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "captured-quality-cancel-before-"));
  t.after(() => rm(parent, { force: true, recursive: true }));
  const temporary = path.join(parent, ".request.tmp-456");
  const final = path.join(parent, "request");
  const markerPath = path.join(temporary, ".captured-quality-owner.json");
  await mkdir(temporary);
  await writeFile(markerPath, "{\"owned\":true}\n");
  await writeFile(path.join(temporary, "payload.json"), "{\"complete\":true}\n");
  const cancellation = new AbortController();
  let renameAttempted = false;
  const watchdog = {
    markerPath,
    async stop() {
      cancellation.abort(new Error("cancelled before rename"));
    },
  };

  await assert.rejects(
    commitAtomicOutputDirectory(
      temporary,
      final,
      watchdog,
      cancellation.signal,
      {
        renameDirectory: async () => {
          renameAttempted = true;
        },
      },
    ),
    /cancelled before rename/i,
  );

  assert.equal(renameAttempted, false);
  assert.equal((await lstat(temporary)).isDirectory(), true);
  await assert.rejects(lstat(final), { code: "ENOENT" });
  await assert.rejects(lstat(markerPath), { code: "ENOENT" });
});

test("commitAtomicOutputDirectory removes its exact committed directory when cancellation arrives after rename", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "captured-quality-cancel-after-"));
  t.after(() => rm(parent, { force: true, recursive: true }));
  const temporary = path.join(parent, ".request.tmp-789");
  const final = path.join(parent, "request");
  const markerPath = path.join(temporary, ".captured-quality-owner.json");
  await mkdir(temporary);
  await writeFile(markerPath, "{\"owned\":true}\n");
  await writeFile(path.join(temporary, "payload.json"), "{\"complete\":true}\n");
  const cancellation = new AbortController();
  const watchdog = { markerPath, async stop() {} };

  await assert.rejects(
    commitAtomicOutputDirectory(
      temporary,
      final,
      watchdog,
      cancellation.signal,
      {
        async renameDirectory(source, target) {
          await rename(source, target);
          cancellation.abort(new Error("cancelled after rename"));
        },
      },
    ),
    /cancelled after rename/i,
  );

  await assert.rejects(lstat(temporary), { code: "ENOENT" });
  await assert.rejects(lstat(final), { code: "ENOENT" });
});

test("post-rename cancellation never removes a replacement final directory with a different identity", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "captured-quality-cancel-foreign-"));
  t.after(() => rm(parent, { force: true, recursive: true }));
  const temporary = path.join(parent, ".request.tmp-foreign");
  const final = path.join(parent, "request");
  const markerPath = path.join(temporary, ".captured-quality-owner.json");
  await mkdir(temporary);
  await writeFile(markerPath, "{\"owned\":true}\n");
  await writeFile(path.join(temporary, "payload.json"), "{\"complete\":true}\n");
  const cancellation = new AbortController();
  const watchdog = { markerPath, async stop() {} };

  await assert.rejects(
    commitAtomicOutputDirectory(
      temporary,
      final,
      watchdog,
      cancellation.signal,
      {
        async renameDirectory(source, target) {
          await rename(source, target);
          await rm(target, { force: true, recursive: true });
          await mkdir(target);
          await writeFile(path.join(target, "foreign.txt"), "not runner-owned\n");
          cancellation.abort(new Error("cancelled after replacement"));
        },
      },
    ),
    /identity changed during commit/i,
  );

  assert.equal(await readFile(path.join(final, "foreign.txt"), "utf8"), "not runner-owned\n");
});
