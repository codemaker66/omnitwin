import { resolvePlannerLayerPolicy } from "../lib/planner-layer-composition.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useEditorStore } from "../stores/editor-store.js";

/**
 * Shared store-bound policy for planner chrome outside the R3F scene. Keeping
 * this selector beside the scene policy prevents DOM overlays and cockpit
 * tools from making a weaker room-identity decision than the renderer.
 */
export function usePlannerLayerPolicy(): ReturnType<typeof resolvePlannerLayerPolicy> {
  const requestedMode = useCockpitStore((state) => state.layerMode);
  const roomIdentity = useCockpitStore((state) => state.plannerRoomIdentity);
  const space = useEditorStore((state) => state.space);

  return resolvePlannerLayerPolicy({
    currentRoom: space === null
      ? null
      : {
          spaceId: space.id,
          venueId: space.venueId,
          roomSlug: space.slug,
        },
    roomIdentity,
    requestedMode,
  });
}
