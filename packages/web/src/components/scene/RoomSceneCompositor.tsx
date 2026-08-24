import type { ReactElement, ReactNode } from "react";
import type { RoomSceneManifestV0, SpatialLayerDescriptorV0 } from "@omnitwin/types";
import type { RoomSceneComposition } from "../../lib/room-scene-composition.js";

export interface RoomSceneCompositorProps {
  readonly manifest: RoomSceneManifestV0;
  readonly composition: RoomSceneComposition;
  readonly renderLayer: (layer: SpatialLayerDescriptorV0) => ReactNode;
}

/**
 * Typed, fail-closed scene mount. Every declared descriptor has a stable group
 * and stays mounted across evidence-view changes; visibility never substitutes
 * one truth class for another.
 */
export function RoomSceneCompositor({
  manifest,
  composition,
  renderLayer,
}: RoomSceneCompositorProps): ReactElement {
  const visibleLayerIds = new Set(composition.visibleLayerIds);
  return (
    <group
      name="room-scene-compositor"
      userData={{
        roomSceneManifestId: manifest.manifestId,
        roomSceneSchemaVersion: manifest.schemaVersion,
      }}
    >
      {manifest.layerDescriptors.map((layer) => (
        <group
          key={layer.id}
          name={`room-scene-layer:${layer.kind}:${layer.id}`}
          visible={visibleLayerIds.has(layer.id)}
          userData={{
            layerId: layer.id,
            layerKind: layer.kind,
            truthClass: layer.truthClass,
            authorities: [...layer.authorities],
          }}
        >
          {renderLayer(layer)}
        </group>
      ))}
    </group>
  );
}
