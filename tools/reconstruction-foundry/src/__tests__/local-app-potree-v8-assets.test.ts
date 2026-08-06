import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  LOCAL_FOUNDRY_APP_CSS,
  LOCAL_FOUNDRY_APP_HTML,
  LOCAL_FOUNDRY_APP_JAVASCRIPT,
} from "../local-app-assets.js";

describe("Foundry local app Potree V8 browser assets", () => {
  it("makes the scrollable preview keyboard-focusable, named, and politely described", () => {
    const panelStart = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="point-value-diagnostic"',
    );
    const panelEnd = LOCAL_FOUNDRY_APP_HTML.indexOf("</section>", panelStart);
    const panel = LOCAL_FOUNDRY_APP_HTML.slice(panelStart, panelEnd);

    expect(panel).toContain(
      'id="point-value-image-viewport" class="point-value-image-viewport" role="region" tabindex="0" aria-label="Scrollable decoded point preview" aria-describedby="point-value-caption"',
    );
    expect(panel).toContain(
      'id="point-value-image" class="point-value-image" alt="" width="1024" height="1024"',
    );
    expect(panel).toContain(
      'id="room-envelope-overlay" class="room-envelope-overlay" viewBox="0 0 1024 1024"',
    );
    expect(panel).toContain(
      'id="point-value-caption" aria-live="polite" aria-atomic="true"',
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".point-value-image-viewport:focus-visible { outline: 3px solid var(--mint-deep); outline-offset: 3px; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".point-value-image-stage { aspect-ratio: 1; min-width: 100%; position: relative; width: 100%; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".point-value-image { display: block; height: 100%; image-rendering: auto; max-width: none; object-fit: fill; width: 100%; }",
    );
  });

  it("applies the declared 1x zoom immediately and keeps later input changes consistent", () => {
    const zoomStart = LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
      "function updatePointValueZoom()",
    );
    const zoomEnd = LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
      'byId("point-value-zoom-reset")',
      zoomStart,
    );
    const zoomProgram = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(zoomStart, zoomEnd);
    const harness: {
      pointValueZoom: {
        value: string;
        listener?: () => void;
        addEventListener: (name: string, listener: () => void) => void;
      };
      pointValueImageStage: { style: { width: string } };
      pointValueZoomOutput: { value: string };
    } = {
      pointValueZoom: {
        value: "1",
        addEventListener(name, listener) {
          if (name === "input") this.listener = listener;
        },
      },
      pointValueImageStage: { style: { width: "" } },
      pointValueZoomOutput: { value: "" },
    };

    new Script(`
      const pointValueZoom = globalThis.pointValueZoom;
      const pointValueImageStage = globalThis.pointValueImageStage;
      const pointValueZoomOutput = globalThis.pointValueZoomOutput;
      ${zoomProgram}
    `, { filename: "local-foundry-potree-v8-zoom.js" }).runInNewContext(harness);

    expect(harness.pointValueImageStage.style.width).toBe("100%");
    expect(harness.pointValueZoomOutput.value).toBe("1×");
    expect(harness.pointValueZoom.listener).toBeTypeOf("function");

    harness.pointValueZoom.value = "2.5";
    harness.pointValueZoom.listener?.();
    expect(harness.pointValueImageStage.style.width).toBe("250%");
    expect(harness.pointValueZoomOutput.value).toBe("2.5×");
  });

  it("describes the deterministic projection collision rule without a front-orientation claim", () => {
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function renderPointValueCurrentBundle()",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function renderPointValueDiagnostic(value)",
      ),
    );

    expect(renderer).toContain(
      "For each occupied pixel, the record with the numerically greatest omitted position component is drawn; ties keep the lowest source ordinal.",
    );
    expect(renderer).not.toContain("frontmost record");
    expect(renderer).not.toContain("Positive omitted-component values");
    expect(renderer).toContain(
      '"; no units, up axis, or physical orientation are asserted."',
    );
  });

  it("binds selection and download to the exact current bundle, view, mode, and image digest", () => {
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function renderPointValueCurrentBundle()",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function renderPointValueDiagnostic(value)",
      ),
    );
    const resetIndex = renderer.indexOf("pointValueCurrentImage = null;");
    const exactSelectionIndex = renderer.indexOf(
      "images.find((candidate) => candidate.viewId === viewId && candidate.mode === mode)",
    );
    const assignmentIndex = renderer.indexOf(
      "pointValueCurrentImage = { bundle, image };",
    );

    expect(resetIndex).toBeGreaterThan(-1);
    expect(exactSelectionIndex).toBeGreaterThan(resetIndex);
    expect(assignmentIndex).toBeGreaterThan(exactSelectionIndex);
    expect(renderer.slice(exactSelectionIndex, assignmentIndex)).toContain(
      'pointValueCaption.textContent = "The selected digest-bound preview is unavailable.";',
    );

    const urlBuilder = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function pointValuePreviewUrl("),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function pointValueFactCard("),
    );
    for (const identity of [
      "bundle.bundleSha256",
      "image.viewId",
      "image.mode",
      "image.sha256",
    ]) {
      expect(urlBuilder).toContain(`encodeURIComponent(${identity})`);
    }

    const downloadHandler = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("download-point-value-image-button").addEventListener',
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("download-source-facts-v8-button").addEventListener',
      ),
    );
    const noSelectionGuardIndex = downloadHandler.indexOf(
      "if (!pointValueCurrentImage)",
    );
    const fetchIndex = downloadHandler.indexOf("const response = await fetch(");
    const changedSelectionGuardIndex = downloadHandler.indexOf(
      "pointValueCurrentImage.image.sha256 !== current.image.sha256",
    );
    const blobIndex = downloadHandler.indexOf("const blob = await response.blob();");

    expect(noSelectionGuardIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeGreaterThan(noSelectionGuardIndex);
    expect(changedSelectionGuardIndex).toBeGreaterThan(fetchIndex);
    expect(blobIndex).toBeGreaterThan(changedSelectionGuardIndex);
    expect(downloadHandler).toContain(
      "pointValueCurrentImage.bundle.bundleSha256 !== current.bundle.bundleSha256",
    );
    expect(downloadHandler).toContain(
      "The selected diagnostic changed during download. Request the current image again.",
    );
  });

  it("provides pointer and keyboard polygon editing with a conservative explicit decision", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="room-envelope-overlay" class="room-envelope-overlay" viewBox="0 0 1024 1024"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="room-envelope-x" type="number" min="0" max="1023" step="1"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="room-envelope-y" type="number" min="0" max="1023" step="1"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      '<option value="needs_revision" selected>Needs revision</option><option value="accepted_as_fit_seed">Accept as fit seed</option>',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="room-envelope-undo" class="button button-quiet" type="button" disabled',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="room-envelope-clear" class="button button-quiet" type="button" disabled',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "Math.floor((event.clientX - bounds.left) * 1024 / bounds.width)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "Math.floor((event.clientY - bounds.top) * 1024 / bounds.height)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "roomEnvelopeVertices.splice(index, 1)",
    );
  });

  it("requires three explicit exact-preview marks before posting a fit-seed-only review", () => {
    const reviewProgram = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("room-envelope-mark-preview").addEventListener',
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("download-point-value-image-button").addEventListener',
      ),
    );
    expect(reviewProgram).toContain(
      "roomEnvelopeReviewedPreviews.set(current.image.viewId",
    );
    expect(reviewProgram).toContain("pixelSha256: current.image.pixelSha256");
    expect(reviewProgram).toContain(
      "const reviewedPreviews = roomEnvelopeViewOrder.map((viewId) => roomEnvelopeReviewedPreviews.get(viewId));",
    );
    expect(reviewProgram).toContain(
      'const value = await postJson("/api/room-envelope-review"',
    );
    expect(reviewProgram).toContain(
      "polygonIntrinsicPixels: roomEnvelopeVertices.map((point) => [point[0], point[1]])",
    );
    expect(reviewProgram).not.toContain("reviewedAt:");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "This does not establish axes, units, room identity, orientation, physical accuracy, registration, rights, or validation independence.",
    );
  });
});
