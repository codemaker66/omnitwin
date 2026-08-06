import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  LOCAL_FOUNDRY_APP_CSS,
  LOCAL_FOUNDRY_APP_HTML,
  LOCAL_FOUNDRY_APP_JAVASCRIPT,
} from "../local-app-assets.js";
import { LOCAL_HD_WORKER_READINESS_DTO_V0 } from "../local-hd-worker-readiness.js";

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

  it("shows the build-owned worker plan after the receipt without offering execution", () => {
    const receiptFooterIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'class="receipt-footer"',
    );
    const workerPanelIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="local-hd-worker-readiness"',
    );
    const guidedWorkflowIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="guided-workflow"',
    );
    expect(workerPanelIndex).toBeGreaterThan(receiptFooterIndex);
    expect(guidedWorkflowIndex).toBeGreaterThan(workerPanelIndex);
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Pinned plan — not installed or ready to run",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "This environment plan is not matched to this source or plan.",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Plan recorded · no execution",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Candidate bundle recorded — clean-host check still open",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "The exact Python 3.13 bundle used by the aggregate-only E57 adapter and its legal pack now reproduce to the same receipt",
    );
    const panelHtml = LOCAL_FOUNDRY_APP_HTML.slice(
      workerPanelIndex,
      guidedWorkflowIndex,
    );
    expect(panelHtml).not.toMatch(/<button|<form|<input|<select/iu);

    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function requireLocalHdWorkerReadiness",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function updateSaveStep"),
    );
    expect(renderer).toContain("function renderLocalHdWorkerReadiness(input)");
    expect(renderer).toContain(
      "function renderLocalE57IntakeEnvironmentReadiness(input)",
    );
    expect(renderer).toContain("for (const artifact of value.artifacts)");
    expect(renderer).toContain("for (const item of followUp.remainingGates)");
    expect(renderer).toContain("for (const lane of value.capabilityLanes)");
    expect(renderer).toContain("for (const component of value.components)");
    expect(renderer).toContain("for (const exclusion of value.exclusions)");
    expect(renderer).not.toContain(".slice(");
    expect(renderer).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/iu);
    expect(renderer).toContain(
      "Do not build, run, or deploy the legacy worker image",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "if (!localHdWorkerRendered) renderLocalHdWorkerReadiness(state.localHdWorker);",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".local-hd-worker-summary, .local-hd-worker-lanes, .local-hd-worker-components { grid-template-columns: 1fr; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".local-hd-worker-footer code { display: block;",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".local-e57-summary, .local-e57-columns { grid-template-columns: 1fr; }",
    );
  });

  it("rejects extra fields, identity drift, and local GPU-worker aliases before rendering", () => {
    const exactKeysHelper = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function hasExactObjectKeys(value, expectedKeys)",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function isCapturedQualityDigest(value)",
      ),
    );
    const readinessParser = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function requireLocalE57IntakeEnvironmentReadiness(value, parentManifestSha256)",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function renderLocalHdWorkerReadiness(input)",
      ),
    );
    const harness: {
      parseLocalHdWorkerReadinessForTest?: (value: unknown) => unknown;
    } = {};
    new Script(
      `${exactKeysHelper}\n${readinessParser}\nglobalThis.parseLocalHdWorkerReadinessForTest = requireLocalHdWorkerReadiness;`,
      { filename: "local-foundry-hd-worker-readiness-parser.js" },
    ).runInNewContext(harness);
    const parseReadiness = harness.parseLocalHdWorkerReadinessForTest;
    if (parseReadiness === undefined) {
      throw new Error("HD-worker readiness parser test harness was not installed");
    }

    expect(() => parseReadiness(LOCAL_HD_WORKER_READINESS_DTO_V0)).not.toThrow();
    expect(() => parseReadiness({
      ...LOCAL_HD_WORKER_READINESS_DTO_V0,
      unexpectedAuthority: true,
    })).toThrow();
    expect(() => parseReadiness({
      ...LOCAL_HD_WORKER_READINESS_DTO_V0,
      summary: {
        ...LOCAL_HD_WORKER_READINESS_DTO_V0.summary,
        unexpectedCount: 1,
      },
    })).toThrow();
    expect(() => parseReadiness({
      ...LOCAL_HD_WORKER_READINESS_DTO_V0,
      capabilityLanes: LOCAL_HD_WORKER_READINESS_DTO_V0.capabilityLanes.map(
        (lane) => lane.id === "gaussian_training"
          ? { ...lane, executionLocation: "local_windows_candidate" }
          : lane,
      ),
    })).toThrow();
    expect(() => parseReadiness({
      ...LOCAL_HD_WORKER_READINESS_DTO_V0,
      capabilityLanes: [
        ...LOCAL_HD_WORKER_READINESS_DTO_V0.capabilityLanes.slice(0, 4),
        LOCAL_HD_WORKER_READINESS_DTO_V0.capabilityLanes[0],
      ],
    })).toThrow();
    expect(() => parseReadiness({
      ...LOCAL_HD_WORKER_READINESS_DTO_V0,
      components: LOCAL_HD_WORKER_READINESS_DTO_V0.components.map(
        (component, index) => index === 0
          ? { ...component, unexpectedField: true }
          : component,
      ),
    })).toThrow();
    expect(() => parseReadiness({
      ...LOCAL_HD_WORKER_READINESS_DTO_V0,
      e57Environment: {
        ...LOCAL_HD_WORKER_READINESS_DTO_V0.e57Environment,
        unexpectedReadyFlag: true,
      },
    })).toThrow();
    expect(() => parseReadiness({
      ...LOCAL_HD_WORKER_READINESS_DTO_V0,
      e57Environment: {
        ...LOCAL_HD_WORKER_READINESS_DTO_V0.e57Environment,
        artifacts: LOCAL_HD_WORKER_READINESS_DTO_V0.e57Environment.artifacts
          .map((artifact) => artifact.id === "pye57-wheel"
            ? {
              ...artifact,
              filename: "pye57-0.4.19-cp310-cp310-win_amd64.whl",
            }
            : artifact),
      },
    })).toThrow();
    expect(() => parseReadiness({
      ...LOCAL_HD_WORKER_READINESS_DTO_V0,
      e57Environment: {
        ...LOCAL_HD_WORKER_READINESS_DTO_V0.e57Environment,
        bundle: {
          ...LOCAL_HD_WORKER_READINESS_DTO_V0.e57Environment.bundle,
          state: "verified",
        },
      },
    })).toThrow();
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
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Universal Source Facts V7");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("V7 preserves the complete V6 source-facts artifact");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("exact Potree v2 metadata.json, hierarchy.bin, and octree.bin bundles");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("does not decode point values or establish units, frame, CRS, physical bounds, completeness, registration, accuracy, provenance, rights, or viewer fidelity");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Coverage applies only to this fingerprinted receipt root and file set");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="potree-source-facts-list"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("function renderSourceFacts(value)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("Established from these exact bytes");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("for (const asset of value.assets)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("for (const item of asset.unknowns || [])");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("function appendPointPlyProperties(target, properties)");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain("declared point PLY properties and byte offsets");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain('"/api/source-facts"');
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '"foundry-universal-source-facts-v7.json"',
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
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function renderInheritedSourceFacts"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function sourceReadinessStatusLabel"),
    );

    expect(sourceFactsRenderer).toContain('["Inherited V6 assets", summary.inheritedAssetCount]');
    expect(sourceFactsRenderer).toContain('["Potree bundles", summary.potreeBundleCount]');
    expect(sourceFactsRenderer).toContain('["Potree structures established", summary.establishedPotreeBundleCount]');
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
    expect(sourceFactsRenderer).toContain("function appendPotreeMemberIdentities(parent, bundle)");
    expect(sourceFactsRenderer).toContain("Exact three-member identity (");
    expect(sourceFactsRenderer).toContain("function potreeCompatibilityNotes(bundle)");
    expect(sourceFactsRenderer).toContain("Compatibility deviations and boundaries (");
    expect(sourceFactsRenderer).toContain('compatibility.declaredHierarchyDepth === "differs_from_observed_accepted"');
    expect(sourceFactsRenderer).toContain('compatibility.leafChildMasks === "observed_and_accepted_by_official_loader_semantics"');
    expect(sourceFactsRenderer).toContain("leaf hierarchy records advertise child masks");
    expect(sourceFactsRenderer).toContain('compatibility.proxyReplacementDeclarations === "target_record_overwrite_mismatches_observed_and_accepted"');
    expect(sourceFactsRenderer).toContain("proxyReplacementChildMaskMismatchCount");
    expect(sourceFactsRenderer).toContain("proxyReplacementPointCountMismatchCount");
    expect(sourceFactsRenderer).toContain("attribute.histogramDeclared === false");
    expect(sourceFactsRenderer).toContain('compatibility.attributeHistograms === "omitted_and_accepted"');
    expect(sourceFactsRenderer).toContain('compatibility.attributeHistograms === "partially_declared"');
    expect(sourceFactsRenderer).toContain("Metadata omits optional attribute histograms");
    expect(sourceFactsRenderer).toContain("official loader can calculate histograms after loading");
    expect(sourceFactsRenderer).toContain('["Proxy declarations", sourceFactLabel(bundle.facts.compatibility.proxyReplacementDeclarations)]');
    expect(sourceFactsRenderer).toContain("for (const note of notes)");
    expect(sourceFactsRenderer).toContain("Frozen scope boundary: ");
    expect(sourceFactsRenderer).toContain("function appendPotreeUnknowns(parent, bundle)");
    expect(sourceFactsRenderer).toContain("for (const unknown of unknowns)");
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
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Source Readiness Map V7");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "What this source set covers—and what is still missing",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Pre-admission map · authority none");
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "V7 preserves the complete V6 receipt-stage map and adds path-specific Potree bundle refinements below it.",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "A refinement changes only this evidence view; it does not remove the inherited record, approve files, establish processing readiness, compile a route or recipe, select a worker or provider, establish rights, accuracy, or registration, or say anything can run.",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).not.toContain("Source Readiness Map V7 Ready");
    expect(LOCAL_FOUNDRY_APP_HTML).not.toContain("Supported");
    expect(LOCAL_FOUNDRY_APP_HTML).not.toContain("Processable");
  });

  it("renders every source-family lane, represented path, grouped gap, and decisive next test with text nodes", () => {
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function sourceReadinessStatusLabel"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function updateSaveStep"),
    );

    expect(renderer).toContain("function renderSourceReadiness(value)");
    expect(renderer).toContain('all_observed_facts_established: "All observed Source Facts V6 established"');
    expect(renderer).toContain('facts_established: "Source Facts V6 established"');
    expect(renderer).toContain('outside_source_facts_v6: "Outside Source Facts V6"');
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
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function renderInheritedSourceReadiness(value)"),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function updateSaveStep"),
    );
    const blockedBranch = renderer.slice(
      renderer.indexOf('if (value.state === "blocked")'),
      renderer.indexOf("for (const lane of value.lanes || [])"),
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
      '"foundry-source-readiness-map-v7.json"',
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
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Operator Evidence Checklist V7");
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
    expect(renderer).toContain('["Inherited V6 requests", summary.inheritedEvidenceRequestCount]');
    expect(renderer).toContain('["Potree requests", summary.potreeEvidenceRequestCount]');
    expect(renderer).toContain("exact-content duplicate · group SHA-256 ");
    expect(renderer).toContain("unique within this receipt");
    expect(renderer).toContain(
      "No existing source path — this conditional request concerns a missing source family. Its necessity is not evaluated.",
    );
    expect(renderer).toContain('element("details", "evidence-source-details")');
    expect(renderer).toContain("function renderPotreeEvidenceRequest(request)");
    expect(renderer).toContain("request.sourceFactsBundle.inspection");
    expect(renderer).toContain("function renderPotreeOperatorEvidence(requests, supersededRefs)");
    expect(renderer).not.toContain(".slice(");
    expect(renderer).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/u);
  });

  it("keeps XBIN checklist output to one polite export blocker while retaining the digest footer", () => {
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function renderInheritedOperatorEvidenceChecklist(value)",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf("function updateSaveStep"),
    );
    const blockedBranch = renderer.slice(
      renderer.indexOf('if (value.state === "blocked")'),
      renderer.indexOf("const itemsById = new Map"),
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
      ".source-fact-card-head, .source-facts-footer, .source-readiness-footer, .operator-evidence-footer, .potree-v7-heading, .potree-bundle-card-head, .potree-refinement-card-head, .v7-inherited-heading { align-items: flex-start; flex-direction: column; }",
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
      '"foundry-operator-evidence-checklist-v7.json"',
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
      /stopResult\.verificationStopped !== true \|\|\s+stopResult\.preparedHdDatasetStopped !== true \|\|\s+stopResult\.photoCaptureQualityStopped !== true \|\|\s+stopResult\.capturedQualityComparisonStopped !== true \|\|\s+stopResult\.offlinePreviewStopped !== true[\s\S]*?reviewDirty = false;\s+planDirty = false;\s+admissionArtifact = null;\s+planArtifact = null;/u,
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

  it("never downloads the complete file from stale or unbuilt screen choices", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="download-handoff-button"');
    expect(LOCAL_FOUNDRY_APP_HTML).toContain("Download one complete file");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "let completeHandoffRevisionSha256 = null;",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "let completeHandoffMaximumSerializedBytes = 32 * 1024 * 1024;",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /function syncCompleteHandoffAvailability\(state = null\)[\s\S]*?if \(reviewDirty\)[\s\S]*?downloadHandoffButton\.disabled = true;[\s\S]*?if \(planDirty\)[\s\S]*?downloadHandoffButton\.disabled = true;/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /completeHandoffStatus === "ready" && completeHandoffRevisionSha256 !== null[\s\S]*?downloadHandoffButton\.disabled = false;/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toMatch(
      /function renderReceipt\(value, facts\)[\s\S]*?downloadHandoffButton\.disabled = false;[\s\S]*?function syncServerAdmissionBinding/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /downloadHandoffButton\.addEventListener\("click"[\s\S]*?const requestedRevisionSha256 = completeHandoffRevisionSha256;[\s\S]*?completeHandoffRevisionSha256 === requestedRevisionSha256/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "Your choices changed while the complete file was being prepared. Nothing was saved.",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "Download requested. The source was rechecked first",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "Check your Downloads folder before closing this session.",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "The complete file must stay under \" + formatBytes(completeHandoffMaximumSerializedBytes)",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).not.toContain(
      'handoffDownloadHelp.textContent = "Saved.',
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

describe("captured-quality comparison browser surface", () => {
  it("uses stable unique IDs between guided review and the optional GLB preview", () => {
    const capturedIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="captured-quality-comparison"',
    );
    const planIndex = LOCAL_FOUNDRY_APP_HTML.indexOf('id="plan-workbench"');
    const offlinePreviewIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="offline-normalization-preview"',
    );
    const stepStart = LOCAL_FOUNDRY_APP_HTML.indexOf('<ol class="steps"');
    const stepEnd = LOCAL_FOUNDRY_APP_HTML.indexOf("</ol>", stepStart);

    expect(capturedIndex).toBeGreaterThan(planIndex);
    expect(offlinePreviewIndex).toBeGreaterThan(capturedIndex);
    expect(LOCAL_FOUNDRY_APP_HTML.slice(stepStart, stepEnd)).not.toContain(
      "captured-quality",
    );
    for (const id of [
      "captured-quality-comparison",
      "captured-quality-heading",
      "captured-quality-status",
      "captured-quality-status-heading",
      "captured-quality-status-copy",
      "captured-quality-meter-bar",
      "captured-quality-result-facts",
      "captured-quality-view-count",
      "captured-quality-capture-count",
      "captured-quality-source-integrity",
      "captured-quality-winner",
      "captured-quality-report-sha",
      "captured-quality-error",
      "start-captured-quality-button",
      "cancel-captured-quality-button",
      "download-captured-quality-report-button",
    ]) {
      expect(LOCAL_FOUNDRY_APP_HTML.split(`id="${id}"`).length - 1).toBe(1);
    }
  });

  it("states the exact local evidence boundary without choosing a winner", () => {
    const panelStart = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="captured-quality-comparison"',
    );
    const panelEnd = LOCAL_FOUNDRY_APP_HTML.indexOf("</section>", panelStart);
    const panel = LOCAL_FOUNDRY_APP_HTML.slice(panelStart, panelEnd);

    expect(panel).toContain("Local regression check · authority none");
    expect(panel).toContain("real Living Hall renderer on this computer");
    expect(panel).toContain("four frozen SOG files and four frozen SPZ files");
    expect(panel).toContain("same six camera views twice");
    expect(panel).toContain("8 exact local files");
    expect(panel).toContain("6 × 2 candidates × 2 repeats");
    expect(panel).toContain("Declared external requests</dt><dd>0");
    expect(panel).toContain("Winner</dt><dd>Not selected");
    expect(panel).toContain("does not choose which room is physically truer");
    expect(panel).toContain("regression-triage evidence only");
    expect(panel).toContain("does not establish metric accuracy, usage rights, release permission, or product acceptance");
  });

  it("parses only the exact DTO, fixed authority, and six-view twenty-four-capture report", () => {
    const executableParser = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function hasExactObjectKeys(value, expectedKeys)",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function clearCapturedQualityPoll()",
      ),
    );
    const harness: {
      parseCapturedQualityForTest?: (value: unknown) => unknown;
    } = {};
    new Script(
      `${executableParser}\nglobalThis.parseCapturedQualityForTest = parseCapturedQualityComparison;`,
      { filename: "local-foundry-captured-quality-parser.js" },
    ).runInNewContext(harness);
    const parseCapturedQuality = harness.parseCapturedQualityForTest;
    if (parseCapturedQuality === undefined) {
      throw new Error("captured-quality parser test harness was not installed");
    }

    const ready = {
      state: "ready",
      requestId: null,
      authority: "none",
      winner: "not_selected",
      message: "Ready for the exact local comparison.",
      failureCode: null,
      progress: { phase: "ready", completed: 0, total: 0 },
      report: null,
    };
    const report = {
      schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0",
      reportSha256: "a".repeat(64),
      generatedAt: "2026-07-18T16:00:00.000Z",
      sourceReceiptSha256: null,
      rendererProfileId: "reception-fixed-v1",
      viewCount: 6,
      captureCount: 24,
      pairMetricCount: 6,
    };
    const completed = {
      ...ready,
      state: "completed",
      requestId: "1".repeat(32),
      message: "The exact local comparison completed.",
      progress: { phase: "completed", completed: 24, total: 24 },
      report,
    };

    expect(parseCapturedQuality(ready)).toBe(ready);
    expect(parseCapturedQuality(completed)).toBe(completed);
    expect(() => parseCapturedQuality({ ...ready, extra: true }))
      .toThrow("captured-quality field this page does not accept");
    expect(() => parseCapturedQuality({ ...ready, winner: "quality_selected" }))
      .toThrow("unknown captured-quality boundary");
    for (const [field, value] of [
      ["viewCount", 5],
      ["captureCount", 23],
      ["pairMetricCount", 5],
    ] as const) {
      expect(() => parseCapturedQuality({
        ...completed,
        report: { ...report, [field]: value },
      })).toThrow("invalid captured-quality report summary");
    }
  });

  it("uses fixed routes, exact request bodies, stale guards, polling, and a digest-bound report", () => {
    const interactions = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("start-captured-quality-button").addEventListener',
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("start-offline-preview-button").addEventListener',
      ),
    );
    const downloader = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "async function downloadCapturedQualityReport(button)",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function offlinePreviewNeedsAttention()",
      ),
    );

    expect(interactions).toContain(
      'postJson("/api/captured-quality-comparison/start", { requestId })',
    );
    expect(interactions).toContain(
      'postJson("/api/captured-quality-comparison/cancel", { requestId: expectedRequestId })',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'postJson("/api/captured-quality-comparison/status", { requestId: expectedRequestId })',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'postJson("/api/captured-quality-comparison/status", { requestId })',
    );
    expect(interactions).toContain(
      "pendingCapturedQualityRequestId !== requestId",
    );
    expect(interactions).toContain(
      "capturedQualityArtifact.requestId !== expectedRequestId",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "capturedQualityPollTimer = null;\n      void pollCapturedQualityComparison();",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "scheduleCapturedQualityPoll();",
    );
    expect(downloader).toContain(
      '"/api/captured-quality-comparison/report"',
    );
    expect(downloader).toContain(
      '"&requestId=" + encodeURIComponent(expectedRequestId)',
    );
    expect(downloader).toContain(
      '"&digest=" + encodeURIComponent(expectedDigest)',
    );
    expect(downloader).toContain(
      "capturedQualityArtifact.report.reportSha256 !== expectedDigest",
    );
    expect(downloader).toContain(
      'link.download = "foundry-captured-quality-comparison-report-v0.json"',
    );
    expect(interactions).not.toMatch(
      /repoRoot|qualityRoot|mobileRoot|outputRoot|sourcePath|command|environment/u,
    );
  });

  it("keeps cancellation and terminal state monotonic for the same request", () => {
    const renderer = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function renderCapturedQualityComparison",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "async function pollCapturedQualityComparison",
      ),
    );
    const cancelInteraction = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("cancel-captured-quality-button").addEventListener',
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("download-captured-quality-report-button").addEventListener',
      ),
    );
    const clearClientState = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function clearCapturedQualityClientState()",
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        "function offlinePreviewNeedsAttention()",
      ),
    );

    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "let pendingCapturedQualityCancellationId = null;",
    );
    expect(renderer).toContain(
      'const currentIsTerminal = ["completed", "failed"].includes(capturedQualityArtifact.state);',
    );
    expect(renderer).toContain(
      "if (currentIsTerminal && parsed.state !== capturedQualityArtifact.state) return false;",
    );
    expect(renderer).toContain(
      "pendingCapturedQualityCancellationId === parsed.requestId &&\n        parsed.state === \"running\"",
    );
    expect(renderer.indexOf("const currentIsTerminal")).toBeLessThan(
      renderer.indexOf("capturedQualityArtifact = parsed;"),
    );
    expect(renderer.indexOf("pendingCapturedQualityCancellationId === parsed.requestId")).toBeLessThan(
      renderer.indexOf("capturedQualityArtifact = parsed;"),
    );
    expect(renderer).toContain(
      "pendingCapturedQualityCancellationId === parsed.requestId &&\n      [\"completed\", \"failed\"].includes(parsed.state)",
    );

    const markCancellation = cancelInteraction.indexOf(
      "pendingCapturedQualityCancellationId = expectedRequestId;",
    );
    const stopPolling = cancelInteraction.indexOf("clearCapturedQualityPoll();");
    const sendCancellation = cancelInteraction.indexOf(
      'postJson("/api/captured-quality-comparison/cancel", { requestId: expectedRequestId })',
    );
    expect(markCancellation).toBeGreaterThan(-1);
    expect(stopPolling).toBeGreaterThan(markCancellation);
    expect(sendCancellation).toBeGreaterThan(stopPolling);
    expect(cancelInteraction).toContain(
      "await recoverCapturedQualityAfterLostResponse(expectedRequestId)",
    );
    expect(cancelInteraction).toMatch(
      /if \(!recovered\)[\s\S]*?pendingCapturedQualityCancellationId = null;[\s\S]*?scheduleCapturedQualityPoll\(\);/u,
    );
    expect(clearClientState).toContain(
      "pendingCapturedQualityCancellationId = null;",
    );
  });

  it("keeps running or undownloaded work visible to stop, tab-close, and mobile flows", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="captured-quality-status" class="captured-quality-status" data-state="ready" role="status" aria-live="polite" aria-atomic="true"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="captured-quality-error" class="error-panel" role="alert" tabindex="-1" hidden',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "function capturedQualityNeedsAttention()",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'return capturedQualityArtifact.state === "completed" && !downloadedCapturedQualityReport;',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /stopButton\.addEventListener\("click"[\s\S]*?capturedComparisonNeedsAttention \|\| privatePreviewNeedsAttention/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "stopResult.capturedQualityComparisonStopped !== true",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /window\.addEventListener\("beforeunload"[\s\S]*?!capturedComparisonNeedsAttention && !privatePreviewNeedsAttention/u,
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".captured-quality-boundaries, .captured-quality-result-facts, .offline-preview-boundaries, .offline-preview-result-facts { grid-template-columns: 1fr; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".captured-quality-head, .offline-preview-head { align-items: flex-start; flex-direction: column; }",
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
    const capturedQualityIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="captured-quality-comparison"',
    );
    const previewTagIndex = LOCAL_FOUNDRY_APP_HTML.lastIndexOf(
      "<section",
      previewIndex,
    );
    const stepStart = LOCAL_FOUNDRY_APP_HTML.indexOf('<ol class="steps"');
    const stepEnd = LOCAL_FOUNDRY_APP_HTML.indexOf("</ol>", stepStart);
    const immediatelyBeforePreview = LOCAL_FOUNDRY_APP_HTML.slice(
      capturedQualityIndex,
      previewTagIndex,
    );

    expect(guidedIndex).toBeGreaterThan(-1);
    expect(planIndex).toBeGreaterThan(guidedIndex);
    expect(capturedQualityIndex).toBeGreaterThan(planIndex);
    expect(previewIndex).toBeGreaterThan(capturedQualityIndex);
    expect(immediatelyBeforePreview).toMatch(/<\/section>\s*$/u);
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
      /stopButton\.addEventListener\("click"[\s\S]*?verificationStillRunning \|\| preparedDatasetNeedsAttention \|\| photoQualityNeedsReview \|\| capturedComparisonNeedsAttention \|\| privatePreviewNeedsAttention/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /window\.addEventListener\("beforeunload"[\s\S]*?!verificationStillRunning && !preparedDatasetNeedsAttention && !photoQualityNeedsReview && !capturedComparisonNeedsAttention && !privatePreviewNeedsAttention/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "schedulePhotoQualityPoll();",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "the app will clear that buffer on a best-effort basis when time ends.",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".prepared-hd-boundaries, .prepared-hd-result-facts, .captured-quality-boundaries, .captured-quality-result-facts, .offline-preview-boundaries, .offline-preview-result-facts { grid-template-columns: 1fr; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".prepared-hd-head, .captured-quality-head, .offline-preview-head { align-items: flex-start; flex-direction: column; }",
    );
  });
});

