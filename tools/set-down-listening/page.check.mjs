// Checks the built listening page in Chromium, wrapped as the Artifact host wraps it:
//   - every control renders, and the page is complete at rest (the Grand Hall, a Chiavari, empty, at 3 m);
//   - "Set it down", "Move it" and "Lay out a dinner" start the audio, with no console errors;
//   - the room path is live: the convolver holds a two-channel tail at the context's rate, each voice's send is
//     REVERB_SEND x reverberantGain as the engine gives it (the wiring: the formula is the page's own EST one,
//     recomputed here, so a wrong formula changed in both would pass), and both the output and the echo carry
//     sound after a set-down;
//   - the arrow keys move the room choice and keep the focus on the chosen chip;
//   - the first press waits for the limiter, and a press that has to finish a tail says so;
//   - the Grand Hall's mid-band readout is lower with the dinner laid than empty;
//   - nothing scrolls sideways at 400 px;
//   - with stand-ins for the artifact's database: one write per pause, never before it, to timings/<device>;
//     use() resolving null; a full store; `unavailable` twice, then a later change saving; a store that never
//     answers, noted within about 10 s.
//   node tools/set-down-listening/page.check.mjs [--out <folder>]
// It checks <folder>/index.html and writes its screenshots beside it. The default folder is
// tools/set-down-listening/out/, build.mjs's default.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outFlag = process.argv.indexOf("--out");
const shots = outFlag >= 0 ? process.argv[outFlag + 1] : join(here, "out");
if (shots === undefined || shots.startsWith("--")) throw new Error("--out needs a folder");
const built = join(shots, "index.html");
const web = createRequire(new URL("../../packages/web/package.json", import.meta.url));
const { chromium } = web("@playwright/test");
const esbuild = createRequire(web.resolve("vite/package.json"))("esbuild");

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

/** Whether a wait comes true in time: a timeout is a failed check, not a crash that skips the summary. */
async function cameTrue(wait) {
  try {
    await wait;
    return true;
  } catch {
    return false;
  }
}

// The send the Grand Hall's voices should carry: sqrt(32 pi / R_ref) x reverberantGain, R_ref being the empty hall's
// room constant at 1 kHz from the engine's roomConstant (R11; the page's EST derivation, Q = 2 at 2 m). It is
// checked against the gain the live graph holds, which proves the wiring: the formula here is the page's own, so
// it does not prove the derivation.
const probe = await esbuild.build({
  stdin: {
    contents: `
      import { ROOM_ACOUSTICS } from "../../packages/web/src/lib/set-down/rooms.js";
      import { referenceDinner, roomConstant, roomState } from "../../packages/web/src/lib/set-down/room-acoustics.js";
      const hall = ROOM_ACOUSTICS["grand-hall"];
      const send = Math.sqrt((32 * Math.PI) / roomConstant(hall, [0, 0, 0, 0, 0, 0, 0]));
      export const emptySend = send * roomState(hall, []).reverberantGain;
      export const dressedSend = send * roomState(hall, referenceDinner("grand-hall")).reverberantGain;
    `,
    resolveDir: here,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "warning",
});
const expected = await import(`data:text/javascript;base64,${Buffer.from(probe.outputFiles[0].text).toString("base64")}`);

/** Records every connection, and taps the output and each convolver with an analyser, so the check can hear the graph. */
function instrument() {
  const connect = AudioNode.prototype.connect;
  const edges = [];
  const taps = { out: [], wet: [] };
  window.__audio = { edges, taps };
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = connect.call(this, target, ...rest);
    if (target instanceof AudioNode) {
      edges.push([this, target]);
      const kind = target instanceof AudioDestinationNode ? "out" : this instanceof ConvolverNode ? "wet" : null;
      if (kind !== null && this.__tapped !== true) {
        this.__tapped = true;
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        connect.call(this, analyser);
        taps[kind].push(analyser);
      }
    }
    return result;
  };
}

