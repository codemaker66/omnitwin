import { readFileSync } from "node:fs";
import path from "node:path";
import { InstancedBufferAttribute, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { STREET_NIGHT_LOOKS } from "../../../lib/sky/night-looks.js";
import {
  BEAM, DUSK_SPAN, FITTING, LAMP_SWITCH, STREET_LAMPS_URL, STREET_LIGHT_URL, anyLampLit, applyStreetLook, buildBeamGeometry, buildFittingGeometry,
  buildHaloGeometry, drawnLamps, duskShareAt, haloInstances, lampLight, parseStreetLamps, parseStreetLight, streetLookUniforms, triangleCount,
  unwarpCoordinate, warpCoordinate, type StreetLamp, type StreetLightField,
} from "../hall-street-light.js";

interface PackOptions {
  readonly magic?: string;
  readonly version?: number;
  readonly size?: number;
  readonly warp?: number;
  readonly extent?: number;
  readonly lampCount?: number;
  readonly extra?: number;
  readonly poolRange?: number;
  readonly switchRange?: readonly [number, number];
}

/** Packed light maps: 'VVSL', version, size, the header's ranges and a lamp count, then two size² RGBA8 maps. */
function packLight({
  magic = "VVSL", version = 2, size = 4, warp = 60, extent = 260, lampCount = 1, extra = 0, poolRange = 24, switchRange = [-3.6, -2.4],
}: PackOptions = {}): ArrayBuffer {
  const buffer = new ArrayBuffer(56 + size * size * 8 + extra);
  const view = new DataView(buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint32(4, version, true);
  view.setUint32(8, size, true);
  [warp, extent, poolRange, 16, -6, 26, switchRange[0], switchRange[1], 0.4, 1.3].forEach((value, i) => { view.setFloat32(12 + i * 4, value, true); });
  view.setUint32(52, lampCount, true);
  // The pool map's first texel and the head map's, to tell them apart.
  if (size > 0 && buffer.byteLength >= 56 + size * size * 8) {
    view.setUint8(56, 11);
    view.setUint8(56 + size * size * 4, 22);
  }
  return buffer;
}

const LAMP = {
  id: "gcc:24095", objectid: 24095, source: "gcc-ogl", kind: "bracket", head: [-9.346, 4.21, -23.873], foot_y: -3.79,
  heading: [0.0291, 0.9996], reach: 0.85, fitting: "drawn", height_source: "default", switch_altitude: -2.9, snap_shift: 0.42,
};

function table(lamps: readonly Record<string, unknown>[], counts: Partial<Record<"lamps" | "bracket" | "column" | "door", number>> = {}): unknown {
  return {
    schema: "venviewer.street-light.v2",
    licence: { attribution: "Contains public sector information licensed under the Open Government Licence v3.0.", licence: "Open Government Licence v3.0" },
    counts: { lamps: lamps.length, bracket: lamps.filter((l) => l["kind"] === "bracket").length, column: 0, door: 0, ...counts },
    lamps,
  };
}

function published(): { field: StreetLightField; lamps: StreetLamp[] } {
  const read = (url: string): Buffer => readFileSync(path.resolve("public", url.replace(/^\//u, "").replace(/\?.*$/u, "")));
  const bytes = read(STREET_LIGHT_URL);
  const field = parseStreetLight(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const json: unknown = JSON.parse(read(STREET_LAMPS_URL).toString("utf8"));
  return { field, lamps: parseStreetLamps(json, field) };
}

/** A texel's RGBA in one of the maps. */
function texelAt(texels: Uint8Array, field: StreetLightField, col: number, row: number): readonly [number, number, number, number] {
  const at = (row * field.size + col) * 4;
  return [texels[at] ?? 0, texels[at + 1] ?? 0, texels[at + 2] ?? 0, texels[at + 3] ?? 0];
}

/**
 * The head the city's shader reads at a point (streetLightAt): the texel's
 * centre from the point itself and the warp's slope there, plus the texel's
 * offset.
 */
function shaderHead(field: StreetLightField, x: number, z: number): { x: number; y: number; z: number; switchAltitude: number } {
  const scale = 1 / Math.asinh(field.extent / field.warp);
  const axis = (value: number): { at: number; cell: number; centre: number } => {
    const r = Math.sqrt(value * value + field.warp * field.warp);
    const at = Math.log((value + r) / field.warp) * scale * 0.5 + 0.5;
    const cell = Math.min(field.size - 1, Math.max(0, Math.floor(at * field.size)));
    return { at, cell, centre: value + ((cell + 0.5) / field.size - at) * r * 2 / scale };
  };
  const u = axis(x);
  const v = axis(z);
  const [s, g, b, a] = texelAt(field.headTexels, field, u.cell, v.cell);
  return {
    x: u.centre + (g / 255 * 2 - 1) * field.headRange,
    y: field.yMin + (a - 1) / 254 * (field.yMax - field.yMin),
    z: v.centre + (b / 255 * 2 - 1) * field.headRange,
    switchAltitude: field.switchMin + s / 255 * (field.switchMax - field.switchMin),
  };
}

describe("parseStreetLight", () => {
  it("reads the header and keeps both maps", () => {
    const field = parseStreetLight(packLight());
    expect(field).toMatchObject({ size: 4, warp: 60, extent: 260, poolRange: 24, headRange: 16, yMin: -6, yMax: 26, lampCount: 1 });
    // float32 in the file
    expect(field.switchMin).toBeCloseTo(-3.6, 6);
    expect(field.switchMax).toBeCloseTo(-2.4, 6);
    expect(field.poolTexels.length).toBe(64);
    expect(field.headTexels.length).toBe(64);
    expect(field.poolTexels[0]).toBe(11);
    expect(field.headTexels[0]).toBe(22);
  });

  it.each([
    ["a truncated header", new ArrayBuffer(20), /truncated header/u],
    ["another file", packLight({ magic: "VVCX" }), /not a street light map/u],
    ["the first version", packLight({ version: 1 }), /version 1/u],
    ["a size that is not a power of two", packLight({ size: 3 }), /size 3/u],
    ["no texels", packLight({ size: 0 }), /size 0/u],
    ["trailing bytes", packLight({ extra: 4 }), /bytes, expected/u],
    ["a warp that is not a number", packLight({ warp: Number.NaN }), /warp NaN/u],
    ["a reach beyond the city", packLight({ extent: 400 }), /extent 400/u],
    ["a pool range out of range", packLight({ poolRange: 0 }), /pool range 0/u],
    ["lamps that light by day", packLight({ switchRange: [-3.6, 1] }), /latest switching 1/u],
    ["lamps that light after dusk", packLight({ switchRange: [-8, -2.4] }), /earliest switching -8/u],
  ])("refuses %s", (_name, buffer, message) => {
    expect(() => parseStreetLight(buffer)).toThrow(message);
  });
});

describe("parseStreetLamps", () => {
  it("reads a lamp", () => {
    const [lamp] = parseStreetLamps(table([LAMP]), { lampCount: 1 });
    expect(lamp).toEqual({
      id: "gcc:24095", objectid: 24095, kind: "bracket", head: [-9.346, 4.21, -23.873], footY: -3.79, heading: [0.0291, 0.9996],
      reach: 0.85, fitting: "drawn", heightSource: "default", switchAltitude: -2.9,
    });
  });

  it.each([
    ["a head that is not a number", table([{ ...LAMP, head: [Number.NaN, 4.21, -23.873] }]), /lamps\.0\.head/u],
    ["a head beyond the city", table([{ ...LAMP, head: [-9.3, 4.21, -400] }]), /lamps\.0\.head/u],
    ["a kind it does not draw", table([{ ...LAMP, kind: "pole" }]), /lamps\.0\.kind/u],
    ["a fitting it does not know", table([{ ...LAMP, fitting: "floating" }]), /lamps\.0\.fitting/u],
    ["a heading that is not a unit vector", table([{ ...LAMP, heading: [0.5, 0.5] }]), /lamps\.0\.heading/u],
    ["a switching altitude outside dusk", table([{ ...LAMP, switch_altitude: -5 }]), /lamps\.0\.switch_altitude/u],
    ["a field it does not know", table([{ ...LAMP, lantern: "DigiStreet" }]), /lamps\.0/u],
    ["the first version's table", { ...(table([LAMP]) as object), schema: "venviewer.street-light.v1" }, /schema/u],
    ["a count the lamps do not match", table([LAMP], { lamps: 2 }), /1 lamps, the table counts 2/u],
    ["a kind count the lamps do not match", table([LAMP], { bracket: 0 }), /1 brackets, the table counts 0/u],
    ["a lamp id twice", table([LAMP, LAMP]), /a lamp id twice/u],
  ])("refuses %s", (_name, json, message) => {
    const lampCount = (json as { lamps?: unknown[] }).lamps?.length ?? 0;
    expect(() => parseStreetLamps(json, { lampCount })).toThrow(message);
  });

  it("refuses a table baked with other maps", () => {
    expect(() => parseStreetLamps(table([LAMP]), { lampCount: 2 })).toThrow(/the map 2/u);
  });
});

describe("the light maps' warp", () => {
  const frame = { warp: 60, extent: 260 };

  it("puts the hall at the centre and the model's edge at the maps'", () => {
    expect(warpCoordinate(0, frame)).toBe(0.5);
    expect(warpCoordinate(-260, frame)).toBeCloseTo(0, 12);
    expect(warpCoordinate(260, frame)).toBeCloseTo(1, 12);
    expect(warpCoordinate(10, frame)).toBeGreaterThan(0.5);
  });

  it("rises steadily, finest at the hall, and round-trips", () => {
    let previous = -Infinity;
    for (let x = -260; x <= 260; x += 0.5) {
      const u = warpCoordinate(x, frame);
      expect(u).toBeGreaterThan(previous);
      previous = u;
      expect(unwarpCoordinate(u, frame)).toBeCloseTo(x, 9);
    }
    // About half a metre a texel at the hall, and 2.3 m at the edge, on a 512 map.
    const texel = (x: number): number => unwarpCoordinate(warpCoordinate(x, frame) + 1 / 512, frame) - x;
    expect(texel(0)).toBeCloseTo(0.5, 1);
    expect(texel(258)).toBeGreaterThan(2);
    expect(texel(258)).toBeLessThan(2.6);
  });

  it("finds a texel's centre from any point in it within 1% of a texel, as the shader does", () => {
    const field = { warp: 60, extent: 260, size: 512 };
    const scale = 1 / Math.asinh(field.extent / field.warp);
    for (let x = -259.9; x < 260; x += 0.37) {
      const r = Math.sqrt(x * x + field.warp * field.warp);
      const at = Math.log((x + r) / field.warp) * scale * 0.5 + 0.5;
      expect(at).toBeCloseTo(warpCoordinate(x, field), 9);
      const cell = Math.floor(at * field.size);
      const exact = unwarpCoordinate((cell + 0.5) / field.size, field);
      const near = x + ((cell + 0.5) / field.size - at) * r * 2 / scale;
      const width = unwarpCoordinate((cell + 1) / field.size, field) - unwarpCoordinate(cell / field.size, field);
      expect(Math.abs(near - exact) / width).toBeLessThan(0.01);
    }
  });
});

describe("the street lamps' switching", () => {
  it("lights each lamp over 0.3° round its own altitude, steadily", () => {
    expect(lampLight(-3 + LAMP_SWITCH.ramp, -3)).toBe(0);
    expect(lampLight(-3, -3)).toBeCloseTo(0.5, 9);
    expect(lampLight(-3 - LAMP_SWITCH.ramp, -3)).toBe(1);
    let previous = 0;
    for (let altitude = -2; altitude >= -4; altitude -= 0.01) {
      const light = lampLight(altitude, -3.2);
      expect(light).toBeGreaterThanOrEqual(previous);
      previous = light;
    }
  });

  it("keeps every lamp dark while no lamp is lit, so the halos and cones need not draw", () => {
    const { lamps } = published();
    for (let altitude = 10; altitude >= -6; altitude -= 0.01) {
      if (anyLampLit(altitude)) continue;
      for (const lamp of lamps) expect(lampLight(altitude, lamp.switchAltitude)).toBe(0);
    }
    expect(anyLampLit(-2.2)).toBe(false);
    expect(anyLampLit(-2.3)).toBe(true);
  });
});

describe("dusk on the card", () => {
  it("leaves the day's light alone above 1.5° below the horizon and darkens the card steadily to 4.5° below", () => {
    expect(DUSK_SPAN.from).toBe(-1.5);
    for (const altitude of [40, 10, 0, -1, -1.5]) expect(duskShareAt(altitude)).toBe(0);
    expect(duskShareAt(-3)).toBeCloseTo(0.5, 9);
    for (const altitude of [-4.5, -6, -20]) expect(duskShareAt(altitude)).toBe(1);
    let previous = 0;
    for (let altitude = -1; altitude >= -5; altitude -= 0.01) {
      const share = duskShareAt(altitude);
      expect(share).toBeGreaterThanOrEqual(previous);
      previous = share;
    }
    // Dusk is under way before the first lamp lights, and complete before the city's night is half in.
    expect(duskShareAt(LAMP_SWITCH.highest + LAMP_SWITCH.ramp)).toBeGreaterThan(0.1);
    expect(DUSK_SPAN.to).toBeGreaterThan(-6.5);
  });
});

describe("the published street lamps", () => {
  it("parse, and agree with the light maps baked beside them", () => {
    const { field, lamps } = published();
    expect(field.size).toBe(512);
    expect(lamps.length).toBe(field.lampCount);
    expect(lamps.length).toBeGreaterThan(200);
    // At each nearby street lamp's pool centre, a step out along its throw, the
    // pool map names that lamp's pool, switch and foot, and the head map, read
    // as the shader reads it, that lamp's head and switch.
    const near = drawnLamps(lamps).filter((lamp) => lamp.kind !== "door" && Math.hypot(lamp.head[0], lamp.head[2]) < 60);
    expect(near.length).toBeGreaterThan(8);
    for (const lamp of near) {
      const x = lamp.head[0] + lamp.heading[0] * 1.6;
      const z = lamp.head[2] + lamp.heading[1] * 1.6;
      const col = Math.min(field.size - 1, Math.floor(warpCoordinate(x, field) * field.size));
      const row = Math.min(field.size - 1, Math.floor(warpCoordinate(z, field) * field.size));
      const [r, g, b, a] = texelAt(field.poolTexels, field, col, row);
      expect(r / 255 * field.poolRange, lamp.id).toBeLessThan(1);
      expect(field.switchMin + g / 255 * (field.switchMax - field.switchMin), lamp.id).toBeCloseTo(lamp.switchAltitude, 3);
      expect(Math.abs(field.yMin + (b - 1) / 254 * (field.yMax - field.yMin) - lamp.footY), lamp.id).toBeLessThan(0.07);
      expect(a, lamp.id).toBe(255);
      const head = shaderHead(field, x, z);
      expect(Math.hypot(head.x - lamp.head[0], head.z - lamp.head[2]), lamp.id).toBeLessThan(0.2);
      expect(Math.abs(head.y - lamp.head[1]), lamp.id).toBeLessThan(0.1);
      expect(head.switchAltitude, lamp.id).toBeCloseTo(lamp.switchAltitude, 3);
    }
  });

  it("take away exactly the fittings the hall's cut and a too-low wall cannot carry, and keep 24095 across Glassford Street", () => {
    const { lamps } = published();
    const fitted = (fitting: string): number[] => lamps.filter((lamp) => lamp.fitting === fitting).map((lamp) => lamp.objectid ?? 0).sort((a, b) => a - b);
    expect(fitted("cut")).toEqual([24094, 24096, 45116, 45117, 45127]);
    expect(fitted("low-wall")).toEqual([8463]);
    expect(lamps.find((lamp) => lamp.objectid === 24095)?.fitting).toBe("drawn");
    expect(lamps.filter((lamp) => lamp.kind === "door").map((lamp) => lamp.id)).toEqual(["trades-hall:door-north", "trades-hall:door-south"]);
    // Every drawn street lantern hangs at least 4 m over its ground.
    for (const lamp of drawnLamps(lamps)) if (lamp.kind !== "door") expect(lamp.head[1] - lamp.footY, lamp.id).toBeGreaterThanOrEqual(4);
  });

  it("switch on between 3.6° and 2.4° below the horizon, spread through it", () => {
    const { lamps } = published();
    for (const lamp of lamps) {
      expect(lamp.switchAltitude).toBeGreaterThanOrEqual(-3.6);
      expect(lamp.switchAltitude).toBeLessThanOrEqual(-2.4);
    }
    const altitudes = lamps.map((lamp) => lamp.switchAltitude);
    expect(Math.max(...altitudes) - Math.min(...altitudes)).toBeGreaterThan(1);
  });
});

describe("the lamps' geometry", () => {
  it("builds every drawn fitting in one mesh of outward faces, within its budget", () => {
    const { lamps } = published();
    const geometry = buildFittingGeometry(lamps);
    const triangles = triangleCount(geometry);
    expect(triangles).toBeGreaterThan(drawnLamps(lamps).length * 20);
    expect(triangles).toBeLessThanOrEqual(30_000);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const index = geometry.getIndex();
    if (index === null) throw new Error("the fittings are indexed");
    const [a, b, c, n, e1, e2] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
    let inward = 0;
    for (let t = 0; t < index.count; t += 3) {
      a.fromBufferAttribute(position, index.getX(t));
      b.fromBufferAttribute(position, index.getX(t + 1));
      c.fromBufferAttribute(position, index.getX(t + 2));
      n.fromBufferAttribute(normal, index.getX(t));
      // Every face winds toward its own outward normal, so its front is drawn.
      if (e1.subVectors(b, a).cross(e2.subVectors(c, a)).dot(n) <= 0) inward += 1;
    }
    expect(inward).toBe(0);
    const switchAltitude = geometry.getAttribute("switchAltitude");
    const lens = geometry.getAttribute("lens");
    const uv = geometry.getAttribute("uv");
    let lenses = 0;
    let panes = 0;
    for (let v = 0; v < switchAltitude.count; v++) {
      expect(switchAltitude.getX(v)).toBeGreaterThanOrEqual(-3.6);
      expect(switchAltitude.getX(v)).toBeLessThanOrEqual(-2.4);
      if (lens.getX(v) === 1) lenses += 1;
      if (lens.getX(v) === Math.fround(FITTING.door.pane)) panes += 1;
      // Every lit face spans its uv, so the shader can frame it.
      if (lens.getX(v) > 0) expect([0, 1]).toContain(uv.getX(v));
    }
    // The paddles' undersides (four corners each), and the door lanterns' four softer panes each.
    const paddles = drawnLamps(lamps).filter((lamp) => lamp.kind !== "door").length;
    expect(lenses).toBe(paddles * 4);
    expect(panes).toBe(2 * 16);
  });

  it("draws no fitting, cone or halo for a lamp the model cannot carry, and no cone for a door lantern", () => {
    const { lamps } = published();
    const drawn = drawnLamps(lamps);
    expect(drawn.length).toBe(lamps.length - 6);
    const beams = buildBeamGeometry(lamps);
    expect(triangleCount(beams)).toBe(drawn.filter((lamp) => lamp.kind !== "door").length * BEAM.segments);
    // Every cone's vertices name its lens, where the vertex shader folds it.
    const apex = beams.getAttribute("apex");
    const position = beams.getAttribute("position");
    const along = beams.getAttribute("along");
    for (let v = 0; v < apex.count; v++) {
      if (along.getX(v) !== 0) continue;
      expect([position.getX(v), position.getY(v), position.getZ(v)]).toEqual([apex.getX(v), apex.getY(v), apex.getZ(v)]);
    }
    const halos = haloInstances(lamps);
    expect(halos.count).toBe(drawn.length);
    expect(halos.heads.length).toBe(drawn.length * 3);
    // 24095's halo sits on its lens, under its paddle.
    const across = drawn.findIndex((lamp) => lamp.objectid === 24095);
    const lamp = drawn[across];
    if (lamp === undefined) throw new Error("24095 is drawn");
    expect(halos.heads[across * 3 + 1]).toBeCloseTo(lamp.head[1] - FITTING.head[1] / 2, 5);
  });

  it("gives the halos a quad of their own carrying each lantern as an instance", () => {
    const { lamps } = published();
    const geometry = buildHaloGeometry(lamps);
    const head = geometry.getAttribute("haloHead");
    const switchAltitude = geometry.getAttribute("haloSwitch");
    expect(head).toBeInstanceOf(InstancedBufferAttribute);
    expect(switchAltitude).toBeInstanceOf(InstancedBufferAttribute);
    expect(head.count).toBe(drawnLamps(lamps).length);
    expect(switchAltitude.count).toBe(drawnLamps(lamps).length);
    expect(geometry.getAttribute("position").count).toBe(4);
    expect(geometry.getIndex()?.count).toBe(6);
  });
});

describe("the night look's uniforms", () => {
  it("start as Evocative and take another look's values in place", () => {
    const u = streetLookUniforms;
    const pool = u.poolCore;
    expect(pool.value.toArray()).toEqual([...STREET_NIGHT_LOOKS.evocative.pool.core]);
    expect(u.halo.value.toArray()).toEqual([...STREET_NIGHT_LOOKS.evocative.halo]);
    applyStreetLook(STREET_NIGHT_LOOKS.noir);
    expect(u.poolCore).toBe(pool);
    expect(pool.value.toArray()).toEqual([...STREET_NIGHT_LOOKS.noir.pool.core]);
    expect(u.hazeReach.value).toBe(STREET_NIGHT_LOOKS.noir.hazeReach);
    expect(u.duskWall.value).toBe(STREET_NIGHT_LOOKS.noir.dusk.wall);
    expect(u.duskAir.value).toBe(STREET_NIGHT_LOOKS.noir.dusk.air);
    applyStreetLook(STREET_NIGHT_LOOKS.off);
    expect(u.lampsOn.value).toBe(0);
    expect([u.duskWall.value, u.duskRoof.value, u.duskAir.value]).toEqual([1, 1, 1]);
    expect(u.ambientWeight.value).toBe(0);
    expect(u.windowAverage.value).toBe(0.012);
    applyStreetLook(STREET_NIGHT_LOOKS.evocative);
    expect(u.lampsOn.value).toBe(1);
    expect(u.windowAverage.value).toBe(-1);
  });
});
