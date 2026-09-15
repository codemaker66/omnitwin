import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ---------------------------------------------------------------------------
// The public dead end (goal 18 §2 line 26)
//
// /pricing used to end in "Start your 14-day free trial", a promise nothing in
// the product could keep: there is no billing, no /api/billing/checkout and no
// self-serve onboarding. The page now asks for the conversation it can
// actually have, and that ask reaches the same public enquiry route the
// venue's own guest form uses.
// ---------------------------------------------------------------------------

const { submitGuestEnquiry } = vi.hoisted(() => ({
  submitGuestEnquiry: vi.fn<(input: unknown) => Promise<unknown>>(),
}));
vi.mock("../api/configurations.js", () => ({ submitGuestEnquiry }));

const { PricingPage } = await import("../pages/PricingPage.js");

function show(): void {
  render(<MemoryRouter initialEntries={["/pricing"]}><PricingPage /></MemoryRouter>);
}

beforeEach(() => { submitGuestEnquiry.mockReset(); });
afterEach(() => { cleanup(); });

describe("PricingPage", () => {
  it("promises no trial anywhere on the page", () => {
    show();
    expect(screen.queryByText(/free trial/i)).toBeNull();
    expect(screen.queryByText(/14 days free/i)).toBeNull();
    expect(screen.queryByText(/No credit card/i)).toBeNull();
    // And nothing points at the registration path that stood in for billing.
    for (const link of Array.from(document.querySelectorAll("a[href]"))) {
      expect(link.getAttribute("href")).not.toContain("/register?tier=");
    }
  });

  it("keeps the surfaces the public route is identified by", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Pricing" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Billing cycle" })).toBeDefined();
  });

  it("sends the enquiry to the public route and confirms it", async () => {
    submitGuestEnquiry.mockResolvedValueOnce({ id: "enq-1" });
    show();
    fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "venue@example.test" } });
    fireEvent.change(screen.getByLabelText("Which rooms do you let? (optional)"),
      { target: { value: "We let the Grand Hall and the Saloon." } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send enquiry" })); await Promise.resolve(); });

    expect(submitGuestEnquiry).toHaveBeenCalledWith({
      venueSlug: "trades-hall-glasgow",
      email: "venue@example.test",
      eventType: "venue-enquiry",
      message: "We let the Grand Hall and the Saloon.",
    });
    expect((await screen.findByText(/Thank you/)).textContent).toContain("venue@example.test");
  });

  it("keeps a failed enquiry retryable rather than silently dropping it", async () => {
    submitGuestEnquiry.mockRejectedValueOnce(new Error("network"));
    show();
    fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "venue@example.test" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send enquiry" })); await Promise.resolve(); });

    expect((await screen.findByText(/did not send/)).textContent).toContain("Please try again");
    expect(screen.getByRole("button", { name: "Send enquiry" })).toBeDefined();
  });
});
