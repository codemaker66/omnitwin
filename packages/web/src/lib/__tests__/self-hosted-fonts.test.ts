import { describe, expect, it } from "vitest";
import { appendFontBuildStyle, fontBuildFor, fontStylesheetHrefs, type FontBuild } from "../self-hosted-fonts.js";

// User agents as Google Fonts was probed with on 2026-09-24; each expectation is
// the build its css2 response named for that agent (styles/fonts/provenance.json).
const AGENTS: readonly (readonly [string, FontBuild])[] = [
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "default"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "default"],
  ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "default"],
  ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "default"],
  ["Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0", "default"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", "default"],
  ["Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", "default"],
  ["Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0", "default"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0", "firefox-windows"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0", "firefox-windows"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15", "macos"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "macos"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "macos"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0", "macos"],
];

describe("self-hosted font builds", () => {
  it("classifies browsers the way the mirrored Google Fonts responses did", () => {
    for (const [agent, build] of AGENTS) expect(fontBuildFor(agent), agent).toBe(build);
  });

  it("appends a browser's own build after the default stylesheet, and only when one exists", () => {
    const stylesheets = { href: "/assets/quiz.css", overrides: { macos: "/assets/quiz.macos.css" } };
    expect(fontStylesheetHrefs(stylesheets, "default")).toEqual(["/assets/quiz.css"]);
    expect(fontStylesheetHrefs(stylesheets, "macos")).toEqual(["/assets/quiz.css", "/assets/quiz.macos.css"]);
    expect(fontStylesheetHrefs(stylesheets, "firefox-windows")).toEqual(["/assets/quiz.css"]);
  });

  it("adds override rules after the document's existing stylesheets", () => {
    const existing = document.createElement("link");
    existing.rel = "stylesheet";
    document.head.append(existing);
    const overrides = { "firefox-windows": "@font-face { font-family: 'Geist'; }" };

    expect(appendFontBuildStyle(overrides, "default", document)).toBeNull();
    expect(appendFontBuildStyle(overrides, "macos", document)).toBeNull();
    const style = appendFontBuildStyle(overrides, "firefox-windows", document);
    if (style === null) throw new Error("The Firefox-on-Windows build was not applied.");
    expect(style.textContent).toBe(overrides["firefox-windows"]);
    expect(style.dataset["fontBuild"]).toBe("firefox-windows");
    expect(document.head.lastElementChild).toBe(style);
    expect(existing.compareDocumentPosition(style) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    style.remove();
    existing.remove();
  });
});
