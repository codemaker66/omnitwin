import { describe, expect, it } from "vitest";
import { Group, Scene } from "three";
import {
  SAVED_LAYOUT_FURNITURE_GROUP,
  TIMELINE_CAPTURE_FURNITURE_GROUP,
  TIMELINE_PREVIEW_FURNITURE_GROUP,
  captureFurnitureVisibilityForTimeline,
  prepareFurnitureForOrthographicCapture,
} from "../layout-timeline-capture.js";

describe("timeline orthographic capture visibility", () => {
  it("captures the nearest phase keyframe and never interpolated geometry", () => {
    expect(captureFurnitureVisibilityForTimeline({
      timelinePreviewActive: true,
      nearestKeyframeAvailable: true,
    })).toEqual({
      source: "nearest-keyframe",
      savedLayoutVisible: false,
      interpolatedPreviewVisible: false,
      nearestKeyframeVisible: true,
      diagramLabelsVisible: false,
    });
  });

  it("falls back to the saved editor plan when no timeline keyframe is mounted", () => {
    expect(captureFurnitureVisibilityForTimeline({
      timelinePreviewActive: false,
      nearestKeyframeAvailable: false,
    }).source).toBe("saved-layout");
  });

  it("temporarily substitutes the nearest keyframe in a live scene and restores all groups", () => {
    const scene = new Scene();
    const saved = new Group();
    saved.name = SAVED_LAYOUT_FURNITURE_GROUP;
    saved.visible = false;
    const preview = new Group();
    preview.name = TIMELINE_PREVIEW_FURNITURE_GROUP;
    preview.visible = true;
    const nearest = new Group();
    nearest.name = TIMELINE_CAPTURE_FURNITURE_GROUP;
    nearest.visible = false;
    scene.add(saved, preview, nearest);

    const capture = prepareFurnitureForOrthographicCapture(scene);
    expect(capture.source).toBe("nearest-keyframe");
    expect(capture.diagramLabelsVisible).toBe(false);
    expect(saved.visible).toBe(false);
    expect(preview.visible).toBe(false);
    expect(nearest.visible).toBe(true);

    capture.restore();
    capture.restore();
    expect(saved.visible).toBe(false);
    expect(preview.visible).toBe(true);
    expect(nearest.visible).toBe(false);
  });

  it("shows the saved layout for ordinary captures", () => {
    const scene = new Scene();
    const saved = new Group();
    saved.name = SAVED_LAYOUT_FURNITURE_GROUP;
    saved.visible = false;
    scene.add(saved);

    const capture = prepareFurnitureForOrthographicCapture(scene);
    expect(capture.source).toBe("saved-layout");
    expect(capture.diagramLabelsVisible).toBe(true);
    expect(saved.visible).toBe(true);
    capture.restore();
    expect(saved.visible).toBe(false);
  });
});
