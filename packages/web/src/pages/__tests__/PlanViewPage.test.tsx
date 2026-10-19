import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanView } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { API_URL } from "../../config/env.js";
import { PlanViewPage } from "../PlanViewPage.js";

// ---------------------------------------------------------------------------
// The recipient's page for a view-only link (fix-first item 11). Only the
// network is stubbed: loading → ready, loading → not working, loading →
// error → retry, and what the page must never offer (a way to edit, a price,
// the planner's address).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../api/plan-view.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/plan-view.js")>(),
  fetchPlanView: mocks.fetch,
}));

const TOKEN = "Qm9va2luZ3NBcmVOb3RUb2tlbnNCdXRUaGlzSXNPbmV";
const VIEW: PlanView = {
  venueName: "Trades Hall Glasgow",
  venueAddress: "85 Glassford Street, Glasgow G1 1UH",
  timezone: "Europe/London",
  roomName: "Grand Hall",
  planName: "Morrison wedding",
  provenance: "Drawn by a visitor; not reviewed by the venue.",
  lastChangedAt: "2026-10-17T13:02:00.000Z",
  linkExpiresAt: "2026-11-16T13:02:00.000Z",
  outline: [{ x: -10.5, z: -5 }, { x: 10.5, z: -5 }, { x: 10.5, z: 5 }, { x: -10.5, z: 5 }],
  objects: [
    { name: "Round Table (White Cloth)", category: "table", x: -4, z: -1, rotationY: 0, scale: 1, widthM: 1.8, depthM: 1.8, collisionType: "cylinder" },
    { name: "Velvet Banquet Chair", category: "chair", x: -4, z: 0.4, rotationY: Math.PI / 2, scale: 1, widthM: 0.42, depthM: 0.58, collisionType: "box" },
    { name: "Lectern", category: "lectern", x: 8, z: -4, rotationY: 0, scale: 1, widthM: 0.6, depthM: 0.5, collisionType: "box" },
  ],
  items: [
    { name: "Round Table (White Cloth)", category: "table", count: 1 },
    { name: "Velvet Banquet Chair", category: "chair", count: 1 },
    { name: "Lectern", category: "lectern", count: 1 },
  ],
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function open(token: string = TOKEN): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/plan-view/${token}`]}>
      <Routes><Route path="/plan-view/:token" element={<PlanViewPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { mocks.fetch.mockReset(); });
afterEach(() => { cleanup(); });

describe("view-only plan page", () => {
  it("waits with the shared Activity, then shows the plan with who drew it and when", async () => {
    const response = deferred<PlanView>();
    mocks.fetch.mockReturnValue(response.promise);
    open();
    expect(screen.getByRole("status").textContent).toBe("Opening the plan…");
    expect(document.querySelector("[data-activity-indicator='particles']")).not.toBeNull();
    expect(mocks.fetch).toHaveBeenCalledWith(TOKEN, expect.any(AbortSignal));

    await act(async () => { response.resolve(VIEW); await response.promise; });

    expect(document.querySelector("[data-activity-indicator='particles']")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Grand Hall");
    expect(screen.getByText("Trades Hall Glasgow")).toBeTruthy();
    expect(screen.getByText("Morrison wedding")).toBeTruthy();
    expect(screen.getByTestId("plan-view-provenance").textContent)
      .toBe("Drawn by a visitor; not reviewed by the venue.Last changed 17 October 2026, 14:02.");
    expect(screen.getByRole("img", { name: "Plan of the Grand Hall, drawn to scale: 1 table, 1 chair and 1 lectern." })).toBeTruthy();
    const items = within(screen.getByTestId("plan-view-items")).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(["1Round Table (White Cloth)", "1Velvet Banquet Chair", "1Lectern"]);
    expect(screen.getByTestId("plan-view-pdf").getAttribute("href")).toBe(`${API_URL}/public/plan-views/${TOKEN}/plan.pdf`);
    expect(screen.getByTestId("plan-view-expiry").textContent).toMatch(/works until 16 November 2026, unless the person who sent it stops it sooner\. Nothing can be changed through it\./u);
    expect(document.title).toBe("Grand Hall plan — Trades Hall Glasgow");
  });

  it("offers nothing that edits, no price and no planner address", async () => {
    mocks.fetch.mockResolvedValue(VIEW);
    open();
    await screen.findByTestId("plan-view-ready");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(document.querySelector("[contenteditable='true'], input, textarea, select, form")).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/£|price list|per cover|total/iu);
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/\/plan\/|\/editor|\/configurations\//u);
    }
    // The way on is the venue's events team, never a dead end.
    expect(screen.getByRole("link", { name: "Ask about a date" }).getAttribute("href")).toBe("/#enquire");
  });

  it("says plainly when the link no longer works, and offers the way on", async () => {
    mocks.fetch.mockRejectedValue(new ApiError(404, "This view-only link is not working", "VIEW_LINK_NOT_FOUND"));
    open();
    const notice = await screen.findByTestId("plan-view-not-working");
    expect(within(notice).getByRole("heading", { level: 1 }).textContent).toBe("This link is not working");
    expect(notice.textContent).toMatch(/may have stopped it, or its 30 days may have run out\. They can send you a fresh one\./u);
    expect(within(notice).getByRole("link", { name: "Ask about a date" }).getAttribute("href")).toBe("/#enquire");
    expect(within(notice).getByRole("link", { name: "Go to the front door" }).getAttribute("href")).toBe("/");
  });

  it("never asks the API about an address that cannot be a link", () => {
    open("not-a-real-token");
    expect(screen.getByTestId("plan-view-not-working")).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps a failed load apart from a dead link, and tries again with the Activity showing", async () => {
    mocks.fetch.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
    open();
    const failed = await screen.findByTestId("plan-view-error");
    expect(failed.textContent).toMatch(/The plan couldn.t be opened/u);

    const retry = deferred<PlanView>();
    mocks.fetch.mockReturnValueOnce(retry.promise);
    fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("status").textContent).toBe("Opening the plan…");
    await act(async () => { retry.resolve(VIEW); await retry.promise; });
    expect(screen.getByTestId("plan-view-ready")).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps itself out of search engines and referrers, and tidies up after", async () => {
    mocks.fetch.mockResolvedValue(VIEW);
    const { unmount } = open();
    await screen.findByTestId("plan-view-ready");
    expect(document.head.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex, nofollow");
    expect(document.head.querySelector("meta[name='referrer']")?.getAttribute("content")).toBe("no-referrer");
    unmount();
    expect(document.head.querySelector("meta[name='robots']")).toBeNull();
    expect(document.head.querySelector("meta[name='referrer']")).toBeNull();
  });
});
