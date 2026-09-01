import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeRoomManifest, type RoomManifestEntry } from "../stage.js";

// The generated module is the contract between this tool and the web package.
// A field that exists on the bundle but never reaches the generated file is
// invisible to the runtime, so the writer is pinned here, not just the bundle.
function entry(): RoomManifestEntry {
  return {
    roomSlug: "reception-room",
    captureDir: "scan_output_1_reception",
    splatType: ".sog",
    totalSplats: 3933570,
    totalLevels: 4,
    splatsByLevel: [260867, 522118, 1045287, 2105298],
    finestLevel: 4,
    finestLevelSplats: 2105298,
    tiles: [
      { file: "0_0.sog", bytes: 10, sha256: "a".repeat(64), lodLevel: 1, isEnvironment: false },
      { file: "env.sog", bytes: 5, sha256: "b".repeat(64), lodLevel: null, isEnvironment: true },
    ],
    totalBytes: 15,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    extentM: [9.7, 3.7, 12.4],
    spawn: null,
    bounds: null,
    eyeHeightM: null,
    alignmentConfidence: "confident",
    alignmentNote: "fixture",
  };
}

describe("writeRoomManifest", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("emits per-level splat counts and the finest level into the generated module", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-manifest-"));
    const out = join(dir, "bundles.ts");
    writeRoomManifest(out, [entry()]);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("readonly splatsByLevel: readonly number[];");
    expect(text).toContain("readonly finestLevel: number;");
    expect(text).toContain("readonly finestLevelSplats: number;");
    expect(text).toMatch(/"splatsByLevel": \[\s*260867,\s*522118,\s*1045287,\s*2105298\s*\]/);
    expect(text).toContain('"finestLevelSplats": 2105298');
  });
});
