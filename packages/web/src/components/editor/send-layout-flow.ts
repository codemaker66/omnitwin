import { updatePublicThumbnail } from "../../api/configurations.js";
import { captureOrthographic } from "../../lib/ortho-capture.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { flushAutoSave } from "./EditorBridge.js";

export async function prepareLayoutForGuestEnquiry(configId: string): Promise<boolean> {
  const saved = await flushAutoSave();
  if (!saved) return false;

  try {
    const { scene, space, isPublicPreview } = useEditorStore.getState();
    // Claimed/authenticated configurations are private working artifacts.
    // Keep thumbnail capture on the public-preview path until private
    // thumbnail storage and visibility rules are explicit.
    if (scene === null || space === null || !isPublicPreview) return true;

    const { width: roomWidthRender, length: roomLengthRender } =
      useRoomDimensionsStore.getState().dimensions;
    const dataUrl = captureOrthographic(scene, roomWidthRender, roomLengthRender, {
      width: 800,
      height: 533,
    });
    if (dataUrl !== null) {
      await updatePublicThumbnail(configId, dataUrl);
    }
  } catch {
    // Best-effort: capture/upload failure must not block sending an enquiry.
  }
  return true;
}
