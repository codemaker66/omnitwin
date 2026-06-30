import { Suspense, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFLoader, type GLTF } from "three-stdlib";
import { Box3, BufferGeometry, LoadingManager, Material, Mesh, Texture, Vector3, type Object3D } from "three";
import { fixtureModelBasename, type SelectedFixtureModel } from "../../../lib/gdtf-model.js";

// ---------------------------------------------------------------------------
// FixtureModelPreview — a small 3D preview of an imported GDTF fixture (slice 4).
//
// The model bytes come from the .gdtf archive (lib/gdtf-model.ts selected the best
// glTF). A .glb is parsed directly; a .gltf's external buffers/textures are served
// from the archive's sibling files as blob URLs via a LoadingManager URL modifier.
// The loaded scene is centred + auto-fit, and geometries/materials/textures + blob
// URLs are disposed on change/unmount (GLTFLoader leaks otherwise).
// ---------------------------------------------------------------------------

function disposeMaterial(material: Material): void {
  for (const key of Object.keys(material)) {
    const value: unknown = Reflect.get(material, key);
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

function disposeObject(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry: unknown = child.geometry;
    if (geometry instanceof BufferGeometry) geometry.dispose();
    const material: unknown = child.material;
    const materials: Material[] = material instanceof Material
      ? [material]
      : Array.isArray(material)
        ? material.filter((entry: unknown): entry is Material => entry instanceof Material)
        : [];
    materials.forEach(disposeMaterial);
  });
}

/** A copy of the bytes as a standalone ArrayBuffer (GLTFLoader.parse needs one). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

interface LoadedState {
  readonly object: Object3D;
  readonly center: readonly [number, number, number];
  readonly scale: number;
}

function ModelMesh({ model, onError }: { readonly model: SelectedFixtureModel; readonly onError: () => void }): ReactElement | null {
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const objectRef = useRef<Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;
    const blobUrls: string[] = [];
    const byBasename = new Map<string, string>();
    for (const [path, bytes] of model.siblings) {
      const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)]));
      blobUrls.push(url);
      byBasename.set(fixtureModelBasename(path).toLowerCase(), url);
    }
    const manager = new LoadingManager();
    manager.setURLModifier((url) => byBasename.get(fixtureModelBasename(url).toLowerCase()) ?? url);
    const loader = new GLTFLoader(manager);

    const onLoad = (gltf: GLTF): void => {
      if (cancelled) { disposeObject(gltf.scene); return; }
      objectRef.current = gltf.scene;
      const box = new Box3().setFromObject(gltf.scene);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      setLoaded({ object: gltf.scene, center: [center.x, center.y, center.z], scale: 1.6 / maxDim });
    };
    const fail = (): void => { if (!cancelled) onError(); };

    if (model.kind === "glb") loader.parse(toArrayBuffer(model.bytes), "", onLoad, fail);
    else loader.parse(new TextDecoder().decode(model.bytes), "", onLoad, fail);

    return () => {
      cancelled = true;
      if (objectRef.current !== null) { disposeObject(objectRef.current); objectRef.current = null; }
      for (const url of blobUrls) URL.revokeObjectURL(url);
    };
  }, [model, onError]);

  if (loaded === null) return null;
  return (
    <group scale={loaded.scale}>
      <primitive object={loaded.object} position={[-loaded.center[0], -loaded.center[1], -loaded.center[2]]} />
    </group>
  );
}

export function FixtureModelPreview({ model }: { readonly model: SelectedFixtureModel }): ReactElement {
  const [errored, setErrored] = useState(false);
  const onError = useCallback(() => { setErrored(true); }, []);

  if (errored) {
    return <p className="lens-panel__note" data-testid="fixture-model-error">3D model could not be loaded.</p>;
  }
  return (
    <div className="lens-panel__model-preview" data-testid="fixture-model-preview">
      <Canvas camera={{ position: [2, 1.6, 2], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 2]} intensity={1.1} />
        <Suspense fallback={null}>
          <ModelMesh model={model} onError={onError} />
        </Suspense>
        <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={2.4} />
      </Canvas>
    </div>
  );
}
