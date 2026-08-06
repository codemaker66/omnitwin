export const LOCAL_NATIVE_INTAKE_APP_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Build a local capture workspace</title>
  <link rel="stylesheet" href="/app.css?token=__SESSION_TOKEN__">
</head>
<body>
  <main id="app-shell" class="shell">
    <header class="hero">
      <div class="eyebrow-row">
        <span class="brand-mark" aria-hidden="true">V</span>
        <span>Venviewer local intake</span>
        <span id="session-badge" class="session-badge">This computer only</span>
      </div>
      <div class="hero-grid">
        <div>
          <p class="kicker">Keep the source. Make a verified working copy.</p>
          <h1>Build a local capture workspace</h1>
          <p class="lede">Choose capture files, choose a folder, or open the Windows drop panel. Venviewer will ask Windows where to keep verified local copies.</p>
        </div>
        <aside class="truth-card" aria-label="What this preview does">
          <div class="truth-badges">
            <span>Windows picker or drop panel preview</span>
            <span>Local path reopen</span>
          </div>
          <p><strong>Your originals stay where they are.</strong></p>
          <p>Nothing is uploaded. Nothing is reconstructed, enhanced, or used for training.</p>
        </aside>
      </div>
    </header>

    <section class="workspace-card" aria-labelledby="source-heading">
      <div class="section-heading">
        <div>
          <p class="step-label">Step 1</p>
          <h2 id="source-heading">Choose what to keep</h2>
          <p>Windows opens outside this page so you can pick or drop large local sources without moving their bytes through the browser.</p>
        </div>
        <div class="button-row primary-actions">
          <button id="choose-files" class="button button-primary" type="button">Choose files</button>
          <button id="choose-folder" class="button button-secondary" type="button">Choose folder</button>
          <button id="open-drop-area" class="button button-secondary" type="button">Open drop area</button>
        </div>
      </div>

      <p class="drop-note"><span aria-hidden="true">↳</span> Drag files and folders from Explorer into the separate Windows panel. This browser page does not receive dropped files or paths.</p>

      <div id="error-banner" class="error-banner" role="alert" hidden></div>
      <div id="action-status" class="action-status" role="status" hidden></div>
      <div id="announcement" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>

      <div id="source-region" class="source-region" aria-live="polite" aria-busy="false">
        <div id="empty-state" class="empty-state">
          <div class="empty-glyph" aria-hidden="true">＋</div>
          <h3>No sources chosen yet</h3>
          <p>Choose files together, add one folder, or open the Windows drop panel.</p>
        </div>
        <ol id="source-list" class="source-list" aria-label="Chosen sources" hidden></ol>
      </div>

      <div class="basket-footer">
        <dl class="totals" aria-label="Selection totals">
          <div><dt>Sources</dt><dd id="total-roots">0</dd></div>
          <div><dt>Files found</dt><dd id="total-files">0</dd></div>
          <div><dt>Size</dt><dd id="total-bytes">0 B</dd></div>
        </dl>
        <p class="preview-limit">To change this preview list, stop the session and choose again.</p>
      </div>
    </section>

    <section class="workspace-card destination-card" aria-labelledby="destination-heading">
      <div class="section-heading compact-heading">
        <div>
          <p class="step-label">Step 2</p>
          <h2 id="destination-heading">Keep verified copies</h2>
          <p>A Windows folder picker will choose the parent location. Venviewer creates a new local workspace inside it and never replaces your originals.</p>
        </div>
      </div>
      <div class="destination-actions">
        <button id="start-import" class="button button-primary button-wide" type="button" disabled>Choose workspace and keep verified copies</button>
        <button id="cancel-active" class="button button-quiet" type="button" hidden>Stop current work</button>
      </div>

      <div id="progress-panel" class="progress-panel" hidden>
        <div class="progress-copy">
          <div>
            <p class="step-label">Local progress</p>
            <h3 id="progress-heading">Preparing the workspace</h3>
          </div>
          <span id="progress-value">Working locally</span>
        </div>
        <div class="progress-track" aria-hidden="true"><span id="progress-bar"></span></div>
        <p id="progress-detail">You can leave this page open while verified copies are made.</p>
      </div>

      <div id="partial-failures" class="partial-failures" role="status" hidden>
        <h3>Some items need attention</h3>
        <p id="partial-failure-copy">Other items continue independently while this batch is still running.</p>
      </div>

      <div id="terminal-panel" class="completion-panel" role="status" hidden>
        <div id="terminal-icon" class="completion-icon" aria-hidden="true">…</div>
        <div>
          <h3 id="terminal-heading">Checking the final local result</h3>
          <p id="terminal-copy">The local report is being checked before this page describes what was kept.</p>
        </div>
        <button id="view-report" class="button button-secondary" type="button">View local report</button>
      </div>
      <pre id="report-output" class="report-output" tabindex="0" hidden></pre>
    </section>

    <section class="workspace-card analysis-card" aria-labelledby="analysis-heading">
      <div class="section-heading compact-heading">
        <div>
          <p class="step-label">Step 3</p>
          <h2 id="analysis-heading">Inspect saved copies</h2>
          <p>After the durable collection is ready, run bounded local format inspection on the verified copies. This does not reconstruct, enhance, upload, admit, or publish anything.</p>
        </div>
      </div>
      <div class="analysis-truth">
        <strong>Operator review remains required.</strong>
        <span>Stopping takes effect between bounded verification steps; a current verification step may finish first.</span>
      </div>
      <div class="destination-actions">
        <button id="start-analysis" class="button button-primary button-wide" type="button" disabled>Inspect verified saved copies</button>
        <button id="cancel-analysis" class="button button-quiet" type="button" hidden>Stop after current verification step</button>
        <button id="view-analysis-report" class="button button-secondary" type="button" hidden>View inspection report</button>
      </div>
      <div id="analysis-status" class="action-status" role="status">Finish keeping verified copies to enable inspection.</div>
      <ol id="analysis-list" class="source-list analysis-list" aria-label="Copied payload inspection results" hidden></ol>
      <pre id="analysis-report-output" class="report-output" tabindex="0" hidden></pre>
    </section>

    <footer class="app-footer">
      <p id="connection-status"><span class="status-dot" aria-hidden="true"></span> Local session connected</p>
      <button id="stop-app" class="text-button danger" type="button">Stop local session</button>
    </footer>
  </main>
  <script src="/app.js?token=__SESSION_TOKEN__" defer></script>
