import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SheetPaperCheckResult } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { checkSheetPaper } from "../../api/sheet-paper-check.js";
import { SheetCheckPage, describeSheetCheck } from "../SheetCheckPage.js";

vi.mock("../../api/sheet-paper-check.js", () => ({ checkSheetPaper: vi.fn() }));

const SNAPSHOT = "5b8f2c1e-3d4a-4f6b-9c7d-1e2f3a4b5c6d";
const CONFIG = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ISSUED = `/sheet-check?s=${SNAPSHOT}&v=7&h=0123456789abcdef&p=2026-10-17T06:02`;
const DRAFT = `/sheet-check?c=${CONFIG}&p=2026-10-17T06:02`;

function mount(entry: string): void {
  render(<MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/sheet-check" element={<SheetCheckPage />} /></Routes>
  </MemoryRouter>);
}

function answer(result: SheetPaperCheckResult): void {
  vi.mocked(checkSheetPaper).mockResolvedValue(result);
}

beforeEach(() => { vi.mocked(checkSheetPaper).mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("SheetCheckPage answers one question", () => {
  it("shows the shared activity while checking, then says the copy is current", async () => {
    let resolve: (result: SheetPaperCheckResult) => void = () => undefined;
    vi.mocked(checkSheetPaper).mockReturnValue(new Promise((done) => { resolve = done; }));
    mount(ISSUED);
    expect(screen.getByText("Checking this copy…")).toBeTruthy();
    expect(document.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(screen.getByText("Hallkeeper sheet check").closest("article")?.querySelector("[aria-busy='true']")).not.toBeNull();
    await act(async () => { resolve({ state: "current", version: 7 }); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { name: "This is the current sheet." })).toBeTruthy();
    expect(screen.getByText("v7")).toBeTruthy();
    expect(screen.getByText("Your copy is v7, printed 17 Oct 06:02.")).toBeTruthy();
    expect(document.querySelector("[data-activity-indicator]")).toBeNull();
    expect(document.querySelector("article")?.getAttribute("data-tone")).toBe("current");
    // Only the link's identifiers go to the server; the printed time stays on the page.
    expect(checkSheetPaper).toHaveBeenCalledWith({ s: SNAPSHOT, v: 7, h: "0123456789abcdef" }, expect.any(AbortSignal));
  });

  it("tells a superseded copy which version to ask for, in words as well as colour", async () => {
    answer({ state: "superseded", currentVersion: 9 });
    mount(ISSUED);
    expect(await screen.findByRole("heading", { name: "Superseded." })).toBeTruthy();
    expect(screen.getByText("Ask the duty manager for v9 before setting up.")).toBeTruthy();
    expect(screen.getByText("v9")).toBeTruthy();
    expect(screen.getByText("The version to use")).toBeTruthy();
  });

  it("tells a draft printout that an approved version replaced it", async () => {
    answer({ state: "superseded", currentVersion: 3 });
    mount(DRAFT);
    expect(await screen.findByRole("heading", { name: "Not the approved sheet." })).toBeTruthy();
    expect(screen.getByText("This copy was printed before approval. Ask the duty manager for v3.")).toBeTruthy();
    expect(screen.getByText("Your copy is a draft, printed 17 Oct 06:02.")).toBeTruthy();
    expect(checkSheetPaper).toHaveBeenCalledWith({ c: CONFIG }, expect.any(AbortSignal));
  });

  it("gives every refusal a next step", () => {
    const issued = { kind: "issued" as const, version: 7, printed: null };
    const draft = { kind: "working" as const, version: null, printed: null };
    const results: [SheetPaperCheckResult, typeof issued | typeof draft][] = [
      [{ state: "superseded", currentVersion: 9 }, issued],
      [{ state: "not_approved" }, issued],
      [{ state: "not_approved" }, draft],
      [{ state: "retired" }, issued],
      [{ state: "unknown" }, issued],
    ];
    for (const [result, claim] of results) {
      expect(describeSheetCheck(result, claim).lede).toMatch(/Ask the duty manager/u);
    }
    expect(describeSheetCheck({ state: "not_approved" }, issued).headline).toBe("Being revised.");
    expect(describeSheetCheck({ state: "not_approved" }, draft).headline).toBe("Not approved yet.");
    expect(describeSheetCheck({ state: "retired" }, issued).headline).toBe("No longer in use.");
    expect(describeSheetCheck({ state: "unknown" }, issued).headline).toBe("Can't confirm this copy.");
  });

  it("uses no system words in anything it can say", () => {
    const claim = { kind: "issued" as const, version: 7, printed: null };
    const all: SheetPaperCheckResult[] = [
      { state: "current", version: 7 }, { state: "superseded", currentVersion: 9 },
      { state: "not_approved" }, { state: "retired" }, { state: "unknown" },
    ];
    for (const result of all) {
      const { headline, lede } = describeSheetCheck(result, claim);
      expect(`${headline} ${lede}`).not.toMatch(/\b(?:hash|snapshot|token|handoff|config(?:uration)?|fingerprint)\b/iu);
    }
  });
});

describe("SheetCheckPage without signal", () => {
  it("says it cannot check, repeats the paper's own version, and asks again when signal returns", async () => {
    vi.mocked(checkSheetPaper)
      .mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"))
      .mockResolvedValueOnce({ state: "current", version: 7 });
    mount(ISSUED);
    expect(await screen.findByRole("heading", { name: "Can't check: no signal." })).toBeTruthy();
    expect(screen.getByText("Your copy is v7, printed 17 Oct 06:02.")).toBeTruthy();
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { name: "This is the current sheet." })).toBeTruthy();
    expect(checkSheetPaper).toHaveBeenCalledTimes(2);
  });

  it("offers Try again when the check fails for another reason", async () => {
    vi.mocked(checkSheetPaper)
      .mockRejectedValueOnce(new ApiError(429, "Too many requests — please slow down.", "RATE_LIMITED"))
      .mockResolvedValueOnce({ state: "unknown" });
    mount(ISSUED);
    expect(await screen.findByRole("heading", { name: "Can't check right now." })).toBeTruthy();
    expect(screen.getByText("Try again in a minute, or ask the duty manager.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Can't confirm this copy." })).toBeTruthy();
  });

  it("installs the offline answer, scoped to the check page only", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { onLine: true, serviceWorker: { register } });
    answer({ state: "current", version: 7 });
    mount(ISSUED);
    await waitFor(() => { expect(register).toHaveBeenCalledWith("/sheet-check-sw.js", { scope: "/sheet-check" }); });
  });
});

describe("SheetCheckPage with a link that is not a sheet check", () => {
  it("says so and points to the printed code, without asking the server", () => {
    mount("/sheet-check?s=not-a-snapshot&v=7");
    expect(screen.getByRole("heading", { name: "This link is not a sheet check." })).toBeTruthy();
    expect(screen.getByText("Scan the code at the foot of a printed hallkeeper sheet, or ask the duty manager.")).toBeTruthy();
    expect(checkSheetPaper).not.toHaveBeenCalled();
  });
});
