import { chromium } from "@playwright/test";
const OUT = "C:/Users/blake/AppData/Local/Temp/claude/C--Users-blake-omnitwin2/078ed7b9-9e43-41ea-a87b-0a77df853e49/scratchpad";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 620, height: 780 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:5199/dev/time-machine", { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="time-machine-panel"]');
const panel = page.locator('[data-testid="time-machine-panel"]');

const shot = async (name) => {
  await page.waitForTimeout(450); // let the settle finish
  await panel.screenshot({ path: `${OUT}/${name}.png` });
  const objs = await page.locator('[data-testid="tm-object"]').count();
  const title = await page.locator(".tm__title").textContent();
  const state = await page.locator('[data-testid="tm-restore-state"]').textContent();
  console.log(`${name}: ${objs} objects | "${title}" | ${state.trim()}`);
};

await shot("tm-newest");
await page.locator('[data-testid="tm-scrubber"]').fill("0");
await shot("tm-oldest");
await page.locator('[data-testid="tm-scrubber"]').fill("3");
await shot("tm-mid");

const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
console.log("console errors:", errs.length);
await browser.close();
