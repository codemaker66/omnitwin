import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { z } from "zod";
import {
  HallkeeperSheetV2Schema,
  SheetApprovalSchema,
  SheetPaperCheckSchema,
  describeSheetCopy,
  sheetSetupSteps,
  type HallkeeperSheetV2,
  type SheetPaperCheckResult,
} from "@omnitwin/types";
import { checkSheetPaper } from "../../api/sheet-paper-check.js";
import { describeSheetStanding } from "../../components/hallkeeper/SheetStandingMark.js";
import { SHEET_STANDING_INTERVAL_MS } from "../../components/hallkeeper/useSheetStanding.js";
import { HallkeeperPage } from "../HallkeeperPage.js";

// ---------------------------------------------------------------------------
// Goal 05 on the phone: the hallkeeper sheet names its release as the paper
// does, lists the room the paper lists, and says so when it is no longer
// the version in force.
//
// The sheet rendered here is the server's own response for the demo wedding
// approved as v3: packages/api/src/__tests__/sheet-release-identity.test.ts
// serves it through the real routes, proves the PDF printed from it carries
// the same release (its words and its QR code) and the same store and setup
// counts, and keeps the response in fixtures/served-wedding-sheet.json. So
// what this test reads on the phone and what that test reads on paper are
// made from the same bytes.
// ---------------------------------------------------------------------------

vi.mock("../../api/client.js", () => ({ getAuthToken: vi.fn().mockResolvedValue(null) }));
vi.mock("../../api/sheet-paper-check.js", () => ({ checkSheetPaper: vi.fn() }));
vi.mock("../../components/hallkeeper/HallkeeperStatusBanner.js", () => ({ HallkeeperStatusBanner: () => null }));
vi.mock("../../components/hallkeeper/useHallkeeperContext.js", () => ({
  useHallkeeperContext: () => ({ status: "idle", context: null, error: null, retry: vi.fn() }),
}));
vi.mock("../../components/hallkeeper/useSheetReviewStatus.js", () => ({ useSheetReviewStatus: () => null }));
vi.mock("../../lib/progress-sync-queue.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/progress-sync-queue.js")>(),
  listPendingProgress: vi.fn().mockResolvedValue([]),
  ackProgress: vi.fn().mockResolvedValue(undefined),
}));

const ServedSchema = z.object({
  v3: z.object({ data: HallkeeperSheetV2Schema }),
  v4: z.object({ approval: SheetApprovalSchema, paperCheck: SheetPaperCheckSchema, generatedAt: z.iso.datetime() }),
});
const SERVED = ServedSchema.parse(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../../../../api/src/__tests__/fixtures/served-wedding-sheet.json"), "utf8")));
const V3: HallkeeperSheetV2 = SERVED.v3.data;
const V4: HallkeeperSheetV2 = { ...V3, ...SERVED.v4 };

/** The paper's release words ("v3, issued 22 Oct 16:12, printed …") up to the printed minute. */
function releaseWords(sheet: HallkeeperSheetV2): { readonly version: string; readonly issuedDay: string; readonly issuedTime: string; readonly line: string } {
  const line = describeSheetCopy({
    version: sheet.approval?.version ?? null,
    issuedAt: sheet.approval?.approvedAt ?? null,
    printedAt: null,
    timeZone: sheet.venue.timezone,
  });
  const words = /^(v\d+), issued (\d{1,2} [A-Z][a-z]{2}) (\d\d:\d\d)$/u.exec(line);
  if (words?.[1] === undefined || words[2] === undefined || words[3] === undefined) throw new Error(`Unexpected release words: ${line}`);
  return { version: words[1], issuedDay: words[2], issuedTime: words[3], line };
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** Serves `sheets` in turn to each read of the sheet, the last one from then on. */
function serveSheets(...sheets: HallkeeperSheetV2[]): { readonly sheetReads: () => number } {
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes("/v2")) {
      const sheet = sheets[Math.min(reads, sheets.length - 1)];
      reads += 1;
      return Promise.resolve(new Response(JSON.stringify({ data: sheet }), { status: 200 }));
    }
    if (url.includes("/progress")) return Promise.resolve(new Response(JSON.stringify({ data: { checked: {} } }), { status: 200 }));
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  }));
  return { sheetReads: () => reads };
}

async function mount(): Promise<void> {
  render(<MemoryRouter initialEntries={[`/hallkeeper/${V3.config.id}`]}>
    <Routes><Route path="/hallkeeper/:configId" element={<HallkeeperPage />} /></Routes>
  </MemoryRouter>);
  await screen.findByRole("heading", { level: 1, name: V3.space.name });
}

function answers(...results: SheetPaperCheckResult[]): void {
  const mock = vi.mocked(checkSheetPaper);
  for (const result of results) mock.mockResolvedValueOnce(result);
  mock.mockResolvedValue(results[results.length - 1] ?? { state: "unknown" });
}

