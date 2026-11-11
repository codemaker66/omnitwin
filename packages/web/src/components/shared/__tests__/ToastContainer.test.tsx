import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastContainer } from "../ToastContainer.js";
import { useToastStore } from "../../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// Release audit, a11y-5. The notifications' live region was created together
// with its first message, which screen readers commonly do not announce, so
// "Venue settings saved" was never heard. And every notification, errors
// included, went after four seconds whatever the reader was doing.
// ---------------------------------------------------------------------------

function region(): HTMLElement {
  return screen.getByRole("status", { name: "Notifications" });
}

function say(message: string, type: "success" | "error" | "info" = "success"): void {
  act(() => { useToastStore.getState().addToast(message, type); });
}

function pass(ms: number): void {
  act(() => { vi.advanceTimersByTime(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.getState().releaseToasts();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastContainer", () => {
  it("has its live region on the page before any notification, so the first is announced", () => {
    render(<ToastContainer />);
    const before = region();
    expect(before.getAttribute("aria-live")).toBe("polite");
    expect(before.textContent).toBe("");

    say("Venue settings saved");
    // The same element, now holding the message: it was not created with its text.
    expect(region()).toBe(before);
    expect(before.textContent).toContain("Venue settings saved");
  });

  it("keeps the region when the last notification goes", () => {
    render(<ToastContainer />);
    const before = region();
    say("Venue settings saved");
    pass(4000);
    expect(region()).toBe(before);
    expect(before.textContent).toBe("");
  });

  it("keeps a notification while the pointer rests on it, then gives it its full time again", () => {
    render(<ToastContainer />);
    say("The status could not be changed", "error");
    pass(3000);

    fireEvent.mouseEnter(region());
    pass(60_000);
    expect(region().textContent).toContain("could not be changed");

    fireEvent.mouseLeave(region());
    pass(3999);
    expect(region().textContent).toContain("could not be changed");
    pass(1);
    expect(region().textContent).toBe("");
  });

  it("keeps it while the keyboard is inside it, whatever the pointer does", () => {
    render(<ToastContainer />);
    say("The status could not be changed", "error");
    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });

    fireEvent.mouseEnter(region());
    fireEvent.focus(dismiss);
    fireEvent.mouseLeave(region());
    pass(60_000);
    expect(region().textContent).toContain("could not be changed");

    // Focus leaves the notifications altogether.
    fireEvent.blur(dismiss, { relatedTarget: document.body });
    pass(4000);
    expect(region().textContent).toBe("");
  });

  it("keeps a notification that arrives while one is being read, and starts its clock when the reader moves on", () => {
    render(<ToastContainer />);
    say("Enquiry declined", "info");
    fireEvent.mouseEnter(region());
    say("Opportunity created. It is in the pipeline.");
    pass(60_000);
    expect(region().textContent).toContain("Opportunity created");

    fireEvent.mouseLeave(region());
    pass(4000);
    expect(region().textContent).toBe("");
  });

  it("still lets a notification be dismissed by hand, and still marks an error as an alert", () => {
    render(<ToastContainer />);
    say("The status could not be changed", "error");
    expect(screen.getByRole("alert").textContent).toContain("could not be changed");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(region().textContent).toBe("");
  });
});
