import { open, rm } from "node:fs/promises";
import type { OutputFile } from "./api.js";

/**
 * Which of a session's outputs come to this machine, and under what names.
 *
 * Only the files the review reads are downloaded: the format-patch files
 * (`NNNN-<subject>.patch`, as `git format-patch` names them), `diff.patch` and
 * `precondition.json`. Each is saved under a name the launcher chooses
 * (`patch-0001.patch`, ..., `diff.patch`, `precondition.json`), never the
 * agent's. A listed size over the cap is refused before anything is
 * downloaded, and the download itself is cut off at the cap. Any other output
 * ending in `.patch`, or more than MAX_PATCH_OUTPUTS of them, is refused, so the
 * review rejects the run rather than ignore a patch it cannot account for; every
 * other output (logs, the verifier's JSON) stays in the sandbox.
 */

/** The largest one output can be. A large generated change fits; a runaway log renamed .patch does not. */
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** The largest a run's downloads can be together. */
export const MAX_OUTPUTS_TOTAL_BYTES = 64 * 1024 * 1024;
/** The most .patch outputs a run may leave: past this none is read, and the run is rejected. */
export const MAX_PATCH_OUTPUTS = 50;

export interface OutputPlan {
  /** In the order the review reads them: the format-patch files by name, then diff.patch, then precondition.json. */
  readonly downloads: readonly { readonly file: OutputFile; readonly localName: string }[];
  /** Why a listed output the launcher would read was not downloaded; each rejects the run. */
  readonly refused: readonly string[];
  /** Outputs the review does not read, left in the sandbox. */
  readonly left: readonly string[];
}

const FORMAT_PATCH = /^\d{4,}-[A-Za-z0-9._-]*\.patch$/u;
const DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/iu;

/**
 * A path segment Windows opens as a device whatever its extension: CON, PRN,
 * AUX, NUL, COM0-9, LPT0-9 (and the superscript forms), CONIN$ and CONOUT$, in
 * any case, with trailing spaces or dots dropped as Windows drops them.
 */
export function isWindowsDeviceName(segment: string): boolean {
  const stem = (segment.split(/[.:]/u)[0] ?? "").replace(/ +$/u, "");
  return DEVICE.test(stem);
}

function segmentsOf(filename: string): string[] {
  return filename
    .replace(/\\/gu, "/")
    .split("/")
    .filter((part) => part !== "");
}

/** Decides, from the listing alone, what to download and under what names. Nothing is fetched. */
export function planOutputs(files: readonly OutputFile[]): OutputPlan {
  const refused: string[] = [];
  const left: string[] = [];
  const patches: OutputFile[] = [];
  const diffs: OutputFile[] = [];
  const preconditions: OutputFile[] = [];
  const baseOf = (file: OutputFile): string => segmentsOf(file.filename).pop() ?? "";
  const patchOutputs = files.filter((file) => baseOf(file).toLowerCase().endsWith(".patch")).length;
  if (patchOutputs > MAX_PATCH_OUTPUTS) {
    refused.push(`${String(patchOutputs)} .patch outputs came back, more than the ${String(MAX_PATCH_OUTPUTS)} the launcher reads; none was downloaded`);
  }
  for (const file of files) {
    const segments = segmentsOf(file.filename);
    const base = segments[segments.length - 1] ?? "";
    const isPatch = base.toLowerCase().endsWith(".patch");
    if (isPatch && patchOutputs > MAX_PATCH_OUTPUTS) continue;
    if (!isPatch && base !== "precondition.json") {
      left.push(file.filename);
      continue;
    }
    const shown = JSON.stringify(file.filename);
    if (segments.some(isWindowsDeviceName)) refused.push(`${shown} names a Windows device; not downloaded`);
    else if (base === "precondition.json") preconditions.push(file);
    else if (base === "diff.patch") diffs.push(file);
    else if (FORMAT_PATCH.test(base)) patches.push(file);
    else refused.push(`${shown} came back but is not a format-patch file or diff.patch, so the review cannot account for it; not downloaded`);
  }
  const single = (found: readonly OutputFile[], name: string): OutputFile[] => {
    if (found.length > 1) refused.push(`${String(found.length)} files named ${name} came back; none was downloaded`);
    return found.length === 1 ? [...found] : [];
  };

  const byName = (a: OutputFile, b: OutputFile): number => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0);
  const wanted = [
    ...[...patches].sort(byName).map((file, index) => ({ file, localName: `patch-${String(index + 1).padStart(4, "0")}.patch` })),
    ...single(diffs, "diff.patch").map((file) => ({ file, localName: "diff.patch" })),
    ...single(preconditions, "precondition.json").map((file) => ({ file, localName: "precondition.json" })),
  ];
  const downloads: { file: OutputFile; localName: string }[] = [];
  let total = 0;
  for (const entry of wanted) {
    const { filename, sizeBytes } = entry.file;
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_OUTPUT_BYTES) {
      refused.push(`${JSON.stringify(filename)} is listed at ${String(sizeBytes)} bytes, over the ${String(MAX_OUTPUT_BYTES)}-byte limit for one output; not downloaded`);
    } else if (total + sizeBytes > MAX_OUTPUTS_TOTAL_BYTES) {
      refused.push(`${JSON.stringify(filename)} would take the run's downloads past ${String(MAX_OUTPUTS_TOTAL_BYTES)} bytes; not downloaded`);
    } else {
      total += sizeBytes;
      downloads.push(entry);
    }
  }
  return { downloads, refused, left };
}

/** A download that ran past its cap: the partial file has been removed. */
export class OutputTooLargeError extends Error {
  constructor(destination: string, maxBytes: number) {
    super(`a download to ${destination} passed its ${String(maxBytes)}-byte limit and was cut off`);
    this.name = "OutputTooLargeError";
  }
}

/** A download that ran past its deadline: abandoned, and its partial file removed once the abort reaches it. */
export class OutputTimeoutError extends Error {
  readonly minutes: number;
  constructor(timeoutMs: number) {
    const minutes = timeoutMs / 60_000;
    super(`a download took longer than ${String(minutes)} min and was abandoned`);
    this.name = "OutputTimeoutError";
    this.minutes = minutes;
  }
}

/** A web stream's chunks; a reader the caller stops early is cancelled, so the download stops too. */
export async function* chunksOf(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Streams `source` into `destination` (a launcher-chosen name; a collect into
 * the same run folder replaces it), holding one chunk at a time, and stops at
 * `maxBytes`: past it the file is removed and an OutputTooLargeError thrown.
 * Returns the bytes written.
 */
export async function writeCapped(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, destination: string, maxBytes: number): Promise<number> {
  const handle = await open(destination, "w");
  let written = 0;
  try {
    for await (const chunk of source) {
      written += chunk.byteLength;
      if (written > maxBytes) throw new OutputTooLargeError(destination, maxBytes);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await rm(destination, { force: true });
    throw error;
  }
  await handle.close();
  return written;
}
