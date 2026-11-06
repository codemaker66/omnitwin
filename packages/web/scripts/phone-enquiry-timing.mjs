// ---------------------------------------------------------------------------
// Goal 07's two-minute phone enquiry: "Elaine's client goes from the home to a
// sent enquiry in under two minutes without a dead end, on a phone."
//
// A machine cannot time a person, so this times the two parts apart:
//   - the system's share, measured: an emulated phone (390 x 844, touch, 4x
//     CPU slowdown, Lighthouse's mobile network: 150 ms round trip, 1.6 Mbit/s
//     down, 750 kbit/s up) opens the home page, taps "Ask about a date",
//     fills the enquiry composer the way a person does and sends it; each step
//     is timed from the action to what it shows;
//   - the person's share, modelled with the Keystroke-Level Model (Card, Moran
//     and Newell, 1980; touch values after Rice and Lartigue, 2014): a mental
//     preparation (1.35 s) before each field and decision, a tap (0.6 s with
//     the reach), typing at the mean phone speed measured by Palin et al.
//     (CHI 2019: 36.2 words a minute, 0.33 s a character), the native date
//     picker as six taps, and 20 s to read the page down to the form.
// It fails (exit 1) when a step has no way on (a dead end) or the two shares
// together pass 120 s. A person with a real phone is the acceptance; this is
// the regression guard and the method (docs/engineering/web-vitals.md).
//
// The enquiry is never sent: POST /public/enquiries is answered here after
// --api-ms (default 400 ms), so no venue is emailed and no lead is created,
// whichever site --base names. Everything else loads from --base.
//
//   node scripts/phone-enquiry-timing.mjs --base http://127.0.0.1:4173 [--cpu 4] [--api-ms 400] [--out FILE]
//   node scripts/phone-enquiry-timing.mjs --base https://venviewer.com
// Where Playwright's own Chromium is not installed, --chromium names a binary.
// ---------------------------------------------------------------------------

import { chromium, devices } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = arg("base", "http://127.0.0.1:4173").replace(/\/+$/u, "");
const CPU = Number(arg("cpu", "4"));
const API_MS = Number(arg("api-ms", "400"));
const OUT = arg("out", null);
const CHROMIUM = arg("chromium", null);
const BUDGET_S = 120;

/** The Keystroke-Level Model's operators, in seconds. */
export const KLM = {
  /** Mental preparation before a field or a decision. */
  mental: 1.35,
  /** A tap, with the reach to it. */
  tap: 0.6,
  /** One character on a phone keyboard: 36.2 words a minute, 5 characters a word. */
  character: 60 / (36.2 * 5),
  /** A native date picker: month, day, confirm, with a scroll or two. */
  datePicker: 6 * 0.6,
  /** Reading the home page down to the form. */
  readToForm: 20,
};

/** What a person types, as Elaine's client would (fictional). The guests
 *  field opens holding a suggested count, which they clear first. */
const ANSWERS = {
  occasion: "Wedding",
  clearGuests: 3,
  guests: "120",
  date: "2027-06-12",
  name: "Morag Henderson",
  email: "morag.henderson@example.com",
};

/** The person's share for one run of the form, from its operators. */
export function modelledHumanSeconds(answers = ANSWERS) {
  const fields = [
    // Find the form.
    KLM.readToForm + KLM.mental + KLM.tap,
    // The occasion: one tap on its pill.
    KLM.mental + KLM.tap,
    // Guests: tap the field, clear the suggestion, type. Name and email: tap, type.
    KLM.mental + KLM.tap + (answers.clearGuests + answers.guests.length) * KLM.character,
    // The date: open the picker and choose.
    KLM.mental + KLM.tap + KLM.datePicker,
    KLM.mental + KLM.tap + answers.name.length * KLM.character,
    KLM.mental + KLM.tap + answers.email.length * KLM.character,
    // Read what will be sent, then send.
    KLM.mental * 2 + KLM.tap,
  ];
  return fields.reduce((sum, seconds) => sum + seconds, 0);
}

