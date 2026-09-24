import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string, extensions: readonly string[]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name), extensions)
    : Promise.resolve(extensions.includes(extname(entry.name)) ? [join(directory, entry.name)] : [])));
  return nested.flat();
}

describe("web startup guardrails", () => {
  it("mounts React before starting the optional Sentry chunk", async () => {
    const source = await readFile(resolve("src/main.tsx"), "utf-8");
    const mountIndex = source.indexOf("createRoot(rootElement).render(");
    const sentryIndex = source.indexOf("void initBrowserSentry();");

    expect(mountIndex).toBeGreaterThan(-1);
    expect(sentryIndex).toBeGreaterThan(mountIndex);
    expect(source).not.toContain("await initBrowserSentry()");
  });

  it("keeps the deferred Sentry chunk tree-shakeable", async () => {
    // A namespace import of "@sentry/react" retains Replay, Feedback and every
    // other integration (437 KB before minification, against 77 KB when only
    // the named entry points are imported).
    const loader = await readFile(resolve("src/observability/sentry.ts"), "utf-8");
    const sdk = await readFile(resolve("src/observability/sentry-sdk.ts"), "utf-8");

    expect(loader).toContain('import("./sentry-sdk.js")');
    expect(loader).not.toMatch(/import\(\s*["']@sentry\/react["']\s*\)/);
    expect(sdk).not.toMatch(/export\s*\*/);
  });

  it("keeps external @imports out of stylesheets", async () => {
    // A failed @import fails its stylesheet's <link>; for a lazy route Vite then
    // rejects the import and the page errors (the quiz did whenever Google
    // Fonts was unreachable). Fonts are self-hosted; see the next checks.
    const files = await sourceFiles(resolve("src"), [".css"]);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(await readFile(file, "utf-8"), file).not.toMatch(/@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//u);
    }
  });

  it("sets the type from this origin, with no third-party font stylesheet or connection", async () => {
    // The Google Fonts stylesheet was render-blocking and cost a DNS/TLS round
    // trip to two more hosts before first paint. The same files are served from
    // src/styles/fonts (self-hosted-font-files.test.ts pins them to Google's).
    const html = await readFile(resolve("index.html"), "utf-8");
    expect(html).toContain('<link rel="stylesheet" href="/src/styles/fonts/site.css" />');
    expect(html).not.toMatch(/rel=["']preconnect["']/u);
    const files = [...await sourceFiles(resolve("src"), [".ts", ".tsx", ".css", ".html"]), resolve("index.html")]
      .filter((file) => !/[\\/]__tests__[\\/]/u.test(file));
    for (const file of files) {
      expect(await readFile(file, "utf-8"), file).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/u);
    }
  });

  it("fails targeted Vitest runs when no test file matches", async () => {
    const source = await readFile(resolve("vitest.config.ts"), "utf-8");
    expect(source).not.toContain("passWithNoTests");
  });
});
