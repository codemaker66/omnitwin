import { type BufferGeometry, Matrix4 } from "three";
import { aoBox, aoRod, occlude, STANDING_FLOOR, type AoBox } from "./crafted-ao.js";
import { craftedDetail } from "./crafted-detail.js";
import { lathe, post, roundedBox, tube, type Vec3 } from "./crafted-geometry.js";
import type { CraftedMaterialId } from "./crafted-materials.js";
import type { CraftedPart } from "./crafted-model.js";
import { casterGeometry, contactSpots } from "./crafted-shadow.js";

// ---------------------------------------------------------------------------
// Presenting: the lectern, the screens and the speaker's kit
//
// After the venue's own photographs of the Grand Hall set for a talk: a
// black-framed fast-fold screen on its legs with a black dress skirt, a
// television on a mobile stand, microphones on tall stands; and a mahogany
// lectern to match the hall's panelling. The audience side of a screen or a
// lectern is +z (the side seated chairs at rotation 0 look at).
// ---------------------------------------------------------------------------

export interface AvSize {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/** Bakes every part against `boxes` and the floor. */
function baked(parts: readonly CraftedPart[], boxes: readonly AoBox[], strength = 0.7): CraftedPart[] {
  return parts.map((part) => (part.material === "shadow-caster" || part.material === "contact"
    ? part
    : { material: part.material, geometry: occlude(part.geometry, { boxes, floor: STANDING_FLOOR, strength }) }));
}

const rod = (material: CraftedMaterialId, points: Vec3[], radius: number, radial: number): CraftedPart => ({
  material,
  geometry: tube({ points, radius, tension: 0, segmentsPerMetre: 4, radialSegments: radial }),
});

/**
 * A fast-fold projection screen: a 16:9 matt white face in a black frame,
 * on two legs with splayed feet, a black dress skirt hiding the legs below
 * the picture.
 */
export function projectorScreenParts(size: AvSize): CraftedPart[] {
  const detail = craftedDetail();
  const { width, depth, height } = size;
  const frameW = width - 0.04;
  const frameH = Math.min(height - 0.28, (frameW * 9) / 16 + 0.08);
  const frameTop = height - 0.02;
  const frameBottom = frameTop - frameH;
  const frameCentre = (frameTop + frameBottom) / 2;
  const border = 0.04;
  const legX = frameW / 2 - 0.03;
  const footHalf = depth / 2 - 0.02;
  const radial = detail.rodRadial + 2;
  const parts: CraftedPart[] = [
    // The face, a hair proud of the frame toward the audience.
    { material: "screen-white", geometry: roundedBox([frameW - 2 * border, frameH - 2 * border, 0.006], 0.002, [0, frameCentre, 0.012], { segments: 1 }) },
    { material: "steel-black", geometry: roundedBox([frameW, frameH, 0.02], 0.004, [0, frameCentre, 0], { segments: 1 }) },
    // The dress skirt under the picture, to the floor.
    { material: "stage-skirt", geometry: roundedBox([frameW, frameBottom - 0.01, 0.012], 0.004, [0, (frameBottom - 0.01) / 2 + 0.01, 0.006], { segments: 1, grain: "y" }) },
  ];
  for (const side of [-1, 1] as const) {
    const x = side * legX;
    parts.push(rod("steel-black", [[x, 0.04, -0.02], [x, frameTop - 0.04, -0.02]], 0.016, radial));
    parts.push(rod("steel-black", [[x, 0.03, -footHalf], [x, 0.03, footHalf]], 0.014, radial));
    for (const z of [-footHalf, footHalf]) parts.push({ material: "rubber", geometry: post([x, z], 0, 0.035, 0.018, 0.016, radial) });
  }
  const boxes = [
    aoBox([frameW, frameH, 0.03], [0, frameCentre, 0.004]),
    aoBox([frameW, frameBottom, 0.014], [0, frameBottom / 2, 0.006]),
  ];
  const caster = casterGeometry([
    aoBox([frameW, frameTop - 0.01, 0.024], [0, (frameTop - 0.01) / 2 + 0.005, 0.004]),
    aoBox([0.04, 0.05, depth - 0.04], [-legX, 0.03, 0]),
    aoBox([0.04, 0.05, depth - 0.04], [legX, 0.03, 0]),
  ], { inset: 0.003 });
  return [...baked(parts, boxes), { material: "shadow-caster", geometry: caster }];
}

/** A television on a mobile stand: the screen on two uprights over a castored H-frame base. */
export function televisionParts(size: AvSize): CraftedPart[] {
  const detail = craftedDetail();
  const { width, depth, height } = size;
  const screenW = Math.min(width - 0.04, 1.46);
  const screenH = (screenW * 9) / 16 + 0.02;
  const top = height - 0.02;
  const centre = top - screenH / 2;
  const uprightX = Math.min(0.32, screenW * 0.22);
  const baseHalf = depth / 2 - 0.04;
  const radial = detail.rodRadial + 2;
  const parts: CraftedPart[] = [
    // The panel: a black glass face in a slim bezel, a deeper back.
    { material: "screen-glass", geometry: roundedBox([screenW - 0.012, screenH - 0.012, 0.004], 0.002, [0, centre, 0.026], { segments: 1 }) },
    { material: "steel-black", geometry: roundedBox([screenW, screenH, 0.05], 0.006, [0, centre, 0], { segments: 1 }) },
    // The mount behind the panel and the two uprights.
    { material: "steel-black", geometry: roundedBox([uprightX * 2 + 0.08, 0.36, 0.03], 0.004, [0, centre, -0.04], { segments: 1 }) },
  ];
  for (const side of [-1, 1] as const) {
    const x = side * uprightX;
    parts.push({ material: "aluminium", geometry: roundedBox([0.06, centre + 0.22, 0.035], 0.006, [x, (centre + 0.22) / 2, -0.06], { segments: 1, grain: "y" }) });
    parts.push(rod("steel-black", [[x, 0.06, -baseHalf], [x, 0.06, baseHalf]], 0.022, radial));
    for (const z of [-baseHalf, baseHalf]) {
      parts.push({ material: "rubber", geometry: post([x, z], 0, 0.06, 0.03, 0.03, radial) });
    }
  }
  parts.push(rod("steel-black", [[-uprightX, 0.07, -0.06], [uprightX, 0.07, -0.06]], 0.018, radial));
  const boxes = [aoBox([screenW, screenH, 0.05], [0, centre, 0])];
  const caster = casterGeometry([
    aoBox([screenW, screenH, 0.05], [0, centre, 0]),
    aoBox([0.05, centre, 0.03], [-uprightX, centre / 2, -0.06]),
    aoBox([0.05, centre, 0.03], [uprightX, centre / 2, -0.06]),
    aoBox([uprightX * 2 + 0.06, 0.05, depth - 0.06], [0, 0.06, 0]),
  ], { inset: 0.003 });
  return [...baked(parts, boxes), { material: "shadow-caster", geometry: caster }];
}

/** A tall microphone stand: a tripod base, a chrome tube and the clip at its head. */
export function micStandParts(size: AvSize): CraftedPart[] {
  const detail = craftedDetail();
  const { width, height } = size;
  const reach = width / 2 - 0.03;
  const hub = 0.32;
  const radial = detail.rodRadial + 1;
  const feet: Vec3[] = [];
  const parts: CraftedPart[] = [];
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const foot: Vec3 = [Math.cos(a) * reach, 0.012, Math.sin(a) * reach];
    feet.push(foot);
    parts.push(rod("steel-black", [[0, hub, 0], foot], 0.008, radial));
    parts.push({ material: "rubber", geometry: post([foot[0], foot[2]], 0, 0.016, 0.012, 0.011, radial) });
  }
  parts.push({ material: "steel-black", geometry: post([0, 0], hub - 0.05, hub + 0.03, 0.016, 0.016, radial + 2) });
  parts.push(rod("steel-black", [[0, hub, 0], [0, height * 0.62, 0]], 0.0115, radial));
  parts.push(rod("chrome", [[0, height * 0.6, 0], [0, height - 0.06, 0]], 0.008, radial));
  // The clutch where the two tubes meet, and the mic clip at the top.
  parts.push({ material: "steel-black", geometry: post([0, 0], height * 0.6, height * 0.64, 0.016, 0.014, radial + 2) });
  parts.push({ material: "steel-black", geometry: lathe([[0, height - 0.06], [0.012, height - 0.058], [0.016, height - 0.03], [0.014, height - 0.004], [0, height]], radial + 3) });
  const caster = casterGeometry([
    aoRod([0, 0, 0], [0, height, 0], 0.024),
    ...feet.map((foot) => aoRod([0, hub, 0], foot, 0.016)),
  ], { inset: 0.002, minimum: 0.012 });
  return [
    ...baked(parts, [], 0),
    { material: "contact", geometry: contactSpots(feet.map(([x, , z]) => ({ x, z, radius: 0.035 }))) },
    { material: "shadow-caster", geometry: caster },
  ];
}

