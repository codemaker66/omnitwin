import { act } from "@testing-library/react";
import { Texture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { roomGeometries } from "../../../data/room-geometries.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { RoomMesh } from "../RoomMesh.js";

const textures = vi.hoisted(() => ({ created: [] as { dispose: () => void }[] }));
vi.mock("../../../lib/grand-hall-textures.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/grand-hall-textures.js")>();
  const make = (): Texture => {
    const texture = new Texture();
    vi.spyOn(texture, "dispose");
    textures.created.push(texture);
    return texture;
  };
  return { ...actual, createParquetFloorTexture: vi.fn(make), createDomeInteriorTexture: vi.fn(make) };
});

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  textures.created.length = 0;
  act(() => { useCockpitStore.setState({ cameraInteractionActive: false }); });
});

describe("RoomMesh Grand Hall surface textures", () => {
  it("keeps the parquet and dome textures through camera gestures and disposes them once", () => {
    const geometry = roomGeometries["Grand Hall"];
    if (geometry === undefined) throw new Error("Missing Grand Hall geometry");
    mounted = mountInStubRoot(<RoomMesh geometry={geometry} variant="grand-hall" includeLighting={false} />);
    expect(textures.created).toHaveLength(2);
    const [floor, dome] = textures.created;

    for (let gesture = 0; gesture < 2; gesture += 1) {
      act(() => { useCockpitStore.setState({ cameraInteractionActive: true }); });
      act(() => { useCockpitStore.setState({ cameraInteractionActive: false }); });
    }
    expect(textures.created).toHaveLength(2);
    expect(floor?.dispose).not.toHaveBeenCalled();

    mounted.unmount();
    mounted = null;
    expect(floor?.dispose).toHaveBeenCalledTimes(1);
    expect(dome?.dispose).toHaveBeenCalledTimes(1);
  });
});