/** The live room path: the newest convolver's buffer, the newest voice's send gain, and the peaks heard over `ms`. */
function roomPath(ms) {
  const { edges, taps } = window.__audio;
  const convolvers = edges.filter(([from]) => from instanceof ConvolverNode).map(([from]) => from);
  const convolver = convolvers.at(-1);
  const bus = edges.find(([, to]) => to === convolver)?.[0];
  const sends = edges.filter(([from, to]) => to === bus && from instanceof GainNode).map(([from]) => from);
  const peak = (analyser) => {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    return data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  };
  return new Promise((resolve) => {
    let out = 0;
    let wet = 0;
    const started = performance.now();
    const poll = () => {
      for (const a of taps.out) out = Math.max(out, peak(a));
      const tap = taps.wet.at(-1);
      if (tap !== undefined) wet = Math.max(wet, peak(tap));
      if (performance.now() - started < ms) setTimeout(poll, 10);
      else
        resolve({
          rate: convolver?.buffer?.sampleRate ?? null,
          channels: convolver?.buffer?.numberOfChannels ?? null,
          contextRate: convolver?.context.sampleRate ?? null,
          send: sends.at(-1)?.gain.value ?? null,
          out,
          wet,
        });
    };
    poll();
  });
}

/** A stand-in for the artifact runtime's db (artifact-capabilities 0.2.96 db.d.ts), in one of several moods. */
function fakeRuntime(mode) {
  window.__writes = [];
  window.__attempts = 0;
  const reject = (code) => Promise.reject(Object.assign(new Error(code), { code }));
  window.claude = {
    use: async (name) =>
      name !== "db" || mode === "null"
        ? null
        : {
            doc: (path) => ({
              get: () => (mode === "silent" ? new Promise(() => undefined) : Promise.resolve({ exists: false, data: () => undefined })),
              set: async (data) => {
                window.__attempts += 1;
                if (mode === "quota") return reject("quota_exceeded");
                if (mode === "flaky" && window.__attempts <= 2) return reject("unavailable");
                window.__writes.push({ path, at: performance.now(), data: JSON.parse(JSON.stringify(data)) });
              },
            }),
          },
  };
}

