import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LEAFLET_PATH = path.resolve("public/trades-house-media/leaflet.html");
const ASSET_ROOT = path.resolve("public/trades-house-media/assets");

describe("Trades House leaflet artifact", () => {
  it("ships the supplied two-sided print structure without the generated DC runtime", async () => {
    const source = await readFile(LEAFLET_PATH, "utf-8");

    expect(source).toContain("Outside &nbsp;·&nbsp; printed side one");
    expect(source).toContain("Inside &nbsp;·&nbsp; printed side two");
    expect(source).toContain("@page{size:A4 landscape;margin:0;}");
    expect(source).toContain("Which Craft");
    expect(source).toContain("A Robert Adam");
    expect(source).not.toContain("support.js");
    expect(source).not.toContain("text/x-dc");
    expect(source).not.toContain("new Function");
    expect(source).not.toContain("unpkg.com/react");
  });

  it("ships every curated visual used by the leaflet and quiz", async () => {
    const requiredAssets = [
      "achievement.png",
      "aerial-dome.jpg",
      "building-gold.png",
      "grand-hall.jpeg",
      "tartan.jpg",
      "crests/hammermen.png",
      "crests/wrights.png",
      "crests/gardeners.png",
    ] as const;

    await Promise.all(requiredAssets.map((asset) => access(path.join(ASSET_ROOT, asset))));
  });

  it("keeps both public experience routes lazy and separate from T-091 runtime pages", async () => {
    const router = await readFile(path.resolve("src/router.tsx"), "utf-8");

    expect(router).toContain('import("./pages/TradesHouseLeafletPage.js")');
    expect(router).toContain('import("./pages/TradesHouseCraftQuizPage.js")');
    expect(router).toContain('path: "/trades-house/leaflet"');
    expect(router).toContain('path: "/trades-house/discover-your-craft"');
  });
});