async function main() {
  // Behind an egress proxy the browser goes through it too; loopback does not.
  const proxyServer = process.env["HTTPS_PROXY"] ?? process.env["https_proxy"];
  const browser = await chromium.launch({
    ...(CHROMIUM === null ? {} : { executablePath: CHROMIUM }),
    ...(proxyServer === undefined || proxyServer === "" ? {} : { proxy: { server: proxyServer, bypass: "127.0.0.1,localhost" } }),
  });
  const context = await browser.newContext({ ...devices["iPhone 13"], reducedMotion: "reduce" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1_638_400 / 8, uploadThroughput: 768_000 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  const sent = [];
  await context.route("**/public/enquiries", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push(route.request().postDataJSON());
    await new Promise((done) => { setTimeout(done, API_MS); });
    return route.fulfill({ status: 201, json: { data: { enquiryId: "00000000-0000-4000-8000-000000000001", message: "Enquiry received" } } });
  });

  const steps = [];
  const step = async (label, action) => {
    const start = Date.now();
    try {
      await action();
      steps.push({ label, ms: Date.now() - start, reached: true });
    } catch (error) {
      steps.push({ label, ms: Date.now() - start, reached: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) });
      throw error;
    }
  };

  let deadEnd = null;
  try {
    await step("the home page shows the hall", async () => {
      await page.goto(`${BASE}/`, { waitUntil: "commit" });
      await page.getByRole("heading", { level: 1, name: "Grand Hall", exact: true }).waitFor({ timeout: 60_000 });
    });
    await step("Ask about a date brings the form", async () => {
      await page.getByRole("link", { name: "Ask about a date" }).first().tap();
      const composer = page.getByTestId("enquiry-composer");
      await composer.waitFor({ timeout: 30_000 });
      await composer.scrollIntoViewIfNeeded();
    });
    const composer = page.getByTestId("enquiry-composer");
    await step("the occasion", () => composer.getByRole("button", { name: ANSWERS.occasion, exact: true }).tap());
    await step("the guests", async () => {
      const guests = composer.getByLabel("Guests");
      await guests.tap();
      await guests.fill("");
      await guests.pressSequentially(ANSWERS.guests);
    });
    await step("the date", () => composer.getByLabel("Date (optional)").fill(ANSWERS.date));
    await step("the name", () => composer.getByLabel(/Your name/u).pressSequentially(ANSWERS.name));
    await step("the email", () => composer.getByLabel("Your email").pressSequentially(ANSWERS.email));
    await step("Send enquiry says it is sent", async () => {
      await composer.getByRole("button", { name: "Send enquiry" }).tap();
      await composer.getByRole("status").getByText("Enquiry sent").waitFor({ timeout: 30_000 });
    });
  } catch {
    deadEnd = steps.find((entry) => !entry.reached)?.label ?? "unknown";
  } finally {
    await browser.close();
  }

  // Typing is the person's time, already in the model; the system's share is
  // everything else each step took.
  const typed = new Set(["the guests", "the name", "the email"]);
  const systemSeconds = steps.filter((entry) => !typed.has(entry.label)).reduce((sum, entry) => sum + entry.ms, 0) / 1000;
  const humanSeconds = modelledHumanSeconds();
  const totalSeconds = systemSeconds + humanSeconds;
  const result = {
    base: BASE,
    device: "iPhone 13 (390 x 844), touch",
    cpuSlowdown: CPU,
    network: "150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up",
    apiAnswerMs: API_MS,
    steps,
    sentFields: sent[0] === undefined ? null : Object.keys(sent[0]).sort(),
    systemSeconds: Number(systemSeconds.toFixed(1)),
    humanSecondsModelled: Number(humanSeconds.toFixed(1)),
    totalSeconds: Number(totalSeconds.toFixed(1)),
    budgetSeconds: BUDGET_S,
    deadEnd,
    verdict: deadEnd === null && totalSeconds <= BUDGET_S ? "within two minutes" : "FAILS",
  };
  const text = JSON.stringify(result, null, 2);
  console.log(text);
  if (OUT !== null) writeFileSync(OUT, `${text}\n`);
  process.exit(result.verdict === "FAILS" ? 1 : 0);
}

// Run directly, on any platform: a Windows path or one with a space is not a
// bare file:// join.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
