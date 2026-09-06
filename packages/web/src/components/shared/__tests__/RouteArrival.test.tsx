import { lazy, Suspense, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { RouteArrival } from "../RouteArrival.js";

afterEach(cleanup);

describe("route arrival", () => {
  it.each(["/plan?space=grand-hall", "/plan/saved-id?space=grand-hall", "/room/grand-hall"])(
    "uses the existing venue image only for an explicitly identified Grand Hall: %s", (route) => {
      const { container } = render(<MemoryRouter initialEntries={[route]}><RouteArrival /></MemoryRouter>);
      expect(container.querySelector("img")?.getAttribute("src")).toContain("grand-hall-room-1120.webp");
      expect(screen.getByText("Venue photograph · event styling for inspiration")).toBeTruthy();
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(container.querySelector('[data-activity-indicator="particles"]')).not.toBeNull();
    },
  );

  it.each(["/plan/saved-id", "/plan?space=saloon", "/diary?space=grand-hall", "/room/reception-room"])(
    "does not infer a Grand Hall identity from another or unknown room: %s", (route) => {
      const { container } = render(<MemoryRouter initialEntries={[route]}><RouteArrival /></MemoryRouter>);
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByRole("status").textContent).toContain("Opening your workspace");
    },
  );

  it("retains work status and an escape route if the optional image fails", () => {
    const { container } = render(<MemoryRouter initialEntries={["/plan?space=grand-hall"]}><RouteArrival /></MemoryRouter>);
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    if (image !== null) fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("Venue photograph · event styling for inspiration")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Opening your room");
    expect(screen.getByRole("link", { name: /Back to venue/ }).getAttribute("href")).toBe("/");
  });

  it("leaves as soon as the pending route resolves without waiting for its image or a timer", async () => {
    let finish: ((value: { default: ComponentType }) => void) | undefined;
    const Ready = lazy(() => new Promise<{ default: ComponentType }>((resolve) => { finish = resolve; }));
    const { container } = render(
      <MemoryRouter initialEntries={["/plan?space=grand-hall"]}>
        <Suspense fallback={<RouteArrival />}><Ready /></Suspense>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toBeTruthy();
    await act(async () => {
      finish?.({ default: () => <h1>Saved room ready</h1> });
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Saved room ready" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector('[data-activity-indicator="particles"]')).toBeNull();
  });
});
