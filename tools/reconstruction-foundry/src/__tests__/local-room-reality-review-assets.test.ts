import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  LOCAL_ROOM_REALITY_REVIEW_CSS,
  LOCAL_ROOM_REALITY_REVIEW_HTML,
  LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT,
} from "../local-room-reality-review-assets.js";
import { LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT } from "../local-e57-visual-review-assets.js";

describe("local Room Reality Package review browser assets", () => {
  it("ships standalone JavaScript and unique static IDs", () => {
    expect(
      () =>
        new Script(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT, {
          filename: "local-room-reality-review.js",
        }),
    ).not.toThrow();
    const ids = [
      ...LOCAL_ROOM_REALITY_REVIEW_HTML.matchAll(/\sid="([^"]+)"/gu),
    ].map((match) => match[1]);
    expect(ids).not.toContain(undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses fixed loopback routes and text nodes without executable escape hatches", () => {
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|localStorage|serviceWorker|WebSocket|EventSource/gu,
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).toContain(
      'requestJson("/api/room-reality-review/dossier"',
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).toContain(
      'requestJson("/api/room-reality-review/draft"',
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).toContain(
      'requestJson("/api/room-reality-review/state"',
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).toContain(
      "document.createElement(tag)",
    );
  });

  it("renders every required review boundary and responsive accessible controls", () => {
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).toContain(
      "for (const dimension of surface.dimensions)",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).toContain(
      'element("h4", "", dimension.label)',
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).toContain(
      '"Decisive next action: " + dimension.decisiveNextAction',
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT).toContain(
      "dimension.allowedActions",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "This page never opens raw E57 or source images, changes artifact geometry, grants authority, exports a package, or runs Foundry.",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "A review draft is not an approval",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "Package export</dt><dd>Not authorized",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "The room stays architectural; furniture stays planner state.",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_CSS).toContain(
      "@media (max-width: 680px)",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_CSS).toContain("min-height: 46px");
    expect(LOCAL_ROOM_REALITY_REVIEW_CSS).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
  });

  it("keeps visual loading in browser memory and limits mask compilation to one explicit loopback route", () => {
    expect(
      () =>
        new Script(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT, {
          filename: "local-e57-visual-review.js",
        }),
    ).not.toThrow();
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).not.toMatch(
      /XMLHttpRequest|WebSocket|EventSource|sendBeacon|innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|serviceWorker/gu,
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'const maskRoute = "/api/room-reality-review/e57-classification-mask"',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "const response = await fetch(\n        maskRoute + \"?token=\"",
    );
    expect(
      LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT.match(/\bfetch\(/gu),
    ).toHaveLength(1);
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "await file.arrayBuffer()",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'globalThis.crypto.subtle.digest("SHA-256", bytes)',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "const maximumFileBytes = 12 * 1024 * 1024",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "const maximumPoints = 50000",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'requireLiteral(item.authority, "none", "authority")',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "Cross-source overlays need reviewed registration evidence.",
    );
    for (const boundViewMember of [
      "canvasAspectRatio",
      "comparisonVisible",
      "previewBoundsM",
      "previewCorrection",
    ]) {
      expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(boundViewMember);
    }
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "Source comparison must remain not assessed unless a compatible non-empty comparison crop is effectively visible.",
    );
  });

  it("renders accessible point controls and all seven explicit preview decisions", () => {
    for (const id of [
      "primary-crop-file",
      "comparison-crop-file",
      "point-crop-canvas",
      "visual-decision-grid",
      "visual-annotation-list",
      "visual-draft-result",
    ]) {
      expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(`id="${id}"`);
    }
    for (const dimension of [
      "source_comparison",
      "alignment",
      "scale",
      "crop",
      "completeness",
      "privacy",
      "movable_objects",
    ]) {
      expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(`"${dimension}"`);
    }
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "Loading or rendering never decides a dimension.",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      'href="#visual-review-workbench"',
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "Generated crop transfer</dt><dd>Browser memory by default · explicit mask action sends only to this 127.0.0.1 process",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "They do not alter the artifact or create a TransformArtifact, Scene Authority Map, QA result, mask, or approved crop.",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_CSS).toContain(
      "#point-crop-canvas",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_CSS).toContain("touch-action: none");
    expect(LOCAL_ROOM_REALITY_REVIEW_CSS).toContain(
      "[hidden] { display: none !important; }",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_CSS).toContain(
      ".annotation-list button { flex: 0 0 auto; min-height: 44px; width: auto; }",
    );
  });

  it("clears artifact-bound observations on identity changes and keeps transforms out of the point loop", () => {
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "function resetArtifactBoundReviewState(exactBounds)",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "resetDecisionInputs();",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'resetArtifactBoundReviewState(null);\n    updateArtifactFacts();',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "resetCorrectionInputs();",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "primaryArtifact = artifact;\n        comparisonArtifact = null;\n        comparisonFile.value = \"\";\n        resetMaskAuthoring(artifact);\n        resetArtifactBoundReviewState(artifact.crop);",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "comparisonArtifact = artifact;\n        resetArtifactBoundReviewState(primaryArtifact.crop);",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "function createProjector(correction, width, height, pixelsPerMetre)",
    );
    const pointLoopStart = LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT.indexOf(
      "function drawPoints",
    );
    const pointLoopEnd = LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT.indexOf(
      "function render()",
      pointLoopStart,
    );
    const pointLoop = LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT.slice(
      pointLoopStart,
      pointLoopEnd,
    );
    expect(pointLoop).toContain("const screen = projector(");
    expect(pointLoop).not.toMatch(/Math\.(?:sin|cos)/gu);
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'byId("visual-reviewed-by").addEventListener("input", invalidateDraft)',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "new globalThis.ResizeObserver(handleVisualResize)",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "const minimumEffectiveComparisonOpacity = 0.05",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "comparisonArtifact.points.length > 0",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'canvas.addEventListener("lostpointercapture"',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'byId("build-visual-draft").disabled = !baseAvailable',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "Preview unavailable · correct the highlighted numeric evidence.",
    );
  });

  it("binds raw-frame mask rules to stale-safe local compilation and invalidates every downloadable result", () => {
    for (const id of [
      "classification-mask-panel",
      "mask-rule-id",
      "mask-rule-classification",
      "mask-selection-kind",
      "mask-exact-references",
      "mask-rule-list",
      "compile-classification-mask",
      "classification-mask-result",
      "mask-rule-counts",
      "download-classification-mask",
    ]) {
      expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(`id="${id}"`);
    }
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "Preview translation, rotation, scale, camera, and annotation bounds are deliberately ignored.",
    );
    expect(LOCAL_ROOM_REALITY_REVIEW_HTML).toContain(
      "Nothing is uploaded externally or persisted by the server.",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "let maskRequestEpoch = 0",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "if (activeMaskRequest) activeMaskRequest.abort()",
    );
    expect(
      LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT.match(
        /if \(requestEpoch !== maskRequestEpoch\) return;/gu,
      ),
    ).toHaveLength(2);
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'resetMaskAuthoring(null);\n    resetArtifactBoundReviewState(null);',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "artifactPointCount: primaryArtifact.points.length",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'coordinateRuleBoundary, "aabb_rules_apply_only_in_original_e57_root_metres_without_preview_correction"',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "const maximumMaskRequestBytes = 16 * 1024 * 1024",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "const maximumMaskResponseBytes = 64 * 1024 * 1024",
    );
  });

  it("cancels stale reads and draft hashes while bounding every serialized view", () => {
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "let primaryLoadEpoch = 0",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "let comparisonLoadEpoch = 0",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "if (!requestIsCurrent()) return;",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "const snapshot = snapshotVisualDraftInput();",
    );
    expect(
      LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT.match(
        /requireCurrentDraftRequest\(snapshot, submitEpoch\)/gu,
      ),
    ).toHaveLength(3);
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "function normalizeYawDegrees(value)",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "camera.yawDegrees = normalizeYawDegrees(camera.yawDegrees + 5)",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      "let observedCanvasSize = [canvas.clientWidth, canvas.clientHeight]",
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'window.addEventListener("pageshow"',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'const rawValue = byId(id).value.trim();',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).toContain(
      'if (rawValue === "") fail(label + " is required and cannot be blank.")',
    );
    expect(LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT).not.toContain(
      "Number(byId(id).value)",
    );
  });
});
