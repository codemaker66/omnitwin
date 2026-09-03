import { describe, expect, it } from "vitest";
import {
  deriveRoomCamera,
  roomAlignmentIsConfident,
  roomSplatBundle,
  roomSplatServedBytes,
  roomSplatServedSplats,
  roomSplatServedTileCount,
  roomSplatTileUrls,
  roomSplatTotalBytes,
  roomsWithSplatBundles,
  splatBaseUrl,
  splatSourcesForBundle,
  walkPoseForBundle,
  WALK_EYE_HEIGHT_M,
  type GeneratedRoomSplatBundle,
} from "../room-splat-bundles.js";

const NO_BASE_URL: string | undefined = undefined;

describe("roomsWithSplatBundles", () => {
  it("covers every Trades Hall room captured on the XGRIDS pass", () => {
    expect([...roomsWithSplatBundles()].sort()).toEqual([
      "deacon-conveners-room",
      "grand-hall",
      "lady-convenors-room",
      "north-gallery",
      "reception-room",
      "robert-adam-room",
      "saloon",
      "south-gallery",
    ]);
  });
});

describe("splatBaseUrl", () => {
  it("falls back to the dev-served root when nothing is configured", () => {
    expect(splatBaseUrl(NO_BASE_URL)).toBe("/splats");
  });

  it("uses the configured production origin", () => {
    expect(splatBaseUrl("https://cdn.example.com/v1"))
      .toBe("https://cdn.example.com/v1");
  });

  it("trims a trailing slash so joined URLs never double the separator", () => {
    expect(splatBaseUrl("https://cdn.example.com/v1/"))
      .toBe("https://cdn.example.com/v1");
  });

  it("ignores an all-whitespace override rather than emitting an empty base", () => {
    expect(splatBaseUrl("   ")).toBe("/splats");
  });
});

describe("roomSplatTileUrls", () => {
  it("namespaces tiles by venue and room", () => {
    const urls = roomSplatTileUrls("reception-room", NO_BASE_URL);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^\/splats\/trades-hall\/reception-room\/[^/]+\.sog$/u);
    }
  });

  it("serves only the finest LOD level, since every level is a complete copy of the room", () => {
    // An XGRIDS LCC2 octree is not progressive detail: each level is the whole
    // room at a different density. Drawing more than one level draws the room
    // more than once. The Grand Hall ships 24 tiles across five levels; only
    // the 11 finest-level tiles plus the sky shell may reach the renderer.
    const bundle = roomSplatBundle("grand-hall");
    const finest = bundle?.finestLevel ?? 0;
    const urls = roomSplatTileUrls("grand-hall", NO_BASE_URL);
    const served = (bundle?.tiles ?? []).filter(
      (tile) => tile.isEnvironment || tile.lodLevel === finest,
    );
    expect(finest).toBe(5);
    expect(urls).toHaveLength(12);
    expect(urls).toEqual(served.map((tile) => `/splats/trades-hall/grand-hall/${tile.file}`));
  });

  it("never serves a coarser level alongside the finest one", () => {
    for (const room of roomsWithSplatBundles()) {
      const bundle = roomSplatBundle(room);
      const finest = bundle?.finestLevel ?? 0;
      const byFile = new Map((bundle?.tiles ?? []).map((tile) => [tile.file, tile]));
      for (const url of roomSplatTileUrls(room, NO_BASE_URL)) {
        const tile = byFile.get(url.split("/").pop() ?? "");
        expect(tile, `${room}: ${url}`).toBeDefined();
        if (tile !== undefined && !tile.isEnvironment) {
          expect(tile.lodLevel, `${room}: ${url}`).toBe(finest);
        }
      }
    }
  });

  it("puts the environment shell last, since it is sky and not room", () => {
    const urls = roomSplatTileUrls("reception-room", NO_BASE_URL);
    expect(urls.at(-1)?.endsWith("/env.sog")).toBe(true);
    expect(urls.slice(0, -1).every((url) => !url.endsWith("/env.sog"))).toBe(true);
  });

  it("returns nothing for a room with no capture, rather than a broken URL", () => {
    expect(roomSplatTileUrls("no-such-room", NO_BASE_URL)).toEqual([]);
  });
});

describe("roomSplatServedSplats", () => {
  it("counts only the finest level, which is the whole reconstruction", () => {
    // The XGRIDS build report for this capture records 6,019,684 Gaussians;
    // the sum over every level (11,487,038) is what the site used to claim.
    expect(roomSplatServedSplats("grand-hall")).toBe(6_019_684);
    expect(roomSplatServedSplats("grand-hall")).toBeLessThan(
      roomSplatBundle("grand-hall")?.totalSplats ?? 0,
    );
  });

  it("is zero for an unknown room", () => {
    expect(roomSplatServedSplats("no-such-room")).toBe(0);
  });
});

