import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PublicRoomRuntimeVisual, RuntimeSlug } from "@omnitwin/types";
import {
  getRoomShowcaseProfile,
  publicRoomSelectionCards,
  roomShowcaseRoutes,
} from "../lib/trades-hall-room-showcase.js";

const { getPublicRoomRuntimeVisualMock } = vi.hoisted(() => ({
  getPublicRoomRuntimeVisualMock: vi.fn(),
}));

vi.mock("../api/public-room-visual.js", () => ({
  getPublicRoomRuntimeVisual: getPublicRoomRuntimeVisualMock,
}));

vi.mock("../components/showcase/PublicRoomRuntimeCanvas.js", async () => {
  const React = await import("react");
  const PublicRoomRuntimeCanvas = (props: { readonly onLoaded: () => void }): React.ReactElement => {
    React.useEffect(() => {
      props.onLoaded();
    }, [props.onLoaded]);
    return React.createElement("div", { "data-testid": "public-runtime-canvas" }, "Runtime visual preview");
  };
  return { PublicRoomRuntimeCanvas };
});

import { RoomShowcasePage } from "../pages/RoomShowcasePage.js";

const FORBIDDEN_PUBLIC_CLAIMS = [
  "certified",
  "legally compliant",
  "fire approved",
  "survey-grade",
  "guaranteed accessible",
  "production ready",
  "photoreal digital twin",
] as const;

function publicVisual(overrides: Partial<PublicRoomRuntimeVisual> = {}): PublicRoomRuntimeVisual {
  return {
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    runtimeVisualAvailable: false,
    visualUrl: null,
    visualLabel: "Visual preview",
    safeCopy: "Runtime room visual is not currently available for this public preview. Final details are confirmed by the venue team.",
    humanReviewRequired: true,
    ...overrides,
  };
}

function mount(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/venues/:venueSlug/rooms/:roomSlug" element={<RoomShowcasePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getPublicRoomRuntimeVisualMock.mockImplementation((venueSlug: RuntimeSlug, roomSlug: RuntimeSlug) =>
    Promise.resolve(publicVisual({ venueSlug, roomSlug })),
  );
});

afterEach(() => {
  cleanup();
  getPublicRoomRuntimeVisualMock.mockReset();
});

