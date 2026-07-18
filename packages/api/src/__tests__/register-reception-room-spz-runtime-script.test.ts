import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageJsonScripts {
  readonly scripts?: Record<string, string>;
}

const scriptPath = fileURLToPath(new URL("../scripts/register-reception-room-spz-runtime.ts", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));

async function readScript(): Promise<string> {
  return readFile(scriptPath, "utf8");
}

async function readPackageJson(): Promise<PackageJsonScripts> {
  return JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJsonScripts;
}

describe("Reception Room SPZ runtime registration script", () => {
  it("is exposed as an operator script", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts?.["assets:register-reception-room-spz-runtime"]).toBe(
      "tsx src/scripts/register-reception-room-spz-runtime.ts",
    );
    expect(packageJson.scripts?.["assets:register-reception-room-mobile-frontier"]).toBe(
      "node --env-file=.env --import tsx src/scripts/register-reception-room-mobile-frontier.ts",
    );
    expect(packageJson.scripts?.["assets:register-reception-room-quality-frontier"]).toBe(
      "node --env-file=.env --import tsx src/scripts/register-reception-room-quality-frontier.ts",
    );
  });

  it("fails closed instead of mutating a historical runtime package", async () => {
    const source = await readScript();

    expect(source).toContain("RETIRED_RUNTIME_PACKAGE_MUTATOR");
    expect(source).toContain("assets:register-reception-room-mobile-frontier");
    expect(source).toContain("assets:register-reception-room-quality-frontier");
    expect(source).toContain("process.exitCode = 1");
    expect(source).not.toContain("createDb");
    expect(source).not.toContain("runtimePackages");
    expect(source).not.toContain("PutObjectCommand");
    expect(source).not.toMatch(/\.update\s*\(/u);
  });
});
