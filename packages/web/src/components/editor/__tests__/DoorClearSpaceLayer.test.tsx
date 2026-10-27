import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import type { Object3D } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createTableGroup } from "../../../lib/table-group.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../../lib/door-clear-spaces.js";
import { DOOR_FLOOR_BLOCKED, DOOR_FLOOR_FAINT } from "../../../lib/keep-doors-clear.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useDoorClearSpaceStore } from "../../../stores/door-clear-space-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { DoorClearSpaceLayer } from "../DoorClearSpaceLayer.js";

// The doors' clear spaces on the floor (Blake's door rule): faint while a
// piece is placed or carried, full where it enters one, gone otherwise but
// for a space something already stands in. Under reduced motion a mark is
// simply at its strength on the next frame.

vi.mock("../../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => true }));

const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "missing-round";

let mounted: StubRoot | null = null;
let seconds = 100;

function frame(): void {
  act(() => { advance(seconds, true); });
  seconds += 1 / 60;
}

function mark(id: string): Object3D | undefined {
  return mounted?.scene.getObjectByName(`door-clear-space-${id}`);
}

function strength(id: string): number | null {
  const found = mark(id);
  return found === undefined || !found.visible ? null : (found.userData["strength"] as number);
}

beforeEach(() => {
  useDoorClearSpaceStore.getState().setRoomSpaces(GRAND_HALL_DOOR_CLEAR_SPACES);
  useDoorClearSpaceStore.getState().setCarrying(false);
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0 });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
});

describe("DoorClearSpaceLayer", () => {
  it("draws nothing on the floor while nothing is placed or carried", () => {
    mounted = mountInStubRoot(<DoorClearSpaceLayer />);
    frame();
    expect(GRAND_HALL_DOOR_CLEAR_SPACES.map((space) => strength(space.id))).toEqual([null, null, null, null]);
  });

  it("shows every door's space faintly with a piece in hand, and the one its ghost enters fully", () => {
    mounted = mountInStubRoot(<DoorClearSpaceLayer />);
    act(() => {
      useCatalogueStore.getState().selectItem(ROUND);
      // The ghost of a 6 ft round at (0, 3.5): its chairs reach into the main door's space.
      usePlacementStore.setState({ ghostPosition: [0, 0, 3.5] });
    });
    frame();
    expect(GRAND_HALL_DOOR_CLEAR_SPACES.map((space) => strength(space.id)))
      .toEqual([DOOR_FLOOR_FAINT, 1, DOOR_FLOOR_FAINT, DOOR_FLOOR_FAINT]);
  });

  it("shows them while a hand carries placed pieces", () => {
    mounted = mountInStubRoot(<DoorClearSpaceLayer />);
    act(() => { useDoorClearSpaceStore.getState().setCarrying(true); });
    frame();
    expect(strength("door-end")).toBe(DOOR_FLOOR_FAINT);
  });

  it("shows a space something already stands in, beside the notice that names it", () => {
    usePlacementStore.setState({ placedItems: [...createTableGroup(ROUND, 0, 3, 0, 10)] });
    mounted = mountInStubRoot(<DoorClearSpaceLayer />);
    frame();
    expect([strength("door-main"), strength("door-end")]).toEqual([DOOR_FLOOR_BLOCKED, null]);
  });

  it("draws nothing in a room whose doors are not recorded", () => {
    useDoorClearSpaceStore.getState().setRoomSpaces(null);
    mounted = mountInStubRoot(<DoorClearSpaceLayer />);
    act(() => { useDoorClearSpaceStore.getState().setCarrying(true); });
    frame();
    expect(mounted.scene.getObjectByName("door-clear-spaces")).toBeUndefined();
  });
});
