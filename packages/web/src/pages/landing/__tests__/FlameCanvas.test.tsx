import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlameCanvas } from "../FlameCanvas.js";
import type { PointerMotion } from "../useCursorLight.js";

describe("FlameCanvas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hides the procedural canvas when WebGL is unavailable", async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => null);
    const pointerMotion: MutableRefObject<PointerMotion> = { current: { speed: 0 } };

    render(<FlameCanvas pointerMotion={pointerMotion} active />);

    const canvas = screen.getByTestId("rite-flame-canvas");

    await waitFor(() => {
      expect(canvas.style.display).toBe("none");
    });
    expect(getContext).toHaveBeenCalledWith("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
  });
});
