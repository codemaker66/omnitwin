import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FloatingWidgetFrame } from "../FloatingWidgetFrame.js";

interface TransformPosition {
  readonly left: number;
  readonly top: number;
}

function transformPosition(element: HTMLElement): TransformPosition {
  const match = /translate3d\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px, 0\)/.exec(element.style.transform);
  if (match === null) throw new Error(`Unexpected transform: ${element.style.transform}`);
  return { left: Number(match[1]), top: Number(match[2]) };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("FloatingWidgetFrame", () => {
  it("minimizes and restores without unmounting widget content", () => {
    const { container } = render(
      <FloatingWidgetFrame
        id="test-overlay"
        title="Overlay controls"
        compactLabel="Overlays"
        defaultPlacement={{ type: "anchor", anchor: "top-left", offsetX: 16, offsetY: 20 }}
      >
        <p>Panel content</p>
      </FloatingWidgetFrame>,
    );

    const body = container.querySelector<HTMLElement>(".vv-floating-widget__body");
    expect(body?.hasAttribute("hidden")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Minimize Overlay controls" }));
    expect(body?.hasAttribute("hidden")).toBe(true);
    expect(screen.getByText("Overlays")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Expand Overlay controls" }));
    expect(body?.hasAttribute("hidden")).toBe(false);
  });

  it("supports keyboard repositioning and stores the preferred position", async () => {
    const { container } = render(
      <FloatingWidgetFrame
        id="keyboard-overlay"
        title="View status"
        compactLabel="3D"
        defaultPlacement={{ type: "anchor", anchor: "top-left", offsetX: 16, offsetY: 20 }}
      >
        <p>3D</p>
      </FloatingWidgetFrame>,
    );

    const root = container.querySelector<HTMLElement>("[data-floating-widget-id='keyboard-overlay']");
    if (root === null) throw new Error("Floating widget root was not rendered.");
    await waitFor(() => {
      expect(root.style.transform).toContain("16px");
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "Move View status" }), { key: "ArrowRight" });
    expect(root.style.transform).toContain("24px");

    const stored = window.localStorage.getItem("venviewer:floating-widget:keyboard-overlay:v2");
    expect(stored).not.toBeNull();
    expect(stored).toContain("\"left\":24");
  });

  it("restores a preferred compact position and can reset to the default placement", async () => {
    window.localStorage.setItem("venviewer:floating-widget:persisted-overlay:v2", JSON.stringify({
      left: 88,
      top: 96,
      minimized: true,
    }));

    const { container } = render(
      <FloatingWidgetFrame
        id="persisted-overlay"
        title="Route clearance"
        compactLabel="1.20 m"
        defaultPlacement={{ type: "anchor", anchor: "top-left", offsetX: 16, offsetY: 20 }}
      >
        <p>Clearance body</p>
      </FloatingWidgetFrame>,
    );

    const root = container.querySelector<HTMLElement>("[data-floating-widget-id='persisted-overlay']");
    if (root === null) throw new Error("Floating widget root was not rendered.");

    await waitFor(() => {
      expect(root.style.transform).toContain("88px");
      expect(root.getAttribute("data-minimized")).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset Route clearance position" }));

    await waitFor(() => {
      expect(root.style.transform).toContain("16px");
      expect(root.style.transform).toContain("20px");
    });
  });

  it("keeps scoped preferred positions independent", async () => {
    window.localStorage.setItem("venviewer:floating-widget:scoped-overlay:desktop:v2", JSON.stringify({
      left: 120,
      top: 140,
      minimized: false,
    }));
    window.localStorage.setItem("venviewer:floating-widget:scoped-overlay:mobile:v2", JSON.stringify({
      left: 24,
      top: 32,
      minimized: true,
    }));

    const { container, rerender } = render(
      <FloatingWidgetFrame
        id="scoped-overlay"
        title="Visual layer"
        compactLabel="Splat"
        storageScope="desktop"
        defaultPlacement={{ type: "anchor", anchor: "top-left", offsetX: 16, offsetY: 20 }}
      >
        <p>Desktop body</p>
      </FloatingWidgetFrame>,
    );

    const root = container.querySelector<HTMLElement>("[data-floating-widget-id='scoped-overlay']");
    if (root === null) throw new Error("Floating widget root was not rendered.");

    await waitFor(() => {
      expect(root.style.transform).toContain("120px");
      expect(root.getAttribute("data-minimized")).toBe("false");
    });

    rerender(
      <FloatingWidgetFrame
        id="scoped-overlay"
        title="Visual layer"
        compactLabel="Splat"
        storageScope="mobile"
        defaultPlacement={{ type: "anchor", anchor: "top-left", offsetX: 16, offsetY: 20 }}
      >
        <p>Mobile body</p>
      </FloatingWidgetFrame>,
    );

    await waitFor(() => {
      expect(root.style.transform).toContain("24px");
      expect(root.style.transform).toContain("32px");
      expect(root.getAttribute("data-minimized")).toBe("true");
    });
  });

  it("moves an overlapping default position away from declared avoid zones", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function getBoundingClientRect(this: HTMLElement): DOMRect {
        if (this.dataset["testid"] === "floating-surface") {
          return new DOMRect(0, 0, 520, 320);
        }
        if (this.dataset["testid"] === "reserved-zone") {
          return new DOMRect(84, 96, 190, 122);
        }
        if (this.dataset["floatingWidgetId"] === "avoid-overlay") {
          return new DOMRect(0, 0, 190, 122);
        }
        return new DOMRect(0, 0, 0, 0);
      },
    });

    try {
      const { container } = render(
        <div data-testid="floating-surface">
          <div data-testid="reserved-zone">Reserved dashboard lane</div>
          <FloatingWidgetFrame
            id="avoid-overlay"
            title="Plan view"
            defaultPlacement={{ type: "anchor", anchor: "top-left", offsetX: 84, offsetY: 96 }}
            avoidSelectors={["[data-testid='reserved-zone']"]}
            avoidPaddingPx={10}
          >
            <p>Plan overview</p>
          </FloatingWidgetFrame>
        </div>,
      );

      const root = container.querySelector<HTMLElement>("[data-floating-widget-id='avoid-overlay']");
      if (root === null) throw new Error("Floating widget root was not rendered.");

      await waitFor(() => {
        const position = transformPosition(root);
        expect(position.left).toBeGreaterThanOrEqual(292);
        expect(position.top).toBe(96);
      });

      const stored = window.localStorage.getItem("venviewer:floating-widget:avoid-overlay:v2");
      expect(stored).not.toBeNull();
      expect(stored).toContain("\"left\":292");
    } finally {
      if (originalDescriptor !== undefined) {
        Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", originalDescriptor);
      }
    }
  });
});
