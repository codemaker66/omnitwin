import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import {
  DEVICE_DAY_BUNDLE_IDS,
  DEVICE_DAY_SPLAT_BASE_URL,
  PLANNER_FROM_SHIPPED_TILES,
  deviceDayBaseUrl,
  deviceDayBundleById,
  deviceDayBundleForRoom,
  deviceDayGovernorOff,
  deviceDayRuntimeLabel,
  deviceDayTileRequested,
  deviceDayTileUrls,
  deviceDayViewTransform,
  eulerXyzFromMatrix,
  matrixFromEulerXyz,
  requestedDeviceDayBundle,
  servedFromHall,
  servedFromHallPlacement,
  type DeviceDayBundle,
} from "../device-day-splat-bundles.js";
import { roomSplatBundle } from "../room-splat-bundles.js";
import { PREVIEW_SPLAT_BASE_URL } from "../../lib/production-env.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT } from "../../components/grand-hall/hall-spec.js";
import { GRAND_HALL_ARRIVAL } from "../../lib/planner-room-arrival.js";

const DEV = { DEV: true, VITE_SPLAT_BASE_URL: "" } as const;
const BUILD = { DEV: false, VITE_SPLAT_BASE_URL: "" } as const;

function bundle(id: string): DeviceDayBundle {
  const found = deviceDayBundleById(id);
  if (found === null) throw new Error(`no ${id}`);
  return found;
}

describe("device-day allowlist", () => {
  it("holds exactly L2's five timing cuts, each for the Grand Hall", () => {
    expect(DEVICE_DAY_BUNDLE_IDS).toEqual(["l2-1m", "l2-1.5m", "l2-2m", "l2-3m", "l2-2m-sh1"]);
    for (const id of DEVICE_DAY_BUNDLE_IDS) expect(bundle(id).roomSlug).toBe("grand-hall");
  });

  it.each([
    ["l2-1m", 1_000_000, 2, 3],
    ["l2-1.5m", 1_500_000, 3, 3],
    ["l2-2m", 2_000_000, 4, 3],
    ["l2-3m", 3_000_000, 6, 3],
    ["l2-2m-sh1", 2_000_000, 4, 1],
  ] as const)("describes %s: %i splats in %i tiles at SH%i, every tile named, sized and hashed", (id, splats, tiles, sh) => {
    const cut = bundle(id);
    expect(cut.totalSplats).toBe(splats);
    expect(cut.shDegree).toBe(sh);
    expect(cut.tiles.map((tile) => tile.file)).toEqual(Array.from({ length: tiles }, (_, n) => `${id}_${String(n)}.sog`));
    expect(cut.tiles.every((tile) => tile.splats === 500_000)).toBe(true);
    expect(cut.tiles.every((tile) => /^[0-9a-f]{64}$/u.test(tile.sha256))).toBe(true);
    expect(cut.tiles.reduce((sum, tile) => sum + tile.splats, 0)).toBe(cut.totalSplats);
    expect(cut.tiles.reduce((sum, tile) => sum + tile.bytes, 0)).toBe(cut.totalBytes);
    expect(new Set(cut.tiles.map((tile) => tile.sha256)).size).toBe(tiles);
  });

  it("labels a drawn cut by name, count and SH degree, as timing-only", () => {
    expect(deviceDayRuntimeLabel(bundle("l2-2m-sh1"))).toBe("Device-day timing cut l2-2m-sh1 · 2 M splats · SH1 · not a look candidate");
    expect(deviceDayRuntimeLabel(bundle("l2-1.5m"))).toBe("Device-day timing cut l2-1.5m · 1.5 M splats · SH3 · not a look candidate");
  });
});

