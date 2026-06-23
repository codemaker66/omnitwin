import { LIGHTING_FIXTURE_FAMILIES, type LightingFixtureFamily } from "./photometrics.js";

// ---------------------------------------------------------------------------
// gdtf — GDTF fixture-definition parser, semantic core (Epic 6 fixture import).
//
// First slice of GDTF/MVR import. A `.gdtf` file is a ZIP of `description.xml`
// plus 3D models; this module parses the DESCRIPTION (layers 2-3 of the research's
// archive → XML → semantic → asset pipeline) into a normalized, typed fixture
// model. The archive layer (unzip) and the 3D-mesh layer (glTF) are deliberately
// separate later slices — keeping this pure means it needs only a DOMParser, runs
// in a Web Worker later, and is fully unit-testable without ZIP or WebGL.
//
// Why this first: the Lighting / Power / Rigging lenses currently use INDICATIVE
// per-family defaults (FIXTURE_FAMILY_DMX_CHANNELS / _WATTS). A parsed GDTF gives
// the REAL DMX footprint (and, best-effort, weight) of an actual manufacturer
// fixture, so an imported device can replace the guess in the rig.
//
// IN scope: fixture identity (manufacturer / model / id), revisions, and each DMX
// mode's channel footprint (the contiguous block of DMX channels to reserve) +
// raw channel list. Best-effort physical weight. A heuristic mapping from a GDTF
// fixture to our LightingFixtureFamily taxonomy.
//
// OUT of scope (later slices, see the epic plan): ZIP extraction (zip.js), 3D
// model loading (three.js GLTFLoader), the full DMX hierarchy (logical channels /
// channel functions / sets / relations), emitters/filters colorimetry, power
// consumption, wheels, and MVR scene import.
//
// SAFE: figures here are READ FROM THE FILE, not computed by us, but real fixtures
// and modes still vary — the importer is a planning aid, and the physical block in
// particular is best-effort until validated against a real GDTF corpus. See
// GDTF_IMPORT_DISCLAIMER. The DMX footprint still flows through the indicative
// DMX/Power/Rigging lenses, which carry their own planning disclaimers.
// ---------------------------------------------------------------------------

/** One DMX channel within a mode — kept raw enough to inspect / round-trip later. */
export interface GdtfDmxChannel {
  /** The channel's host geometry (@Geometry), if named. */
  readonly geometry: string | null;
  /** Parsed @Offset DMX addresses (e.g. "1,2" → [1, 2]); empty for virtual channels. */
  readonly offsets: readonly number[];
}

export interface GdtfDmxMode {
  readonly name: string;
  readonly geometry: string | null;
  readonly channels: readonly GdtfDmxChannel[];
  /** Highest DMX offset used — the size of the contiguous block to patch. */
  readonly channelFootprint: number;
  /** Distinct DMX offsets actually occupied (≤ footprint when there are gaps). */
  readonly usedChannels: number;
}

export interface GdtfRevision {
  readonly text: string;
  /** ISO date string from @Date, or null when absent. */
  readonly date: string | null;
}

/** Best-effort physical data — validate against a real corpus before relying on it. */
export interface GdtfPhysical {
  readonly weightKg: number | null;
}

export interface GdtfFixture {
  readonly manufacturer: string;
  /** Model name — prefers @LongName, falling back to @Name. */
  readonly name: string;
  readonly shortName: string | null;
  readonly fixtureTypeId: string | null;
  readonly revisions: readonly GdtfRevision[];
  readonly modes: readonly GdtfDmxMode[];
  readonly physical: GdtfPhysical;
}

export type GdtfParseResult =
  | { readonly ok: true; readonly fixture: GdtfFixture }
  | { readonly ok: false; readonly error: string };

