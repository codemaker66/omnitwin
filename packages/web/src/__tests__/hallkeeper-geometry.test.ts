import { describe, it, expect } from "vitest";
import {
  roomToNormalised,
  collectFloorPlanMarkers,
  markerColourFor,
  svgAspectRatio,
} from "../lib/hallkeeper-geometry.js";
import type { Phase } from "@omnitwin/types";

const ROOM = { widthM: 20, lengthM: 10 };

describe("roomToNormalised", () => {
  it("maps the origin (room centre) to (0.5, 0.5)", () => {
    const { nx, nz } = roomToNormalised(0, 0, ROOM);
    expect(nx).toBeCloseTo(0.5);
    expect(nz).toBeCloseTo(0.5);
  });

  it("maps the top-left corner (-w/2, -l/2) to (0, 0)", () => {
    const { nx, nz } = roomToNormalised(-10, -5, ROOM);
    expect(nx).toBeCloseTo(0);
    expect(nz).toBeCloseTo(0);
  });

  it("maps the bottom-right corner (w/2, l/2) to (1, 1)", () => {
    const { nx, nz } = roomToNormalised(10, 5, ROOM);
    expect(nx).toBeCloseTo(1);
    expect(nz).toBeCloseTo(1);
  });

  it("clamps out-of-room positions to the edge", () => {
    const { nx, nz } = roomToNormalised(100, -100, ROOM);
    expect(nx).toBe(1);
    expect(nz).toBe(0);
  });

  it("returns 0.5 fallback for NaN (avoids marker disappearing)", () => {
    const { nx, nz } = roomToNormalised(Number.NaN, Number.NaN, ROOM);
    expect(nx).toBe(0.5);
    expect(nz).toBe(0.5);
  });
});

describe("collectFloorPlanMarkers", () => {
  const phases: Phase[] = [
    {
      phase: "furniture",
      zones: [
        {
          zone: "Centre",
          rows: [
            {
              key: "furniture|Centre|Table|0",
              name: "Table",
              category: "table",
              qty: 2,
              afterDepth: 0,
              isAccessory: false,
              notes: "",
              positions: [
                { objectId: "00000000-0000-0000-0000-00000000000a", x: 0, z: 0, rotationY: 0 },
                { objectId: "00000000-0000-0000-0000-00000000000b", x: 5, z: 2, rotationY: 1.5 },
              ],
            },
            {
              key: "furniture|Centre|Chair|0",
              name: "Chair",
              category: "chair",
              qty: 1,
              afterDepth: 0,
              isAccessory: false,
              notes: "",
              positions: [
                { objectId: "00000000-0000-0000-0000-00000000000c", x: -5, z: -3, rotationY: 0 },
              ],
            },
          ],
        },
      ],
    },
    {
      phase: "dress",
      zones: [
        {
          zone: "Centre",
          rows: [
            {
              // Accessories should NOT produce markers
              key: "dress|Centre|Tablecloth|0",
              name: "Tablecloth",
              category: "decor",
              qty: 2,
              afterDepth: 0,
              isAccessory: true,
              notes: "",
              positions: [],
            },
          ],
        },
      ],
    },
  ];

  it("produces one marker per non-accessory placement", () => {
    const markers = collectFloorPlanMarkers(phases, ROOM);
    expect(markers).toHaveLength(3);
  });

  it("excludes accessory rows", () => {
    const markers = collectFloorPlanMarkers(phases, ROOM);
    expect(markers.every((m) => !m.isAccessory)).toBe(true);
    expect(markers.find((m) => m.rowName === "Tablecloth")).toBeUndefined();
  });

  it("each marker carries its source row key so clicks can cross-reference", () => {
    const markers = collectFloorPlanMarkers(phases, ROOM);
    expect(markers.map((m) => m.rowKey)).toEqual([
      "furniture|Centre|Table|0",
      "furniture|Centre|Table|0",
      "furniture|Centre|Chair|0",
    ]);
  });

  it("converts coordinates into normalised [0,1] space", () => {
    const markers = collectFloorPlanMarkers(phases, ROOM);
    const centre = markers[0];
    expect(centre?.nx).toBeCloseTo(0.5);
    expect(centre?.nz).toBeCloseTo(0.5);
  });

  it("returns empty for empty phases", () => {
    expect(collectFloorPlanMarkers([], ROOM)).toEqual([]);
  });
});

describe("markerColourFor", () => {
  it("returns distinct colours for each known category", () => {
    expect(markerColourFor("table")).not.toBe(markerColourFor("chair"));
    expect(markerColourFor("chair")).not.toBe(markerColourFor("av"));
    expect(markerColourFor("av")).not.toBe(markerColourFor("stage"));
  });

  it("falls back to a neutral colour for unknown categories", () => {
    expect(markerColourFor("unknown-category")).toBe("#6a6965");
  });

  it("is deterministic — same category always returns same colour", () => {
    expect(markerColourFor("table")).toBe(markerColourFor("table"));
  });
});

describe("svgAspectRatio", () => {
  it("returns widthM / lengthM for positive dims", () => {
    expect(svgAspectRatio({ widthM: 20, lengthM: 10 })).toBe(2);
    expect(svgAspectRatio({ widthM: 10, lengthM: 20 })).toBe(0.5);
  });

  it("returns 1 for degenerate length (defensive fallback)", () => {
    expect(svgAspectRatio({ widthM: 10, lengthM: 0 })).toBe(1);
  });
});