describe("?splatBundle=", () => {
  it("honours an allowlisted id in the room it was cut from", () => {
    expect(deviceDayBundleForRoom("?splatBundle=l2-2m", "grand-hall")?.id).toBe("l2-2m");
    expect(deviceDayBundleForRoom("?space=grand-hall&splatBundle=l2-1.5m&profiler=1", "grand-hall")?.id).toBe("l2-1.5m");
  });

  it.each([
    ["an unknown id", "?splatBundle=l2-9m"],
    ["an id in another case", "?splatBundle=L2-2M"],
    ["a path", "?splatBundle=../l2-2m"],
    ["a URL", "?splatBundle=https%3A%2F%2Fexample.com%2Fl2-2m_0.sog"],
    ["an empty value", "?splatBundle="],
    ["a manual splat URL", "?splatUrl=https%3A%2F%2Fexample.com%2Fcapture.sog"],
    ["no query", ""],
  ])("ignores %s", (_name, search) => {
    expect(requestedDeviceDayBundle(search)).toBeNull();
    expect(deviceDayBundleForRoom(search, "grand-hall")).toBeNull();
  });

  it.each(["reception-room", "saloon", null])("ignores an allowlisted id in %s", (room) => {
    expect(deviceDayBundleForRoom("?splatBundle=l2-2m", room)).toBeNull();
  });

  it("turns the frame-rate governor off only beside a named cut", () => {
    expect(deviceDayGovernorOff("?splatBundle=l2-2m&governor=off")).toBe(true);
    expect(deviceDayGovernorOff("?splatBundle=l2-2m")).toBe(false);
    expect(deviceDayGovernorOff("?governor=off")).toBe(false);
    expect(deviceDayGovernorOff("?splatBundle=nope&governor=off")).toBe(false);
  });
});

describe("tile URLs", () => {
  it("reads the public bucket the shipped tiles use in every build", () => {
    expect(DEVICE_DAY_SPLAT_BASE_URL).toBe(PREVIEW_SPLAT_BASE_URL);
    expect(deviceDayBaseUrl(BUILD)).toBe(PREVIEW_SPLAT_BASE_URL);
    // A build's own base never wins: production's is "" and "/splats" is held.
    expect(deviceDayBaseUrl({ DEV: false, VITE_SPLAT_BASE_URL: "https://elsewhere.example/splats" })).toBe(PREVIEW_SPLAT_BASE_URL);
    expect(deviceDayTileUrls(bundle("l2-2m"), BUILD)).toEqual([0, 1, 2, 3].map((n) =>
      `https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/device-day/l2-2m/l2-2m_${String(n)}.sog`));
  });

  it("follows the configured base in development, the staging root by default", () => {
    expect(deviceDayTileUrls(bundle("l2-1m"), DEV)).toEqual([
      "/splats/trades-hall/device-day/l2-1m/l2-1m_0.sog",
      "/splats/trades-hall/device-day/l2-1m/l2-1m_1.sog",
    ]);
    expect(deviceDayTileUrls(bundle("l2-1m"), { DEV: true, VITE_SPLAT_BASE_URL: "https://cdn.example/splats/" })[0])
      .toBe("https://cdn.example/splats/trades-hall/device-day/l2-1m/l2-1m_0.sog");
  });

  it("admits past the hold only the named cut's own tile URLs", () => {
    const url = `${PREVIEW_SPLAT_BASE_URL}/trades-hall/device-day/l2-3m/l2-3m_5.sog`;
    expect(deviceDayTileRequested(url, "?splatBundle=l2-3m", BUILD)).toBe(true);
    expect(deviceDayTileRequested(url, "?splatBundle=l2-2m", BUILD)).toBe(false);
    expect(deviceDayTileRequested(url, "", BUILD)).toBe(false);
    expect(deviceDayTileRequested(url, "?splatBundle=l2-3m", DEV)).toBe(false);
    expect(deviceDayTileRequested("https://example.com/capture.sog", "?splatBundle=l2-3m", BUILD)).toBe(false);
    expect(deviceDayTileRequested(`${PREVIEW_SPLAT_BASE_URL}/trades-hall/grand-hall/0_0.sog`, "?splatBundle=l2-3m", BUILD)).toBe(false);
  });
});

