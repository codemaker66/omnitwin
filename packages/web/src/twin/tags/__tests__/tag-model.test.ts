import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { e57PointToThree } from "../../twin-basis.js";
import { allTagCopy } from "../tag-copy.js";
import {
  EXAMPLE_TAGS,
  TAG_GRAZE_FULL_COS,
  TAG_GRAZE_HIDDEN_COS,
  TAG_SCALE_MAX,
  TAG_SCALE_MIN,
  TAG_SCALE_REFERENCE_M,
  drawableTags,
  findTagAuthoringFault,
  hudKeepOutRects,
  isOccluded,
  isUnderHud,
  placeTags,
  projectToStage,
  tagAnchorThree,
  tagCardClearBox,
  tagCardPosition,
  tagGrazingOpacity,
  tagScaleForDepth,
  tagsVisibleFromNode,
  type TagCamera,
  type TagStage,
  type TagVec3,
  type TwinTag,
} from "../tag-model.js";

// -----------------------------------------------------------------------------
// The room-note model, pinned.
//
// Three things here are load-bearing rather than routine, and they are the three
// that would ship a plausible-looking layer that is quietly wrong:
//
//   1. THE AXIS CONVENTION. A sign flip in the E57→three map does not throw and
//      does not blank the layer — it mirrors every note through the floor or
//      spins the room a quarter turn, so a note authored on the north wall
//      appears on the south one. The cases below are chosen so that each
//      plausible corruption of `[x, z, −y]` lands a note BEHIND the camera or on
//      the wrong side of the frame, i.e. fails loudly.
//
//   2. BEHIND-CAMERA. A pinhole projection divides by depth, and at negative
//      depth it happily returns a finite on-screen point — the classic bug where
//      a note behind you renders in front of you, mirrored. Nothing about the
//      output looks wrong; it is simply a lie about the building.
//
//   3. HUD DISJOINTNESS. The card's clear box is asserted against every measured
//      HUD rect at all three reconciled viewports. A panel shipped here before
//      that covered Share and Fullscreen at 844×390, and a comment claiming
//      "this slot is free" is exactly what failed to catch it.
// -----------------------------------------------------------------------------

/** A camera at the origin looking along three's −Z (its rest orientation), with
 *  a 16:9 stage and a 60° vertical field. */
const CAMERA: TagCamera = {
  positionThree: [0, 0, 0],
  forwardThree: [0, 0, -1],
  upThree: [0, 1, 0],
  fovYRad: Math.PI / 3,
  aspect: 16 / 9,
};

const STAGE_DESKTOP: TagStage = { widthPx: 1440, heightPx: 900 };
const STAGE_PHONE: TagStage = { widthPx: 390, heightPx: 844 };
const STAGE_PHONE_LANDSCAPE: TagStage = { widthPx: 844, heightPx: 390 };

/** Every viewport the twin's layout is reconciled at. 844×390 is where the last
 *  HUD collision was found, so it is not optional here. */
const ALL_STAGES: readonly (readonly [string, TagStage])[] = [
  ["desktop 1440×900", STAGE_DESKTOP],
  ["phone 390×844", STAGE_PHONE],
  ["landscape phone 844×390", STAGE_PHONE_LANDSCAPE],
];

function makeTag(overrides: Partial<TwinTag> = {}): TwinTag {
  return {
    id: "t1",
    kind: "power",
    provenance: "venue-supplied",
    anchorE57: [0, 10, 0],
    facingE57: null,
    title: "A note",
    body: "Something about this spot.",
    bestViewedFrom: "scan_028",
    visibleFrom: ["scan_028"],
    ...overrides,
  };
}