describe("prepared HD dataset browser surface", () => {
  const receiptSha256 = "1".repeat(64);
  const readinessReceiptSha256 = "2".repeat(64);
  const requestId = "0123456789abcdef0123456789abcdef";
  const ready = {
    schemaVersion: "omnitwin.foundry.local-prepared-hd-dataset-gate.v0",
    state: "ready",
    authority: "none",
    operation: "prepared_dataset_validation_only",
    receiptSha256,
    requestId: null,
    message: "The exact package layout is ready for validation.",
    failureCode: null,
    report: null,
  } as const;
  const completed = {
    ...ready,
    state: "completed",
    requestId,
    message: "Prepared package validated; execution remains disabled.",
    report: {
      schemaVersion: "omnitwin.foundry.prepared-hd-dataset-readiness.v0",
      readinessReceiptSha256,
      sourceReceiptSha256: receiptSha256,
      cameraCount: 2,
      imageCount: 3,
      runtimeImageCount: 3,
      trainImageCount: 2,
      heldoutImageCount: 1,
      pointCount: 2,
      depthPriorCount: 2,
    },
  } as const;

  function parser(): (value: unknown) => unknown {
    const source = LOCAL_FOUNDRY_APP_JAVASCRIPT;
    const helpers = source.slice(
      source.indexOf("function hasExactObjectKeys(value, expectedKeys)"),
      source.indexOf("function clearPreparedHdPoll()"),
    );
    const harness: {
      parsePreparedHdDatasetForTest?: (value: unknown) => unknown;
    } = {};
    new Script(
      `${helpers}\nglobalThis.parsePreparedHdDatasetForTest = parsePreparedHdDataset;`,
      { filename: "local-foundry-prepared-hd-parser.js" },
    ).runInNewContext(harness);
    if (harness.parsePreparedHdDatasetForTest === undefined) {
      throw new Error("prepared HD parser test harness was not installed");
    }
    return harness.parsePreparedHdDatasetForTest;
  }

  it("presents an honest local input gate with no execution claim", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain('id="prepared-hd-dataset"');
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Validate reconstruction inputs before any HD work",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Prepared package validated; photo registration, reconstruction, training, and enhancement were not performed.",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "Depth required · factor 2 · test every 8",
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="prepared-hd-status" class="prepared-hd-status" data-state="unavailable" role="status" aria-live="polite" aria-atomic="true"',
    );
  });

  it("accepts only exact authority-none DTOs with coherent prepared evidence counts", () => {
    const parse = parser();
    expect(() => parse(ready)).not.toThrow();
    expect(() => parse(completed)).not.toThrow();
    expect(() => parse({ ...ready, training: true })).toThrow(
      "field this page does not accept",
    );
    expect(() => parse({ ...ready, authority: "operator" })).toThrow(
      "unsafe prepared-dataset boundary",
    );
    expect(() => parse({
      ...completed,
      report: { ...completed.report, heldoutImageCount: 2 },
    })).toThrow("inconsistent prepared-dataset evidence counts");
    expect(() => parse({
      ...completed,
      report: { ...completed.report, sourceReceiptSha256: "3".repeat(64) },
    })).toThrow("internally inconsistent prepared-dataset state");
  });

  it("uses fixed local routes and sends no browser-selected paths or options", () => {
    const interactions = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("start-prepared-hd-button").addEventListener',
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("start-photo-quality-button").addEventListener',
      ),
    );
    expect(interactions).toContain(
      'postJson("/api/prepared-hd-dataset/start", {',
    );
    expect(interactions).toContain(
      "receiptSha256: preparedHdArtifact.receiptSha256",
    );
    expect(interactions).toContain(
      'postJson("/api/prepared-hd-dataset/cancel", {',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'postJson("/api/prepared-hd-dataset/status", { requestId: expectedRequestId })',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'const requestUrl = "/api/prepared-hd-dataset/report" +',
    );
    expect(interactions).not.toMatch(
      /sourceRoot|repoRoot|packageRoot|pythonExecutable|dataFactor|testEvery|depthRequired/u,
    );
  });
});

