import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A stylesheet is global once its module loads, and the dashboard keeps every
// desk's CSS once visited. The Pricing desk first named its classes pr-desk,
// pr-panel, pr-field, pr-facts and pr-price, the Proposals desk's own names,
// so whichever desk loaded last restyled the other: the proposals price list
// drew its text at 1.31:1 (the browser accessibility audit caught it). The
// Pricing desk now owns the pdk- prefix, and these checks keep every rule in
// its stylesheet anchored on a pdk- class and its markup off the pr- names.
// ---------------------------------------------------------------------------

const DIR = "src/components/dashboard/pricing";

function read(path: string): string {
  return readFileSync(resolve(path), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

/** Split on a separator outside parentheses (":has(a, b)" stays whole). */
function splitTop(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0 && separator.test(ch)) {
      if (current.trim() !== "") parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/** Every style rule's selectors; at-rule preludes such as @media are skipped. */
function selectors(css: string): string[] {
  const found: string[] = [];
  let prelude = "";
  for (const ch of css) {
    if (ch === "{") {
      const text = prelude.trim();
      if (text !== "" && !text.startsWith("@")) found.push(...splitTop(text, /,/u));
      prelude = "";
    } else if (ch === "}" || ch === ";") {
      prelude = "";
    } else {
      prelude += ch;
    }
  }
  return found;
}

describe("the Pricing desk's styles stay in its own namespace", () => {
  const css = read(`${DIR}/PricingDesk.css`);
  const rules = selectors(css);

  it("reads the stylesheet's rules", () => {
    expect(rules.length).toBeGreaterThan(30);
  });

  it("anchors every rule on a pdk- class, so nothing it styles reaches another desk", () => {
    const loose = rules.filter((selector) => {
      const anchor = splitTop(selector, /[\s>+~]/u)[0] ?? "";
      return !/\.pdk-[a-z0-9]/u.test(anchor);
    });
    expect(loose).toEqual([]);
  });

  it("defines no pr- class, the Proposals desk's names", () => {
    expect(css).not.toMatch(/\.pr-[a-z0-9]/u);
  });

  it("uses no pr- class in its markup", () => {
    for (const file of ["PricingDesk.tsx", "PricingPanels.tsx", "RateForm.tsx"]) {
      expect(read(`${DIR}/${file}`), file).not.toMatch(/(?<![a-z0-9_-])pr-[a-z0-9]/u);
    }
  });
});
