import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function resolvePython(): string | null {
  for (const candidate of [process.env.PYTHON, "python", "python3"]) {
    if (candidate === undefined || candidate.trim() === "") continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

describe("E57 reconstruction script guards", () => {
  const python = resolvePython();

  it.skipIf(python === null)(
    "passes the standard-library stage, provenance, and path-overlap unit suite",
    () => {
      const scriptsDir = fileURLToPath(new URL("../../e57-scripts/", import.meta.url));
      const result = spawnSync(
        python ?? "python",
        ["-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    },
  );
});
