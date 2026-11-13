// Checks the built listening page in Chromium, wrapped as the Artifact host wraps it:
//   - every control renders, and the page is complete at rest (the Grand Hall, a Chiavari, empty, at 3 m);
//   - "Set it down", "Move it" and "Lay out a dinner" start the audio, with no console errors;
//   - the Grand Hall's mid-band readout is lower with the dinner laid than empty;
//   - nothing scrolls sideways at 400 px;
//   - with a stand-in for the artifact's database, render times are written once per pause to timings/<device>.
//   node tools/set-down-listening/page.check.mjs [built.html] [screenshot directory]
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const built = process.argv[2] ?? "D:/claude/furniture-sound-20261027/listening/index.html";
const shots = process.argv[3] ?? "D:/claude/furniture-sound-20261027/listening";
const web = createRequire(new URL("../../packages/web/package.json", import.meta.url));
const { chromium } = web("@playwright/test");

const page = await readFile(built, "utf8");
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${page}</body></html>`;

const ROOMS = ["grand-hall", "saloon", "robert-adam-room", "reception-room", "north-gallery", "south-gallery"];
const SURFACES = ["floor", "deck", "dance", "table"];
const BANDS = [125, 250, 500, 1000, 2000, 4000, 8000];
const CONTROLS = [...ROOMS.map((r) => `room-${r}`), ...SURFACES.map((s) => `surface-${s}`), "piece", "distance", "dressing", "set-down", "move", "lay-out"];

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `: ${detail}`}`);
  if (!ok) failures += 1;
}

/** A stand-in for the artifact runtime's db (artifact-capabilities db.d.ts): it keeps every write. */
function fakeRuntime() {
  window.__writes = [];
  window.claude = {
    use: async (name) =>
      name !== "db"
        ? null
        : {
            doc: (path) => ({
              get: async () => ({ exists: false, data: () => undefined }),
              set: async (data) => {
                window.__writes.push({ path, data: JSON.parse(JSON.stringify(data)) });
              },
            }),
          },
  };
}

async function open(browser, { width, height, runtime = false, colorScheme = "light" }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  // The fonts are Google's; the check runs offline, so they arrive empty and the fallbacks draw.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  if (runtime) await context.addInitScript(fakeRuntime);
  const tab = await context.newPage();
  const errors = [];
  tab.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${message.type()}: ${message.text()}`);
  });
  tab.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await tab.setContent(html, { waitUntil: "load" });
  return { context, tab, errors };
}

const text = (tab, id) => tab.locator(`#${id}`).innerText();
const seconds = async (tab, hz) => Number.parseFloat((await text(tab, `rt-${hz}`)).replace(" s", ""));
const voices = async (tab) => Number(await tab.locator("#page").getAttribute("data-voices"));

async function setDressing(tab, percent) {
  await tab.locator("#dressing").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, percent);
}

