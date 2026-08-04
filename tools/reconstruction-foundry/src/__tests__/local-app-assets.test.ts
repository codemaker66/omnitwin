import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  LOCAL_FOUNDRY_APP_CSS,
  LOCAL_FOUNDRY_APP_HTML,
  LOCAL_FOUNDRY_APP_JAVASCRIPT,
} from "../local-app-assets.js";

describe("Foundry local app browser assets", () => {
  it("ships valid standalone browser JavaScript", () => {
    expect(() => new Script(LOCAL_FOUNDRY_APP_JAVASCRIPT, {
      filename: "local-foundry-app.js",
    })).not.toThrow();
  });

  it("keeps static element IDs unique", () => {
    const ids = [...LOCAL_FOUNDRY_APP_HTML.matchAll(/\sid="([^"]+)"/gu)]
      .map((match) => match[1]);
    expect(ids).not.toContain(undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses text nodes and fixed local routes instead of executable browser escape hatches", () => {
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|localStorage|serviceWorker|WebSocket|EventSource/gu,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toMatch(/\bsourcePath\b/u);
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toContain("providerCredential");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain('postJson("/api/admission-draft"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain('postJson("/api/plan-preview"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("function renderQualityDecisionBoard(board)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "function appendQualityAssetDisclosure(parent, label, assets, emptyCopy)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("function renderProcessingOutline(outline)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("const preview = value.preview;");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "renderQualityDecisionBoard(value.qualityDecisionBoard)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("asset.relativePath");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("asset.assetId");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toContain("representedAssetIds");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toContain("affectedAssetIds");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /for \(const asset of affected\.slice\(0, 8\)\)[\s\S]*?asset\.relativePath \+ " \(" \+ asset\.assetId/u,
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="processing-outline"');
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="quality-decision-board"');
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="source-facts"');
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="source-facts-list"');
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Universal Source Facts V5");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Established facts come only from the fingerprinted E57, binary GLB, OBJ, SPZ, stored-ZIP SOG v2, classic Gaussian PLY, JPEG, PNG, ISO Base Media, CSV, and JSON bytes");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Calibration or trajectory document structure does not prove field semantics");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Coverage applies only to the selected receipt root and file set");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("function renderSourceFacts(value)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("Established from these exact bytes");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("for (const asset of value.assets)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("for (const item of asset.unknowns || [])");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain('"/api/source-facts"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '"foundry-universal-source-facts-v5.json"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="source-facts-download-status"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'sourceFactsDownloadStatus.textContent = "Exact source-facts response received for fingerprint "',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'aria-labelledby="quality-decision-board-heading"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Every expected gain remains unmeasured until its decisive comparison succeeds.",
    );
    const qualityRenderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function appendQualityAssetDisclosure"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function renderProcessingOutline"),
    );
    expect(qualityRenderer).not.toContain(".slice(0, 8)");
    expect(qualityRenderer).toContain("for (const asset of represented)");
    expect(qualityRenderer).toContain("decision.evidenceRequirements");
    expect(qualityRenderer).toContain("Present, not reviewed");
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".quality-card-head { align-items: flex-start; flex-direction: column; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-facts-summary, .source-fact-columns { grid-template-columns: 1fr; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).not.toContain("html { min-width: 320px");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "This is a file-to-activity outline only. It does not select a worker, compile a recipe, or say that any activity can run.",
    );
  });

  it("shows both the reason and labelled decisive next test for every structured source-fact gap", () => {
    const unknownRenderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function appendSourceUnknown"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function renderSourceFacts"),
    );
    expect(unknownRenderer).toContain("const reason = unknown.reason || unknown.message;");
    expect(unknownRenderer).toContain("const nextTest = unknown.decisiveNextTest;");
    expect(unknownRenderer).toContain(
      'element("span", "source-fact-next-test", "Next test: " + String(nextTest))',
    );
    expect(unknownRenderer).not.toContain(
      "unknown.reason || unknown.message || unknown.decisiveNextTest",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-fact-next-test { color: #315c58; display: block;",
    );
  });

  it("separates unresolved facts from source-level Source Facts coverage", () => {
    const sourceFactsRenderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function renderSourceFacts"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function sourceReadinessStatusLabel"),
    );

    expect(sourceFactsRenderer).toContain(
      'value.assets.reduce((total, asset) => total + (asset.unknowns || []).length, 0)',
    );
    expect(sourceFactsRenderer).toContain('["Unresolved facts", unresolvedFactCount]');
    expect(sourceFactsRenderer).toContain('["Sources not established or untargeted",');
    expect(sourceFactsRenderer).not.toContain('["Gaps or outside scope",');
    expect(sourceFactsRenderer).toContain("receiptCandidateInputTypes");
    expect(sourceFactsRenderer).toContain("Container facts do not select a camera or panorama role, or a captured, enhanced, generated, or concept provenance class.");
    expect(sourceFactsRenderer).toContain('"Container facts established"');
    expect(sourceFactsRenderer).toContain('"Container facts not established"');
    expect(sourceFactsRenderer).toContain("Established container facts from these exact bytes");
    expect(sourceFactsRenderer).toContain("No container facts established from these exact bytes");
    expect(sourceFactsRenderer).toContain("Still unknown beyond the container");
    expect(sourceFactsRenderer).toContain('asset.source.inputType === "trajectory"');
    expect(sourceFactsRenderer).toContain('asset.source.inputType === "calibration_bundle"');
    expect(sourceFactsRenderer).toContain("Document structure does not establish field semantics, clock or units, frames, transform conventions, calibration validity, provenance, registration, or accuracy.");
    expect(sourceFactsRenderer).toContain('"Document structure established"');
    expect(sourceFactsRenderer).toContain('"Document structure not established"');
    expect(sourceFactsRenderer).toContain("Established document structure from these exact bytes");
    expect(sourceFactsRenderer).toContain("Still unknown beyond document structure");
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-facts-summary { display: grid; gap: 10px; grid-template-columns: repeat(5, minmax(0, 1fr));",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-facts-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-facts-summary, .source-fact-columns { grid-template-columns: 1fr; }",
    );
  });

  it("renders nested SPZ extension and stream facts through text-only recursive rows", () => {
    const sourceFactRows = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function appendSourceFactRows"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function appendSourceUnknown"),
    );

    expect(sourceFactRows).toContain("if (Array.isArray(value))");
    expect(sourceFactRows).toContain("value.slice(0, previewLimit)");
    expect(sourceFactRows).toContain("complete list is in the source-facts download");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "display truncated; complete value is in the source-facts download",
    );
    expect(sourceFactRows).toContain("for (let index = 0; index < value.length; index += 1)");
    expect(sourceFactRows).toContain(
      "appendSourceFactRows(target, value[index], trail.concat(String(index + 1)))",
    );
    expect(sourceFactRows).toContain("const keys = Object.keys(value).sort()");
    expect(sourceFactRows).toContain(
      "for (const key of keys) appendSourceFactRows(target, value[key], trail.concat(key))",
    );
    expect(sourceFactRows).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/u);
  });

  it("renders long Gaussian PLY property layouts in a bounded disclosure table", () => {
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "function appendGaussianPlyProperties(target, properties)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'properties.length + " declared Gaussian PLY properties and byte offsets"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'asset.format === "gaussian_ply"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'if (key !== "properties") gaussianSummary[key] = item;',
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-fact-property-wrap { border: 1px solid #c7d0cd; border-radius: 9px; margin-top: 10px; max-height: 420px; overflow: auto; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-fact-property-table { min-width: 620px; }",
    );
  });

  it("renders the receipt-stage Source Readiness Map directly after Source Facts without implying admission", () => {
    const sourceFactsIndex = LOCAL_FOUNDRY_APP_HTML.indexOf('id="source-facts"');
    const sourceReadinessIndex = LOCAL_FOUNDRY_APP_HTML.indexOf('id="source-readiness"');
    const receiptFooterIndex = LOCAL_FOUNDRY_APP_HTML.indexOf('class="receipt-footer"');
    const guidedWorkflowIndex = LOCAL_FOUNDRY_APP_HTML.indexOf('id="guided-workflow"');

    expect(sourceFactsIndex).toBeGreaterThan(-1);
    expect(sourceReadinessIndex).toBeGreaterThan(sourceFactsIndex);
    expect(receiptFooterIndex).toBeGreaterThan(sourceReadinessIndex);
    expect(guidedWorkflowIndex).toBeGreaterThan(receiptFooterIndex);
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Source Readiness Map V5");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "What this source set covers—and what is still missing",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Pre-admission map · authority none");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "This reports receipt-stage candidates and byte-fact coverage only.",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "It does not approve files, compile a route or recipe, select a worker or provider, establish rights, accuracy, or registration, or say anything can run.",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).not.toContain("Source Readiness Map V5 Ready");
    expect(LOCAL_FOUNDRY_APP_HTML).not.toContain("Supported");
    expect(LOCAL_FOUNDRY_APP_HTML).not.toContain("Processable");
  });

  it("renders every source-family lane, represented path, grouped gap, and decisive next test with text nodes", () => {
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function sourceReadinessStatusLabel"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function updateSaveStep"),
    );

    expect(renderer).toContain("function renderSourceReadiness(value)");
    expect(renderer).toContain('all_observed_facts_established: "All observed Source Facts V5 established"');
    expect(renderer).toContain('facts_established: "Source Facts V5 established"');
    expect(renderer).toContain('outside_source_facts_v5: "Outside Source Facts V5"');
    expect(renderer).not.toContain("outside_source_facts_v1");
    expect(renderer).toContain('evidence_incomplete: "Evidence incomplete"');
    expect(renderer).toContain('no_source_observed: "No source observed"');
    expect(renderer).toContain('blocked: "Evaluation withheld"');
    expect(renderer).toContain("for (const lane of value.lanes || [])");
    expect(renderer).toContain("value.gaps.filter((gap) => Array.isArray(gap.laneIds) && gap.laneIds.includes(lane.id))");
    expect(renderer).toContain("for (const source of representedSources)");
    expect(renderer).toContain("for (const unknown of unknowns)");
    expect(renderer).toContain("for (const test of nextTests)");
    expect(renderer).toContain('element("details", "readiness-details")');
    expect(renderer).toContain('element("summary", "", "Sources represented ("');
    expect(renderer).toContain('"Next test: " + String(gap.decisiveNextTest)');
    expect(renderer).toContain('element("p", "readiness-lane-meaning", lane.meaning)');
    expect(renderer).toContain('"Reason code: " + lane.reasonCode');
    expect(renderer).not.toContain(".slice(");
    expect(renderer).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/u);
  });

  it("shows only the blocker, action, and affected paths when XBIN withholds evaluation", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="source-readiness-blocker" class="plain-warning source-readiness-blocker" role="alert" aria-live="assertive" aria-atomic="true" hidden',
    );
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function renderSourceReadiness(value)"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function updateSaveStep"),
    );
    const blockedBranch = renderer.slice(
      renderer.indexOf('if (value.state === "blocked")'),
      renderer.indexOf("const summary = value.summary || {}"),
    );

    expect(blockedBranch).toContain("sourceReadinessSummary.hidden = true");
    expect(blockedBranch).toContain("sourceReadinessLanes.hidden = true");
    expect(blockedBranch).not.toContain("sourceReadinessFooter.hidden = true");
    expect(blockedBranch).toContain("blocked.nextAction ||");
    expect(blockedBranch).toContain(
      'appendSourceReadinessPaths(sourceReadinessBlocker, affectedSources, "Affected source paths")',
    );
    expect(blockedBranch).toMatch(/sourceReadinessBlocker\.hidden = false;\s+return;/u);
    expect(blockedBranch).not.toContain("for (const lane");
    expect(blockedBranch).not.toContain("for (const source");
    expect(blockedBranch).not.toContain("for (const unknown");
  });

  it("renders the Source Readiness Map once from initial ready state and keeps 320px content stacked", () => {
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("let sourceReadiness = null;");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "if (!sourceReadiness && state.sourceReadiness) renderSourceReadiness(state.sourceReadiness);",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(".source-readiness { min-width: 0; }");
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-readiness-summary, .readiness-counts { grid-template-columns: 1fr; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-readiness-head, .readiness-lane-head { align-items: flex-start; flex-direction: column; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(".source-readiness-footer code { display: block;");
    expect(LOCAL_FOUNDRY_APP_CSS).toContain("overflow-wrap: anywhere; white-space: normal;");
    expect(LOCAL_FOUNDRY_APP_CSS).not.toContain(".source-readiness-lanes { overflow-x:");
    expect(LOCAL_FOUNDRY_APP_CSS).not.toContain(".source-readiness table");
  });

  it("downloads the exact current Source Readiness Map by its fingerprint", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="download-source-readiness-button"');
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Download readiness map");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'byId("download-source-readiness-button").addEventListener("click"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain('"/api/source-readiness"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '"foundry-source-readiness-map-v5.json"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "sourceReadiness && sourceReadiness.readinessSha256",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="source-readiness-download-status"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'sourceReadinessDownloadStatus.textContent = "Exact readiness-map response received for fingerprint "',
    );
  });

  it("places the Operator Evidence Checklist after readiness and before guided admission", () => {
    const readinessIndex = LOCAL_FOUNDRY_APP_HTML.indexOf('id="source-readiness"');
    const checklistIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="operator-evidence-checklist"',
    );
    const receiptFooterIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'class="receipt-footer"',
    );

    expect(checklistIndex).toBeGreaterThan(readinessIndex);
    expect(receiptFooterIndex).toBeGreaterThan(checklistIndex);
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Operator Evidence Checklist V5");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("What to collect or verify next");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Pre-admission requests · authority none",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Its ordering describes evidence dependencies only.",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "It does not decide which requests your intended output needs, collect evidence, mark anything complete, approve a file, establish rights, accuracy, or registration, compile a route or recipe, select a worker or provider, or authorize work.",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="operator-evidence-blocker" class="plain-warning operator-evidence-blocker" role="status" aria-live="polite" aria-atomic="true" hidden',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="operator-evidence-download-status" class="operator-evidence-download-status" role="status" aria-live="polite" aria-atomic="true"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).not.toContain("Evidence Checklist Ready");
  });

  it("renders every checklist group, request, completion requirement, lane, and source without truncation", () => {
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function operatorEvidencePriorityLabel",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function updateSaveStep"),
    );

    expect(renderer).toContain("function renderOperatorEvidenceChecklist(value)");
    expect(renderer).toContain("for (const group of value.groups || [])");
    expect(renderer).toContain("for (const itemId of group.itemIds || [])");
    expect(renderer).toContain(
      "for (const requirement of value.completionEvidenceRequirements || [])",
    );
    expect(renderer).toContain("for (const source of sources)");
    expect(renderer).toContain('details.addEventListener("toggle"');
    expect(renderer).toContain("if (!details.open || populated) return");
    expect(renderer).toContain("completionEvidenceRequirements");
    expect(renderer).toContain("Still not established: ");
    expect(renderer).toContain("Affected source families: ");
    expect(renderer).toContain("Source families: ");
    expect(renderer).toContain("Source paths / distinct contents");
    expect(renderer).toContain("exact-content duplicate · group SHA-256 ");
    expect(renderer).toContain("unique within this receipt");
    expect(renderer).toContain(
      "No existing source path — this conditional request concerns a missing source family. Its necessity is not evaluated.",
    );
    expect(renderer).toContain('element("details", "evidence-source-details")');
    expect(renderer).not.toContain(".slice(");
    expect(renderer).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/u);
  });

  it("keeps XBIN checklist output to one polite export blocker while retaining the digest footer", () => {
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function renderOperatorEvidenceChecklist(value)",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function updateSaveStep"),
    );
    const blockedBranch = renderer.slice(
      renderer.indexOf('if (value.state === "blocked")'),
      renderer.indexOf("const summary = value.summary || {}"),
    );

    expect(blockedBranch).toContain("operatorEvidenceSummary.hidden = true");
    expect(blockedBranch).toContain("operatorEvidenceGroups.hidden = true");
    expect(blockedBranch).not.toContain("operatorEvidenceFooter.hidden = true");
    expect(blockedBranch).toContain("appendOperatorEvidenceRequest(operatorEvidenceBlocker, blocked)");
    expect(blockedBranch).toContain(
      "appendOperatorEvidenceSources(operatorEvidenceBlocker, blocked.affectedSources || [])",
    );
    expect(blockedBranch).toMatch(
      /operatorEvidenceBlocker\.hidden = false;\s+return;/u,
    );
    expect(blockedBranch).not.toContain("for (const group");
    expect(blockedBranch).not.toContain("for (const itemId");
  });

  it("renders the checklist once, stacks it at 320px, and downloads only the exact current digest", () => {
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "let operatorEvidenceChecklist = null;",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "if (!operatorEvidenceChecklist && state.operatorEvidenceChecklist)",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".operator-evidence-checklist { min-width: 0; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".operator-evidence-summary { grid-template-columns: 1fr; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".operator-evidence-head, .operator-evidence-group-head, .operator-evidence-item-head { align-items: flex-start; flex-direction: column; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".source-fact-card-head, .source-facts-footer, .source-readiness-footer, .operator-evidence-footer { align-items: flex-start; flex-direction: column; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).not.toContain(
      ".operator-evidence-groups { overflow-x:",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).not.toContain(
      ".operator-evidence-checklist table",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="download-operator-evidence-button"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'byId("download-operator-evidence-button").addEventListener("click"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '"/api/operator-evidence-checklist"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '"foundry-operator-evidence-checklist-v5.json"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "operatorEvidenceChecklist && operatorEvidenceChecklist.checklistSha256",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'operatorEvidenceDownloadStatus.textContent = "Requesting the exact current checklist…"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'operatorEvidenceDownloadStatus.textContent = "Exact checklist response received for fingerprint "',
    );
  });

  it("warns before an uncompiled review can be lost on Stop or tab close", () => {
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("let reviewDirty = false;");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("let planDirty = false;");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /function markAdmissionStale\(\) \{\s+reviewDirty = true;/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /stopButton\.addEventListener\("click"[\s\S]*?reviewDirty \|\| planDirty \|\| unsavedDraft \|\| unsavedPlan/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /window\.addEventListener\("beforeunload"[\s\S]*?!reviewDirty && !planDirty && !unsavedDraft && !unsavedPlan/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /stopResult\.verificationStopped !== true \|\|\s+stopResult\.offlinePreviewStopped !== true[\s\S]*?reviewDirty = false;\s+planDirty = false;\s+admissionArtifact = null;\s+planArtifact = null;/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /function renderAdmissionSuccess\(value\)[\s\S]*?reviewDirty = false;/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "if (reviewRevision !== submittedReviewRevision)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "if (planRevision !== submittedPlanRevision)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /function markPlanStale\(\) \{\s+planDirty = true;/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /function renderPlanPreview\(value\)[\s\S]*?planDirty = false;/u,
    );
  });

  it("keeps local verification controllable, recoverable after refresh, and honest about scope", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Check the approved files again");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("It does not improve or reconstruct the room");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("a code calculated from the file’s contents");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("may contain tiny pieces of source data");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("only while this local app session stays open");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("£0.00 provider charge");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Electricity, staff time, and hardware wear are not included");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Using the last saved review draft");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("The decision form above reset when this page reloaded and does not show that saved draft.");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain('postJson("/api/reference-verification/current", {})');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("void restoreCurrentVerification(state)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("verificationSavedDraftContext.hidden = false");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /function renderAdmissionSuccess\(value\)[\s\S]*?verificationSavedDraftContext\.hidden = true;/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("setAdmissionEditingLocked(value.phase === \"checking\")");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("pendingVerificationStartRequestId = pendingVerificationStartRequestId || newVerificationRequestId()");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain('expected.kind === "new_job"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain('expected.kind === "next_run"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("function syncServerAdmissionBinding(state)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("The old verification result is no longer shown as current.");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toContain("server deliberately keeps no copy");
  });

  it("keeps checking expiry after intake finishes and discloses downloaded evidence", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="session-warning"');
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("relative file names and fingerprints");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("const READY_SESSION_POLL_MS = 15_000;");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("const SESSION_WARNING_MS = 15 * 60 * 1_000;");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /state\.phase === "ready"[\s\S]*?window\.setTimeout\(loadState, READY_SESSION_POLL_MS\)/u,
    );
  });

  it("renders the 500th decision but hands a 501-file receipt to the batch reviewer", () => {
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "if (value.files.length > maximumGuidedFiles)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "for (let index = 0; index < value.files.length; index += 1)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "Download it and give it to the project's authorized capture reviewer so no file is silently omitted.",
    );
  });
});

