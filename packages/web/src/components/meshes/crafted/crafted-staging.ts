import { type BufferGeometry, Float32BufferAttribute } from "three";
import { aoBox, occlude, STANDING_FLOOR } from "./crafted-ao.js";
import { craftedDetail } from "./crafted-detail.js";
import { gatheredSkirt, roundedBox } from "./crafted-geometry.js";
import type { CraftedPart } from "./crafted-model.js";
import { casterGeometry } from "./crafted-shadow.js";

// ---------------------------------------------------------------------------
// Staging and the dance floor
//
// The venue's staging is sectional decks (thirteen 6 × 4 ft and two 6 × 3 ft
// in its inventory) set side by side into a stage: a black phenolic face
// with a hexagon tread, an aluminium edge, and a black box-pleated skirt to
// the floor that hides the legs. Every deck and platform size is the same
// build at its own footprint.
//
// The dance floor is the UK hire floor's 3 ft panel, laid edge to edge: a
// lacquered oak parquet face (one panel's chequer per map tile, so the joints
// line up from panel to panel) on an aluminium-edged base whose face shows
// only where the floor ends. A floor of a hundred panels is one batch.
// ---------------------------------------------------------------------------

export interface StagingSize {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/** A staging deck or platform: phenolic face, aluminium edge, pleated skirt. */
export function stagingDeckParts(size: StagingSize): CraftedPart[] {
  const detail = craftedDetail();
  const { width, depth, height } = size;
  const face = 0.018;
  const band = Math.min(0.06, height * 0.2);
  const deck = { boxes: [aoBox([width, band + face, depth], [0, height - (band + face) / 2, 0], "deck")] };
  const parts: CraftedPart[] = [
    {
      material: "deck-phenolic",
      geometry: occlude(roundedBox([width - 0.01, face, depth - 0.01], 0.003, [0, height - face / 2, 0], { segments: 1, grain: "x" }), {}),
    },
    {
      material: "aluminium",
      geometry: occlude(roundedBox([width, band, depth], 0.004, [0, height - face - band / 2 + 0.004, 0], { segments: 1 }), {}),
    },
    {
      material: "stage-skirt",
      geometry: occlude(
        gatheredSkirt({
          // Set in by its folds' depth, so the pleats stay inside the footprint.
          width: width - 0.032,
          depth: depth - 0.032,
          top: height - face - band + 0.006,
          pinned: 0.004,
          hem: 0.004,
          offset: 0.0015,
          spacing: detail.level === "full" ? 0.05 : 0.08,
          foldDepth: 0.007,
          emergeOver: 0.025,
          seed: 41,
        }),
        { ...deck, self: ["deck"], floor: STANDING_FLOOR, strength: 0.6, floorValue: 0.45 },
      ),
    },
    { material: "shadow-caster", geometry: casterGeometry([aoBox([width - 0.006, height - 0.004, depth - 0.006], [0, height / 2, 0])], { inset: 0 }) },
  ];
  return parts;
}

/**
 * A 3 ft dance floor panel: the parquet face, its edges eased so the joint
 * between two panels reads as a fine seam, on an aluminium-edged base.
 */
export function danceFloorPanelParts(size: StagingSize): CraftedPart[] {
  const { width, depth, height } = size;
  const face = Math.min(0.016, height * 0.32);
  const top = roundedBox([width, face, depth], 0.0025, [0, height - face / 2, 0], { segments: 1 });
  // One panel's parquet per tile, from its corner, whatever the panel's size.
  const position = top.getAttribute("position");
  const normal = top.getAttribute("normal");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    const upright = Math.abs(normal.getY(i)) > 0.5;
    uv[i * 2] = (position.getX(i) + width / 2) * (0.91 / width);
    uv[i * 2 + 1] = upright ? (position.getZ(i) + depth / 2) * (0.91 / depth) : position.getY(i);
  }
  top.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  const base: BufferGeometry = roundedBox([width - 0.002, height - face, depth - 0.002], 0.002, [0, (height - face) / 2, 0], { segments: 1 });
  return [
    { material: "parquet", geometry: occlude(top, {}) },
    { material: "aluminium", geometry: occlude(base, { floor: STANDING_FLOOR, strength: 0.5 }) },
    { material: "shadow-caster", geometry: casterGeometry([aoBox([width - 0.004, height - 0.004, depth - 0.004], [0, height / 2, 0])], { inset: 0 }) },
  ];
}