/** Trimmed attribute value, or null when missing/empty. */
function attr(el: Element, name: string): string | null {
  const value = el.getAttribute(name);
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** First descendant element with the given (case-sensitive) tag, or null. */
function firstByTag(scope: Element | Document, tag: string): Element | null {
  const list = scope.getElementsByTagName(tag);
  return list.length > 0 ? (list.item(0) ?? null) : null;
}

/** Parse a GDTF @Offset string ("1,2" / "3" / "None" / "") into DMX addresses. */
function parseOffsets(raw: string | null): number[] {
  if (raw === null) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

function parseMode(modeEl: Element): GdtfDmxMode {
  const channelEls = Array.from(modeEl.getElementsByTagName("DMXChannel"));
  const channels: GdtfDmxChannel[] = [];
  const occupied = new Set<number>();
  let footprint = 0;
  for (const channelEl of channelEls) {
    const offsets = parseOffsets(channelEl.getAttribute("Offset"));
    for (const offset of offsets) {
      occupied.add(offset);
      if (offset > footprint) footprint = offset;
    }
    channels.push({ geometry: attr(channelEl, "Geometry"), offsets });
  }
  return {
    name: attr(modeEl, "Name") ?? "Mode",
    geometry: attr(modeEl, "Geometry"),
    channels,
    channelFootprint: footprint,
    usedChannels: occupied.size,
  };
}

/**
 * Parse a GDTF `description.xml` document into a normalized fixture model. Pure:
 * takes the XML text (already extracted from the `.gdtf` ZIP by a caller) and
 * returns a typed result; never throws into the UI — malformed input or a missing
 * FixtureType yields `{ ok: false, error }`.
 */
export function parseGdtfDescription(xml: string): GdtfParseResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return { ok: false, error: "GDTF description could not be parsed as XML." };
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { ok: false, error: "GDTF description is not well-formed XML." };
  }

  const fixtureType = firstByTag(doc, "FixtureType");
  if (fixtureType === null) {
    return { ok: false, error: "No <FixtureType> element — not a GDTF description." };
  }

  const name = attr(fixtureType, "LongName") ?? attr(fixtureType, "Name") ?? "Unnamed fixture";
  const manufacturer = attr(fixtureType, "Manufacturer") ?? "Unknown";

  const revisions: GdtfRevision[] = Array.from(fixtureType.getElementsByTagName("Revision")).map((revEl) => ({
    text: attr(revEl, "Text") ?? "",
    date: attr(revEl, "Date"),
  }));

  const modes: GdtfDmxMode[] = Array.from(fixtureType.getElementsByTagName("DMXMode")).map(parseMode);

  const weightEl = firstByTag(fixtureType, "Weight");
  const weightValue = weightEl !== null ? Number.parseFloat(weightEl.getAttribute("Value") ?? "") : Number.NaN;
  const weightKg = Number.isFinite(weightValue) && weightValue > 0 ? weightValue : null;

  return {
    ok: true,
    fixture: {
      manufacturer,
      name,
      shortName: attr(fixtureType, "ShortName"),
      fixtureTypeId: attr(fixtureType, "FixtureTypeID"),
      revisions,
      modes,
      physical: { weightKg },
    },
  };
}

/** Keyword → family rules, checked in order so specific terms win (PAR before bar). */
const FAMILY_KEYWORDS: ReadonlyArray<readonly [LightingFixtureFamily, readonly string[]]> = [
  ["profile", ["profile", "ellipsoidal", "leko", "source four", "source 4"]],
  ["fresnel", ["fresnel"]],
  ["beam-hybrid", ["beam", "hybrid"]],
  ["wash", ["wash", "zoom wash"]],
  ["spot", ["spot"]],
  ["par", ["par", "parcan"]],
  ["blinder-strobe", ["blinder", "strobe", "sunstrip"]],
  ["batten-strip", ["batten", "strip", "pixel bar", "pixelbar", "bar"]],
];

/**
 * Heuristic mapping from a parsed GDTF fixture to our planning taxonomy, so an
 * imported device can slot into the rig. Matches on the model name; returns null
 * when nothing matches (the caller keeps its own family choice).
 */
export function gdtfFixtureFamily(fixture: GdtfFixture): LightingFixtureFamily | null {
  const haystack = `${fixture.name} ${fixture.shortName ?? ""}`.toLowerCase();
  for (const [family, keywords] of FAMILY_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return family;
  }
  return null;
}

/** The set of families this importer can map onto (for tests / UI affordances). */
export const GDTF_MAPPABLE_FAMILIES: readonly LightingFixtureFamily[] = LIGHTING_FIXTURE_FAMILIES;

export const GDTF_IMPORT_DISCLAIMER =
  "Fixture data is read from the imported GDTF file, not measured by us. DMX footprints and physical figures "
  + "vary by fixture and mode and should be confirmed against the manufacturer's data; this importer is a "
  + "planning aid, and downstream DMX, power, and rigging figures remain indicative.";
