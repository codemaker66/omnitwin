import { describe, expect, it } from "vitest";
import {
  parseRuntimeSplatUrl,
  runtimeSplatUrlFromSearchParams,
} from "../lib/runtime-visual-asset.js";

describe("runtime visual asset URL parsing", () => {
  it("accepts plausible runtime splat URLs", () => {
    expect(parseRuntimeSplatUrl("https://assets.venviewer.test/trades-hall/scene.ply").ok).toBe(true);
    expect(parseRuntimeSplatUrl("https://assets.venviewer.test/scene.spz?signature=abc").extension).toBe(".spz");
    expect(parseRuntimeSplatUrl("/dev-assets/trades-hall/scene.splat").ok).toBe(true);
    expect(parseRuntimeSplatUrl("/dev-assets/trades-hall/scene.ksplat").ok).toBe(true);
    expect(parseRuntimeSplatUrl("/dev-assets/trades-hall/scene.rad").ok).toBe(true);
    expect(parseRuntimeSplatUrl("/dev-assets/trades-hall/scene.radc").ok).toBe(true);
  });

  it("treats an empty URL as a neutral empty state", () => {
    const parsed = parseRuntimeSplatUrl("  ");
    expect(parsed.ok).toBe(false);
    expect(parsed.url).toBeNull();
    expect(parsed.error).toBeNull();
  });

  it("rejects unsupported schemes and extensions", () => {
    expect(parseRuntimeSplatUrl("javascript:alert(1)").error).toMatch(/http\(s\)/i);
    expect(parseRuntimeSplatUrl("https://assets.venviewer.test/scene.txt").error).toMatch(/Asset URL/i);
    expect(parseRuntimeSplatUrl("assets/scene.ply").error).toMatch(/http\(s\)/i);
  });

  it("rejects fixture-only Spark sources", () => {
    expect(parseRuntimeSplatUrl("textSplats:VSIR").error).toMatch(/Fixture-only/i);
    expect(parseRuntimeSplatUrl("/dev/splat-fixture/scene.ply").error).toMatch(/Fixture-only/i);
  });

  it("reads the splatUrl query parameter", () => {
    const params = new URLSearchParams({
      splatUrl: "https://assets.venviewer.test/trades-hall/scene.ply",
    });
    expect(runtimeSplatUrlFromSearchParams(params)).toMatchObject({
      ok: true,
      url: "https://assets.venviewer.test/trades-hall/scene.ply",
      extension: ".ply",
      error: null,
    });
  });
});
