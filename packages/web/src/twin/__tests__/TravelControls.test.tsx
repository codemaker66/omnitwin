import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Euler, PerspectiveCamera } from "three";
import type { TwinScanNode } from "@omnitwin/types";
import { TravelControls } from "../TravelControls.js";

// A click on the stage is the walk's main control, and two timing facts sit
// between the click and the hop:
//  - three refreshes camera.matrixWorld only when it renders, and the walk's
//    pose writes (the ?look= seed in InitialLookRig) land in effects that run
//    after R3F's first frame. A click in that gap used to be aimed through the
//    last rendered matrix, still facing the default −Z, and found no viewpoint.
//  - the scene mounts after the HUD, so anything that clicks needs to know when
//    a click will be acted on. The canvas says so in data-walk-ready.
// R3F is mocked the way PanoStage.activity.test.tsx mocks it: the component's
// effects run against a real camera and a real canvas element.

const bridge = vi.hoisted(() => ({ state: vi.fn<() => unknown>() }));
vi.mock("@react-three/fiber", () => ({
  useFrame: (): void => undefined,
  useThree: (select: (state: unknown) => unknown): unknown => select(bridge.state()),
}));

function node(id: string, x: number, y: number): TwinScanNode {
  return { id, index: Number(id.slice(5)), pose: { q: [1, 0, 0, 0], t: [x, y, 1.5] }, floor: 0, roomSlug: null };
}

// E57 [x, y, z] maps to three [x, z, −y], so scan_001 stands 2.5 m down
// three's +X from scan_000: 90° from the default camera's −Z, far outside the
// 55° click cone, and dead ahead of a camera turned to yaw −90°.
const HERE = node("scan_000", 0, 0);
const AHEAD = node("scan_001", 2.5, 0);
const NODES = new Map<string, TwinScanNode>([[HERE.id, HERE], [AHEAD.id, AHEAD]]);
const FACE_PLUS_X = new Euler(0, -Math.PI / 2, 0, "YXZ");

let canvas: HTMLCanvasElement;
let camera: PerspectiveCamera;

beforeEach(() => {
  canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = (): DOMRect =>
    ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(canvas);
  camera = new PerspectiveCamera(75, 2, 0.1, 200);
  camera.position.set(0, 1.5, 0);
  // R3F's first frame: rendered at the default facing, before any effect ran.
  camera.updateMatrixWorld();
  bridge.state.mockReturnValue({ camera, gl: { domElement: canvas }, invalidate: vi.fn() });
});

afterEach(() => {
  cleanup();
  canvas.remove();
  vi.restoreAllMocks();
});

/** A click at the stage's centre, with the press that precedes it. */
function clickCentre(): void {
  canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 50, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 50, bubbles: true }));
}

describe("TravelControls click aim", () => {
  it("aims with the pose the camera holds, not the one it last rendered", () => {
    const onTravel = vi.fn<(id: string) => void>();
    render(
      <TravelControls enabled hopping={false} currentNode={HERE} neighbors={[AHEAD.id]} nodesById={NODES} onTravel={onTravel} />,
    );
    // The ?look= seed, written as InitialLookRig writes it: no frame since.
    camera.quaternion.setFromEuler(FACE_PLUS_X);

    clickCentre();

    expect(onTravel).toHaveBeenCalledTimes(1);
    expect(onTravel).toHaveBeenCalledWith("scan_001");
  });

  it("finds nothing when the camera really does face away", () => {
    const onTravel = vi.fn<(id: string) => void>();
    render(
      <TravelControls enabled hopping={false} currentNode={HERE} neighbors={[AHEAD.id]} nodesById={NODES} onTravel={onTravel} />,
    );

    clickCentre();

    expect(onTravel).not.toHaveBeenCalled();
  });
});

describe("TravelControls readiness", () => {
  it("names the viewpoint a click walks from, and only while a click would walk", () => {
    const onTravel = vi.fn<(id: string) => void>();
    camera.quaternion.setFromEuler(FACE_PLUS_X);
    const view = render(
      <TravelControls enabled hopping={false} currentNode={HERE} neighbors={[AHEAD.id]} nodesById={NODES} onTravel={onTravel} />,
    );
    expect(canvas.getAttribute("data-walk-ready")).toBe("scan_000");

    // Mid-hop a click is ignored, and the signal is withdrawn with it.
    view.rerender(
      <TravelControls enabled hopping currentNode={HERE} neighbors={[AHEAD.id]} nodesById={NODES} onTravel={onTravel} />,
    );
    expect(canvas.hasAttribute("data-walk-ready")).toBe(false);
    clickCentre();
    expect(onTravel).not.toHaveBeenCalled();

    // Arrival re-arms it for the new viewpoint.
    view.rerender(
      <TravelControls enabled hopping={false} currentNode={AHEAD} neighbors={[HERE.id]} nodesById={NODES} onTravel={onTravel} />,
    );
    expect(canvas.getAttribute("data-walk-ready")).toBe("scan_001");

    view.unmount();
    expect(canvas.hasAttribute("data-walk-ready")).toBe(false);
  });

  it("is never set while travel is disabled", () => {
    render(
      <TravelControls enabled={false} hopping={false} currentNode={HERE} neighbors={[AHEAD.id]} nodesById={NODES} onTravel={vi.fn()} />,
    );
    expect(canvas.hasAttribute("data-walk-ready")).toBe(false);
  });
});