describe("offline GLB format preview browser surface", () => {
  it("places one optional panel after the guided review without making it a required step", () => {
    const guidedIndex = LOCAL_FOUNDRY_APP_HTML.indexOf('id="guided-workflow"');
    const planIndex = LOCAL_FOUNDRY_APP_HTML.indexOf('id="plan-workbench"');
    const previewIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="offline-normalization-preview"',
    );
    const previewTagIndex = LOCAL_FOUNDRY_APP_HTML.lastIndexOf(
      "<section",
      previewIndex,
    );
    const stepStart = LOCAL_FOUNDRY_APP_HTML.indexOf('<ol class="steps"');
    const stepEnd = LOCAL_FOUNDRY_APP_HTML.indexOf("</ol>", stepStart);
    const immediatelyBeforePreview = LOCAL_FOUNDRY_APP_HTML.slice(
      guidedIndex,
      previewTagIndex,
    );

    expect(guidedIndex).toBeGreaterThan(-1);
    expect(planIndex).toBeGreaterThan(guidedIndex);
    expect(previewIndex).toBeGreaterThan(planIndex);
    expect(immediatelyBeforePreview).toMatch(/<\/section>\s*<\/section>\s*$/u);
    expect(LOCAL_FOUNDRY_APP_HTML.slice(stepStart, stepEnd)).not.toContain(
      "offline-preview",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Optional offline GLB format preview",
    );
  });

  it("states every human-readable truth boundary without quality claims", () => {
    const previewIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="offline-normalization-preview"',
    );
    const previewEnd = LOCAL_FOUNDRY_APP_HTML.indexOf(
      "</section>",
      previewIndex,
    );
    const panel = LOCAL_FOUNDRY_APP_HTML.slice(previewIndex, previewEnd);

    expect(panel).toContain("This preview changes storage format only.");
    expect(panel).toContain("It adds no detail or accuracy");
    expect(panel).toContain("does not reconstruct anything");
    expect(panel).toContain("does not make a file ready for production");
    expect(panel).toContain(
      "this helper thread is not a security sandbox",
    );
    expect(panel).toContain("The helper thread runs as your Windows user.");
    expect(panel).toContain("Trusted source only");
    expect(panel).toContain("Production execution</dt><dd>Disabled");
    expect(panel).toContain("Authority</dt><dd>None");
    expect(panel).toContain("Server persistence</dt><dd>None");
    expect(panel).toContain("App-held result</dt><dd>Session memory copy only");
    expect(panel).toContain("Local-disk proof</dt><dd>Not established");
    expect(panel).toContain("Security sandbox</dt><dd>Not established");
    expect(panel).toContain("not a whole-process memory limit");
    expect(panel).toContain("could still fetch source bytes");
    expect(panel).toContain("which may be cloud-synced.");
    expect(panel).toContain(
      "The app keeps its separate memory copy until the permit expires or this session stops.",
    );
    expect(panel).toContain("This is not secure erasure");
    expect(panel).toContain("Windows paging, crash dumps");
    expect(panel).toContain("Canonical report digest");
    expect(panel).not.toContain("Report fingerprint");
    expect(panel).toContain("does not record a new operator statement");
    expect(panel).not.toContain("Recording your intent");
    expect(panel).not.toMatch(/\b(?:optimized|compressed|HD|better)\b/iu);
  });

  it("uses an exact path-free public DTO and rejects every extra field", () => {
    const parser = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function hasExactObjectKeys(value, expectedKeys)",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function clearOfflinePreviewPoll()",
      ),
    );

    expect(parser).toContain("function parseOfflineNormalizationPreview(value)");
    expect(parser).toContain('"productionExecution"');
    expect(parser).toContain('"authority"');
    expect(parser).toContain('"serverPersistence"');
    expect(parser).toContain('"custody"');
    expect(parser).toContain('"trustedSourceOnly"');
    expect(parser).toContain('"localVolumeEstablished"');
    expect(parser).toContain('"sandboxEstablished"');
    expect(parser).toContain(
      'hasExactObjectKeys(value.source, ["sizeBytes", "sha256"])',
    );
    expect(parser).toContain(
      'hasExactObjectKeys(value.output, ["sizeBytes", "sha256", "reportSha256", "semanticExactMatch"])',
    );
    expect(parser).toContain(
      "/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/.test(value.previewAssetId)",
    );
    expect(parser).toContain(
      "returned an offline preview field this page does not accept",
    );
    expect(parser).toContain("const blockedReferenceIsConsistent");
    expect(parser).toContain(
      "(value.requestId !== null && value.previewAssetId !== null)",
    );
    for (const forbidden of [
      "sourcePath",
      "relativePath",
      "permitEnvelope",
      "trustedPermitKeys",
      "command",
      "environment",
      "credential",
      "outputPath",
    ]) {
      expect(parser).not.toContain(forbidden);
    }
  });

  it("accepts safe unscoped and request-scoped blocked preview states", () => {
    const executableParser = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function isOfflinePreviewDigest(value)",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function clearOfflinePreviewPoll()",
      ),
    );
    const harness: {
      parseOfflinePreviewForTest?: (value: unknown) => unknown;
    } = {};
    new Script(
      `${executableParser}\nglobalThis.parseOfflinePreviewForTest = parseOfflineNormalizationPreview;`,
      { filename: "local-foundry-offline-preview-parser.js" },
    ).runInNewContext(harness);
    const parseOfflinePreview = harness.parseOfflinePreviewForTest;
    if (parseOfflinePreview === undefined) {
      throw new Error("offline preview parser test harness was not installed");
    }

    const boundary = {
      productionExecution: "disabled",
      authority: "none",
      serverPersistence: "none",
      custody: "session_memory_only",
      trustedSourceOnly: true,
      localVolumeEstablished: false,
      sandboxEstablished: false,
    } as const;
    const unscopedBlocked = {
      state: "blocked",
      previewAssetId: null,
      requestId: null,
      message: "No trusted private preview is available.",
      source: null,
      output: null,
      ...boundary,
    };
    const requestScopedBlocked = {
      state: "blocked",
      previewAssetId: "missing-preview-binding",
      requestId: "22222222222222222222222222222222",
      message: "The exact private preview binding was not found.",
      source: null,
      output: null,
      ...boundary,
    };

    expect(parseOfflinePreview(unscopedBlocked)).toBe(unscopedBlocked);
    expect(parseOfflinePreview(requestScopedBlocked)).toBe(requestScopedBlocked);
    expect(() => parseOfflinePreview({
      ...requestScopedBlocked,
      previewAssetId: null,
    })).toThrow("internally inconsistent offline preview state");
  });

  it("uses only fixed routes, exact browser bodies, stale-request guards, and custody-confirmed downloads", () => {
    const interactions = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("start-offline-preview-button").addEventListener',
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("hd-appearance").addEventListener',
      ),
    );

    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'postJson("/api/offline-normalization-preview/status", {',
    );
    expect(interactions).toContain(
      'postJson("/api/offline-normalization-preview/start", {',
    );
    expect(interactions).toContain("receiptSha256: receipt.receiptSha256");
    expect(interactions).toContain(
      "previewAssetId: offlinePreviewArtifact.previewAssetId",
    );
    expect(interactions).toContain(
      'postJson("/api/offline-normalization-preview/cancel", {',
    );
    expect(interactions).toContain(
      '"/api/offline-normalization-preview/output"',
    );
    expect(interactions).toContain(
      '"/api/offline-normalization-preview/report"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '"&requestId=" + encodeURIComponent(expectedRequestId)',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '"&digest=" + encodeURIComponent(digest)',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "offlinePreviewArtifact.requestId !== expectedRequestId",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "if (offlinePreviewPollTimer !== null) window.clearTimeout(offlinePreviewPollTimer)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "offlinePreviewPollTimer = null;\n      void pollOfflineNormalizationPreview();",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "You control the downloaded copy; the app keeps its separate memory copy until expiry or stop",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'parsed.message + " Nothing unverified is available."',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toContain(
      "Recording intent and requesting",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'parsed.state === "ready"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "Start a new local session to try again",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toContain(
      "run a fresh preview",
    );
    expect(interactions).not.toMatch(
      /sourcePath|relativePath|permitEnvelope|trustedPermitKeys|command|environment|credential|outputPath/u,
    );
  });

  it("keeps the optional work controllable, accessible, and protected on stop or tab close", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="offline-preview-status" class="offline-preview-status" data-state="blocked" role="status" aria-live="polite" aria-atomic="true"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="offline-preview-error" class="error-panel" role="alert" tabindex="-1" hidden',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "function offlinePreviewNeedsAttention()",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /stopButton\.addEventListener\("click"[\s\S]*?verificationStillRunning \|\| privatePreviewNeedsAttention/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /window\.addEventListener\("beforeunload"[\s\S]*?!verificationStillRunning && !privatePreviewNeedsAttention/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "the app will clear its preview buffer on a best-effort basis",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".offline-preview-boundaries, .offline-preview-result-facts { grid-template-columns: 1fr; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".offline-preview-head { align-items: flex-start; flex-direction: column; }",
    );
  });
});
