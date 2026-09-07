import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClerkAuthBridge } from "../ClerkAuthBridge.js";
import { WorkspaceAccessGate } from "../WorkspaceAccessGate.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { ApiError } from "../../../api/client.js";
import type { AuthSessionUser } from "../../../api/auth.js";

const mocks = vi.hoisted(() => ({
  getCurrentAuthUser: vi.fn<() => Promise<AuthSessionUser>>(),
  getToken: vi.fn<() => Promise<string | null>>(),
  signOut: vi.fn<() => Promise<void>>(),
  openUserProfile: vi.fn<() => void>(),
  identity: { isLoaded: true, isSignedIn: true,
    user: { id: "clerk_elaine", primaryEmailAddress: { emailAddress: "elaine@example.test", verification: { status: "verified" as "verified" | "unverified" } },
      publicMetadata: { role: "admin", platformRole: "admin", venueId: "untrusted" } } },
}));

vi.mock("@clerk/react", () => ({
  useUser: () => mocks.identity,
  useAuth: () => ({ getToken: mocks.getToken }),
  useClerk: () => ({ signOut: mocks.signOut, openUserProfile: mocks.openUserProfile }),
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
  mocks.getCurrentAuthUser.mockReset();
  mocks.openUserProfile.mockReset();
  mocks.identity.isLoaded = true;
  mocks.identity.isSignedIn = true;
  mocks.identity.user.id = "clerk_elaine";
  mocks.identity.user.primaryEmailAddress.verification.status = "verified";
  useAuthStore.getState().logout();
  useAuthStore.setState({ accessRetry: 0 });
  mocks.getToken.mockResolvedValue("test-token");
});

afterEach(cleanup);

describe("authoritative account access", () => {
  it("waits for API confirmation instead of trusting Clerk role metadata", async () => {
    const request = deferred<AuthSessionUser>();
    mocks.getCurrentAuthUser.mockReturnValue(request.promise);
    render(<Flow />);
    expect(screen.queryByText("Venue operations")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Checking access");
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    await act(async () => { request.resolve(venueAdmin); await request.promise; });
    expect(screen.getByText("Venue operations")).toBeDefined();
    expect(useAuthStore.getState().user?.platformRole).toBe("none");
    expect(useAuthStore.getState().user?.id).toBe("db-user");
  });

  it("shows pending access for an uninvited account and can accept a later grant", async () => {
    mocks.getCurrentAuthUser.mockRejectedValueOnce(new ApiError(403, "Invitation required", "INVITATION_REQUIRED"));
    render(<Flow />);
    await screen.findByRole("heading", { name: "Venue access pending" });
    expect(screen.queryByRole("button", { name: "Open account settings" })).toBeNull();
    expect(screen.getByText("elaine@example.test")).toBeDefined();
    expect(screen.queryByText("Venue operations")).toBeNull();
    mocks.getCurrentAuthUser.mockResolvedValueOnce(venueAdmin);
    fireEvent.click(screen.getByRole("button", { name: "Check my access" }));
    await screen.findByText("Venue operations");
    expect(useAuthStore.getState().user?.venueId).toBe("trades-hall");
  });

  it("opens account settings for an unverified email and waits for API access after verification", async () => {
    mocks.identity.user.primaryEmailAddress.verification.status = "unverified";
    mocks.getCurrentAuthUser.mockRejectedValueOnce(new ApiError(403, "Verify your email", "EMAIL_UNVERIFIED"));
    const view = render(<Flow />);
    await screen.findByRole("heading", { name: "Verify your email" });
    expect(useAuthStore.getState().accessStatus).toBe("error");
    expect(screen.getByRole("status").textContent).toContain("choose Complete verification");
    expect(screen.queryByText("Venue operations")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open account settings" }));
    expect(mocks.openUserProfile).toHaveBeenCalledTimes(1);
    expect(mocks.getCurrentAuthUser).toHaveBeenCalledTimes(1);

    const confirmation = deferred<AuthSessionUser>();
    mocks.getCurrentAuthUser.mockReturnValue(confirmation.promise);
    mocks.identity.user.primaryEmailAddress.verification.status = "verified";
    view.rerender(<Flow />);
    expect(screen.queryByRole("button", { name: "Open account settings" })).toBeNull();
    expect(screen.queryByText("Venue operations")).toBeNull();
    const freshToken = deferred<string | null>();
    mocks.getToken.mockReturnValueOnce(freshToken.promise);
    mocks.getToken.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Check my access" }));
    expect(mocks.getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(screen.getByRole("status").textContent).toContain("Checking access");
    expect(screen.getByRole("button", { name: "Use another account" })).toBeDefined();
    expect(mocks.getCurrentAuthUser).toHaveBeenCalledTimes(1);
    await act(async () => { freshToken.resolve("verified-token"); await freshToken.promise; });
    expect(mocks.getCurrentAuthUser).toHaveBeenCalledTimes(2);
    await act(async () => { confirmation.resolve(venueAdmin); await confirmation.promise; });
    await screen.findByText("Venue operations");
    expect(useAuthStore.getState().user?.venueId).toBe("trades-hall");
  });

  it("keeps a failed account-settings action retryable for an unverified pending account", async () => {
    mocks.identity.user.primaryEmailAddress.verification.status = "unverified";
    mocks.getCurrentAuthUser.mockRejectedValue(new ApiError(403, "Invite", "INVITATION_REQUIRED"));
    mocks.openUserProfile.mockImplementationOnce(() => { throw new Error("Profile unavailable"); });
    render(<Flow />);
    fireEvent.click(await screen.findByRole("button", { name: "Open account settings" }));
    expect(screen.getByRole("alert").textContent).toContain("Account settings did not open");
    expect(screen.queryByText("Venue operations")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open account settings" }));
    expect(mocks.openUserProfile).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Check my access" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Use another account" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps token-refresh failures retryable without requesting access with stale claims", async () => {
    mocks.getCurrentAuthUser.mockRejectedValueOnce(new ApiError(403, "Invite", "INVITATION_REQUIRED"));
    const freshToken = deferred<string | null>();
    mocks.getToken.mockReturnValueOnce(freshToken.promise);
    render(<Flow />);
    fireEvent.click(await screen.findByRole("button", { name: "Check my access" }));
    expect(mocks.getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(mocks.getCurrentAuthUser).toHaveBeenCalledTimes(1);
    await act(async () => { freshToken.reject(new Error("Refresh unavailable")); await freshToken.promise.catch(() => undefined); });
    await screen.findByRole("heading", { name: "Connection unavailable" });
    expect(screen.getByRole("alert").textContent).toContain("could not confirm");
    expect(mocks.getCurrentAuthUser).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Venue operations")).toBeNull();

    mocks.getCurrentAuthUser.mockResolvedValueOnce(venueAdmin);
    fireEvent.click(screen.getByRole("button", { name: "Check my access" }));
    await screen.findByText("Venue operations");
    expect(mocks.getToken).toHaveBeenCalledTimes(2);
    expect(mocks.getToken).toHaveBeenLastCalledWith({ skipCache: true });
    expect(mocks.getCurrentAuthUser).toHaveBeenCalledTimes(2);
  });

  it("discards a token refresh that finishes after the account signs out", async () => {
    mocks.getCurrentAuthUser.mockRejectedValueOnce(new ApiError(403, "Invite", "INVITATION_REQUIRED"))
      .mockResolvedValueOnce(venueAdmin);
    const freshToken = deferred<string | null>();
    mocks.getToken.mockReturnValueOnce(freshToken.promise);
    mocks.signOut.mockResolvedValueOnce(undefined);
    const view = render(<Flow />);
    fireEvent.click(await screen.findByRole("button", { name: "Check my access" }));
    expect(mocks.getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(mocks.getCurrentAuthUser).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Use another account" }));
    await waitFor(() => { expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: "/login" }); });
    mocks.identity.isSignedIn = false;
    view.rerender(<Flow />);

    await act(async () => { freshToken.resolve("previous-account-token"); await freshToken.promise; });
    expect(mocks.getCurrentAuthUser).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessStatus).toBe("signed_out");
  });

  it("allows switching accounts while the access request remains unresolved", async () => {
    const request = deferred<AuthSessionUser>();
    mocks.getCurrentAuthUser.mockReturnValue(request.promise);
    mocks.signOut.mockResolvedValueOnce(undefined);
    render(<Flow />);
    fireEvent.click(screen.getByRole("button", { name: "Use another account" }));
    await waitFor(() => { expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: "/login" }); });
    expect(screen.queryByText("Venue operations")).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("reports a service failure separately from an invitation wait and recovers", async () => {
    mocks.getCurrentAuthUser.mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVER_ERROR"));
    render(<Flow />);
    await screen.findByRole("heading", { name: "Connection unavailable" });
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
    await act(async () => { request.resolve(venueAdmin); await request.promise; });
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
    await act(async () => { old.reject(new ApiError(403, "No access", "INVITATION_REQUIRED")); await old.promise.catch(() => undefined); });
    expect(useAuthStore.getState().user?.id).toBe("db-user");
  });

  it("keeps sign-out errors actionable without leaving a working indicator", async () => {
    mocks.getCurrentAuthUser.mockRejectedValue(new ApiError(403, "Invite", "INVITATION_REQUIRED"));
    const signout = deferred<undefined>();
    mocks.signOut.mockReturnValueOnce(signout.promise);
    render(<Flow />);
    fireEvent.click(await screen.findByRole("button", { name: "Use another account" }));
    expect(screen.getByRole("button", { name: "Signing out…" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => { signout.reject(new Error("offline")); await signout.promise.catch(() => undefined); });
    await waitFor(() => { expect(screen.getByRole("alert").textContent).toContain("Sign out did not finish"); });
    expect(screen.getByRole("button", { name: "Use another account" }).getAttribute("aria-busy")).toBe("false");
  });
});
