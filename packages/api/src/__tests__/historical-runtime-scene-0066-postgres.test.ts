import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RUN_ENABLED =
  process.env["RUN_HISTORICAL_RUNTIME_SCENE_0066_POSTGRES"] === "1";
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
        "src/scripts/verify-historical-runtime-scene-0066-postgres.ts",
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

postgresDescribe("historical-runtime 0066 self-contained PostgreSQL gate", () => {
  it("replays pinned PostgreSQL 16/17 and proves local plus fail-closed production paths", async () => {
    const result = await runVerifier();
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("PostgreSQL 16 16.14");
    expect(result.output).toContain("PostgreSQL 17 17.11");
    expect(result.output).toContain("four-body parity");
    expect(result.output).toContain("HISTORICAL_RUNTIME_SCENE_0066_POSTGRES_OK");
  }, 15 * 60_000);
});
