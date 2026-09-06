import { useState, type ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Link, MemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { InventoryNavigationGuard } from "../InventoryNavigationGuard.js";

const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => { cleanup(); for (const router of routers.splice(0)) router.dispose(); });

function Destination(): ReactElement {
  const location = useLocation();
  return <h1>Destination {location.pathname}{location.search}{location.hash}</h1>;
}

function Correction({ next, initialDirty, save }: {
  readonly next: string;
  readonly initialDirty: boolean;
  readonly save: () => Promise<void>;
}): ReactElement {
  const [base, setBase] = useState("200");
  const [owned, setOwned] = useState(initialDirty ? "210" : "200");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const saveCorrection = async (): Promise<void> => {
    setBusy(true);
    try { await save(); setBase(owned); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <>
    <InventoryNavigationGuard dirty={owned !== base} busy={busy} />
    <h1>Stock correction</h1>
    <label>Owned<input value={owned} disabled={busy} onChange={(event) => { setOwned(event.target.value); }} /></label>
    <button type="button" disabled={busy} onClick={() => { void saveCorrection(); }}>Save correction</button>
    <Link to={next} state={{ source: "inventory" }}>Leave workspace</Link>
    {error ? <p role="alert">Save was not confirmed</p> : null}
  </>;
}

function setup({ next = "/plan?event=dinner#layout", initialDirty = true,
  save = () => Promise.resolve(), backEntry = "/diary?day=tomorrow" }: {
  readonly next?: string;
  readonly initialDirty?: boolean;
  readonly save?: () => Promise<void>;
  readonly backEntry?: string;
} = {}): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter([
    { path: "/inventory", element: <Correction next={next} initialDirty={initialDirty} save={save} /> },
    { path: "*", element: <Destination /> },
  ], { initialEntries: [backEntry, "/inventory"], initialIndex: 1 });
  routers.push(router);
  render(<RouterProvider router={router} />);
  return router;
}

describe("InventoryNavigationGuard", () => {
  it("allows moving to another section without discarding the correction", async () => {
    const router = setup({ next: "/inventory#adjustment-history" });
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    await waitFor(() => { expect(router.state.location.hash).toBe("#adjustment-history"); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Owned").value).toBe("210");
  });
  it("keeps an unsaved correction when the administrator cancels navigation", async () => {
    const router = setup();
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    await screen.findByRole("dialog", { name: "Leave this stock correction?" });
    expect(router.state.location.pathname).toBe("/inventory");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Owned").value).toBe("210");
    expect(router.state.location.pathname).toBe("/inventory");
  });

  it("proceeds to the original destination, query, fragment and state after explicit discard", async () => {
    const router = setup();
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard and leave" }));
    await screen.findByRole("heading", { name: "Destination /plan?event=dinner#layout" });
    expect(router.state.location.state).toEqual({ source: "inventory" });
    expect(router.state.historyAction).toBe("PUSH");
  });

  it("preserves browser Back as a POP rather than replacing it with a new navigation", async () => {
    const router = setup();
    await act(async () => { await router.navigate(-1); });
    await screen.findByRole("dialog");
    expect(router.state.location.pathname).toBe("/inventory");
    fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
    await screen.findByRole("heading", { name: "Destination /diary?day=tomorrow" });
    expect(router.state.historyAction).toBe("POP");
    await act(async () => { await router.navigate(1); });
    expect(await screen.findByRole("heading", { name: "Stock correction" })).toBeDefined();
  });

  it.each(["/inventory?period=tomorrow"])("protects same-page URL change %s", async (next) => {
    const router = setup({ next });
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    await screen.findByRole("dialog");
    expect(`${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`).toBe("/inventory");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  });

  it("does not block an identical URL or an unchanged correction", async () => {
    const router = setup({ next: "/inventory" });
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.state.location.pathname).toBe("/inventory");
    cleanup();
    const cleanRouter = setup({ initialDirty: false });
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    await screen.findByRole("heading", { name: "Destination /plan?event=dinner#layout" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cleanRouter.state.location.pathname).toBe("/plan");
  });

  it("disables discard during a save and resumes the held destination after confirmation", async () => {
    let confirm: (() => void) | undefined;
    const saved = new Promise<void>((resolve) => { confirm = resolve; });
    const router = setup({ save: () => saved });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    await screen.findByRole("dialog", { name: "Saving your stock correction" });
    const discard = screen.getByRole<HTMLButtonElement>("button", { name: "Discard and leave" });
    expect(discard.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Waiting for the stock save");
    fireEvent.click(discard);
    expect(router.state.location.pathname).toBe("/inventory");
    await act(async () => { confirm?.(); await saved; });
    await screen.findByRole("heading", { name: "Destination /plan?event=dinner#layout" });
    expect(router.state.location.state).toEqual({ source: "inventory" });
  });

  it("still protects a clean draft while a save is in flight", async () => {
    let confirm: (() => void) | undefined;
    const saved = new Promise<void>((resolve) => { confirm = resolve; });
    const router = setup({ initialDirty: false, save: () => saved });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    await screen.findByRole("dialog", { name: "Saving your stock correction" });
    expect(router.state.location.pathname).toBe("/inventory");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await act(async () => { confirm?.(); await saved; });
    expect(router.state.location.pathname).toBe("/inventory");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retains the unsaved guard after a failed save instead of automatically leaving", async () => {
    let fail: ((reason: Error) => void) | undefined;
    const saved = new Promise<void>((_resolve, reject) => { fail = reject; });
    const router = setup({ save: () => saved });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    fireEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    await screen.findByRole("dialog", { name: "Saving your stock correction" });
    await act(async () => { fail?.(new Error("network unavailable")); await saved.catch(() => undefined); });
    await screen.findByRole("dialog", { name: "Leave this stock correction?" });
    expect((screen.getByRole<HTMLButtonElement>("button", { name: "Discard and leave" })).disabled).toBe(false);
    expect(router.state.location.pathname).toBe("/inventory");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("traps keyboard focus and treats Escape as keeping the draft", async () => {
    setup();
    const opener = screen.getByRole("link", { name: "Leave workspace" });
    opener.focus();
    fireEvent.click(opener);
    const keep = await screen.findByRole("button", { name: "Keep editing" });
    await waitFor(() => { expect(document.activeElement).toBe(keep); });
    const discard = screen.getByRole("button", { name: "Discard and leave" });
    discard.focus();
    fireEvent.keyDown(discard, { key: "Tab" });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(keep, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(discard);
    fireEvent.keyDown(discard, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("renders safely without a data router, including standalone MemoryRouter consumers", () => {
    render(<InventoryNavigationGuard dirty busy={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    render(<MemoryRouter><InventoryNavigationGuard dirty busy /></MemoryRouter>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
