import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST,
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../historical-runtime-scene-map-parser-implementation-manifest.generated.js";
import {
  buildSceneMapParserImplementationManifest,
  normalizeSceneMapParserManifestText,
} from "./helpers/historical-runtime-scene-map-parser-implementation-manifest.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

describe("historical runtime Scene parser implementation manifest", () => {
  it("pins the exact sorted transitive runtime source and build-input closure", () => {
    const generated = buildSceneMapParserImplementationManifest(REPO_ROOT);
    expect(HISTORICAL_RUNTIME_SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST)
      .toEqual(generated.body);
    expect(HISTORICAL_RUNTIME_SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_DIGEST)
      .toBe(generated.digest);
    expect(generated.body.sources.map((source) => source.path)).toEqual(
      [...generated.body.sources.map((source) => source.path)].sort(
        (left, right) => Buffer.from(left).compare(Buffer.from(right)),
      ),
    );
    expect(new Set(generated.body.sources.map((source) => source.path)).size)
      .toBe(generated.body.sources.length);
    expect(generated.body.sources.some((source) =>
      source.path.endsWith("implementation-manifest.generated.ts")
    )).toBe(false);
  });

  it("normalizes checkout line endings without normalizing source text", () => {
    const lf = new TextEncoder().encode("alpha\nbeta\n");
    const crlf = new TextEncoder().encode("alpha\r\nbeta\r\n");
    const cr = new TextEncoder().encode("alpha\rbeta\r");
    expect(normalizeSceneMapParserManifestText(lf)).toBe("alpha\nbeta\n");
    expect(normalizeSceneMapParserManifestText(crlf)).toBe("alpha\nbeta\n");
    expect(normalizeSceneMapParserManifestText(cr)).toBe("alpha\nbeta\n");
  });

  it("rejects BOM-prefixed and invalid UTF-8 sources", () => {
    expect(() => normalizeSceneMapParserManifestText(
      Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    )).toThrow(/BOM-free/u);
    expect(() => normalizeSceneMapParserManifestText(
      Uint8Array.from([0xc3, 0x28]),
    )).toThrow(/strict UTF-8/u);
  });
});