const printCopy = (): HTMLElement => {
  const copy = document.querySelector<HTMLElement>(".hk-print-only");
  if (copy === null) throw new Error("No print copy");
  return copy;
};

beforeEach(() => { vi.mocked(checkSheetPaper).mockReset(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the phone names the release the paper names", () => {
  it("stamps the screen and the browser print with the paper's version, issue time and approver", async () => {
    serveSheets(V3);
    await mount();
    const words = releaseWords(V3);
    expect(words.line).toBe("v3, issued 22 Oct 16:12");
    // The screen's stamp: the same version, the same minute on the venue's clock, the same approver.
    const stamp = document.querySelector<HTMLElement>(".hkf-approval-stamp")?.textContent ?? "";
    expect(stamp).toContain(`Approved ${words.version}`);
    expect(stamp).toContain(words.issuedDay);
    expect(stamp).toContain(words.issuedTime);
    expect(stamp).toContain("Fiona Grant");
    // The browser print states the copy in the PDF's own words, printed at the moment of printing.
    const copy = printCopy();
    expect(copy.querySelector(".hk-print-version")?.textContent).toMatch(new RegExp(`^${words.line}, printed \\d{1,2} [A-Z][a-z]{2} \\d\\d:\\d\\d$`, "u"));
    expect(within(copy).getByTestId("paper-copy-stamp").textContent).toContain(`${words.line}, printed`);
  });

  it("draws, on the browser print, the code the server issued for that release", async () => {
    serveSheets(V3);
    await mount();
    // The print copy is aria-hidden on screen, so its code is looked up as hidden.
    const path = within(printCopy()).getByRole("img", { name: "QR code to check this copy is current", hidden: true }).querySelector("path")?.getAttribute("d") ?? "";
    // Each run "M{x} {y}h{n}v1h-{n}z" is n dark modules, offset by a four-module quiet zone.
    const size = V3.paperCheck?.qr.size ?? 0;
    const rows = Array.from({ length: size }, () => Array.from({ length: size }, () => "0"));
    for (const run of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/gu)) {
      for (let i = 0; i < Number(run[3]); i++) {
        const row = rows[Number(run[2]) - 4];
        if (row !== undefined) row[Number(run[1]) - 4 + i] = "1";
      }
    }
    expect(rows.map((row) => row.join(""))).toEqual(V3.paperCheck?.qr.rows);
    expect(V3.paperCheck?.url).toMatch(/\/sheet-check\?s=[0-9a-f-]{36}&v=3&h=[0-9a-f]{16}$/u);
  });
});

describe("the phone lists the room the paper lists", () => {
  /** Every row the phone's checklist shows, category by category and page by page. */
  function phoneRows(): { phase: string; zone: string; name: string; qty: number }[] {
    const seen: { phase: string; zone: string; name: string; qty: number }[] = [];
    const panel = (): HTMLElement => screen.getByRole("region", { name: "Setup workspace" });
    for (const phase of V3.phases.map((entry) => entry.phase)) {
      fireEvent.change(within(panel()).getByLabelText("Setup category"), { target: { value: phase } });
      for (;;) {
        for (const task of panel().querySelectorAll(".hkf-task")) {
          const name = task.querySelector("strong")?.textContent ?? "";
          const zone = (task.querySelector("small")?.textContent ?? "").split(" · ")[0] ?? "";
          const qty = Number((task.querySelector("b")?.textContent ?? "").replace("×", ""));
          seen.push({ phase, zone, name, qty });
        }
        const next = within(panel()).getByRole("button", { name: "Next setup items" });
        if (next.hasAttribute("disabled")) break;
        fireEvent.click(next);
      }
    }
    return seen;
  }

  const served = (): { phase: string; zone: string; name: string; qty: number }[] =>
    V3.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows.map((row) => ({ phase: phase.phase, zone: zone.zone, name: row.name, qty: row.qty }))));
  const order = (rows: { phase: string; zone: string; name: string; qty: number }[]): string[] =>
    rows.map((row) => `${row.phase}|${row.zone}|${row.name}|${String(row.qty)}`).sort();

  it("shows every served row with its quantity, and merged across zones they are the paper's setup lines", async () => {
    serveSheets(V3);
    await mount();
    const rows = phoneRows();
    expect(rows.length).toBe(V3.totals.totalRows);
    expect(order(rows)).toEqual(order(served()));
    // sheetSetupSteps is what the PDF prints under "Setup, in order"
    // (sheet-release-identity.test.ts reads it back from the PDF).
    for (const step of sheetSetupSteps(V3)) {
      const onPhone = new Map<string, number>();
      for (const row of rows.filter((candidate) => candidate.phase === step.phase)) {
        const item = /^(.*) with \d+ chairs?$/u.exec(row.name)?.[1] ?? row.name;
        onPhone.set(item, (onPhone.get(item) ?? 0) + row.qty);
      }
      const onPaper = new Map(step.items.map((item) => [item.name, item.qty]));
      expect(onPhone, step.phase).toEqual(onPaper);
    }
    expect(screen.getAllByText(`${String(V3.totals.totalItems)} pieces to set`).length).toBeGreaterThan(0);
  });

  it("prints every served row with its quantity from the browser", async () => {
    serveSheets(V3);
    await mount();
    const printed = [...printCopy().querySelectorAll<HTMLElement>(".hk-row")].map((row) => {
      const phase = row.closest("section")?.id.replace(/^hk-phase-/u, "") ?? "";
      const zone = row.closest(".hk-zone")?.querySelector(".hk-zone-name")?.textContent ?? "";
      const name = row.querySelector(".hk-row-name")?.firstChild?.textContent ?? "";
      const qty = Number((row.querySelector(".hk-row-qty")?.textContent ?? "").replace("×", ""));
      return { phase, zone, name, qty };
    });
    expect(order(printed)).toEqual(order(served()));
  });
});

