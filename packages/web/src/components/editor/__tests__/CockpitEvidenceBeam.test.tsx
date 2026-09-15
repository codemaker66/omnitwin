import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const rendering = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) => selector({ invalidate: rendering.invalidate }),
}));
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { CockpitEvidenceBeam } = await import("../CockpitEvidenceBeam.js");

describe("CockpitEvidenceBeam", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => { useCockpitStore.getState().reset(); });
  afterEach(() => {
    cleanup();
    useCockpitStore.getState().reset();
    warn.mockClear();
    error.mockClear();
  });

  it("renders nothing when no evidence beam is raised", () => {
    const { container } = render(<CockpitEvidenceBeam />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the SAFE caption at the anchor when a review beam is raised", () => {
    useCockpitStore.getState().setBeam({
      anchor: [2, 0.05, -3],
      label: "Simulated route crossing — human review required",
      tone: "review",
    });
    render(<CockpitEvidenceBeam />);
    expect(screen.getByText(/Simulated route crossing — human review required/)).toBeTruthy();
  });

  it("keeps the light column and ground ring when an annotation owns the caption", () => {
    useCockpitStore.getState().setBeam({
      anchor: [2, 0.05, -3],
      label: "Simulated route crossing — human review required",
      tone: "review",
      showLabel: false,
    });
    const { container } = render(<CockpitEvidenceBeam />);
    expect(container.querySelector("cylindergeometry")).not.toBeNull();
    expect(container.querySelector("ringgeometry")).not.toBeNull();
    expect(screen.queryByText(/Simulated route crossing/)).toBeNull();
    expect(useCockpitStore.getState().beam?.label).toBe("Simulated route crossing — human review required");
  });

  it("keeps annotation captions suppressed through fading and restores a later ordinary beam caption", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    const request = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    });
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      useCockpitStore.getState().setBeam({
        anchor: [2, 0.05, -3], label: "Annotation disclosure", tone: "review", showLabel: false,
      });
      const { container } = render(<CockpitEvidenceBeam />);
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(16);
      });
      act(() => { useCockpitStore.getState().clearBeam(); });
      // The light is still fading; a null live beam must not resurrect its caption.
      expect(container.querySelector("cylindergeometry")).not.toBeNull();
      expect(screen.queryByText("Annotation disclosure")).toBeNull();
      act(() => {
        useCockpitStore.getState().setBeam({ anchor: [1, 0, 2], label: "Independent evidence", tone: "info" });
      });
      expect(screen.getByText("Independent evidence")).toBeTruthy();
      expect(container.querySelector("ringgeometry")).not.toBeNull();
    } finally {
      cleanup(); request.mockRestore(); cancel.mockRestore(); clock.mockRestore();
    }
  });
});
