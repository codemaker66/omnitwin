import { render, screen } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type CanvasMockProps = Readonly<{
  children?: ReactNode;
  className?: string;
  frameloop?: unknown;
  dpr?: unknown;
  gl?: unknown;
  performance?: unknown;
}>;

type OrbitControlsMockProps = Readonly<Record<string, unknown>>;

const { orbitControlsMock } = vi.hoisted(() => ({
  orbitControlsMock: vi.fn<(props: OrbitControlsMockProps) => void>(),
}));

vi.mock("@react-three/fiber", () => {
  function makeR3fState() {
    return {
      performance: { current: 1 },
      viewport: { initialDpr: 1.5 },
      setDpr: vi.fn(),
      invalidate: vi.fn(),
    };
  }

  return {
    Canvas: (props: CanvasMockProps) => {
      const renderableChildren = React.Children.toArray(props.children).filter((child) => {
        if (!React.isValidElement(child)) return true;
        return typeof child.type !== "string" || child.type === "div";
      });
      const glRecord = typeof props.gl === "object" && props.gl !== null
        ? props.gl as Record<string, unknown>
        : {};
      const perfRecord = typeof props.performance === "object" && props.performance !== null
        ? props.performance as Record<string, unknown>
        : {};
      const powerPreference = glRecord["powerPreference"];
      const alpha = glRecord["alpha"];
      const performanceMin = perfRecord["min"];
      const performanceDebounce = perfRecord["debounce"];
      return (
        <div
          className={props.className}
          data-testid="room-showcase-runtime-canvas"
          data-frameloop={typeof props.frameloop === "string" ? props.frameloop : ""}
          data-dpr={JSON.stringify(props.dpr)}
          data-power-preference={typeof powerPreference === "string" ? powerPreference : ""}
          data-alpha={alpha === true ? "true" : "false"}
          data-performance-min={typeof performanceMin === "number" ? String(performanceMin) : ""}
          data-performance-debounce={typeof performanceDebounce === "number" ? String(performanceDebounce) : ""}
        >
          {renderableChildren}
        </div>
      );
    },
    useThree: (selector?: (state: ReturnType<typeof makeR3fState>) => unknown) => {
      const state = makeR3fState();
      return selector === undefined ? state : selector(state);
    },
  };
});

vi.mock("@react-three/drei", () => ({
  OrbitControls: (props: OrbitControlsMockProps) => {
    orbitControlsMock(props);
    return <div data-testid="room-showcase-orbit-controls" />;
  },
}));

vi.mock("../../scene/SparkSplatLayer.js", () => ({
  SparkSplatLayer: ({ url }: { readonly url: string }) => (
    <div data-testid="room-showcase-spark-layer">{url}</div>
  ),
}));

const { PublicRoomRuntimeCanvas } = await import("../PublicRoomRuntimeCanvas.js");

describe("PublicRoomRuntimeCanvas", () => {
  beforeEach(() => {
    orbitControlsMock.mockClear();
  });

  it("demand-renders the public runtime canvas with a mobile-safe DPR cap", () => {
    render(
      <PublicRoomRuntimeCanvas
        visualUrl="https://assets.example/reception-room/scene.ply"
        onLoaded={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    const canvas = screen.getByTestId("room-showcase-runtime-canvas");
    expect(canvas.className).toBe("room-showcase-runtime-canvas");
    expect(canvas.getAttribute("data-frameloop")).toBe("demand");
    expect(canvas.getAttribute("data-dpr")).toBe("[1,1]");
    expect(canvas.getAttribute("data-power-preference")).toBe("high-performance");
    expect(canvas.getAttribute("data-alpha")).toBe("true");
    expect(canvas.getAttribute("data-performance-min")).toBe("0.7");
    expect(canvas.getAttribute("data-performance-debounce")).toBe("180");
  });

  it("keeps the room showcase controls mounted without pan drift", () => {
    render(
      <PublicRoomRuntimeCanvas
        visualUrl="https://assets.example/reception-room/scene.ply"
        onLoaded={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    expect(orbitControlsMock).toHaveBeenCalledWith(expect.objectContaining({
      enableDamping: true,
      enablePan: false,
      regress: true,
      minDistance: 1.8,
      maxDistance: 8,
    }));
  });
});
