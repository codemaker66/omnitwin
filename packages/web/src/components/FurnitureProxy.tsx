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
import { GeneratedFurnitureProxy } from "./meshes/generated/GeneratedFurnitureProxy.js";
import { isGeneratedFurnitureSlug } from "./meshes/generated/generatedFurnitureRegistry.js";
import { normalizeFurnitureScale } from "../lib/furniture-scale.js";
import { isTableDressingApplicatorSlug } from "../lib/table-dressing.js";

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
  /** Uniform editor-authored presentation scale. */
  readonly scale?: number;
  /** Presentation-only explode amount for a generated chair/table proxy. */
  readonly generatedExplodeProgress?: number;
  /** Presentation-only generated part highlight. */
  readonly generatedSelectedPartId?: string | null;
  /** Called when a named generated part is clicked during inspection. */
  readonly onGeneratedPartSelect?: (partId: string) => void;
}

export const GENERATED_FURNITURE_EXPLODE_WORLD_DISTANCE = 0.35;

export function normalizedFurniturePresentationScale(scale: number | undefined): number {
  return normalizeFurnitureScale(scale);
}

/** Compensate for the outer item scale so explode distance stays world-stable. */
export function generatedFurnitureLocalExplodeDistance(scale: number | undefined): number {
  return GENERATED_FURNITURE_EXPLODE_WORLD_DISTANCE
    / normalizedFurniturePresentationScale(scale);
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
  scale,
  generatedExplodeProgress = 0,
  generatedSelectedPartId = null,
  onGeneratedPartSelect,
}: FurnitureProxyProps): React.ReactElement {
  const resolvedScale = normalizedFurniturePresentationScale(scale);
  const meshUrl = standaloneFurnitureMeshUrl(item);
  const procedural = renderMesh(
    item,
    opacity,
    colorOverride,
    generatedExplodeProgress,
    generatedSelectedPartId,
    onGeneratedPartSelect,
    generatedFurnitureLocalExplodeDistance(resolvedScale),
  );

  return (
    <group
      name={name}
      position={[position[0], position[1], position[2]]}
      rotation={[0, rotationY, 0]}
      scale={resolvedScale}
    >
      {meshUrl !== null ? (
        // Suspense covers the LOAD path (procedural shows while drei fetches);
        // MeshErrorBoundary covers the FAIL path (404, malformed GLB, network
        // error). Without the boundary, a single bad meshUrl would propagate
        // up to the root error boundary and crash the entire scene — every
        // other piece of furniture, the camera rig, the editor UI all gone.
        // Falling back to the procedural mesh keeps the rest of the scene
        // alive and the user can still interact with their layout.
        <MeshErrorBoundary fallback={procedural} meshUrl={meshUrl}>
          <Suspense fallback={procedural}>
            <GltfFurniture
              meshUrl={meshUrl}
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

/** Which mesh component a catalogue item resolves to. */
export type FurnitureMeshKind =
  | "applicator"
  | "generated"
  | "poseur-table"
  | "round-table"
  | "trestle-table"
  | "chair"
  | "platform"
  | "projector-screen"
  | "laptop"
  | "microphone"
  | "mic-stand"
  | "projector"
  | "lectern";

/**
 * Pure dispatch table: catalogue item → mesh component.
 *
 * Split out of `renderMesh` so the routing can be asserted against the real
 * CANONICAL_ASSETS list without mounting R3F. Dispatch keys off `slug` — the
 * stable developer identifier — because `id` is a deterministic UUID v5 and
 * comparing it to a kebab-case literal silently never matches.
 */
export function resolveFurnitureMeshKind(
  item: Pick<CatalogueItem, "slug" | "category" | "tableShape">,
): FurnitureMeshKind {
  if (isTableDressingApplicatorSlug(item.slug)) return "applicator";
  if (isGeneratedFurnitureSlug(item.slug)) return "generated";

  switch (item.category) {
    case "table":
      if (item.slug.startsWith("poseur-table")) return "poseur-table";
      return item.tableShape === "round" ? "round-table" : "trestle-table";
    case "chair":
      return "chair";
    case "stage":
      return "platform";
    case "av":
      switch (item.slug) {
        case "projector-screen":
          return "projector-screen";
        case "laptop":
          return "laptop";
        case "microphone":
          return "microphone";
        case "mic-stand":
          return "mic-stand";
        default:
          return "projector";
      }
    case "lectern":
      return "lectern";
    default:
      return "platform";
  }
}

/**
 * Resolve an imported furniture asset without allowing contextual catalogue
 * tools to escape their non-rendering role. Applicators stay geometry-free
 * even if future or malformed catalogue metadata supplies a mesh URL.
 */
export function standaloneFurnitureMeshUrl(
  item: Pick<CatalogueItem, "slug" | "category" | "tableShape" | "meshUrl">,
): string | null {
  return resolveFurnitureMeshKind(item) === "applicator" ? null : item.meshUrl;
}

function renderMesh(
  item: CatalogueItem,
  opacity: number,
  colorOverride: string | undefined,
  generatedExplodeProgress: number,
  generatedSelectedPartId: string | null,
  onGeneratedPartSelect: ((partId: string) => void) | undefined,
  generatedExplodeDistance: number,
): React.ReactElement | null {
  if (isGeneratedFurnitureSlug(item.slug)) {
    return (
      <GeneratedFurnitureProxy
        slug={item.slug}
        opacity={opacity}
        colorOverride={colorOverride}
        explodeProgress={generatedExplodeProgress}
        explodeDistance={generatedExplodeDistance}
        selectedPartId={generatedSelectedPartId}
        onPartSelect={onGeneratedPartSelect === undefined
          ? undefined
          : (part) => { onGeneratedPartSelect(part.id); }}
      />
    );
  }

  switch (resolveFurnitureMeshKind(item)) {
    case "applicator":
      // Contextual catalogue tools have no standalone physical geometry. An
      // empty FurnitureProxy group deliberately keeps the component contract
      // stable while preventing corrupt/legacy rows from becoming platforms.
      return null;
    case "generated":
      // Handled above — the generated branch needs the inspection props.
      return <PlatformMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "poseur-table":
      return <PoseurTableMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "round-table":
      return <RoundTableMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "trestle-table":
      return <TrestleTableMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "chair":
      return <ChairMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "platform":
      return <PlatformMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "projector-screen":
      return <ProjectorScreenMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "laptop":
      return <LaptopMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "microphone":
      return <MicrophoneMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "mic-stand":
      return <MicStandMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "projector":
      return <ProjectorMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
    case "lectern":
      return <LecternMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
  }
}
