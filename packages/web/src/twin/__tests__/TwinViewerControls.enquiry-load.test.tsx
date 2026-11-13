import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

// -----------------------------------------------------------------------------
// The enquiry form loads only when asked for (the walkable twin's byte budget,
// e2e/twin-performance). If that load fails, the visitor hears why and can
// press Enquire again; the twin itself carries on.
// -----------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.doUnmock("../TwinEnquiryModal.js");
  vi.resetModules();
});

async function renderControls(): Promise<void> {
  const { TwinViewerControls } = await import("../TwinViewerControls.js");
  render(<TwinViewerControls venueName="Trades Hall Glasgow" viewerRef={createRef<HTMLDivElement>()} />);
}

describe("the Enquire button when the form cannot load", () => {
  it("announces the failure and lets the visitor try again", async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock("../TwinEnquiryModal.js", () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return { TwinEnquiryModal: () => <form data-testid="twin-enquiry-form" /> };
    });
    await renderControls();
    const enquire = screen.getByRole("button", { name: /enquire about hosting/i });

    fireEvent.click(enquire);
    expect(await screen.findByText(/the enquiry form didn.t load/i)).toBeTruthy();
    expect(screen.queryByTestId("twin-enquiry-form")).toBeNull();
    expect(enquire.getAttribute("aria-busy")).not.toBe("true");

    fireEvent.click(enquire);
    expect(await screen.findByTestId("twin-enquiry-form")).toBeTruthy();
  });
});
