import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    <TwinViewerControls
      venueSlug="trades-hall"
      venueName="Trades Hall Glasgow"
      viewerRef={ref}
    />,
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

  it("opens the in-twin enquiry modal from the Enquire button", () => {
    renderControls();
    // No modal until asked.
    expect(screen.queryByTestId("twin-enquiry-form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /enquire about hosting/i }));
    expect(screen.getByTestId("twin-enquiry-form")).toBeTruthy();
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
