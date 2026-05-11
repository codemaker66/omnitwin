import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("renders the internal command shell empty state without mounting a Spark asset", () => {
    mount();
    expect(screen.getByText("Venviewer")).toBeTruthy();
    expect(screen.getByText("Truth Mode")).toBeTruthy();
    expect(screen.getByText("Event Phase Graph")).toBeTruthy();
    expect(screen.getByText("Guest Flow Replay")).toBeTruthy();
    expect(screen.getByText("Overlays")).toBeTruthy();
    expect(screen.getByText("Internal command shell demo")).toBeTruthy();
    expect(screen.getByText("No real asset loaded yet")).toBeTruthy();
    expect(screen.getByTestId("grand-hall-room")).toBeTruthy();
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
  });

  it("mounts the Spark layer only for a plausible runtime asset URL", () => {
    mount("/dev/trades-hall-visual?splatUrl=https%3A%2F%2Fassets.venviewer.test%2Fscene.ply");
    expect(screen.getByTestId("spark-splat-layer").textContent).toBe("https://assets.venviewer.test/scene.ply");
    expect(screen.getAllByText(/Loading runtime asset/i).length).toBeGreaterThan(0);
  });

  it("does not present production or verification claims", () => {
    mount();
    const bodyText = document.body.textContent;
    expect(bodyText).not.toMatch(/Black Label/i);
    expect(bodyText).not.toMatch(/production ready/i);
    expect(bodyText).not.toMatch(/real Trades Hall loaded/i);
    expect(bodyText).not.toMatch(/photoreal/i);
    expect(bodyText).not.toMatch(/survey-grade/i);
    expect(bodyText).not.toMatch(/legally compliant/i);
    expect(bodyText).not.toMatch(/fire approved/i);
    expect(bodyText).not.toMatch(/certified safe/i);
  });

  it("switches mesh, splat, and hybrid layer state", () => {
    mount();
    expect(screen.getByRole("button", { name: /Hybrid/i }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Splat/i }));
    expect(screen.getByRole("button", { name: /Splat/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Mesh/i }));
    expect(screen.getByRole("button", { name: /Mesh/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("grand-hall-room")).toBeTruthy();
  });

  it("allows the event phase graph to select a phase", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Bar queue/i }));
    expect(screen.getByText(/Wedding ceremony -> dinner flip \/ Bar queue/i)).toBeTruthy();
  });

  it("lets insight cards change the active command mode", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Ops Compiler/i }));
    expect(screen.getByRole("button", { name: "Ops" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps fixture-only Spark sources out of the command shell source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/pages/TradesHallVisualPage.tsx"), "utf-8");
    expect(source).not.toContain("textSplats");
  });
});
