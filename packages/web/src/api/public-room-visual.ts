import {
  PublicRoomRuntimeVisualSchema,
  type PublicRoomRuntimeVisual,
  type RuntimeSlug,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getPublicRoomRuntimeVisual(
  venueSlug: RuntimeSlug,
  roomSlug: RuntimeSlug,
): Promise<PublicRoomRuntimeVisual> {
  const params = new URLSearchParams({
    venue: venueSlug,
    room: roomSlug,
  });

  return api.get(
    `/assets/runtime-packages/public-room-visual?${params.toString()}`,
    PublicRoomRuntimeVisualSchema,
  );
}
