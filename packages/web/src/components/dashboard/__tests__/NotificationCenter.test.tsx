import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@omnitwin/types";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { NotificationCenter } from "../NotificationCenter.js";

// The panel inside the dashboard's More popover. The unread number belongs to
// the shell (one number, one source, one chip); this panel says it in words,
// lists the newest unread, and reloads when the live channel says the inbox
// changed, for the people that channel can reach.

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

function notification(id: string, title: string): Notification {
  return {
    id,
    changeId: null,
    eventId: null,
    venueId: "00000000-0000-4000-8000-00000000a001",
    audienceRole: "hallkeeper",
    recipientUserId: null,
    title,
    body: "Elaine asked · Now",
    severity: "urgent",
    actionPath: "/hallkeeper/today",
    readAt: null,
    createdAt: "2026-09-26T10:00:00.000Z",
  };
}

function renderCenter(unreadCount: number | null, onUnreadChanged = vi.fn()): ReturnType<typeof vi.fn> {
  render(<MemoryRouter><NotificationCenter unreadCount={unreadCount} onUnreadChanged={onUnreadChanged} /></MemoryRouter>);
  return onUnreadChanged;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([notification("00000000-0000-4000-8000-00000000b001", "Refreshments × 6 · Grand Hall")]);
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
  });

  it("states no number while the count is unknown", async () => {
    renderCenter(null);
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeDefined();
  });

  it("tells the shell when a notification is read", async () => {
    mocks.markRead.mockResolvedValue({ ...notification("00000000-0000-4000-8000-00000000b001", "Refreshments × 6 · Grand Hall"), readAt: "2026-09-26T10:01:00.000Z" });
    const onUnreadChanged = renderCenter(1);
    fireEvent.click(await screen.findByRole("button", { name: "1 unread notification" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark Refreshments × 6 · Grand Hall read" }));
    await waitFor(() => { expect(onUnreadChanged).toHaveBeenCalledTimes(1); });
    expect(await screen.findByText("No unread notifications.")).toBeDefined();
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
