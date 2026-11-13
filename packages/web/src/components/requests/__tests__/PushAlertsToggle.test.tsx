import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PushAlertsToggle } from "../PushAlertsToggle.js";

const mocks = vi.hoisted(() => ({
  readPushAlertsState: vi.fn(),
  subscribeThisDevice: vi.fn(),
  unsubscribeThisDevice: vi.fn(),
}));

vi.mock("../../../lib/push-alerts.js", () => ({
  readPushAlertsState: mocks.readPushAlertsState,
  subscribeThisDevice: mocks.subscribeThisDevice,
  unsubscribeThisDevice: mocks.unsubscribeThisDevice,
}));

const VENUE = "00000000-0000-4000-8000-000000008001";

beforeEach(() => {
  mocks.readPushAlertsState.mockReset();
  mocks.subscribeThisDevice.mockReset();
  mocks.unsubscribeThisDevice.mockReset();
});

afterEach(() => { cleanup(); });

describe("PushAlertsToggle", () => {
  it("offers the switch when off, turns on with one press, and offers Turn off once on", async () => {
    mocks.readPushAlertsState.mockResolvedValue("off");
    mocks.subscribeThisDevice.mockResolvedValue("on");
    mocks.unsubscribeThisDevice.mockResolvedValue("off");
    render(<PushAlertsToggle venueId={VENUE} deviceKind="phone" />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn on alerts on this device" }));
    await waitFor(() => { expect(mocks.subscribeThisDevice).toHaveBeenCalledWith(VENUE, "phone"); });
    expect((await screen.findByRole("status")).textContent).toContain("Alerts on this device: on");

    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(await screen.findByRole("button", { name: "Turn on alerts on this device" })).toBeTruthy();
  });

  it("says in plain words when the browser cannot, the person refused, or the server has no key", async () => {
    mocks.readPushAlertsState.mockResolvedValue("unsupported");
    const first = render(<PushAlertsToggle venueId={VENUE} deviceKind="desk" />);
    expect(await screen.findByText(/add Venviewer to the Home Screen/u)).toBeTruthy();
    first.unmount();

    mocks.readPushAlertsState.mockResolvedValue("denied");
    const second = render(<PushAlertsToggle venueId={VENUE} deviceKind="desk" />);
    expect(await screen.findByText(/blocked for this site/u)).toBeTruthy();
    second.unmount();

    mocks.readPushAlertsState.mockResolvedValue("off");
    mocks.subscribeThisDevice.mockResolvedValue("off-server");
    render(<PushAlertsToggle venueId={VENUE} deviceKind="desk" />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on alerts on this device" }));
    expect(await screen.findByText("Alerts are not switched on for this venue yet.")).toBeTruthy();
  });

  it("keeps the switch and says what failed when the press fails", async () => {
    mocks.readPushAlertsState.mockResolvedValue("off");
    mocks.subscribeThisDevice.mockRejectedValue(new Error("The browser gave no usable subscription"));
    render(<PushAlertsToggle venueId={VENUE} deviceKind="desk" />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on alerts on this device" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The browser gave no usable subscription");
    expect(screen.getByRole("button", { name: "Turn on alerts on this device" })).toBeTruthy();
  });
});