describe("the phone says when it is no longer the version in force", () => {
  it("marks an open v3 superseded once v4 is approved, on the screen and its print, and opens v4", async () => {
    const reads = serveSheets(V3, V4);
    answers({ state: "superseded", currentVersion: 4 }, { state: "current", version: 4 });
    await mount();
    // Back in signal (or back to the tab), the sheet asks whether it is still in force.
    act(() => { window.dispatchEvent(new Event("online")); });
    const mark = await screen.findByRole("alert", { name: "Superseded" });
    expect(mark.textContent).toContain("v4");
    expect(mark.textContent).toContain("v3");
    expect(vi.mocked(checkSheetPaper)).toHaveBeenCalledWith(
      { s: expect.stringMatching(/^[0-9a-f-]{36}$/u) as unknown, v: 3, h: expect.stringMatching(/^[0-9a-f]{16}$/u) as unknown },
      expect.any(AbortSignal),
    );
    // A print made from this screen says so too.
    expect(printCopy().textContent).toContain("Superseded");
    // Its one action opens the version in force.
    fireEvent.click(within(mark).getByRole("button", { name: "Open v4" }));
    await screen.findByText(/Approved v4/u);
    expect(reads.sheetReads()).toBe(2);
    expect(screen.queryByRole("alert", { name: "Superseded" })).toBeNull();
    expect(printCopy().textContent).not.toContain("Superseded");
  });

  it("checks again every few minutes while the sheet is open, and says nothing while it is current", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveSheets(V3);
    answers({ state: "current", version: 3 }, { state: "superseded", currentVersion: 4 });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEET_STANDING_INTERVAL_MS); });
    expect(vi.mocked(checkSheetPaper)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert", { name: "Superseded" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEET_STANDING_INTERVAL_MS); });
    await waitFor(() => { expect(screen.getByRole("alert", { name: "Superseded" })).toBeTruthy(); });
  });

  it("keeps the mark when a later check cannot reach the server", async () => {
    serveSheets(V3);
    vi.mocked(checkSheetPaper).mockResolvedValueOnce({ state: "superseded", currentVersion: 4 }).mockRejectedValue(new Error("offline"));
    await mount();
    act(() => { window.dispatchEvent(new Event("online")); });
    await screen.findByRole("alert", { name: "Superseded" });
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(vi.mocked(checkSheetPaper)).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert", { name: "Superseded" })).toBeTruthy();
  });

  it("tells a draft opened before approval that an approved version now exists", async () => {
    const draft: HallkeeperSheetV2 = { ...V3, approval: null, paperCheck: V3.paperCheck === undefined ? undefined : { ...V3.paperCheck, url: `https://venviewer.com/sheet-check?c=${V3.config.id}` } };
    serveSheets(draft);
    answers({ state: "superseded", currentVersion: 1 });
    await mount();
    act(() => { window.dispatchEvent(new Event("online")); });
    const mark = await screen.findByRole("alert", { name: "Not the approved sheet" });
    expect(mark.textContent).toContain("v1");
    expect(vi.mocked(checkSheetPaper)).toHaveBeenCalledWith({ c: V3.config.id }, expect.any(AbortSignal));
  });

  it("names every state that is not in force, and stays quiet for the one that is or that nobody can confirm", () => {
    expect(describeSheetStanding({ state: "superseded", currentVersion: 4 }, 3)).toEqual({
      label: "Superseded", detail: "v4 is now in force; this screen shows v3. Set up from v4.", inForce: 4,
    });
    expect(describeSheetStanding({ state: "not_approved" }, 3)?.label).toBe("Being revised");
    expect(describeSheetStanding({ state: "retired" }, 3)?.label).toBe("No longer in use");
    // A draft is unapproved by nature; its review band already says so.
    expect(describeSheetStanding({ state: "not_approved" }, null)).toBeNull();
    expect(describeSheetStanding({ state: "current", version: 3 }, 3)).toBeNull();
    expect(describeSheetStanding({ state: "unknown" }, 3)).toBeNull();
    expect(describeSheetStanding(null, 3)).toBeNull();
  });
});
