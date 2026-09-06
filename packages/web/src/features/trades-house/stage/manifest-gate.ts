// -----------------------------------------------------------------------------
// manifest-gate — what a scene manifest must satisfy beyond its zod shape.
//
// The schema says what a field is; this says what the scene means: every
// cue a row names exists, every box lies on the paper, the latch is short,
// the Lantern plane and the Lantern program agree, every plane and cue has a
// complete provenance card (the owner's override of 2026-09-06: made
// digitally, but always declared). Returns issues rather than throwing so a
// test can list every fault of a manifest in one run and a DEV page can show
// them. Imports nothing from the instrument.
// -----------------------------------------------------------------------------
import { boxInsideStage } from "./stage-geometry.js";
import {
  LANTERN_PROGRAMS,
  MAX_LATCH_WORDS,
  SceneManifestSchema,
  latchWordCount,
  type Provenance,
  type SceneManifest,
} from "./stage-manifest.js";

export interface ManifestIssue {
  /** Dotted path into the manifest: "props.2.states.0.cue". */
  readonly path: string;
  readonly message: string;
}

export interface ManifestGateOptions {
  /** The keys of the scene's PlaneRegistry; when given, every svg plane's src must be one. */
  readonly registryKeys?: readonly string[];
}

/** Every image plane and every cue file lives here (Appendix A section 3). */
export const STAGE_MEDIA_ROOT = "/trades-house-media/stage/";
/** Section 9: at most 600 KB of planes per scene on desktop. */
export const MAX_PLANE_BYTES_PER_SCENE = 600_000;
/** Section 9: at most 120 KB of ink per scene. */
export const MAX_INK_BYTES = 120_000;
/** StageRowSchema: at most one row per scene may carry an aside. */
export const MAX_ASIDES_PER_SCENE = 1;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** A real calendar date in YYYY-MM-DD, checked arithmetically (no Date construction). */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const length = DAYS_IN_MONTH[month - 1] ?? 0;
  const limit = month === 2 && isLeapYear(year) ? 29 : length;
  return day <= limit;
}

/** True for a value shaped like a scene manifest, before validation: how a test finds the export in a scene module. */
export function looksLikeSceneManifest(value: unknown): value is { readonly sceneIndex: number } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["sceneIndex"] === "number" && Array.isArray(record["planes"]);
}

function provenanceIssues(card: Provenance, path: string): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const blank = (text: string): boolean => text.trim().length === 0;
  if (blank(card.tool)) issues.push({ path: `${path}.tool`, message: "the tool that made it is blank" });
  if (blank(card.licence)) issues.push({ path: `${path}.licence`, message: "the licence is blank" });
  if (blank(card.touchedBy)) issues.push({ path: `${path}.touchedBy`, message: "the person who touched it is blank" });
  if (!isCalendarDate(card.fetchedOn)) issues.push({ path: `${path}.fetchedOn`, message: `"${card.fetchedOn}" is not a calendar date` });
  if (card.kind === "G" && (card.prompt === undefined || blank(card.prompt))) {
    issues.push({ path: `${path}.prompt`, message: "kind G (generated) must record the exact prompt sent" });
  }
  if (card.kind === "Pr" && (card.prompt === undefined || blank(card.prompt))) {
    issues.push({ path: `${path}.prompt`, message: "kind Pr (procedural) must name the source file that draws it" });
  }
  return issues;
}

function duplicateIssues(ids: readonly string[], path: string, noun: string): ManifestIssue[] {
  const seen = new Set<string>();
  const issues: ManifestIssue[] = [];
  ids.forEach((id, index) => {
    if (seen.has(id)) issues.push({ path: `${path}.${String(index)}.id`, message: `duplicate ${noun} "${id}"` });
    seen.add(id);
  });
  return issues;
}

