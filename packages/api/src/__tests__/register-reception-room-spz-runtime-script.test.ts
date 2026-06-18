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
  });

  it("uses the SPZ visual export as the primary visual layer", async () => {
    const source = await readScript();
    const roomChunkMatch = /const ROOM_CHUNK_FILES = \[([\s\S]*?)\] as const;/u.exec(source);
    const roomChunkBlock = roomChunkMatch?.[1] ?? "";

    expect(source).toContain("reception-room_xgrids_lcc2_spz_visual");
    expect(source).toContain("lcc2-result-spz/data/3dgs");
    expect(source).toContain('const PRIMARY_FILE = "0_0.spz";');
    expect(source).toContain('fileExt: ".spz"');
    expect(source).toContain('evidenceStatus: "unverified"');
    expect(source).toContain('runtimeStatus: "usable"');
    expect(source).toContain('runtimeStatus: "internal_ready"');
    expect(source).toContain("Runtime asset loaded, not yet verified/signed.");

    expect(roomChunkBlock).toContain('"0_0.spz"');
    expect(roomChunkBlock).toContain('"0_13_0_0.spz"');
    expect(roomChunkBlock).not.toContain("env.spz");
    expect(source).not.toContain("spz_with_mesh");
    expect(source).not.toContain("textSplats");
  });
});
