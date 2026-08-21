import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RUN_ENABLED =
  process.env["RUN_HISTORICAL_RUNTIME_PROFILE_0067_POSTGRES"] === "1";
const postgresDescribe = RUN_ENABLED ? describe : describe.skip;
const apiDirectory = resolve(import.meta.dirname, "../..");

function runVerifier(): Promise<{
  readonly code: number;
  readonly output: string;
}> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [
        resolve(apiDirectory, "node_modules/tsx/dist/cli.mjs"),
        "src/scripts/verify-historical-runtime-reviewed-profile-0067-postgres.ts",
      ],
      {
        cwd: apiDirectory,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", rejectRun);
    child.once("close", (code) => {
      resolveRun({ code: code ?? 1, output });
    });
  });
}

postgresDescribe("historical-runtime 0067 self-contained PostgreSQL gate", () => {
  it("replays pinned PostgreSQL 16/17 and proves reviewed-profile authority", async () => {
    const result = await runVerifier();
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("PostgreSQL 16 16.14");
    expect(result.output).toContain("PostgreSQL 17 17.11");
    expect(result.output).toContain("strict body parity");
    expect(result.output).toContain("0066-to-0067 rollback restoration");
    expect(result.output).toContain("plpgsql_check 13 contexts");
    expect(result.output).toContain("DB-observed protected-row two-way lock order");
    expect(result.output).toContain("post-lock fresh-clock currentness");
    expect(result.output).toContain(
      "HISTORICAL_RUNTIME_REVIEWED_PROFILE_0067_POSTGRES_OK",
    );
  }, 20 * 60_000);
});
