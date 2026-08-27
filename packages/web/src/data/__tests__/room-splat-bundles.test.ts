import { describe, expect, it } from "vitest";
import {
  deriveRoomCamera,
  roomAlignmentIsConfident,
  roomSplatBundle,
  roomSplatTileUrls,
  roomSplatTotalBytes,
  roomsWithSplatBundles,
  splatBaseUrl,
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
    expect(urls[0]).toBe("/splats/trades-hall/reception-room/0_0.sog");
  });

  it("loads coarsest LOD first so the room resolves from a rough whole", () => {
    const bundle = roomSplatBundle("reception-room");
    const levels = (bundle?.tiles ?? [])
      .filter((tile) => !tile.isEnvironment)
      .map((tile) => tile.lodLevel ?? 0);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it("puts the environment shell last, since it is sky and not room", () => {
    const tiles = roomSplatBundle("reception-room")?.tiles ?? [];
    expect(tiles.at(-1)?.isEnvironment).toBe(true);
    expect(tiles.slice(0, -1).every((tile) => !tile.isEnvironment)).toBe(true);
  });

  it("returns nothing for a room with no capture, rather than a broken URL", () => {
    expect(roomSplatTileUrls("no-such-room", NO_BASE_URL)).toEqual([]);
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
