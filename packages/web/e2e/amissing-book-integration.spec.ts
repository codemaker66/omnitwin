import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { expect, test as base, type Locator, type Page } from "@playwright/test";

// CI's other routes use Vite dev. This worker serves the unchanged export after
// the exact two production packaging steps, over real HTTP. Live qualification
// overrides the fixture with E2E_AMISSING_GAME_URL; aliases still use baseURL.
const test = base.extend<object, { gameUrl: string }>({
  gameUrl: [async ({ browserName: _browserName }, use) => {
    const deployed = process.env["E2E_AMISSING_GAME_URL"];
    if (deployed !== undefined) { await use(deployed); return; }
    const root = mkdtempSync(join(tmpdir(), "amissing-game-e2e-"));
    const web = resolve(import.meta.dirname, "..");
    const output = join(root, "amissing-book");
    const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
      ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".mp3": "audio/mpeg" };
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
      const file = resolve(root, `.${decodeURIComponent(pathname)}`, ...(pathname.endsWith("/") ? ["index.html"] : []));
      if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
      try {
        const body = readFileSync(file);
        response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Content-Length": body.length });
        response.end(body);
      } catch { response.writeHead(404).end(); }
    });
    try {
      cpSync(join(web, "public/amissing-book"), output, { recursive: true });
      execFileSync(process.execPath, [join(web, "scripts/prepare-amissing-book-resume.mjs"), output], { stdio: "pipe" });
      execFileSync(process.execPath, [join(web, "scripts/version-amissing-book-audio.mjs"), output, output], { stdio: "pipe" });
      await new Promise<void>((ready, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ready); });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Game fixture did not bind");
      await use(`http://127.0.0.1:${String(address.port)}/amissing-book/`);
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((closed, reject) => server.close((error) => { if (error) reject(error); else closed(); }));
      // mkdtemp supplies this exact owned directory, never a shared checkout.
      if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}amissing-game-e2e-`)) rmSync(root, { recursive: true, force: true });
    }
  }, { scope: "worker", timeout: 60_000 }],
});

const SAVE_KEY = "amissing-book-checkpoint-v1";
const OPENING_VOICES = ["de0b5e66", "5b1397cd", "df3cc8e4", "d789adc8", "c50ee102"];
interface Playback { url: string; duration: number; elapsed: number; state: string }
declare global { interface Window { amissingPlayback: Playback[] } }

// Observe the real fetch/decode/start chain. Native methods still run unchanged;
// this is not a mock, muted context, synthesized recording, or playback shortcut.
async function observePlayback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const responses = new WeakMap<ArrayBuffer, string>();
    const buffers = new WeakMap<AudioBuffer, string>();
    const sources: { source: AudioBufferSourceNode; url: string; at: number }[] = [];
    // Native methods are deliberately captured, then called with their receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
      const url = this.url;
      return arrayBuffer.call(this).then((bytes) => { responses.set(bytes, url); return bytes; });
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (
      data: ArrayBuffer, success?: DecodeSuccessCallback, failure?: DecodeErrorCallback,
    ): Promise<AudioBuffer> {
      const url = responses.get(data) ?? "";
      return decode.call(this, data, success, failure).then((buffer) => { buffers.set(buffer, url); return buffer; });
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when?: number, offset?: number, duration?: number): void {
      start.call(this, when, offset, duration);
      const url = this.buffer === null ? undefined : buffers.get(this.buffer);
      if (url !== undefined) sources.push({ source: this, url, at: when ?? this.context.currentTime });
    };
    Object.defineProperty(window, "amissingPlayback", { get: () => sources.map(({ source, url, at }) => ({
      url, duration: source.buffer?.duration ?? 0, elapsed: source.context.currentTime - at, state: source.context.state,
    })) });
  });
}

function watchFailures(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (response.url().includes("/amissing-book/") && response.status() >= 400) errors.push(`${String(response.status())} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/amissing-book/") && request.failure()?.errorText !== "net::ERR_ABORTED") {
      errors.push(`${request.failure()?.errorText ?? "request failed"} ${request.url()}`);
    }
  });
  return errors;
}

async function expectFits(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const bounds = await locator.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.top).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function advance(page: Page, fragment: string): Promise<void> {
  const text = page.locator(".dlg-text");
  await expect(text).toContainText(fragment, { timeout: 15_000 });
  // The mobile stylesheet deliberately hides the hint; its DOM hidden property
  // is the authored reveal-complete state on both desktop and landscape phone.
  if (await page.locator(".dlg-hint").evaluate((node) => node.hasAttribute("hidden"))) await text.click();
  await expect(page.locator(".dlg-hint")).toHaveJSProperty("hidden", false);
  await text.click();
}

async function pick(page: Page, label: string): Promise<void> {
  const button = page.locator(".dlg-choices").getByRole("button", { name: label, exact: false });
  await expectFits(page, button);
  // Imported choices ignore input for their first 450 ms to prevent a narration
  // tap becoming an accidental choice. Retry the visible action until accepted.
  await expect(async () => {
    if (await button.isVisible()) await button.click();
    await expect(button).not.toBeVisible({ timeout: 600 });
  }).toPass({ timeout: 4000, intervals: [500] });
}

async function enterBook(page: Page): Promise<void> {
  await advance(page, "Glasgow, tonight.");
  await pick(page, "Follow the bell.");
  await advance(page, "The case should be inside the Hall");
  await advance(page, "The case has been empty for two hundred years.");
  await advance(page, "The label reads: Volume II.");
  await advance(page, "Fourteen keyholes");
  await pick(page, "Touch the page.");
  await advance(page, "Ink climbs your fingers like ivy.");
  await expect(page.getByRole("heading", { name: "The Book writes you" })).toBeVisible();
}

