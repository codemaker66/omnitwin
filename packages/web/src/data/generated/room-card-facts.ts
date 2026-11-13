// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Produced by scripts/derive-room-card-facts.mjs from
// ./trades-hall-splat-bundles.ts and @omnitwin/types. The front door's room
// cards need these five values per room; the manifest they come from is far
// larger and loads only with the walk and the planner. front-door-weight.test.ts
// holds them together.

export interface RoomCardFacts {
  readonly roomSlug: string;
  /** The room's name as @omnitwin/types publishes it. */
  readonly displayName: string;
  readonly alignmentConfidence: "confident" | "review";
  /** Width, height, depth in metres, from the room's derived frame. */
  readonly extentM: readonly [number, number, number];
  /** Splats in the finest level, the reconstruction a visitor sees. */
  readonly finestLevelSplats: number;
}

export const ROOM_CARD_FACTS: readonly RoomCardFacts[] = [
  {
    "roomSlug": "grand-hall",
    "displayName": "Grand Hall",
    "alignmentConfidence": "confident",
    "extentM": [
      10.087102,
      6.88706525,
      19.867694
    ],
    "finestLevelSplats": 6019684
  },
  {
    "roomSlug": "reception-room",
    "displayName": "Reception Room",
    "alignmentConfidence": "confident",
    "extentM": [
      9.661757,
      3.1512683333333333,
      12.410764
    ],
    "finestLevelSplats": 2105298
  },
  {
    "roomSlug": "saloon",
    "displayName": "Saloon",
    "alignmentConfidence": "review",
    "extentM": [
      7.480898,
      5.833291614583334,
      11.15992
    ],
    "finestLevelSplats": 6199024
  },
  {
    "roomSlug": "robert-adam-room",
    "displayName": "Robert Adam Room",
    "alignmentConfidence": "review",
    "extentM": [
      19.365833000000002,
      14.4435075625,
      17.978921
    ],
    "finestLevelSplats": 4567541
  },
  {
    "roomSlug": "lady-convenors-room",
    "displayName": "Lady Convenor's Room",
    "alignmentConfidence": "review",
    "extentM": [
      3.97504,
      4.731301,
      3.865063
    ],
    "finestLevelSplats": 2286022
  },
  {
    "roomSlug": "north-gallery",
    "displayName": "North Gallery",
    "alignmentConfidence": "review",
    "extentM": [
      8.997021,
      2.8665625,
      9.60558
    ],
    "finestLevelSplats": 2851361
  },
  {
    "roomSlug": "south-gallery",
    "displayName": "South Gallery",
    "alignmentConfidence": "confident",
    "extentM": [
      5.059118,
      2.9743495000000006,
      10.427301
    ],
    "finestLevelSplats": 2778219
  },
  {
    "roomSlug": "deacon-conveners-room",
    "displayName": "Deacon Convener's Room",
    "alignmentConfidence": "confident",
    "extentM": [
      5.3077950000000005,
      4.726947822916666,
      6.2467999999999995
    ],
    "finestLevelSplats": 4114219
  }
];
