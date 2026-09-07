import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthModal } from "../components/editor/AuthModal.js";
import { OAuthConsentPage } from "../pages/OAuthConsentPage.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useEditorStore } from "../stores/editor-store.js";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), save: vi.fn(), clerk: "loading" as "loading" | "loaded" | "failed",
}));

vi.mock("../api/configurations.js", () => ({ claimConfig: mocks.claim }));
vi.mock("../stores/auth-store.js", async () => {
  const { create } = await import("zustand");
  return { useAuthStore: create(() => ({ isAuthenticated: true, user: null })) };
});
vi.mock("../stores/editor-store.js", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({
    configId: "layout-a", isPublicPreview: true, saveToServer: mocks.save,
  }));
  return { useEditorStore: store,
    captureEditorSession: () => ({ configId: store.getState().configId, generation: 0 }),
    isCurrentEditorSession: (session: { configId: string }) => store.getState().configId === session.configId,
  };
});
vi.mock("@clerk/react", () => ({
  SignIn: () => <div>Secure sign in</div>,
  ClerkLoading: ({ children }: { readonly children: ReactNode }) => mocks.clerk === "loading" ? children : null,
  ClerkLoaded: ({ children }: { readonly children: ReactNode }) => mocks.clerk === "loaded" ? children : null,
  ClerkFailed: ({ children }: { readonly children: ReactNode }) => mocks.clerk === "failed" ? children : null,
  Show: ({ children }: { readonly children: ReactNode }) => children,
  OAuthConsent: () => <div>Consent controls</div>,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(true);
  mocks.clerk = "loading";
  useAuthStore.setState({ isAuthenticated: true });
  useEditorStore.setState({ configId: "layout-a", isPublicPreview: true });
});
afterEach(cleanup);

describe("authentication activity lifecycles", () => {
  it("shows the account claim until it completes and hands the real save to the editor", async () => {
    const request = deferred();
    mocks.claim.mockReturnValue(request.promise);
    const close = vi.fn();
    render(<AuthModal onClose={close} />);
    expect(screen.getByRole("status").textContent).toContain("Adding this layout");
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    await act(async () => { request.resolve(); await request.promise; });
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.save).toHaveBeenCalledWith(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stops motion on a failed claim and resumes only when retry starts", async () => {
    const first = deferred();
    const second = deferred();
    mocks.claim.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const close = vi.fn();
    render(<AuthModal onClose={close} />);
    await act(async () => { first.reject(new Error("offline")); await first.promise.catch(() => undefined); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("preview is still available");
    expect(close).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("status")).toBeDefined();
    await act(async () => { second.resolve(); await second.promise; });
    expect(screen.queryByRole("status")).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ignores a departed layout's response and does not repeat a claim when the close callback changes", async () => {
    const first = deferred();
    const second = deferred();
    mocks.claim.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<AuthModal onClose={vi.fn()} />);
    view.rerender(<AuthModal onClose={vi.fn()} />);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    act(() => { useEditorStore.setState({ configId: "layout-b" }); });
    await act(async () => { first.resolve(); await first.promise; });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(useEditorStore.getState().isPublicPreview).toBe(true);
    view.unmount();
    useEditorStore.setState({ configId: "layout-c" });
    await act(async () => { second.resolve(); await second.promise; });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("shares the non-idempotent claim across StrictMode and dismissal/reopening", async () => {
    const request = deferred();
    mocks.claim.mockReturnValueOnce(request.promise).mockRejectedValue(new Error("ALREADY_CLAIMED"));
    const first = render(<StrictMode><AuthModal onClose={vi.fn()} /></StrictMode>);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    first.unmount();
    const close = vi.fn();
    render(<StrictMode><AuthModal onClose={close} /></StrictMode>);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    await act(async () => { request.resolve(); await request.promise; });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("settles accepted ownership after dismissal without calling an obsolete close handler", async () => {
    const request = deferred();
    mocks.claim.mockReturnValue(request.promise);
    const close = vi.fn();
    const view = render(<AuthModal onClose={close} />);
    view.unmount();
    await act(async () => { request.resolve(); await request.promise; });
    expect(useEditorStore.getState().isPublicPreview).toBe(false);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps the idle sign-in form still", () => {
    useAuthStore.setState({ isAuthenticated: false });
    render(<AuthModal onClose={vi.fn()} />);
    expect(screen.getByText("Secure sign in")).toBeDefined();
    expect(document.querySelector("[data-activity-indicator]")).toBeNull();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it.each(["loaded", "failed"] as const)("settles consent loading into %s without motion", (result) => {
    const view = render(<OAuthConsentPage />);
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    mocks.clerk = result;
    view.rerender(<OAuthConsentPage />);
    expect(document.querySelector("[data-activity-indicator]")).toBeNull();
    if (result === "failed") expect(screen.getByRole("alert").textContent).toContain("unavailable");
    else expect(screen.getByText("Consent controls")).toBeDefined();
  });
});