describe("the E57 → three anchor convention", () => {
  // The map is `[x, z, −y]`. Each case below is chosen so a corrupted map sends
  // the note behind the camera or to the wrong side, rather than merely nudging
  // it — a test that only checked "roughly near the middle" would pass on a
  // mirrored world.

  it("sends E57 +Y (scanner-left) to three −Z, i.e. straight ahead", () => {
    // The sign-flip catcher. `[x, z, y]` or `[x, −z, y]` both put this at three
    // +Z, which is directly BEHIND a camera looking along −Z.
    const anchor = tagAnchorThree(makeTag({ anchorE57: [0, 10, 0] }));
    expect(anchor).toEqual([0, 0, -10]);

    const projection = projectToStage(anchor, CAMERA);
    expect(projection.behindCamera).toBe(false);
    expect(projection.depthM).toBeCloseTo(10, 10);
    expect(projection.stageX).toBeCloseTo(0.5, 10);
    expect(projection.stageY).toBeCloseTo(0.5, 10);
  });

  it("sends E57 +Z (building up) to three +Y, so a ceiling note sits HIGH on the stage", () => {
    // The y-flip catcher, and the one that would otherwise read as a camera bug:
    // NDC is y-up, a stage fraction is y-down, so "up in the room" must come
    // back as a SMALL stageY.
    const anchor = tagAnchorThree(makeTag({ anchorE57: [0, 10, 3] }));
    expect(anchor).toEqual([0, 3, -10]);
    expect(projectToStage(anchor, CAMERA).stageY).toBeLessThan(0.5);
  });

  it("sends E57 +X to three +X, so it lands on the RIGHT of the stage", () => {
    // Catches an X/Y transposition, which no vertical test can see.
    const anchor = tagAnchorThree(makeTag({ anchorE57: [3, 10, 0] }));
    expect(anchor).toEqual([3, 0, -10]);
    expect(projectToStage(anchor, CAMERA).stageX).toBeGreaterThan(0.5);
  });

  it("agrees with twin-basis rather than reimplementing it", () => {
    // The point of the seam: if twin-basis is recalibrated, this module follows
    // instead of drifting. Asserted over an asymmetric point, so a transposition
    // in either module fails here.
    const e57: TagVec3 = [1, 2, 3];
    expect(tagAnchorThree(makeTag({ anchorE57: e57 }))).toEqual(e57PointToThree(e57));
  });
});

describe("projection", () => {
  it("refuses to place a note that is behind the camera", () => {
    // The whole reason `behindCamera` exists. A naive divide would return a
    // perfectly plausible on-stage point for this note.
    const behind = projectToStage([0, 0, 10], CAMERA);
    expect(behind.behindCamera).toBe(true);
    expect(behind.depthM).toBeLessThan(0);
  });

  it("treats a note level with the eye as behind, not as infinitely wide", () => {
    // Depth zero is the singularity; anything at or inside the near plane is
    // rejected rather than divided by.
    expect(projectToStage([0, 0, 0], CAMERA).behindCamera).toBe(true);
    expect(projectToStage([3, 0, 0], CAMERA).behindCamera).toBe(true);
  });

  it("puts a note at the exact top edge of the frustum at stageY 0", () => {
    // tan(fovY/2) · depth is the half-height of the frustum at that depth, so a
    // note exactly that far up lands on the frame's top edge. This pins the
    // field-of-view arithmetic, not merely the sign.
    const depth = 10;
    const halfHeight = Math.tan(CAMERA.fovYRad / 2) * depth;
    expect(projectToStage([0, halfHeight, -depth], CAMERA).stageY).toBeCloseTo(0, 10);
  });

  it("widens with aspect, so a 16:9 stage reaches further sideways than up", () => {
    const depth = 10;
    const halfHeight = Math.tan(CAMERA.fovYRad / 2) * depth;
    const halfWidth = halfHeight * CAMERA.aspect;
    expect(projectToStage([halfWidth, 0, -depth], CAMERA).stageX).toBeCloseTo(1, 10);
  });

  it("returns behind-camera for a degenerate basis instead of guessing", () => {
    // forward ∥ up leaves no horizontal axis. Drawing at a guessed position
    // would put notes on the wrong part of a real room.
    const degenerate: TagCamera = { ...CAMERA, upThree: [0, 0, -1] };
    expect(projectToStage([0, 0, -10], degenerate).behindCamera).toBe(true);
    const zeroForward: TagCamera = { ...CAMERA, forwardThree: [0, 0, 0] };
    expect(projectToStage([0, 0, -10], zeroForward).behindCamera).toBe(true);
  });

  it("tolerates a non-unit, non-orthogonal up vector by orthonormalising", () => {
    // The host holds a camera whose up drifts; the projection must not.
    const sloppy: TagCamera = { ...CAMERA, upThree: [0, 4, -4] };
    const clean = projectToStage([3, 2, -10], CAMERA);
    const drifted = projectToStage([3, 2, -10], sloppy);
    expect(drifted.stageX).toBeCloseTo(clean.stageX, 10);
    expect(drifted.stageY).toBeCloseTo(clean.stageY, 10);
  });
});

