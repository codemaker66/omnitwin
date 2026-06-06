import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RuntimePackage } from "@omnitwin/types";

const { getLatestRuntimePackageMock } = vi.hoisted(() => ({
  getLatestRuntimePackageMock: vi.fn(),
}));

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

vi.mock("../api/runtime-packages.js", () => ({
  getLatestRuntimePackage: getLatestRuntimePackageMock,
}));

import { TradesHallVisualPage } from "../pages/TradesHallVisualPage.js";

afterEach(() => {
  cleanup();
  getLatestRuntimePackageMock.mockReset();
});

function mount(initialEntry = "/dev/trades-hall-visual"): void {
  getLatestRuntimePackageMock.mockResolvedValue(null);
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TradesHallVisualPage />
    </MemoryRouter>,
  );
}

function makeRuntimePackage(roomSlug = "robert-adam-room"): RuntimePackage {
  const assetVersionId = "10000000-0000-4000-8000-000000000001";
  return {
    id: "rp1",
    venueSlug: "trades-hall",
    roomSlug,
    primaryVisualAssetVersionId: assetVersionId,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug,
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: assetVersionId,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
      },
    },
    evidenceStatus: "unverified",
    runtimeStatus: "usable",
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
    primaryVisualAssetUrl: `https://assets.example/${roomSlug}/scene.ply`,
    primaryVisualAssetVersion: {
      id: assetVersionId,
      venueSlug: "trades-hall",
      roomSlug,
      captureSessionId: null,
      assetKind: "splat",
      sourceType: roomSlug === "grand-hall" ? "runpod" : "xgrids",
      r2Key: `venues/trades-hall/rooms/${roomSlug}/scene.ply`,
      fileName: "scene.ply",
      fileExt: ".ply",
      mimeType: "application/octet-stream",
      sha256: "a".repeat(64),
      sizeBytes: 2048,
      evidenceStatus: "unverified",
      runtimeStatus: "usable",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
    },
  };
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
    expect(screen.getAllByText("No real asset loaded yet").length).toBeGreaterThan(0);
    expect(screen.getByTestId("grand-hall-room")).toBeTruthy();
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
  });

  it("requests the Grand Hall runtime package by default", async () => {
    mount();
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "grand-hall",
      });
    });
  });

  it("requests the Robert Adam Room package from query params", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=robert-adam-room");
    expect(screen.getByText(/Robert Adam Room/i)).toBeTruthy();
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "robert-adam-room",
      });
    });
  });

  it("requests the Saloon package from query params", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=saloon");
    expect(screen.getByText(/Saloon/i)).toBeTruthy();
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "saloon",
      });
    });
  });

  it("mounts a registry runtime package only after the API returns one", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeRuntimePackage("robert-adam-room"));
    render(
      <MemoryRouter initialEntries={["/dev/trades-hall-visual?venue=trades-hall&room=robert-adam-room"]}>
        <TradesHallVisualPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("spark-splat-layer").textContent).toBe(
        "https://assets.example/robert-adam-room/scene.ply",
      );
    });
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
    expect(screen.getByText(/Grand Hall \/ Bar queue/i)).toBeTruthy();
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