for (const device of ["desktop", "phone"] as const) {
  test.describe(device, () => {
    test.use({ viewport: device === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
      hasTouch: device === "phone" });
    test("starts the original narrated story, makes choices and resumes the same saved branch", async ({ page, gameUrl }, testInfo) => {
      test.setTimeout(100_000);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors = watchFailures(page);
      const voiceUrls: string[] = [];
      page.on("request", (request) => { if (/\/vo\/vo_[a-z0-9]+\.mp3/u.test(request.url())) voiceUrls.push(request.url()); });
      await observePlayback(page);
      await page.goto(gameUrl);
      await expect(page).toHaveTitle("The Amissing Book");
      await expect(page.getByRole("button", { name: "Begin", exact: true })).toBeAttached();
      if (device === "phone") {
        await expectFits(page, page.getByText("Turn your phone sideways to play."));
        await page.screenshot({ path: testInfo.outputPath("phone-portrait.png") });
        await page.setViewportSize({ width: 844, height: 390 });
        await expect(page.locator("#rotate")).toBeHidden();
      }
      await expectFits(page, page.getByRole("heading", { name: "The Amissing Book" }));
      await expectFits(page, page.getByRole("button", { name: "Begin", exact: true }));
      await page.getByRole("button", { name: "Begin", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.amissingPlayback.some((sample) =>
        /\/vo_de0b5e66\.mp3/u.test(sample.url) && sample.duration > 1 && sample.elapsed > 0.3 && sample.state === "running")),
      { timeout: 20_000, message: "the actual opening recording decodes, starts and advances in a running audio context" }).toBe(true);
      await expectFits(page, page.locator(".dlg"));
      await page.screenshot({ path: testInfo.outputPath(`${device}-opening.png`) });
      await enterBook(page);
      for (const id of OPENING_VOICES) {
        expect(voiceUrls.some((url) => url.includes(`/vo_${id}.mp3?v=`)), `opening take ${id} uses content versioning`).toBe(true);
      }
      await expectFits(page, page.locator(".creator-book"));
      await page.getByPlaceholder("Your name").fill("Eilidh");
      await page.locator(".ability").filter({ hasText: "Brawn" }).click();
      await page.getByRole("button", { name: "Sign the Book" }).click();
      await advance(page, "It spells your name wrong.");
      await advance(page, "What were you looking for");
      await pick(page, "Family.");
      await advance(page, "Family. The Book underlines it twice.");
      await advance(page, "The page tips, and you fall.");
      await advance(page, "Lammas, sixteen ninety-seven.");
      await advance(page, "A robin drops off");
      await advance(page, "That woman's face is scored out");
      await advance(page, "An old mastiff sits on your foot");
      const choices = page.locator(".dlg-choices .choice-label");
      await expect(choices).toHaveText(["Share your heel of bread.", "Keep it."]);
      const beforeChoices = await choices.allTextContents();
      const before = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
      expect(before).toContain('"q1_family"');
      expect(before).toContain('"name":"Eilidh"');
      expect(before).toContain('"strength":"brawn"');
      await page.screenshot({ path: testInfo.outputPath(`${device}-choice.png`) });
      await page.reload();
      await expectFits(page, page.getByRole("button", { name: "Resume", exact: true }));
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await expect(choices).toHaveText(beforeChoices);
      await expect(page.locator(".dlg-text")).toContainText("An old mastiff sits on your foot");
      const after = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
      expect(after).toBe(before);
      await page.screenshot({ path: testInfo.outputPath(`${device}-resumed.png`) });
      await pick(page, "Share your heel of bread.");
      await expect(page.locator(".dlg-text")).toContainText("You have a dog now.");
      await expect.poll(() => page.evaluate(() => window.amissingPlayback.some((sample) =>
        /\/vo\/vo_/u.test(sample.url) && sample.duration > 1 && sample.elapsed > 0.1 && sample.state === "running"))).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

for (const route of ["/quiz", "/quiz/", "/trades-house/discover-your-craft"]) {
  test(`old public entry ${route} opens the game`, async ({ page }) => {
    const errors = watchFailures(page);
    await page.goto(route);
    await expect(page).toHaveURL(/\/amissing-book\/$/u);
    await expect(page.getByRole("button", { name: "Begin", exact: true })).toBeVisible();
    await expect(page).toHaveTitle("The Amissing Book");
    expect(errors).toEqual([]);
  });
}

test("keeps malformed checkpoints and allows a fresh opening with an honest warning", async ({ page, gameUrl }) => {
  await page.addInitScript((key) => { localStorage.setItem(key, "{bad checkpoint"); }, SAVE_KEY);
  await page.goto(gameUrl);
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("saved place could not be opened");
  await expect(page.getByRole("button", { name: "Begin", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe("{bad checkpoint");
});

test("blocked storage does not prevent starting or pretend progress was saved", async ({ page, gameUrl }) => {
  test.setTimeout(45_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get: () => { throw new DOMException("Storage denied", "SecurityError"); } });
  });
  const errors = watchFailures(page);
  await page.goto(gameUrl);
  await expect(page.getByRole("status")).toContainText("Saving is unavailable");
  await page.getByRole("button", { name: "Begin", exact: true }).click();
  await advance(page, "Glasgow, tonight.");
  await pick(page, "Follow the bell.");
  await expect(page.locator(".dlg-text")).toContainText("The case should be inside the Hall");
  expect(errors).toEqual([]);
});
