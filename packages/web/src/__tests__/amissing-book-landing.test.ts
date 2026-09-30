import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";

// The CMS transformer is a standalone Node tool. Run its native contract suite
// from Vitest too, so the normal web/CI test command cannot miss these checks.
it("preserves the landing's unrelated content and rejects CMS source drift", () => {
  const contractTests = join(import.meta.dirname, "../../scripts/integrate-amissing-book-landing.test.mjs");
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", contractTests], {
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});