describe("visibility is authored, never inferred", () => {
  it("shows a note only at the viewpoints it lists", () => {
    const here = makeTag({ id: "here", visibleFrom: ["scan_028"] });
    const elsewhere = makeTag({ id: "elsewhere", visibleFrom: ["scan_046"] });
    expect(tagsVisibleFromNode([here, elsewhere], "scan_028").map((t) => t.id)).toEqual([
      "here",
    ]);
  });

  it("does not place a note at a viewpoint it was not authored for, however near", () => {
    // The anti-proximity guarantee. This note is two metres away — the exact
    // case where a radius rule would show it through a wall.
    const nearButNotHere = makeTag({ anchorE57: [0, 2, 0], visibleFrom: ["scan_046"] });
    const [placement] = placeTags([nearButNotHere], "scan_028", CAMERA, STAGE_DESKTOP);
    expect(placement?.visibility).toBe("not-here");
  });
});

describe("depth", () => {
  it("orders far notes first so a near pin paints over a far one", () => {
    // DOM order is paint order in the layer, so this ordering IS the occlusion
    // between two pins. Reversed, the thing beside you hides behind the thing
    // across the room.
    const near = makeTag({ id: "near", anchorE57: [0, 3, 0] });
    const far = makeTag({ id: "far", anchorE57: [0, 20, 0] });
    const placed = placeTags([near, far], "scan_028", CAMERA, STAGE_DESKTOP);
    expect(placed.map((p) => p.tag.id)).toEqual(["far", "near"]);
  });

  it("scales a pin down with distance without letting it vanish", () => {
    expect(tagScaleForDepth(TAG_SCALE_REFERENCE_M)).toBeCloseTo(1, 10);
    expect(tagScaleForDepth(20)).toBeLessThan(1);
    expect(tagScaleForDepth(20)).toBeGreaterThan(tagScaleForDepth(40));
    // THE REGRESSION THIS FILE ALREADY CAUGHT ONCE. The curve shipped as a
    // square root, which hit the floor at ~10.4 m — so every note beyond the
    // halfway point of the 21 m Grand Hall rendered identically and the depth
    // cue switched off in the venue's largest room. Depth must still be felt
    // across the full length of the longest room the venue has.
    expect(tagScaleForDepth(11)).toBeGreaterThan(tagScaleForDepth(21));
    expect(tagScaleForDepth(21)).toBeGreaterThan(TAG_SCALE_MIN);
    expect(tagScaleForDepth(1000)).toBe(TAG_SCALE_MIN);
    expect(tagScaleForDepth(0.01)).toBe(TAG_SCALE_MAX);
    // Nonsense depth must not produce NaN geometry.
    expect(tagScaleForDepth(0)).toBe(TAG_SCALE_MIN);
    expect(tagScaleForDepth(-5)).toBe(TAG_SCALE_MIN);
  });
});

describe("occlusion", () => {
  it("hides a note with a surface between it and the eye", () => {
    expect(isOccluded(10, 4)).toBe(true);
  });

  it("does not let a wall-mounted note occlude itself", () => {
    // The sample and the anchor agree to within the plaster; without the margin
    // every note on a wall would hide behind that wall.
    expect(isOccluded(10, 9.9)).toBe(false);
  });

  it("treats an absent sample as no evidence, not as occluded", () => {
    // Hiding on null would silently empty the layer wherever the collider has a
    // hole — a feature that disappears without explanation.
    expect(isOccluded(10, null)).toBe(false);
  });

  it("marks a note occluded through placeTags when the host samples a nearer surface", () => {
    const tag = makeTag({ anchorE57: [0, 10, 0] });
    const placed = placeTags([tag], "scan_028", CAMERA, STAGE_DESKTOP, {
      occlusionDepthsM: new Map([["t1", 2]]),
    });
    expect(placed[0]?.visibility).toBe("occluded");
    expect(drawableTags(placed)).toHaveLength(0);
  });
});