/** Lays a post (built along y) along −z and moves it to `at`: a lens barrel facing the screen. */
function turned(geometry: BufferGeometry, at: Vec3): BufferGeometry {
  geometry.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  geometry.translate(at[0], at[1], at[2]);
  return geometry;
}

/** A laser projector: a rounded dark box with its lens to the screen (−z) and rubber feet. */
export function projectorParts(size: AvSize): CraftedPart[] {
  const { width, depth, height } = size;
  const detail = craftedDetail();
  const parts: CraftedPart[] = [
    { material: "plastic-dark", geometry: roundedBox([width, height - 0.012, depth], 0.02, [0, height / 2 + 0.006, 0], { segments: 3 }) },
    // The lens barrel and its glass, to the screen.
    // Set into the front face, its glass flush with it.
    { material: "steel-black", geometry: turned(post([0, 0], 0, 0.03, 0.034, 0.03, detail.radial + 6), [width * 0.25, height / 2 + 0.006, -depth / 2 + 0.03]) },
    { material: "screen-glass", geometry: turned(post([0, 0], 0.028, 0.0305, 0.026, 0.026, detail.radial + 6), [width * 0.25, height / 2 + 0.006, -depth / 2 + 0.03]) },
  ];
  for (const x of [-width * 0.38, width * 0.38]) {
    for (const z of [-depth * 0.35, depth * 0.35]) parts.push({ material: "rubber", geometry: post([x, z], 0, 0.008, 0.012, 0.012, 10) });
  }
  return [
    ...baked(parts, [aoBox([width, height, depth], [0, height / 2, 0])], 0.4),
    { material: "shadow-caster", geometry: casterGeometry([aoBox([width, height - 0.008, depth], [0, height / 2 + 0.004, 0])], { inset: 0.004 }) },
  ];
}

