import { Suspense } from "react";
import type { CatalogueItem } from "../lib/catalogue.js";
import { MeshErrorBoundary } from "./MeshErrorBoundary.js";
import { GltfFurniture } from "./meshes/GltfFurniture.js";
import { RoundTableMesh } from "./meshes/RoundTableMesh.js";
import { TrestleTableMesh } from "./meshes/TrestleTableMesh.js";
import { ChairMesh } from "./meshes/ChairMesh.js";
import { PlatformMesh } from "./meshes/PlatformMesh.js";
import { ProjectorScreenMesh } from "./meshes/ProjectorScreenMesh.js";
import { ProjectorMesh } from "./meshes/ProjectorMesh.js";
import { LaptopMesh } from "./meshes/LaptopMesh.js";
import { MicrophoneMesh } from "./meshes/MicrophoneMesh.js";
import { MicStandMesh } from "./meshes/MicStandMesh.js";
import { LecternMesh } from "./meshes/LecternMesh.js";
import { PoseurTableMesh } from "./meshes/PoseurTableMesh.js";

// ---------------------------------------------------------------------------
// FurnitureProxy — routes to the correct mesh component per item type
// ---------------------------------------------------------------------------

interface FurnitureProxyProps {
  /** Catalogue item defining dimensions and colour. */
  readonly item: CatalogueItem;
  /** Position in render space [x, y, z]. Y=0 is floor level. */
  readonly position: readonly [number, number, number];
  /** Rotation around Y axis in radians. */
  readonly rotationY?: number;
  /** Override opacity (0–1). Defaults to 1. */
  readonly opacity?: number;
  /** Override colour (e.g. green/red for placement ghost). */
  readonly colorOverride?: string;
  /** Mesh name for raycasting identification. */
  readonly name?: string;
}

/**
 * Renders the correct mesh component for a catalogue item.
 *
 * Punch list #28: when item.meshUrl is non-null, loads the .glb model
 * via GltfFurniture (drei's useGLTF). The procedural mesh renders as the
 * Suspense fallback while the model loads, then as the permanent fallback
 * for items that don't have a .glb yet. This means adding a meshUrl to
 * any catalogue entry automatically upgrades it from procedural geometry
 * to the imported model — zero code changes needed per item.
 */
export function FurnitureProxy({
  item,
  position,
  rotationY = 0,
  opacity = 1,
  colorOverride,
  name,
}: FurnitureProxyProps): React.ReactElement {
  const procedural = renderMesh(item, opacity, colorOverride);

  return (
    <group
      name={name}
      position={[position[0], position[1], position[2]]}
      rotation={[0, rotationY, 0]}
    >
      {item.meshUrl !== null ? (
        // Suspense covers the LOAD path (procedural shows while drei fetches);
        // MeshErrorBoundary covers the FAIL path (404, malformed GLB, network
        // error). Without the boundary, a single bad meshUrl would propagate
        // up to the root error boundary and crash the entire scene — every
        // other piece of furniture, the camera rig, the editor UI all gone.
        // Falling back to the procedural mesh keeps the rest of the scene
        // alive and the user can still interact with their layout.
        <MeshErrorBoundary fallback={procedural} meshUrl={item.meshUrl}>
          <Suspense fallback={procedural}>
            <GltfFurniture
              meshUrl={item.meshUrl}
              item={item}
              opacity={opacity}
              colorOverride={colorOverride}
            />
          </Suspense>
        </MeshErrorBoundary>
      ) : (
        procedural
      )}
    </group>
  );
}

function renderMesh(
  item: CatalogueItem,
  opacity: number,
  colorOverride: string | undefined,
): React.ReactElement {
  switch (item.category) {
    case "table":
      if (item.id.startsWith("poseur-table")) {
        return <PoseurTableMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
      }
      if (item.tableShape === "round") {
        return <RoundTableMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
      }
      return <TrestleTableMesh item={item} opacity={opacity} colorOverride={colorOverride} />;

    case "chair":
      return <ChairMesh item={item} opacity={opacity} colorOverride={colorOverride} />;

    case "stage":
      return <PlatformMesh item={item} opacity={opacity} colorOverride={colorOverride} />;

    case "av":
      if (item.id === "projector-screen") {
        return <ProjectorScreenMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
      }
      if (item.id === "laptop") {
        return <LaptopMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
      }
      if (item.id === "microphone") {
        return <MicrophoneMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
      }
      if (item.id === "mic-stand") {
        return <MicStandMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
      }
      return <ProjectorMesh item={item} opacity={opacity} colorOverride={colorOverride} />;

    case "lectern":
      return <LecternMesh item={item} opacity={opacity} colorOverride={colorOverride} />;

    default:
      return <PlatformMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
  }
}
