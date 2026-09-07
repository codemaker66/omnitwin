import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClerkAuthBridge } from "../ClerkAuthBridge.js";
import { WorkspaceAccessGate } from "../WorkspaceAccessGate.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { ApiError } from "../../../api/client.js";
import type { AuthSessionUser } from "../../../api/auth.js";

const mocks = vi.hoisted(() => ({
  getCurrentAuthUser: vi.fn<() => Promise<AuthSessionUser>>(),
  getToken: vi.fn<() => Promise<string | null>>(),
  signOut: vi.fn<() => Promise<void>>(),
  identity: { isLoaded: true, isSignedIn: true,
    user: { id: "clerk_elaine", primaryEmailAddress: { emailAddress: "elaine@example.test" },
      publicMetadata: { role: "admin", platformRole: "admin", venueId: "untrusted" } } },
}));

vi.mock("@clerk/react", () => ({
  useUser: () => mocks.identity,
  useAuth: () => ({ getToken: mocks.getToken }),
  useClerk: () => ({ signOut: mocks.signOut }),
}));
vi.mock("../../../api/auth.js", () => ({ getCurrentAuthUser: mocks.getCurrentAuthUser }));

const venueAdmin: AuthSessionUser = { id: "db-user", email: "elaine@example.test", name: "Elaine",
  role: "admin", platformRole: "none", venueId: "trades-hall" };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Flow(): React.ReactElement {
  return <><ClerkAuthBridge /><WorkspaceAccessGate><div>Venue operations</div></WorkspaceAccessGate></>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.isSignedIn = true;
  mocks.identity.user.id = "clerk_elaine";
  useAuthStore.getState().logout();
  mocks.getToken.mockResolvedValue("test-token");
});

describe("authoritative account access", () => {
  it("waits for API confirmation instead of trusting Clerk role metadata", async () => {
    const request = deferred<AuthSessionUser>();
    mocks.getCurrentAuthUser.mockReturnValue(request.promise);
    render(<Flow />);
    expect(screen.queryByText("Venue operations")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Confirming your venue access");
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    await act(async () => { request.resolve(venueAdmin); });
    expect(screen.getByText("Venue operations")).toBeDefined();
    expect(useAuthStore.getState().user?.platformRole).toBe("none");
    expect(useAuthStore.getState().user?.id).toBe("db-user");
  });

  it("shows pending access for an uninvited account and can accept a later grant", async () => {
    mocks.getCurrentAuthUser.mockRejectedValueOnce(new ApiError(403, "Invitation required", "INVITATION_REQUIRED"));
    render(<Flow />);
    await screen.findByRole("heading", { name: "Your account is ready." });
    expect(screen.getByText("elaine@example.test")).toBeDefined();
    expect(screen.queryByText("Venue operations")).toBeNull();
    mocks.getCurrentAuthUser.mockResolvedValueOnce(venueAdmin);
    fireEvent.click(screen.getByRole("button", { name: "Check my access" }));
    await screen.findByText("Venue operations");
    expect(useAuthStore.getState().user?.venueId).toBe("trades-hall");
  });

  it("reports a service failure separately from an invitation wait and recovers", async () => {
    mocks.getCurrentAuthUser.mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVER_ERROR"));
    render(<Flow />);
    await screen.findByRole("heading", { name: "Let’s reconnect." });
    expect(screen.getByRole("alert").textContent).toContain("could not confirm");
    mocks.getCurrentAuthUser.mockResolvedValueOnce(venueAdmin);
    fireEvent.click(screen.getByRole("button", { name: "Check my access" }));
    await screen.findByText("Venue operations");
  });

  it("discards an old identity response after sign out", async () => {
    const request = deferred<AuthSessionUser>();
    mocks.getCurrentAuthUser.mockReturnValueOnce(request.promise);
    const view = render(<Flow />);
    mocks.identity.isSignedIn = false;
    view.rerender(<Flow />);
    await act(async () => { request.resolve(venueAdmin); });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("discards a previous account failure after a different account resolves", async () => {
    const old = deferred<AuthSessionUser>();
    mocks.getCurrentAuthUser.mockReturnValueOnce(old.promise).mockResolvedValueOnce(venueAdmin);
    const view = render(<Flow />);
    mocks.identity.user.id = "clerk_different";
    view.rerender(<Flow />);
    await screen.findByText("Venue operations");
    await act(async () => { old.reject(new ApiError(403, "No access", "INVITATION_REQUIRED")); });
    expect(useAuthStore.getState().user?.id).toBe("db-user");
  });

  it("keeps sign-out errors actionable without leaving a working indicator", async () => {
    mocks.getCurrentAuthUser.mockRejectedValue(new ApiError(403, "Invite", "INVITATION_REQUIRED"));
    const signout = deferred<void>();
    mocks.signOut.mockReturnValueOnce(signout.promise);
    render(<Flow />);
    fireEvent.click(await screen.findByRole("button", { name: "Use another account" }));
    expect(screen.getByRole("button", { name: "Signing out…" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => { signout.reject(new Error("offline")); });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Sign out did not finish"));
    expect(screen.getByRole("button", { name: "Use another account" }).getAttribute("aria-busy")).toBe("false");
  });
});
