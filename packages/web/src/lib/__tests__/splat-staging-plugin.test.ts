import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { isRealPathContained, resolveStagedSplatPath, splatStagingPlugin, stagedContentType } from "../splat-staging-plugin.js";

const ROOT = join(sep, "staging", "splats");

describe("resolveStagedSplatPath", () => {
  it("resolves a staged tile inside the root", () => {
    const resolved = resolveStagedSplatPath(ROOT, "/splats/trades-hall/saloon/0_0.sog");
    expect(resolved).toBe(join(ROOT, "trades-hall", "saloon", "0_0.sog"));
  });

  it("ignores paths outside the splat prefix", () => {
    expect(resolveStagedSplatPath(ROOT, "/api/venues")).toBeNull();
  });

  it("refuses directory traversal out of the staging root", () => {
    expect(resolveStagedSplatPath(ROOT, "/splats/../../etc/passwd.sog")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/../../../secret.sog")).toBeNull();
  });

  it("refuses percent-encoded traversal", () => {
    expect(resolveStagedSplatPath(ROOT, "/splats/%2e%2e%2f%2e%2e%2fsecret.sog")).toBeNull();
  });

  it("refuses a sibling directory that merely starts with the root name", () => {
    expect(resolveStagedSplatPath(join(sep, "staging"), "/splats/../stagingEvil/x.sog")).toBeNull();
  });

  it("serves only splat extensions, never arbitrary files", () => {
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/saloon/notes.txt")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/saloon/.env")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/saloon/app.js")).toBeNull();
  });

  it("refuses an embedded null byte", () => {
    expect(resolveStagedSplatPath(ROOT, "/splats/a.sog\0.txt")).toBeNull();
  });

  it("refuses malformed percent-encoding rather than throwing", () => {
    expect(resolveStagedSplatPath(ROOT, "/splats/%E0%A4%A.sog")).toBeNull();
  });

  it("accepts every extension the runtime can actually render, the level-of-detail tree files included", () => {
    for (const extension of [".sog", ".spz", ".ply", ".splat", ".ksplat", ".rad", ".radc"]) {
      expect(resolveStagedSplatPath(ROOT, `/splats/a/b/tile${extension}`)).not.toBeNull();
    }
  });

  it("serves a room's floor-skin package files, and only inside a floor-skin directory (T-639)", () => {
    for (const file of ["floor-skin.json", "albedo-4096-0.webp", "height-5cm.i16", "slab-mask-1024x512.u8"]) {
      expect(resolveStagedSplatPath(ROOT, `/splats/trades-hall/grand-hall/floor-skin/v1/${file}`))
        .toBe(join(ROOT, "trades-hall", "grand-hall", "floor-skin", "v1", file));
    }
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/meta.json")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/photo.webp")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/floor-skin/v1/notes.txt")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/floor-skin/v1/app.js")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/floor-skin.json")).toBeNull();
  });

  it("judges the floor-skin directory after normalising, so dot segments cannot borrow it", () => {
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/floor-skin/../secret.json")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/floor-skin/%2e%2e/secret.json")).toBeNull();
  });
});

describe("splatStagingPlugin", () => {
  it("does nothing when no staging root is configured, so a fresh checkout still boots", () => {
    expect(splatStagingPlugin(undefined)).toBeNull();
    expect(splatStagingPlugin("")).toBeNull();
    expect(splatStagingPlugin("   ")).toBeNull();
  });

  it("is a dev-server-only plugin and never affects a production build", () => {
    const plugin = splatStagingPlugin(ROOT);
    expect(plugin?.name).toBe("omnitwin-splat-staging");
    expect(plugin?.apply).toBe("serve");
  });
});

describe("isRealPathContained", () => {
  it("refuses a path that escapes the root through a directory junction", () => {
    // Lexical containment alone is defeated here: `mklink /J` needs no
    // administrator rights, so a junction dropped inside the staging root makes
    // an outside file look contained. Found by adversarial review of this
    // middleware, not by the original tests.
    const base = realpathSync(mkdtempSync(join(tmpdir(), "splat-junction-")));
    const root = join(base, "staging-root");
    const outside = join(base, "outside-dir");
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(root, "real.ply"), "LEGIT");
    writeFileSync(join(outside, "loot.ply"), "SECRET");

    let junctionMade = false;
    try {
      execFileSync("cmd", ["/c", "mklink", "/J", join(root, "link"), outside], { stdio: "pipe" });
      junctionMade = true;
    } catch {
      // Not Windows, or junctions unavailable: the assertion below is skipped
      // rather than silently passing for the wrong reason.
    }

    // The lexical check still admits it — that is the whole point.
    const lexical = resolveStagedSplatPath(root, "/splats/link/loot.ply");
    if (junctionMade) {
      expect(lexical).toBe(join(root, "link", "loot.ply"));
      // The real-path check is what actually refuses it.
      expect(isRealPathContained(root, join(root, "link", "loot.ply"))).toBe(false);
    }

    // A genuinely staged tile is still served.
    expect(isRealPathContained(root, join(root, "real.ply"))).toBe(true);
  });

  it("refuses a path that does not exist rather than assuming it is safe", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "splat-absent-")));
    expect(isRealPathContained(base, join(base, "nope.sog"))).toBe(false);
  });
});

describe("stagedContentType", () => {
  it("labels package files so the browser decodes them as what they are", () => {
    expect(stagedContentType(join(ROOT, "a", "floor-skin", "v1", "floor-skin.json"))).toBe("application/json");
    expect(stagedContentType(join(ROOT, "a", "floor-skin", "v1", "albedo-4096-0.webp"))).toBe("image/webp");
    expect(stagedContentType(join(ROOT, "a", "floor-skin", "v1", "height-5cm.i16"))).toBe("application/octet-stream");
    expect(stagedContentType(join(ROOT, "a", "0_0.sog"))).toBe("application/octet-stream");
  });
});
