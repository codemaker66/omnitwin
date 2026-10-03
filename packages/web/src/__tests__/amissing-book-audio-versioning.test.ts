import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..", "..");
const script = join(web, "scripts/version-amissing-book-audio.mjs");
const temporary: string[] = [];
const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

function fixture(): { source: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), "amissing-audio-"));
  temporary.push(root);
  const source = join(root, "source");
  const output = join(root, "output");
  mkdirSync(join(source, "audio/vo"), { recursive: true });
  mkdirSync(join(source, "assets"));
  writeFileSync(join(source, "index.html"), '<script type="module" src="/amissing-book/assets/main.js"></script>');
  writeFileSync(join(source, "assets/main.js"),
    'import "./chunk.js"; export const index = fetch("/amissing-book/audio/index.json"); ' +
    'export const lazy = () => import("/amissing-book/assets/chunk.js"); ' +
    'const __vite__mapDeps = i => i.map(i => ["assets/chunk.js"][i]); ' +
    'export const preload = __vite__mapDeps([0]).map(e => "/amissing-book/" + e);');
  writeFileSync(join(source, "assets/chunk.js"), 'import "./main.js";');
  writeFileSync(join(source, "audio/index.json"), JSON.stringify({
    vo_intro: "vo/vo_intro.mp3", vo_face_B1a: "vo/vo_face_B1a.mp3", mus_title: "music/mus_title.mp3",
  }));
  writeFileSync(join(source, "audio/vo/vo_intro.mp3"), "old take");
  writeFileSync(join(source, "audio/vo/vo_face_B1a.mp3"), "character voice");
  cpSync(source, output, { recursive: true });
  return { source, output };
}

function build(source: string, output: string): {
  entry: string; manifestUrl: string; index: Record<string, string>; module: string;
} {
  execFileSync(process.execPath, [script, output, source], { stdio: "pipe" });
  const html = readFileSync(join(output, "index.html"), "utf8");
  const entry = /src="([^"]+\.js)"/u.exec(html)?.[1];
  if (entry === undefined) throw new Error("Missing entry module");
  const module = readFileSync(join(output, entry.replace("/amissing-book/", "")), "utf8");
  const manifestUrl = /\/amissing-book\/audio\/index-[a-f0-9]+\.json/u.exec(module)?.[0];
  if (manifestUrl === undefined) throw new Error("Missing versioned manifest");
  const index = JSON.parse(readFileSync(join(output, manifestUrl.replace("/amissing-book/", "")), "utf8")) as Record<string, string>;
  return { entry, manifestUrl, index, module };
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("The Amissing Book narration cache identity", () => {
  it("packages the imported game after Vercel builds the web app", () => {
    const config = JSON.parse(readFileSync(join(web, "vercel.json"), "utf8")) as { buildCommand: string };
    expect(config.buildCommand).toContain(
      "pnpm -F @omnitwin/web build && pnpm -F @omnitwin/web exec node scripts/prepare-amissing-book-resume.mjs && pnpm -F @omnitwin/web exec node scripts/version-amissing-book-audio.mjs dist/amissing-book dist/amissing-book",
    );
    expect(config.buildCommand.length).toBeLessThanOrEqual(256);
  });

  it("changes every URL leading to an overwritten take, even when its filename and words stay the same", () => {
    const { source, output } = fixture();
    const old = build(source, output);
    writeFileSync(join(source, "audio/vo/vo_intro.mp3"), "Mythia take");
    const current = build(source, output);
    expect(current.entry).not.toBe(old.entry);
    expect(current.manifestUrl).not.toBe(old.manifestUrl);
    expect(current.index["vo_intro"]).toBe(`vo/vo_intro.mp3?v=${sha("Mythia take")}`);
    expect(current.index["vo_intro"]).not.toBe(old.index["vo_intro"]);
    expect(current.index["vo_face_B1a"]).toBe(old.index["vo_face_B1a"]);
    expect(current.index["mus_title"]).toBe("music/mus_title.mp3");
    expect(build(source, output)).toEqual(current);
    expect(readFileSync(join(source, "audio/index.json"), "utf8")).not.toContain("?v=");
    expect(readFileSync(join(source, "assets/main.js"), "utf8")).toContain("audio/index.json");
  });

  it("keeps relative back-imports and absolute lazy imports in the same versioned module graph", () => {
    const { source, output } = fixture();
    const current = build(source, output);
    const chunkUrl = new URL("./chunk.js", `https://venviewer.com${current.entry}`);
    expect(current.module).toContain(`import("${chunkUrl.pathname}")`);
    expect(current.module).toContain(`"${chunkUrl.pathname.replace("/amissing-book/", "")}"`);
    expect(current.module).not.toContain('"assets/chunk.js"');
    const chunk = readFileSync(join(output, chunkUrl.pathname.replace("/amissing-book/", "")), "utf8");
    expect(chunk).toBe('import "./main.js";');
    expect(new URL("./main.js", chunkUrl).pathname).toBe(current.entry);
    writeFileSync(join(source, "assets/chunk.js"), 'import "./main.js"; export const changed = true;');
    expect(build(source, output).entry).not.toBe(current.entry);
  });

  it("fails closed if a new game import changes the manifest loader or loses a voice", () => {
    const { source, output } = fixture();
    writeFileSync(join(source, "assets/main.js"), 'fetch("/amissing-book/audio/renamed.json")');
    expect(() => build(source, output)).toThrow();
    rmSync(join(source, "audio/vo/vo_intro.mp3"));
    expect(() => build(source, output)).toThrow();
  });

  it("versions every shipped voice from its bytes, including the opening and separate character introductions", () => {
    const { output } = fixture();
    const source = join(web, "public/amissing-book");
    const current = build(source, output);
    const files = readdirSync(join(source, "audio/vo")).filter((file) => file.endsWith(".mp3"));
    expect(files).toContain("vo_de0b5e66.mp3"); // Glasgow, tonight.
    expect(files).toContain("vo_face_B1a.mp3");
    for (const file of files) {
      expect(current.index[file.slice(0, -4)], file).toBe(
        `vo/${file}?v=${sha(readFileSync(join(source, "audio/vo", file)))}`,
      );
    }
    expect(current.module).not.toContain("/amissing-book/audio/index.json");
  });
});