/** An open laptop: its base on the table, its screen tilted back, facing −z toward whoever uses it. */
export function laptopParts(size: AvSize): CraftedPart[] {
  const { width, depth, height } = size;
  const base = 0.016;
  const lid = 0.006;
  const tilt = (15 * Math.PI) / 180;
  const lidH = Math.min(height - base, depth * 0.95);
  // The catalogue's depth holds the open laptop: the lid leans back within it.
  const baseD = depth - lidH * Math.sin(tilt) - lid;
  const hinge: Vec3 = [0, base, -depth / 2 + baseD - 0.004];
  const lidCentre: Vec3 = [0, hinge[1] + (lidH / 2) * Math.cos(tilt), hinge[2] + (lidH / 2) * Math.sin(tilt)];
  const screen = roundedBox([width - 0.006, lidH, lid], 0.004, [0, 0, 0], { segments: 1 });
  screen.applyMatrix4(new Matrix4().makeRotationX(tilt));
  screen.translate(lidCentre[0], lidCentre[1], lidCentre[2]);
  const glass = roundedBox([width - 0.03, lidH - 0.03, 0.001], 0.0005, [0, 0, -lid / 2 - 0.0005], { segments: 1 });
  glass.applyMatrix4(new Matrix4().makeRotationX(tilt));
  glass.translate(lidCentre[0], lidCentre[1], lidCentre[2]);
  const parts: CraftedPart[] = [
    { material: "aluminium", geometry: roundedBox([width, base, baseD], 0.006, [0, base / 2, -(depth - baseD) / 2], { segments: 2 }) },
    { material: "plastic-dark", geometry: roundedBox([width - 0.03, 0.0015, baseD * 0.45], 0.0006, [0, base + 0.0006, -depth / 2 + baseD * 0.6], { segments: 1 }) },
    { material: "aluminium", geometry: screen },
    { material: "screen-glass", geometry: glass },
  ];
  return [
    ...baked(parts, [], 0),
    { material: "shadow-caster", geometry: casterGeometry([aoBox([width, base, baseD], [0, base / 2, -(depth - baseD) / 2])], { inset: 0.002, minimum: 0.01 }) },
  ];
}

