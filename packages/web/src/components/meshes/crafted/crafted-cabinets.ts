import { CylinderGeometry, Matrix4, type BufferGeometry } from "three";
import {
  gatheredSkirt,
  lathe,
  normalizeAttributes,
  post,
  roundedBox,
  tube,
  type Vec3,
} from "./crafted-geometry.js";
import type { CraftedMaterialId } from "./crafted-materials.js";
import type { CraftedPart } from "./crafted-model.js";

// ---------------------------------------------------------------------------
// Crafted cabinets and staging
//
// After the pieces Blake supplied: the mahogany bar with three raised panels
// to the guests and an open service side (cubbies, a drip mat, an ice well);
// the dark servery with two doors to the staff and a brass lattice and three
// panels to the room, on brass castors; the staging platform, a felt deck in
// a pleated black skirt; and the folding divider, black panels hinged on
// posts between two castored end frames. Fronts face -z, as the supplied
// models do. Everything is drawn to the catalogue's footprint and height.
// ---------------------------------------------------------------------------

export interface CabinetSize {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/** Turns a part built facing -z to face another way round the y axis. */
function turned(geometry: BufferGeometry, angle: number): BufferGeometry {
  if (angle !== 0) geometry.applyMatrix4(new Matrix4().makeRotationY(angle));
  return geometry;
}

/**
 * A raised and fielded panel facing -z with its back on z = 0: a bevelled
 * field standing proud inside a small moulding, the way the supplied bar's
 * and servery's panels are made.
 */
function raisedPanel(width: number, height: number, centre: readonly [number, number], material: CraftedMaterialId): CraftedPart[] {
  const [x, y] = centre;
  const strip = 0.018;
  const parts: CraftedPart[] = [
    { material, geometry: roundedBox([width - 2 * strip - 0.01, height - 2 * strip - 0.01, 0.024], 0.009, [x, y, -0.004], { segments: 2, grain: "y" }) },
  ];
  // The moulding round the field.
  for (const sign of [-1, 1] as const) {
    parts.push({ material, geometry: roundedBox([width, strip, 0.02], 0.006, [x, y + sign * (height - strip) / 2, -0.002], { segments: 2, grain: "x" }) });
    parts.push({ material, geometry: roundedBox([strip, height - 2 * strip, 0.02], 0.006, [x + sign * (width - strip) / 2, y, -0.002], { segments: 2, grain: "y" }) });
  }
  return parts;
}

/** Places parts built facing -z on the face of a body: `angle` turns them, `offset` moves them out to the face. */
function onFace(parts: readonly CraftedPart[], angle: number, offset: number): CraftedPart[] {
  return parts.map((part) => {
    part.geometry.translate(0, 0, -offset);
    return { material: part.material, geometry: turned(part.geometry, angle) };
  });
}

/** A swivel castor: a wheel in a yoke under a plate, with a stem up to `stemTop` if given. */
function castor(
  x: number,
  z: number,
  yoke: CraftedMaterialId,
  wheelMaterial: CraftedMaterialId,
  wheelRadius = 0.025,
  stemTop?: number,
): CraftedPart[] {
  const wheel = new CylinderGeometry(wheelRadius, wheelRadius, 0.02, 16, 1, false);
  wheel.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
  wheel.translate(x, wheelRadius, z);
  const top = wheelRadius * 2 + 0.012;
  const parts: CraftedPart[] = [
    { material: wheelMaterial, geometry: normalizeAttributes(wheel) },
    { material: yoke, geometry: roundedBox([0.03, wheelRadius + 0.012, 0.03], 0.005, [x, wheelRadius + (wheelRadius + 0.012) / 2, z + 0.006], { segments: 1 }) },
    { material: yoke, geometry: roundedBox([0.05, 0.006, 0.05], 0.002, [x, top, z], { segments: 1 }) },
  ];
  if (stemTop !== undefined && stemTop > top) parts.push({ material: yoke, geometry: post([x, z], top, stemTop, 0.008) });
  return parts;
}

/** The bar: three raised panels to the guests, an open service side behind. */
export function barCounterParts(size: CabinetSize): CraftedPart[] {
  const { width, depth, height } = size;
  const bodyW = width - 0.08;
  const bodyD = depth - 0.08;
  const plinth = 0.1;
  const topThickness = 0.045;
  const corniceBottom = height - topThickness - 0.055;
  const bodyH = corniceBottom - plinth;
  const bodyY = plinth + bodyH / 2;
  const board = 0.022;
  const parts: CraftedPart[] = [
    // The counter top and a stepped cornice under it.
    { material: "mahogany-top", geometry: roundedBox([width, topThickness, depth], 0.012, [0, height - topThickness / 2, 0], { segments: 3, grain: "x" }) },
    { material: "mahogany", geometry: roundedBox([width - 0.03, 0.03, depth - 0.03], 0.008, [0, height - topThickness - 0.015, 0], { segments: 2, grain: "x" }) },
    { material: "mahogany", geometry: roundedBox([width - 0.055, 0.025, depth - 0.055], 0.006, [0, height - topThickness - 0.0425, 0], { segments: 2, grain: "x" }) },
    // The plinth, with a moulding along its top.
    { material: "mahogany", geometry: roundedBox([width - 0.05, plinth, depth - 0.05], 0.006, [0, plinth / 2, 0], { segments: 2, grain: "x" }) },
    { material: "mahogany", geometry: roundedBox([width - 0.04, 0.016, depth - 0.04], 0.006, [0, plinth, 0], { segments: 2, grain: "x" }) },
    // The carcass: front and sides; the service side is open.
    { material: "mahogany", geometry: roundedBox([bodyW, bodyH, board], 0.004, [0, bodyY, -(bodyD - board) / 2], { segments: 1, grain: "y" }) },
    { material: "mahogany", geometry: roundedBox([board, bodyH, bodyD], 0.004, [-(bodyW - board) / 2, bodyY, 0], { segments: 1, grain: "y" }) },
    { material: "mahogany", geometry: roundedBox([board, bodyH, bodyD], 0.004, [(bodyW - board) / 2, bodyY, 0], { segments: 1, grain: "y" }) },
  ];
  // Three raised panels across the front, one on each side.
  const gap = 0.09;
  const panelW = (bodyW - 4 * gap) / 3;
  const panelH = bodyH - 2 * 0.1;
  const front: CraftedPart[] = [];
  for (let i = -1; i <= 1; i += 1) front.push(...raisedPanel(panelW, panelH, [i * (panelW + gap), bodyY], "mahogany"));
  parts.push(...onFace(front, 0, bodyD / 2));
  for (const angle of [Math.PI / 2, -Math.PI / 2]) {
    parts.push(...onFace(raisedPanel(bodyD - 2 * gap, panelH, [0, bodyY], "mahogany"), angle, bodyW / 2));
  }

  // The service side: a work shelf at counter height for the bartender, a
  // drip mat over cubbies on the left, an ice well over a shelf on the right.
  const innerW = bodyW - 2 * board;
  const innerD = bodyD - board;
  const innerZ = board / 2;
  const shelfY = height - 0.36;
  const half = innerW / 2;
  parts.push({ material: "stainless", geometry: roundedBox([innerW, 0.02, innerD], 0.003, [0, plinth + 0.02, innerZ], { segments: 1 }) });
  parts.push({ material: "stainless", geometry: roundedBox([half - 0.01, 0.025, innerD], 0.003, [-half / 2, shelfY, innerZ], { segments: 1 }) });
  parts.push({ material: "rubber", geometry: roundedBox([half - 0.06, 0.012, innerD - 0.06], 0.004, [-half / 2, shelfY + 0.018, innerZ], { segments: 1 }) });
  parts.push({ material: "stainless", geometry: roundedBox([half - 0.01, 0.018, innerD], 0.003, [-half / 2, (plinth + shelfY) / 2, innerZ], { segments: 1 }) });
  parts.push({ material: "stainless", geometry: roundedBox([0.018, shelfY - plinth - 0.03, innerD], 0.003, [-half / 2, (plinth + shelfY) / 2 + 0.005, innerZ], { segments: 1 }) });
  parts.push({ material: "stainless", geometry: roundedBox([0.018, shelfY - plinth - 0.03, innerD], 0.003, [0, (plinth + shelfY) / 2 + 0.005, innerZ], { segments: 1 }) });
  // The ice well: an open stainless box with a speed rail along its service edge.
  const wellW = half - 0.06;
  const wellD = innerD - 0.08;
  const wellDepth = 0.24;
  const wellTop = shelfY + 0.015;
  const wellX = half / 2;
  const wall = 0.012;
  parts.push({ material: "stainless", geometry: roundedBox([wellW, wall, wellD], 0.003, [wellX, wellTop - wellDepth, innerZ], { segments: 1 }) });
  for (const sign of [-1, 1] as const) {
    parts.push({ material: "stainless", geometry: roundedBox([wall, wellDepth, wellD], 0.003, [wellX + sign * (wellW - wall) / 2, wellTop - wellDepth / 2, innerZ], { segments: 1 }) });
    parts.push({ material: "stainless", geometry: roundedBox([wellW, wellDepth, wall], 0.003, [wellX, wellTop - wellDepth / 2, innerZ + sign * (wellD - wall) / 2], { segments: 1 }) });
  }
  parts.push({ material: "stainless", geometry: roundedBox([wellW + 0.04, 0.012, 0.03], 0.004, [wellX, wellTop, innerZ + wellD / 2 + 0.015], { segments: 1 }) });
  parts.push({ material: "stainless", geometry: roundedBox([wellW, 0.07, 0.05], 0.006, [wellX, wellTop - 0.13, depth / 2 - 0.07], { segments: 1 }) });
  parts.push({ material: "stainless", geometry: roundedBox([half - 0.01, 0.018, innerD], 0.003, [wellX, plinth + 0.2, innerZ], { segments: 1 }) });
  return parts;
}

/** The servery: two doors to the staff (-z), a brass lattice and three panels to the room (+z), on castors. */
export function serveryParts(size: CabinetSize): CraftedPart[] {
  const { width, depth, height } = size;
  const castorTop = 0.07;
  const topThickness = 0.035;
  const bodyW = width - 0.06;
  // Set back so the doors and knobs stay within the footprint.
  const bodyD = depth - 0.08;
  const bodyTop = height - topThickness - 0.025;
  const bodyBottom = castorTop + 0.005;
  const bodyH = bodyTop - bodyBottom;
  const bodyY = (bodyTop + bodyBottom) / 2;
  const wood: CraftedMaterialId = "mahogany-dark";
  const parts: CraftedPart[] = [
    { material: "mahogany-top", geometry: roundedBox([width, topThickness, depth], 0.01, [0, height - topThickness / 2, 0], { segments: 3, grain: "x" }) },
    { material: wood, geometry: roundedBox([width - 0.025, 0.025, depth - 0.025], 0.007, [0, height - topThickness - 0.0125, 0], { segments: 2, grain: "x" }) },
    { material: wood, geometry: roundedBox([bodyW, bodyH, bodyD], 0.006, [0, bodyY, 0], { segments: 1, grain: "y" }) },
    { material: wood, geometry: roundedBox([bodyW + 0.012, 0.035, bodyD + 0.012], 0.006, [0, bodyBottom + 0.0175, 0], { segments: 2, grain: "x" }) },
  ];
  const stile = 0.1;
  const innerW = bodyW - 2 * stile;
  // The staff side: end stiles and two doors, each with a fielded panel and a brass knob.
  const staff: CraftedPart[] = [];
  for (const sign of [-1, 1] as const) {
    staff.push({ material: wood, geometry: roundedBox([stile, bodyH - 0.04, 0.012], 0.004, [sign * (bodyW - stile) / 2, bodyY + 0.005, -0.006], { segments: 1, grain: "y" }) });
    const doorW = innerW / 2 - 0.006;
    const doorH = bodyH - 0.09;
    const doorX = sign * (innerW / 4 + 0.001);
    staff.push({ material: wood, geometry: roundedBox([doorW, doorH, 0.018], 0.004, [doorX, bodyY + 0.01, -0.009], { segments: 1, grain: "y" }) });
    for (const panel of raisedPanel(doorW - 0.12, doorH - 0.12, [doorX, bodyY + 0.01], wood)) {
      panel.geometry.translate(0, 0, -0.018);
      staff.push(panel);
    }
    staff.push({ material: "brass", geometry: lathe([[0, 0], [0.006, 0], [0.006, 0.009], [0.012, 0.015], [0.011, 0.021], [0, 0.022]], 16).applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2)).translate(sign * 0.028, bodyY + 0.02, -0.018) });
  }
  parts.push(...onFace(staff, 0, bodyD / 2));
  // The room side: pilasters, the brass lattice under the top, three panels below.
  const room: CraftedPart[] = [];
  const latticeH = 0.12;
  const latticeY = bodyTop - 0.04 - latticeH / 2;
  for (const sign of [-1, 1] as const) {
    room.push({ material: wood, geometry: roundedBox([stile, bodyH - 0.04, 0.016], 0.004, [sign * (bodyW - stile) / 2, bodyY + 0.005, -0.008], { segments: 1, grain: "y" }) });
  }
  room.push({ material: "brass-grille", geometry: roundedBox([innerW - 0.06, latticeH, 0.006], 0.002, [0, latticeY, -0.003], { segments: 1, grain: "x" }) });
  for (const sign of [-1, 1] as const) {
    room.push({ material: wood, geometry: roundedBox([innerW - 0.02, 0.018, 0.016], 0.005, [0, latticeY + sign * (latticeH / 2 + 0.009), -0.008], { segments: 2, grain: "x" }) });
  }
  const panelGap = 0.05;
  const panelW = (innerW - 4 * panelGap) / 3;
  const panelTop = latticeY - latticeH / 2 - 0.05;
  const panelBottom = bodyBottom + 0.07;
  const panelH = panelTop - panelBottom;
  for (let i = -1; i <= 1; i += 1) room.push(...raisedPanel(panelW, panelH, [i * (panelW + panelGap), (panelTop + panelBottom) / 2], wood));
  parts.push(...onFace(room, Math.PI, bodyD / 2));
  // Six brass castors.
  for (const x of [-(bodyW / 2 - 0.07), 0, bodyW / 2 - 0.07]) {
    for (const z of [-(bodyD / 2 - 0.06), bodyD / 2 - 0.06]) parts.push(...castor(x, z, "brass", "rubber", 0.026));
  }
  return parts;
}

