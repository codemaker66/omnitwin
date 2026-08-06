import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectFileSignature } from "../signature.js";
import { e57Fixture } from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeFixture(bytes: Uint8Array): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capture-signature-"));
  cleanup.push(root);
  const path = join(root, "cloud.e57");
  await writeFile(path, bytes);
  return path;
}

describe("inspectFileSignature", () => {
  it("uses the shared E57 parser for a valid physical header", async () => {
    const path = await writeFixture(e57Fixture());
    await expect(inspectFileSignature(path, 48)).resolves.toMatchObject({
      format: "e57",
      e57Header: {
        versionMajor: 1,
        versionMinor: 0,
        physicalLengthBytes: 48,
        pageSizeBytes: 1024,
        fileLengthMatchesHeader: true,
      },
    });
  });

  it("preserves rejection of a declared physical-length mismatch", async () => {
    const bytes = e57Fixture();
    bytes.writeBigUInt64LE(49n, 16);
    const path = await writeFixture(bytes);
    await expect(inspectFileSignature(path, 48)).rejects.toThrow(
      `ASTM E57 physical length does not match file length: ${path}`,
    );
  });
});
