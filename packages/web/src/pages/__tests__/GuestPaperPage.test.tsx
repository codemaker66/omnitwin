import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KIT_STORAGE_KEY } from "../../lib/guest-list/kit-switch.js";
import { GuestPaperPage } from "../GuestPaperPage.js";

const mocks = vi.hoisted(() => ({ getPublicConfig: vi.fn() }));
vi.mock("../../api/configurations.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/configurations.js")>(),
  getPublicConfig: mocks.getPublicConfig,
}));

const PLAN_ID = "3f2b8c1e-9d4a-4b6f-8a1c-2e7d5f0a9b34";

function open(entry: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/plan/:code/guests/paper" element={<GuestPaperPage />} />
        <Route path="/plan" element={<p data-testid="planner">planner</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function metas(name: string): HTMLMetaElement[] {
  return Array.from(document.head.querySelectorAll<HTMLMetaElement>(`meta[name='${name}']`));
}

beforeEach(() => {
  mocks.getPublicConfig.mockReset();
  window.localStorage.clear();
  document.title = "before";
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("the guest paper page, as a shell", () => {
  it("is the not-found page with the switch off, and makes no request", () => {
    open(`/plan/${PLAN_ID}/guests/paper`);
    expect(screen.getByTestId("not-found")).toBeTruthy();
    expect(screen.queryByTestId("guest-paper-page")).toBeNull();
    expect(mocks.getPublicConfig).not.toHaveBeenCalled();
  });

  it("with a malformed plan id, says the address is not a plan and makes no request", () => {
    open("/plan/not-a-uuid/guests/paper?kit=on");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This address is not a plan");
    expect(screen.getByRole("link", { name: "Open the planner" }).getAttribute("href")).toBe("/plan");
    expect(screen.queryByTestId("guest-paper-page")).toBeNull();
    expect(screen.queryByTestId("not-found")).toBeNull();
    expect(mocks.getPublicConfig).not.toHaveBeenCalled();
  });

  it("renders the empty root when the switch is on and the plan id is well formed", () => {
    open(`/plan/${PLAN_ID}/guests/paper?kit=on`);
    const root = screen.getByTestId("guest-paper-page");
    expect(root.className).toBe("gp");
    expect(root.getAttribute("data-register")).toBe("ivory");
    expect(root.childElementCount).toBe(0);
    expect(mocks.getPublicConfig).not.toHaveBeenCalled();
  });

  it("answers on a later visit with no parameter once the switch was remembered", () => {
    window.localStorage.setItem(KIT_STORAGE_KEY, "on");
    open(`/plan/${PLAN_ID}/guests/paper`);
    expect(screen.getByTestId("guest-paper-page")).toBeTruthy();
  });

  it("sets noindex and no-referrer in the head and removes them on leaving", () => {
    const view = open(`/plan/${PLAN_ID}/guests/paper?kit=on`);
    expect(document.title).toBe("Table plan and paper");
    expect(metas("robots").map((m) => m.content)).toEqual(["noindex, nofollow"]);
    expect(metas("referrer").map((m) => m.content)).toEqual(["no-referrer"]);
    view.unmount();
    expect(metas("robots")).toHaveLength(0);
    expect(metas("referrer")).toHaveLength(0);
  });

  it("keeps the head private on the malformed-address sheet too", () => {
    const view = open("/plan/not-a-uuid/guests/paper?kit=on");
    expect(metas("robots").map((m) => m.content)).toEqual(["noindex, nofollow"]);
    expect(metas("referrer").map((m) => m.content)).toEqual(["no-referrer"]);
    view.unmount();
    expect(metas("robots")).toHaveLength(0);
  });
});
