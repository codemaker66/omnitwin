import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  LOCAL_NATIVE_INTAKE_APP_CSS,
  LOCAL_NATIVE_INTAKE_APP_HTML,
  LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT,
} from "../local-native-intake-assets.js";

describe("local native intake browser assets", () => {
  it("ships syntactically valid standalone JavaScript and unique static IDs", () => {
    expect(() => new Script(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT, {
      filename: "local-native-intake-app.js",
    })).not.toThrow();
    const ids = [...LOCAL_NATIVE_INTAKE_APP_HTML.matchAll(/\sid="([^"]+)"/gu)]
      .map((match) => match[1]);
    expect(ids).not.toContain(undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("states the exact native-drop boundary without claiming browser drag-and-drop or processing", () => {
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Build a local capture workspace");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Windows picker or drop panel preview");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Local path reopen");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Your originals stay where they are.");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain(
      "Nothing is uploaded. Nothing is reconstructed, enhanced, or used for training.",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain(
      "This browser page does not receive dropped files or paths.",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain(
      "Open drop area",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain(
      "Drag files and folders from Explorer into the separate Windows panel.",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Choose files");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Choose folder");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain(
      "To change this preview list, stop the session and choose again.",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).not.toContain('id="clear-list"');
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toContain('runAction("remove"');
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toContain('runAction("clear"');
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toContain("remove-source");
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain('runAction("add_dropped")');
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain(
      "Choose workspace and keep verified copies",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toMatch(
      /addEventListener\(\s*["'](?:drop|dragenter|dragover|dragleave)["']/u,
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toMatch(/DataTransfer|webkitdirectory/iu);
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).not.toMatch(/<input[^>]+type=["']file["']/iu);
  });

  it("uses only fixed path-free browser routes and the explicit start confirmation", () => {
    for (const route of [
      "/api/native-source-basket",
      "/api/native-source-basket/action",
      "/api/native-source-basket/cancel-active",
      "/api/native-source-basket/report",
      "/api/native-collection-analysis/start",
      "/api/native-collection-analysis/status",
      "/api/native-collection-analysis/cancel",
      "/api/native-collection-analysis/report",
      "/api/stop",
    ]) {
      expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(`"${route}"`);
    }
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'event.confirmation = "inspect_and_keep_verified_copies"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      "sessionRef: binding.sessionRef",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toMatch(
      /sourcePath|workspacePath|canonicalAbsolutePath|resolvedAbsolutePath|filename|helperConfig/iu,
    );
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).not.toMatch(
      /name=["'](?:path|sourcePath|workspacePath|filename|helperConfig|options)["']/iu,
    );
  });

  it("renders neutral rows without HTML injection and models progress, partial failure, and stop", () => {
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'source.kind === "directory" ? "Folder " : "File "',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain("sourceList.replaceChildren()");
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML/iu,
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'const status = typeof view.phase === "string" ? view.phase : "selecting"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'view.canCancelImport === true && status === "importing"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'sources.some((source) => source && source.state === "copying")',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toContain(
      'status === "copying" ? "Keeping verified local copies"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain("openDropArea.disabled = busy || !view.nextEvent");
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'status === "complete" || status === "failed" || status === "cancelled"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain("totals.failedRoots");
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'if (!value.collectionIndexStored)',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain('if (stored < 1)');
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'value.outcome === "cancelled" || phase === "cancelled"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'value.outcome === "complete_with_failures"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'postJson("/api/native-source-basket/report", {})',
    );
    for (const actionStatus of [
      "picker_cancelled",
      "drop_cancelled",
      "selection_rejected",
      "adapter_unavailable",
      "adapter_failed",
      "start_rejected",
      "start_uncertain",
    ]) {
      expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(`status === "${actionStatus}"`);
    }
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      "Nothing was added; start a new local selection session.",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'postJson("/api/stop", {})',
    );
  });

  it("offers a truthful copied-payload inspection step with explicit review and cancellation limits", () => {
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Inspect saved copies");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Operator review remains required.");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain(
      "Stopping takes effect between bounded verification steps; a current verification step may finish first.",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Inspect verified saved copies");
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain("Stop after current verification step");
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'postJson("/api/native-collection-analysis/status", {})',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'postJson("/api/native-collection-analysis/start", {})',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'postJson("/api/native-collection-analysis/cancel", {})',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'postJson("/api/native-collection-analysis/report", {})',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'value.planState !== "needs_operator_review"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      'value.cancellationBoundary !== "between_bounded_verification_steps"',
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain("analysisList.replaceChildren()");
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain("item.nextAction.code");
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).not.toMatch(
      /addEventListener\(\s*["'](?:drop|dragenter|dragover|dragleave)["']/u,
    );
  });

  it("keeps every Step 3 action announcement in the nearby analysis status", () => {
    const startHandler = LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.slice(
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf('  startAnalysis.addEventListener("click"'),
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf('  cancelAnalysis.addEventListener("click"'),
    );
    const cancelHandler = LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.slice(
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf('  cancelAnalysis.addEventListener("click"'),
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf('  viewAnalysisReport.addEventListener("click"'),
    );
    const reportHandler = LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.slice(
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf('  viewAnalysisReport.addEventListener("click"'),
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf('  stopApp.addEventListener("click"'),
    );
    for (const handler of [startHandler, cancelHandler, reportHandler]) {
      expect(handler).toContain("clearStatus();");
      expect(handler).toContain("showAnalysisStatus(");
      expect(handler).not.toMatch(/\bshowStatus\(|\bshowError\(/u);
    }
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      "analysisStatus.textContent = message;",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      "announcement.textContent = message;",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT).toContain(
      "Inspection report opened below. Operator review remains required.",
    );
    expect(LOCAL_NATIVE_INTAKE_APP_CSS).toContain(
      '.analysis-card .action-status[data-tone="failure"]',
    );
    const renderAnalysis = LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.slice(
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf("  const renderAnalysis ="),
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf("  const requireAnalysisReport ="),
    );
    expect(renderAnalysis).toContain(
      "view.reportAvailable === true\n      && currentAnalysisReport !== null\n      && analysisReportOutput.hidden === false",
    );
    expect(renderAnalysis).toContain(
      'if (reportOpen) {\n      analysisStatus.textContent = "Inspection report opened below. Operator review remains required.";',
    );
  });

  it("derives distinct terminal copy from the durable report instead of phase alone", () => {
    const decisionSource = LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.slice(
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf("  const setTerminal ="),
      LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT.indexOf("  const showRawReport ="),
    );
    const elements: Record<string, { textContent: string }> = {
      "terminal-icon": { textContent: "" },
      "terminal-heading": { textContent: "" },
      "terminal-copy": { textContent: "" },
    };
    const harness: {
      readonly terminalPanel: {
        dataset: Record<string, string>;
        hidden: boolean;
      };
      readonly partialFailures: { hidden: boolean };
      readonly elements: typeof elements;
      applyTerminalReportForTest?: (report: unknown, phase: string) => unknown;
    } = {
      terminalPanel: { dataset: {}, hidden: true },
      partialFailures: { hidden: false },
      elements,
    };
    new Script(`
      const terminalPanel = globalThis.terminalPanel;
      const partialFailures = globalThis.partialFailures;
      const byId = (id) => globalThis.elements[id];
      const formatCount = (value) => String(value);
      ${decisionSource}
      globalThis.applyTerminalReportForTest = applyTerminalReport;
    `, { filename: "local-native-intake-terminal-decision.js" }).runInNewContext(harness);
    const apply = harness.applyTerminalReportForTest;
    if (apply === undefined) throw new Error("The terminal decision harness was not installed.");
    const report = (
      outcome: "complete" | "complete_with_failures" | "cancelled",
      collectionIndexStored: boolean,
      storedRoots: number,
      failedRoots: number,
      cancelledRoots = 0,
    ): Record<string, unknown> => ({
      outcome,
      collectionIndexStored,
      totals: {
        selectedRoots: storedRoots + failedRoots + cancelledRoots,
        storedRoots,
        failedRoots,
        cancelledRoots,
        storedFiles: storedRoots,
        storedBytes: storedRoots,
      },
    });

    apply(report("complete", true, 2, 0), "complete");
    expect(elements["terminal-heading"]?.textContent).toBe("Verified local copies are ready");
    expect(harness.terminalPanel.dataset.tone).toBe("success");

    apply(report("complete_with_failures", true, 1, 2), "complete");
    expect(elements["terminal-heading"]?.textContent).toBe(
      "Verified copies are ready; some items need attention",
    );
    expect(harness.terminalPanel.dataset.tone).toBe("warning");

    apply(report("complete_with_failures", true, 0, 2), "failed");
    expect(elements["terminal-heading"]?.textContent).toBe("No verified copies were kept");
    expect(harness.terminalPanel.dataset.tone).toBe("failure");

    apply(report("complete", false, 1, 0), "failed");
    expect(elements["terminal-heading"]?.textContent).toBe(
      "The local collection was not finalised",
    );
    expect(harness.terminalPanel.dataset.tone).toBe("failure");

    apply(report("cancelled", true, 1, 0, 1), "cancelled");
    expect(elements["terminal-heading"]?.textContent).toBe("Local copy work was stopped");
    expect(harness.terminalPanel.dataset.tone).toBe("warning");
  });

  it("keeps keyboard focus and 320px layouts explicit", () => {
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain('aria-live="polite"');
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain('role="alert"');
    expect(LOCAL_NATIVE_INTAKE_APP_HTML).toContain('tabindex="0"');
    expect(LOCAL_NATIVE_INTAKE_APP_CSS).toContain("button:focus-visible");
    expect(LOCAL_NATIVE_INTAKE_APP_CSS).toContain("[hidden] { display: none !important; }");
    expect(LOCAL_NATIVE_INTAKE_APP_CSS).toContain("min-width: 320px");
    expect(LOCAL_NATIVE_INTAKE_APP_CSS).toContain("@media (max-width: 480px)");
    expect(LOCAL_NATIVE_INTAKE_APP_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
