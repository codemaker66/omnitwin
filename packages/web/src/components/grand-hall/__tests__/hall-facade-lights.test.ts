import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STREET_NIGHT_LOOKS } from "../../../lib/sky/night-looks.js";
import { CONTEXT_MODEL_URL, parseContextModel } from "../hall-context.js";
import {
  FACADE_KINDS, FACADE_LIGHTS_URL, FACADE_LIGHT_CLASSES, FACADE_SURVEYED_WALLS, buildFacadeLightGeometry, lightClassIndex, onSurveyedWall,
  parseFacadeLights, type FacadeLight,
} from "../hall-facade-lights.js";
import { facadesLit } from "../HallFacadeLights.js";
import { DUSK_SPAN, applyStreetLook, streetLookUniforms } from "../hall-street-light.js";

const publicFile = (url: string): string => path.resolve("public", url.replace(/^\//u, "").replace(/\?.*$/u, ""));
const SURVEY_FILE = path.resolve("..", "..", "tools", "grand-hall-survey", "context", "facade-survey.json");

function publishedJson(): unknown {
  return JSON.parse(readFileSync(publicFile(FACADE_LIGHTS_URL), "utf8"));
}

/** A small file of the given lights, all on the frontage opposite the hall. */
function file(lights: readonly Record<string, unknown>[], counts: Partial<Record<string, number>> = {}): unknown {
  const tally = Object.fromEntries(FACADE_KINDS.map((kind) => [kind, lights.filter((light) => light["kind"] === kind).length]));
  return {
    schema: "venviewer.facade-lights.v1",
    licence: { panoramas: "ours", model: "the city model", note: "art direction" },
    counts: { ...tally, lights: lights.length, dropped: 0, blind: 0, clipped: 0, ...counts },
    lights,
  };
}

const WINDOW = {
  id: "76-glassford:f1-x9.88", kind: "window", light: "office", use: "office", seed: 0.25, variant: 0.5,
  centre: [9.88, -1.79, -24.6], along: [0.5, 0, 0], up: [0, 1, 0], span: [0, 1],
};
const SPILL = {
  id: "blane-valley:door:spill", kind: "spill", light: "pub", seed: 0.1, variant: 0.2,
  centre: [12.35, -3.77, -22.9], along: [1.35, 0, 0], up: [0, 0, 1.75], span: [0, 2.7],
};

/** The bake's seed: the first six bytes of SHA-256 of the text, over 2^48, to four places. */
function unitHash(text: string): number {
  const bytes = createHash("sha256").update(text, "utf8").digest();
  return Math.round((bytes.readUIntBE(0, 6) / 2 ** 48) * 1e4) / 1e4;
}

type Vec = readonly [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Nearest hit of a ray against triangles (Moller-Trumbore), or Infinity. */
function cast(triangles: readonly (readonly [Vec, Vec, Vec])[], origin: Vec, direction: Vec): number {
  let best = Infinity;
  for (const [v0, v1, v2] of triangles) {
    const e1 = sub(v1, v0);
    const e2 = sub(v2, v0);
    const p = cross(direction, e2);
    const det = dot(p, e1);
    if (Math.abs(det) < 1e-12) continue;
    const tv = sub(origin, v0);
    const u = dot(tv, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(tv, e1);
    const v = dot(direction, q) / det;
    if (v < 0 || u + v > 1) continue;
    const distance = dot(e2, q) / det;
    if (distance > 1e-6 && distance < best) best = distance;
  }
  return best;
}

describe("parseFacadeLights", () => {
  it("reads a window and a spill, giving a window its use and anything else none", () => {
    const [window, spill] = parseFacadeLights(file([WINDOW, SPILL]));
    expect(window).toMatchObject({ id: WINDOW.id, kind: "window", use: "office", seed: 0.25, centre: [9.88, -1.79, -24.6] });
    expect(spill).toMatchObject({ kind: "spill", use: null });
  });

  it.each([
    ["another schema", { ...(file([WINDOW]) as object), schema: "venviewer.facade-lights.v2" }, /schema/u],
    ["a count that disagrees", file([WINDOW], { lights: 2 }), /1 lights, the file counts 2/u],
    ["a kind's count that disagrees", file([WINDOW], { window: 0 }), /1 of kind window, the file counts 0/u],
    ["an id twice", file([WINDOW, WINDOW]), /id twice/u],
    ["a window without its use", file([{ ...WINDOW, use: undefined }]), /a window and only a window has a use/u],
    ["a spill with a use", file([{ ...SPILL, use: "home" }]), /a window and only a window has a use/u],
    ["sides not square", file([{ ...WINDOW, up: [0.2, 1, 0] }]), /not square|not upright/u],
    ["a window lying down", file([{ ...WINDOW, up: [0, 0, 1] }]), /not upright/u],
    ["a spill standing up", file([{ ...SPILL, up: [0, 1.75, 0] }]), /not flat/u],
    ["a tilted run", file([{ ...WINDOW, along: [0.5, 0.01, 0] }]), /square|level/u],
    ["a speck", file([{ ...WINDOW, along: [0.01, 0, 0] }]), /smaller than 10 cm/u],
    ["a light off the surveyed walls", file([{ ...WINDOW, centre: [60, -1.79, -24.6] }]), /off the surveyed walls/u],
    ["a seed of 1", file([{ ...WINDOW, seed: 1 }]), /seed/u],
    ["an unknown light", file([{ ...WINDOW, light: "neon-pink" }]), /light/u],
    ["a coordinate beyond the city", file([{ ...WINDOW, centre: [9.88, -1.79, -400] }]), /centre/u],
    ["a piece past the end of its whole", file([{ ...WINDOW, span: [0.5, 1] }]), /past the end of its whole/u],
    ["no span", file([{ ...WINDOW, span: undefined }]), /span/u],
  ])("refuses %s", (_name, json, message) => {
    expect(() => parseFacadeLights(json)).toThrow(message);
  });
});

describe("the published facade lights", () => {
  const lights = parseFacadeLights(publishedJson());
  const survey = JSON.parse(readFileSync(SURVEY_FILE, "utf8")) as {
    licence: Record<string, string>;
    features: { id: string; use?: string }[];
  };
  const published = publishedJson() as {
    dropped: { id: string; reason: string }[]; blind: string[]; clipped: { id: string; top: number }[];
    inputs: { model: { sha256: string } }; licence: Record<string, string>;
  };
  /** A placed piece's or a dropped piece's whole: its id without the piece's number. */
  const whole = (id: string): string => id.replace(/:\d+$/u, "");

  it("place every surveyed opening the model can carry, list the rest with a reason, and light no blind window", () => {
    const pieces = lights.filter((light) => light.kind !== "spill");
    const blind = new Set(published.blind);
    for (const feature of survey.features) {
      const placed = pieces.filter((light) => whole(light.id) === feature.id).length;
      const dropped = published.dropped.filter((entry) => whole(entry.id) === feature.id).length;
      expect(blind.has(feature.id), feature.id).toBe(feature.use === "blind");
      // Blind, or placed and dropped piece by piece (a window is always one piece).
      expect(blind.has(feature.id) ? placed + dropped : placed + dropped > 0, feature.id).toBe(blind.has(feature.id) ? 0 : true);
      if (feature.use !== undefined) expect(placed + dropped, feature.id).toBeLessThanOrEqual(1);
    }
    for (const entry of published.dropped) expect(entry.reason.length, entry.id).toBeGreaterThan(10);
    // Every piece of a whole shares its whole's length and seed, and the pieces tile it.
    const byWhole = new Map<string, FacadeLight[]>();
    for (const light of pieces) byWhole.set(whole(light.id), [...(byWhole.get(whole(light.id)) ?? []), light]);
    for (const [id, group] of byWhole) {
      expect(new Set(group.map((light) => light.span[1])).size, id).toBe(1);
      expect(new Set(group.map((light) => light.seed)).size, id).toBe(1);
    }
    // A clipped piece ends just under one of the model's 3 m band edges (y = 0, 3, 6, ...: 3.79 m above the pavement and every 3 m on).
    for (const entry of published.clipped) {
      const light = pieces.find((candidate) => candidate.id === entry.id);
      expect(light, entry.id).toBeDefined();
      expect(((entry.top - 3.79 + 0.005) / 3) % 1, entry.id).toBeCloseTo(0, 6);
      expect((light?.centre[1] ?? 0) + (light?.up[1] ?? 0) + 3.79, entry.id).toBeCloseTo(entry.top, 2);
    }
    // The frontage opposite and the length of Garth Street carry most of it.
    expect(lights.filter((light) => light.kind === "window").length).toBeGreaterThanOrEqual(45);
    expect(published.dropped.length).toBeLessThanOrEqual(10);
  });

  it("light the pavement before every lit shopfront and door, and nowhere else", () => {
    const fronts = lights.filter((light) => light.kind === "shop" || light.kind === "door");
    const spills = lights.filter((light) => light.kind === "spill");
    expect(spills.map((light) => light.id).sort()).toEqual([...new Set(fronts.map((light) => `${whole(light.id)}:spill`))].sort());
    for (const spill of spills) {
      const front = fronts.filter((light) => `${whole(light.id)}:spill` === spill.id);
      const first = front[0];
      if (first === undefined) throw new Error(`no shopfront for ${spill.id}`);
      // On the ground before its shopfront: below it, centred on the whole, no further out than its reach.
      const middle = front.reduce((sum, light) => sum + light.centre[0] + light.centre[2], 0) / front.length;
      expect(spill.centre[1]).toBeLessThan(first.centre[1] - 0.5);
      expect(Math.abs(spill.centre[0] + spill.centre[2] - middle - (spill.up[0] + spill.up[2]))).toBeLessThan(0.6);
      expect(Math.hypot(spill.up[0], spill.up[2])).toBeLessThan(2.5);
      expect(spill.seed).toBe(first.seed);
    }
  });

  it("seed each opening from its id alone (an office from its floor's), so the same ones light whatever the order or the look", () => {
    for (const light of lights) {
      const id = light.kind === "spill" ? light.id.replace(/:spill$/u, "") : whole(light.id);
      const floor = /^([a-z0-9-]+:f\d+)-[xz]/u.exec(id)?.[1];
      expect(light.seed, light.id).toBe(unitHash(`${light.use === "office" ? floor ?? "no floor" : id}:seed`));
      expect(light.variant, light.id).toBe(unitHash(`${light.kind === "spill" ? id : light.id}:variant`));
    }
    // An office floor lights together.
    const floors = new Map<string, Set<number>>();
    for (const light of lights.filter((entry) => entry.use === "office")) {
      const floor = /^([a-z0-9-]+:f\d+)-/u.exec(light.id)?.[1] ?? light.id;
      floors.set(floor, (floors.get(floor) ?? new Set<number>()).add(light.seed));
    }
    expect(floors.size).toBeGreaterThanOrEqual(8);
    for (const [floor, seeds] of floors) expect(seeds.size, floor).toBe(1);
    // A look's share lights the windows whose seeds are under it: more share, a superset.
    const lit = (share: number): string[] => lights.filter((light) => light.use === "office" && light.seed < share).map((light) => light.id);
    expect(lit(0.5)).toEqual(expect.arrayContaining(lit(0.3)));
  });

  it("stand on the published city model's walls, a few centimetres proud, and lie on its pavement", () => {
    const bytes = readFileSync(publicFile(CONTEXT_MODEL_URL));
    expect(published.inputs.model.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const model = parseContextModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const position = model.getAttribute("position");
    const index = model.getIndex();
    if (index === null) throw new Error("the model is indexed");
    const vertex = (i: number): Vec => [position.getX(i), position.getY(i), position.getZ(i)];
    const all: [Vec, Vec, Vec][] = [];
    for (let t = 0; t < index.count; t += 3) all.push([vertex(index.getX(t)), vertex(index.getX(t + 1)), vertex(index.getX(t + 2))]);
    for (const light of lights) {
      // The triangles whose extent in plan comes within 3 m of it (a wall's triangles can run 20 m along it).
      const near = all.filter((triangle) => [0, 2].every((axis) => {
        const values = triangle.map((vertex) => vertex[axis] ?? 0);
        const at = light.centre[axis] ?? 0;
        return at > Math.min(...values) - 3 && at < Math.max(...values) + 3;
      }));
      if (light.kind === "spill") {
        // The pavement just under it.
        const down = cast(near, [light.centre[0], light.centre[1] + 1, light.centre[2]], [0, -1, 0]) - 1;
        expect(down, light.id).toBeGreaterThan(0.005);
        expect(down, light.id).toBeLessThan(0.05);
        continue;
      }
      // Its wall behind it, within the bake's spread; nothing of the model in front of it.
      const length = Math.hypot(light.along[0], light.along[2]);
      const across: Vec = [-light.along[2] / length, 0, light.along[0] / length];
      const hits = [cast(near, light.centre, across), cast(near, light.centre, [-across[0], 0, -across[2]])];
      const behind = Math.min(...hits);
      expect(behind, light.id).toBeGreaterThan(0.02);
      expect(behind, light.id).toBeLessThan(0.03 + 0.45 + 0.01);
      expect(Math.max(...hits), light.id).toBeGreaterThan(0.5);
    }
  });

  it("carry their survey's licence: our own panoramas on the LiDAR model, nothing third-party", () => {
    expect(published.licence).toEqual(survey.licence);
    expect(published.licence["panoramas"]).toMatch(/our own capture/u);
    expect(published.licence["model"]).toMatch(/OGL v3\.0/u);
  });
});

describe("the surveyed walls", () => {
  it("cover the frontage opposite, Garth Street's north side and its end, and nothing near the hall", () => {
    expect(onSurveyedWall(9.88, -24.6)).toBe(true);
    expect(onSurveyedWall(-5.0, -45)).toBe(true);
    expect(onSurveyedWall(0, -82.5)).toBe(true);
    expect(onSurveyedWall(0, -6.3)).toBe(false);
    expect(onSurveyedWall(-30, -24.6)).toBe(false);
    for (const wall of FACADE_SURVEYED_WALLS) {
      expect(wall.x[0]).toBeLessThan(wall.x[1]);
      expect(wall.z[0]).toBeLessThan(wall.z[1]);
    }
  });
});

describe("the facade lights' geometry", () => {
  const lights: FacadeLight[] = parseFacadeLights(file([WINDOW, SPILL]));

  it("builds one quad a light, its corners at the centre plus and minus its half-extents, sized in metres", () => {
    const geometry = buildFacadeLightGeometry(lights);
    expect(geometry.getAttribute("position").count).toBe(8);
    expect(geometry.getIndex()?.count).toBe(12);
    const p = geometry.getAttribute("position");
    expect(p.getX(0)).toBeCloseTo(9.38, 5);
    expect(p.getY(0)).toBeCloseTo(-2.79, 5);
    expect(p.getX(2)).toBeCloseTo(10.38, 5);
    expect(p.getY(2)).toBeCloseTo(-0.79, 5);
    const size = geometry.getAttribute("facadeSize");
    expect(size.getX(0)).toBeCloseTo(1, 6);
    expect(size.getY(0)).toBeCloseTo(2, 6);
    expect(geometry.getAttribute("facadeKind").getX(4)).toBe(FACADE_KINDS.indexOf("spill"));
    expect(geometry.getAttribute("facadeLight").getX(0)).toBe(lightClassIndex("office"));
    expect(geometry.getAttribute("facadeSeed").getX(0)).toBeCloseTo(0.25, 6);
    expect(geometry.boundingSphere?.radius ?? 0).toBeGreaterThan(1);
    geometry.dispose();
  });

  it("puts a spill's v = 0 at its shopfront, so its light falls away across the pavement", () => {
    const geometry = buildFacadeLightGeometry(lights);
    const p = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    // The spill's corners 4..7: v = 0 on the side nearer its wall (z -24.65), v = 1 out in the street.
    for (let i = 4; i < 8; i++) expect(uv.getY(i) === 0 ? p.getZ(i) < -24 : p.getZ(i) > -22).toBe(true);
    geometry.dispose();
  });

  it("numbers every light class the shader knows", () => {
    expect(FACADE_LIGHT_CLASSES.map(lightClassIndex)).toEqual(FACADE_LIGHT_CLASSES.map((_, i) => i));
  });
});

describe("the facades by night", () => {
  it("light from the start of dusk down, never by day", () => {
    expect(facadesLit(10)).toBe(false);
    expect(facadesLit(DUSK_SPAN.from + 0.01)).toBe(false);
    expect(facadesLit(DUSK_SPAN.from - 0.01)).toBe(true);
    expect(facadesLit(-18)).toBe(true);
  });

  it("take their colours and shares from the night look, and the look before the lamps lights none", () => {
    const u = streetLookUniforms;
    expect(u.facadeOfficeShare.value).toBe(STREET_NIGHT_LOOKS.evocative.facades.officeShare);
    expect(u.facadeSignTeal.value.toArray()).toEqual([...STREET_NIGHT_LOOKS.evocative.facades.signTeal]);
    applyStreetLook(STREET_NIGHT_LOOKS.off);
    expect([u.facadeOfficeShare.value, u.facadeHomeShare.value, u.facadeSpill.value]).toEqual([0, 0, 0]);
    expect(u.facadePub.value.toArray()).toEqual([0, 0, 0]);
    applyStreetLook(STREET_NIGHT_LOOKS.evocative);
    expect(u.facadeHomeShare.value).toBe(STREET_NIGHT_LOOKS.evocative.facades.homeShare);
  });
});
