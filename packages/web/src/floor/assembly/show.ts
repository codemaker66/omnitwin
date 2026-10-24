// ---------------------------------------------------------------------------
// The Grand Assembly as a show over a saved layout.
//
// From the placed items it makes the arriving pieces (a layout diff from the
// empty room), plays them on the Accio model, and turns each tick into the
// frame the presentation channel draws (floor/presentation-channel.ts): for
// each piece still moving, the change from its placed transform, where its
// shadow lies and how far its candles have lit. Pieces at rest are left out
// of the frame and are drawn as placed; once everything rests the frame is
// null and the furniture is store truth again. Nothing here touches a store
// or the scene.
// ---------------------------------------------------------------------------

import { Matrix4 } from "three";
import type { PlacedItem } from "../../lib/placement.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { isSceneFurniturePlacement } from "../../lib/table-dressing.js";
import { normalizeFurnitureScale } from "../../lib/furniture-scale.js";
import type { PresentationFrame, PresentedPiece } from "../presentation-channel.js";
import { diffLayouts, hashString, type AssemblyPiece, type DescribePiece } from "./choreography.js";
import { accioModel, accioWindows, type AccioWindow } from "./accio.js";
import {
  createAssemblyPlayback,
  emptyPose,
  type AssemblyPlayback,
  type CameraPose,
  type DressingPose,
} from "./engine.js";
import { composePieceMatrix, savedPieceMatrix } from "./pose-matrix.js";

/** What the choreography needs of a placed item; null for rows that are not drawn furniture. */
export const describePiece: DescribePiece = (item) => {
  if (!isSceneFurniturePlacement(item)) return null;
  const catalogue = getCatalogueItem(item.catalogueItemId);
  if (catalogue === undefined) return null;
  const scale = normalizeFurnitureScale(item.scale);
  let role: AssemblyPiece["role"] = "piece";
  if (catalogue.category === "table") role = "table";
  else if (catalogue.category === "chair") role = "chair";
  return { role, height: catalogue.height * scale, radius: (Math.max(catalogue.width, catalogue.depth) * scale) / 2 };
};

/** Every drawn piece of a layout, arriving into the empty room. */
export function assemblyPieces(items: readonly PlacedItem[]): readonly AssemblyPiece[] {
  return diffLayouts([], items, describePiece).arriving;
}

/** The seed a layout always assembles with: the same layout plays the same way every time. */
export function assemblySeed(configId: string | null): number {
  return hashString(configId ?? "venviewer-layout");
}

export interface AssemblyShowOptions {
  readonly seed: number;
  /** Complete at once (prefers-reduced-motion). */
  readonly reducedMotion?: boolean;
  /** A portrait view frames the hall down its length. */
  readonly portrait?: boolean;
}

export interface AssemblyShow {
  /** The placed items it was made for; any other items mean it no longer applies. */
  readonly items: readonly PlacedItem[];
  readonly pieces: readonly AssemblyPiece[];
  readonly playback: AssemblyPlayback;
  readonly windows: readonly AccioWindow[];
  /** Step to `seconds` from its start; an earlier time replays from the start (same result). */
  advanceTo(seconds: number): void;
  /** This tick as the presentation channel draws it, or null once everything rests as placed. */
  frame(): PresentationFrame | null;
  /** The camera this tick, or null to leave it where it is. */
  camera(): CameraPose | null;
  /** A window's light, 0 to 1. */
  light(id: string): number;
  /** Everything to its true state at once, the camera to its final framing. */
  skip(): void;
  /** Everything to its true state at once, the camera left where it is. */
  cancel(): void;
  done(): boolean;
}

interface PieceRecord {
  readonly piece: AssemblyPiece;
  readonly placedInverse: Matrix4;
  readonly presented: PresentedPiece;
  readonly table: boolean;
}

const pose = emptyPose();
const drawn = new Matrix4();
const dressing: DressingPose = { wax: 1, flame: 1, glow: 1 };

export function createAssemblyShow(items: readonly PlacedItem[], options: AssemblyShowOptions): AssemblyShow {
  const pieces = assemblyPieces(items);
  const playback = createAssemblyPlayback(pieces, accioModel({ portrait: options.portrait }), options.seed, {
    reducedMotion: options.reducedMotion,
  });
  const records: PieceRecord[] = pieces.map((piece) => ({
    piece,
    placedInverse: savedPieceMatrix(piece.x, piece.y, piece.z, piece.rotationY, piece.scale, new Matrix4()).invert(),
    presented: {
      visible: false, delta: new Matrix4(), shadowX: piece.x, shadowZ: piece.z, shadowYaw: piece.rotationY,
      shadow: 0, shadowSpread: 1, wax: 0, flame: 0, glow: 0,
    },
    table: playback.graph.dressing.has(piece.id),
  }));
  const shown = new Map<string, PresentedPiece>();

  return {
    items,
    pieces,
    playback,
    windows: accioWindows(),
    advanceTo: (seconds) => { playback.advanceTo(seconds); },
    frame: () => {
      if (playback.done()) return null;
      shown.clear();
      for (const record of records) {
        const { piece, presented } = record;
        const candles = record.table && playback.dressing(piece.id, dressing);
        const candlesLit = !candles || (dressing.wax >= 1 && dressing.flame >= 1 && dressing.glow >= 1);
        if (playback.isDone(piece.id) && candlesLit) continue;
        playback.pose(piece.id, pose);
        presented.visible = pose.visible;
        if (pose.visible) {
          composePieceMatrix(pose, piece.scale, drawn);
          presented.delta.multiplyMatrices(drawn, record.placedInverse);
        }
        presented.shadowX = pose.x;
        presented.shadowZ = pose.z;
        presented.shadowYaw = pose.yaw;
        presented.shadow = pose.visible ? pose.shadow : 0;
        presented.shadowSpread = pose.shadowSpread;
        presented.wax = candles ? dressing.wax : 1;
        presented.flame = candles ? dressing.flame : 1;
        presented.glow = candles ? dressing.glow : 1;
        shown.set(piece.id, presented);
      }
      return { pieces: shown, others: "placed" };
    },
    camera: () => playback.camera(),
    light: (id) => playback.light(id),
    skip: () => { playback.skip(); },
    cancel: () => { playback.cancel(); },
    done: () => playback.done(),
  };
}