describe("photo capture quality browser surface", () => {
  it("keeps assignments attributable, revisions monotonic, and result gaps actionable", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="photo-quality-meter" class="photo-quality-meter" role="progressbar"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="photo-quality-live" class="sr-only" role="status"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '["path", "mediaType", "sizeBytes", "suggestedRole", "assignedRole", "protocolSlot"]',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'element("span", "sr-only", " for " + candidate.path)',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '(candidate.assignedRole || candidate.suggestedRole) === optionSpec[0]',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'parsed.runRevision < photoQualityArtifact.runRevision',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'photoQualityArtifact.state !== "cancelled"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '["Assigned photos outside the naming protocol", report.unmatchedAssignedPaths]',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'leftPath + " ↔ " + rightPath',
    );
  });
});

describe("durable local intake workspace browser surface", () => {
  const receiptSha256 = "1".repeat(64);
  const workspaceSha256 = "2".repeat(64);
  const requestId = "0123456789abcdef0123456789abcdef";
  const workspace = {
    workspaceSha256,
    fileCount: 4,
    totalBytes: 20,
    truth: {
      pendingReview: 1,
      admitted: 2,
      excluded: 1,
      captured: 1,
      enhancedCaptured: 1,
      generatedCinematic: 0,
      conceptImagination: 0,
    },
  } as const;
  const ready = {
    schemaVersion: "omnitwin.foundry.local-intake-workspace-controller.v0",
    state: "ready",
    authority: "none",
    operation: null,
    configured: true,
    receiptSha256,
    requestId: null,
    message: "Ready to keep the checked source in the configured local workspace.",
    failureCode: null,
    progress: null,
    workspace: null,
  } as const;
  const copying = {
    ...ready,
    state: "copying",
    operation: "copy_into_local_workspace",
    requestId,
    message: "Copying the checked source.",
    progress: {
      copiedFileCount: 2,
      fileCount: 4,
      copiedBytes: 10,
      totalBytes: 20,
    },
  } as const;
  const stored = {
    ...copying,
    state: "stored",
    message: "Verified local copy stored.",
    progress: {
      copiedFileCount: 4,
      fileCount: 4,
      copiedBytes: 20,
      totalBytes: 20,
    },
    workspace,
  } as const;

  function parser(): (value: unknown) => unknown {
    const source = LOCAL_FOUNDRY_APP_JAVASCRIPT;
    const helpers = source.slice(
      source.indexOf("function hasExactObjectKeys(value, expectedKeys)"),
      source.indexOf("function parsePreparedHdDataset(value)"),
    );
    const harness: {
      parseLocalIntakeWorkspaceForTest?: (value: unknown) => unknown;
    } = {};
    new Script(
      `${helpers}\nglobalThis.parseLocalIntakeWorkspaceForTest = parseLocalIntakeWorkspace;`,
      { filename: "local-foundry-intake-workspace-parser.js" },
    ).runInNewContext(harness);
    if (harness.parseLocalIntakeWorkspaceForTest === undefined) {
      throw new Error("local intake workspace parser test harness was not installed");
    }
    return harness.parseLocalIntakeWorkspaceForTest;
  }

  it("offers one plain-language, receipt-ready local-copy panel with honest boundaries", () => {
    const panelIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="local-intake-workspace"',
    );
    const metricsIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'class="metrics"',
    );
    const formatsIndex = LOCAL_FOUNDRY_APP_HTML.indexOf(
      'id="formats-heading"',
    );
    const panel = LOCAL_FOUNDRY_APP_HTML.slice(panelIndex, formatsIndex);

    expect(panelIndex).toBeGreaterThan(metricsIndex);
    expect(formatsIndex).toBeGreaterThan(panelIndex);
    expect(panel).toContain("Keep a verified copy on this computer");
    expect(panel).toContain("The original source stays unchanged.");
    expect(panel).toContain("Nothing is uploaded or processed");
    expect(panel).toContain(
      "no reconstruction, training, enhancement, or publishing runs",
    );
    expect(panel).toContain("truth labels stay separate");
    expect(panel).toContain("close this workspace and reopen its verified record later");
    expect(panel).toContain(
      "select a new local workspace folder when starting Foundry",
    );
    expect(panel).toContain("Local copy · authority none");
    expect(panel).toContain("External requests</dt><dd>0 · nothing is uploaded");
    for (const label of [
      "Pending review",
      "Admitted",
      "Excluded",
      "Captured",
      "Enhanced-captured",
      "Generated cinematic",
      "Concept / imagination",
    ]) {
      expect(panel).toContain(label);
    }
  });

  it("accepts only the exact path-free DTO and coherent state/count combinations", () => {
    const parse = parser();
    const unavailable = {
      ...ready,
      state: "unavailable",
      configured: false,
      receiptSha256: null,
      message: "No local workspace was configured for this session.",
    };
    const verifying = {
      ...copying,
      state: "verifying",
      message: "Checking the copied files.",
    };
    const failed = {
      ...copying,
      state: "failed",
      message: "The copy did not finish.",
      failureCode: "LOCAL_INTAKE_WORKSPACE_COPY_FAILED",
    };
    const inspectionFailed = {
      ...unavailable,
      state: "failed",
      configured: true,
      message: "The configured local workspace could not be inspected.",
      failureCode: "LOCAL_INTAKE_WORKSPACE_INSPECTION_FAILED",
    };
    const deleting = {
      ...stored,
      state: "deleting",
      operation: "delete_local_workspace_copy",
      requestId: "abcdef0123456789abcdef0123456789",
      message: "Deleting the verified local copy.",
      progress: null,
    };
    const deleted = {
      ...deleting,
      state: "deleted",
      message: "The local copy was deleted.",
      workspace: null,
    };

    for (const value of [
      unavailable,
      ready,
      copying,
      verifying,
      stored,
      failed,
      inspectionFailed,
      deleting,
      deleted,
    ]) {
      expect(() => parse(value)).not.toThrow();
    }
    expect(() => parse({ ...ready, sourcePath: "C:/private" })).toThrow(
      "field this page does not accept",
    );
    expect(() => parse({ ...ready, authority: "operator" })).toThrow(
      "unsafe local-workspace boundary",
    );
    expect(() => parse({
      ...stored,
      workspace: {
        ...workspace,
        truth: { ...workspace.truth, pendingReview: 2 },
      },
    })).toThrow("inconsistent local-workspace truth counts");
    expect(() => parse({
      ...stored,
      workspace: { ...workspace, workspaceSha256: `sha256:${workspaceSha256}` },
    })).toThrow("invalid local-workspace identity");
    expect(() => parse({
      ...failed,
      failureCode: "COPY_FAILED",
    })).toThrow("invalid local-workspace failure code");
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'hasExactObjectKeys(value.progress, [\n        "copiedFileCount",\n        "fileCount",\n        "copiedBytes",\n        "totalBytes"',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'hasExactObjectKeys(value.workspace.truth, [',
    );
  });

  it("uses only the five fixed routes and exact opaque browser bodies", () => {
    const interactions = LOCAL_FOUNDRY_APP_JAVASCRIPT.slice(
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("start-local-intake-workspace-button").addEventListener',
      ),
      LOCAL_FOUNDRY_APP_JAVASCRIPT.indexOf(
        'byId("start-prepared-hd-button").addEventListener',
      ),
    );
    expect(interactions).toContain(
      'postJson("/api/local-intake-workspace/start", {',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'postJson("/api/local-intake-workspace/status", { requestId: expectedRequestId })',
    );
    expect(interactions).toContain(
      'postJson("/api/local-intake-workspace/cancel", {',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'apiUrl("/api/local-intake-workspace/report")',
    );
    expect(interactions).toContain(
      'postJson("/api/local-intake-workspace/delete-and-stop", {',
    );
    expect(interactions).toContain('confirmation: "copy_into_local_workspace"');
    expect(interactions).toContain('confirmation: "delete_local_workspace_copy"');
    expect(interactions).toContain("const requestId = newVerificationRequestId();");
    expect(interactions).toContain("receiptSha256,");
    expect(interactions).toContain("workspaceSha256: workspaceDigest,");
    expect(interactions).not.toMatch(
      /sourcePath|workspacePath|sourceRoot|workspaceRoot|relativePath|directory|credential|environment/u,
    );
  });

  it("renders monotonic copy, verification, storage, deletion, and report lifecycles", () => {
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'state.localIntakeWorkspace !== undefined',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "expectedLocalIntakeWorkspaceRequestId",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'const currentIsTerminal = ["stored", "failed", "deleted"].includes(localIntakeWorkspaceArtifact.state);',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'if (currentIsTerminal && parsed.state !== localIntakeWorkspaceArtifact.state) return false;',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      '["copying", "verifying", "deleting"].includes(value.state)',
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "localIntakeWorkspaceArtifact.workspace.workspaceSha256 !== expectedWorkspaceDigest",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      'link.download = "foundry-local-intake-workspace-record-v0.json"',
    );
    for (const heading of [
      "Ready to keep a verified local copy",
      "Copying the checked source",
      "Verifying every copied file",
      "Verified local copy stored",
      "Deleting the local copy and stopping",
      "Local workspace copy deleted",
    ]) {
      expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(heading);
    }
  });

  it("requires explicit deletion confirmation and protects running work on stop", () => {
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="confirm-delete-local-intake-workspace" type="checkbox"',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      'id="delete-local-intake-workspace-button" class="button button-danger" type="button" disabled',
    );
    expect(LOCAL_FOUNDRY_APP_HTML).toContain(
      "This deletes the workspace copy and its saved record, then stops this local session. The original source stays unchanged.",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "!canDelete || !confirmDeleteLocalIntakeWorkspace.checked",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "function localIntakeWorkspaceNeedsAttention()",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /stopButton\.addEventListener\("click"[\s\S]*?privatePreviewNeedsAttention \|\| localWorkspaceNeedsAttention/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "stopResult.localIntakeWorkspaceStopped !== true",
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toMatch(
      /window\.addEventListener\("beforeunload"[\s\S]*?!privatePreviewNeedsAttention && !localWorkspaceNeedsAttention/u,
    );
    expect(LOCAL_FOUNDRY_APP_JAVASCRIPT).toContain(
      "window.sessionStorage.removeItem(sessionKey);",
    );
  });

  it("stacks every panel group and action cleanly on a narrow screen", () => {
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".local-intake-workspace-boundaries, .local-intake-workspace-truth { grid-template-columns: repeat(2, minmax(0, 1fr)); }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".local-intake-workspace-boundaries, .local-intake-workspace-progress-facts, .local-intake-workspace-result-facts, .local-intake-workspace-truth { grid-template-columns: 1fr; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".local-intake-workspace-head, .local-intake-workspace-actions { align-items: flex-start; flex-direction: column; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain(
      ".local-intake-workspace-actions, .local-intake-workspace-delete .button { width: 100%; }",
    );
    expect(LOCAL_FOUNDRY_APP_CSS).toContain("overflow-wrap: anywhere");
  });
});