describe("RoomShowcasePage", () => {
  it.each(roomShowcaseRoutes)("loads the public route %s", async (route) => {
    mount(route);

    const roomSlug = route.split("/").at(-1) ?? "";
    const profile = getRoomShowcaseProfile(roomSlug);
    expect(profile).not.toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: profile?.name })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Request layout/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Enquire about this room/i })).toBeTruthy();
  });

  it("renders a safe fallback when no public runtime package is available", async () => {
    mount("/venues/trades-hall/rooms/lady-convenors-room");

    expect(await screen.findByRole("heading", { level: 1, name: "Lady Convenor's Room" })).toBeTruthy();
    await waitFor(() => {
      expect(getPublicRoomRuntimeVisualMock).toHaveBeenCalledWith("trades-hall", "lady-convenors-room");
    });
    expect(screen.getAllByText(/Visual preview/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Human review is required/i)).toBeTruthy();
    expect(screen.getByText(/Final details are confirmed by the venue team/i)).toBeTruthy();
    expect(screen.queryByTestId("public-runtime-canvas")).toBeNull();
  });

  it("offers an engaging full-room selector without inventing a Deacon Convener runtime route", async () => {
    mount("/venues/trades-hall/rooms/grand-hall");

    expect(await screen.findByRole("heading", { level: 1, name: "Grand Hall" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Eight room experiences/i })).toBeTruthy();

    for (const room of publicRoomSelectionCards) {
      expect(document.body.textContent).toContain(room.name);
    }

    expect(screen.getByRole("link", { name: /Open The Grand Hall room preview/i }).getAttribute("href"))
      .toBe("/venues/trades-hall/rooms/grand-hall");
    expect(screen.getByRole("link", { name: /Open The North Gallery room preview/i }).getAttribute("href"))
      .toBe("/venues/trades-hall/rooms/north-gallery");
    expect(screen.getByRole("link", { name: /Enquire about Deacon Convener's Room/i }).getAttribute("href"))
      .toBe("/?room=deacon-convener-room#contact");
  });

  it("renders the runtime visual state through the client-safe visual payload", async () => {
    getPublicRoomRuntimeVisualMock.mockResolvedValueOnce(publicVisual({
      roomSlug: "grand-hall",
      runtimeVisualAvailable: true,
      visualUrl: "https://assets.example/rooms/grand-hall/scene.ply",
      visualLabel: "Runtime visual preview",
      safeCopy: "Runtime visual available for planning preview. Final details are confirmed by the venue team.",
      humanReviewRequired: true,
    }));

    mount("/venues/trades-hall/rooms/grand-hall");

    expect(await screen.findByTestId("public-runtime-canvas")).toBeTruthy();
    expect(document.body.textContent).toContain("Runtime visual available");
    expect(document.body.textContent).not.toContain("https://assets.example");
  });

  it("keeps client-facing copy free of unsafe claims", async () => {
    mount("/venues/trades-hall/rooms/south-gallery");

    await screen.findByRole("heading", { level: 1, name: "South Gallery" });
    const bodyText = document.body.textContent?.toLowerCase() ?? "";
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      expect(bodyText).not.toContain(claim);
    }
  });

  it("does not render internal asset identifiers or registry fields", async () => {
    getPublicRoomRuntimeVisualMock.mockResolvedValueOnce(publicVisual({
      roomSlug: "robert-adam-room",
      runtimeVisualAvailable: true,
      visualUrl: "https://assets.example/rooms/robert-adam-room/scene.ply",
      visualLabel: "Runtime visual preview",
      safeCopy: "Runtime visual available for planning preview. Final details are confirmed by the venue team.",
      humanReviewRequired: true,
    }));

    mount("/venues/trades-hall/rooms/robert-adam-room");

    await screen.findByRole("heading", { level: 1, name: "Robert Adam Room" });
    await screen.findByTestId("public-runtime-canvas");
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/primaryVisualAssetVersionId|manifestJson|r2Key|runtime_packages|asset-version/u);
  });

  it("tracks the structured public room events without an analytics provider", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    mount("/venues/trades-hall/rooms/reception-room");

    await screen.findByRole("heading", { level: 1, name: "Reception Room" });
    fireEvent.click(screen.getByRole("button", { name: /Ceremony/i }));
    fireEvent.click(screen.getByRole("link", { name: /Enquire about this room/i }), { metaKey: true });
    fireEvent.click(screen.getByRole("link", { name: /Request layout/i }), { metaKey: true });

    const eventNames: string[] = [];
    for (const [event] of dispatchSpy.mock.calls) {
      if (!(event instanceof CustomEvent)) continue;
      const detail: unknown = event.detail;
      if (typeof detail !== "object" || detail === null || !("name" in detail)) continue;
      const name = (detail as { readonly name?: unknown }).name;
      if (typeof name === "string") eventNames.push(name);
    }

    expect(eventNames).toContain("room_viewed");
    expect(eventNames).toContain("event_type_selected");
    expect(eventNames).toContain("request_layout_clicked");
    expect(eventNames).toContain("enquiry_clicked");
    dispatchSpy.mockRestore();
  });

  it("renders on a mobile-width viewport without dropping CTAs", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    window.dispatchEvent(new Event("resize"));

    mount("/venues/trades-hall/rooms/north-gallery");

    await screen.findByRole("heading", { level: 1, name: "North Gallery" });
    expect(screen.getByRole("link", { name: /Request layout/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Enquire about this room/i })).toBeTruthy();
  });
});