describe("the grazing fade", () => {
  it("is solid face-on and gone edge-on, with a ramp between", () => {
    expect(tagGrazingOpacity(1)).toBe(1);
    expect(tagGrazingOpacity(TAG_GRAZE_FULL_COS)).toBe(1);
    expect(tagGrazingOpacity(TAG_GRAZE_HIDDEN_COS)).toBe(0);
    expect(tagGrazingOpacity(0)).toBe(0);
    // Facing away from the viewer entirely.
    expect(tagGrazingOpacity(-1)).toBe(0);
    const middle = tagGrazingOpacity((TAG_GRAZE_HIDDEN_COS + TAG_GRAZE_FULL_COS) / 2);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it("leaves a note with no authored face at full strength", () => {
    // The honest default: no normal supplied means no claim about facing.
    const placed = placeTags([makeTag({ facingE57: null })], "scan_028", CAMERA, STAGE_DESKTOP);
    expect(placed[0]?.opacity).toBe(1);
  });

  it("hides a note on a face turned away from the camera", () => {
    // Anchor at E57 +Y with a normal pointing further along +Y — i.e. the face
    // is turned away from an eye standing at the origin.
    const facingAway = makeTag({ anchorE57: [0, 10, 0], facingE57: [0, 1, 0] });
    const placed = placeTags([facingAway], "scan_028", CAMERA, STAGE_DESKTOP);
    expect(placed[0]?.visibility).toBe("grazing");
    expect(drawableTags(placed)).toHaveLength(0);
  });

  it("shows the same note at full strength when its face turns toward the camera", () => {
    const facingViewer = makeTag({ anchorE57: [0, 10, 0], facingE57: [0, -1, 0] });
    const placed = placeTags([facingViewer], "scan_028", CAMERA, STAGE_DESKTOP);
    expect(placed[0]?.visibility).toBe("visible");
    expect(placed[0]?.opacity).toBe(1);
  });
});

describe("a pin never lands under HUD chrome", () => {
  it("rejects the stage corners, which every viewport fills with controls", () => {
    for (const [label, stage] of ALL_STAGES) {
      // Top-left is the node label at every breakpoint; bottom-right the minimap.
      expect(isUnderHud(0.02, 0.03, stage), `${label} top-left`).toBe(true);
      expect(isUnderHud(0.97, 0.97, stage), `${label} bottom-right`).toBe(true);
    }
  });

  it("marks a note under the minimap as under-hud rather than drawing it", () => {
    // Straight ahead but low and to the right — the minimap's corner.
    const stage = STAGE_DESKTOP;
    const rects = hudKeepOutRects(stage);
    const minimap = rects.find((r) => r.id === "minimap");
    expect(minimap).toBeDefined();
    if (minimap === undefined) {
      return;
    }
    const centreX = (minimap.xPx + minimap.widthPx / 2) / stage.widthPx;
    const centreY = (minimap.yPx + minimap.heightPx / 2) / stage.heightPx;
    expect(isUnderHud(centreX, centreY, stage)).toBe(true);
  });

  it("counts a pin whose EDGE tucks under a control as under it", () => {
    // The pin is a disc, not a point. Its centre sits just outside the minimap;
    // its body does not.
    const stage = STAGE_DESKTOP;
    const minimap = hudKeepOutRects(stage).find((r) => r.id === "minimap");
    expect(minimap).toBeDefined();
    if (minimap === undefined) {
      return;
    }
    const justLeftOfIt = (minimap.xPx - 6) / stage.widthPx;
    const midHeight = (minimap.yPx + minimap.heightPx / 2) / stage.heightPx;
    expect(isUnderHud(justLeftOfIt, midHeight, stage)).toBe(true);
  });

  it("leaves the middle of the frame free", () => {
    for (const [label, stage] of ALL_STAGES) {
      expect(isUnderHud(0.5, 0.5, stage), label).toBe(false);
    }
  });

  it("drops a colliding pin instead of moving it", () => {
    // Moving it would put a note about a power drop where the power drop is not.
    const tag = makeTag({ anchorE57: [0, 10, 0] });
    const stage = STAGE_DESKTOP;
    // One rect covering the whole stage forces the collision deterministically.
    const placed = placeTags([tag], "scan_028", CAMERA, stage, {
      hudRects: [{ id: "everything", xPx: 0, yPx: 0, widthPx: 1440, heightPx: 900 }],
    });
    expect(placed[0]?.visibility).toBe("under-hud");
    expect(drawableTags(placed)).toHaveLength(0);
    // The position is still reported — the layer drops it, the model does not
    // pretend it has no location.
    expect(placed[0]?.stageX).toBeCloseTo(0.5, 10);
  });
});

describe("the card's clear box is disjoint from every HUD rect", () => {
  // THE PROOF. Not a comment claiming a slot is free — an assertion, at every
  // viewport the layout is reconciled at, against the measured chrome. This is
  // the test that would have caught the panel that covered Share and Fullscreen.
  it.each(ALL_STAGES.map(([label, stage]) => ({ label, stage })))(
    "at $label",
    ({ stage }) => {
      const box = tagCardClearBox(stage);
      expect(box.widthPx).toBeGreaterThan(180);
      expect(box.heightPx).toBeGreaterThan(140);
      // Inside the stage.
      expect(box.xPx).toBeGreaterThanOrEqual(0);
      expect(box.yPx).toBeGreaterThanOrEqual(0);
      expect(box.xPx + box.widthPx).toBeLessThanOrEqual(stage.widthPx);
      expect(box.yPx + box.heightPx).toBeLessThanOrEqual(stage.heightPx);

      for (const rect of hudKeepOutRects(stage)) {
        const overlaps =
          box.xPx < rect.xPx + rect.widthPx &&
          rect.xPx < box.xPx + box.widthPx &&
          box.yPx < rect.yPx + rect.heightPx &&
          rect.yPx < box.yPx + box.heightPx;
        expect(
          overlaps,
          `card clear box (${String(box.xPx)},${String(box.yPx)} ${String(box.widthPx)}×${String(box.heightPx)}) overlaps HUD "${rect.id}" (${String(rect.xPx)},${String(rect.yPx)} ${String(rect.widthPx)}×${String(rect.heightPx)})`,
        ).toBe(false);
      }
    },
  );

  it("keeps an opened card inside the box wherever its pin was pressed", () => {
    // Including the corners, which is where a naive anchor would push the card
    // straight off the stage and under the chrome.
    const corners: readonly (readonly [number, number])[] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 0.5],
      [0.5, 0.98],
    ];
    for (const [label, stage] of ALL_STAGES) {
      const box = tagCardClearBox(stage);
      const cardWidth = Math.min(316, box.widthPx);
      const cardHeight = Math.min(280, box.heightPx);
      for (const [x, y] of corners) {
        const position = tagCardPosition(x, y, cardWidth, cardHeight, stage);
        expect(position.xPx, `${label} x at (${String(x)},${String(y)})`).toBeGreaterThanOrEqual(
          box.xPx,
        );
        expect(position.yPx, `${label} y at (${String(x)},${String(y)})`).toBeGreaterThanOrEqual(
          box.yPx,
        );
        expect(position.xPx + cardWidth).toBeLessThanOrEqual(box.xPx + box.widthPx + 1e-9);
        expect(position.yPx + cardHeight).toBeLessThanOrEqual(box.yPx + box.heightPx + 1e-9);
      }
    }
  });

  it("still returns a point on the stage for a viewport smaller than the insets", () => {
    // A degenerate stage must collapse the box, not invert it into NaN geometry.
    const tiny: TagStage = { widthPx: 240, heightPx: 200 };
    const box = tagCardClearBox(tiny);
    expect(box.widthPx).toBeGreaterThanOrEqual(0);
    expect(box.heightPx).toBeGreaterThanOrEqual(0);
    const position = tagCardPosition(0.5, 0.5, 316, 280, tiny);
    expect(Number.isFinite(position.xPx)).toBe(true);
    expect(Number.isFinite(position.yPx)).toBe(true);
  });
});

