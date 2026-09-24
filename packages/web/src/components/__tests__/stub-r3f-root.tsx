import { createRoot, extend, type ReconcilerRoot } from "@react-three/fiber";
import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import * as THREE from "three";
import type { Object3D } from "three";

// A real R3F root with a renderer that draws nothing, so a component's actual
// scene graph can be mounted, inspected and raycast on the CPU. <Canvas>
// registers the THREE namespace itself; a bare root must.
extend(THREE);

function stubRenderer(canvas: HTMLCanvasElement): object {
  return {
    domElement: canvas,
    render: () => undefined,
    setSize: () => undefined,
    setPixelRatio: () => undefined,
    getPixelRatio: () => 1,
    dispose: () => undefined,
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    xr: { enabled: false, addEventListener: () => undefined, removeEventListener: () => undefined, setAnimationLoop: () => undefined },
  };
}

export interface StubRoot {
  readonly scene: Object3D;
  readonly unmount: () => void;
}

export function mountInStubRoot(element: ReactElement, width = 1440, height = 900): StubRoot {
  const canvas = document.createElement("canvas");
  const root: ReconcilerRoot<HTMLCanvasElement> = createRoot(canvas);
  root.configure({ gl: stubRenderer(canvas), frameloop: "never", size: { width, height, top: 0, left: 0 } });
  const mounted: { scene: Object3D | null } = { scene: null };
  act(() => {
    root.render(<group ref={(group) => { mounted.scene = group; }}>{element}</group>);
  });
  const { scene } = mounted;
  if (scene === null) throw new Error("Stub root did not mount");
  return { scene, unmount: () => { act(() => { root.unmount(); }); } };
}