/** A handheld microphone standing on its end: the black handle and the silver grille. */
export function handheldMicParts(size: AvSize): CraftedPart[] {
  const { width, height } = size;
  const r = Math.min(width / 2 - 0.004, 0.02);
  const radial = craftedDetail().radial + 4;
  const grille = r * 1.25;
  return [
    { material: "plastic-dark", geometry: lathe([[0, 0], [r * 0.7, 0], [r * 0.75, 0.01], [r, height - grille * 2.1], [r * 1.05, height - grille * 1.9], [0, height - grille * 1.9]], radial) },
    { material: "chrome", geometry: lathe([[0, height - grille * 1.95], [grille * 0.9, height - grille * 1.8], [grille, height - grille], [grille * 0.85, height - grille * 0.35], [0, height]], radial) },
    { material: "shadow-caster", geometry: casterGeometry([aoRod([0, 0, 0], [0, height, 0], r * 1.8)], { inset: 0.001, minimum: 0.012 }) },
  ];
}

/** A lapel microphone's set: the body-pack transmitter, its lead and the clip-on capsule. */
export function lapelMicParts(size: AvSize): CraftedPart[] {
  const { width, depth, height } = size;
  const packH = height * 0.8;
  return [
    { material: "plastic-dark", geometry: roundedBox([width * 0.8, packH, depth * 0.45], 0.006, [0, packH / 2, 0], { segments: 2 }) },
    { material: "steel-black", geometry: post([width * 0.18, 0], packH, height - 0.004, 0.003, 0.003, 8) },
    { material: "steel-black", geometry: roundedBox([0.008, 0.012, 0.008], 0.003, [width * 0.18, height - 0.006, 0], { segments: 1 }) },
  ];
}

/** A table microphone: a weighted base and a gooseneck to its capsule, facing the speaker (+z). */
export function tableMicParts(size: AvSize): CraftedPart[] {
  const { width, height } = size;
  const radial = craftedDetail().rodRadial + 3;
  const baseR = width / 2 - 0.004;
  const neck: Vec3[] = [[0, 0.03, 0], [0, height * 0.45, 0], [0, height * 0.8, 0.012], [0, height - 0.02, 0.03]];
  return [
    { material: "plastic-dark", geometry: lathe([[0, 0], [baseR, 0], [baseR, 0.012], [baseR * 0.7, 0.03], [0, 0.03]], radial + 6) },
    { material: "steel-black", geometry: tube({ points: neck, radius: 0.005, tension: 0.4, segmentsPerMetre: 60, radialSegments: radial }) },
    { material: "steel-black", geometry: post([0, 0.032], height - 0.03, height, 0.01, 0.008, radial) },
    { material: "shadow-caster", geometry: casterGeometry([aoBox([baseR * 1.8, 0.03, baseR * 1.8], [0, 0.015, 0]), aoRod(neck[0] ?? [0, 0, 0], neck[3] ?? [0, 0, 0], 0.012)], { inset: 0.001, minimum: 0.01 }) },
  ];
}

