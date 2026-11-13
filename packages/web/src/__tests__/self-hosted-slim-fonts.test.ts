import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The slim font layer must be the mirrored fonts and nothing else.
//
// site-slim.css and slim/*.woff2 are derived from Google's own files by
// scripts/slim-site-fonts.py, which only drops glyphs (scripts/verify-slim-
// fonts.py proves the rest is bit-identical). These checks hold the committed
// output to its inputs and keep the cut-down files covering the site's copy.
// ---------------------------------------------------------------------------

interface SlimProvenance {
  readonly coreCodepoints: string;
  readonly files: Readonly<Record<string, {
    readonly from: string;
    readonly sourceSha256: string;
    readonly sourceBytes: number;
    readonly bytes: number;
    readonly sha256: string;
  }>>;
}

const fonts = join(import.meta.dirname, "..", "styles", "fonts");
const provenance = JSON.parse(readFileSync(join(fonts, "slim", "provenance.json"), "utf8")) as SlimProvenance;
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const FACE = /\/\* ([\w-]+) \*\/\n@font-face \{\n([^}]*)\}\n/gu;

function ranges(spec: string): Set<number> {
  const codepoints = new Set<number>();
  for (const token of spec.split(",").map((part) => part.trim())) {
    const match = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/u.exec(token);
    if (match === null) throw new Error(`unsupported range ${token}`);
    const low = Number.parseInt(match[1] ?? "", 16);
    const high = Number.parseInt(match[2] ?? match[1] ?? "", 16);
    for (let cp = low; cp <= high; cp += 1) codepoints.add(cp);
  }
  return codepoints;
}

interface Face {
  readonly label: string;
  readonly body: string;
  readonly family: string;
  readonly style: string;
  readonly weight: string;
  readonly src: string;
  readonly range: Set<number>;
}

function faces(file: string): readonly Face[] {
  const css = readFileSync(join(fonts, file), "utf8");
  return [...css.matchAll(FACE)].map((match) => {
    const body = match[2] ?? "";
    const get = (name: string): string => new RegExp(`${name}: (.*);`, "u").exec(body)?.[1] ?? "";
    return {
      label: match[1] ?? "",
      body,
      family: get("font-family"),
      style: get("font-style"),
      weight: get("font-weight"),
      src: /url\(([^)]+)\)/u.exec(body)?.[1] ?? "",
      range: ranges(get("unicode-range")),
    };
  });
}

const CORE = ranges(provenance.coreCodepoints);

describe("slim fonts", () => {
  it("are cut from the files the mirror holds, and are the files provenance names", () => {
    for (const [name, record] of Object.entries(provenance.files)) {
      const original = readFileSync(join(fonts, "files", record.from));
      expect(sha256(original), name).toBe(record.sourceSha256);
      expect(original.length, name).toBe(record.sourceBytes);
      const slim = readFileSync(join(fonts, "slim", name));
      expect(sha256(slim), name).toBe(record.sha256);
      expect(slim.length, name).toBe(record.bytes);
      expect(slim.length, name).toBeLessThan(original.length);
      expect(slim.subarray(0, 4).toString("latin1"), name).toBe("wOF2");
    }
    const onDisk = readdirSync(join(fonts, "slim")).filter((file) => file.endsWith(".woff2")).sort();
    expect(onDisk).toEqual(Object.keys(provenance.files).sort());
  });

  it.each([
    ["site.css", "site-slim.css"],
    ["site.firefox-windows.css", "site-slim.firefox-windows.css"],
  ])("%s becomes %s by splitting each targeted latin face into core and remainder", (mirror, slim) => {
    const original = faces(mirror);
    const derived = faces(slim);
    let derivedIndex = 0;
    for (const face of original) {
      const next = derived[derivedIndex];
      if (next === undefined) throw new Error(`${slim} ends early at ${face.family} ${face.label}`);
      if (next.label !== "latin-core") {
        expect(next, `${slim}: ${face.family} ${face.label}`).toEqual(face);
        derivedIndex += 1;
        continue;
      }
      const rest = derived[derivedIndex + 1];
      if (rest === undefined) throw new Error(`${slim}: ${face.family} core has no remainder`);
      for (const part of [next, rest]) {
        expect([part.family, part.style, part.weight]).toEqual([face.family, face.style, face.weight]);
      }
      expect(rest.label).toBe("latin");
      // The remainder is Google's original file, the core a cut-down copy.
      expect(rest.src).toBe(face.src);
      expect(next.src).toMatch(/^\.\/slim\/.+-core\.woff2$/u);
      // Core and remainder partition the original range exactly.
      const overlap = [...next.range].filter((cp) => rest.range.has(cp));
      expect(overlap).toEqual([]);
      expect(new Set([...next.range, ...rest.range])).toEqual(face.range);
      derivedIndex += 2;
    }
    expect(derived.length).toBe(derivedIndex);
  });

  it("name only files that exist", () => {
    for (const file of ["site-slim.css", "site-slim.firefox-windows.css"]) {
      for (const face of faces(file)) {
        const path = face.src.replace(/^\.\//u, "");
        expect(statSync(join(fonts, path)).isFile(), `${file}: ${path}`).toBe(true);
      }
    }
  });

  it("cover every Latin-range character the site's own copy uses", () => {
    // A character outside the core still renders, from Google's original file,
    // but a word that mixes it with core characters is shaped in two runs and
    // the original downloads too. When this fails, add the character to
    // CORE_EXTRA in scripts/slim-site-fonts.py and rerun it.
    const latin = ranges(faces("site.css").find((face) => face.label === "latin")?.body.match(/unicode-range: (.*);/u)?.[1] ?? "");
    const roots = [join(import.meta.dirname, ".."), join(import.meta.dirname, "..", "..", "..", "types", "src")];
    const uncovered = new Map<number, string>();
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules") visit(path);
        } else if (/\.(?:tsx?|css|html|md)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) {
          for (const char of readFileSync(path, "utf8")) {
            const cp = char.codePointAt(0) ?? 0;
            if (cp > 0x7e && latin.has(cp) && !CORE.has(cp) && cp !== 0xfeff && !uncovered.has(cp)) {
              uncovered.set(cp, path);
            }
          }
        }
      }
    };
    roots.forEach(visit);
    expect([...uncovered].map(([cp, path]) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")} in ${path}`)).toEqual([]);
  });
});
