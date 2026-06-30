import { type LightingFixtureFamily } from "./photometrics.js";
import { parseGdtfDescription, gdtfFixtureFamily } from "./gdtf.js";
import { readGdtfArchive } from "./gdtf-archive.js";

// ---------------------------------------------------------------------------
// mvr — MVR scene parsing + rig resolution (Epic 6 import, slice 6).
//
// An `.mvr` (My Virtual Rig) file is a ZIP of a `GeneralSceneDescription.xml`
// scene plus the embedded `.gdtf` fixture definitions it references. This module
// has two layers:
//   • parseMvrScene(xml) — PURE (DOMParser only): the scene → a typed list of
//     fixtures, each with its GDTFSpec/GDTFMode, DMX addresses, FixtureID, and
//     position. Testable without ZIP.
//   • resolveMvrRig(scene, gdtfFiles) — groups the scene's fixtures by type and
//     resolves each against its embedded GDTF (real DMX footprint + weight +
//     family), so a whole rig can be added to the planner's rig at once.
//
// The archive layer (readMvrArchive, lib/gdtf-archive.ts) does the unzip; this
// module never touches ZIP bytes directly except via readGdtfArchive on the
// already-extracted embedded fixtures.
//
// SAFE: figures come from the file. Positions are parsed for a later 3D slice but
// are not yet placed in the scene. DMX/power/rigging downstream stay indicative.
// ---------------------------------------------------------------------------

export interface MvrVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MvrAddress {
  /** DMX break (universe break index); 0 for the first/only break. */
  readonly dmxBreak: number;
  /** Absolute 1-based DMX address across universes. */
  readonly address: number;
  readonly universe: number;
  readonly channel: number;
}

export interface MvrFixture {
  readonly name: string;
  readonly uuid: string | null;
  /** Embedded `.gdtf` filename this fixture references. */
  readonly gdtfSpec: string | null;
  readonly gdtfMode: string | null;
  readonly fixtureId: string | null;
  readonly unitNumber: string | null;
  readonly addresses: readonly MvrAddress[];
  /** Position in metres (MVR stores millimetres), or null when absent. */
  readonly position: MvrVec3 | null;
}

export interface MvrScene {
  readonly fixtures: readonly MvrFixture[];
}

export type MvrParseResult =
  | { readonly ok: true; readonly scene: MvrScene }
  | { readonly ok: false; readonly error: string };

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function childText(scope: Element, tag: string): string | null {
  const list = scope.getElementsByTagName(tag);
  const el = list.length > 0 ? list.item(0) : null;
  const text = el?.textContent?.trim();
  return text !== undefined && text.length > 0 ? text : null;
}

function attr(el: Element, name: string): string | null {
  const value = el.getAttribute(name);
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** MVR transform is `{r0}{r1}{r2}{tx,ty,tz}` in mm; take the translation triple. */
function parseMatrixPosition(scope: Element): MvrVec3 | null {
  const matrixText = childText(scope, "Matrix");
  if (matrixText === null) return null;
  const triples = [...matrixText.matchAll(/\{([^}]*)\}/g)].map((m) => m[1] ?? "");
  const translation = triples[3];
  if (translation === undefined) return null;
  const parts = translation.split(",").map((s) => Number.parseFloat(s.trim()));
  const [x, y, z] = parts;
  if (x === undefined || y === undefined || z === undefined) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x: x / 1000, y: y / 1000, z: z / 1000 };
}

function parseAddresses(fixtureEl: Element): MvrAddress[] {
  const addresses: MvrAddress[] = [];
  for (const el of Array.from(fixtureEl.getElementsByTagName("Address"))) {
    const value = Number.parseInt(el.textContent?.trim() ?? "", 10);
    if (!Number.isFinite(value) || value <= 0) continue;
    const breakValue = Number.parseInt(el.getAttribute("break") ?? "0", 10);
    addresses.push({
      dmxBreak: Number.isFinite(breakValue) ? breakValue : 0,
      address: value,
      universe: Math.floor((value - 1) / 512) + 1,
      channel: ((value - 1) % 512) + 1,
    });
  }
  return addresses;
}

