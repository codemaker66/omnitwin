import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TruthModeIndicator } from "../TruthModeIndicator.js";
import {
  buildProceduralTruthSummary,
  buildPlannerTruthSummary,
  formatConfidenceTier,
  isTruthModeUiEnabled,
} from "../../../lib/truth-mode-summary.js";

afterEach(() => {
  cleanup();
});

function renderProceduralIndicator(): void {
  render(
    <TruthModeIndicator
      summary={buildProceduralTruthSummary({
        surface: "planner_3d",
        placedObjectCount: 3,
        measuredRuntimeAssetsLoaded: false,
      })}
    />,
  );
}

describe("TruthModeIndicator", () => {
  it("shows staged capture provenance without a procedural-venue claim or a measured-runtime promotion", () => {
    const summary = buildPlannerTruthSummary({
      surface: "planner_3d", placedObjectCount: 162, configId: "demo", spaceId: "hall", layerMode: "splat",
      sceneSource: { configId: "demo", spaceId: "hall", layerMode: "splat", captureSource: "staged", loadedChunks: 12, totalChunks: 12, proceduralGeometryVisible: false },
    });
    render(<TruthModeIndicator summary={summary} embedded />);
    expect(screen.getByText(/Staged capture · unverified/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(screen.getByText(/Staged capture-derived room imagery is displayed/)).toBeTruthy();
    expect(screen.queryByText(/procedural placeholder venue geometry/)).toBeNull();
    expect(screen.queryByText(/Current venue visuals come from procedural/)).toBeNull();
    expect(screen.getByText(/No signed measured RuntimeVenueManifest/)).toBeTruthy();
    expect(screen.getByText(/Capture-to-plan alignment and measurement accuracy are not established/)).toBeTruthy();
  });

  it("embeds a compact provenance disclosure while retaining every evidence section and honest runtime state", () => {
    const summary = buildProceduralTruthSummary({ surface: "planner_3d", placedObjectCount: 162, measuredRuntimeAssetsLoaded: false });
    const { container } = render(<TruthModeIndicator summary={summary} embedded />);
    expect(screen.getByText("Planning provenance")).toBeTruthy();
    expect(screen.getByTestId("truth-mode-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-floating-widget-id]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Move Truth Mode" })).toBeNull();
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(screen.getByRole("dialog", { name: "Truth Mode summary" })).toBeTruthy();
    for (const label of ["Source / evidence", "Verification", "Confidence", "Freshness", "Known issues", "Next action"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(summary.evidenceSummary)).toBeTruthy();
    expect(screen.getByText(summary.verificationSummary)).toBeTruthy();
    for (const issue of summary.knownIssues) expect(screen.getByText(issue.message)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Truth Mode summary" })).toBeNull();
  });

  it("renders the persistent L1 indicator", () => {
    renderProceduralIndicator();
    expect(screen.getByTestId("truth-mode-indicator")).toBeTruthy();
    expect(screen.getByText("Truth Mode L1")).toBeTruthy();
    expect(screen.getByText(/3D planning: Procedural preview/)).toBeTruthy();
    expect(screen.getByText("Procedural")).toBeTruthy();
    expect(screen.getByText("Runtime not loaded")).toBeTruthy();
    expect(screen.getByTestId("truth-mode-status-line").getAttribute("aria-label")).toBe(
      "Procedural content present, Measured runtime not loaded, 3 known issues",
    );
  });

  it("opens and closes the L2 popover", () => {
    renderProceduralIndicator();
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(screen.getByRole("dialog", { name: /Truth Mode summary/i })).toBeTruthy();
    expect(screen.getByText("Truth Mode L2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Close Truth Mode summary/i }));
    expect(screen.queryByRole("dialog", { name: /Truth Mode summary/i })).toBeNull();
  });

  it("closes the L2 summary with Escape", () => {
    renderProceduralIndicator();
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(screen.getByRole("dialog", { name: /Truth Mode summary/i })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /Truth Mode summary/i })).toBeNull();
  });

  it("labels generated/procedural scenes honestly", () => {
    renderProceduralIndicator();
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(screen.getAllByText(/procedural runtime/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/procedural placeholder venue geometry/i)).toBeTruthy();
    expect(screen.getByText(/No signed measured RuntimeVenueManifest asset/i)).toBeTruthy();
  });

  it("does not show a verified status without verification data", () => {
    const { container } = render(
      <TruthModeIndicator
        summary={buildProceduralTruthSummary({
          surface: "spark_fixture",
          placedObjectCount: 0,
          measuredRuntimeAssetsLoaded: false,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(container.textContent).not.toMatch(/\bVerified\b/);
    expect(container.textContent).toContain("No review record or signed QA certificate is loaded");
  });

  it("does not use strong survey-grade public wording for confidence labels", () => {
    expect(formatConfidenceTier("survey_grade")).toBe("Survey evidence tier");
  });

  it("uses the movable floating-widget shell", () => {
    renderProceduralIndicator();
    const root = screen.getByTestId("truth-mode-indicator");
    expect(root.getAttribute("data-floating-widget-id")).toBe("truth-mode-indicator");
    expect(root.className).toContain("vv-floating-widget");
    expect(screen.getByRole("button", { name: /Move Truth Mode/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Minimize Truth Mode/i })).toBeTruthy();
  });

  it("keeps the narrow mobile Truth widget clear of the generated-proxy disclosure", async () => {
    const storageKey = "venviewer:floating-widget:truth-mode-indicator:planner-truth-mode-v1:v2";
    window.localStorage.removeItem(storageKey);
    const originalRectDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );
    const originalWidthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const originalHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function getBoundingClientRect(this: HTMLElement): DOMRect {
        if (this.dataset["testid"] === "generated-furniture-proxy-badge") {
          return new DOMRect(12, 82, 220, 87);
        }
        if (this.dataset["floatingWidgetId"] === "truth-mode-indicator") {
          return new DOMRect(0, 0, 342, this.classList.contains("is-minimized") ? 40 : 109);
        }
        return new DOMRect(0, 0, 0, 0);
      },
    });

    try {
      render(
        <>
          <p data-testid="generated-furniture-proxy-badge">
            AI-generated furniture proxies · visual stand-ins · not measured
          </p>
          <TruthModeIndicator
            summary={buildProceduralTruthSummary({
              surface: "planner_3d",
              placedObjectCount: 3,
              measuredRuntimeAssetsLoaded: false,
            })}
          />
        </>,
      );

      const root = screen.getByTestId("truth-mode-indicator");
      const topFromTransform = (): number => {
        const match = root.style.transform.match(/translate3d\([^,]+,\s*([\d.-]+)px,/);
        return match === null ? Number.NaN : Number(match[1]);
      };

      await waitFor(() => {
        expect(topFromTransform()).toBeGreaterThanOrEqual(181);
      });

      fireEvent.click(screen.getByRole("button", { name: /Minimize Truth Mode/i }));
      await waitFor(() => {
        expect(topFromTransform()).toBeGreaterThanOrEqual(181);
      });
    } finally {
      window.localStorage.removeItem(storageKey);
      if (originalRectDescriptor !== undefined) {
        Object.defineProperty(
          HTMLElement.prototype,
          "getBoundingClientRect",
          originalRectDescriptor,
        );
      }
      if (originalWidthDescriptor !== undefined) {
        Object.defineProperty(window, "innerWidth", originalWidthDescriptor);
      }
      if (originalHeightDescriptor !== undefined) {
        Object.defineProperty(window, "innerHeight", originalHeightDescriptor);
      }
    }
  });

  it("does not render disabled fake drawer actions", () => {
    renderProceduralIndicator();
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(screen.queryByRole("button", { name: /Provenance drawer unavailable/i })).toBeNull();
    expect(screen.getByText(/Open the Evidence lens/i)).toBeTruthy();
  });

  it.each(["default", "stored"] as const)("keeps %s desktop placement clear of the live blueprint guest controls", async (placement) => {
    const storageKey = "venviewer:floating-widget:truth-mode-indicator:planner-truth-mode-v1:v2";
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
    const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    window.localStorage.removeItem(storageKey);
    if (placement === "stored") {
      window.localStorage.setItem(storageKey, JSON.stringify({ left: 192, top: 245, minimized: false }));
    }
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function getBoundingClientRect(this: HTMLElement): DOMRect {
        if (this.classList.contains("bp-left")) return new DOMRect(0, 36, 260, 902);
        if (this.classList.contains("bp-right")) return new DOMRect(1340, 36, 260, 902);
        if (this.classList.contains("bp-chrome")) return new DOMRect(0, 0, 1600, 36);
        if (this.classList.contains("bp-status-bar")) return new DOMRect(0, 938, 1600, 62);
        if (this.dataset["floatingWidgetId"] === "truth-mode-indicator") {
          return new DOMRect(0, 0, 342, 109);
        }
        return new DOMRect(0, 0, 0, 0);
      },
    });
    try {
      render(
        <>
          <div className="bp-chrome">Grand Hall</div>
          <aside className="bp-left"><button type="button">Increase guest count</button></aside>
          <aside className="bp-right">Selected table</aside>
          <div className="bp-status-bar">Seats placed 144</div>
          <TruthModeIndicator summary={buildProceduralTruthSummary({ surface: "planner_2d", placedObjectCount: 162, measuredRuntimeAssetsLoaded: false })} />
        </>,
      );
      await waitFor(() => {
        const transform = screen.getByTestId("truth-mode-indicator").style.transform;
        const match = transform.match(/translate3d\(([\d.-]+)px,\s*([\d.-]+)px,/);
        expect(match).not.toBeNull();
        const left = Number(match?.[1]);
        const top = Number(match?.[2]);
        expect(left).toBeGreaterThanOrEqual(272);
        expect(left + 342).toBeLessThanOrEqual(1328);
        expect(top).toBeGreaterThanOrEqual(48);
        expect(top + 109).toBeLessThanOrEqual(926);
      });
    } finally {
      cleanup();
      window.localStorage.removeItem(storageKey);
      if (originalRect !== undefined) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", originalRect);
      if (originalWidth !== undefined) Object.defineProperty(window, "innerWidth", originalWidth);
      if (originalHeight !== undefined) Object.defineProperty(window, "innerHeight", originalHeight);
    }
  });

  it("is gated in production unless the query param is present", () => {
    expect(isTruthModeUiEnabled(new URLSearchParams(), false)).toBe(false);
    expect(isTruthModeUiEnabled(new URLSearchParams("truth=1"), false)).toBe(true);
    expect(isTruthModeUiEnabled(new URLSearchParams("truthMode=true"), false)).toBe(true);
    expect(isTruthModeUiEnabled(new URLSearchParams(), true)).toBe(true);
  });
});
