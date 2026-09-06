import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityIndicator, ActivityStatus } from "../Activity.js";

afterEach(cleanup);

describe("shared activity feedback", () => {
  it("announces the actual work once and hides decorative particles", () => {
    const { container } = render(<ActivityStatus>Saving the layout…</ActivityStatus>);
    expect(screen.getByRole("status").textContent).toBe("Saving the layout…");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(20);
  });

  it("reports measured progress and never invents a percentage", () => {
    const { rerender } = render(<ActivityStatus>Opening the room…</ActivityStatus>);
    expect(screen.queryByRole("progressbar")).toBeNull();
    rerender(<ActivityStatus progress={37}>Uploading photograph…</ActivityStatus>);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("37");
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("Uploading photograph…");
    rerender(<ActivityStatus progress={Number.NaN}>Opening the room…</ActivityStatus>);
    expect(screen.queryByRole("progressbar")).toBeNull();
    rerender(<ActivityStatus progress={Infinity}>Opening the room…</ActivityStatus>);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("bounds measured progress and removes all motion when work ends", () => {
    const { rerender, container } = render(<ActivityStatus progress={-9}>Uploading…</ActivityStatus>);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    rerender(<ActivityStatus progress={108}>Uploading…</ActivityStatus>);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    rerender(<span>Saved</span>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("fits an inline button without changing its accessible name", () => {
    const { container } = render(<button disabled aria-busy="true"><ActivityIndicator size={16} />Saving…</button>);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("16");
    expect(container.querySelectorAll("circle")).toHaveLength(28);
    expect(container.querySelector("circle")?.getAttribute("r")).toBe("1.8");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
