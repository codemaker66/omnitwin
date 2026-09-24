import { createRoot, extend } from "@react-three/fiber";
import { act } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import * as THREE from "three";
import type { Group } from "three";

// A real R3F root whose renderer draws nothing, so a component's actual scene
// graph can be mounted, re-rendered, inspected and raycast on the CPU.
// <Canvas> registers the THREE namespace itself; a bare root must.
extend(THREE);

interface StubRenderer {
  readonly domElement: HTMLCanvasElement;
  readonly render: () => void;
  readonly setSize: () => void;
  readonly setPixelRatio: () => void;
  readonly getPixelRatio: () => number;
  readonly dispose: () => void;
  readonly shadowMap: { enabled: boolean; type: number; needsUpdate: boolean };
  readonly xr: {
    enabled: boolean;
    readonly addEventListener: () => void;
    readonly removeEventListener: () => void;
    readonly setAnimationLoop: () => void;
  };
}

function stubRenderer(canvas: HTMLCanvasElement): StubRenderer {
  return {
    domElement: canvas,
    render: () => undefined,
    setSize: () => undefined,
    setPixelRatio: () => undefined,
    getPixelRatio: () => 1,
    dispose: () => undefined,
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    xr: {
      enabled: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setAnimationLoop: () => undefined,
    },
  };
}

export interface TestRoot {
  /** The wrapper group every rendered element is mounted under. */
  readonly scene: Group;
  readonly render: (element: ReactElement) => void;
  readonly unmount: () => void;
}

export function mountTestRoot(element: ReactElement, width = 1440, height = 900): TestRoot {
  const canvas = document.createElement("canvas");
  const root = createRoot(canvas);
  root.configure({ gl: stubRenderer(canvas), frameloop: "never", size: { width, height, top: 0, left: 0 } });
  const wrapper = createRef<Group>();
  const render = (next: ReactElement): void => {
    act(() => { root.render(<group ref={wrapper}>{next}</group>); });
  };
  render(element);
  const scene = wrapper.current;
  if (scene === null) throw new Error("Test root did not mount");
  return { scene, render, unmount: () => { act(() => { root.unmount(); }); } };
}
