import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmissingBookRedirect } from "../pages/AmissingBookRedirect.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("legacy Craft quiz entry points", () => {
  it("opens the standalone document and supplies an accessible fallback link", () => {
    const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
    render(<AmissingBookRedirect />);
    expect(replace).toHaveBeenCalledWith("/amissing-book/");
    expect(screen.getByRole("status").textContent).toContain("Opening The Amissing Book");
    expect(screen.getByRole("link", { name: "Play the game" }).getAttribute("href")).toBe("/amissing-book/");
  });

  it("redirects every existing quiz URL at the edge before the SPA fallback", () => {
    const config = JSON.parse(readFileSync(join(import.meta.dirname, "../../vercel.json"), "utf8")) as {
      redirects: { source: string; destination: string; permanent: boolean }[];
      rewrites: { source: string; destination: string }[];
    };
    for (const source of ["/quiz", "/quiz/", "/trades-house/discover-your-craft", "/trades-house/discover-your-craft/"]) {
      expect(config.redirects.find((rule) => rule.source === source)).toEqual({
        source, destination: "/amissing-book/", permanent: false,
      });
    }
    expect(config.rewrites.slice(0, 2)).toEqual([
      { source: "/amissing-book", destination: "/amissing-book/index.html" },
      { source: "/amissing-book/", destination: "/amissing-book/index.html" },
    ]);
  });
});
