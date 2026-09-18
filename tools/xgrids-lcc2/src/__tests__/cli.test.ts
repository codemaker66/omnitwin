import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  read: vi.fn(() => { throw new Error("Retired command attempted to read a file."); }),
  write: vi.fn(() => { throw new Error("Retired command attempted to mutate a file."); }),
  spawn: vi.fn(() => { throw new Error("Retired command attempted to launch a builder."); }),
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  readFileSync: boundary.read,
  existsSync: boundary.read,
  statSync: boundary.read,
  copyFileSync: boundary.write,
  mkdirSync: boundary.write,
  renameSync: boundary.write,
  rmSync: boundary.write,
  writeFileSync: boundary.write,
}));
vi.mock("node:child_process", () => ({ spawnSync: boundary.spawn }));

describe("operator CLI", () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it.each([
    ["lod"],
    ["--", "lod", "--out", "staging", "--manifest", "bundles.ts", "--build-lod", "legacy-builder"],
  ])("rejects retired LOD generation without accessing files or executing a builder: %j", async (...args) => {
    process.argv = [process.execPath, "cli.ts", ...args];
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await import("../cli.js");

    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.map(([text]) => text).join("")).toContain(
      "The lcc2 lod command is retired. Use lcc2 stage to stage canonical capture tiles for native Three.js rendering.",
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(boundary.read).not.toHaveBeenCalled();
    expect(boundary.write).not.toHaveBeenCalled();
    expect(boundary.spawn).not.toHaveBeenCalled();
  });

  it("advertises the supported measure and stage commands only", async () => {
    process.argv = [process.execPath, "cli.ts"];
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await import("../cli.js");

    const help = stderr.mock.calls.map(([text]) => text).join("");
    expect(process.exitCode).toBe(1);
    expect(help).toContain("lcc2 measure");
    expect(help).toContain("lcc2 stage");
    expect(help).not.toContain("lcc2 lod");
    expect(help).not.toContain("--build-lod");
  });
});
