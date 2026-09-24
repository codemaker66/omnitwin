// ---------------------------------------------------------------------------
// Self-hosted Google Fonts — which build of each face this browser receives.
//
// styles/fonts/ holds Google Fonts' own files, mirrored by
// scripts/self-host-google-fonts.mjs, so text renders from the same bytes
// without a third-party connection before first paint. Google serves most
// browsers the desktop Chrome build (its Apple and Android builds differ only
// in tables those platforms do not use). Two platforms receive builds that
// render differently, and the mirror keeps them:
//
//  - Firefox on Windows gets every face without its MVAR table (x-height,
//    underline and strikeout metrics do not vary with weight);
//  - macOS, including iPadOS Safari, gets the EB Garamond italic instance with
//    the overlap flags CoreText uses for overlapping contours.
//
// Their @font-face rules load after the default rules. For identical
// descriptors the later rule wins, so the default file is never fetched.
// Browsers Google sent static instances (provenance.json, notMirrored) now
// get these variable faces.
// ---------------------------------------------------------------------------

export type FontBuild = "default" | "firefox-windows" | "macos";

/** Classifies a browser the way the mirrored Google Fonts responses do. */
export function fontBuildFor(userAgent: string): FontBuild {
  if (/\bWindows NT\b/u.test(userAgent) && /\bFirefox\//u.test(userAgent)) return "firefox-windows";
  if (/\bMacintosh\b/u.test(userAgent)) return "macos";
  return "default";
}

/** A family's default stylesheet plus the stylesheets of the builds that differ. */
export interface FontStylesheets {
  readonly href: string;
  readonly overrides: Readonly<Partial<Record<Exclude<FontBuild, "default">, string>>>;
}

/** Stylesheet URLs to attach, in cascade order, for a browser's build. */
export function fontStylesheetHrefs(stylesheets: FontStylesheets, build: FontBuild): readonly string[] {
  const override = build === "default" ? undefined : stylesheets.overrides[build];
  return override === undefined ? [stylesheets.href] : [stylesheets.href, override];
}

/**
 * Appends a build's override rules as a <style> after the stylesheets already
 * in the document, so they win before anything renders. Used for the faces
 * index.html loads; route stylesheets use fontStylesheetHrefs instead.
 */
export function appendFontBuildStyle(
  overrides: Readonly<Partial<Record<Exclude<FontBuild, "default">, string>>>,
  build: FontBuild,
  doc: Document,
): HTMLStyleElement | null {
  const css = build === "default" ? undefined : overrides[build];
  if (css === undefined) return null;
  const style = doc.createElement("style");
  style.dataset["fontBuild"] = build;
  style.textContent = css;
  doc.head.append(style);
  return style;
}