const browser = await chromium.launch();
try {
  // --- Desktop: controls, rest state, audio, the readout ----------------------------------------
  const desk = await open(browser, { width: 1280, height: 900 });
  const { tab } = desk;
  for (const id of CONTROLS) check(`#${id} renders`, await tab.locator(`#${id}`).isVisible());
  check("44 pieces, grouped by family", (await tab.locator("#piece option").count()) === 44, `${await tab.locator("#piece option").count()} options in ${await tab.locator("#piece optgroup").count()} groups`);
  check("at rest: the Grand Hall", (await text(tab, "room-name")) === "The Grand Hall");
  check("at rest: oak boards", (await tab.locator("#surface-floor").getAttribute("aria-checked")) === "true" && (await text(tab, "surface-floor")) === "Oak boards on joists");
  check("at rest: a Chiavari chair", (await tab.locator("#piece").inputValue()) === "chiavari-chair");
  check("at rest: empty", /^0 of \d+ pieces laid$/.test(await text(tab, "dressing-value")), await text(tab, "dressing-value"));
  check("at rest: 3 m", (await text(tab, "distance-value")) === "3.0 m");
  for (const hz of BANDS) check(`at rest: RT ${hz} Hz drawn`, /^\d+\.\d\d s$/.test(await text(tab, `rt-${hz}`)), await text(tab, `rt-${hz}`));
  check("nothing plays before a gesture", (await tab.locator("#page").getAttribute("data-audio")) === "none");
  await tab.waitForFunction(() => document.getElementById("tail-ms")?.textContent?.endsWith("ms"), null, { timeout: 15000 });
  check("the tail is rendered at rest", true, await text(tab, "tail-ms"));
  check("without a database the page says it does not save", (await text(tab, "save-status")).includes("does not save"), await text(tab, "save-status"));

  await tab.click("#set-down");
  await tab.waitForFunction(() => document.getElementById("page")?.dataset.audio === "running", null, { timeout: 10000 });
  check("Set it down starts the audio", (await voices(tab)) === 1, `context running, ${await voices(tab)} voice`);
  check("Set it down shows its render time", /^\d+\.\d ms$/.test(await text(tab, "render-ms")), await text(tab, "render-ms"));
  check("Set it down shows its peak", /^\u2212?\d+\.\d dBFS$/.test(await text(tab, "peak-db")), await text(tab, "peak-db"));
  await tab.click("#move");
  check("Move it plays one voice", (await voices(tab)) === 2);
  await tab.click("#lay-out");
  check("Lay out a dinner plays a cascade of eight", (await voices(tab)) === 10, await text(tab, "render-ms"));
  await tab.keyboard.press("Tab");
  await tab.locator("#set-down").focus();
  await tab.keyboard.press("Enter");
  check("Enter on Set it down plays once", (await voices(tab)) === 11);

  const emptyMid = [await seconds(tab, 500), await seconds(tab, 1000)];
  await setDressing(tab, 100);
  const fullMid = [await seconds(tab, 500), await seconds(tab, 1000)];
  check("the Grand Hall's mid band is lower dressed than empty", fullMid[0] < emptyMid[0] && fullMid[1] < emptyMid[1], `500 Hz ${emptyMid[0]} -> ${fullMid[0]} s, 1 kHz ${emptyMid[1]} -> ${fullMid[1]} s`);
  check("the dressing reads its real count", /^(\d+) of \1 pieces laid$/.test(await text(tab, "dressing-value")), await text(tab, "dressing-value"));
  await tab.waitForTimeout(400);
  await tab.click("#set-down");
  check("a set-down after the dressing changes plays", (await voices(tab)) === 12);
  await tab.screenshot({ path: join(shots, "check-desktop-dressed.png"), fullPage: true });

  await tab.click("#room-saloon");
  check("a room change names the room", (await text(tab, "room-name")) === "The Saloon");
  check("a room change keeps the dressing share", /^(\d+) of \1 pieces laid$/.test(await text(tab, "dressing-value")), await text(tab, "dressing-value"));
  await tab.click("#surface-deck");
  await tab.selectOption("#piece", "mic-stand");
  await tab.click("#set-down");
  check("a mic stand on a deck in the Saloon plays", (await voices(tab)) === 13, `${await text(tab, "render-ms")}, peak ${await text(tab, "peak-db")}`);
  for (const room of ROOMS) {
    await tab.click(`#room-${room}`);
    await tab.click("#lay-out");
  }
  check("every room's dinner cascade plays", (await voices(tab)) === 13 + 8 * ROOMS.length);
  await setDressing(tab, 0);
  await tab.click("#room-grand-hall");
  await tab.screenshot({ path: join(shots, "check-desktop.png"), fullPage: true });
  check("no console errors or warnings on the desktop", desk.errors.length === 0, desk.errors.join(" | "));
  await desk.context.close();

  // --- Phone width: no sideways scroll, controls in reach -----------------------------------------
  for (const colorScheme of ["light", "dark"]) {
    const phone = await open(browser, { width: 400, height: 800, colorScheme });
    const width = await phone.tab.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    check(`no horizontal scroll at 400 px (${colorScheme})`, width.scroll <= width.client, `${width.scroll} <= ${width.client}`);
    for (const id of CONTROLS) {
      const box = await phone.tab.locator(`#${id}`).boundingBox();
      if (box === null || box.x < 0 || box.x + box.width > 400) check(`#${id} fits at 400 px`, false, JSON.stringify(box));
    }
    await phone.tab.click("#set-down");
    await phone.tab.waitForFunction(() => document.getElementById("page")?.dataset.audio === "running", null, { timeout: 10000 });
    check(`Set it down plays at 400 px (${colorScheme})`, (await voices(phone.tab)) === 1);
    await phone.tab.screenshot({ path: join(shots, `check-phone-${colorScheme}.png`), fullPage: true });
    check(`no console errors at 400 px (${colorScheme})`, phone.errors.length === 0, phone.errors.join(" | "));
    await phone.context.close();
  }

  // --- The device figures, with a stand-in database ---------------------------------------------------
  const kept = await open(browser, { width: 1280, height: 900, runtime: true });
  await kept.tab.waitForFunction(() => document.getElementById("save-status")?.textContent?.includes("are saved"), null, { timeout: 5000 });
  check("with a database the page says it saves", true, await text(kept.tab, "save-status"));
  await kept.tab.waitForFunction(() => document.getElementById("tail-ms")?.textContent?.endsWith("ms"), null, { timeout: 15000 });
  for (let i = 0; i < 5; i += 1) await kept.tab.click("#set-down");
  await kept.tab.click("#lay-out");
  await kept.tab.waitForTimeout(3000);
  const writes = await kept.tab.evaluate(() => window.__writes);
  const last = writes.at(-1);
  check("render times are written once per pause", writes.length >= 1 && writes.length <= 2, `${writes.length} writes`);
  check("the document is timings/<device>", last !== undefined && /^timings\/[0-9a-f]{8}$/.test(last.path), last?.path);
  check(
    "the document holds the device and its figures",
    last !== undefined &&
      typeof last.data.userAgent === "string" &&
      /^\d+x\d+$/.test(last.data.screen) &&
      !Number.isNaN(Date.parse(last.data.date)) &&
      // Five set-downs, then the cascade's seven chairs after its one round.
      last.data.setDown["chiavari-chair"]?.length === 12 &&
      last.data.setDown["round-table-6ft-white"]?.length === 1 &&
      last.data.tail.length >= 1,
    JSON.stringify({ screen: last?.data.screen, sampleRate: last?.data.sampleRate, setDown: last?.data.setDown, tail: last?.data.tail }),
  );
  for (let i = 0; i < 20; i += 1) await kept.tab.click("#set-down");
  await kept.tab.waitForTimeout(2500);
  const bounded = await kept.tab.evaluate(() => window.__writes.at(-1).data.setDown["chiavari-chair"].length);
  check("each list keeps at most 20", bounded === 20, `${bounded}`);
  check("no console errors with the database", kept.errors.length === 0, kept.errors.join(" | "));
  await kept.context.close();
} finally {
  await browser.close();
}

console.log(failures === 0 ? "page check: PASS" : `page check: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