function parseFixture(fixtureEl: Element): MvrFixture {
  return {
    name: attr(fixtureEl, "name") ?? "Fixture",
    uuid: attr(fixtureEl, "uuid") ?? attr(fixtureEl, "UUID"),
    gdtfSpec: childText(fixtureEl, "GDTFSpec"),
    gdtfMode: childText(fixtureEl, "GDTFMode"),
    fixtureId: childText(fixtureEl, "FixtureID"),
    unitNumber: childText(fixtureEl, "UnitNumber"),
    addresses: parseAddresses(fixtureEl),
    position: parseMatrixPosition(fixtureEl),
  };
}

/**
 * Parse a `GeneralSceneDescription.xml` into a typed list of fixtures. Pure;
 * never throws — malformed input or a missing root yields `{ ok: false, error }`.
 */
export function parseMvrScene(xml: string): MvrParseResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return { ok: false, error: "MVR scene could not be parsed as XML." };
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { ok: false, error: "MVR scene is not well-formed XML." };
  }
  if (doc.getElementsByTagName("GeneralSceneDescription").length === 0) {
    return { ok: false, error: "No <GeneralSceneDescription> — not an MVR scene." };
  }
  const fixtures = Array.from(doc.getElementsByTagName("Fixture")).map(parseFixture);
  return { ok: true, scene: { fixtures } };
}

export interface ResolvedMvrFixtureType {
  readonly gdtfSpec: string;
  readonly manufacturer: string;
  readonly name: string;
  readonly modeName: string;
  readonly channels: number;
  readonly weightKg: number | null;
  readonly family: LightingFixtureFamily;
  readonly count: number;
}

export interface ResolvedMvrRig {
  /** One entry per distinct (GDTFSpec, mode), with the count of fixtures. */
  readonly types: readonly ResolvedMvrFixtureType[];
  /** Total fixtures resolved across all types. */
  readonly fixtureCount: number;
  /** GDTFSpecs that could not be resolved (missing embed, parse error, no modes). */
  readonly unresolved: readonly string[];
}

/**
 * Resolve a parsed MVR scene against its embedded GDTF catalogue: group fixtures
 * by (GDTFSpec, mode), unzip + parse each referenced GDTF, and read the real DMX
 * footprint / weight / family for that mode. Async (nested unzip). Pure w.r.t.
 * its inputs — no global state.
 */
export async function resolveMvrRig(
  scene: MvrScene,
  gdtfFiles: ReadonlyMap<string, Uint8Array>,
): Promise<ResolvedMvrRig> {
  const groups = new Map<string, { spec: string; mode: string; count: number }>();
  for (const fixture of scene.fixtures) {
    if (fixture.gdtfSpec === null) continue;
    const mode = fixture.gdtfMode ?? "";
    const key = `${fixture.gdtfSpec} ${mode}`;
    const existing = groups.get(key);
    if (existing !== undefined) existing.count += 1;
    else groups.set(key, { spec: fixture.gdtfSpec, mode, count: 1 });
  }

  const types: ResolvedMvrFixtureType[] = [];
  const unresolved: string[] = [];
  let fixtureCount = 0;

  for (const group of groups.values()) {
    const bytes = gdtfFiles.get(basename(group.spec));
    if (bytes === undefined) { unresolved.push(group.spec); continue; }
    const archive = await readGdtfArchive(bytes);
    if (!archive.ok) { unresolved.push(group.spec); continue; }
    const parsed = parseGdtfDescription(archive.archive.descriptionXml);
    if (!parsed.ok || parsed.fixture.modes.length === 0) { unresolved.push(group.spec); continue; }
    const fixture = parsed.fixture;
    const mode = fixture.modes.find((m) => m.name.toLowerCase() === group.mode.toLowerCase()) ?? fixture.modes[0];
    if (mode === undefined) { unresolved.push(group.spec); continue; }
    types.push({
      gdtfSpec: group.spec,
      manufacturer: fixture.manufacturer,
      name: fixture.name,
      modeName: mode.name,
      channels: mode.channelFootprint,
      weightKg: fixture.physical.weightKg,
      family: gdtfFixtureFamily(fixture) ?? "par",
      count: group.count,
    });
    fixtureCount += group.count;
  }

  return { types, fixtureCount, unresolved };
}

export const MVR_IMPORT_DISCLAIMER =
  "Imported from an MVR scene: fixture types, modes, and DMX footprints are read from the file's embedded GDTF "
  + "definitions. Positions and addresses are captured for reference; downstream DMX, power, and rigging figures "
  + "remain indicative planning, not a verified patch.";