/** A staging platform: a felt deck with a pleated black skirt to the floor. */
export function platformParts(size: CabinetSize): CraftedPart[] {
  const { width, depth, height } = size;
  return [
    { material: "stage-felt", geometry: roundedBox([width, 0.022, depth], 0.006, [0, height - 0.011, 0], { segments: 2, grain: "x" }) },
    {
      material: "stage-skirt",
      geometry: gatheredSkirt({
        width: width - 0.012,
        depth: depth - 0.012,
        top: height - 0.004,
        pinned: 0.014,
        hem: 0.004,
        offset: 0.002,
        spacing: 0.05,
        foldDepth: 0.006,
        emergeOver: 0.03,
        seed: 41,
      }),
    },
  ];
}

/** The folding divider: hinged black panels between two castored end frames. */
export function roomDividerParts(size: CabinetSize): CraftedPart[] {
  const { width, depth, height } = size;
  const frameInset = 0.06;
  const panelSpan = width - 2 * frameInset - 0.04;
  const panels = Math.max(2, Math.round(panelSpan / 0.5));
  const pitch = panelSpan / panels;
  const panelBottom = 0.11;
  const panelTop = height - 0.05;
  const panelH = panelTop - panelBottom;
  const parts: CraftedPart[] = [];
  for (let i = 0; i < panels; i += 1) {
    const x = -panelSpan / 2 + pitch * (i + 0.5);
    parts.push({ material: "divider-fabric", geometry: roundedBox([pitch - 0.016, panelH, 0.032], 0.01, [x, panelBottom + panelH / 2, 0], { segments: 2, grain: "y" }) });
  }
  // Hinge posts between panels and at each end, each on a castor.
  for (let i = 0; i <= panels; i += 1) {
    const x = -panelSpan / 2 + pitch * i;
    parts.push({ material: "steel-black", geometry: roundedBox([0.014, panelH + 0.01, 0.026], 0.005, [x, panelBottom + panelH / 2, 0], { segments: 1 }) });
    parts.push(...castor(x, 0, "chrome", "rubber", 0.022, panelBottom - 0.004));
  }
  // The end frames: an upright with a foot across the line, castors at its ends.
  const footHalf = depth / 2 - 0.03;
  for (const side of [-1, 1] as const) {
    const x = side * (width / 2 - frameInset / 2);
    const upright: Vec3[] = [[x, 0.075, 0], [x, panelTop + 0.02, 0]];
    parts.push({ material: "chrome", geometry: tube({ points: upright, radius: 0.014, tension: 0, segmentsPerMetre: 4, radialSegments: 12 }) });
    parts.push({ material: "chrome", geometry: tube({ points: [[x, 0.075, -footHalf], [x, 0.075, footHalf]], radius: 0.014, tension: 0, segmentsPerMetre: 4, radialSegments: 12 }) });
    // A bracing arc from the foot up into the upright.
    for (const z of [-1, 1]) {
      parts.push({ material: "chrome", geometry: tube({ points: [[x, 0.075, z * footHalf * 0.75], [x, 0.3, z * footHalf * 0.3], [x, 0.5, 0]], radius: 0.01, tension: 0.4, segmentsPerMetre: 30, radialSegments: 10 }) });
    }
    for (const z of [-footHalf, footHalf]) parts.push(...castor(x, z, "chrome", "rubber", 0.022));
    // Clamps from the end post to the upright.
    const postX = side * (panelSpan / 2);
    for (const y of [panelBottom + 0.12, (panelBottom + panelTop) / 2, panelTop - 0.12]) {
      parts.push({ material: "chrome", geometry: tube({ points: [[postX, y, 0], [x, y, 0]], radius: 0.008, tension: 0, segmentsPerMetre: 4, radialSegments: 8 }) });
    }
  }
  return parts;
}
