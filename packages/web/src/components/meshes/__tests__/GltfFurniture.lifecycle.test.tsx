import { StrictMode, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { GltfFurnitureTemplateContext } from "../GltfFurnitureTemplateContext.js";
import { MeshErrorBoundary } from "../../MeshErrorBoundary.js";

const loader = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@react-three/drei", () => ({ useGLTF: loader.read }));
const { GltfFurniture } = await import("../GltfFurniture.js");
const item = getCatalogueItemBySlug("burgess-turini-18-3");
if (item === undefined) throw new Error("Missing imported chair catalogue fixture");
const chair = item;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function sourceScene(): { scene: Group; material: MeshStandardMaterial; geometry: BoxGeometry } {
  const material = new MeshStandardMaterial({ map: new Texture() });
  const geometry = new BoxGeometry(0.42, 0.88, 0.58);
  const scene = new Group();
  scene.add(new Mesh(geometry, material));
  return { scene, material, geometry };
}

describe("GLTF template readiness", () => {
  it("notifies the batch only after the asynchronous model is ready and keeps cached resources alive", async () => {
    const source = sourceScene();
    let resolve: (() => void) | undefined;
    const pending = new Promise<void>((done) => { resolve = done; });
    let ready = false;
    loader.read.mockImplementation(() => {
      // Suspense deliberately suspends rendering by throwing the pending load.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (!ready) throw pending;
      return source;
    });
    const onReady = vi.fn();
    const materialClone = vi.spyOn(source.material, "clone");
    const sourceDispose = vi.spyOn(source.material, "dispose");
    const geometryDispose = vi.spyOn(source.geometry, "dispose");
    const view = (opacity = 1) => (
      <GltfFurnitureTemplateContext.Provider value={onReady}>
        <Suspense fallback={<span>Chair loading fallback</span>}>
          <GltfFurniture item={chair} meshUrl="/chair.glb" opacity={opacity} />
        </Suspense>
      </GltfFurnitureTemplateContext.Provider>
    );
    const { rerender, unmount } = render(view());
    expect(screen.getByText("Chair loading fallback")).toBeTruthy();
    expect(onReady).not.toHaveBeenCalled();
    await act(async () => { ready = true; resolve?.(); await pending; });
    expect(screen.queryByText("Chair loading fallback")).toBeNull();
    expect(onReady).toHaveBeenCalledOnce();
    const clonedMaterial = materialClone.mock.results[0]?.value as MeshStandardMaterial | undefined;
    if (clonedMaterial === undefined) throw new Error("Missing cloned material");
    const dispose = vi.spyOn(clonedMaterial, "dispose");
    rerender(view(0.4));
    expect(clonedMaterial.opacity).toBe(0.4);
    expect(materialClone).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledOnce();
    unmount();
    expect(dispose).toHaveBeenCalledOnce();
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    source.geometry.dispose(); source.material.dispose(); source.material.map?.dispose();
  });

  it("keeps an invalid GLB within its error fallback and never advertises a ready template", () => {
    loader.read.mockImplementation(() => { throw new Error("Malformed GLB"); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onReady = vi.fn();
    render(
      <GltfFurnitureTemplateContext.Provider value={onReady}>
        <MeshErrorBoundary meshUrl="/broken.glb" fallback={<span>Chair fallback retained</span>}>
          <GltfFurniture item={chair} meshUrl="/broken.glb" />
        </MeshErrorBoundary>
      </GltfFurnitureTemplateContext.Provider>,
    );
    expect(screen.getByText("Chair fallback retained")).toBeTruthy();
    expect(onReady).not.toHaveBeenCalled();
  });

  it("has bounded readiness notifications under StrictMode remounting", () => {
    const source = sourceScene();
    loader.read.mockReturnValue(source);
    const onReady = vi.fn();
    const { rerender } = render(
      <StrictMode><GltfFurnitureTemplateContext.Provider value={onReady}>
        <GltfFurniture item={chair} meshUrl="/chair.glb" />
      </GltfFurnitureTemplateContext.Provider></StrictMode>,
    );
    expect(onReady).toHaveBeenCalledTimes(2);
    rerender(
      <StrictMode><GltfFurnitureTemplateContext.Provider value={onReady}>
        <GltfFurniture item={chair} meshUrl="/chair.glb" opacity={0.5} />
      </GltfFurnitureTemplateContext.Provider></StrictMode>,
    );
    expect(onReady).toHaveBeenCalledTimes(2);
    cleanup(); source.geometry.dispose(); source.material.dispose(); source.material.map?.dispose();
  });
});