describe("roomSplatServedTileCount", () => {
  it("counts the tiles a viewer fetches, sky shell included", () => {
    expect(roomSplatServedTileCount("grand-hall")).toBe(12);
    expect(roomSplatServedTileCount("grand-hall")).toBe(roomSplatTileUrls("grand-hall", NO_BASE_URL).length);
  });

  it("is zero for an unknown room", () => {
    expect(roomSplatServedTileCount("no-such-room")).toBe(0);
  });
});

describe("roomSplatServedBytes", () => {
  it("sums only the tiles that will actually be fetched", () => {
    const bundle = roomSplatBundle("grand-hall");
    const finest = bundle?.finestLevel ?? 0;
    const expected = (bundle?.tiles ?? [])
      .filter((tile) => tile.isEnvironment || tile.lodLevel === finest)
      .reduce((sum, tile) => sum + tile.bytes, 0);
    expect(roomSplatServedBytes("grand-hall")).toBe(expected);
    expect(roomSplatServedBytes("grand-hall")).toBeLessThan(roomSplatTotalBytes("grand-hall"));
  });

  it("is zero for an unknown room", () => {
    expect(roomSplatServedBytes("no-such-room")).toBe(0);
  });
});

describe("roomSplatTotalBytes", () => {
  it("sums to the staged payload for a known room", () => {
    expect(roomSplatTotalBytes("reception-room")).toBeGreaterThan(60_000_000);
  });

  it("is zero for an unknown room", () => {
    expect(roomSplatTotalBytes("no-such-room")).toBe(0);
  });
});

describe("generated transforms", () => {
  it("never scales, because captures and the scene are both metric", () => {
    for (const slug of roomsWithSplatBundles()) {
      expect(roomSplatBundle(slug)?.transform.scale).toBe(1);
    }
  });

  it("rotates every room from XGRIDS Z-up into the scene's Y-up", () => {
    for (const slug of roomsWithSplatBundles()) {
      const rotation = roomSplatBundle(slug)?.transform.rotation;
      expect(rotation?.[0]).toBeCloseTo(-Math.PI / 2, 6);
      expect(rotation?.[1]).toBe(0);
      expect(rotation?.[2]).toBe(0);
    }
  });
});

describe("deriveRoomCamera", () => {
  it("stands inside the room rather than beyond its far wall", () => {
    // Reception's real measured extent. Framing the whole room would need
    // 19.0 m of standoff against a 14.7 m depth, which is outside the room.
    const camera = deriveRoomCamera([11.24, 3.66, 14.72]);
    expect(camera.position[2]).toBeLessThan(14.72 / 2);
  });

  it("stays inside even a long narrow room", () => {
    const camera = deriveRoomCamera([4, 3, 30]);
    expect(camera.position[2]).toBeLessThan(15);
    expect(Math.abs(camera.target[2])).toBeLessThan(15);
  });

  it("gives a bigger room more standoff, up to its own walls", () => {
    const small = deriveRoomCamera([6, 3, 6]);
    const large = deriveRoomCamera([24, 3, 20]);
    expect(large.position[2]).toBeGreaterThan(small.position[2]);
  });

  it("looks across the room rather than straight at the near wall", () => {
    const camera = deriveRoomCamera([11.24, 3.66, 14.72]);
    expect(camera.target[2]).toBeLessThan(camera.position[2]);
  });

  it("keeps the camera below the ceiling of a low room", () => {
    const camera = deriveRoomCamera([8, 2.2, 8]);
    expect(camera.position[1]).toBeLessThan(2.2);
    expect(camera.target[1]).toBeLessThan(2.2);
  });

  it("holds the target inside the walls so a drag cannot leave the room", () => {
    const camera = deriveRoomCamera([10, 3, 6]);
    expect(camera.targetBounds.min[0]).toBeGreaterThan(-5);
    expect(camera.targetBounds.max[0]).toBeLessThan(5);
    expect(camera.targetBounds.min[2]).toBeGreaterThan(-3);
    expect(camera.targetBounds.max[2]).toBeLessThan(3);
  });

  it("survives a degenerate extent without producing NaN", () => {
    const camera = deriveRoomCamera([0, 0, 0]);
    expect(Number.isFinite(camera.position[2])).toBe(true);
    expect(Number.isFinite(camera.maxDistance)).toBe(true);
  });
});

describe("roomAlignmentIsConfident", () => {
  it("reports the rooms whose captures measured cleanly", () => {
    expect(roomAlignmentIsConfident("reception-room")).toBe(true);
    expect(roomAlignmentIsConfident("deacon-conveners-room")).toBe(true);
  });

  it("withholds confidence from whole-floor captures pending review", () => {
    expect(roomAlignmentIsConfident("robert-adam-room")).toBe(false);
  });

  it("is not confident about a room it has never heard of", () => {
    expect(roomAlignmentIsConfident("no-such-room")).toBe(false);
  });
});

