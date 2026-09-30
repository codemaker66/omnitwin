import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";

it("validates saved game state and guards the imported bootstrap contract", () => {
  const contractTests = join(import.meta.dirname, "../../scripts/amissing-book/resume-runtime.test.mjs");
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", contractTests], {
    encoding: "utf8", timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});
