import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RoomSplatProgress } from "../../components/rooms/RoomSplatScene.js";

const scene = vi.hoisted(() => ({
  report: null as null | ((progress: RoomSplatProgress) => void),
  loaded: undefined as undefined | (() => void),
  failed: undefined as undefined | (() => void),
}));

vi.mock("../../components/rooms/RoomSplatScene.js", () => ({
  RoomSplatScene: ({ onProgress }: { readonly onProgress: (progress: RoomSplatProgress) => void }) => {
    scene.report = onProgress;
    return <div data-testid="scene" />;
  },
}));

vi.mock("@clerk/react", () => ({
  ClerkLoading: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
  ClerkFailed: () => null,
  ClerkLoaded: () => null,
  SignIn: () => null,
  SignUp: () => null,
  OAuthConsent: () => null,
  Show: () => null,
}));

vi.mock("../living-hall/LivingHallScene.js", () => ({
  LivingHallScene: ({ onSceneLoaded, onSceneFailed }: {
    readonly onSceneLoaded?: () => void;
    readonly onSceneFailed?: () => void;
  }) => {
    scene.loaded = onSceneLoaded;
    scene.failed = onSceneFailed;
    return <div data-testid="living-scene-stub" />;
  },
}));

const { RoomWalkPage } = await import("../RoomWalkPage.js");
const { LoginPage } = await import("../LoginPage.js");
const { RegisterPage } = await import("../RegisterPage.js");
const { OAuthConsentPage } = await import("../OAuthConsentPage.js");
const { LivingHallPage } = await import("../living-hall/LivingHallPage.js");
const { HallkeeperPage } = await import("../HallkeeperPage.js");

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("shared activity on real page waits", () => {
  it("keeps streaming, measured sharpening progress, and completion tied to the room lifecycle", () => {
    render(<MemoryRouter initialEntries={["/room/grand-hall"]}>
      <Routes><Route path="/room/:roomSlug" element={<RoomWalkPage />} /></Routes>
    </MemoryRouter>);
    expect(screen.getByRole("status").textContent).toBe("Streaming the room");
    expect(screen.getByRole("status").querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    act(() => { scene.report?.({ settled: 4, total: 10, splats: 1, failed: 0, complete: false, firstView: true }); });
    expect(screen.getByRole("status").textContent).toContain("Sharpening the room — 40%");
    expect(screen.getByRole("status").querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    act(() => { scene.report?.({ settled: 10, total: 10, splats: 1, failed: 0, complete: true, firstView: true }); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("preserves bare capture output without drawing loading chrome", () => {
    render(<MemoryRouter initialEntries={["/room/grand-hall?bare=1"]}>
      <Routes><Route path="/room/:roomSlug" element={<RoomWalkPage />} /></Routes>
    </MemoryRouter>);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("loads the hallkeeper sheet with shared status instead of anonymous placeholder rows", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(() => undefined));
    render(<MemoryRouter initialEntries={["/hallkeeper/layout"]}>
      <Routes><Route path="/hallkeeper/:configId" element={<HallkeeperPage />} /></Routes>
    </MemoryRouter>);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading the hallkeeper sheet");
    expect(status.querySelector("[data-activity-indicator]")).not.toBeNull();
    // Let the token continuation enter the mocked fetch before restoring it.
    await act(() => Promise.resolve());
  });

  it.each(["loaded", "failed"] as const)("ends Living Hall activity when the capture is %s", async (outcome) => {
    // WebGL is stubbed at the capability boundary; no rendering is fabricated.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    render(<MemoryRouter><LivingHallPage /></MemoryRouter>);
    expect(screen.getByRole("status").textContent).toBe("Streaming the hall");
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    await screen.findByTestId("living-scene-stub");
    act(() => { scene[outcome]?.(); });
    expect(screen.queryByText("Streaming the hall")).toBeNull();
  });

  it("does not show activity when a visitor explicitly disables the Living Hall scene", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    render(<MemoryRouter initialEntries={["/living-hall?scene=0"]}><LivingHallPage /></MemoryRouter>);
    expect(screen.queryByText("Streaming the hall")).toBeNull();
    expect(screen.queryByTestId("living-scene-stub")).toBeNull();
  });

  it.each([
    [LoginPage, "Loading secure sign-in."],
    [RegisterPage, "Loading secure account creation."],
    [OAuthConsentPage, "Loading secure consent."],
  ])("marks secure form loading with shared decorative motion and readable status", (Page, message) => {
    render(<MemoryRouter><Page /></MemoryRouter>);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(message);
    expect(status.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
