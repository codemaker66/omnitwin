import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@omnitwin/types";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { NotificationCenter } from "../NotificationCenter.js";

// The panel inside the dashboard's More popover. The unread number belongs to
// the shell (one number, one source, one chip); this panel says it in words,
// lists the newest unread, and reloads when the list is opened and when the
// live channel says the inbox changed, for the people that channel can reach.

const mocks = vi.hoisted(() => ({ list: vi.fn(), markRead: vi.fn(), subscribe: vi.fn() }));
vi.mock("../../../api/notifications.js", () => ({
  listNotifications: mocks.list,
  markNotificationRead: mocks.markRead,
}));
vi.mock("../../../lib/requests-live.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/requests-live.js")>("../../../lib/requests-live.js");
  return { listensForFloorRequests: actual.listensForFloorRequests, subscribeRequestsLive: mocks.subscribe };
});

const hallkeeper: AuthUser = {
  id: "hk-1", name: "Elaine", email: "elaine@example.test",
  role: "hallkeeper", platformRole: "none", venueId: "venue-a",
};

const REFRESHMENTS = "00000000-0000-4000-8000-00000000b001";
const LECTERN = "00000000-0000-4000-8000-00000000b002";

function notification(
  id: string,
  title: string,
  severity: Notification["severity"] = "urgent",
): Notification {
  return {
    id,
    changeId: null,
    eventId: null,
    venueId: "00000000-0000-4000-8000-00000000a001",
    audienceRole: "hallkeeper",
    recipientUserId: null,
    title,
    body: "Elaine asked · Now",
    severity,
    actionPath: "/hallkeeper/today",
    readAt: null,
    createdAt: "2026-09-26T10:00:00.000Z",
  };
}

function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** The shell owns whether the list shows; this stands in for it. */
function Shell({ unreadCount, onUnreadChanged }: {
  readonly unreadCount: number | null;
  readonly onUnreadChanged: () => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  return (
    <NotificationCenter unreadCount={unreadCount} onUnreadChanged={onUnreadChanged}
      expanded={expanded} onExpandedChange={setExpanded} />
  );
}

function renderCenter(unreadCount: number | null, onUnreadChanged = vi.fn()): ReturnType<typeof vi.fn> {
  render(<MemoryRouter><Shell unreadCount={unreadCount} onUnreadChanged={onUnreadChanged} /></MemoryRouter>);
  return onUnreadChanged;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([notification(REFRESHMENTS, "Refreshments × 6 · Grand Hall")]);
  mocks.subscribe.mockReturnValue(() => undefined);
  useAuthStore.getState().setUser(hallkeeper);
});
afterEach(() => { cleanup(); useAuthStore.getState().setUser(null); });

