import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssuedPlanViewLink, PlanViewLink } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { setLayoutTimelineMutationLock } from "../../../lib/layout-timeline-preview-lock.js";
import { useVisitorPlanLinks } from "../../../hooks/use-visitor-plan-links.js";
import { VisitorPlanLinkActions } from "../VisitorPlanLinkActions.js";

// ---------------------------------------------------------------------------
// "Copy a view-only link" (fix-first item 11): save first, make the link, put
// it on the clipboard, show it once; list working links and stop them. Only
// the network, the autosave flush and the clipboard are stubbed; the hook,
// the component and the editor store are real.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), stop: vi.fn(), flush: vi.fn(), write: vi.fn() }));
vi.mock("../../../api/plan-view.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/plan-view.js")>(),
  createPlanViewLink: mocks.create,
  listPlanViewLinks: mocks.list,
  stopPlanViewLink: mocks.stop,
}));
vi.mock("../EditorBridge.js", () => ({ flushAutoSave: mocks.flush }));

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "Qm9va2luZ3NBcmVOb3RUb2tlbnNCdXRUaGlzSXNPbmV";
const MADE: IssuedPlanViewLink = {
  id: "22222222-2222-4222-8222-222222222222",
  prefix: TOKEN.slice(0, 8),
  createdAt: "2026-10-17T13:02:00.000Z",
  expiresAt: "2026-11-16T13:02:00.000Z",
  token: TOKEN,
};
const EARLIER: PlanViewLink = {
  id: "33333333-3333-4333-8333-333333333333",
  prefix: "AbCdEfGh",
  createdAt: "2026-10-15T09:30:00.000Z",
  expiresAt: "2026-11-14T09:30:00.000Z",
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Harness({ configId = CONFIG_ID }: { readonly configId?: string | null }): React.ReactElement {
  const links = useVisitorPlanLinks(configId);
  return <VisitorPlanLinkActions links={links} tone="sheet" unavailableReason={null} />;
}

beforeEach(() => {
  // The day the link is made: a date shows its year only when it is not this
  // year's, so the expiry reads "16 November" only while it is still 2026.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(MADE.createdAt));
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.flush.mockResolvedValue(true);
  mocks.list.mockResolvedValue([]);
  mocks.write.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: mocks.write }, configurable: true });
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: CONFIG_ID, isPublicPreview: true });
  setLayoutTimelineMutationLock(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
  setLayoutTimelineMutationLock(false);
  useEditorStore.getState().reset();
});

