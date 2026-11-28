import { seatsFor } from "@omnitwin/types";
import type { PlacedObject } from "../../api/configurations.js";
import { getCatalogueItem } from "../catalogue.js";
import { isDiningTableItem } from "../furniture-semantics.js";
import { SEATS_DEFAULT, SEATS_MAX, SEATS_MIN, type GuestList } from "./model.js";

// ---------------------------------------------------------------------------
// The room's tables, counted from the planner's own plan
//
// The guest list page reads the plan once and hands its placed objects here.
// This file only reads: it never writes the plan, and it never throws.
// A dining table is a catalogue piece that passes isDiningTableItem; a chair
// belongs to a table when both carry the same non-empty metadata.groupId.
// ---------------------------------------------------------------------------

export interface PlanTables {
  readonly tables: number;
  /** One figure a table, in the order the tables appear in the plan. */
  readonly seatsEach: readonly number[];
}

interface TableAt {
  readonly groupId: string;
  readonly x: number;
  readonly z: number;
  readonly usual: number;
  chairs: number;
}

/** A position held as a string in metres. Anything that is not a number is NaN. */
function metres(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/** How far a chair stands from a table; a position that does not parse is infinitely far. */
function distance(table: TableAt, chair: PlacedObject): number {
  const dx = table.x - metres(chair.positionX);
  const dz = table.z - metres(chair.positionZ);
  const d = Math.hypot(dx, dz);
  return Number.isFinite(d) ? d : Number.POSITIVE_INFINITY;
}

function clampSeats(n: number): number {
  return Math.min(SEATS_MAX, Math.max(SEATS_MIN, Math.round(n)));
}

function groupOf(object: PlacedObject): string {
  return object.metadata?.groupId ?? "";
}

export function planTables(objects: readonly PlacedObject[]): PlanTables {
  const tables: TableAt[] = [];
  const chairs: PlacedObject[] = [];

  for (const object of objects) {
    const item = getCatalogueItem(object.assetDefinitionId);
    if (item === undefined) continue;
    if (isDiningTableItem(item)) {
      tables.push({
        groupId: groupOf(object),
        x: metres(object.positionX),
        z: metres(object.positionZ),
        usual: seatsFor(item)?.default ?? SEATS_DEFAULT,
        chairs: 0,
      });
    } else if (item.category === "chair" && groupOf(object) !== "") {
      chairs.push(object);
    }
  }

  for (const chair of chairs) {
    const group = groupOf(chair);
    let nearest: TableAt | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const table of tables) {
      if (table.groupId !== group) continue;
      const d = distance(table, chair);
      // The first table of the group takes a chair that is infinitely far from all of them.
      if (nearest === null || d < nearestDistance) {
        nearest = table;
        nearestDistance = d;
      }
    }
    if (nearest !== null) nearest.chairs += 1;
  }

  return {
    tables: tables.length,
    seatsEach: tables.map((table) => clampSeats(table.chairs > 0 ? table.chairs : table.usual)),
  };
}

/**
 * The two counts when the room and the list disagree. Null when the list has
 * no tables yet (nothing to compare) or the counts agree.
 */
export function tablesDiffer(
  plan: PlanTables,
  list: GuestList,
): { readonly room: number; readonly list: number } | null {
  if (list.tables.length === 0 || list.tables.length === plan.tables) return null;
  return { room: plan.tables, list: list.tables.length };
}