async function open(browser, { width = 1280, height = 900, runtime = null, colorScheme = "light", probe = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  // The fonts are Google's; the check runs offline, so they arrive empty and the fallbacks draw.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  if (probe) await context.addInitScript(instrument);
  if (runtime !== null) await context.addInitScript(fakeRuntime, runtime);
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
const waited = async (tab) => ((await tab.locator("#wait-row").isHidden()) ? "" : await text(tab, "wait-ms"));
const near = (a, b) => a !== null && Math.abs(a / b - 1) < 1e-5;
const status = (tab) => text(tab, "save-status");
const tailReady = (tab) => tab.waitForFunction(() => document.getElementById("tail-ms")?.textContent?.endsWith("ms"), null, { timeout: 15000 });

async function setDressing(tab, percent) {
  await tab.locator("#dressing").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, percent);
}

const browser = await chromium.launch();
try {
  // --- Desktop: controls, rest state, audio, the room path, the readout ----------------------------
  const desk = await open(browser, { probe: true });
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
  check("the tail is rendered at rest", await cameTrue(tailReady(tab)), await text(tab, "tail-ms"));
  check("without a database the page says it does not save", (await status(tab)).includes("does not save"), await status(tab));

  await tab.click("#set-down");
  await tab.waitForFunction(() => document.getElementById("page")?.dataset.audio === "running", null, { timeout: 10000 });
  check("Set it down starts the audio", (await voices(tab)) === 1, `context running, ${await voices(tab)} voice`);
  check("the first press waits for the limiter, and says so", /ms for the limiter to settle/.test(await waited(tab)), await waited(tab));
  check("Set it down shows its render time", /^\d+\.\d ms$/.test(await text(tab, "render-ms")), await text(tab, "render-ms"));
  check("Set it down shows its peak", /^\u2212?\d+\.\d dBFS$/.test(await text(tab, "peak-db")), await text(tab, "peak-db"));
  const empty = await tab.evaluate(roomPath, 1200);
  check("the convolver holds a two-channel tail at the context's rate", empty.rate !== null && empty.rate === empty.contextRate && empty.channels === 2, JSON.stringify(empty));
  check("the empty hall's send is REVERB_SEND x reverberantGain", near(empty.send, expected.emptySend), `${empty.send} against ${expected.emptySend}`);
  check("the output carries the set-down", empty.out > 1e-3, `peak ${empty.out.toExponential(2)}`);
  check("the echo carries it too", empty.wet > 1e-5, `peak ${empty.wet.toExponential(2)}`);

  await tab.click("#move");
  check("Move it plays one voice", (await voices(tab)) === 2);
  check("a later press waits for nothing", (await waited(tab)) === "", await waited(tab));
  await tab.click("#lay-out");
  check("Lay out a dinner plays a cascade of eight", (await voices(tab)) === 10, await text(tab, "render-ms"));
  await tab.locator("#set-down").focus();
  await tab.keyboard.press("Enter");
  check("Enter on Set it down plays once", (await voices(tab)) === 11);

  const emptyMid = [await seconds(tab, 500), await seconds(tab, 1000)];
  await setDressing(tab, 100);
  const fullMid = [await seconds(tab, 500), await seconds(tab, 1000)];
  check("the Grand Hall's mid band is lower dressed than empty", fullMid[0] < emptyMid[0] && fullMid[1] < emptyMid[1], `500 Hz ${emptyMid[0]} -> ${fullMid[0]} s, 1 kHz ${emptyMid[1]} -> ${fullMid[1]} s`);
  check("the dressing reads its real count", /^(\d+) of \1 pieces laid$/.test(await text(tab, "dressing-value")), await text(tab, "dressing-value"));
  await tab.click("#set-down");
  check("a press inside the dressing's pause finishes the tail, and says so", (await voices(tab)) === 12 && /ms for the tail/.test(await waited(tab)), await waited(tab));
  const dressed = await tab.evaluate(roomPath, 1200);
  check("the dressed hall's send is REVERB_SEND x reverberantGain", near(dressed.send, expected.dressedSend), `${dressed.send} against ${expected.dressedSend}`);
  check("the dressed hall's echo still sounds", dressed.wet > 1e-5 && dressed.rate === dressed.contextRate, `peak ${dressed.wet.toExponential(2)}`);
  await tab.screenshot({ path: join(shots, "check-desktop-dressed.png"), fullPage: true });

  await tab.click("#room-saloon");
  check("a room change names the room", (await text(tab, "room-name")) === "The Saloon");
  check("a room change keeps the dressing share", /^(\d+) of \1 pieces laid$/.test(await text(tab, "dressing-value")), await text(tab, "dressing-value"));
  await tab.click("#surface-deck");
  await tab.selectOption("#piece", "mic-stand");
  await tab.click("#set-down");
  check("a room's tail is made with the room change, not on the press", !(await waited(tab)).includes("tail"), (await waited(tab)) || "no wait");
  check("a mic stand on a deck in the Saloon plays", (await voices(tab)) === 13, `${await text(tab, "render-ms")}, peak ${await text(tab, "peak-db")}`);
  // A click with no pointer before it (assistive technology, or a script) after a room change: the room change's
  // own tail work is not this play's wait.
  await tab.click("#room-robert-adam-room");
  await tab.locator("#set-down").evaluate((button) => button.click());
  check("a pointerless click after a room change shows no tail wait", (await voices(tab)) === 14 && !(await waited(tab)).includes("tail"), (await waited(tab)) || "no wait");
  for (const room of ROOMS) {
    await tab.click(`#room-${room}`);
    await tab.click("#lay-out");
  }
  check("every room's dinner cascade plays", (await voices(tab)) === 14 + 8 * ROOMS.length);
  check(
    "the audio status is announced, apart from the ring-switch hint",
    (await tab.locator("#audio-status").getAttribute("role")) === "status" && (await tab.locator("#audio-hint").innerText()).includes("ring switch"),
  );
  await setDressing(tab, 0);
  await tab.click("#room-grand-hall");
  await tab.waitForTimeout(400);
  await tab.screenshot({ path: join(shots, "check-desktop.png"), fullPage: true });
  await tab.locator("#room-grand-hall").focus();
  await tab.keyboard.press("ArrowRight");
  check(
    "ArrowRight on the Grand Hall chooses the Saloon and keeps the focus on it",
    (await text(tab, "room-name")) === "The Saloon" &&
      (await tab.locator("#room-saloon").getAttribute("aria-checked")) === "true" &&
      (await tab.evaluate(() => document.activeElement?.id)) === "room-saloon",
    `${await text(tab, "room-name")}, focus on #${await tab.evaluate(() => document.activeElement?.id ?? "")}`,
  );
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

  // --- The device figures, with a database that answers --------------------------------------------
  const kept = await open(browser, { runtime: "ok" });
  const saysSaved = await cameTrue(kept.tab.waitForFunction(() => document.getElementById("save-status")?.textContent?.includes("are saved"), null, { timeout: 5000 }));
  check("with a database the page says it saves", saysSaved, await status(kept.tab));
  await tailReady(kept.tab);
  // The tail made at rest is saved after its own pause; wait for it, then time a press's write.
  await kept.tab.waitForFunction(() => window.__writes.length >= 1, null, { timeout: 5000 });
  const before = await kept.tab.evaluate(() => window.__writes.length);
  for (let i = 0; i < 5; i += 1) await kept.tab.click("#set-down");
  await kept.tab.click("#lay-out");
  const pressedAt = await kept.tab.evaluate(() => performance.now());
  await kept.tab.waitForTimeout(1200);
  check("no write lands before the 1.5 s pause", (await kept.tab.evaluate(() => window.__writes.length)) === before);
  await kept.tab.waitForTimeout(1800);
  const writes = await kept.tab.evaluate(() => window.__writes);
  const last = writes.at(-1);
  check("the presses are written once, after the pause", writes.length === before + 1 && last.at - pressedAt >= 1450, `${writes.length - before} write, ${(last.at - pressedAt).toFixed(0)} ms after the last press`);
  check("the document is timings/<device>", /^timings\/[0-9a-f]{8}$/.test(last.path), last.path);
  check(
    "the document holds the device and its figures",
    typeof last.data.userAgent === "string" &&
      /^\d+x\d+$/.test(last.data.screen) &&
      !Number.isNaN(Date.parse(last.data.date)) &&
      // Five set-downs, then the cascade's seven chairs after its one round.
      last.data.setDown["chiavari-chair"]?.length === 12 &&
      last.data.setDown["round-table-6ft-white"]?.length === 1 &&
      last.data.tail.length >= 1,
    JSON.stringify({ screen: last.data.screen, sampleRate: last.data.sampleRate, setDown: last.data.setDown, tail: last.data.tail }),
  );
  for (let i = 0; i < 20; i += 1) await kept.tab.click("#set-down");
  await kept.tab.waitForTimeout(2500);
  const bounded = await kept.tab.evaluate(() => window.__writes.at(-1).data.setDown["chiavari-chair"].length);
  check("each list keeps at most 20", bounded === 20, `${bounded}`);
  check("no console errors with the database", kept.errors.length === 0, kept.errors.join(" | "));
  await kept.context.close();

  // --- use() resolves null --------------------------------------------------------------------------
  const none = await open(browser, { runtime: "null" });
  await none.tab.waitForFunction(() => document.getElementById("save-status")?.textContent?.includes("does not save"), null, { timeout: 5000 });
  await none.tab.click("#set-down");
  check("use() resolving null: the page plays and says it does not save", (await voices(none.tab)) === 1, await status(none.tab));
  check("no console errors when use() resolves null", none.errors.length === 0, none.errors.join(" | "));
  await none.context.close();

  // --- A full store stops saving ---------------------------------------------------------------------
  const full = await open(browser, { runtime: "quota" });
  await full.tab.waitForFunction(() => document.getElementById("save-status")?.textContent?.includes("are saved"), null, { timeout: 5000 });
  await full.tab.click("#set-down");
  await full.tab.waitForFunction(() => document.getElementById("save-status")?.textContent?.includes("store is full"), null, { timeout: 6000 });
  const firstAttempts = await full.tab.evaluate(() => window.__attempts);
  await full.tab.click("#set-down");
  await full.tab.waitForTimeout(2500);
  const laterAttempts = await full.tab.evaluate(() => window.__attempts);
  check("quota_exceeded says the store is full and stops saving", laterAttempts === firstAttempts, `${firstAttempts} then ${laterAttempts} attempts; "${await status(full.tab)}"`);
  check("no console errors with a full store", full.errors.length === 0, full.errors.join(" | "));
  await full.context.close();

  // --- `unavailable` twice, then a later change saves ------------------------------------------------
  const flaky = await open(browser, { runtime: "flaky" });
  await flaky.tab.waitForFunction(() => document.getElementById("save-status")?.textContent?.includes("are saved"), null, { timeout: 5000 });
  // The tail made at rest is the first change, so its write is the first attempt to fail.
  await flaky.tab.waitForFunction(() => window.__attempts >= 1, null, { timeout: 6000 });
  await flaky.tab.waitForTimeout(100);
  const afterFirst = await status(flaky.tab);
  await flaky.tab.click("#set-down");
  await flaky.tab.waitForFunction(() => window.__attempts >= 2, null, { timeout: 8000 });
  await flaky.tab.waitForTimeout(100);
  const afterSecond = await status(flaky.tab);
  await flaky.tab.click("#set-down");
  await flaky.tab.waitForFunction(() => window.__writes.length >= 1, null, { timeout: 12000 });
  await flaky.tab.waitForTimeout(100);
  const savedWrite = await flaky.tab.evaluate(() => window.__writes.at(-1).data);
  const saved = savedWrite.setDown["chiavari-chair"]?.length;
  check(
    "unavailable is transient: a later change saves everything",
    afterFirst.includes("tries again") && afterSecond.includes("tries again") && saved === 2 && savedWrite.tail.length >= 1,
    `"${afterFirst}" / ${saved} renders and ${savedWrite.tail.length} tail saved`,
  );
  check("a save after the retries says so", (await status(flaky.tab)).includes("are saved"), await status(flaky.tab));
  check("no console errors with a flaky store", flaky.errors.length === 0, flaky.errors.join(" | "));
  await flaky.context.close();

  // --- A store that never answers ------------------------------------------------------------------------
  const silent = await open(browser, { runtime: "silent" });
  const waiting = await status(silent.tab);
  const since = Date.now();
  await silent.tab.waitForFunction(() => document.getElementById("save-status")?.textContent?.includes("isn't answering"), null, { timeout: 12000 });
  const noted = Date.now() - since;
  check("a store that never answers is noted within about 10 s", waiting.includes("Checking") && noted < 11500, `"${waiting}", then noted after ${(noted / 1000).toFixed(1)} s`);
  await silent.tab.click("#set-down");
  check("the page still plays while the store is silent", (await voices(silent.tab)) === 1);
  check("no console errors with a silent store", silent.errors.length === 0, silent.errors.join(" | "));
  await silent.context.close();
} finally {
  await browser.close();
}

console.log(failures === 0 ? "page check: PASS" : `page check: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