describe("view-only link", () => {
  it("says what the link does and does not do before it is made", async () => {
    render(<Harness />);
    expect(screen.getByTestId("visitor-link-make").textContent).toBe("Copy a view-only link");
    expect(screen.getByTestId("visitor-link-consequence").textContent).toBe(
      "Saves your latest change, then copies a link. Whoever opens it sees this plan as it is saved, including later changes, without prices, and cannot change it.",
    );
    expect(screen.getByTestId("visitor-link-retention").textContent)
      .toBe("It works for 30 days unless you stop it, and the plan is kept while it works.");
    await waitFor(() => { expect(mocks.list).toHaveBeenCalledTimes(1); });
  });

  it("saves, shows the shared Activity while making, then copies a link that carries no plan id", async () => {
    const response = deferred<IssuedPlanViewLink>();
    mocks.create.mockReturnValue(response.promise);
    render(<Harness />);

    fireEvent.click(screen.getByTestId("visitor-link-make"));
    const button = await screen.findByRole("button", { name: /Making the link/u });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector("[data-activity-indicator='particles']")).not.toBeNull();
    await waitFor(() => { expect(mocks.create).toHaveBeenCalledWith(CONFIG_ID); });
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0] ?? 0);

    mocks.list.mockResolvedValue([MADE]);
    await act(async () => { response.resolve(MADE); await response.promise; });

    const url = `${window.location.origin}/plan-view/${TOKEN}`;
    await waitFor(() => { expect(mocks.write).toHaveBeenCalledWith(url); });
    const result = await screen.findByTestId("visitor-link-result");
    expect(within(result).getByText("Link copied")).toBeTruthy();
    const field = screen.getByTestId("visitor-link-url");
    expect((field as HTMLInputElement).value).toBe(url);
    expect((field as HTMLInputElement).readOnly).toBe(true);
    expect(url).not.toContain(CONFIG_ID);
    expect(screen.getByTestId("visitor-link-until").textContent)
      .toBe("Works until 16 November unless you stop it. Nobody can change the plan through it.");
    expect(document.querySelector("[data-activity-indicator='particles']")).toBeNull();
    expect(screen.getAllByRole("status").some((region) => region.textContent === "View-only link copied")).toBe(true);
    // The working links are read again, so the new one can be stopped.
    await waitFor(() => { expect(screen.getByTestId("visitor-link-list")).toBeTruthy(); });
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("shows the link to copy by hand when the clipboard is refused", async () => {
    mocks.create.mockResolvedValue(MADE);
    mocks.write.mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"));
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-link-make"));
    const result = await screen.findByTestId("visitor-link-result");
    expect(within(result).getByText("Your view-only link")).toBeTruthy();
    expect(result.textContent).toMatch(/Copy it from the box above\./u);
    expect(screen.getByTestId("visitor-link-copy").textContent).toBe("Copy");

    mocks.write.mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId("visitor-link-copy"));
    await waitFor(() => { expect(within(screen.getByTestId("visitor-link-result")).getByText("Link copied")).toBeTruthy(); });
  });

  it("refuses to make a link to an older plan when the latest change has not saved", async () => {
    mocks.flush.mockResolvedValue(false);
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-link-make"));
    expect((await screen.findByTestId("visitor-link-error")).textContent)
      .toBe("Your latest change hasn't saved, so the link would show an older plan. Check the connection and try again.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByTestId("visitor-link-make").textContent).toBe("Try again");
  });

  it("waits for the room timeline preview to end", () => {
    setLayoutTimelineMutationLock(true);
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-link-make"));
    expect(screen.getByTestId("visitor-link-error").textContent).toBe("Exit the room timeline preview, then make the link.");
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(409, "limit", "VIEW_LINK_LIMIT"), "This plan already has five working links. Stop one below to make another."],
    [new ApiError(404, "gone", "NOT_FOUND"), "This plan isn't stored any more, so there is nothing to link to. Reload the page to start a new plan."],
    [new ApiError(429, "slow down", "HTTP_ERROR"), "Several links have been made from this connection in the last hour. Try again in an hour, or send the PDF instead."],
    [new ApiError(0, "offline", "NETWORK_ERROR"), "The link couldn't be made. Check the connection and try again, or send the PDF instead."],
  ])("every refusal names a way forward (%#)", async (error, message) => {
    mocks.create.mockRejectedValue(error);
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-link-make"));
    expect((await screen.findByTestId("visitor-link-error")).textContent).toBe(message);
    expect(screen.queryByTestId("visitor-link-result")).toBeNull();
  });

  it("lists working links and stops one, with Activity on that row only", async () => {
    mocks.list.mockResolvedValue([MADE, EARLIER]);
    const stopping = deferred<undefined>();
    mocks.stop.mockReturnValue(stopping.promise);
    render(<Harness />);

    const list = await screen.findByTestId("visitor-link-list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent).toMatch(/^Made 15 Oct, \d{2}:30 · works until 14 November/u);

    const stopButtons = within(list).getAllByTestId("visitor-link-stop");
    fireEvent.click(stopButtons[1] as HTMLElement);
    expect(mocks.stop).toHaveBeenCalledWith(CONFIG_ID, EARLIER.id);
    const busy = within(list).getAllByTestId("visitor-link-stop")[1] as HTMLElement;
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.textContent).toBe("Stopping…");
    expect(busy.querySelector("[data-activity-indicator='particles']")).not.toBeNull();
    // One stop at a time.
    expect(within(list).getAllByTestId("visitor-link-stop").every((button) => button.hasAttribute("disabled"))).toBe(true);

    await act(async () => { stopping.resolve(undefined); await stopping.promise; });
    expect(within(screen.getByTestId("visitor-link-list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("visitor-link-stop-note").textContent)
      .toBe("Stopped. Anyone holding that link now sees that it no longer works.");
    expect(document.querySelector("[data-activity-indicator='particles']")).toBeNull();
  });

  it("says so when a link could not be stopped, and keeps it listed", async () => {
    mocks.list.mockResolvedValue([EARLIER]);
    mocks.stop.mockRejectedValue(new ApiError(0, "offline", "NETWORK_ERROR"));
    render(<Harness />);
    fireEvent.click(await screen.findByTestId("visitor-link-stop"));
    expect((await screen.findByTestId("visitor-link-stop-note")).textContent)
      .toBe("That link couldn't be stopped. Check the connection and try again.");
    expect(within(screen.getByTestId("visitor-link-list")).getAllByRole("listitem")).toHaveLength(1);
  });

  it("stopping the link just made withdraws it from the screen", async () => {
    mocks.create.mockResolvedValue(MADE);
    mocks.stop.mockResolvedValue(undefined);
    render(<Harness />);
    mocks.list.mockResolvedValue([MADE]);
    fireEvent.click(screen.getByTestId("visitor-link-make"));
    await screen.findByTestId("visitor-link-result");
    fireEvent.click(await screen.findByTestId("visitor-link-stop"));
    await waitFor(() => { expect(screen.queryByTestId("visitor-link-result")).toBeNull(); });
    expect(screen.getByTestId("visitor-link-make").textContent).toBe("Copy a view-only link");
  });

  it("offers to load the list again when it could not be read", async () => {
    mocks.list.mockRejectedValueOnce(new ApiError(0, "offline", "NETWORK_ERROR"));
    render(<Harness />);
    const failed = await screen.findByTestId("visitor-link-list-error");
    mocks.list.mockResolvedValue([EARLIER]);
    fireEvent.click(within(failed).getByRole("button", { name: "Load them again" }));
    expect(await screen.findByTestId("visitor-link-list")).toBeTruthy();
  });

  it("does nothing for a plan that has not saved yet", () => {
    render(<Harness configId={null} />);
    fireEvent.click(screen.getByTestId("visitor-link-make"));
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
