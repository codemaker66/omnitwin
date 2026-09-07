import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const scene = vi.hoisted(() => ({ loaded: undefined as undefined | (() => void), failed: undefined as undefined | (() => void) }));
vi.mock("../living-hall/LivingHallScene.js", () => ({
  LivingHallScene: ({ onSceneLoaded, onSceneFailed }: { readonly onSceneLoaded?: () => void; readonly onSceneFailed?: () => void }) => {
    scene.loaded = onSceneLoaded;
    scene.failed = onSceneFailed;
    return <div data-testid="living-scene-stub" />;
  },
}));
const { LivingHallPage } = await import("../living-hall/LivingHallPage.js");
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Living Hall activity lifecycle", () => {
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

});
