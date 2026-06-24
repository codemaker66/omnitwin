import { ZipReader, Uint8ArrayReader, TextWriter, configure, type FileEntry } from "@zip.js/zip.js";

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
  /** Paths of bundled 3D model files (models/…) — for the later 3D slice. */
  readonly modelFiles: readonly string[];
}

export type GdtfArchiveResult =
  | { readonly ok: true; readonly archive: GdtfArchive }
  | { readonly ok: false; readonly error: string };

function isRootDescription(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower === DESCRIPTION_FILENAME || lower.endsWith(`/${DESCRIPTION_FILENAME}`);
}

/**
 * Read a `.gdtf` archive's bytes and extract its `description.xml` + the list of
 * bundled model files. Never throws — a non-ZIP or a ZIP without a description
 * yields `{ ok: false, error }`. Async (unzip + decode are async in zip.js).
 */
export async function readGdtfArchive(data: Uint8Array | ArrayBuffer): Promise<GdtfArchiveResult> {
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
    const modelFiles = files
      .map((entry) => entry.filename)
      .filter((name) => /^models\//i.test(name));
    return { ok: true, archive: { descriptionXml, modelFiles } };
  } catch {
    return { ok: false, error: "Could not read the GDTF archive — it is not a valid ZIP file." };
  } finally {
    await reader.close().catch(() => undefined);
  }
}
