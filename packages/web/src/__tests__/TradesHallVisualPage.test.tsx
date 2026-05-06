import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { readonly children?: React.ReactNode }) => {
    const renderableChildren = React.Children.toArray(children).filter((child) => {
      if (!React.isValidElement(child)) return true;
      return typeof child.type !== "string" || child.type === "div";
    });
    return <div data-testid="visual-canvas">{renderableChildren}</div>;
  },
  useFrame: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
}));

vi.mock("../components/GrandHallRoom.js", () => ({
  GrandHallRoom: () => <div data-testid="grand-hall-room" />,
}));

vi.mock("../components/scene/SparkSplatLayer.js", () => ({
  SparkSplatLayer: ({ url }: { readonly url: string }) => (
    <div data-testid="spark-splat-layer">{url}</div>
  ),
}));

import { TradesHallVisualPage } from "../pages/TradesHallVisualPage.js";

afterEach(() => {
  cleanup();
});

function mount(initialEntry = "/dev/trades-hall-visual"): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TradesHallVisualPage />
    </MemoryRouter>,
  );
}

describe("TradesHallVisualPage", () => {
  it("renders the internal empty state without mounting a Spark asset", () => {
    mount();
    expect(screen.getByText("Trades Hall runtime asset loader")).toBeTruthy();
    expect(screen.getByText("Internal visual layer test. Not a verified photoreal runtime package.")).toBeTruthy();
    expect(screen.getByText("No real asset loaded yet")).toBeTruthy();
    expect(screen.getByTestId("grand-hall-room")).toBeTruthy();
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
  });

  it("mounts the Spark layer only for a plausible runtime asset URL", () => {
    mount("/dev/trades-hall-visual?splatUrl=https%3A%2F%2Fassets.venviewer.test%2Fscene.ply");
    expect(screen.getByTestId("spark-splat-layer").textContent).toBe("https://assets.venviewer.test/scene.ply");
    expect(screen.getByText(/Loading runtime asset/i)).toBeTruthy();
  });

  it("does not present production or verification claims", () => {
    mount();
    const bodyText = document.body.textContent;
    expect(bodyText).not.toMatch(/Black Label/i);
    expect(bodyText).not.toMatch(/production ready/i);
    expect(bodyText).not.toMatch(/real Trades Hall loaded/i);
  });
});