</body>
</html>`;

export const LOCAL_NATIVE_INTAKE_APP_CSS = `
:root {
  color-scheme: dark;
  --ink: #f4f0e8;
  --muted: #aaa79f;
  --quiet: #817f79;
  --canvas: #0c0d0e;
  --panel: rgba(26, 27, 28, 0.88);
  --panel-strong: #202123;
  --line: rgba(244, 240, 232, 0.12);
  --line-strong: rgba(244, 240, 232, 0.22);
  --copper: #d7a76d;
  --copper-bright: #edbd82;
  --green: #8bc9a3;
  --red: #ee9b91;
  --radius: 22px;
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }

[hidden] { display: none !important; }

html { min-width: 320px; background: var(--canvas); }

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  color: var(--ink);
  background:
    radial-gradient(circle at 14% -5%, rgba(215, 167, 109, 0.13), transparent 33rem),
    radial-gradient(circle at 100% 35%, rgba(106, 123, 113, 0.09), transparent 32rem),
    var(--canvas);
}

button { font: inherit; }

button:focus-visible, [tabindex]:focus-visible {
  outline: 3px solid var(--copper-bright);
  outline-offset: 3px;
}

.shell { width: min(1040px, calc(100% - 40px)); margin: 0 auto; padding: 42px 0 30px; }

.hero { padding: 12px 4px 30px; }

.eyebrow-row { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 0.82rem; letter-spacing: 0.055em; text-transform: uppercase; }

.brand-mark { display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid var(--line-strong); border-radius: 50%; color: var(--copper-bright); font-family: Georgia, serif; font-size: 1rem; }

.session-badge { margin-left: auto; padding: 7px 10px; border: 1px solid rgba(139, 201, 163, 0.25); border-radius: 999px; color: var(--green); background: rgba(139, 201, 163, 0.07); font-size: 0.68rem; }

.hero-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr); gap: 38px; align-items: end; margin-top: 56px; }

.kicker, .step-label { margin: 0 0 9px; color: var(--copper); font-size: 0.73rem; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; }

h1 { max-width: 720px; margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2.7rem, 6.5vw, 5.25rem); font-weight: 400; line-height: 0.97; letter-spacing: -0.045em; }