describe("the shipped example set", () => {
  it("is well-formed", () => {
    for (const tag of EXAMPLE_TAGS) {
      expect(findTagAuthoringFault(tag)).toBeNull();
    }
  });

  it("is marked example, every one of them", () => {
    // The card's badge and disclosure are gated on this field, so a single
    // "venue-supplied" slipping in here would render placeholder prose as venue
    // fact — the one failure this feature must not have.
    for (const tag of EXAMPLE_TAGS) {
      expect(tag.provenance).toBe("example");
    }
  });

  it("is anchored only at viewpoints whose room identity is verified", () => {
    // Notes may only be authored where we know what room we are in; scan_028 and
    // scan_046 are two of the five in twin-rooms.ts VERIFIED_ROOM_NODES.
    const verified = new Set(["scan_028", "scan_046", "scan_058", "scan_105", "scan_126"]);
    for (const tag of EXAMPLE_TAGS) {
      for (const node of tag.visibleFrom) {
        expect(verified.has(node), `${tag.id} is authored for ${node}`).toBe(true);
      }
    }
  });

  it("catches an authoring fault rather than rendering a broken note", () => {
    expect(findTagAuthoringFault(makeTag({ visibleFrom: [] }))).toContain("no viewpoint");
    expect(
      findTagAuthoringFault(makeTag({ bestViewedFrom: "scan_999", visibleFrom: ["scan_028"] })),
    ).toContain("best view");
    expect(findTagAuthoringFault(makeTag({ facingE57: [0, 0, 0] }))).toContain("zero-length");
    expect(findTagAuthoringFault(makeTag({ body: "   " }))).toContain("empty");
  });

  it("puts EVERY example note on the glass at some heading from its own viewpoint", () => {
    // The guard against the degenerate pass — and the one that caught two real
    // faults. An example set that never renders satisfies every assertion above
    // while demonstrating nothing, and "at least one renders" is barely better:
    // it passed while a note sat 3.7 m directly overhead, unfindable without
    // pitching the camera vertical.
    //
    // So the assertion is per-note and over the whole sphere of headings a guest
    // can actually reach: stand at scan_028's real pose, turn all the way round
    // in 15° steps, glancing up and down by 20°. Every note we ship must become
    // drawable somewhere in that sweep. A note that fails this is anchored
    // somewhere no visitor will ever look.
    const eye = tagAnchorThree(makeTag({ anchorE57: [14.89, -3.54, 1.53] }));
    const seen = new Set<string>();

    for (let yawDeg = 0; yawDeg < 360; yawDeg += 15) {
      for (const pitchDeg of [-20, 0, 20]) {
        const yaw = (yawDeg * Math.PI) / 180;
        const pitch = (pitchDeg * Math.PI) / 180;
        const camera: TagCamera = {
          positionThree: eye,
          forwardThree: [
            Math.cos(pitch) * Math.sin(yaw),
            Math.sin(pitch),
            -Math.cos(pitch) * Math.cos(yaw),
          ],
          upThree: [0, 1, 0],
          fovYRad: Math.PI / 3,
          aspect: 16 / 9,
        };
        for (const placement of drawableTags(
          placeTags(EXAMPLE_TAGS, "scan_028", camera, STAGE_DESKTOP),
        )) {
          seen.add(placement.tag.id);
        }
      }
    }

    for (const tag of EXAMPLE_TAGS) {
      expect(seen.has(tag.id), `${tag.id} is never visible from scan_028`).toBe(true);
    }
  });
});

describe("the copy claim guard", () => {
  it("finds no unsupported certainty claim anywhere in the layer's script", () => {
    for (const line of allTagCopy()) {
      expect(findUnsupportedProposalClaim(line), line).toBeNull();
    }
  });

  it("publishes a non-empty sweep list", () => {
    // An empty list satisfies the assertion above while checking nothing.
    expect(allTagCopy().length).toBeGreaterThan(0);
  });

  it("sweeps every word the example notes can render", () => {
    // A sweep list that drifts from what the component renders is worse than no
    // sweep: it reports green over copy nobody checked.
    const swept = allTagCopy();
    for (const tag of EXAMPLE_TAGS) {
      expect(swept, `title of ${tag.id}`).toContain(tag.title);
      expect(swept, `body of ${tag.id}`).toContain(tag.body);
    }
  });
});