function semanticIssues(scene: SceneManifest, options: ManifestGateOptions): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const push = (path: string, message: string): void => { issues.push({ path, message }); };

  // ---- the latch ----
  const words = latchWordCount(scene.latch);
  if (words > MAX_LATCH_WORDS) push("latch", `${String(words)} words; the latch is at most ${String(MAX_LATCH_WORDS)}`);
  if (scene.latch.includes("?")) push("latch", "the latch names the next place or object; it asks no question");

  // ---- identity ----
  issues.push(...duplicateIssues(scene.planes.map((plane) => plane.id), "planes", "plane id"));
  issues.push(...duplicateIssues(scene.audio.cues.map((cue) => cue.id), "audio.cues", "cue id"));
  issues.push(...duplicateIssues(scene.props.map((prop) => prop.id), "props", "prop id"));

  // ---- planes ----
  let planeBytes = 0;
  const lanternPlanes: SceneManifest["planes"] = [];
  scene.planes.forEach((plane, index) => {
    const path = `planes.${String(index)}`;
    planeBytes += plane.bytes;
    issues.push(...provenanceIssues(plane.provenance, `${path}.provenance`));
    if (plane.kind === "image" && !plane.src.startsWith(STAGE_MEDIA_ROOT)) {
      push(`${path}.src`, `an image plane is served from ${STAGE_MEDIA_ROOT}`);
    }
    if (plane.kind === "svg" && options.registryKeys !== undefined && !options.registryKeys.includes(plane.src)) {
      push(`${path}.src`, `svg plane "${plane.src}" is not in the scene's plane registry`);
    }
    if (plane.kind === "lantern") {
      lanternPlanes.push(plane);
      if (!(LANTERN_PROGRAMS as readonly string[]).includes(plane.src)) {
        push(`${path}.src`, `"${plane.src}" is not a Lantern program`);
      }
    }
  });
  if (planeBytes > MAX_PLANE_BYTES_PER_SCENE) {
    push("planes", `${String(planeBytes)} bytes of planes; at most ${String(MAX_PLANE_BYTES_PER_SCENE)} per scene`);
  }
  if (scene.lantern === "none") {
    if (lanternPlanes.length > 0) push("lantern", "the manifest names no Lantern program but carries a lantern plane");
  } else if (lanternPlanes.length !== 1) {
    push("planes", `program "${scene.lantern}" needs exactly one lantern plane; found ${String(lanternPlanes.length)}`);
  } else if (lanternPlanes[0]?.src !== scene.lantern) {
    push("lantern", `the lantern plane runs "${lanternPlanes[0]?.src ?? ""}" but the manifest names "${scene.lantern}"`);
  }

  // ---- ink ----
  if (scene.ink !== null) {
    const inkPlaneId = scene.ink.planeId;
    const inkPlane = scene.planes.find((plane) => plane.id === inkPlaneId);
    if (inkPlane === undefined) push("ink.planeId", `no plane "${inkPlaneId}" for the ink to draw on`);
    else if (inkPlane.kind !== "svg") push("ink.planeId", "the ink draws on an svg plane");
    if (scene.ink.bytes > MAX_INK_BYTES) push("ink.bytes", `${String(scene.ink.bytes)} bytes of ink; at most ${String(MAX_INK_BYTES)}`);
  }

  // ---- cues ----
  const cueIds = new Set(scene.audio.cues.map((cue) => cue.id));
  scene.audio.cues.forEach((cue, index) => {
    const path = `audio.cues.${String(index)}`;
    issues.push(...provenanceIssues(cue.provenance, `${path}.provenance`));
    if (!cue.file.startsWith(STAGE_MEDIA_ROOT)) push(`${path}.file`, `a cue is served from ${STAGE_MEDIA_ROOT}`);
    if (cue.caption.trim().length === 0) push(`${path}.caption`, "every cue has a caption");
  });
  scene.audio.oneShots.forEach((shot, index) => {
    const path = `audio.oneShots.${String(index)}`;
    if (!cueIds.has(shot.cue)) push(`${path}.cue`, `cue "${shot.cue}" is not in audio.cues`);
    if (shot.everyMsMin > shot.everyMsMax) push(path, "everyMsMin is above everyMsMax");
  });

  // ---- props ----
  let asides = 0;
  scene.props.forEach((prop, index) => {
    const path = `props.${String(index)}`;
    if (!boxInsideStage(prop.box)) push(`${path}.box`, `the box for "${prop.id}" leaves the stage (x+w or y+h above 100)`);
    if (prop.label.trim().length === 0) push(`${path}.label`, "a pokeable needs a layperson's name");
    const numericAts = new Set<number>();
    prop.states.forEach((row, rowIndex) => {
      const rowPath = `${path}.states.${String(rowIndex)}`;
      if (row.cue !== null && !cueIds.has(row.cue)) push(`${rowPath}.cue`, `cue "${row.cue}" is not in audio.cues`);
      if (typeof row.at === "number") {
        if (numericAts.has(row.at)) push(`${rowPath}.at`, `two rows of "${prop.id}" fire at count ${String(row.at)}`);
        numericAts.add(row.at);
      }
      if (row.aside !== undefined && row.aside.trim().length > 0) asides += 1;
    });
  });
  if (asides > MAX_ASIDES_PER_SCENE) push("props", `${String(asides)} asides; at most one row per scene may carry one`);

  // ---- Thursday ----
  if (scene.thursday !== null && !boxInsideStage(scene.thursday.box)) {
    push("thursday.box", "Thursday's box leaves the stage");
  }

  return issues;
}

/**
 * Every issue with a manifest: the zod shape first (returned alone when the
 * shape is wrong, since nothing else can be read), then the scene's meaning.
 * An empty array is the pass.
 */
export function validateSceneManifest(manifest: unknown, options: ManifestGateOptions = {}): readonly ManifestIssue[] {
  const parsed = SceneManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? "(root)" : issue.path.map(String).join("."),
      message: issue.message,
    }));
  }
  return semanticIssues(parsed.data, options);
}
