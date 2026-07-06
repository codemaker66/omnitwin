import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createRef } from "react";
import { TwinViewerControls } from "../TwinViewerControls.js";

// -----------------------------------------------------------------------------
// TwinViewerControls — the enquire / share / fullscreen rail.
//
// Renders under happy-dom (plain DOM). We pin the contract that matters: the
// enquire link points into the real planner funnel; share falls back to the
// clipboard and announces "Link copied" in the live region; and fullscreen is
// only offered where the browser actually supports it.
// -----------------------------------------------------------------------------

function renderControls(): void {
  const ref = createRef<HTMLDivElement>();
  render(
    <MemoryRouter>
      <TwinViewerControls
        venueSlug="trades-hall"
        venueName="Trades Hall Glasgow"
        viewerRef={ref}
      />
    </MemoryRouter>,
  );
}

describe("TwinViewerControls", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // No native share sheet → the share button must fall back to the clipboard.
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("points Enquire into the venue's real planner funnel", () => {
    renderControls();
    const link = screen.getByRole("link", { name: /enquire about hosting/i });
    expect(link.getAttribute("href")).toBe("/v/trades-hall/plan?enquire=1");
  });

  it("copies the link and announces it politely on share", async () => {
    renderControls();
    fireEvent.click(
      screen.getByLabelText("Copy link to this walkthrough"),
    );
    expect(await screen.findByText("Link copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it("hides the fullscreen toggle where the API is unavailable", () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      value: false,
      configurable: true,
    });
    renderControls();
    expect(screen.queryByLabelText("Enter full screen")).toBeNull();
  });

  it("offers fullscreen where the API is supported", () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      value: true,
      configurable: true,
    });
    renderControls();
    expect(screen.getByLabelText("Enter full screen")).toBeTruthy();
  });
});
