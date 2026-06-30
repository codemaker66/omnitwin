import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, TextWriter, configure, type FileEntry } from "@zip.js/zip.js";

// ---------------------------------------------------------------------------
// gdtf-archive — the GDTF/MVR archive layer (Epic 6 import, slice 3).
//
// A `.gdtf` file is a ZIP of `description.xml` + 3D models; `.mvr` is a ZIP of a
// scene description + embedded `.gdtf` files. This module is the archive layer
// (layer 1 of the research pipeline): it unzips the bytes and hands the raw
// `description.xml` text to lib/gdtf.ts's pure parser. Keeping unzip separate
// means the parser stays pure/testable and the dependency (zip.js) lives behind
// this one boundary.
//
// Web Workers are disabled so this runs identically in the app and in tests; the
// Uint8Array reader avoids Blob/DecompressionStream plumbing entirely.
// ---------------------------------------------------------------------------

configure({ useWebWorkers: false });

const DESCRIPTION_FILENAME = "description.xml";

export interface GdtfArchive {
  /** Raw `description.xml` text, ready for parseGdtfDescription. */
  readonly descriptionXml: string;
  /** Bundled 3D model files (models/…) keyed by path → bytes. Empty unless the
   *  caller asked for them (includeModels), so MVR catalogue resolution stays lean. */
  readonly models: ReadonlyMap<string, Uint8Array>;
}

export type GdtfArchiveResult =
  | { readonly ok: true; readonly archive: GdtfArchive }
  | { readonly ok: false; readonly error: string };

export interface ReadGdtfOptions {
  /** Extract the bundled `models/*` 3D files (for the fixture preview). Default off. */
  readonly includeModels?: boolean;
}

function isRootDescription(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower === DESCRIPTION_FILENAME || lower.endsWith(`/${DESCRIPTION_FILENAME}`);
}

/**
 * Read a `.gdtf` archive's bytes and extract its `description.xml` + the list of
 * bundled model files. Never throws — a non-ZIP or a ZIP without a description
 * yields `{ ok: false, error }`. Async (unzip + decode are async in zip.js).
 */
export async function readGdtfArchive(
  data: Uint8Array | ArrayBuffer,
  options: ReadGdtfOptions = {},
): Promise<GdtfArchiveResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    const files = entries.filter((entry): entry is FileEntry => !entry.directory);
    const descEntry = files.find((entry) => isRootDescription(entry.filename));
    if (descEntry === undefined) {
      return { ok: false, error: "No description.xml in the archive — is this a .gdtf file?" };
    }
    const descriptionXml = await descEntry.getData(new TextWriter());
    const models = new Map<string, Uint8Array>();
    if (options.includeModels === true) {
      for (const entry of files) {
        if (/^models\//i.test(entry.filename)) {
          models.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
        }
      }
    }
    return { ok: true, archive: { descriptionXml, models } };
  } catch {
    return { ok: false, error: "Could not read the GDTF archive — it is not a valid ZIP file." };
  } finally {
    await reader.close().catch(() => undefined);
  }
}

const SCENE_FILENAME = "generalscenedescription.xml";

export interface MvrArchive {
  /** Raw `GeneralSceneDescription.xml` text, ready for parseMvrScene. */
  readonly sceneXml: string;
  /** Embedded `.gdtf` files keyed by their basename (the scene's GDTFSpec value). */
  readonly gdtfFiles: ReadonlyMap<string, Uint8Array>;
}

export type MvrArchiveResult =
  | { readonly ok: true; readonly archive: MvrArchive }
  | { readonly ok: false; readonly error: string };

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * Read an `.mvr` archive's bytes and extract its scene description + the embedded
 * `.gdtf` files (the fixture catalogue), keyed by basename so a scene fixture's
 * GDTFSpec resolves directly. Never throws. Async.
 */
export async function readMvrArchive(data: Uint8Array | ArrayBuffer): Promise<MvrArchiveResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    const files = entries.filter((entry): entry is FileEntry => !entry.directory);
    const sceneEntry = files.find((entry) => basename(entry.filename).toLowerCase() === SCENE_FILENAME);
    if (sceneEntry === undefined) {
      return { ok: false, error: "No GeneralSceneDescription.xml in the archive — is this a .mvr file?" };
    }
    const sceneXml = await sceneEntry.getData(new TextWriter());
    const gdtfFiles = new Map<string, Uint8Array>();
    for (const entry of files) {
      if (entry.filename.toLowerCase().endsWith(".gdtf")) {
        gdtfFiles.set(basename(entry.filename), await entry.getData(new Uint8ArrayWriter()));
      }
    }
    return { ok: true, archive: { sceneXml, gdtfFiles } };
  } catch {
    return { ok: false, error: "Could not read the MVR archive — it is not a valid ZIP file." };
  } finally {
    await reader.close().catch(() => undefined);
  }
}
