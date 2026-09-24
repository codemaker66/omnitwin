import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Static-file caching in vercel.json. Without a rule Vercel serves public files
// with `max-age=0, must-revalidate`, so every visit re-validated every image
// and furniture model before use. Immutable caching is only safe for content
// whose URL changes when its bytes do; the rest may be reused briefly and
// refreshed in the background. HTML must never be cached: it names the hashed
// bundles of the current deploy.
// ---------------------------------------------------------------------------

interface VercelHeaderRule {
  readonly source: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

const root = join(import.meta.dirname, "..", "..");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  readonly headers: readonly VercelHeaderRule[];
};

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATING = "public, max-age=3600, stale-while-revalidate=604800";

function readGroup(source: string, start: number): { readonly body: string; readonly end: number } {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(start + 1, index), end: index + 1 };
    }
  }
  throw new Error(`Unbalanced group in ${source}`);
}

/** The subset of Vercel's path-to-regexp syntax these rules use. */
function sourcePattern(source: string): RegExp {
  let pattern = "";
  for (let index = 0; index < source.length;) {
    const named = /^:[A-Za-z_]\w*/u.exec(source.slice(index));
    if (named !== null) {
      index += named[0].length;
      if (source[index] === "(") {
        const group = readGroup(source, index);
        pattern += `(${group.body})`;
        index = group.end;
      } else {
        pattern += "([^/]+)";
      }
    } else if (source[index] === "(") {
      const group = readGroup(source, index);
      pattern += `(${group.body})`;
      index = group.end;
    } else {
      pattern += (source[index] ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      index += 1;
    }
  }
  return new RegExp(`^${pattern}$`, "u");
}

function cacheControl(path: string): string[] {
  return vercel.headers
    .filter((rule) => sourcePattern(rule.source).test(path))
    .flatMap((rule) => rule.headers.filter((header) => header.key.toLowerCase() === "cache-control"))
    .map((header) => header.value);
}

function publicFiles(directory = join(root, "public")): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? publicFiles(join(directory, entry.name))
    : [`/${relative(join(root, "public"), join(directory, entry.name)).replace(/\\/gu, "/")}`]);
}

describe("vercel.json static caching", () => {
  it("caches versioned furniture models and hash-named voice clips immutably", () => {
    expect(cacheControl("/models/furniture/bar-counter/v1/model.glb")).toEqual([IMMUTABLE]);
    expect(cacheControl("/models/furniture/burgess-turini-18-3/v1/chair.glb")).toEqual([IMMUTABLE]);
    expect(cacheControl("/trades-house-media/voice/00189cf6e65dbab6.mp3")).toEqual([IMMUTABLE]);
    expect(cacheControl("/assets/index-CZlYaL3j.js")).toEqual([IMMUTABLE]);
  });

  it("only lets unhashed files be reused briefly", () => {
    for (const path of ["/trades-house-media/voice/manifest.json", "/images/rooms/supplied/grand-hall.jpeg",
      "/images/venue/ladder/grand-hall-room-1535.webp", "/rooms/grand-hall.jpg", "/room-plans/grand-hall.png",
      "/demo/cover.webp", "/trades-house-media/assets/achievement.png", "/th-building.png", "/favicon.svg"]) {
      expect(cacheControl(path), path).toEqual([REVALIDATING]);
    }
    expect(cacheControl("/models/furniture/README.md")).toEqual([]);
    expect(cacheControl("/trades-house-media/voice/not-a-hash.mp3")).toEqual([]);
  });

  it("never caches the app document or its routes", () => {
    for (const path of ["/", "/index.html", "/plan", "/room/grand-hall", "/images", "/diary"]) {
      expect(cacheControl(path), path).toEqual([]);
    }
  });

  it("gives every published file at most one policy, immutable only where its URL is versioned", () => {
    const files = publicFiles();
    expect(files.length).toBeGreaterThan(100);
    for (const path of files) {
      const values = cacheControl(path);
      expect(values.length, path).toBeLessThanOrEqual(1);
      if (values[0] === IMMUTABLE) {
        expect(path, path).toMatch(/^\/(?:models\/furniture\/[^/]+\/v\d+\/|trades-house-media\/voice\/[0-9a-f]{16}\.mp3$)/u);
      }
    }
    const voiceClips = files.filter((path) => path.startsWith("/trades-house-media/voice/") && path.endsWith(".mp3"));
    expect(voiceClips.length).toBeGreaterThan(0);
    for (const clip of voiceClips) expect(cacheControl(clip), clip).toEqual([IMMUTABLE]);
  });
});
