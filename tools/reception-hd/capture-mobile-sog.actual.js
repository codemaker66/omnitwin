async (page) => {
  const urls = [
    "http://127.0.0.1:5191/render2/data/3dgs/0_14_0_2.sog",
    "http://127.0.0.1:5191/render2/data/3dgs/0_3_0_0.sog",
    "http://127.0.0.1:5191/render2/data/3dgs/0_8_0_0.sog",
    "http://127.0.0.1:5191/render2/data/3dgs/0_9_0_0.sog",
  ];
  const views = [
    { id: "overview", cam: "-2.408,1.449,9.752", look: "-2.652,-5.022,-11.676", fov: "48" },
    { id: "timber-left", cam: "-2.408,1.449,9.752", look: "-6.5,-3.5,-11.5", fov: "25" },
    { id: "timber-right", cam: "-2.408,1.449,9.752", look: "0,-3.5,-11.5", fov: "25" },
    { id: "floor-surface", cam: "-2.408,1.449,9.752", look: "-3,-5,-4", fov: "28" },
    { id: "ceiling-moulding", cam: "-2.408,1.449,9.752", look: "-3,0,-11.5", fov: "24" },
    { id: "column-skirting", cam: "-2.408,1.449,9.752", look: "1,-3,-10", fov: "24" },
  ];
  const results = [];
  await page.setViewportSize({ width: 1200, height: 900 });
  for (const view of views) {
    const query = [
      `splatUrl=${urls.join(",")}`,
      "zUp=1",
      `cam=${view.cam}`,
      `look=${view.look}`,
      `fov=${view.fov}`,
    ].join("&");
    await page.goto(`http://127.0.0.1:5182/dev/splat-fixture?${query}`);
    await page.waitForFunction(
      () => window.__splatFixture?.status === "loaded",
      undefined,
      { timeout: 45_000 },
    );
    await page.waitForTimeout(1_000);
    const fixture = await page.evaluate(() => window.__splatFixture);
    await page.evaluate(() => {
      const main = document.querySelector("main");
      const canvas = document.querySelector("canvas");
      if (main === null || canvas === null) return;
      for (const child of main.children) {
        if (!child.contains(canvas)) child.style.display = "none";
      }
    });
    const path = `output/playwright/reception-hd-investigation/matrix-${view.id}-mobile-sh0-sog-leaf.png`;
    await page.screenshot({ path, scale: "device", type: "png" });
    results.push({ view: view.id, path, fixture });
  }
  return results;
}
