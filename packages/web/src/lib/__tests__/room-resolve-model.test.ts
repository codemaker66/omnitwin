import { describe, expect, it } from "vitest";
import {
  ROOM_RESOLVE_CAPTION_ENTER_MS,
  ROOM_RESOLVE_CAPTION_EXIT_MS,
  ROOM_RESOLVE_REDUCED_MOTION_MS,
  inkTargetOpacity,
  roomResolveCaption,
  roomResolvePhase,
} from "../room-resolve-model.js";

// CARD A2 (G1b): "the room resolves" — blueprint ink first, splat develops
// over it coarse-to-fine, quiet caption, no spinner anywhere. The phase
// machine and caption copy are pure so the choreography is testable without
// a canvas.

const FORBIDDEN_PHRASES = [
  "production ready",
  "approved for occupancy",
  "survey-grade",
  "photoreal digital twin",
  "legally compliant",
  "certified safe",
  "fire approved",
  "guaranteed accessible",
];

describe("roomResolvePhase", () => {
  it("is 'ink' while the runtime package registry is still resolving", () => {
    expect(roomResolvePhase({
      splatStatus: "loading", hasAsset: false, totalChunks: 0, loadedChunks: 0,
    })).toBe("ink");
  });

  it("is 'developing' while captured chunks are still streaming in", () => {
    expect(roomResolvePhase({
      splatStatus: "loaded", hasAsset: true, totalChunks: 7, loadedChunks: 0,
    })).toBe("developing");
    expect(roomResolvePhase({
      splatStatus: "loaded", hasAsset: true, totalChunks: 7, loadedChunks: 6,
    })).toBe("developing");
  });

  it("is 'resolved' once every chunk has arrived", () => {
    expect(roomResolvePhase({
      splatStatus: "loaded", hasAsset: true, totalChunks: 7, loadedChunks: 7,
    })).toBe("resolved");
  });

  it("settles as 'resolved' when every chunk has either arrived or failed — a dead chunk never wedges the caption open", () => {
    expect(roomResolvePhase({
      splatStatus: "loaded", hasAsset: true, totalChunks: 7, loadedChunks: 6, failedChunks: 1,
    })).toBe("resolved");
    expect(roomResolvePhase({
      splatStatus: "loaded", hasAsset: true, totalChunks: 7, loadedChunks: 6, failedChunks: 0,
    })).toBe("developing");
    // The blueprint ink honestly persists over the never-loaded region.
    expect(inkTargetOpacity({ splatActive: true, loadedChunks: 6, totalChunks: 7 })).toBeCloseTo(1 / 7);
  });

  it("is 'fallback' when resolution settles without a usable captured layer", () => {
    expect(roomResolvePhase({
      splatStatus: "none", hasAsset: false, totalChunks: 0, loadedChunks: 0,
    })).toBe("fallback");
    // A package can resolve yet be unusable (no URLs survive validation).
    expect(roomResolvePhase({
      splatStatus: "loaded", hasAsset: false, totalChunks: 0, loadedChunks: 0,
    })).toBe("fallback");
    // "idle" is declared on the hook's union but never set — treated as the
    // settled no-asset state.
    expect(roomResolvePhase({
      splatStatus: "idle", hasAsset: false, totalChunks: 0, loadedChunks: 0,
    })).toBe("fallback");
  });
});

describe("roomResolveCaption", () => {
  it("shows honest chunk progress while developing", () => {
    expect(roomResolveCaption("developing", "Reception Room", 3, 7)).toBe(
      "Loading captured room · Reception Room · 3 of 7 chunks",
    );
  });

  it("drops the room segment when no room name is known", () => {
    expect(roomResolveCaption("developing", null, 1, 7)).toBe(
      "Loading captured room · 1 of 7 chunks",
    );
  });

  it("is silent in every other phase — the scene itself is the state", () => {
    expect(roomResolveCaption("ink", "Reception Room", 0, 7)).toBeNull();
    expect(roomResolveCaption("resolved", "Reception Room", 7, 7)).toBeNull();
    expect(roomResolveCaption("fallback", "Reception Room", 0, 0)).toBeNull();
  });

  it("never emits unsafe claim phrases or fabricated figures", () => {
    const captions = [
      roomResolveCaption("developing", "Reception Room", 3, 7),
      roomResolveCaption("developing", null, 0, 7),
    ].filter((caption): caption is string => caption !== null);

    for (const caption of captions) {
      const lower = caption.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(lower).not.toContain(phrase);
      }
      // No percentages or byte figures — the schema carries no per-chunk
      // sizes, so any MB total would be invented.
      expect(caption).not.toMatch(/%|\bMB\b|\bGB\b/);
    }
  });
});

describe("inkTargetOpacity", () => {
  it("keeps the blueprint at full ink whenever the splat is not active", () => {
    expect(inkTargetOpacity({ splatActive: false, loadedChunks: 0, totalChunks: 0 })).toBe(1);
    expect(inkTargetOpacity({ splatActive: false, loadedChunks: 7, totalChunks: 7 })).toBe(1);
  });

  it("recedes proportionally as captured chunks develop over it", () => {
    expect(inkTargetOpacity({ splatActive: true, loadedChunks: 0, totalChunks: 7 })).toBe(1);
    expect(inkTargetOpacity({ splatActive: true, loadedChunks: 3, totalChunks: 7 })).toBeCloseTo(1 - 3 / 7);
    expect(inkTargetOpacity({ splatActive: true, loadedChunks: 7, totalChunks: 7 })).toBe(0);
  });

  it("stays at full ink when the active splat has no chunks to count", () => {
    expect(inkTargetOpacity({ splatActive: true, loadedChunks: 0, totalChunks: 0 })).toBe(1);
  });
});

describe("motion constants (02 §6)", () => {
  it("keeps the caption in the Deliberate tier and exits faster than it enters", () => {
    expect(ROOM_RESOLVE_CAPTION_ENTER_MS).toBeGreaterThanOrEqual(200);
    expect(ROOM_RESOLVE_CAPTION_ENTER_MS).toBeLessThanOrEqual(300);
    expect(ROOM_RESOLVE_CAPTION_EXIT_MS).toBeLessThan(ROOM_RESOLVE_CAPTION_ENTER_MS);
  });

  it("maps reduced motion to the 120 ms fade the design language mandates", () => {
    expect(ROOM_RESOLVE_REDUCED_MOTION_MS).toBe(120);
  });
});