/**
 * The lectern: a mahogany box on a plinth, a raised panel to the audience
 * (+z), its reading desk sloping down toward the speaker (−z) with a ledge
 * to stop the papers.
 */
export function lecternParts(size: AvSize): CraftedPart[] {
  const { width, depth, height } = size;
  const plinth = 0.07;
  const run = depth - 0.04;
  const tilt = Math.tan((16 * Math.PI) / 180);
  // The desk falls from the audience's edge (+z, the full height) toward the speaker.
  const deskHigh = height;
  const deskLow = height - tilt * run;
  const deskMid = (deskHigh + deskLow) / 2;
  const deskThickness = 0.026;
  const bodyW = width - 0.06;
  const bodyD = depth - 0.08;
  const bodyZ = 0.02;
  // The body closes up under the desk: built to the height of its back, then its
  // upper vertices raised with the desk's slope, so its top lies under the desk.
  const bodyBack = bodyZ - bodyD / 2;
  const underDesk = (z: number): number => deskMid - deskThickness + (z * tilt);
  const backHeight = underDesk(bodyBack) - plinth;
  const frontHeight = backHeight + bodyD * tilt;
  const body = roundedBox([bodyW, backHeight, bodyD], 0.006, [0, plinth + backHeight / 2, bodyZ], { segments: 2, grain: "y" });
  const position = body.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    const rise = ((position.getY(i) - plinth) / backHeight) * tilt * (position.getZ(i) - bodyBack);
    position.setY(i, position.getY(i) + rise);
  }
  body.computeVertexNormals();
  const panelHeight = frontHeight - 0.16;
  const panelY = plinth + 0.08 + panelHeight / 2;
  const front = bodyZ + bodyD / 2;
  const parts: CraftedPart[] = [
    { material: "mahogany", geometry: roundedBox([width - 0.01, plinth, depth - 0.01], 0.008, [0, plinth / 2, 0], { segments: 2, grain: "x" }) },
    { material: "mahogany", geometry: body },
    // The raised panel to the audience, and its field.
    { material: "mahogany-dark", geometry: roundedBox([bodyW - 0.12, panelHeight, 0.012], 0.004, [0, panelY, front + 0.006], { segments: 2, grain: "y" }) },
    { material: "mahogany", geometry: roundedBox([bodyW - 0.16, panelHeight - 0.04, 0.018], 0.006, [0, panelY, front + 0.01], { segments: 2, grain: "y" }) },
  ];
  // The sloping desk, high to the audience, and the ledge a book rests on along its low edge.
  const desk = roundedBox([width, deskThickness, Math.hypot(deskHigh - deskLow, run) + 0.02], 0.006, [0, 0, 0], { segments: 2, grain: "z" });
  desk.applyMatrix4(new Matrix4().makeRotationX(-Math.atan(tilt)));
  desk.translate(0, deskMid - deskThickness / 2, 0);
  parts.push({ material: "mahogany-top", geometry: desk });
  const ledgeZ = -run / 2 + 0.012;
  parts.push({ material: "mahogany", geometry: roundedBox([width - 0.02, 0.03, 0.018], 0.006, [0, deskLow + 0.012 * tilt + 0.015, ledgeZ], { segments: 2, grain: "x" }) });
  const boxes = [
    aoBox([width, 0.03, depth], [0, deskMid, 0]),
    aoBox([bodyW, (backHeight + frontHeight) / 2, bodyD], [0, plinth + (backHeight + frontHeight) / 4, bodyZ]),
  ];
  const caster = casterGeometry([
    aoBox([width - 0.02, deskMid - 0.01, depth - 0.02], [0, (deskMid - 0.01) / 2 + 0.005, 0]),
  ], { inset: 0.004 });
  return [...baked(parts, boxes, 0.6), { material: "shadow-caster", geometry: caster }];
}
