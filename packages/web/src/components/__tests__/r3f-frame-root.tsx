import { advance, createRoot, extend, type ReconcilerRoot } from "@react-three/fiber";
import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import * as THREE from "three";
import type { Object3D } from "three";

// A real R3F root whose renderer draws nothing, so a component's actual scene
// graph can be mounted, stepped frame by frame and inspected on the CPU.
// <Canvas> registers the THREE namespace itself; a bare root must.
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

/** R3F's root store (R3F bundles its own zustand). */
export type FrameRootStore = ReturnType<ReconcilerRoot<HTMLCanvasElement>["render"]>;

export interface FrameRoot {
  /** The group wrapping the mounted element (child of the R3F scene). */
  readonly scene: Object3D;
  readonly store: FrameRootStore;
  /** Number of `invalidate()` calls made through `useThree().invalidate`. */
  readonly invalidations: () => number;
  /** Runs every useFrame subscriber once with the given delta in seconds. */
  readonly frame: (deltaSeconds?: number) => void;
  readonly rerender: (element: ReactElement) => void;
  readonly unmount: () => void;
}

/**
 * Mounts `element` in a real R3F reconciler root with `frameloop="never"`.
 * `invalidate` is replaced by a counter before the element mounts, so
 * components that capture it from `useThree()` report their frame requests.
 */
export function mountFrameRoot(element: ReactElement, width = 1440, height = 900): FrameRoot {
  const canvas = document.createElement("canvas");
  const root: ReconcilerRoot<HTMLCanvasElement> = createRoot(canvas);
  root.configure({ gl: stubRenderer(canvas), frameloop: "never", size: { width, height, top: 0, left: 0 } });
  const created: { store: FrameRootStore | null } = { store: null };
  act(() => { created.store = root.render(null); });
  const rootStore = created.store;
  if (rootStore === null) throw new Error("R3F root did not create a store");
  let invalidations = 0;
  rootStore.setState({ invalidate: () => { invalidations += 1; } });

  const mounted: { scene: Object3D | null } = { scene: null };
  const wrap = (child: ReactElement): ReactElement => (
    <group ref={(group) => { if (group !== null) mounted.scene = group; }}>{child}</group>
  );
  act(() => { root.render(wrap(element)); });
  const { scene } = mounted;
  if (scene === null) throw new Error("R3F root did not mount the element");

  let elapsed = 0;
  return {
    scene,
    store: rootStore,
    invalidations: () => invalidations,
    frame: (deltaSeconds = 1 / 60) => {
      elapsed += deltaSeconds;
      act(() => { advance(elapsed, true, rootStore.getState()); });
    },
    rerender: (next) => { act(() => { root.render(wrap(next)); }); },
    unmount: () => { act(() => { root.unmount(); }); },
  };
}
