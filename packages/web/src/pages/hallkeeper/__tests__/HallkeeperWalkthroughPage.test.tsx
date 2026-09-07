import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { HallkeeperWalkthroughPage } from "../HallkeeperWalkthroughPage.js";

vi.mock("../../../components/dashboard/DashboardLayout.js", () => ({
  DashboardLayout: ({ children }: { readonly children: ReactNode }) => <main>{children}</main>,
}));

afterEach(cleanup);

describe("Hallkeeper walkthrough boundary", () => {
  it("identifies the demonstration and isolates its scripts from live data and navigation", () => {
    render(<MemoryRouter><HallkeeperWalkthroughPage /></MemoryRouter>);
    expect(screen.getByText(/Fictional demonstration/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open live Day Board" }).getAttribute("href")).toBe("/hallkeeper/today");
    const frame = screen.getByTitle("Interactive fictional hallkeeper day, including setup, client care and handover");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("connect-src 'none'");
    expect(frame.getAttribute("srcdoc")).toContain("No live venue data");
    fireEvent.click(screen.getByRole("button", { name: "Restart walkthrough" }));
    expect(screen.getByTitle("Interactive fictional hallkeeper day, including setup, client care and handover")).not.toBe(frame);
  });
});
