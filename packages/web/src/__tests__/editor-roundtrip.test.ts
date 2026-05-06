import { describe, it, expect } from "vitest";
import {
  editorToBatch,
  placedObjectToEditor,
  type EditorObject,
} from "../stores/editor-store.js";
import {
  editorToPlacedItem,
  placedItemToEditor,
} from "../components/editor/EditorBridge.js";
import { getCatalogueItemBySlug } from "../lib/catalogue.js";
import type { PlacedObject, BatchObjectInput } from "../api/configurations.js";
import type { PlacedItem } from "../lib/placement.js";

const ROUND_TABLE_ID = getCatalogueItemBySlug("round-table-6ft")?.id ?? "missing-round-table-id";
const CHAIR_ID = getCatalogueItemBySlug("banquet-chair")?.id ?? "missing-chair-id";

// ---------------------------------------------------------------------------
// Data integrity round-trip tests — punch list #31
//
// These tests pin the contract that a user's layout survives save+reload.
// Historically the EditorBridge hard-coded clothed=false, groupId=null,
// rotationX=0, rotationZ=0, scale=1, sortOrder=0 on every write, silently
// destroying group structure (table+chairs), cloth state, and sort order on
// reload. These tests exist to make sure that regression never ships again.
//
// There are two round-trips to verify:
//
//   1. EditorObject <-> BatchObjectInput <-> PlacedObject
//      (the wire format boundary — client <-> API)
//
//   2. EditorObject <-> PlacedItem <-> EditorObject
//      (the scene boundary — editor store <-> R3F placement store)
//
// If both round-trips preserve every field, a full save -> DB -> reload
// cycle is data-integrity safe.
// ---------------------------------------------------------------------------

/**
 * Simulate the API's database round-trip: convert a BatchObjectInput into
 * the PlacedObject shape the API returns from GET. Numeric fields come back
 * as strings (drizzle numeric columns), metadata comes back as JSON.
 *
 * Real postgres round-trip is covered by backend integration tests; this
 * helper models the wire format so the frontend contract can be tested
 * as a pure function.
 */
function simulateDbRoundTrip(
  batch: BatchObjectInput,
  id: string,
  configurationId: string,
): PlacedObject {
  return {
    id,
    configurationId,
    assetDefinitionId: batch.assetDefinitionId,
    positionX: String(batch.positionX),
    positionY: String(batch.positionY),
    positionZ: String(batch.positionZ),
    rotationX: String(batch.rotationX),
    rotationY: String(batch.rotationY),
    rotationZ: String(batch.rotationZ),
    scale: String(batch.scale),
    sortOrder: batch.sortOrder,
    metadata: batch.metadata ?? null,
  };
}

// ---------------------------------------------------------------------------
// Wire format round-trip — EditorObject <-> API
// ---------------------------------------------------------------------------