.lede { max-width: 680px; margin: 24px 0 0; color: #c6c2ba; font-size: clamp(1rem, 2vw, 1.16rem); line-height: 1.65; }

.truth-card { padding: 21px; border: 1px solid var(--line); border-radius: 18px; background: rgba(255, 255, 255, 0.025); }

.truth-card p { margin: 12px 0 0; color: var(--muted); font-size: 0.86rem; line-height: 1.55; }
.truth-card strong { color: var(--ink); font-weight: 650; }
.truth-badges { display: flex; flex-wrap: wrap; gap: 7px; }
.truth-badges span { padding: 5px 8px; border: 1px solid var(--line); border-radius: 999px; color: #cfc9bf; font-size: 0.67rem; letter-spacing: 0.035em; }

.workspace-card { margin-top: 18px; padding: clamp(22px, 4vw, 38px); border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(150deg, rgba(34, 35, 36, 0.94), rgba(20, 21, 22, 0.96)); box-shadow: 0 26px 80px rgba(0, 0, 0, 0.24); }

.section-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: end; }
.section-heading h2 { margin: 0; font-family: Georgia, serif; font-size: clamp(1.75rem, 4vw, 2.45rem); font-weight: 400; letter-spacing: -0.025em; }
.section-heading p:not(.step-label) { max-width: 650px; margin: 11px 0 0; color: var(--muted); line-height: 1.55; }
.compact-heading { grid-template-columns: 1fr; }

.button-row, .destination-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.button { min-height: 46px; padding: 0 18px; border: 1px solid transparent; border-radius: 12px; cursor: pointer; font-weight: 650; transition: border-color 150ms ease, background 150ms ease, color 150ms ease, transform 150ms ease; }
.button:hover:not(:disabled) { transform: translateY(-1px); }
.button:disabled { cursor: not-allowed; opacity: 0.4; }
.button-primary { color: #17130e; background: var(--copper-bright); }
.button-primary:hover:not(:disabled) { background: #f6c98e; }
.button-secondary { border-color: var(--line-strong); color: var(--ink); background: rgba(255, 255, 255, 0.045); }
.button-secondary:hover:not(:disabled) { border-color: rgba(237, 189, 130, 0.55); background: rgba(237, 189, 130, 0.08); }
.button-quiet { border-color: var(--line); color: var(--muted); background: transparent; }
.button-wide { min-width: min(100%, 330px); }
.text-button { padding: 7px 3px; border: 0; color: var(--copper-bright); background: transparent; cursor: pointer; text-decoration: underline; text-decoration-color: rgba(237, 189, 130, 0.35); text-underline-offset: 4px; }
.text-button:disabled { cursor: not-allowed; color: var(--quiet); text-decoration: none; }
.text-button.danger { color: var(--red); }

.drop-note { display: flex; gap: 9px; margin: 24px 0 14px; color: var(--quiet); font-size: 0.79rem; }

.error-banner { margin: 15px 0; padding: 13px 15px; border: 1px solid rgba(238, 155, 145, 0.3); border-radius: 12px; color: #ffd0ca; background: rgba(238, 155, 145, 0.08); line-height: 1.45; }
.action-status { margin: 15px 0; padding: 13px 15px; border: 1px solid var(--line); border-radius: 12px; color: #d6d0c6; background: rgba(255, 255, 255, 0.035); line-height: 1.45; }

.source-region { min-height: 166px; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: rgba(8, 9, 10, 0.25); }
.empty-state { display: grid; min-height: 164px; padding: 24px; place-content: center; text-align: center; }
.empty-state h3, .empty-state p { margin: 0; }
.empty-state h3 { font-size: 0.98rem; }
.empty-state p { margin-top: 7px; color: var(--quiet); font-size: 0.82rem; }
.empty-glyph { display: grid; width: 38px; height: 38px; margin: 0 auto 13px; place-items: center; border: 1px solid var(--line); border-radius: 50%; color: var(--copper); font-size: 1.25rem; }

.source-list { margin: 0; padding: 0; list-style: none; }
.source-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.source-row:last-child { border-bottom: 0; }
.source-kind { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 11px; color: var(--copper-bright); background: rgba(215, 167, 109, 0.09); }
.source-copy strong, .source-copy span { display: block; }
.source-copy strong { font-size: 0.93rem; }
.source-copy span { margin-top: 4px; color: var(--quiet); font-size: 0.75rem; }

.basket-footer { display: flex; gap: 24px; align-items: center; justify-content: space-between; margin-top: 17px; }
.preview-limit { max-width: 280px; margin: 0; color: var(--quiet); font-size: 0.72rem; line-height: 1.45; text-align: right; }
.totals { display: flex; flex-wrap: wrap; gap: 25px; margin: 0; }
.totals div { display: grid; gap: 4px; }
.totals dt { color: var(--quiet); font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; }
.totals dd { margin: 0; font-variant-numeric: tabular-nums; font-size: 0.94rem; }

.destination-card { border-color: rgba(215, 167, 109, 0.2); }
.destination-actions { align-items: center; margin-top: 25px; }
.analysis-card { border-color: rgba(139, 201, 163, 0.2); }
.analysis-truth { display: grid; gap: 5px; margin-top: 20px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 13px; color: var(--muted); background: rgba(139, 201, 163, 0.045); font-size: 0.8rem; line-height: 1.45; }
.analysis-truth strong { color: var(--ink); }
.analysis-list { margin-top: 18px; overflow: hidden; border: 1px solid var(--line); border-radius: 15px; }
.analysis-list .source-copy span { line-height: 1.45; }
.analysis-card .action-status[data-tone="success"] { border-color: rgba(139, 201, 163, 0.27); color: #c2d8c8; background: rgba(139, 201, 163, 0.06); }
.analysis-card .action-status[data-tone="warning"] { border-color: rgba(215, 167, 109, 0.3); color: #d3b999; background: rgba(215, 167, 109, 0.07); }
.analysis-card .action-status[data-tone="failure"] { border-color: rgba(238, 155, 145, 0.3); color: #ffd0ca; background: rgba(238, 155, 145, 0.08); }

.progress-panel, .partial-failures, .completion-panel, .report-output { margin-top: 24px; border-radius: 15px; }
.progress-panel { padding: 19px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.18); }
.progress-copy { display: flex; gap: 18px; align-items: end; justify-content: space-between; }
.progress-copy h3, .partial-failures h3, .completion-panel h3 { margin: 0; font-size: 1rem; }
.progress-copy > span { color: var(--muted); font-size: 0.78rem; }
.progress-track { height: 5px; margin-top: 16px; overflow: hidden; border-radius: 99px; background: rgba(255, 255, 255, 0.08); }
.progress-track span { display: block; width: 25%; height: 100%; border-radius: inherit; background: var(--copper-bright); transition: width 220ms ease; }
.progress-panel > p { margin: 11px 0 0; color: var(--quiet); font-size: 0.8rem; }
.partial-failures { padding: 17px; border: 1px solid rgba(238, 155, 145, 0.25); background: rgba(238, 155, 145, 0.06); }
.partial-failures p { margin: 7px 0 0; color: #d8b6b1; font-size: 0.82rem; }
.completion-panel { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 18px; border: 1px solid rgba(139, 201, 163, 0.27); background: rgba(139, 201, 163, 0.06); }
.completion-panel p { margin: 5px 0 0; color: #abc0b2; font-size: 0.8rem; }
.completion-icon { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 50%; color: #0d1811; background: var(--green); font-weight: 800; }
.completion-panel[data-tone="warning"] { border-color: rgba(215, 167, 109, 0.3); background: rgba(215, 167, 109, 0.07); }
.completion-panel[data-tone="warning"] p { color: #d3b999; }
.completion-panel[data-tone="warning"] .completion-icon { background: var(--copper-bright); }
.completion-panel[data-tone="failure"] { border-color: rgba(238, 155, 145, 0.3); background: rgba(238, 155, 145, 0.07); }
.completion-panel[data-tone="failure"] p { color: #d8b6b1; }
.completion-panel[data-tone="failure"] .completion-icon { background: var(--red); }
.report-output { max-height: 280px; overflow: auto; padding: 17px; border: 1px solid var(--line); color: #d2cec5; background: #111213; white-space: pre-wrap; word-break: break-word; font: 0.76rem/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }

.app-footer { display: flex; gap: 18px; align-items: center; justify-content: space-between; padding: 22px 4px 0; color: var(--quiet); font-size: 0.76rem; }
.status-dot { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 4px rgba(139, 201, 163, 0.08); }

.visually-hidden { position: absolute !important; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 760px) {
  .shell { width: min(100% - 24px, 680px); padding-top: 24px; }
  .hero-grid, .section-heading { grid-template-columns: 1fr; }
  .hero-grid { gap: 24px; margin-top: 38px; }
  .primary-actions { width: 100%; }
  .primary-actions .button { flex: 1; }
  .completion-panel { grid-template-columns: auto minmax(0, 1fr); }
  .completion-panel .button { grid-column: 1 / -1; width: 100%; }
}

@media (max-width: 480px) {
  .shell { width: calc(100% - 16px); }
  .hero { padding-inline: 8px; }
  .session-badge { display: none; }
  .workspace-card { padding: 20px 16px; border-radius: 18px; }
  .button-row, .destination-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
  .button, .button-wide { width: 100%; }
  .source-row { padding-inline: 13px; }
  .basket-footer, .app-footer, .progress-copy { align-items: flex-start; flex-direction: column; }
  .preview-limit { max-width: none; text-align: left; }
  .totals { width: 100%; justify-content: space-between; gap: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
`;

export const LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT = `(() => {
  "use strict";

  const byId = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error("The local intake page is incomplete.");
    return element;
  };

  const params = new URLSearchParams(window.location.search);
  const tokenValues = params.getAll("token");
  const token = tokenValues.length === 1 && [...params.keys()].length === 1
    ? tokenValues[0]
    : "";
  const apiUrl = (route) => route + "?token=" + encodeURIComponent(token);
  const chooseFiles = byId("choose-files");
  const chooseFolder = byId("choose-folder");
  const openDropArea = byId("open-drop-area");
  const startImport = byId("start-import");
  const cancelActive = byId("cancel-active");
  const sourceRegion = byId("source-region");
  const sourceList = byId("source-list");
  const emptyState = byId("empty-state");
  const errorBanner = byId("error-banner");
  const actionStatus = byId("action-status");
  const announcement = byId("announcement");
  const progressPanel = byId("progress-panel");
  const terminalPanel = byId("terminal-panel");
  const partialFailures = byId("partial-failures");
  const reportOutput = byId("report-output");
  const startAnalysis = byId("start-analysis");
  const cancelAnalysis = byId("cancel-analysis");
  const viewAnalysisReport = byId("view-analysis-report");
  const analysisStatus = byId("analysis-status");
  const analysisList = byId("analysis-list");
  const analysisReportOutput = byId("analysis-report-output");
  const stopApp = byId("stop-app");
  let currentView = null;
  let currentReport = null;
  let reportRequest = null;
  let reportAutoAttempted = false;
  let currentAnalysisView = null;
  let currentAnalysisReport = null;
  let pollTimer = null;
  let stopped = false;

  const showError = (message) => {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
    announcement.textContent = message;
  };

  const clearError = () => {
    errorBanner.textContent = "";
    errorBanner.hidden = true;
  };

  const showStatus = (message) => {
    actionStatus.textContent = message;
    actionStatus.hidden = false;
    announcement.textContent = message;
  };

  const clearStatus = () => {
    actionStatus.textContent = "";
    actionStatus.hidden = true;
  };

  const showAnalysisStatus = (message, tone = "neutral") => {
    analysisStatus.textContent = message;
    analysisStatus.dataset.tone = tone;
    announcement.textContent = message;
  };

  const safeInteger = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

  const formatCount = (value) => safeInteger(value).toLocaleString();

  const formatBytes = (value) => {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return "0 B";
    const bytes = Number(value);
    if (!Number.isSafeInteger(bytes) || bytes < 1) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let amount = bytes;
    let unit = 0;
    while (amount >= 1000 && unit < units.length - 1) {
      amount /= 1000;
      unit += 1;
    }
    return (unit === 0 ? String(amount) : amount.toFixed(amount >= 10 ? 1 : 2)) + " " + units[unit];
  };

  const publicViewFrom = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The local response was incomplete.");
    const candidate = value.view && typeof value.view === "object" ? value.view : value;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("The local response was incomplete.");
    return candidate;
  };

  const bindingFor = (action) => {
    const binding = currentView && currentView.nextEvent;
    if (!binding || typeof binding !== "object") throw new Error("Wait for the current selection before trying that action.");
    const event = {
      schemaVersion: binding.schemaVersion,
      sessionRef: binding.sessionRef,
      revision: binding.revision,
      eventToken: binding.eventToken,
      action
    };
    if (action === "start") event.confirmation = "inspect_and_keep_verified_copies";
    return event;
  };

  const errorMessage = async (response, fallback) => {
    try {
      const value = await response.json();
      if (value && typeof value.error === "string" && value.error.length <= 240) return value.error;
    } catch (_error) {
      return fallback;
    }
    return fallback;
  };

  const getJson = async (route) => {
    const response = await fetch(apiUrl(route), { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(await errorMessage(response, "The local session did not respond."));
    return response.json();
  };

  const postJson = async (route, body) => {
    const response = await fetch(apiUrl(route), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error(await errorMessage(response, "The local action could not be completed."));
    return response.json();
  };

  const sourceMeta = (source) => {
    const count = safeInteger(source.fileCount);
    const parts = [formatCount(count) + (count === 1 ? " file" : " files")];
    if (typeof source.byteCountDecimal === "string") parts.push(formatBytes(source.byteCountDecimal));
    return parts.join(" · ");
  };

  const renderSources = (sources) => {
    sourceList.replaceChildren();
    const safeSources = Array.isArray(sources) ? sources : [];
    emptyState.hidden = safeSources.length > 0;
    sourceList.hidden = safeSources.length === 0;
    for (const source of safeSources) {
      if (!source || typeof source !== "object") continue;
      const position = safeInteger(source.basketPosition);
      if (position < 1) continue;
      const row = document.createElement("li");
      row.className = "source-row";
      const icon = document.createElement("span");
      icon.className = "source-kind";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = source.kind === "directory" ? "▣" : "◇";
      const copy = document.createElement("span");
      copy.className = "source-copy";
      const label = document.createElement("strong");
      label.textContent = typeof source.label === "string" ? source.label : (source.kind === "directory" ? "Folder " : "File ") + String(position);
      const meta = document.createElement("span");
      meta.textContent = sourceMeta(source);
      copy.append(label, meta);
      row.append(icon, copy);
      sourceList.append(row);
    }
  };

  const analysisFamilyText = (families) => {
    const values = Array.isArray(families) ? families : [];
    const names = values
      .filter((family) => family && typeof family.inputType === "string")
      .map((family) => family.inputType.replaceAll("_", " "));
    return names.length > 0 ? names.join(", ") : "No format family confirmed";
  };

  const renderAnalysisItems = (items) => {
    analysisList.replaceChildren();
    const safeItems = Array.isArray(items) ? items : [];
    analysisList.hidden = safeItems.length === 0;
    for (const item of safeItems) {
      if (!item || typeof item !== "object") continue;
      const position = safeInteger(item.basketPosition);
      if (position < 1) continue;
      const row = document.createElement("li");
      row.className = "source-row";
      const icon = document.createElement("span");
      icon.className = "source-kind";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = item.state === "complete" ? "✓" : item.state === "failed" ? "!" : "◇";
      const copy = document.createElement("span");
      copy.className = "source-copy";
      const label = document.createElement("strong");
      label.textContent = typeof item.label === "string"
        ? item.label
        : (item.kind === "directory" ? "Folder " : "File ") + String(position);
      const meta = document.createElement("span");
      const state = typeof item.state === "string" ? item.state.replaceAll("_", " ") : "queued";
      const nextAction = item.nextAction && typeof item.nextAction.code === "string"
        ? item.nextAction.code.replaceAll("_", " ").toLowerCase()
        : "operator evidence review required";
      meta.textContent = state + " · " + analysisFamilyText(item.families) + " · " + nextAction;
      copy.append(label, meta);
      row.append(icon, copy);
      analysisList.append(row);
    }
  };

  const renderAnalysis = (view) => {
    if (!view || typeof view !== "object" || Array.isArray(view)) throw new Error("The inspection response was incomplete.");
    currentAnalysisView = view;
    const phase = typeof view.phase === "string" ? view.phase : "not_ready";
    const running = phase === "running";
    const reportOpen = view.reportAvailable === true
      && currentAnalysisReport !== null
      && analysisReportOutput.hidden === false;
    analysisStatus.dataset.tone = reportOpen || phase === "complete"
      ? "success"
      : phase === "complete_with_failures" || phase === "cancelled"
        ? "warning"
        : phase === "failed"
          ? "failure"
          : "neutral";
    renderAnalysisItems(view.items);
    startAnalysis.disabled = view.canStart !== true;
    cancelAnalysis.hidden = !running || view.canCancel !== true;
    cancelAnalysis.disabled = !running || view.canCancel !== true;
    viewAnalysisReport.hidden = view.reportAvailable !== true;
    viewAnalysisReport.disabled = view.reportAvailable !== true;
    if (reportOpen) {
      analysisStatus.textContent = "Inspection report opened below. Operator review remains required.";
    } else if (phase === "not_ready") {
      analysisStatus.textContent = "Finish keeping verified copies to enable inspection.";
    } else if (phase === "ready") {
      analysisStatus.textContent = "Verified saved copies are ready for bounded local inspection.";
    } else if (running) {
      analysisStatus.textContent = "Inspecting copied payloads. A stop takes effect after the current bounded verification step.";
    } else if (phase === "complete") {
      analysisStatus.textContent = "Inspection is complete. Every result still needs operator review.";
    } else if (phase === "complete_with_failures") {
      analysisStatus.textContent = "Inspection finished with isolated item failures. Operator review is still required.";
    } else if (phase === "cancelled") {
      analysisStatus.textContent = "Inspection stopped between verification steps; completed results were preserved.";
    } else if (phase === "failed") {
      analysisStatus.textContent = "The durable collection could not be verified for inspection.";
    } else {
      analysisStatus.textContent = "Collection inspection is closed.";
    }
    if (view.reportAvailable !== true) {
      currentAnalysisReport = null;
      analysisReportOutput.hidden = true;
    }
  };

  const requireAnalysisReport = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The inspection report was incomplete.");
    if (value.planState !== "needs_operator_review") throw new Error("The inspection report did not preserve operator review.");
    if (value.cancellationBoundary !== "between_bounded_verification_steps") throw new Error("The inspection report did not state its stop boundary.");
    if (!Array.isArray(value.items)) throw new Error("The inspection report items were incomplete.");
    return value;
  };

  const loadAnalysisView = async () => {
    const value = await postJson("/api/native-collection-analysis/status", {});
    renderAnalysis(value);
    return value;
  };

  const progressPercent = (view) => {
    const sources = view && Array.isArray(view.sources) ? view.sources : [];
    let completed = 0;
    let total = 0;
    for (const source of sources) {
      const progress = source && typeof source === "object" ? source.progress : null;
      if (!progress || typeof progress !== "object") continue;
      completed += safeInteger(progress.copiedBytes);
      total += safeInteger(progress.totalBytes);
    }
    if (total < 1) return 2;
    return Math.max(2, Math.min(100, Math.round(completed * 100 / total)));
  };

  const setTerminal = (tone, icon, heading, copy) => {
    terminalPanel.dataset.tone = tone;
    byId("terminal-icon").textContent = icon;
    byId("terminal-heading").textContent = heading;
    byId("terminal-copy").textContent = copy;
    terminalPanel.hidden = false;
  };

  const requireReport = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The local report was incomplete.");
    if (typeof value.collectionIndexStored !== "boolean") throw new Error("The local report did not confirm its durable index.");
    if (!value.totals || typeof value.totals !== "object" || Array.isArray(value.totals)) throw new Error("The local report totals were incomplete.");
    for (const key of ["selectedRoots", "storedRoots", "failedRoots", "cancelledRoots", "storedFiles", "storedBytes"]) {
      if (!Number.isSafeInteger(value.totals[key]) || value.totals[key] < 0) throw new Error("The local report totals were invalid.");
    }
    if (!["complete", "complete_with_failures", "cancelled"].includes(value.outcome)) throw new Error("The local report outcome was invalid.");
    return value;
  };

  const applyTerminalReport = (report, phase) => {
    const value = requireReport(report);
    const stored = value.totals.storedRoots;
    const failed = value.totals.failedRoots;
    const cancelled = value.totals.cancelledRoots;
    partialFailures.hidden = true;
    if (!value.collectionIndexStored) {
      setTerminal(
        "failure",
        "×",
        "The local collection was not finalised",
        stored > 0
          ? "Some copy work completed, but the durable collection index was not stored. Do not treat this batch as a ready workspace."
          : "No durable collection index was stored. The local report remains available for review."
      );
      return value;
    }
    if (value.outcome === "cancelled" || phase === "cancelled") {
      setTerminal(
        "warning",
        "■",
        "Local copy work was stopped",
        stored > 0
          ? formatCount(stored) + (stored === 1 ? " verified copy was" : " verified copies were") + " durably recorded before the stop."
          : cancelled > 0
            ? "No verified local copy was completed before the remaining work was stopped."
            : "The work stopped before a verified local copy was recorded."
      );
      return value;
    }
    if (stored < 1) {
      setTerminal(
        "failure",
        "×",
        "No verified copies were kept",
        failed > 0
          ? formatCount(failed) + (failed === 1 ? " selected item could not be copied." : " selected items could not be copied.") + " Open the report for the path-free result."
          : "The batch finished without a verified local copy. Open the report for the path-free result."
      );
      return value;
    }
    if (failed > 0 || value.outcome === "complete_with_failures") {
      setTerminal(
        "warning",
        "!",
        "Verified copies are ready; some items need attention",
        formatCount(stored) + (stored === 1 ? " copy is" : " copies are") + " durably indexed. " + formatCount(failed) + (failed === 1 ? " item was not copied." : " items were not copied.")
      );
      return value;
    }
    setTerminal(
      "success",
      "✓",
      "Verified local copies are ready",
      formatCount(stored) + (stored === 1 ? " copy is" : " copies are") + " durably indexed. Truth remains pending review."
    );
    return value;
  };

  const showRawReport = (report) => {
    reportOutput.textContent = JSON.stringify(report, null, 2);
    reportOutput.hidden = false;
    reportOutput.focus();
  };

  const loadTerminalReport = async (showRaw) => {
    if (currentReport === null) {
      if (reportRequest === null) {
        reportRequest = postJson("/api/native-source-basket/report", {});
      }
      try {
        currentReport = requireReport(await reportRequest);
      } finally {
        reportRequest = null;
      }
    }
    applyTerminalReport(currentReport, currentView && currentView.phase);
    if (showRaw) showRawReport(currentReport);
    return currentReport;
  };

  const render = (view) => {
    currentView = view;
    const sources = Array.isArray(view.sources) ? view.sources : [];
    const totals = view.totals && typeof view.totals === "object" ? view.totals : {};
    const busy = view.busy === true;
    const status = typeof view.phase === "string" ? view.phase : "selecting";
    const hasSources = sources.length > 0;
    sourceRegion.setAttribute("aria-busy", String(busy));
    renderSources(sources);
    byId("total-roots").textContent = formatCount(totals.selectedRoots);
    byId("total-files").textContent = formatCount(totals.discoveredFiles);
    byId("total-bytes").textContent = formatBytes(totals.totalBytesDecimal);
    chooseFiles.disabled = busy || !view.nextEvent;
    chooseFolder.disabled = busy || !view.nextEvent;
    openDropArea.disabled = busy || !view.nextEvent;
    startImport.disabled = busy || !hasSources || !view.nextEvent;
    const cancellableImport = view.canCancelImport === true && status === "importing";
    const importing = cancellableImport;
    cancelActive.hidden = !cancellableImport;
    cancelActive.disabled = !cancellableImport;
    progressPanel.hidden = !importing;
    if (importing) {
      byId("progress-bar").style.width = String(progressPercent(view)) + "%";
      const copying = sources.some((source) => source && source.state === "copying");
      byId("progress-heading").textContent = copying ? "Keeping verified local copies" : "Preparing the workspace";
      byId("progress-value").textContent = "Working locally";
    }
    const failureCount = safeInteger(totals.failedRoots);
    const terminal = status === "complete" || status === "failed" || status === "cancelled";
    partialFailures.hidden = terminal || failureCount < 1;
    if (failureCount > 0) byId("partial-failure-copy").textContent = formatCount(failureCount) + (failureCount === 1 ? " item needs" : " items need") + " attention. Other items continue independently.";
    const reportButton = byId("view-report");
    if (!terminal) {
      terminalPanel.hidden = true;
      reportButton.hidden = true;
      reportOutput.hidden = true;
      currentReport = null;
      reportRequest = null;
      reportAutoAttempted = false;
      return;
    }
    terminalPanel.hidden = false;
    reportButton.hidden = view.reportAvailable !== true;
    reportButton.disabled = view.reportAvailable !== true;
    if (view.reportAvailable !== true) {
      currentReport = null;
      reportRequest = null;
      if (status === "cancelled") {
        setTerminal("warning", "■", "The local selection ended", "No copy work started. Stop this session and start again when you are ready to choose sources.");
      } else {
        setTerminal("failure", "×", "The local selection could not continue", "No ready-workspace claim is being made. Stop this session and start again before choosing sources.");
      }
      return;
    }
    if (currentReport !== null) {
      applyTerminalReport(currentReport, status);
      return;
    }
    if (view.durableOutcome === "collection_index_failed") {
      setTerminal("failure", "×", "The local collection was not finalised", "The durable collection index was not stored. The path-free report remains available for review.");
    } else if (status === "cancelled") {
      setTerminal("warning", "■", "Local copy work was stopped", "Checking the local report for any copies durably recorded before the stop.");
    } else if (status === "failed") {
      setTerminal("failure", "×", "No ready local workspace was created", "Checking the local report before describing the failed batch.");
    } else {
      setTerminal("warning", "…", "Checking the final local result", "The report must confirm a durable index and at least one stored copy before this page says the workspace is ready.");
    }
    if (view.reportAvailable === true && !reportAutoAttempted) {
      reportAutoAttempted = true;
      void loadTerminalReport(false).catch(() => {
        setTerminal("failure", "×", "The final local report could not be checked", "No ready-workspace claim is being made. Use View local report to try again.");
      });
    }
  };

  const schedulePoll = () => {
    if (stopped || pollTimer !== null) return;
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void loadView();
    }, 800);
  };

  const loadView = async () => {
    if (stopped) return;
    try {
      const value = await getJson("/api/native-source-basket");
      render(publicViewFrom(value));
      await loadAnalysisView();
    } catch (error) {
      showError(error instanceof Error ? error.message : "The local session did not respond.");
    } finally {
      schedulePoll();
    }
  };

  const renderActionOutcome = (value, action, nextView) => {
    const status = value && typeof value.status === "string" ? value.status : "unknown";
    if (status === "updated") {
      showStatus(action === "add_folder"
        ? "The folder was added to this local list."
        : action === "add_dropped"
          ? "The dropped files and folders were added to this local list."
          : "The chosen files were added to this local list.");
      return;
    }
    if (status === "picker_cancelled") {
      showStatus("The Windows picker was closed. Nothing was added and your list is unchanged.");
      return;
    }
    if (status === "drop_cancelled") {
      showStatus("The Windows drop panel was closed. Nothing was added and your list is unchanged.");
      return;
    }
    if (status === "selection_rejected") {
      showError("Those items could not be added together. Nothing was added; start a new local selection session.");
      return;
    }
    if (status === "adapter_unavailable") {
      showError(action === "add_dropped"
        ? "The Windows drop panel is unavailable. Nothing was added; stop this session and check the local helper."
        : "The Windows picker is unavailable. Nothing was added; stop this session and check the local helper.");
      return;
    }
    if (status === "adapter_failed") {
      showError(action === "add_dropped"
        ? "The Windows drop panel could not complete that drop. Nothing was added."
        : "The Windows picker could not complete that choice. Nothing was added.");
      return;
    }
    if (status === "started" && value.accepted === true && nextView.phase === "importing") {
      showStatus("Local inspection and verified copying have started.");
      return;
    }
    if (status === "start_rejected") {
      showStatus("No workspace was chosen. No copy work started and your list is unchanged.");
      return;
    }
    if (status === "start_uncertain") {
      showError("The local workspace start could not be confirmed. No ready-workspace claim is being made.");
      return;
    }
    if (status === "cancelled") {
      showStatus("The local selection session was cancelled. No copy work started.");
      return;
    }
    showError("The local action returned an outcome this preview could not confirm.");
  };

  const runAction = async (action) => {
    clearError();
    clearStatus();
    try {
      const event = bindingFor(action);
      chooseFiles.disabled = true;
      chooseFolder.disabled = true;
      openDropArea.disabled = true;
      const value = await postJson("/api/native-source-basket/action", event);
      const nextView = publicViewFrom(value);
      render(nextView);
      renderActionOutcome(value, action, nextView);
    } catch (error) {
      showError(error instanceof Error ? error.message : "The local action could not be completed.");
      await loadView();
    }
  };

  chooseFiles.addEventListener("click", () => { void runAction("add_files"); });
  chooseFolder.addEventListener("click", () => { void runAction("add_folder"); });
  openDropArea.addEventListener("click", () => { void runAction("add_dropped"); });
  startImport.addEventListener("click", () => { void runAction("start"); });

  cancelActive.addEventListener("click", async () => {
    clearError();
    clearStatus();
    try {
      const value = await postJson("/api/native-source-basket/cancel-active", {});
      render(publicViewFrom(value));
      showStatus("The stop request was sent. Originals were not changed.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "The current local work could not be stopped.");
    }
  });

  byId("view-report").addEventListener("click", async () => {
    clearError();
    try {
      await loadTerminalReport(true);
    } catch (error) {
      showError(error instanceof Error ? error.message : "The local report is not ready yet.");
    }
  });

  startAnalysis.addEventListener("click", async () => {
    clearError();
    clearStatus();
    showAnalysisStatus("Starting bounded inspection of the verified saved copies…");
    try {
      startAnalysis.disabled = true;
      const value = await postJson("/api/native-collection-analysis/start", {});
      renderAnalysis(value);
      showAnalysisStatus("Bounded inspection of the verified saved copies has started.", "success");
    } catch (error) {
      await loadAnalysisView().catch(() => undefined);
      showAnalysisStatus(error instanceof Error ? error.message : "Copied payload inspection could not start.", "failure");
    }
  });

  cancelAnalysis.addEventListener("click", async () => {
    clearError();
    clearStatus();
    showAnalysisStatus("Sending the stop request. The current bounded verification step may finish first…", "warning");
    try {
      cancelAnalysis.disabled = true;
      const value = await postJson("/api/native-collection-analysis/cancel", {});
      renderAnalysis(value);
      showAnalysisStatus("Inspection stopped between bounded verification steps; completed results were preserved.", "warning");
    } catch (error) {
      showAnalysisStatus(error instanceof Error ? error.message : "Copied payload inspection could not be stopped.", "failure");
    }
  });

  viewAnalysisReport.addEventListener("click", async () => {
    clearError();
    clearStatus();
    showAnalysisStatus("Opening the inspection report…");
    try {
      currentAnalysisReport = requireAnalysisReport(
        await postJson("/api/native-collection-analysis/report", {}),
      );
      analysisReportOutput.textContent = JSON.stringify(currentAnalysisReport, null, 2);
      analysisReportOutput.hidden = false;
      analysisReportOutput.focus();
      showAnalysisStatus("Inspection report opened below. Operator review remains required.", "success");
    } catch (error) {
      showAnalysisStatus(error instanceof Error ? error.message : "The copied payload inspection report is not ready yet.", "failure");
    }
  });

  stopApp.addEventListener("click", async () => {
    stopApp.disabled = true;
    clearError();
    try {
      await postJson("/api/stop", {});
      stopped = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      pollTimer = null;
      byId("connection-status").textContent = "Local session stopped. You can close this tab.";
      chooseFiles.disabled = true;
      chooseFolder.disabled = true;
      openDropArea.disabled = true;
      startImport.disabled = true;
      cancelActive.hidden = true;
      startAnalysis.disabled = true;
      cancelAnalysis.hidden = true;
    } catch (error) {
      stopApp.disabled = false;
      showError(error instanceof Error ? error.message : "The local session could not be stopped.");
    }
  });

  if (!token) {
    stopped = true;
    showError("This local session link is incomplete. Open the exact link shown by Venviewer.");
    chooseFiles.disabled = true;
    chooseFolder.disabled = true;
    openDropArea.disabled = true;
    startImport.disabled = true;
    startAnalysis.disabled = true;
    cancelAnalysis.hidden = true;
    stopApp.disabled = true;
  } else {
    void loadView();
  }
})();`;
