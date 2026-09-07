import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DemoShowcasePage } from "./DemoShowcasePage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function expectChapter(name: string): void {
  expect(screen.getByRole("button", { name }).getAttribute("aria-current")).toBe("step");
}

describe("Elaine's display-only showcase", () => {
  it("navigates by controls and keyboard without leaving the first or last chapter", () => {
    render(<DemoShowcasePage />);
    expectChapter("Chapter 1: The welcome");
    expect(screen.getByRole("button", { name: "Previous chapter" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expectChapter("Chapter 1: The welcome");

    fireEvent.click(screen.getByRole("button", { name: "Begin showcase" }));
    expectChapter("Chapter 2: The place");
    fireEvent.click(screen.getByRole("button", { name: "Next chapter" }));
    expectChapter("Chapter 3: The possibilities");
    fireEvent.keyDown(document, { key: "PageUp" });
    expectChapter("Chapter 2: The place");
    fireEvent.keyDown(document, { key: "End" });
    expectChapter("Chapter 8: Built around you");
    expect(screen.getByRole("button", { name: "Next chapter" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expectChapter("Chapter 8: Built around you");
    fireEvent.keyDown(document, { key: "Home" });
    expectChapter("Chapter 1: The welcome");
  });

  it("changes only the illustrative arrangement without requests or stored venue changes", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<DemoShowcasePage />);
    fireEvent.click(screen.getByRole("button", { name: "Chapter 3: The possibilities" }));

    for (const layout of ["Conference", "Reception", "Dinner"]) {
      fireEvent.click(screen.getByRole("button", { name: layout }));
      expect(screen.getByRole("button", { name: layout }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("img", { name: `Illustrative ${layout.toLowerCase()} arrangement, not a measured or approved room plan` })).toBeTruthy();
      expectChapter("Chapter 3: The possibilities");
    }

    fireEvent.click(screen.getByRole("button", { name: "Conference" }));
    fireEvent.click(screen.getByRole("button", { name: "Chapter 6: The handover" }));
    expect(screen.getByRole("img", { name: "Illustrative dinner arrangement, not a measured or approved room plan" })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("identifies the conversational example as a future scripted experience", () => {
    render(<DemoShowcasePage />);
    fireEvent.click(screen.getByRole("button", { name: "Chapter 5: A helping hand" }));
    expect(screen.getByText("PRODUCT VISION / SCRIPTED EXAMPLE")).toBeTruthy();
    expect(screen.getByText("A future Venviewer experience")).toBeTruthy();
    expect(screen.getByText("VENUE REVIEW BEFORE ANY CHANGE")).toBeTruthy();
    expect(screen.getByText("Illustration only. No live AI request or booking action.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps both printable floor plans' SVG definitions unique and locally referenced", () => {
    const { container } = render(<DemoShowcasePage />);
    const plans = [...container.querySelectorAll("svg.demo-floorplan")];
    expect(plans).toHaveLength(2);
    const allIds = [...container.querySelectorAll("[id]")].map(element => element.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const plan of plans) {
      const ownIds = new Set([...plan.querySelectorAll("[id]")].map(element => element.id));
      for (const element of plan.querySelectorAll("[fill], [filter]")) {
        for (const attribute of ["fill", "filter"]) {
          const match = /^url\(#(.+)\)$/.exec(element.getAttribute(attribute) ?? "");
          if (match) expect(ownIds.has(match[1] ?? "")).toBe(true);
        }
      }
    }
  });

  it("offers the same downloadable PDF from the header and the closing chapter", () => {
    render(<DemoShowcasePage />);
    const headerLink = screen.getByRole("link", { name: "PDF deck" });
    expect(headerLink.getAttribute("href")).toBe("/demo/venviewer-elaine-showcase.pdf");
    expect(headerLink.hasAttribute("download")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Chapter 8: Built around you" }));
    const closingLink = screen.getByRole("link", { name: "Keep the presentation" });
    expect(closingLink.getAttribute("href")).toBe(headerLink.getAttribute("href"));
    expect(closingLink.hasAttribute("download")).toBe(true);
  });
});