describe("EditorObject <-> wire format round-trip", () => {
  it("preserves every field for a grouped, clothed round table", () => {
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      assetDefinitionId: ROUND_TABLE_ID,
      positionX: 3.25,
      positionY: 0,
      positionZ: -1.75,
      rotationX: 0.1,
      rotationY: Math.PI / 4,
      rotationZ: -0.2,
      scale: 1.05,
      sortOrder: 7,
      clothed: true,
      groupId: "group-abc",
      notes: "",
    };

    const batch = editorToBatch(original);
    const wire = simulateDbRoundTrip(batch, original.id, "config-1");
    const roundTripped = placedObjectToEditor(wire);

    expect(roundTripped).toEqual(original);
  });

  it("preserves an ungrouped chair with default scene state", () => {
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      assetDefinitionId: CHAIR_ID,
      positionX: -2.5,
      positionY: 0,
      positionZ: 4.0,
      rotationX: 0,
      rotationY: Math.PI,
      rotationZ: 0,
      scale: 1,
      sortOrder: 0,
      clothed: false,
      groupId: null,
      notes: "",
    };

    const batch = editorToBatch(original);
    const wire = simulateDbRoundTrip(batch, original.id, "config-1");
    const roundTripped = placedObjectToEditor(wire);

    expect(roundTripped).toEqual(original);
  });

  it("preserves sort order across the wire (diligence: pinned at 7)", () => {
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440002",
      assetDefinitionId: "trestle-6ft",
      positionX: 0, positionY: 0, positionZ: 0,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: 7,
      clothed: false, groupId: null, notes: "",
    };

    const batch = editorToBatch(original);
    expect(batch.sortOrder).toBe(7);

    const wire = simulateDbRoundTrip(batch, original.id, "config-1");
    const roundTripped = placedObjectToEditor(wire);
    expect(roundTripped.sortOrder).toBe(7);
  });

  it("planner notes round-trip through the wire when set", () => {
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440004",
      assetDefinitionId: ROUND_TABLE_ID,
      positionX: 0, positionY: 0, positionZ: 0,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: 0,
      clothed: true, groupId: "g-vip", notes: "VIP table — reserved for the Anderson family",
    };
    const batch = editorToBatch(original);
    expect(batch.metadata).toEqual({
      clothed: true,
      groupId: "g-vip",
      notes: "VIP table — reserved for the Anderson family",
    });
    const wire = simulateDbRoundTrip(batch, original.id, "config-1");
    const roundTripped = placedObjectToEditor(wire);
    expect(roundTripped.notes).toBe(original.notes);
  });

  it("hallkeeper-visible display labels round-trip through metadata", () => {
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440006",
      assetDefinitionId: CHAIR_ID,
      positionX: 0, positionY: 0, positionZ: 0,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: 0,
      clothed: false, groupId: null, label: "Bride", notes: "",
    };

    const batch = editorToBatch(original);
    expect(batch.metadata).toEqual({
      clothed: false,
      groupId: null,
      displayLabel: "Bride",
    });

    const wire = simulateDbRoundTrip(batch, original.id, "config-1");
    const roundTripped = placedObjectToEditor(wire);
    expect(roundTripped.label).toBe("Bride");
  });

  it("empty display labels are omitted from the metadata blob", () => {
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440007",
      assetDefinitionId: CHAIR_ID,
      positionX: 0, positionY: 0, positionZ: 0,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: 0,
      clothed: false, groupId: null, label: "   ", notes: "",
    };

    const batch = editorToBatch(original);
    expect(batch.metadata).not.toHaveProperty("displayLabel");
  });


  it("empty notes field is omitted from the metadata blob to keep records lean", () => {
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440005",
      assetDefinitionId: CHAIR_ID,
      positionX: 0, positionY: 0, positionZ: 0,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: 0,
      clothed: false, groupId: null, notes: "",
    };
    const batch = editorToBatch(original);
    expect(batch.metadata).not.toHaveProperty("notes");
  });

  it("wire format carries clothed/groupId inside metadata blob", () => {
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440003",
      assetDefinitionId: ROUND_TABLE_ID,
      positionX: 0, positionY: 0, positionZ: 0,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: 0,
      clothed: true, groupId: "g-xyz", notes: "",
    };

    const batch = editorToBatch(original);
    expect(batch.metadata).toEqual({ clothed: true, groupId: "g-xyz" });
  });

  it("tolerates null metadata from legacy records (defaults applied)", () => {
    const legacy: PlacedObject = {
      id: "legacy-1",
      configurationId: "config-1",
      assetDefinitionId: CHAIR_ID,
      positionX: "0", positionY: "0", positionZ: "0",
      rotationX: "0", rotationY: "0", rotationZ: "0",
      scale: "1", sortOrder: 3,
      metadata: null,
    };

    const editor = placedObjectToEditor(legacy);
    expect(editor.clothed).toBe(false);
    expect(editor.groupId).toBeNull();
    expect(editor.sortOrder).toBe(3);
  });

  it("tolerates partial metadata (missing clothed)", () => {
    const legacy: PlacedObject = {
      id: "legacy-2",
      configurationId: "config-1",
      assetDefinitionId: ROUND_TABLE_ID,
      positionX: "0", positionY: "0", positionZ: "0",
      rotationX: "0", rotationY: "0", rotationZ: "0",
      scale: "1", sortOrder: 0,
      metadata: { groupId: "g-from-old-save" },
    };

    const editor = placedObjectToEditor(legacy);
    expect(editor.clothed).toBe(false);
    expect(editor.groupId).toBe("g-from-old-save");
  });

  it("a full chair-group batch preserves group membership across the wire", () => {
    // Diligence scenario: a round table with 8 chairs in one group.
    // The old code would reload them ungrouped, so deleting the table
    // would leave 8 orphaned chairs. This test pins the fix.
    const groupId = "group-table-1";
    const group: EditorObject[] = [
      {
        id: "t1", assetDefinitionId: ROUND_TABLE_ID,
        positionX: 0, positionY: 0, positionZ: 0,
        rotationX: 0, rotationY: 0, rotationZ: 0,
        scale: 1, sortOrder: 0,
        clothed: true, groupId, notes: "",
      },
      ...Array.from({ length: 8 }, (_, i): EditorObject => ({
        id: `c${String(i)}`, assetDefinitionId: CHAIR_ID,
        positionX: Math.cos(i), positionY: 0, positionZ: Math.sin(i),
        rotationX: 0, rotationY: (i / 8) * 2 * Math.PI, rotationZ: 0,
        scale: 1, sortOrder: i + 1,
        clothed: false, groupId, notes: "",
      })),
    ];

    const roundTripped = group
      .map(editorToBatch)
      .map((b, i) => simulateDbRoundTrip(b, group[i]?.id ?? "", "config-1"))
      .map(placedObjectToEditor);

    expect(roundTripped).toEqual(group);
    // Group cohesion: all 9 items still share the same groupId
    expect(new Set(roundTripped.map((o) => o.groupId))).toEqual(new Set([groupId]));
    // Cloth state preserved on the table only
    expect(roundTripped.filter((o) => o.clothed)).toHaveLength(1);
    expect(roundTripped[0]?.clothed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scene boundary round-trip — EditorObject <-> PlacedItem (bridge)
// ---------------------------------------------------------------------------

describe("EditorObject <-> PlacedItem bridge round-trip", () => {
  it("editorToPlacedItem carries clothed and groupId into the scene", () => {
    const editor: EditorObject = {
      id: "o1", assetDefinitionId: ROUND_TABLE_ID,
      positionX: 1, positionY: 0, positionZ: 2,
      rotationX: 0, rotationY: 0.5, rotationZ: 0,
      scale: 1, sortOrder: 3,
      clothed: true, groupId: "g-1", label: "Top Table", notes: "",
    };

    const placed = editorToPlacedItem(editor);

    expect(placed.id).toBe("o1");
    expect(placed.catalogueItemId).toBe(ROUND_TABLE_ID);
    expect(placed.x).toBe(1);
    expect(placed.y).toBe(0);
    expect(placed.z).toBe(2);
    expect(placed.rotationY).toBe(0.5);
    expect(placed.clothed).toBe(true);
    expect(placed.groupId).toBe("g-1");
    expect(placed.label).toBe("Top Table");
  });

  it("placedItemToEditor with existing lookup preserves rotationX/Z, scale, sortOrder", () => {
    // The placement system doesn't model these fields, so they must come
    // from the existing EditorObject. This test pins the fix for the
    // "reload normalizes everything to zero" bug.
    const existing: EditorObject = {
      id: "o1", assetDefinitionId: ROUND_TABLE_ID,
      positionX: 0, positionY: 0, positionZ: 0,
      rotationX: 0.15, rotationY: 0, rotationZ: -0.25,
      scale: 1.1, sortOrder: 5,
      clothed: false, groupId: null, notes: "",
    };
    const item: PlacedItem = {
      id: "o1", catalogueItemId: ROUND_TABLE_ID,
      x: 3, y: 0, z: 4, rotationY: Math.PI,
      clothed: true, groupId: "g-2", label: "Bride",
    };

    const result = placedItemToEditor(item, existing);

    // Scene fields come from the PlacedItem
    expect(result.positionX).toBe(3);
    expect(result.positionZ).toBe(4);
    expect(result.rotationY).toBe(Math.PI);
    expect(result.clothed).toBe(true);
    expect(result.groupId).toBe("g-2");
    expect(result.label).toBe("Bride");
    // Non-scene fields come from the existing EditorObject
    expect(result.rotationX).toBe(0.15);
    expect(result.rotationZ).toBe(-0.25);
    expect(result.scale).toBe(1.1);
    expect(result.sortOrder).toBe(5);
  });

  it("placedItemToEditor with no existing lookup uses safe defaults", () => {
    // New items (freshly placed from the catalogue) have no editor-store
    // record yet. They must get safe defaults, not throw.
    const item: PlacedItem = {
      id: "new-1", catalogueItemId: CHAIR_ID,
      x: 0, y: 0, z: 0, rotationY: 0,
      clothed: false, groupId: null,
    };

    const result = placedItemToEditor(item, undefined);

    expect(result.rotationX).toBe(0);
    expect(result.rotationZ).toBe(0);
    expect(result.scale).toBe(1);
    expect(result.sortOrder).toBe(0);
  });

  it("full scene round-trip: editor -> scene -> editor preserves everything", () => {
    // The end-to-end flow that mattered for the bug: load from API,
    // convert to scene items, read them back. Nothing should change.
    const original: EditorObject = {
      id: "o1", assetDefinitionId: ROUND_TABLE_ID,
      positionX: 2.5, positionY: 0, positionZ: -1.25,
      rotationX: 0.1, rotationY: 0.7, rotationZ: -0.05,
      scale: 1.02, sortOrder: 4,
      clothed: true, groupId: "g-full", notes: "",
    };

    const asScene = editorToPlacedItem(original);
    const back = placedItemToEditor(asScene, original);

    expect(back).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: wire -> bridge -> scene -> bridge -> wire
// ---------------------------------------------------------------------------

describe("End-to-end round-trip: API <-> store <-> scene", () => {
  it("a clothed grouped table survives API -> store -> scene -> store -> API", () => {
    // This is the full path a user's layout takes on save+reload. If any
    // link in the chain drops a field, this test fails and diligence
    // catches it before a real user does.
    const original: EditorObject = {
      id: "550e8400-e29b-41d4-a716-446655440099",
      assetDefinitionId: ROUND_TABLE_ID,
      positionX: 1.23, positionY: 0, positionZ: -4.56,
      rotationX: 0.05, rotationY: 2.1, rotationZ: -0.05,
      scale: 1.03, sortOrder: 11,
      clothed: true, groupId: "g-full-chain", notes: "",
    };

    // Save path: editor -> batch -> wire
    const batch = editorToBatch(original);
    const wire = simulateDbRoundTrip(batch, original.id, "config-1");

    // Load path: wire -> editor -> scene
    const editorOnLoad = placedObjectToEditor(wire);
    const sceneItem = editorToPlacedItem(editorOnLoad);

    // User moves the item in the scene — rotation + position change
    const afterUserEdit: PlacedItem = {
      ...sceneItem,
      x: 9.9,
      rotationY: 0,
    };

    // Save path: scene -> editor (with existing lookup) -> batch -> wire
    const editorOnSave = placedItemToEditor(afterUserEdit, editorOnLoad);
    const newBatch = editorToBatch(editorOnSave);
    const newWire = simulateDbRoundTrip(newBatch, original.id, "config-1");

    // Final reload: wire -> editor
    const finalEditor = placedObjectToEditor(newWire);

    // User's edits are present
    expect(finalEditor.positionX).toBe(9.9);
    expect(finalEditor.rotationY).toBe(0);
    // Everything else the user didn't touch is unchanged from the original
    expect(finalEditor.clothed).toBe(true);
    expect(finalEditor.groupId).toBe("g-full-chain");
    expect(finalEditor.sortOrder).toBe(11);
    expect(finalEditor.rotationX).toBeCloseTo(0.05);
    expect(finalEditor.rotationZ).toBeCloseTo(-0.05);
    expect(finalEditor.scale).toBeCloseTo(1.03);
  });
});
