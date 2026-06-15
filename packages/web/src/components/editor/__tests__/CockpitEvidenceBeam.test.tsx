import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) => selector({ invalidate: vi.fn() }),
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
});
