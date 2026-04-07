import { useMemo } from "react";
import { CanvasTexture } from "three";
import { usePlacementStore } from "../stores/placement-store.js";
import { generateDiagramLabels } from "../lib/diagram-labels.js";

// ---------------------------------------------------------------------------
// DiagramLabels — renders alphanumeric codes above furniture in the 3D scene
//
// Used during orthographic capture to stamp T1, S1, AV1 codes onto the
// floor plan diagram. Also visible in the editor when sheet mode is active.
// ---------------------------------------------------------------------------

/** Whether diagram labels are currently visible (set before capture). */
let labelsVisible = false;

/** Show/hide diagram labels globally. */
export function setDiagramLabelsVisible(visible: boolean): void {
  labelsVisible = visible;
}

export function isDiagramLabelsVisible(): boolean {
  return labelsVisible;
}

/**
 * Renders floating text sprites above each labelled item.
 * Uses Three.js Sprite + CanvasTexture for renderer-native text
 * (works with orthographic capture, unlike Html overlays).
 */
export function DiagramLabels(): React.ReactElement | null {
  const placedItems = usePlacementStore((s) => s.placedItems);

  const labels = useMemo(() => generateDiagramLabels(placedItems), [placedItems]);

  if (!labelsVisible || labels.length === 0) return null;

  return (
    <group name="diagram-labels">
      {labels.map((label) => (
        <LabelSprite
          key={label.id}
          code={label.code}
          position={label.position}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// LabelSprite — billboarded text rendered as a sprite
// ---------------------------------------------------------------------------

interface LabelSpriteProps {
  readonly code: string;
  readonly position: readonly [number, number, number];
}

function LabelSprite({ code, position }: LabelSpriteProps): React.ReactElement {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      // White circle background with dark text
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
      ctx.fill();

      // Dark border
      ctx.strokeStyle = "#333333";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Text
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 48px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(code, size / 2, size / 2);
    }

    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [code]);

  return (
    <sprite
      position={[position[0], position[1], position[2]]}
      scale={[1.5, 1.5, 1]}
    >
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}