describe("where a cut stands", () => {
  const shipped = roomSplatBundle("grand-hall");
  if (shipped === null) throw new Error("no shipped Grand Hall bundle");
  const s = servedFromHallPlacement("grand-hall");
  if (s === null) throw new Error("no hall-to-served placement");
  const sMatrix = new Matrix4().set(
    s.rotation[0][0], s.rotation[0][1], s.rotation[0][2], s.position[0],
    s.rotation[1][0], s.rotation[1][1], s.rotation[1][2], s.position[1],
    s.rotation[2][0], s.rotation[2][1], s.rotation[2][2], s.position[2],
    0, 0, 0, 1,
  );
  const served = (point: readonly [number, number, number]): [number, number, number] => {
    const placed = servedFromHall("grand-hall", point);
    if (placed === null) throw new Error("no placement");
    return placed;
  };
  const hallFromServed = (point: readonly [number, number, number]): Vector3 =>
    new Vector3(...point).applyMatrix4(sMatrix.clone().invert());

  it("builds rotations exactly as three.js does for Euler order XYZ, both ways", () => {
    const angles: readonly (readonly [number, number, number])[] = [
      PLANNER_FROM_SHIPPED_TILES.rotation, [-Math.PI / 2, 0, 0], [0.3, -1.1, 2.4], [0.1, 0.2, -0.3],
    ];
    for (const angle of angles) {
      const three = new Matrix4().makeRotationFromEuler(new Euler(angle[0], angle[1], angle[2], "XYZ")).elements;
      const ours = matrixFromEulerXyz(angle);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        expect(ours[row]?.[col]).toBeCloseTo(three[col * 4 + row] ?? NaN, 12);
      }
      const back = eulerXyzFromMatrix(ours);
      const reference = new Euler().setFromRotationMatrix(new Matrix4().makeRotationFromEuler(new Euler(...angle, "XYZ")), "XYZ");
      expect(back[0]).toBeCloseTo(reference.x, 12);
      expect(back[1]).toBeCloseTo(reference.y, 12);
      expect(back[2]).toBeCloseTo(reference.z, 12);
    }
  });

  it("takes every cut's transform from L2 as written, and they are one transform", () => {
    for (const id of DEVICE_DAY_BUNDLE_IDS) {
      const cut = bundle(id);
      expect(cut.plannerTransform.position).toEqual(PLANNER_FROM_SHIPPED_TILES.position);
      expect(cut.plannerTransform.rotation).toEqual(PLANNER_FROM_SHIPPED_TILES.rotation);
      const r = matrixFromEulerXyz(cut.plannerTransform.rotation);
      for (let row = 0; row < 3; row++) {
        const written = cut.plannerMatrix3x4[row];
        if (written === undefined) throw new Error("short matrix");
        for (let col = 0; col < 3; col++) expect(Math.abs((r[row]?.[col] ?? NaN) - (written[col] ?? NaN))).toBeLessThan(1e-9);
        expect(written[3]).toBe(cut.plannerTransform.position[row]);
      }
    }
  });

  it("draws every cut where the shipped capture stands: its tiles share the shipped tiles' frame", () => {
    for (const id of DEVICE_DAY_BUNDLE_IDS) {
      const transform = deviceDayViewTransform(bundle(id));
      if (transform === null) throw new Error("no transform");
      expect(transform.scale).toBe(1);
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs((transform.position[axis] ?? NaN) - (shipped.transform.position[axis] ?? NaN))).toBeLessThan(1e-9);
      }
      const ours = new Quaternion().setFromEuler(new Euler(...transform.rotation, "XYZ"));
      const theirs = new Quaternion().setFromEuler(new Euler(...shipped.transform.rotation, "XYZ"));
      expect(ours.angleTo(theirs)).toBeLessThan(1e-9);
    }
  });

  it("is a quarter turn of the drawn hall: its long axis runs along z, its floor stays at y = 0", () => {
    const along = served([1, 0, 0]);
    const origin = served([0, 0, 0]);
    const direction = new Vector3(along[0] - origin[0], along[1] - origin[1], along[2] - origin[2]);
    expect(direction.length()).toBeCloseTo(1, 12);
    // Hall x (fireplace to end wall) runs to served -z: the fireplace end is at +z.
    expect(direction.z).toBeLessThan(-0.999);
    for (const x of [-HALL_HALF_LENGTH, HALL_HALF_LENGTH]) for (const z of [-HALL_HALF_WIDTH, HALL_HALF_WIDTH]) {
      expect(Math.abs(served([x, 0, z])[1])).toBeLessThan(0.05);
      expect(Math.abs(served([x, HALL_HEIGHT, z])[1] - HALL_HEIGHT)).toBeLessThan(0.05);
    }
  });

  it("agrees with the blind registration made from the decoded tiles", () => {
    // switch-proof/refine-fine-l2-2m.json: yaw and floor-plan offset searched
    // from L2's transform alone, nothing taken from the shipped transform:
    // +91.0 degrees about y, offset (0.45, -0.01, 0.04) m.
    const along = served([1, 0, 0]);
    const origin = served([0, 0, 0]);
    // A yaw of t about y takes +x to (cos t, 0, -sin t).
    const yawDegrees = Math.atan2(-(along[2] - origin[2]), along[0] - origin[0]) * 180 / Math.PI;
    expect(Math.abs(yawDegrees - 91.0)).toBeLessThan(0.1);
    expect(Math.hypot(origin[0] - 0.45, origin[2] - 0.04)).toBeLessThan(0.03);
    expect(Math.abs(origin[1] - -0.01)).toBeLessThan(0.02);
  });

  it("lands the hall's walls on the shipped capture's own wall planes", () => {
    // Wall planes of the shipped finest level (6.0 M splats) in its served
    // frame: 1 cm histograms of opaque splats at 1-6 m height
    // (switch-proof/profiles-l2-2m.json). The window wall's strongest plane,
    // x = -5.405, is the glass 0.5 m out; the panelled face is x = -4.905.
    // The survey (hall-spec), the scanner and the panorama model each place a
    // wall's face a few centimetres differently (the cut's own end-wall plane
    // lands 5.5 cm from the shipped one), so the bar is a decimetre.
    const mid = HALL_HEIGHT / 2;
    expect(Math.abs(served([0, mid, -HALL_HALF_WIDTH])[0] - -4.905)).toBeLessThan(0.1); // window wall
    expect(Math.abs(served([0, mid, HALL_HALF_WIDTH])[0] - 5.705)).toBeLessThan(0.1); // door wall
    expect(Math.abs(served([HALL_HALF_LENGTH, mid, 0])[2] - -10.445)).toBeLessThan(0.1); // end wall
    const fireplace = served([-HALL_HALF_LENGTH, mid, 0])[2];
    expect(fireplace).toBeGreaterThan(10.535 - 0.1);
    expect(fireplace).toBeLessThan(10.695 + 0.1);
  });

  it("keeps every capture-mode camera inside the drawn hall's walls", () => {
    const inside = (point: readonly [number, number, number]): void => {
      const hall = hallFromServed(point);
      expect(Math.abs(hall.x)).toBeLessThan(HALL_HALF_LENGTH - 0.3);
      expect(Math.abs(hall.z)).toBeLessThan(HALL_HALF_WIDTH - 0.3);
      expect(hall.y).toBeGreaterThan(0.3);
      expect(hall.y).toBeLessThan(HALL_HEIGHT - 0.3);
    };
    const { position } = GRAND_HALL_ARRIVAL;
    // The arrival and Showcase's glide (lib/planner-showcase.ts: z, z - 2.5, z - 5),
    // which run along the hall from near the fireplace.
    for (const dz of [0, -2.5, -5]) inside([position[0], position[1], position[2] + dz]);
    expect(hallFromServed([position[0], position[1], position[2]]).x).toBeLessThan(-6);
  });

  it("covers the whole room with every cut's tiles", () => {
    for (const id of DEVICE_DAY_BUNDLE_IDS) {
      const tiles = bundle(id).tiles;
      const min = [0, 1, 2].map((axis) => Math.min(...tiles.map((tile) => tile.boundsPlanner.min[axis] ?? NaN)));
      const max = [0, 1, 2].map((axis) => Math.max(...tiles.map((tile) => tile.boundsPlanner.max[axis] ?? NaN)));
      expect(min[0]).toBeLessThan(-HALL_HALF_LENGTH);
      expect(max[0]).toBeGreaterThan(HALL_HALF_LENGTH);
      expect(min[1]).toBeLessThan(0);
      expect(max[1]).toBeGreaterThan(HALL_HEIGHT);
      expect(min[2]).toBeLessThan(-HALL_HALF_WIDTH);
      expect(max[2]).toBeGreaterThan(HALL_HALF_WIDTH);
    }
  });
});