describe("NotificationCenter", () => {
  it("says the shell's count in words and shows no second chip", async () => {
    renderCenter(23);
    const trigger = await screen.findByRole("button", { name: "23 unread notifications" });
    // The words carry the number; there is no separate badge beside them.
    expect(trigger.textContent).toBe("23 unread notifications");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("states no number while the count is unknown", async () => {
    renderCenter(null);
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeDefined();
  });

  it("tells the shell when a notification is read", async () => {
    mocks.markRead.mockResolvedValue({ ...notification(REFRESHMENTS, "Refreshments × 6 · Grand Hall"), readAt: "2026-09-26T10:01:00.000Z" });
    const onUnreadChanged = renderCenter(1);
    fireEvent.click(await screen.findByRole("button", { name: "1 unread notification" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark read: Refreshments × 6 · Grand Hall" }));
    await waitFor(() => { expect(onUnreadChanged).toHaveBeenCalledTimes(1); });
    expect(await screen.findByText("Nothing waiting on you.")).toBeDefined();
  });

  it("says so when a read does not go through, and keeps the notification to try again", async () => {
    mocks.markRead.mockRejectedValueOnce(new Error("offline"));
    const onUnreadChanged = renderCenter(1);
    fireEvent.click(await screen.findByRole("button", { name: "1 unread notification" }));
    const item = (await screen.findByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" })).closest("li");
    if (item === null) throw new Error("expected the notification's list item");
    fireEvent.click(within(item).getByRole("button", { name: "Mark read: Refreshments × 6 · Grand Hall" }));
    expect((await within(item).findByRole("alert")).textContent).toBe("Could not mark this read. Try again.");
    expect(onUnreadChanged).not.toHaveBeenCalled();

    // The same button tries again, and the message goes with the success.
    mocks.markRead.mockResolvedValueOnce({ ...notification(REFRESHMENTS, "Refreshments × 6 · Grand Hall"), readAt: "2026-09-26T10:01:00.000Z" });
    fireEvent.click(within(item).getByRole("button", { name: "Mark read: Refreshments × 6 · Grand Hall" }));
    expect(await screen.findByText("Nothing waiting on you.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onUnreadChanged).toHaveBeenCalledTimes(1);
  });

  it("names each tone in words beside its dot", async () => {
    mocks.list.mockResolvedValue([
      notification(REFRESHMENTS, "Refreshments × 6 · Grand Hall", "urgent"),
      notification(LECTERN, "Lectern moved · Saloon", "attention"),
      notification("00000000-0000-4000-8000-00000000b003", "Floor plan approved", "info"),
    ]);
    renderCenter(3);
    fireEvent.click(await screen.findByRole("button", { name: "3 unread notifications" }));
    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.querySelector(".vv-notification-tone")?.textContent)).toEqual([
      "Urgent", "Needs attention", "Update",
    ]);
  });

  it("asks again when the list is opened, and keeps what it shows while it asks", async () => {
    renderCenter(1);
    const trigger = await screen.findByRole("button", { name: "1 unread notification" });
    expect(mocks.list).toHaveBeenCalledTimes(1);

    const reload = deferred<Notification[]>();
    mocks.list.mockReturnValueOnce(reload.promise);
    fireEvent.click(trigger);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    // Still the list from before, with Refresh saying it is working.
    expect(screen.getByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Refresh notifications" }).getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      reload.resolve([notification(LECTERN, "Lectern moved · Saloon", "attention")]);
      await reload.promise;
    });
    expect(screen.getByRole("heading", { level: 3, name: "Lectern moved · Saloon" })).toBeDefined();
    expect(screen.queryByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" })).toBeNull();
  });

  it("lets only the newest answer write the list", async () => {
    renderCenter(1);
    fireEvent.click(await screen.findByRole("button", { name: "1 unread notification" }));
    await screen.findByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" });

    const older = deferred<Notification[]>();
    const newer = deferred<Notification[]>();
    mocks.list.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));

    await act(async () => {
      newer.resolve([notification(LECTERN, "Lectern moved · Saloon", "attention")]);
      await newer.promise;
    });
    await act(async () => {
      older.resolve([notification(REFRESHMENTS, "Refreshments × 6 · Grand Hall")]);
      await older.promise;
    });
    expect(screen.getByRole("heading", { level: 3, name: "Lectern moved · Saloon" })).toBeDefined();
    expect(screen.queryByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" })).toBeNull();
  });

  it("does not bring back a notification read while an older list was on its way", async () => {
    mocks.markRead.mockResolvedValue({ ...notification(REFRESHMENTS, "Refreshments × 6 · Grand Hall"), readAt: "2026-09-26T10:01:00.000Z" });
    renderCenter(1);
    fireEvent.click(await screen.findByRole("button", { name: "1 unread notification" }));
    await screen.findByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" });

    // A reload leaves before the read lands and answers after it.
    const stale = deferred<Notification[]>();
    mocks.list.mockReturnValueOnce(stale.promise);
    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark read: Refreshments × 6 · Grand Hall" }));
    expect(await screen.findByText("Nothing waiting on you.")).toBeDefined();

    await act(async () => {
      stale.resolve([notification(REFRESHMENTS, "Refreshments × 6 · Grand Hall")]);
      await stale.promise;
    });
    expect(screen.queryByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" })).toBeNull();
    expect(screen.getByText("Nothing waiting on you.")).toBeDefined();
  });

  it("keeps the list when a reload fails and says it may be out of date", async () => {
    renderCenter(1);
    fireEvent.click(await screen.findByRole("button", { name: "1 unread notification" }));
    await screen.findByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" });

    mocks.list.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    expect(await screen.findByText("Could not refresh; this list may be out of date.")).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    await waitFor(() => { expect(screen.queryByText("Could not refresh; this list may be out of date.")).toBeNull(); });
  });

  it("says when the first load fails, and Refresh tries again", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    renderCenter(null);
    const trigger = await screen.findByRole("button", { name: "Notifications unavailable" });
    // Opening asks again; let that fail too, to see the failure said.
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(trigger);
    expect(await screen.findByText("Notifications could not be loaded.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Refreshments × 6 · Grand Hall" })).toBeDefined();
  });

  it("reloads the list when an inbox frame arrives, for someone on the floor", async () => {
    let listener: ((event: { readonly kind: string }) => void) | null = null;
    mocks.subscribe.mockImplementation((next: (event: { readonly kind: string }) => void) => {
      listener = next;
      return () => { listener = null; };
    });
    renderCenter(1);
    await screen.findByRole("button", { name: "1 unread notification" });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    act(() => { listener?.({ kind: "notification" }); });
    await waitFor(() => { expect(mocks.list).toHaveBeenCalledTimes(2); });
  });

  it("opens no live channel for someone it could carry nothing to", async () => {
    useAuthStore.getState().setUser({ ...hallkeeper, id: "planner-1", role: "planner", venueId: null });
    renderCenter(0);
    await screen.findByRole("button", { name: "No unread notifications" });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
});