describe("walkPoseForBundle", () => {
  const grandHall = roomSplatBundle("grand-hall");
  if (grandHall === null) throw new Error("the Grand Hall bundle is the fixture");

  it("stands the visitor at eye height where the scanner walked, not at the scanner's pole height", () => {
    // The capture records the pole: spawn y 3 m in a 2.4-3.6 m band.
    expect(grandHall.spawn?.position[1]).toBe(3);
    const pose = walkPoseForBundle(grandHall);
    expect(pose).not.toBeNull();
    expect(pose?.spawn.position[1]).toBe(WALK_EYE_HEIGHT_M);
    expect(pose?.bounds.min[1]).toBeLessThan(WALK_EYE_HEIGHT_M);
    expect(pose?.bounds.max[1]).toBeGreaterThan(WALK_EYE_HEIGHT_M);
    expect((pose?.bounds.max[1] ?? 0) - (pose?.bounds.min[1] ?? 0)).toBeLessThanOrEqual(0.6);
  });

  it("keeps the walk's floor plan and heading exactly as captured", () => {
    const pose = walkPoseForBundle(grandHall);
    expect(pose?.spawn.position[0]).toBe(grandHall.spawn?.position[0]);
    expect(pose?.spawn.position[2]).toBe(grandHall.spawn?.position[2]);
    expect(pose?.spawn.yaw).toBe(grandHall.spawn?.yaw);
    expect(pose?.bounds.min[0]).toBe(grandHall.bounds?.min[0]);
    expect(pose?.bounds.max[2]).toBe(grandHall.bounds?.max[2]);
  });

  it("lowers the eye under a low ceiling rather than putting the visitor's head in it", () => {
    const low: GeneratedRoomSplatBundle = { ...grandHall, extentM: [9.7, 1.9, 5.6] };
    const pose = walkPoseForBundle(low);
    expect(pose?.spawn.position[1]).toBeLessThan(WALK_EYE_HEIGHT_M);
    expect(pose?.spawn.position[1]).toBeGreaterThan(0.5);
    expect(pose?.bounds.max[1]).toBeLessThan(1.9);
  });

  it("is null for a capture that shipped no walk", () => {
    expect(walkPoseForBundle({ ...grandHall, spawn: null, bounds: null })).toBeNull();
  });
});

describe("splatSourcesForBundle", () => {
  const base = "/splats/trades-hall/saloon";
  const real = roomSplatBundle("grand-hall");
  if (real === null) throw new Error("the Grand Hall bundle is the fixture's template");
  const bundle: GeneratedRoomSplatBundle = {
    ...real,
    roomSlug: "saloon",
    finestLevel: 2,
    tiles: [
      { file: "0_0.sog", bytes: 1, sha256: "a".repeat(64), lodLevel: 1, isEnvironment: false },
      {
        file: "0_1_0.sog",
        bytes: 2,
        sha256: "b".repeat(64),
        lodLevel: 2,
        isEnvironment: false,
        lod: {
          file: "lod/0_1_0-lod.rad",
          bytes: 3,
          sha256: "c".repeat(64),
          splats: 9,
          chunks: [{ file: "lod/0_1_0-lod-0.radc", bytes: 4, sha256: "d".repeat(64) }],
        },
      },
      { file: "0_1_1.sog", bytes: 2, sha256: "e".repeat(64), lodLevel: 2, isEnvironment: false },
      { file: "env.sog", bytes: 1, sha256: "f".repeat(64), lodLevel: null, isEnvironment: true },
    ],
  };

  it("serves the tiles themselves when trees are not wanted", () => {
    const sources = splatSourcesForBundle(bundle, base, false);
    expect(sources.map((source) => source.url)).toEqual([
      `${base}/0_1_0.sog`,
      `${base}/0_1_1.sog`,
      `${base}/env.sog`,
    ]);
    expect(sources.every((source) => !source.tree)).toBe(true);
  });

  it("serves a tile's prebuilt tree when wanted and present, and the tile itself when absent", () => {
    const sources = splatSourcesForBundle(bundle, base, true);
    expect(sources.map((source) => [source.url, source.tree])).toEqual([
      [`${base}/lod/0_1_0-lod.rad`, true],
      [`${base}/0_1_1.sog`, false],
      [`${base}/env.sog`, false],
    ]);
  });

  it("names the tile each source stands for, so load progress can be counted per tile", () => {
    expect(splatSourcesForBundle(bundle, base, true).map((source) => source.file)).toEqual([
      "0_1_0.sog",
      "0_1_1.sog",
      "env.sog",
    ]);
  });
});
