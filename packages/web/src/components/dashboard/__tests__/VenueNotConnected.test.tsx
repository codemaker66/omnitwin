import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { VenueNotConnected } from "../VenueNotConnected.js";

// ---------------------------------------------------------------------------
// The notice an account not connected to a venue yet is shown. A connection
// made meanwhile does not reach an open page, so it checks again in place,
// quietly: still not connected, connected (the store's venue then opens the
// view), or a check that did not finish.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({ mocks: { getCurrentAuthUser: vi.fn() } }));
vi.mock("../../../api/auth.js", () => ({ getCurrentAuthUser: mocks.getCurrentAuthUser }));

const UNPLACED: AuthUser = { id: "u1", email: "new@example.test", name: "New Colleague", role: "staff", platformRole: "none", venueId: null };

function show(): void {
  render(<VenueNotConnected title="Proposals" consequence="there are no proposals to show" />);
}

beforeEach(() => {
  mocks.getCurrentAuthUser.mockReset();
  useAuthStore.getState().setUser(UNPLACED);
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().setUser(null);
});

describe("VenueNotConnected", () => {
  it("says why there is nothing, who can connect it, and reads nothing until asked", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Proposals" })).toBeDefined();
    expect(screen.getByText("Your account is not connected to a venue yet, so there are no proposals to show.")).toBeDefined();
    expect(screen.getByText("Your Venviewer contact can connect it.")).toBeDefined();
    expect(mocks.getCurrentAuthUser).not.toHaveBeenCalled();
  });

  it("checks again and says so when it is still not connected", async () => {
    let answer: (user: AuthUser) => void = () => undefined;
    mocks.getCurrentAuthUser.mockReturnValue(new Promise<AuthUser>((resolve) => { answer = resolve; }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    const checking = screen.getByRole("button", { name: "Checking…" });
    expect(checking).toHaveProperty("disabled", true);
    expect(checking.getAttribute("aria-busy")).toBe("true");
    answer(UNPLACED);
    expect((await screen.findByRole("status")).textContent).toBe("Not connected yet.");
    expect(screen.getByRole("button", { name: "Check again" })).toHaveProperty("disabled", false);
  });

  it("takes a venue connected meanwhile into the account, which then opens the view", async () => {
    mocks.getCurrentAuthUser.mockResolvedValue({ ...UNPLACED, venueId: "venue-1" });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => { expect(useAuthStore.getState().user?.venueId).toBe("venue-1"); });
    expect(screen.queryByText("Not connected yet.")).toBeNull();
  });

  it("says calmly that a check did not finish, and keeps the account as it was", async () => {
    mocks.getCurrentAuthUser.mockRejectedValue(new Error("offline"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect((await screen.findByRole("status")).textContent).toBe("That check did not finish. Try again in a moment.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useAuthStore.getState().user).toEqual(UNPLACED);
    expect(screen.getByRole("button", { name: "Check again" })).toHaveProperty("disabled", false);
  });

  it("writes nothing back once the account signed out, or another took its place, while it checked", async () => {
    for (const meanwhile of [null, { ...UNPLACED, id: "u2", email: "other@example.test" }]) {
      let answer: (user: AuthUser) => void = () => undefined;
      mocks.getCurrentAuthUser.mockReturnValue(new Promise<AuthUser>((resolve) => { answer = resolve; }));
      useAuthStore.getState().setUser(UNPLACED);
      show();
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      useAuthStore.getState().setUser(meanwhile);
      answer({ ...UNPLACED, venueId: "venue-1" });
      await Promise.resolve();
      await Promise.resolve();
      expect(useAuthStore.getState().user).toEqual(meanwhile);
      cleanup();
    }
  });
});
