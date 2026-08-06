export const LOCAL_FOUNDRY_APP_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reconstruction Foundry · Local intake check</title>
    <link rel="icon" href="data:,">
    <link rel="stylesheet" href="/app.css">
    <script src="/app.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#workspace">Skip to the local review</a>
    <main class="shell">
      <header class="masthead">
        <a class="brand" href="#top" aria-label="Reconstruction Foundry home">
          <span class="brand-mark" aria-hidden="true">RF</span>
          <span>Reconstruction Foundry</span>
        </a>
        <div class="trust-line" aria-label="This app uses loopback only and reads the source without changing it">
          <span class="trust-dot" aria-hidden="true"></span>
          Loopback-only app · read-only source
        </div>
      </header>

      <section class="intro" id="top">
        <div>
          <h1>Check a capture before Foundry contacts any external service.</h1>
          <p>This app reads the source you chose when it started. It cannot upload, rebuild, approve, move, or change those files.</p>
        </div>
        <dl class="session-facts">
          <div><dt>Source</dt><dd id="source-label">Waiting…</dd></div>
          <div><dt>Session ends</dt><dd id="expires-at">Waiting…</dd></div>
        </dl>
      </section>

      <section class="workbench" id="workspace" aria-labelledby="status-heading">
        <div class="status-head">
          <div>
            <p class="section-label">Current state</p>
            <h2 id="status-heading">Starting the local check</h2>
            <p id="status-copy" role="status" aria-live="polite">The app is preparing to read file names and fingerprints.</p>
          </div>
          <div class="status-actions">
            <button id="download-handoff-button" class="button button-primary" type="button" aria-describedby="handoff-download-help" disabled>Download one complete file</button>
            <button id="download-button" class="button button-quiet" type="button" disabled>Download receipt only</button>
            <button id="stop-button" class="button button-quiet" type="button">Stop local session</button>
          </div>
        </div>

        <p id="handoff-download-help" class="handoff-download-help" role="status" aria-live="polite" aria-atomic="true">When the check finishes, this gives you one JSON file containing the receipt, findings, evidence checklist, and any review, plan, or comparison you have completed.</p>

        <p id="session-warning" class="session-warning" role="status" aria-live="polite" hidden></p>

        <div class="progress-track" aria-hidden="true"><span id="progress-bar" data-progress="20"></span></div>
        <ol class="steps" aria-label="Local review steps">
          <li id="step-inspect" data-state="active" aria-current="step"><span>1</span><div><strong>Read and fingerprint</strong><small>No source files are changed.</small><span class="sr-only step-state-sr">Current step</span></div></li>
          <li id="step-receipt" data-state="waiting"><span>2</span><div><strong>Build the receipt</strong><small>Formats, sizes, and duplicates.</small><span class="sr-only step-state-sr">Not started</span></div></li>
          <li id="step-review" data-state="waiting"><span>3</span><div><strong>Record choices</strong><small>Every file needs one decision.</small><span class="sr-only step-state-sr">Not started</span></div></li>
          <li id="step-plan" data-state="waiting"><span>4</span><div><strong>Compare plans</strong><small>Nothing will run.</small><span class="sr-only step-state-sr">Not started</span></div></li>
          <li id="step-save" data-state="waiting"><span>5</span><div><strong>Request downloads</strong><small>Then check your Downloads folder.</small><span class="sr-only step-state-sr">Not started</span></div></li>
        </ol>

        <div id="error-panel" class="error-panel" hidden>
          <strong>The check could not finish.</strong>
          <p id="error-copy">Check that the source still exists and did not change, then start a new local session.</p>
        </div>

        <div id="results" hidden>
          <div class="metrics" aria-label="Receipt summary">
            <div><strong id="metric-files">0</strong><span>files read</span></div>
            <div><strong id="metric-size">0 B</strong><span>total size</span></div>
            <div><strong id="metric-formats">0</strong><span>format groups</span></div>
            <div><strong id="metric-duplicates">0</strong><span>duplicate groups</span></div>
          </div>

          <section id="local-intake-workspace" class="result-section local-intake-workspace" aria-labelledby="local-intake-workspace-heading" hidden>
            <div class="section-row local-intake-workspace-head">
              <div>
                <p class="section-label">Verified local workspace</p>
                <h3 id="local-intake-workspace-heading">Keep a verified copy on this computer</h3>
              </div>
              <span class="authority-badge">Local copy · authority none</span>
            </div>
            <p class="local-intake-workspace-intro">Foundry can copy the exact checked source into the local workspace chosen when this app started. The original source stays unchanged. Nothing is uploaded or processed: no reconstruction, training, enhancement, or publishing runs. Pending review, admitted, excluded, captured, enhanced-captured, generated, and concept/imagination truth labels stay separate so you can close this workspace and reopen its verified record later.</p>
            <p class="local-intake-workspace-intro">If no workspace is available, stop this session, select a new local workspace folder when starting Foundry, then reopen the source.</p>
            <dl class="local-intake-workspace-boundaries">
              <div><dt>Original source</dt><dd>Read only and unchanged</dd></div>
              <div><dt>External requests</dt><dd>0 · nothing is uploaded</dd></div>
              <div><dt>Processing</dt><dd>No reconstruction, training, enhancement, or publishing</dd></div>
              <div><dt>Later use</dt><dd>Close and reopen this verified local workspace</dd></div>
            </dl>

            <div id="local-intake-workspace-status" class="local-intake-workspace-status" data-state="unavailable" role="status" aria-live="polite" aria-atomic="true">
              <strong id="local-intake-workspace-status-heading">Local workspace is not available</strong>
              <p id="local-intake-workspace-status-copy">Wait for the checked receipt and local workspace status.</p>
              <div id="local-intake-workspace-meter" class="local-intake-workspace-meter" role="progressbar" aria-label="Verified local copy progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="local-intake-workspace-meter-bar"></span></div>
            </div>

            <dl id="local-intake-workspace-progress-facts" class="local-intake-workspace-progress-facts" aria-label="Local copy counters" hidden>
              <div><dt>Files copied</dt><dd id="local-intake-workspace-copied-files">0 of 0</dd></div>
              <div><dt>Bytes copied</dt><dd id="local-intake-workspace-copied-bytes">0 B of 0 B</dd></div>
            </dl>

            <div id="local-intake-workspace-result" class="local-intake-workspace-result" hidden>
              <dl class="local-intake-workspace-result-facts">
                <div><dt>Verified files</dt><dd id="local-intake-workspace-file-count">0</dd></div>
                <div><dt>Verified size</dt><dd id="local-intake-workspace-total-bytes">0 B</dd></div>
                <div class="local-intake-workspace-wide-fact"><dt>Workspace record SHA-256</dt><dd><code id="local-intake-workspace-sha">Waiting…</code></dd></div>
              </dl>
              <h4 class="local-intake-workspace-truth-heading">Preserved truth labels</h4>
              <dl class="local-intake-workspace-truth" aria-label="Preserved truth-class summary">
                <div><dt>Pending review</dt><dd id="local-intake-workspace-truth-pending-review">0</dd></div>
                <div><dt>Admitted</dt><dd id="local-intake-workspace-truth-admitted">0</dd></div>
                <div><dt>Excluded</dt><dd id="local-intake-workspace-truth-excluded">0</dd></div>
                <div><dt>Captured</dt><dd id="local-intake-workspace-truth-captured">0</dd></div>
                <div><dt>Enhanced-captured</dt><dd id="local-intake-workspace-truth-enhanced-captured">0</dd></div>
                <div><dt>Generated cinematic</dt><dd id="local-intake-workspace-truth-generated-cinematic">0</dd></div>
                <div><dt>Concept / imagination</dt><dd id="local-intake-workspace-truth-concept-imagination">0</dd></div>
              </dl>
            </div>

            <div id="local-intake-workspace-error" class="error-panel" role="alert" tabindex="-1" hidden></div>
            <div class="guided-actions local-intake-workspace-actions">
              <button id="start-local-intake-workspace-button" class="button button-primary" type="button" disabled>Keep verified copy</button>
              <button id="cancel-local-intake-workspace-button" class="button button-quiet" type="button" hidden>Cancel copying</button>
              <button id="download-local-intake-workspace-report-button" class="button button-quiet" type="button" hidden>Download workspace record</button>
            </div>

            <div id="local-intake-workspace-delete" class="local-intake-workspace-delete" hidden>
              <strong>Delete only the local workspace copy</strong>
              <p>This deletes the workspace copy and its saved record, then stops this local session. The original source stays unchanged.</p>
              <label class="local-intake-workspace-delete-confirm"><input id="confirm-delete-local-intake-workspace" type="checkbox"> I understand this deletes the local copy and stops this local session.</label>
              <button id="delete-local-intake-workspace-button" class="button button-danger" type="button" disabled>Delete local copy and stop</button>
            </div>
          </section>

          <section class="result-section split" aria-labelledby="formats-heading">
            <div class="section-intro"><p class="section-label">What was found</p><h3 id="formats-heading">Detected formats</h3><p>A format name is a clue, not proof that a file is safe or owned.</p></div>
            <div id="format-list" class="plain-list"></div>
          </section>

          <section class="result-section split" aria-labelledby="review-heading">
            <div class="section-intro"><p class="section-label">Why files are held</p><h3 id="review-heading">Not approved yet: what to do next</h3><p>The technical word is “quarantine.” Here it only means the app is holding each file until a person checks its rights and origin. Nothing has been approved for reconstruction or training.</p></div>
            <div id="quarantine-list" class="action-list"></div>
          </section>

          <section class="result-section" aria-labelledby="duplicates-heading">
            <div class="section-row"><div><p class="section-label">Exact copies</p><h3 id="duplicates-heading">Duplicate groups</h3></div><p id="duplicate-note">No exact duplicates found.</p></div>
            <div id="duplicate-list" class="duplicate-list"></div>
          </section>

          <section class="result-section" aria-labelledby="files-heading">
            <div class="section-row"><div><p class="section-label">Receipt detail</p><h3 id="files-heading">Files checked</h3></div><p id="file-limit-note"></p></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>File</th><th>Detected as</th><th>Size</th><th>Why it is held</th><th>Next action</th></tr></thead>
                <tbody id="file-table-body"></tbody>
              </table>
            </div>
          </section>

          <section id="source-facts" class="result-section source-facts" aria-labelledby="source-facts-heading" hidden>
            <div class="section-row">
              <div>
                <p class="section-label">Universal Source Facts V7</p>
                <h3 id="source-facts-heading">What these exact bytes declare</h3>
              </div>
              <span class="authority-badge">Read only · authority none</span>
            </div>
            <p class="source-facts-intro">V7 preserves the complete V6 source-facts artifact below and adds bounded structural inspection of exact Potree v2 metadata.json, hierarchy.bin, and octree.bin bundles. Potree success establishes the supported metadata declarations, reachable hierarchy graph, and exact octree byte layout only. It does not decode point values or establish units, frame, CRS, physical bounds, completeness, registration, accuracy, provenance, rights, or viewer fidelity. Coverage applies only to this fingerprinted receipt root and file set.</p>
            <dl id="source-facts-summary" class="source-facts-summary"></dl>
            <div id="source-facts-blocker" class="plain-warning" hidden></div>
            <div class="v7-inherited-heading"><strong>Inherited V6 source evidence</strong><span>Preserved without replacement</span></div>
            <div id="source-facts-list" class="source-facts-list"></div>
            <section id="potree-source-facts" class="potree-v7-section" aria-labelledby="potree-source-facts-heading" hidden>
              <div class="potree-v7-heading">
                <div><p class="section-label">Potree v2 refinement</p><h4 id="potree-source-facts-heading">Exact three-member bundles</h4></div>
                <span class="authority-badge">Structure only · authority none</span>
              </div>
              <p>Each card stays bound to the receipt identities of metadata.json, hierarchy.bin, and octree.bin. A structural result is not decoded geometry or permission to process.</p>
              <div id="potree-source-facts-list" class="potree-bundle-list"></div>
            </section>
            <footer class="source-facts-footer">
              <div><span>Source facts fingerprint</span><code id="source-facts-sha">Not ready</code></div>
              <p id="source-facts-download-status" class="operator-evidence-download-status" role="status" aria-live="polite" aria-atomic="true"></p>
              <button id="download-source-facts-button" class="button button-quiet" type="button">Download source facts</button>
            </footer>
          </section>

          <section id="point-value-diagnostic" class="result-section point-value-diagnostic" aria-labelledby="point-value-diagnostic-heading" hidden>
            <div class="section-row point-value-diagnostic-head">
              <div>
                <p class="section-label">Decoded point diagnostic V8</p>
                <h3 id="point-value-diagnostic-heading">See every numeric record without inventing meaning</h3>
              </div>
              <span class="authority-badge">Local raster · authority none</span>
            </div>
            <p class="point-value-diagnostic-intro">V8 reads the exact 14-byte records from a V7-established Potree bundle and makes deterministic position-component projections. These are decoder-coordinate observations with no established units, up axis, frame, CRS, physical orientation, accuracy, completeness, or official-viewer fidelity. The field named <code>lcc prediction</code> remains an opaque vendor byte.</p>
            <dl id="point-value-summary" class="point-value-summary"></dl>
            <div id="point-value-warning" class="plain-warning point-value-warning" role="status" aria-live="polite" aria-atomic="true" hidden></div>

            <div class="point-value-workbench">
              <div class="point-value-controls">
                <label class="point-value-bundle-control" for="point-value-bundle-select"><span>Exact bundle</span><select id="point-value-bundle-select"></select></label>
                <fieldset id="point-value-plane-controls"><legend>Position components</legend>
                  <label><input type="radio" name="point-value-plane" value="position_0_1" checked> 0–1</label>
                  <label><input type="radio" name="point-value-plane" value="position_0_2"> 0–2</label>
                  <label><input type="radio" name="point-value-plane" value="position_1_2"> 1–2</label>
                </fieldset>
                <fieldset id="point-value-mode-controls"><legend>Colour mode</legend>
                  <label><input type="radio" name="point-value-mode" value="omitted_component" checked> Omitted component</label>
                  <label><input type="radio" name="point-value-mode" value="intensity_byte"> Intensity byte</label>
                  <label><input type="radio" name="point-value-mode" value="opaque_vendor_byte"> Opaque vendor byte</label>
                  <label><input type="radio" name="point-value-mode" value="record_density"> Record density</label>
                </fieldset>
                <div class="point-value-zoom-control">
                  <label for="point-value-zoom">Preview zoom <output id="point-value-zoom-output" for="point-value-zoom">1×</output></label>
                  <input id="point-value-zoom" type="range" min="1" max="4" value="1" step="0.25">
                  <button id="point-value-zoom-reset" class="button button-quiet" type="button">Reset zoom</button>
                </div>
              </div>

              <figure class="point-value-figure">
                <div id="point-value-image-viewport" class="point-value-image-viewport" role="region" tabindex="0" aria-label="Scrollable decoded point preview" aria-describedby="point-value-caption">
                  <div id="point-value-image-stage" class="point-value-image-stage">
                    <img id="point-value-image" class="point-value-image" alt="" width="1024" height="1024">
                    <svg id="room-envelope-overlay" class="room-envelope-overlay" viewBox="0 0 1024 1024" role="img" aria-label="Room-envelope fit-seed polygon overlay. Click the preview to add an intrinsic-pixel vertex."></svg>
                  </div>
                </div>
                <figcaption id="point-value-caption" aria-live="polite" aria-atomic="true">Choose a component plane and colour mode.</figcaption>
              </figure>
            </div>

            <section id="room-envelope-review" class="room-envelope-review" aria-labelledby="room-envelope-review-heading">
              <div class="room-envelope-review-head">
                <div>
                  <p class="section-label">Reception envelope review V0</p>
                  <h4 id="room-envelope-review-heading">Draw a fit-seed outline in intrinsic pixels</h4>
                </div>
                <span class="authority-badge">Fit seed only · authority none</span>
              </div>
              <p class="room-envelope-review-intro">Review and mark all three component projections, then choose the projection you consider horizontal and draw a simple outline. This does not establish axes, units, room identity, orientation, physical accuracy, registration, rights, or validation independence.</p>
              <p id="room-envelope-review-status" class="room-envelope-review-status" role="status" aria-live="polite" aria-atomic="true">Waiting for exact V8 bundle evidence.</p>
              <div class="room-envelope-review-grid">
                <div class="room-envelope-review-evidence">
                  <h5>Exact previews reviewed</h5>
                  <ul id="room-envelope-preview-visits" class="room-envelope-preview-visits">
                    <li><span>Components 0–1</span><strong id="room-envelope-visit-position-0-1">Not marked</strong></li>
                    <li><span>Components 0–2</span><strong id="room-envelope-visit-position-0-2">Not marked</strong></li>
                    <li><span>Components 1–2</span><strong id="room-envelope-visit-position-1-2">Not marked</strong></li>
                  </ul>
                  <button id="room-envelope-mark-preview" class="button button-quiet" type="button">Mark this exact preview reviewed</button>
                  <label for="room-envelope-horizontal-view"><span>Proposed horizontal projection</span>
                    <select id="room-envelope-horizontal-view">
                      <option value="position_0_1">Components 0–1</option>
                      <option value="position_0_2">Components 0–2</option>
                      <option value="position_1_2">Components 1–2</option>
                    </select>
                  </label>
                </div>
                <form id="room-envelope-review-form" class="room-envelope-review-form">
                  <div class="room-envelope-identity-fields">
                    <label for="room-envelope-room-label"><span>Operator room label</span><input id="room-envelope-room-label" maxlength="160" autocomplete="off" required placeholder="Reception Room"></label>
                    <label for="room-envelope-reviewer"><span>Reviewer</span><input id="room-envelope-reviewer" maxlength="160" autocomplete="name" required></label>
                    <label for="room-envelope-decision"><span>Decision</span><select id="room-envelope-decision"><option value="needs_revision" selected>Needs revision</option><option value="accepted_as_fit_seed">Accept as fit seed</option></select></label>
                  </div>
                  <label for="room-envelope-note"><span>Review note</span><textarea id="room-envelope-note" maxlength="1000" rows="3" placeholder="Record uncertainty, exclusions, or why another pass is needed."></textarea></label>
                  <fieldset class="room-envelope-coordinate-entry"><legend>Add an intrinsic-pixel vertex (0–1023)</legend>
                    <label for="room-envelope-x"><span>X</span><input id="room-envelope-x" type="number" min="0" max="1023" step="1" inputmode="numeric"></label>
                    <label for="room-envelope-y"><span>Y</span><input id="room-envelope-y" type="number" min="0" max="1023" step="1" inputmode="numeric"></label>
                    <button id="room-envelope-add-vertex" class="button button-quiet" type="button">Add vertex</button>
                  </fieldset>
                  <div class="room-envelope-vertex-head"><h5>Ordered vertices</h5><span id="room-envelope-vertex-count">0 of 64</span></div>
                  <ol id="room-envelope-vertex-list" class="room-envelope-vertex-list"></ol>
                  <div class="room-envelope-vertex-actions">
                    <button id="room-envelope-undo" class="button button-quiet" type="button" disabled>Undo last</button>
                    <button id="room-envelope-clear" class="button button-quiet" type="button" disabled>Clear outline</button>
                  </div>
                  <p id="room-envelope-polygon-help" class="room-envelope-polygon-help">Add at least three unique vertices. Edges must not cross.</p>
                  <div id="room-envelope-review-error" class="plain-warning room-envelope-review-error" role="alert" tabindex="-1" hidden></div>
                  <button id="room-envelope-submit" class="button button-primary" type="submit" disabled>Count records and store review</button>
                </form>
              </div>
              <div id="room-envelope-review-result" class="room-envelope-review-result" hidden>
                <dl>
                  <div><dt>Records inside</dt><dd id="room-envelope-included-count">0</dd></div>
                  <div><dt>Records outside</dt><dd id="room-envelope-excluded-count">0</dd></div>
                  <div><dt>Fit-only eligibility</dt><dd id="room-envelope-eligibility">Not eligible</dd></div>
                  <div><dt>Authority</dt><dd>None</dd></div>
                </dl>
                <div class="room-envelope-result-footer"><div><span>Review fingerprint</span><code id="room-envelope-report-sha">Not ready</code></div><button id="download-room-envelope-report" class="button button-quiet" type="button">Download canonical review JSON</button></div>
              </div>
            </section>

            <div id="point-value-facts" class="point-value-facts"></div>
            <details class="point-value-boundary-details">
              <summary id="point-value-remaining-summary">What this still does not establish</summary>
              <ul id="point-value-remaining-list"></ul>
            </details>
            <footer class="point-value-footer">
              <div><span>V8 source-facts fingerprint</span><code id="point-value-facts-sha">Not ready</code></div>
              <p id="point-value-download-status" class="operator-evidence-download-status" role="status" aria-live="polite" aria-atomic="true"></p>
              <div class="point-value-download-actions">
                <button id="download-point-value-image-button" class="button button-quiet" type="button">Download this PNG</button>
                <button id="download-source-facts-v8-button" class="button button-quiet" type="button">Download V8 source facts</button>
                <button id="download-source-readiness-v8-button" class="button button-quiet" type="button">Download V8 readiness</button>
                <button id="download-operator-evidence-v8-button" class="button button-quiet" type="button">Download V8 checklist</button>
              </div>
            </footer>
          </section>

          <section id="source-readiness" class="result-section source-readiness" aria-labelledby="source-readiness-heading" hidden>
            <div class="section-row source-readiness-head">
              <div>
                <p class="section-label">Source Readiness Map V7</p>
                <h3 id="source-readiness-heading">What this source set covers—and what is still missing</h3>
              </div>
              <span class="authority-badge">Pre-admission map · authority none</span>
            </div>
            <p class="source-readiness-intro">V7 preserves the complete V6 receipt-stage map and adds path-specific Potree bundle refinements below it. A refinement changes only this evidence view; it does not remove the inherited record, approve files, establish processing readiness, compile a route or recipe, select a worker or provider, establish rights, accuracy, or registration, or say anything can run.</p>
            <dl id="source-readiness-summary" class="source-readiness-summary"></dl>
            <div id="source-readiness-blocker" class="plain-warning source-readiness-blocker" role="alert" aria-live="assertive" aria-atomic="true" hidden></div>
            <div class="v7-inherited-heading"><strong>Inherited V6 readiness lanes and gaps</strong><span>Preserved without replacement</span></div>
            <div id="source-readiness-lanes" class="source-readiness-lanes"></div>
            <section id="potree-source-readiness" class="potree-v7-section" aria-labelledby="potree-source-readiness-heading" hidden>
              <div class="potree-v7-heading"><div><p class="section-label">Potree v2 refinement</p><h4 id="potree-source-readiness-heading">Path-specific readiness evidence</h4></div></div>
              <p>The inherited V6 rows above remain intact. These digest-bound rows show only which generic member-path evidence is refined by each exact bundle.</p>
              <div id="potree-source-readiness-list" class="potree-refinement-list"></div>
            </section>
            <footer id="source-readiness-footer" class="source-readiness-footer">
              <div><span>Map fingerprint</span><code id="source-readiness-sha">Not established</code></div>
              <p id="source-readiness-download-status" class="operator-evidence-download-status" role="status" aria-live="polite" aria-atomic="true"></p>
              <button id="download-source-readiness-button" class="button button-quiet" type="button">Download readiness map</button>
            </footer>
          </section>

          <section id="operator-evidence-checklist" class="result-section operator-evidence-checklist" aria-labelledby="operator-evidence-checklist-heading" hidden>
            <div class="section-row operator-evidence-head">
              <div>
                <p class="section-label">Operator Evidence Checklist V7</p>
                <h3 id="operator-evidence-checklist-heading">What to collect or verify next</h3>
              </div>
              <span class="authority-badge">Pre-admission requests · authority none</span>
            </div>
            <p class="operator-evidence-intro">V7 preserves the complete V6 checklist and adds Potree-specific evidence requests below it. Its ordering describes evidence dependencies only. It does not decide which requests your intended output needs, collect evidence, mark anything complete, approve a file, establish rights, accuracy, or registration, compile a route or recipe, select a worker or provider, or authorize work.</p>
            <dl id="operator-evidence-summary" class="operator-evidence-summary"></dl>
            <div id="operator-evidence-blocker" class="plain-warning operator-evidence-blocker" role="status" aria-live="polite" aria-atomic="true" hidden></div>
            <div class="v7-inherited-heading"><strong>Inherited V6 evidence requests</strong><span>Preserved without replacement</span></div>
            <div id="operator-evidence-groups" class="operator-evidence-groups"></div>
            <section id="potree-operator-evidence" class="potree-v7-section" aria-labelledby="potree-operator-evidence-heading" hidden>
              <div class="potree-v7-heading"><div><p class="section-label">Potree v2 requests</p><h4 id="potree-operator-evidence-heading">What remains to establish</h4></div></div>
              <p>These requests stay bound to each exact bundle digest. Their presence does not mean the evidence is necessary for every intended output or that any request is complete.</p>
              <div id="potree-operator-evidence-list" class="potree-evidence-list"></div>
            </section>
            <footer id="operator-evidence-footer" class="operator-evidence-footer">
              <div><span>Checklist fingerprint</span><code id="operator-evidence-sha">Not established</code></div>
              <p id="operator-evidence-download-status" class="operator-evidence-download-status" role="status" aria-live="polite" aria-atomic="true"></p>
              <button id="download-operator-evidence-button" class="button button-quiet" type="button">Download evidence checklist</button>
            </footer>
          </section>

          <footer class="receipt-footer">
            <div><span>Receipt fingerprint</span><code id="receipt-sha">Not ready</code></div>
            <p>The server keeps this receipt only in memory. Your browser normally saves downloads in its Downloads folder; nothing is written beside the source. The JSON includes relative file names and fingerprints. Review it and keep it private before sharing.</p>
          </footer>

          <section id="local-hd-worker-readiness" class="local-hd-worker-readiness" aria-labelledby="local-hd-worker-heading">
            <div class="section-row local-hd-worker-head">
              <div>
                <p class="section-label">HD worker environment plan</p>
                <h3 id="local-hd-worker-heading">Pinned plan — not installed or ready to run</h3>
              </div>
              <span class="authority-badge">Plan recorded · no execution</span>
            </div>
            <p class="local-hd-worker-intro">This is a build-owned dependency plan, not a worker selected for this receipt. It records exact root versions and fingerprints while keeping every open dependency, notice, model, data, and runtime item blocked.</p>
            <div class="plain-warning local-hd-worker-binding">
              <strong>This environment plan is not matched to this source or plan.</strong>
              <p>It cannot install software, contact a provider, process venue data, start reconstruction, train a model, spend money, or approve an output.</p>
            </div>
            <dl class="local-hd-worker-summary" aria-label="Worker plan state">
              <div><dt>Manifest</dt><dd id="local-hd-worker-manifest-state">Checking…</dd></div>
              <div><dt>Installation</dt><dd id="local-hd-worker-installation-state">Checking…</dd></div>
              <div><dt>Runtime test</dt><dd id="local-hd-worker-runtime-state">Checking…</dd></div>
              <div><dt>Execution</dt><dd id="local-hd-worker-execution-state">Checking…</dd></div>
            </dl>
            <section id="local-e57-environment" class="local-e57-environment" aria-labelledby="local-e57-environment-heading">
              <div class="local-e57-head">
                <div>
                  <p class="section-label">E57 intake closure</p>
                  <h4 id="local-e57-environment-heading">Candidate bundle recorded — clean-host check still open</h4>
                </div>
                <span class="readiness-status" data-state="evidence_incomplete">No execution</span>
              </div>
              <p class="local-e57-intro">The exact Python 3.13 bundle used by the aggregate-only E57 adapter and its legal pack now reproduce to the same receipt. It remains disabled until a disposable Windows host confirms the declared Microsoft runtime and native modules.</p>
              <dl class="local-e57-summary" aria-label="E57 environment state">
                <div><dt>Runtime</dt><dd id="local-e57-runtime">Checking…</dd></div>
                <div><dt>Exact archives</dt><dd id="local-e57-artifact-count">Checking…</dd></div>
                <div><dt>Bundle files</dt><dd id="local-e57-member-count">Checking…</dd></div>
                <div><dt>Open gates</dt><dd id="local-e57-open-count">Checking…</dd></div>
              </dl>
              <div class="plain-warning local-e57-boundary" role="note">
                <strong id="local-e57-compatibility">Compatibility evidence is being checked.</strong>
                <p id="local-e57-limitation">A synthetic check is not a packaged-worker result.</p>
              </div>
              <div class="local-e57-columns">
                <section aria-labelledby="local-e57-artifacts-heading">
                  <div class="local-e57-subhead"><h5 id="local-e57-artifacts-heading">Selected application-local archives</h5><span>Hashes recorded</span></div>
                  <div id="local-e57-artifacts" class="local-e57-artifacts"></div>
                </section>
                <section aria-labelledby="local-e57-open-items-heading">
                  <div class="local-e57-subhead"><h5 id="local-e57-open-items-heading">What still prevents execution</h5><span>Must close first</span></div>
                  <div id="local-e57-open-items" class="local-e57-open-items"></div>
                </section>
              </div>
              <div class="local-e57-next">
                <strong>Next E57 bundle action</strong>
                <p id="local-e57-next-action">Waiting for the exact closure record.</p>
              </div>
              <footer class="local-e57-footer">
                <span>Candidate bundle receipt</span>
                <code id="local-e57-sha">Not established</code>
              </footer>
            </section>
            <section class="local-hd-worker-subsection" aria-labelledby="local-hd-worker-lanes-heading">
              <div class="local-hd-worker-subhead"><h4 id="local-hd-worker-lanes-heading">Separate capability plans</h4><span id="local-hd-worker-lane-count">0 plans</span></div>
              <div id="local-hd-worker-lanes" class="local-hd-worker-lanes"></div>
            </section>
            <section class="local-hd-worker-subsection" aria-labelledby="local-hd-worker-components-heading">
              <div class="local-hd-worker-subhead"><h4 id="local-hd-worker-components-heading">Exact root components</h4><span id="local-hd-worker-component-count">0 components</span></div>
              <div id="local-hd-worker-components" class="local-hd-worker-components"></div>
            </section>
            <section class="local-hd-worker-subsection" aria-labelledby="local-hd-worker-exclusions-heading">
              <div class="local-hd-worker-subhead"><h4 id="local-hd-worker-exclusions-heading">Explicitly outside this plan</h4><span id="local-hd-worker-exclusion-count">0 exclusions</span></div>
              <div id="local-hd-worker-exclusions" class="local-hd-worker-exclusions"></div>
            </section>
            <div id="local-hd-worker-legacy" class="plain-warning local-hd-worker-legacy" role="note"></div>
            <div class="local-hd-worker-next">
              <strong>One next action</strong>
              <p id="local-hd-worker-next-action">Waiting for the build-owned plan.</p>
            </div>
            <footer class="local-hd-worker-footer">
              <span>Environment-plan fingerprint</span>
              <code id="local-hd-worker-sha">Not established</code>
            </footer>
          </section>

          <section id="guided-workflow" class="guided-workflow" aria-labelledby="guided-heading" hidden>
            <div class="section-row">
              <div>
                <p class="section-label">Guided review</p>
                <h3 id="guided-heading">Choose what belongs in a review draft</h3>
              </div>
              <span class="authority-badge">Draft only · authority none</span>
            </div>
            <div class="plain-warning">
              <strong>This is not legal approval or proof of physical accuracy.</strong>
              <p>You are recording a file’s likely type and origin. Rights, measurements, training, publishing, and real work all remain blocked.</p>
            </div>

            <form id="admission-form" novalidate>
              <fieldset class="form-card">
                <legend>Who is preparing this draft?</legend>
                <div class="form-grid">
                  <label>Project ID <input id="project-id" name="projectId" autocomplete="off" maxlength="120" placeholder="reception-room-pilot" required></label>
                  <label>Operator name <input id="operator-name" name="reviewedBy" autocomplete="name" maxlength="160" placeholder="Your name" required></label>
                  <label>Source is on
                    <select id="source-media" name="sourceMedia">
                      <option value="local">This computer</option>
                      <option value="removable">A removable drive</option>
                    </select>
                  </label>
                  <label>File-name matching
                    <select id="case-sensitivity" name="caseSensitivity">
                      <option value="insensitive">Windows-style (A and a match)</option>
                      <option value="sensitive">Case-sensitive (A and a differ)</option>
                    </select>
                  </label>
                </div>
                <p class="field-help">Your name records who prepared the draft. It does not make you a legal or technical approver.</p>
              </fieldset>

              <div class="decision-heading">
                <div><h4>Decide every file</h4><p id="decision-progress">0 of 0 files decided</p></div>
                <p>“Keep” means include in a review draft. It does not permit processing.</p>
              </div>
              <div id="decision-list" class="decision-list"></div>
              <div id="guided-error" class="error-panel" role="alert" tabindex="-1" hidden></div>
              <p id="admission-lock-note" class="field-help" role="status" hidden>Stop the local file check before changing which files are kept.</p>
              <div class="guided-actions">
                <button id="build-admission-button" class="button button-primary" type="submit">Build review draft</button>
                <button id="download-receipt-secondary" class="button button-quiet" type="button">Download receipt</button>
              </div>
            </form>

            <section id="admission-success" class="draft-result" aria-labelledby="admission-success-heading" hidden>
              <div>
                <p class="section-label">Review draft built</p>
                <h4 id="admission-success-heading">Bound to this exact receipt</h4>
                <p id="admission-summary">The draft has no authority to run, train, publish, or approve anything.</p>
              </div>
              <dl class="digest-list">
                <div><dt>Review fingerprint</dt><dd><code id="review-sha">Not built</code></dd></div>
                <div><dt>Result fingerprint</dt><dd><code id="result-sha">Not built</code></dd></div>
              </dl>
              <div class="guided-actions">
                <button id="download-review-button" class="button button-quiet" type="button">Download review draft</button>
                <button id="download-result-button" class="button button-quiet" type="button">Download result draft</button>
              </div>
            </section>

            <section id="verification-workbench" class="verification-workbench" aria-labelledby="verification-heading" hidden>
              <div class="section-row">
                <div>
                  <p class="section-label">Local file check · £0.00 provider charge</p>
                  <h3 id="verification-heading">Check the approved files again</h3>
                </div>
                <span class="authority-badge">This computer only · no upload</span>
              </div>
              <p>This reads each approved file and checks its size and digital fingerprint—a code calculated from the file’s contents—against the intake receipt. It does not improve or reconstruct the room, and it does not judge scan accuracy.</p>
              <div class="plain-warning verification-privacy">
                <strong>Private resume record</strong>
                <p>No full capture file is staged or uploaded. A small private resume record is saved on this computer and may contain tiny pieces of source data. Protect it like the source.</p>
              </div>
              <div id="verification-saved-draft-context" class="plain-warning" hidden>
                <strong>Using the last saved review draft</strong>
                <p>This file check belongs to the last review draft built in this local app session. The decision form above reset when this page reloaded and does not show that saved draft. To change the draft, decide every file and build a new review draft first.</p>
              </div>
              <div id="verification-status" class="verification-status" role="status" aria-live="polite">
                <div>
                  <strong id="verification-status-heading">Ready when you are</strong>
                  <p id="verification-status-copy">Starting this check does not approve rights, prove measurements, or run reconstruction.</p>
                </div>
                <div class="verification-meter" aria-hidden="true"><span id="verification-meter-bar"></span></div>
                <dl class="verification-counts">
                  <div><dt>Files checked</dt><dd id="verification-file-count">0 of 0</dd></div>
                  <div><dt>Data checked</dt><dd id="verification-byte-count">0 B of 0 B</dd></div>
                  <div><dt>Provider charge</dt><dd>£0.00</dd></div>
                </dl>
              </div>
              <div id="verification-error" class="error-panel" role="alert" tabindex="-1" hidden></div>
              <div class="guided-actions">
                <button id="start-verification-button" class="button button-primary" type="button">Check approved files again</button>
                <button id="cancel-verification-button" class="button button-quiet" type="button" hidden>Stop for now</button>
                <button id="resume-verification-button" class="button button-primary" type="button" hidden>Continue checking from the beginning</button>
                <button id="report-verification-button" class="button button-quiet" type="button" hidden>Confirm final report</button>
              </div>
              <p class="field-help">“Stop for now” and “Continue” work only while this local app session stays open. If the app process closes, this screen cannot reopen the saved check yet; start a new check. Continuing reads every approved file again from the beginning. Electricity, staff time, and hardware wear are not included in the £0.00 provider charge. This app does not claim the filesystem stayed unchanged at one single instant.</p>
            </section>

            <section id="plan-workbench" class="plan-workbench" aria-labelledby="plan-heading" hidden>
              <div class="section-row">
                <div><p class="section-label">Plan preview</p><h3 id="plan-heading">Compare routes — nothing will run</h3></div>
                <span class="authority-badge">No upload · no spend</span>
              </div>
              <p>Choose what you want to inspect. This preview cannot contact a cloud provider, start reconstruction software, or read credentials.</p>
              <fieldset class="form-card plan-options">
                <legend>What should the preview describe?</legend>
                <label>Appearance treatment
                  <select id="hd-appearance">
                    <option value="captured_only">Use captured appearance only</option>
                    <option value="pretrained_inference">Describe pretrained AI enhancement</option>
                    <option value="rights_gated_training">Describe rights-gated training</option>
                  </select>
                  <small>Captured-only uses no invented appearance. The AI choices remain separate from captured and measured truth.</small>
                </label>
                <label class="check-label"><input id="build-mesh" type="checkbox" checked><span>Include an operational mesh<small>A practical surface for navigation and later review. This preview does not build it.</small></span></label>
                <label class="check-label"><input id="semantic-inference" type="checkbox"><span>Include AI-assisted semantic labels<small>AI-proposed object and area names. They remain suggestions, not verified facts.</small></span></label>
                <label class="check-label"><input id="neural-representation" type="checkbox"><span>Include a trainable neural scene<small>A learned visual model. It requires explicit training rights and remains blocked here.</small></span></label>
              </fieldset>
              <div id="plan-error" class="error-panel" role="alert" tabindex="-1" hidden></div>
              <div class="guided-actions">
                <button id="build-plan-button" class="button button-primary" type="button">Build plan preview</button>
              </div>
              <section id="plan-result" class="draft-result" aria-labelledby="plan-result-heading" hidden>
                <div><p class="section-label">Preview result</p><h4 id="plan-result-heading">Planning checks complete</h4><p id="plan-summary"></p></div>
                <div id="planning-gate" class="planning-gate"></div>
                <section id="quality-decision-board" class="quality-decision-board" aria-labelledby="quality-decision-board-heading">
                  <div>
                    <p class="section-label">Source-aware decision support</p>
                    <h5 id="quality-decision-board-heading">What could change quality—and what would prove it</h5>
                    <p>No method wins because of a file extension. Every expected gain remains unmeasured until its decisive comparison succeeds.</p>
                  </div>
                  <div id="quality-decision-board-list" class="quality-board-list"></div>
                </section>
                <section id="processing-outline" class="processing-outline" aria-labelledby="processing-outline-heading">
                  <div>
                    <p class="section-label">Read-only routing insight</p>
                    <h5 id="processing-outline-heading">How admitted files would be separated</h5>
                    <p>This is a file-to-activity outline only. It does not select a worker, compile a recipe, or say that any activity can run.</p>
                  </div>
                  <div id="processing-outline-list" class="outline-list"></div>
                </section>
                <div id="route-list" class="route-list"></div>
                <div class="truth-boundary">
                  <strong>Truth stays separated</strong>
                  <p>Captured, enhanced, generated, and imagined material keep different labels. No AI output becomes measured truth.</p>
                </div>
                <div class="guided-actions">
                  <button id="download-plan-button" class="button button-quiet" type="button">Download plan preview</button>
                </div>
              </section>
            </section>
          </section>

          <section id="prepared-hd-dataset" class="prepared-hd-workbench" aria-labelledby="prepared-hd-heading" hidden>
            <div class="section-row prepared-hd-head">
              <div>
                <p class="section-label">Prepared HD dataset check</p>
                <h3 id="prepared-hd-heading">Validate reconstruction inputs before any HD work</h3>
              </div>
              <span class="authority-badge">Local input check · authority none</span>
            </div>
            <p>This check accepts one exact package root containing <code>dataset/</code> and <code>depths/</code>. It verifies the camera model, image registrations, held-out split, reduced-resolution image mapping, sparse points, and depth priors against the fixed Config-B input contract.</p>
            <dl class="prepared-hd-boundaries" aria-label="Prepared HD dataset boundaries">
              <div><dt>Required layout</dt><dd><code>dataset/</code> + <code>depths/</code></dd></div>
              <div><dt>Fixed options</dt><dd>Depth required · factor 2 · test every 8</dd></div>
              <div><dt>Source access</dt><dd>Read only, checked before and after</dd></div>
              <div><dt>Execution</dt><dd>No registration, reconstruction, training, or enhancement</dd></div>
            </dl>
            <div id="prepared-hd-status" class="prepared-hd-status" data-state="unavailable" role="status" aria-live="polite" aria-atomic="true">
              <div>
                <strong id="prepared-hd-status-heading">Checking the selected package</strong>
                <p id="prepared-hd-status-copy">Nothing has run yet.</p>
              </div>
              <div class="prepared-hd-meter" aria-hidden="true"><span id="prepared-hd-meter-bar"></span></div>
            </div>
            <dl id="prepared-hd-result-facts" class="prepared-hd-result-facts" hidden>
              <div><dt>Cameras</dt><dd id="prepared-hd-camera-count">—</dd></div>
              <div><dt>Registered images</dt><dd id="prepared-hd-image-count">—</dd></div>
              <div><dt>Runtime images</dt><dd id="prepared-hd-runtime-image-count">—</dd></div>
              <div><dt>Training images</dt><dd id="prepared-hd-train-image-count">—</dd></div>
              <div><dt>Held out</dt><dd id="prepared-hd-heldout-image-count">—</dd></div>
              <div><dt>Sparse points</dt><dd id="prepared-hd-point-count">—</dd></div>
              <div><dt>Depth priors</dt><dd id="prepared-hd-depth-prior-count">—</dd></div>
              <div class="prepared-hd-wide-fact"><dt>Readiness receipt fingerprint</dt><dd><code id="prepared-hd-report-sha">—</code></dd></div>
            </dl>
            <div id="prepared-hd-error" class="error-panel" role="alert" tabindex="-1" hidden></div>
            <div class="guided-actions">
              <button id="start-prepared-hd-button" class="button button-primary" type="button" disabled>Validate prepared package</button>
              <button id="cancel-prepared-hd-button" class="button button-quiet" type="button" hidden>Stop and discard</button>
              <button id="download-prepared-hd-report-button" class="button button-quiet" type="button" hidden>Download readiness receipt</button>
            </div>
            <p class="field-help">A successful result means only that this exact prepared input package passed the fixed local contract. Prepared package validated; photo registration, reconstruction, training, and enhancement were not performed.</p>
          </section>

          <section id="photo-capture-quality" class="photo-quality-workbench" aria-labelledby="photo-quality-heading" hidden>
            <div class="section-row photo-quality-head">
              <div>
                <p class="section-label">Local photo capture check</p>
                <h3 id="photo-quality-heading">Find the shots to retake before registration</h3>
              </div>
              <span class="authority-badge">Pixels stay on this computer · originals unchanged</span>
            </div>
            <p>Confirm which JPEG/PNG files may build the pilot and which are the honest held-out test. The workbench decodes the real pixels, checks possible blur, resolution, exposure, clipping, colour consistency, naming coverage, RAW companions, and near-duplicate split leakage. It does not reconstruct the room or invent detail.</p>
            <dl class="photo-quality-counts" aria-label="Photo split counts">
              <div><dt>Build</dt><dd id="photo-quality-build-count">0 / 18</dd></div>
              <div><dt>Held out</dt><dd id="photo-quality-heldout-count">0 / 12</dd></div>
              <div><dt>Ignored</dt><dd id="photo-quality-ignore-count">0</dd></div>
              <div><dt>External requests</dt><dd>0</dd></div>
            </dl>
            <div class="photo-quality-split-note">
              <strong>The held-out set stays excluded</strong>
              <p>Its pixels are checked only for capture integrity and possible overlap with build images. They are never sent into model building, tuning, or selection by this action.</p>
            </div>
            <div id="photo-quality-assignments" class="photo-quality-assignments" aria-label="Photo build and held-out assignments"></div>
            <div id="photo-quality-status" class="photo-quality-status" data-state="ready">
              <div>
                <strong id="photo-quality-status-heading">Confirm the split</strong>
                <p id="photo-quality-status-copy">Nothing has run yet.</p>
              </div>
              <div id="photo-quality-meter" class="photo-quality-meter" role="progressbar" aria-label="Photo analysis progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="photo-quality-meter-bar"></span></div>
              <span id="photo-quality-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span>
            </div>
            <div id="photo-quality-error" class="error-panel" role="alert" tabindex="-1" hidden></div>
            <section id="photo-quality-results" class="photo-quality-results" aria-labelledby="photo-quality-results-heading" hidden>
              <div class="section-row">
                <div>
                  <p class="section-label">Capture triage result</p>
                  <h4 id="photo-quality-results-heading">Contact sheet and retake guidance</h4>
                </div>
                <strong id="photo-quality-readiness" class="photo-quality-readiness">—</strong>
              </div>
              <dl class="photo-quality-result-facts">
                <div><dt>Pass</dt><dd id="photo-quality-pass-count">—</dd></div>
                <div><dt>Review</dt><dd id="photo-quality-review-count">—</dd></div>
                <div><dt>Retake</dt><dd id="photo-quality-retake-count">—</dd></div>
                <div><dt>Protocol</dt><dd id="photo-quality-protocol-status">—</dd></div>
                <div class="photo-quality-wide-fact"><dt>Report fingerprint</dt><dd id="photo-quality-report-sha">—</dd></div>
              </dl>
              <div id="photo-quality-protocol-gaps" class="plain-warning" hidden></div>
              <div id="photo-quality-contact-sheet" class="photo-quality-contact-sheet"></div>
              <div id="photo-quality-similarity" class="photo-quality-similarity" hidden></div>
            </section>
            <div class="guided-actions">
              <button id="start-photo-quality-button" class="button button-primary" type="button">Check these photos</button>
              <button id="cancel-photo-quality-button" class="button button-quiet" type="button" hidden>Stop and discard</button>
              <button id="download-photo-quality-report-button" class="button button-quiet" type="button" hidden>Download photo report</button>
            </div>
            <p class="field-help">The JSON report is capture-triage evidence only. Low edge energy can also occur in genuinely textureless scenes, so every blur warning still needs a human look at the untouched original.</p>
          </section>

          <section id="captured-quality-comparison" class="captured-quality-workbench" aria-labelledby="captured-quality-heading" hidden>
            <div class="section-row captured-quality-head">
              <div>
                <p class="section-label">Reception captured-quality comparison</p>
                <h3 id="captured-quality-heading">Compare the exact Quality and Mobile room captures</h3>
              </div>
              <span class="authority-badge">Local regression check · authority none</span>
            </div>
            <p>This opens the real Living Hall renderer on this computer, checks four frozen SOG files and four frozen SPZ files, then captures the same six camera views twice. It reports repeatability and pixel differences; it does not choose which room is physically truer.</p>
            <dl class="captured-quality-boundaries" aria-label="Captured-quality comparison boundaries">
              <div><dt>Candidate files</dt><dd>8 exact local files</dd></div>
              <div><dt>Fixed views</dt><dd>6 × 2 candidates × 2 repeats</dd></div>
              <div><dt>Declared external requests</dt><dd>0</dd></div>
              <div><dt>Winner</dt><dd>Not selected</dd></div>
            </dl>
            <div id="captured-quality-status" class="captured-quality-status" data-state="ready" role="status" aria-live="polite" aria-atomic="true">
              <div>
                <strong id="captured-quality-status-heading">Ready for the local comparison</strong>
                <p id="captured-quality-status-copy">Nothing has run yet.</p>
              </div>
              <div class="captured-quality-meter" aria-hidden="true"><span id="captured-quality-meter-bar"></span></div>
            </div>
            <dl id="captured-quality-result-facts" class="captured-quality-result-facts" hidden>
              <div><dt>Views</dt><dd id="captured-quality-view-count">—</dd></div>
              <div><dt>Captures</dt><dd id="captured-quality-capture-count">—</dd></div>
              <div><dt>Source check</dt><dd id="captured-quality-source-integrity">—</dd></div>
              <div><dt>Winner</dt><dd id="captured-quality-winner">Not selected</dd></div>
              <div class="captured-quality-wide-fact"><dt>Report fingerprint</dt><dd id="captured-quality-report-sha">—</dd></div>
            </dl>
            <div id="captured-quality-error" class="error-panel" role="alert" tabindex="-1" hidden></div>
            <div class="guided-actions">
              <button id="start-captured-quality-button" class="button button-primary" type="button">Run local comparison</button>
              <button id="cancel-captured-quality-button" class="button button-quiet" type="button" hidden>Stop and discard</button>
              <button id="download-captured-quality-report-button" class="button button-quiet" type="button" hidden>Download comparison report</button>
            </div>
            <p class="field-help">The completed JSON is regression-triage evidence only. It does not establish metric accuracy, usage rights, release permission, or product acceptance. The image bundle remains in the trusted local output folder chosen when this app was started.</p>
          </section>

          <section id="offline-normalization-preview" class="offline-preview-workbench" aria-labelledby="offline-preview-heading" hidden>
            <div class="section-row offline-preview-head">
              <div>
                <p class="section-label">Optional offline GLB format preview</p>
                <h3 id="offline-preview-heading">Repack one supported GLB without changing its decoded geometry</h3>
              </div>
              <span class="authority-badge">Private preview · authority none</span>
            </div>
            <p>This preview changes storage format only. It adds no detail or accuracy, does not reconstruct anything, and does not make a file ready for production.</p>
            <div class="plain-warning offline-preview-warning">
              <strong>Trusted source only — this helper thread is not a security sandbox.</strong>
              <p>The helper thread runs as your Windows user. The 64 MiB byte caps and V8 heap settings are not a whole-process memory limit. The app also cannot prove that a drive-letter path is not mapped or cloud-backed, so Windows could still fetch source bytes. Use it only with a source you trust on a disk you have independently confirmed is local. A separate signed, short-lived permit must match the exact source and operation. Clicking Request preview sends only opaque references; it does not record a new operator statement, approve rights, or issue a permit.</p>
            </div>
            <dl class="offline-preview-boundaries" aria-label="Offline preview boundaries">
              <div><dt>Production execution</dt><dd>Disabled</dd></div>
              <div><dt>Authority</dt><dd>None</dd></div>
              <div><dt>Server persistence</dt><dd>None</dd></div>
              <div><dt>App-held result</dt><dd>Session memory copy only</dd></div>
              <div><dt>Source</dt><dd>Trusted source only</dd></div>
              <div><dt>Local-disk proof</dt><dd>Not established</dd></div>
              <div><dt>Security sandbox</dt><dd>Not established</dd></div>
            </dl>
            <div id="offline-preview-status" class="offline-preview-status" data-state="blocked" role="status" aria-live="polite" aria-atomic="true">
              <strong id="offline-preview-status-heading">Checking whether this preview is available</strong>
              <p id="offline-preview-status-copy">Nothing has run.</p>
              <dl id="offline-preview-result-facts" class="offline-preview-result-facts" hidden>
                <div><dt>Source bytes</dt><dd id="offline-preview-source-size">Not available</dd></div>
                <div><dt>Preview bytes</dt><dd id="offline-preview-output-size">Not available</dd></div>
                <div><dt>Decoded geometry</dt><dd id="offline-preview-semantic-match">Not verified</dd></div>
                <div><dt>Preview fingerprint</dt><dd><code id="offline-preview-output-sha">Not available</code></dd></div>
                <div><dt>Canonical report digest</dt><dd><code id="offline-preview-report-sha">Not available</code></dd></div>
              </dl>
            </div>
            <div id="offline-preview-error" class="error-panel" role="alert" tabindex="-1" hidden></div>
            <div class="guided-actions offline-preview-actions">
              <button id="start-offline-preview-button" class="button button-primary" type="button" disabled>Request preview</button>
              <button id="cancel-offline-preview-button" class="button button-quiet" type="button" hidden>Stop and discard</button>
              <button id="download-offline-preview-output-button" class="button button-quiet" type="button" hidden>Download private GLB</button>
              <button id="download-offline-preview-report-button" class="button button-quiet" type="button" hidden>Download verification report</button>
            </div>
            <p id="offline-preview-download-warning" class="field-help">A download creates another private copy in your browser’s Downloads location, which may be cloud-synced. You control that downloaded copy. The app keeps its separate memory copy until the permit expires or this session stops.</p>
            <p class="field-help">The app deliberately writes no server output file and clears its buffers on a best-effort basis. This is not secure erasure: Windows paging, crash dumps, or other operating-system behaviour may leave additional copies.</p>
          </section>
        </div>
      </section>

      <footer class="boundary">
        <strong>This is an inspection surface, not an approval button.</strong>
        <p>This app can make review and plan drafts, then verify approved file fingerprints locally with authority “none.” Cloud contact, dispatch, reconstruction, training, legal approval, signing, and publishing are disabled.</p>
      </footer>
    </main>
    <noscript>This local app needs JavaScript to display the intake receipt. Foundry sends no data to an external service.</noscript>
  </body>
</html>`;

export const LOCAL_FOUNDRY_APP_CSS = String.raw`:root {
  color-scheme: dark;
  --ink: #0b1516;
  --ink-soft: #122526;
  --paper: #eeeae0;
  --paper-bright: #f7f4ed;
  --text: #f6f1e7;
  --muted: #a9bbb7;
  --paper-text: #152324;
  --paper-muted: #4f605d;
  --mint: #7ee0d1;
  --mint-deep: #236b64;
  --gold: #f0bd63;
  --danger: #d86d56;
  --rule: rgba(255, 255, 255, .12);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--ink);
  color: var(--text);
}

* { box-sizing: border-box; }
.sr-only { clip: rect(0 0 0 0); clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px; }
html { scroll-behavior: smooth; }
body { margin: 0; min-height: 100vh; }
button, input, select, table { font: inherit; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--mint-deep); outline-offset: 3px; }
.masthead a:focus-visible { outline-color: var(--mint); }
.skip-link { background: var(--paper-bright); color: var(--paper-text); left: 16px; padding: 12px 16px; position: fixed; top: -80px; z-index: 20; }
.skip-link:focus { top: 16px; }

body::before {
  background: radial-gradient(circle at 78% -10%, rgba(79, 189, 176, .24), transparent 34rem), linear-gradient(150deg, #0a1516, #132627 58%, #081112);
  content: "";
  inset: 0;
  position: fixed;
  z-index: -1;
}

.shell { margin: 0 auto; max-width: 1500px; padding: clamp(20px, 4vw, 64px); }
.masthead { align-items: center; display: flex; gap: 24px; justify-content: space-between; }
.brand { align-items: center; color: var(--text); display: inline-flex; font-size: .84rem; font-weight: 800; gap: 10px; letter-spacing: .01em; text-decoration: none; }
.brand-mark { align-items: center; background: var(--mint); border-radius: 8px; color: #0b2221; display: inline-flex; font-family: Georgia, serif; font-size: .76rem; height: 31px; justify-content: center; width: 31px; }
.trust-line { align-items: center; border: 1px solid rgba(126, 224, 209, .3); border-radius: 999px; color: var(--mint); display: flex; font-size: .72rem; font-weight: 800; gap: 8px; padding: 9px 12px; }
.trust-dot { background: var(--mint); border-radius: 50%; box-shadow: 0 0 0 4px rgba(126, 224, 209, .12); height: 7px; width: 7px; }

.intro { align-items: end; display: grid; gap: clamp(24px, 5vw, 72px); grid-template-columns: minmax(0, 1.55fr) minmax(240px, .45fr); margin: clamp(58px, 9vw, 118px) 0 38px; }
.intro h1 { font-family: Georgia, "Times New Roman", serif; font-size: clamp(2.65rem, 6vw, 6.1rem); font-weight: 500; letter-spacing: -.055em; line-height: .94; margin: 0; max-width: 1050px; }
.intro > div > p { color: var(--muted); font-size: clamp(1rem, 1.5vw, 1.2rem); line-height: 1.6; margin: 24px 0 0; max-width: 760px; }
.session-facts { border-top: 1px solid var(--rule); margin: 0; }
.session-facts div { border-bottom: 1px solid var(--rule); display: grid; gap: 9px; padding: 14px 0; }
.session-facts dt { color: var(--mint); font-size: .66rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.session-facts dd { color: var(--text); font-size: .82rem; margin: 0; overflow-wrap: anywhere; }

.workbench { background: var(--paper); border: 1px solid rgba(255, 255, 255, .35); border-radius: 22px; box-shadow: 0 28px 90px rgba(0, 0, 0, .34); color: var(--paper-text); overflow: hidden; padding: clamp(20px, 4vw, 46px); }
.status-head { align-items: start; display: flex; gap: 28px; justify-content: space-between; }
.section-label { color: #2f6963; font-size: .67rem; font-weight: 950; letter-spacing: .12em; margin: 0 0 7px; text-transform: uppercase; }
h2, h3 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; letter-spacing: -.035em; }
.status-head h2 { font-size: clamp(1.65rem, 3vw, 2.65rem); margin: 0; }
.status-head p:last-child { color: var(--paper-muted); line-height: 1.5; margin: 8px 0 0; max-width: 680px; }
.status-actions { display: flex; flex: 0 0 auto; gap: 8px; }
.handoff-download-help { color: var(--paper-muted); font-size: .78rem; line-height: 1.5; margin: 14px 0 0; max-width: 920px; }
.button { border-radius: 9px; cursor: pointer; font-size: .76rem; font-weight: 900; min-height: 44px; padding: 0 14px; transition: transform 150ms ease, opacity 150ms ease; }
.button:active { transform: scale(.975); }
.button:disabled { cursor: not-allowed; opacity: .46; }
.button-primary { background: #153d3c; border: 1px solid #153d3c; color: var(--paper-bright); }
.button-quiet { background: transparent; border: 1px solid #aab8b4; color: #344c4a; }
.button-danger { background: #7d2e25; border: 1px solid #7d2e25; color: #fff; }
.session-warning { background: #fff1cd; border: 1px solid #bd8623; border-radius: 10px; color: #5b3a00; font-weight: 800; line-height: 1.5; margin: 22px 0 0; padding: 12px 14px; }

.progress-track { background: #cfd7d3; border-radius: 999px; height: 6px; margin-top: 30px; overflow: hidden; }
.progress-track span { background: var(--mint-deep); display: block; height: 100%; transition: width 350ms cubic-bezier(.2, .8, .2, 1); width: 12%; }
.progress-track span[data-progress="16"] { width: 16%; }
.progress-track span[data-progress="20"] { width: 20%; }
.progress-track span[data-progress="46"] { width: 46%; }
.progress-track span[data-progress="72"] { width: 72%; }
.progress-track span[data-progress="92"] { width: 92%; }
.progress-track span[data-progress="100"] { width: 100%; }
.steps { display: grid; gap: 12px; grid-template-columns: repeat(5, 1fr); list-style: none; margin: 20px 0 0; padding: 0; }
.steps li { align-items: start; color: #596765; display: grid; gap: 10px; grid-template-columns: auto 1fr; }
.steps li > span { align-items: center; border: 1px solid #9eaaa7; border-radius: 50%; display: inline-flex; font-size: .68rem; font-weight: 900; height: 27px; justify-content: center; width: 27px; }
.steps strong { display: block; font-size: .78rem; }
.steps small { display: block; font-size: .68rem; line-height: 1.35; margin-top: 3px; }
.steps li[data-state="active"] { color: #153d3c; }
.steps li[data-state="active"] > span { background: var(--gold); border-color: var(--gold); color: #3c2a08; }
.steps li[data-state="done"] { color: var(--mint-deep); }
.steps li[data-state="done"] > span { background: var(--mint-deep); border-color: var(--mint-deep); color: white; }

.error-panel { background: #f5d9d2; border: 1px solid #dfa898; border-radius: 12px; color: #602a20; margin-top: 26px; overflow-wrap: anywhere; padding: 18px; }
.error-panel p { line-height: 1.5; margin: 5px 0 0; }

.metrics { border-bottom: 1px solid #cbd3d0; border-top: 1px solid #cbd3d0; display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 34px; }
.metrics div { border-right: 1px solid #cbd3d0; padding: 20px 18px; }
.metrics div:first-child { padding-left: 0; }
.metrics div:last-child { border-right: 0; }
.metrics strong { display: block; font-family: Georgia, serif; font-size: clamp(1.45rem, 2.7vw, 2.4rem); font-weight: 500; letter-spacing: -.03em; }
.metrics span { color: var(--paper-muted); display: block; font-size: .68rem; font-weight: 800; margin-top: 4px; }

.result-section { border-top: 1px solid #cbd3d0; margin-top: 34px; padding-top: 28px; }
.result-section.split { display: grid; gap: clamp(24px, 5vw, 70px); grid-template-columns: minmax(220px, .55fr) minmax(0, 1.45fr); }
.section-intro h3, .section-row h3 { font-size: clamp(1.45rem, 2.6vw, 2.2rem); margin: 0; }
.section-intro > p:last-child, .section-row > p { color: var(--paper-muted); font-size: .8rem; line-height: 1.5; margin: 10px 0 0; }
.section-row { align-items: end; display: flex; gap: 20px; justify-content: space-between; }
.section-row > p { margin: 0; text-align: right; }

.plain-list > div, .action-list > div { border-bottom: 1px solid #d6dcda; display: grid; gap: 14px; padding: 13px 0; }
.plain-list > div { grid-template-columns: minmax(0, 1fr) auto; }
.plain-list strong, .action-list strong { font-size: .82rem; }
.plain-list span { color: var(--mint-deep); font-size: .75rem; font-weight: 900; }
.action-list > div { grid-template-columns: minmax(150px, .45fr) minmax(0, 1.55fr); }
.action-list p { color: var(--paper-muted); font-size: .76rem; line-height: 1.5; margin: 0; }
.action-list strong span { color: #84601e; display: block; font-size: .66rem; margin-top: 4px; }

.duplicate-list { display: grid; gap: 10px; margin-top: 18px; }
.duplicate-group { background: rgba(18, 58, 57, .055); border: 1px solid #cbd5d1; border-radius: 11px; display: grid; gap: 12px; grid-template-columns: 170px minmax(0, 1fr); padding: 14px; }
.duplicate-group code { color: #315c58; font-size: .7rem; overflow-wrap: anywhere; }
.duplicate-group ul { margin: 0; padding-left: 19px; }
.duplicate-group li { font-size: .74rem; line-height: 1.55; overflow-wrap: anywhere; }

.table-wrap { border: 1px solid #c7d0cd; border-radius: 11px; margin-top: 18px; max-height: 620px; overflow: auto; }
table { border-collapse: collapse; font-size: .73rem; width: 100%; }
th { background: #dce2df; color: #526360; font-size: .64rem; letter-spacing: .07em; position: sticky; text-align: left; text-transform: uppercase; top: 0; z-index: 1; }
th, td { border-bottom: 1px solid #d3d9d7; padding: 11px 12px; vertical-align: top; }
td:first-child { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; min-width: 190px; overflow-wrap: anywhere; }
td:nth-child(2), td:nth-child(3) { white-space: nowrap; }
td:nth-child(4), td:nth-child(5) { color: var(--paper-muted); line-height: 1.45; min-width: 190px; }

.receipt-footer { align-items: start; border-top: 1px solid #cbd3d0; display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr) minmax(240px, .55fr); margin-top: 34px; padding-top: 22px; }
.receipt-footer span { color: var(--paper-muted); display: block; font-size: .65rem; font-weight: 900; letter-spacing: .08em; margin-bottom: 7px; text-transform: uppercase; }
.receipt-footer code { font-size: .72rem; overflow-wrap: anywhere; }
.receipt-footer p { color: var(--paper-muted); font-size: .72rem; line-height: 1.5; margin: 0; }

.local-hd-worker-readiness { border-top: 3px solid var(--gold); margin-top: 42px; min-width: 0; padding-top: 34px; }
.local-hd-worker-intro { color: var(--paper-muted); line-height: 1.55; max-width: 920px; }
.local-hd-worker-binding { margin-top: 18px; }
.local-hd-worker-binding p, .local-hd-worker-legacy p { margin-bottom: 0; }
.local-hd-worker-summary { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 20px 0 0; }
.local-hd-worker-summary div { background: rgba(18, 58, 57, .055); border: 1px solid #cad5d2; border-radius: 10px; min-width: 0; padding: 12px; }
.local-hd-worker-summary dt { color: #526763; font-size: .65rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.local-hd-worker-summary dd { color: var(--paper-text); font-size: .82rem; font-weight: 900; line-height: 1.4; margin: 5px 0 0; overflow-wrap: anywhere; }
.local-e57-environment { background: #f3f5ef; border: 1px solid #b9c8bd; border-left: 5px solid #527d72; border-radius: 14px; margin-top: 24px; min-width: 0; padding: 18px; }
.local-e57-head { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; }
.local-e57-head h4 { font-family: Georgia, serif; font-size: 1.2rem; font-weight: 500; margin: 0; }
.local-e57-intro { color: var(--paper-muted); font-size: .76rem; line-height: 1.55; margin: 10px 0 0; max-width: 920px; }
.local-e57-summary { display: grid; gap: 8px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 16px 0 0; }
.local-e57-summary div { background: var(--paper-bright); border: 1px solid #cbd5cf; border-radius: 9px; min-width: 0; padding: 10px; }
.local-e57-summary dt { color: #526763; font-size: .61rem; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
.local-e57-summary dd { font-size: .76rem; font-weight: 900; line-height: 1.4; margin: 4px 0 0; overflow-wrap: anywhere; }
.local-e57-boundary { margin-top: 14px; }
.local-e57-boundary p { margin-bottom: 0; }
.local-e57-columns { display: grid; gap: 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 18px; }
.local-e57-subhead { align-items: baseline; border-bottom: 1px solid #cbd5cf; display: flex; gap: 12px; justify-content: space-between; padding-bottom: 8px; }
.local-e57-subhead h5 { font-family: Georgia, serif; font-size: .98rem; font-weight: 500; margin: 0; }
.local-e57-subhead span { color: var(--paper-muted); font-size: .62rem; font-weight: 900; }
.local-e57-artifacts, .local-e57-open-items { display: grid; gap: 8px; margin-top: 10px; }
.local-e57-artifact, .local-e57-open-item { background: var(--paper-bright); border: 1px solid #ccd6d0; border-radius: 9px; min-width: 0; padding: 10px; }
.local-e57-artifact strong, .local-e57-open-item strong { display: block; font-size: .73rem; overflow-wrap: anywhere; }
.local-e57-artifact span, .local-e57-open-item p, .local-e57-open-item em { color: var(--paper-muted); display: block; font-size: .67rem; line-height: 1.45; margin-top: 4px; overflow-wrap: anywhere; }
.local-e57-artifact code { display: block; font-size: .61rem; margin-top: 5px; overflow-wrap: anywhere; white-space: normal; }
.local-e57-open-item em { color: #315c58; font-style: normal; font-weight: 900; }
.local-e57-next { background: #e2ebe5; border-radius: 9px; margin-top: 16px; padding: 12px; }
.local-e57-next strong { color: #315c58; font-size: .66rem; letter-spacing: .05em; text-transform: uppercase; }
.local-e57-next p { font-size: .73rem; line-height: 1.5; margin: 5px 0 0; }
.local-e57-footer { border-top: 1px solid #cbd5cf; margin-top: 15px; padding-top: 12px; }
.local-e57-footer span { color: var(--paper-muted); display: block; font-size: .61rem; font-weight: 900; letter-spacing: .07em; margin-bottom: 6px; text-transform: uppercase; }
.local-e57-footer code { display: block; font-size: .65rem; overflow-wrap: anywhere; white-space: normal; }
.local-hd-worker-subsection { border-top: 1px solid #cbd3d0; margin-top: 26px; padding-top: 22px; }
.local-hd-worker-subhead { align-items: baseline; display: flex; gap: 16px; justify-content: space-between; }
.local-hd-worker-subhead h4 { font-family: Georgia, serif; font-size: 1.25rem; font-weight: 500; margin: 0; }
.local-hd-worker-subhead span { color: var(--paper-muted); font-size: .68rem; font-weight: 900; }
.local-hd-worker-lanes, .local-hd-worker-components { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; }
.local-hd-worker-lane, .local-hd-worker-component { background: var(--paper-bright); border: 1px solid #bdcac6; border-radius: 12px; min-width: 0; padding: 15px; }
.local-hd-worker-lane[data-location="reviewed_remote_gpu_worker_only"] { border-left: 5px solid #9b7b34; }
.local-hd-worker-lane h5, .local-hd-worker-component h5 { font-family: Georgia, serif; font-size: 1rem; font-weight: 500; margin: 0; }
.local-hd-worker-lane p, .local-hd-worker-component p { color: var(--paper-muted); font-size: .72rem; line-height: 1.5; margin: 7px 0 0; overflow-wrap: anywhere; }
.local-hd-worker-lane strong { color: #315c58; display: block; font-size: .68rem; margin-top: 10px; }
.local-hd-worker-component dl { border-top: 1px solid #d4dcda; display: grid; gap: 7px; margin: 12px 0 0; padding-top: 10px; }
.local-hd-worker-component dl div { display: grid; gap: 6px; grid-template-columns: minmax(105px, .55fr) minmax(0, 1.45fr); }
.local-hd-worker-component dt, .local-hd-worker-component dd { color: var(--paper-muted); font-size: .68rem; line-height: 1.4; overflow-wrap: anywhere; }
.local-hd-worker-component dt { font-weight: 900; }
.local-hd-worker-component dd { margin: 0; }
.local-hd-worker-component code { font-size: .64rem; overflow-wrap: anywhere; white-space: normal; }
.local-hd-worker-exclusions { display: grid; gap: 0; margin-top: 12px; }
.local-hd-worker-exclusion { border-bottom: 1px solid #d4dcda; padding: 12px 0; }
.local-hd-worker-exclusion strong { display: block; font-size: .76rem; }
.local-hd-worker-exclusion p { color: var(--paper-muted); font-size: .72rem; line-height: 1.5; margin: 5px 0 0; }
.local-hd-worker-legacy { border-color: #b86c55; margin-top: 24px; }
.local-hd-worker-legacy code { font-size: .72rem; overflow-wrap: anywhere; }
.local-hd-worker-next { background: #e3ece8; border-radius: 11px; margin-top: 18px; padding: 15px; }
.local-hd-worker-next strong { color: #315c58; font-size: .7rem; letter-spacing: .06em; text-transform: uppercase; }
.local-hd-worker-next p { line-height: 1.5; margin: 6px 0 0; }
.local-hd-worker-footer { border-top: 1px solid #cbd3d0; margin-top: 22px; padding-top: 16px; }
.local-hd-worker-footer span { color: var(--paper-muted); display: block; font-size: .65rem; font-weight: 900; letter-spacing: .08em; margin-bottom: 7px; text-transform: uppercase; }
.local-hd-worker-footer code { display: block; font-size: .7rem; overflow-wrap: anywhere; white-space: normal; }

.source-facts-intro { color: var(--paper-muted); line-height: 1.55; max-width: 920px; }
.source-facts-summary { display: grid; gap: 10px; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 20px 0 0; }
.source-facts-summary div { background: rgba(18, 58, 57, .055); border: 1px solid #cad5d2; border-radius: 10px; min-width: 0; padding: 12px; }
.source-facts-summary dt { color: #526763; font-size: .65rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.source-facts-summary dd { font-family: Georgia, serif; font-size: 1.2rem; margin: 5px 0 0; }
.source-facts-list { display: grid; gap: 14px; margin-top: 20px; }
.source-fact-card { background: var(--paper-bright); border: 1px solid #b7c7c3; border-radius: 12px; min-width: 0; padding: 17px; }
.source-fact-card-head { align-items: flex-start; display: flex; gap: 14px; justify-content: space-between; }
.source-fact-card h4 { font-family: Georgia, serif; font-size: 1.08rem; font-weight: 500; margin: 0; overflow-wrap: anywhere; }
.source-fact-identity { color: var(--paper-muted); font-size: .7rem; line-height: 1.45; margin: 6px 0 0; overflow-wrap: anywhere; }
.source-fact-role-boundary { border-left: 2px solid #6f938c; color: #315c58; max-width: 76ch; padding-left: 9px; }
.source-fact-status { background: #d7ebe6; border-radius: 999px; color: #174e49; flex: 0 0 auto; font-size: .64rem; font-weight: 900; letter-spacing: .035em; padding: 6px 8px; text-transform: uppercase; }
.source-fact-status[data-state="facts_not_established"] { background: #f0dfbd; color: #684d18; }
.source-fact-columns { display: grid; gap: 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 15px; }
.source-fact-column { border-top: 1px solid #d2dcd9; min-width: 0; padding-top: 10px; }
.source-fact-column h5 { color: #506562; font-size: .66rem; letter-spacing: .055em; margin: 0; text-transform: uppercase; }
.source-fact-column dl { display: grid; gap: 7px; margin: 10px 0 0; }
.source-fact-column dl div { display: grid; gap: 5px; grid-template-columns: minmax(120px, .65fr) minmax(0, 1.35fr); }
.source-fact-column dt, .source-fact-column dd, .source-fact-column li { color: var(--paper-muted); font-size: .72rem; line-height: 1.45; overflow-wrap: anywhere; }
.source-fact-column dt { font-weight: 900; }
.source-fact-column dd { margin: 0; }
.source-fact-column ul { margin: 10px 0 0; padding-left: 18px; }
.source-fact-next-test { color: #315c58; display: block; font-weight: 800; margin-top: 4px; }
.source-fact-property-details { border-top: 1px solid #d2dcd9; margin-top: 14px; min-width: 0; padding-top: 11px; }
.source-fact-property-details summary { color: #315c58; cursor: pointer; font-size: .72rem; font-weight: 900; line-height: 1.4; overflow-wrap: anywhere; }
.source-fact-property-wrap { border: 1px solid #c7d0cd; border-radius: 9px; margin-top: 10px; max-height: 420px; overflow: auto; }
.source-fact-property-table { min-width: 620px; }
.source-fact-property-table th, .source-fact-property-table td { font-size: .68rem; padding: 8px 9px; }
.source-fact-property-table td:first-child { min-width: 54px; }
.source-fact-property-table td:nth-child(2) { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; min-width: 150px; overflow-wrap: anywhere; }
.source-facts-footer { align-items: center; border-top: 1px solid #cbd3d0; display: flex; gap: 18px; justify-content: space-between; margin-top: 20px; padding-top: 18px; }
.source-facts-footer span { color: var(--paper-muted); display: block; font-size: .65rem; font-weight: 900; letter-spacing: .08em; margin-bottom: 7px; text-transform: uppercase; }
.source-facts-footer code { font-size: .7rem; overflow-wrap: anywhere; }

.v7-inherited-heading { align-items: baseline; display: flex; gap: 12px; justify-content: space-between; margin-top: 24px; }
.v7-inherited-heading strong { color: #315c58; font-size: .76rem; letter-spacing: .055em; text-transform: uppercase; }
.v7-inherited-heading span { color: var(--paper-muted); font-size: .68rem; }
.potree-v7-section { border-top: 3px solid #4e827a; margin-top: 28px; min-width: 0; padding-top: 22px; }
.potree-v7-heading { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; }
.potree-v7-heading h4 { font-family: Georgia, serif; font-size: 1.28rem; font-weight: 500; margin: 0; }
.potree-v7-section > p { color: var(--paper-muted); font-size: .76rem; line-height: 1.55; margin: 10px 0 0; max-width: 94ch; }
.potree-bundle-list, .potree-refinement-list, .potree-evidence-list { display: grid; gap: 14px; margin-top: 18px; }
.potree-bundle-card, .potree-refinement-card, .potree-evidence-card { background: var(--paper-bright); border: 1px solid #b7c7c3; border-radius: 12px; min-width: 0; padding: 17px; }
.potree-bundle-card-head, .potree-refinement-card-head { align-items: flex-start; display: flex; gap: 14px; justify-content: space-between; }
.potree-bundle-card h5, .potree-refinement-card h5 { font-family: Georgia, serif; font-size: 1.08rem; font-weight: 500; margin: 0; overflow-wrap: anywhere; }
.potree-bundle-identity { color: var(--paper-muted); font-size: .68rem; line-height: 1.5; margin: 6px 0 0; overflow-wrap: anywhere; }
.potree-member-details, .potree-compatibility-details, .potree-unknown-details { border-top: 1px solid #d2dcd9; margin-top: 14px; min-width: 0; padding-top: 11px; }
.potree-member-details summary, .potree-compatibility-details summary, .potree-unknown-details summary { color: #315c58; cursor: pointer; font-size: .73rem; font-weight: 900; line-height: 1.45; }
.potree-member-list, .potree-compatibility-list, .potree-unknown-list, .potree-supersession-list { display: grid; gap: 8px; list-style: none; margin: 11px 0 0; padding: 0; }
.potree-member-list li, .potree-compatibility-list li, .potree-unknown-list li, .potree-supersession-list li { background: #f4f1e9; color: var(--paper-muted); font-size: .71rem; line-height: 1.5; min-width: 0; padding: 10px 11px; }
.potree-member-list strong, .potree-unknown-list strong { color: #315c58; display: block; font-size: .67rem; letter-spacing: .04em; text-transform: uppercase; }
.potree-member-list code, .potree-supersession-list code { display: block; font-size: .69rem; margin-top: 4px; overflow-wrap: anywhere; white-space: normal; }
.potree-member-list span, .potree-unknown-list span { display: block; margin-top: 4px; overflow-wrap: anywhere; }
.potree-structural-facts { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 15px 0 0; }
.potree-structural-facts div { background: rgba(18, 58, 57, .045); min-width: 0; padding: 9px 10px; }
.potree-structural-facts dt { color: #526763; font-size: .62rem; font-weight: 900; letter-spacing: .045em; text-transform: uppercase; }
.potree-structural-facts dd { font-size: .75rem; font-weight: 800; margin: 4px 0 0; overflow-wrap: anywhere; }
.potree-refinement-card > p, .potree-evidence-card > p { color: var(--paper-muted); font-size: .74rem; line-height: 1.5; margin: 10px 0 0; }
.potree-evidence-card .evidence-request-panel { margin-top: 12px; }

.point-value-diagnostic { border-top: 4px solid #2f766c; min-width: 0; }
.point-value-diagnostic-head { align-items: flex-start; }
.point-value-diagnostic-intro { color: var(--paper-muted); line-height: 1.6; max-width: 980px; }
.point-value-diagnostic-intro code { background: #edf3f1; color: #315c58; padding: 2px 5px; }
.point-value-summary { display: grid; gap: 10px; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 22px 0 0; }
.point-value-summary div { border-left: 3px solid #4e827a; min-width: 0; padding: 5px 12px; }
.point-value-summary dt { color: #526763; font-size: .64rem; font-weight: 900; letter-spacing: .055em; text-transform: uppercase; }
.point-value-summary dd { font-family: Georgia, serif; font-size: 1.16rem; margin: 5px 0 0; overflow-wrap: anywhere; }
.point-value-warning { border-left: 5px solid #b3842f; }
.point-value-warning ul { margin: 10px 0 0; padding-left: 19px; }
.point-value-warning li { color: #685a3b; font-size: .74rem; line-height: 1.5; }
.point-value-workbench { align-items: start; display: grid; gap: 22px; grid-template-columns: minmax(230px, .62fr) minmax(0, 1.38fr); margin-top: 24px; }
.point-value-controls { background: #edf3f1; border: 1px solid #b7c7c3; border-radius: 12px; display: grid; gap: 17px; padding: 17px; }
.point-value-bundle-control { color: #315c58; display: grid; font-size: .7rem; font-weight: 900; gap: 7px; letter-spacing: .045em; text-transform: uppercase; }
.point-value-bundle-control select { background: var(--paper-bright); border: 1px solid #96aaa5; border-radius: 8px; color: var(--paper-text); min-height: 42px; padding: 8px 10px; width: 100%; }
.point-value-controls fieldset { border: 0; border-top: 1px solid #c3d1ce; display: grid; gap: 8px; margin: 0; padding: 14px 0 0; }
.point-value-controls legend { color: #526763; font-size: .67rem; font-weight: 900; letter-spacing: .05em; padding: 0 0 8px; text-transform: uppercase; }
.point-value-controls fieldset label { align-items: center; background: rgba(255, 255, 255, .58); border: 1px solid transparent; border-radius: 8px; color: #315c58; cursor: pointer; display: flex; font-size: .76rem; font-weight: 800; gap: 8px; min-height: 38px; padding: 8px 10px; }
.point-value-controls fieldset label:has(input:checked) { background: #d7ebe6; border-color: #8fbcb3; color: #174e49; }
.point-value-controls input[type="radio"] { accent-color: #2f766c; }
.point-value-zoom-control { border-top: 1px solid #c3d1ce; display: grid; gap: 9px; padding-top: 14px; }
.point-value-zoom-control label { color: #526763; display: flex; font-size: .7rem; font-weight: 900; justify-content: space-between; text-transform: uppercase; }
.point-value-zoom-control input { accent-color: #2f766c; width: 100%; }
.point-value-zoom-control .button { min-height: 38px; padding: 8px 11px; }
.point-value-figure { margin: 0; min-width: 0; }
.point-value-image-viewport { background: #071f1a; border: 1px solid #244f49; border-radius: 12px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); max-height: min(72vh, 880px); min-height: 360px; overflow: auto; position: relative; }
.point-value-image-viewport:focus-visible { outline: 3px solid var(--mint-deep); outline-offset: 3px; }
.point-value-image-stage { aspect-ratio: 1; min-width: 100%; position: relative; width: 100%; }
.point-value-image { display: block; height: 100%; image-rendering: auto; max-width: none; object-fit: fill; width: 100%; }
.point-value-image:not([src]) { visibility: hidden; }
.room-envelope-overlay { cursor: crosshair; height: 100%; inset: 0; position: absolute; touch-action: manipulation; width: 100%; }
.room-envelope-overlay[data-enabled="false"] { cursor: default; pointer-events: none; }
.room-envelope-review { background: #f6f8f5; border: 1px solid #b9c9c4; border-radius: 14px; margin-top: 24px; padding: 20px; }
.room-envelope-review-head { align-items: flex-start; display: flex; gap: 18px; justify-content: space-between; }
.room-envelope-review-head h4 { font-family: Georgia, serif; font-size: 1.42rem; margin: 4px 0 0; }
.room-envelope-review-intro { color: var(--paper-muted); line-height: 1.6; margin: 13px 0; max-width: 980px; }
.room-envelope-review-status { background: #e7efec; border-left: 4px solid #4e827a; color: #315c58; font-size: .76rem; line-height: 1.5; margin: 16px 0 0; padding: 10px 12px; }
.room-envelope-review-grid { align-items: start; display: grid; gap: 22px; grid-template-columns: minmax(225px, .65fr) minmax(0, 1.35fr); margin-top: 20px; }
.room-envelope-review-evidence { background: #edf3f1; border: 1px solid #c0cfcb; border-radius: 11px; display: grid; gap: 13px; padding: 16px; }
.room-envelope-review h5 { color: #315c58; font-size: .69rem; letter-spacing: .055em; margin: 0; text-transform: uppercase; }
.room-envelope-preview-visits { display: grid; gap: 7px; list-style: none; margin: 0; padding: 0; }
.room-envelope-preview-visits li { align-items: center; background: rgba(255,255,255,.7); border: 1px solid #cedbd7; border-radius: 8px; display: flex; font-size: .72rem; gap: 12px; justify-content: space-between; padding: 9px 10px; }
.room-envelope-preview-visits strong { color: #775d2e; font-size: .65rem; text-align: right; }
.room-envelope-preview-visits strong[data-reviewed="true"] { color: #176156; }
.room-envelope-review label { color: #315c58; display: grid; font-size: .68rem; font-weight: 900; gap: 6px; letter-spacing: .035em; text-transform: uppercase; }
.room-envelope-review input, .room-envelope-review select, .room-envelope-review textarea { background: var(--paper-bright); border: 1px solid #96aaa5; border-radius: 8px; color: var(--paper-text); font: 700 .78rem/1.4 Arial, sans-serif; min-height: 42px; padding: 9px 10px; text-transform: none; width: 100%; }
.room-envelope-review textarea { min-height: 82px; resize: vertical; }
.room-envelope-review-form { display: grid; gap: 15px; }
.room-envelope-identity-fields { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.room-envelope-coordinate-entry { align-items: end; border: 0; border-top: 1px solid #c5d1ce; display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(90px, 1fr)) auto; margin: 0; padding: 14px 0 0; }
.room-envelope-coordinate-entry legend { color: #526763; font-size: .68rem; font-weight: 900; letter-spacing: .04em; padding: 0 0 8px; text-transform: uppercase; }
.room-envelope-coordinate-entry .button { min-height: 42px; }
.room-envelope-vertex-head { align-items: center; display: flex; justify-content: space-between; }
.room-envelope-vertex-head span { color: var(--paper-muted); font-size: .68rem; font-weight: 800; }
.room-envelope-vertex-list { background: var(--paper-bright); border: 1px solid #c7d2cf; border-radius: 9px; display: grid; gap: 1px; margin: 0; max-height: 220px; min-height: 48px; overflow: auto; padding: 7px 7px 7px 35px; }
.room-envelope-vertex-list:empty::before { color: var(--paper-muted); content: "No vertices yet. Click the preview or use X and Y above."; font-size: .72rem; grid-column: 1; list-style: none; padding: 8px 4px; }
.room-envelope-vertex-list li { align-items: center; color: #315c58; display: flex; font: 800 .72rem/1.3 Arial, sans-serif; justify-content: space-between; padding: 4px; }
.room-envelope-vertex-list button { background: transparent; border: 0; color: #775d2e; cursor: pointer; font: 900 .66rem/1 Arial, sans-serif; padding: 7px; text-decoration: underline; }
.room-envelope-vertex-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.room-envelope-vertex-actions .button { min-height: 38px; padding: 8px 11px; }
.room-envelope-polygon-help { color: var(--paper-muted); font-size: .72rem; line-height: 1.5; margin: 0; }
.room-envelope-review-error { margin: 0; }
.room-envelope-review-result { border-top: 1px solid #c5d1ce; margin-top: 22px; padding-top: 18px; }
.room-envelope-review-result dl { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; }
.room-envelope-review-result dl div { border-left: 3px solid #4e827a; padding: 5px 11px; }
.room-envelope-review-result dt { color: #526763; font-size: .63rem; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
.room-envelope-review-result dd { font-family: Georgia, serif; font-size: 1rem; margin: 5px 0 0; overflow-wrap: anywhere; }
.room-envelope-result-footer { align-items: center; display: flex; gap: 18px; justify-content: space-between; margin-top: 16px; }
.room-envelope-result-footer span { color: var(--paper-muted); display: block; font-size: .63rem; font-weight: 900; letter-spacing: .06em; margin-bottom: 5px; text-transform: uppercase; }
.room-envelope-result-footer code { display: block; font-size: .7rem; overflow-wrap: anywhere; }
.point-value-figure figcaption { color: var(--paper-muted); font-size: .72rem; line-height: 1.55; margin-top: 10px; }
.point-value-facts { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 22px; }
.point-value-fact-card { background: var(--paper-bright); border: 1px solid #c1ceca; border-radius: 10px; min-width: 0; padding: 14px; }
.point-value-fact-card h4 { color: #315c58; font-size: .67rem; letter-spacing: .05em; margin: 0; text-transform: uppercase; }
.point-value-fact-card p { color: var(--paper-muted); font-size: .73rem; line-height: 1.55; margin: 8px 0 0; overflow-wrap: anywhere; }
.point-value-fact-card strong { color: var(--paper-text); }
.point-value-boundary-details { border-top: 1px solid #cbd3d0; margin-top: 22px; padding-top: 14px; }
.point-value-boundary-details summary { color: #315c58; cursor: pointer; font-size: .76rem; font-weight: 900; }
.point-value-boundary-details ul { display: grid; gap: 8px; margin: 12px 0 0; padding-left: 20px; }
.point-value-boundary-details li { color: var(--paper-muted); font-size: .72rem; line-height: 1.5; overflow-wrap: anywhere; }
.point-value-footer { align-items: center; border-top: 1px solid #cbd3d0; display: grid; gap: 14px 20px; grid-template-columns: minmax(220px, .8fr) minmax(180px, .7fr) minmax(300px, 1.5fr); margin-top: 22px; padding-top: 18px; }
.point-value-footer span { color: var(--paper-muted); display: block; font-size: .65rem; font-weight: 900; letter-spacing: .08em; margin-bottom: 7px; text-transform: uppercase; }
.point-value-footer code { display: block; font-size: .7rem; overflow-wrap: anywhere; }
.point-value-download-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.point-value-download-actions .button { min-height: 40px; padding: 9px 12px; }

.source-readiness { min-width: 0; }
.source-readiness-intro { color: var(--paper-muted); line-height: 1.55; max-width: 920px; }
.source-readiness-summary { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 20px 0 0; }
.source-readiness-summary div { border-left: 3px solid #80a59e; min-width: 0; padding: 5px 12px; }
.source-readiness-summary dt { color: #526763; font-size: .65rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.source-readiness-summary dd { font-family: Georgia, serif; font-size: 1.2rem; margin: 5px 0 0; overflow-wrap: anywhere; }
.source-readiness-blocker ul { margin: 12px 0 0; padding-left: 19px; }
.source-readiness-blocker li { font-size: .74rem; line-height: 1.55; overflow-wrap: anywhere; }
.source-readiness-lanes { border-top: 1px solid #cbd3d0; margin-top: 22px; }
.source-readiness-lane { border-bottom: 1px solid #cbd3d0; min-width: 0; padding: 20px 0; }
.readiness-lane-head { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; min-width: 0; }
.readiness-lane-head > div { min-width: 0; }
.readiness-lane-head h4 { font-family: Georgia, serif; font-size: 1.16rem; font-weight: 500; margin: 0; overflow-wrap: anywhere; }
.readiness-lane-meaning { color: var(--paper-muted); font-size: .77rem; line-height: 1.5; margin: 7px 0 0; }
.readiness-status { background: #d7ebe6; border-radius: 999px; color: #174e49; flex: 0 0 auto; font-size: .64rem; font-weight: 900; letter-spacing: .035em; max-width: 100%; padding: 6px 9px; text-align: center; text-transform: uppercase; white-space: normal; }
.readiness-status[data-state="evidence_incomplete"] { background: #f0dfbd; color: #684d18; }
.readiness-status[data-state="no_source_observed"] { background: #e3e7e5; color: #52605d; }
.readiness-status[data-state="blocked"] { background: #f0d6cf; color: #672f24; }
.readiness-reason-code { color: #526763; display: block; font-size: .68rem; margin-top: 9px; overflow-wrap: anywhere; }
.readiness-counts { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 15px 0 0; }
.readiness-counts div { background: rgba(18, 58, 57, .045); min-width: 0; padding: 9px 10px; }
.readiness-counts dt { color: #526763; font-size: .62rem; font-weight: 900; letter-spacing: .045em; text-transform: uppercase; }
.readiness-counts dd { font-size: .76rem; font-weight: 800; margin: 4px 0 0; overflow-wrap: anywhere; }
.readiness-details { border-top: 1px solid #d7dddb; margin-top: 14px; min-width: 0; padding-top: 11px; }
.readiness-details summary { color: #315c58; cursor: pointer; font-size: .73rem; font-weight: 900; line-height: 1.4; overflow-wrap: anywhere; }
.readiness-source-list, .readiness-gap-list, .readiness-next-tests { display: grid; gap: 9px; list-style: none; margin: 11px 0 0; padding: 0; }
.readiness-source-list li, .readiness-gap-list > li { background: #f4f1e9; min-width: 0; padding: 10px 11px; }
.readiness-source-list code, .readiness-gap-paths code { display: block; font-size: .69rem; overflow-wrap: anywhere; white-space: normal; }
.readiness-source-list span { color: var(--paper-muted); display: block; font-size: .67rem; line-height: 1.45; margin-top: 4px; overflow-wrap: anywhere; }
.readiness-gap-list strong { color: var(--paper-ink); display: block; font-size: .78rem; }
.readiness-gap-list p { color: var(--paper-muted); font-size: .72rem; line-height: 1.5; margin: 5px 0 0; }
.readiness-gap-next { color: #315c58; display: block; font-size: .72rem; font-weight: 900; line-height: 1.45; margin-top: 7px; }
.readiness-gap-paths { margin-top: 8px; }
.readiness-gap-paths ul { display: grid; gap: 5px; margin: 7px 0 0; padding-left: 18px; }
.readiness-next { background: #edf3f1; border-left: 3px solid #4e827a; margin-top: 15px; min-width: 0; padding: 12px 13px; }
.readiness-next > strong { color: #315c58; display: block; font-size: .72rem; letter-spacing: .035em; text-transform: uppercase; }
.readiness-next-tests li { color: var(--paper-muted); font-size: .73rem; line-height: 1.5; overflow-wrap: anywhere; }
.source-readiness-footer { align-items: center; border-top: 1px solid #cbd3d0; display: flex; gap: 18px; justify-content: space-between; margin-top: 20px; min-width: 0; padding-top: 18px; }
.source-readiness-footer span { color: var(--paper-muted); display: block; font-size: .65rem; font-weight: 900; letter-spacing: .08em; margin-bottom: 7px; text-transform: uppercase; }
.source-readiness-footer code { display: block; font-size: .7rem; max-width: 100%; overflow-wrap: anywhere; white-space: normal; }

.operator-evidence-checklist { min-width: 0; }
.operator-evidence-intro { color: var(--paper-muted); line-height: 1.55; max-width: 940px; }
.operator-evidence-summary { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 20px 0 0; }
.operator-evidence-summary div { border-left: 3px solid #80a59e; min-width: 0; padding: 5px 12px; }
.operator-evidence-summary dt { color: #526763; font-size: .65rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.operator-evidence-summary dd { font-family: Georgia, serif; font-size: 1.2rem; margin: 5px 0 0; overflow-wrap: anywhere; }
.operator-evidence-blocker > p { color: #685a3b; }
.operator-evidence-blocker .evidence-request-panel { background: rgba(255, 255, 255, .42); }
.operator-evidence-groups { border-top: 1px solid #cbd3d0; margin-top: 22px; }
.operator-evidence-group { border-bottom: 1px solid #cbd3d0; min-width: 0; padding: 22px 0; }
.operator-evidence-group-head, .operator-evidence-item-head { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; min-width: 0; }
.operator-evidence-group-head > div, .operator-evidence-item-head > div { min-width: 0; }
.operator-evidence-group-head h4 { font-family: Georgia, serif; font-size: 1.22rem; font-weight: 500; margin: 0; overflow-wrap: anywhere; }
.operator-evidence-group-head p { color: var(--paper-muted); font-size: .77rem; line-height: 1.5; margin: 7px 0 0; }
.evidence-priority { background: #e3e7e5; border-radius: 999px; color: #52605d; flex: 0 0 auto; font-size: .63rem; font-weight: 900; letter-spacing: .035em; max-width: 100%; padding: 6px 9px; text-align: center; text-transform: uppercase; white-space: normal; }
.evidence-priority[data-priority="blocking"] { background: #f0d6cf; color: #672f24; }
.evidence-priority[data-priority="high"] { background: #f0dfbd; color: #684d18; }
.evidence-priority[data-priority="normal"] { background: #d7ebe6; color: #174e49; }
.evidence-priority[data-priority="conditional"] { background: #e3e7e5; color: #52605d; }
.operator-evidence-items { display: grid; gap: 0; margin-top: 15px; }
.operator-evidence-item { border-top: 1px solid #d7dddb; min-width: 0; padding: 18px 0; }
.operator-evidence-item h5 { font-family: Georgia, serif; font-size: 1.05rem; font-weight: 500; margin: 0; overflow-wrap: anywhere; }
.operator-evidence-meta { color: #526763; display: block; font-size: .67rem; line-height: 1.5; margin-top: 7px; overflow-wrap: anywhere; }
.operator-evidence-reason { color: var(--paper-muted); font-size: .76rem; line-height: 1.55; margin: 12px 0 0; }
.evidence-request-panel { background: #edf3f1; border-left: 3px solid #4e827a; margin-top: 13px; min-width: 0; padding: 12px 13px; }
.evidence-request-panel strong, .evidence-completion strong { color: #315c58; display: block; font-size: .69rem; letter-spacing: .04em; text-transform: uppercase; }
.evidence-request-panel p, .evidence-completion li, .evidence-completion-limits { color: var(--paper-muted); font-size: .73rem; line-height: 1.5; overflow-wrap: anywhere; }
.evidence-request-panel p { margin: 6px 0 0; }
.evidence-completion { margin-top: 14px; }
.evidence-completion ol { display: grid; gap: 6px; margin: 9px 0 0; padding-left: 20px; }
.evidence-completion-limits { border-left: 2px solid #c9d5d1; margin: 12px 0 0; padding-left: 11px; }
.evidence-lanes { color: #526763; display: block; font-size: .69rem; line-height: 1.5; margin-top: 12px; overflow-wrap: anywhere; }
.evidence-no-source { background: #f4f1e9; color: #52605d; font-size: .72rem; line-height: 1.5; margin: 13px 0 0; padding: 10px 11px; }
.evidence-source-details { border-top: 1px solid #d7dddb; margin-top: 14px; min-width: 0; padding-top: 11px; }
.evidence-source-details summary { color: #315c58; cursor: pointer; font-size: .73rem; font-weight: 900; line-height: 1.4; overflow-wrap: anywhere; }
.evidence-source-list { display: grid; gap: 9px; list-style: none; margin: 11px 0 0; padding: 0; }
.evidence-source-list li { background: #f4f1e9; min-width: 0; padding: 10px 11px; }
.evidence-source-list code { display: block; font-size: .69rem; overflow-wrap: anywhere; white-space: normal; }
.evidence-source-list span { color: var(--paper-muted); display: block; font-size: .67rem; line-height: 1.45; margin-top: 4px; overflow-wrap: anywhere; }
.operator-evidence-footer { align-items: center; border-top: 1px solid #cbd3d0; display: flex; gap: 18px; justify-content: space-between; margin-top: 20px; min-width: 0; padding-top: 18px; }
.operator-evidence-footer span { color: var(--paper-muted); display: block; font-size: .65rem; font-weight: 900; letter-spacing: .08em; margin-bottom: 7px; text-transform: uppercase; }
.operator-evidence-footer code { display: block; font-size: .7rem; max-width: 100%; overflow-wrap: anywhere; white-space: normal; }
.operator-evidence-download-status { color: var(--paper-muted); flex: 1 1 240px; font-size: .7rem; line-height: 1.45; margin: 0; min-width: 0; overflow-wrap: anywhere; }

.guided-workflow { border-top: 3px solid var(--mint-deep); margin-top: 42px; padding-top: 34px; }
.authority-badge { align-items: center; background: #d7ebe6; border: 1px solid #a7ccc4; border-radius: 999px; color: #174e49; display: inline-flex; font-size: .74rem; font-weight: 900; min-height: 36px; padding: 7px 12px; }
.plain-warning, .truth-boundary { background: #fff7e5; border: 1px solid #dfc68f; border-radius: 12px; margin-top: 20px; padding: 17px 18px; }
.plain-warning strong, .truth-boundary strong { color: #65480e; display: block; font-size: .9rem; }
.plain-warning p, .truth-boundary p { color: #685a3b; line-height: 1.55; margin: 6px 0 0; }
.form-card { border: 1px solid #c3ceca; border-radius: 13px; margin: 24px 0 0; padding: 20px; }
.form-card legend { font-family: Georgia, serif; font-size: 1.18rem; padding: 0 8px; }
.form-grid { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.form-card label { color: #304a48; display: grid; font-size: .85rem; font-weight: 800; gap: 7px; }
.form-card input:not([type="checkbox"]), .form-card select, .decision-card select { background: var(--paper-bright); border: 1px solid #96aaa5; border-radius: 8px; color: var(--paper-text); min-height: 46px; padding: 9px 11px; width: 100%; }
.field-help { color: var(--paper-muted); font-size: .78rem; line-height: 1.5; margin: 14px 0 0; }
.decision-heading { align-items: end; display: flex; gap: 24px; justify-content: space-between; margin-top: 32px; }
.decision-heading h4, .draft-result h4 { font-family: Georgia, serif; font-size: 1.45rem; font-weight: 500; margin: 0; }
.decision-heading p { color: var(--paper-muted); font-size: .78rem; line-height: 1.45; margin: 5px 0 0; }
.decision-list { display: grid; gap: 12px; margin-top: 16px; }
.decision-card { background: var(--paper-bright); border: 1px solid #c3ceca; border-radius: 12px; display: grid; gap: 16px; grid-template-columns: minmax(190px, 1.4fr) repeat(2, minmax(150px, .8fr)); padding: 17px; }
.decision-card[data-complete="true"] { border-color: #69a89f; box-shadow: inset 4px 0 0 #69a89f; }
.file-identity code { display: block; font-size: .8rem; overflow-wrap: anywhere; }
.file-identity span { color: var(--paper-muted); display: block; font-size: .76rem; margin-top: 7px; }
.decision-card label { color: #49605d; display: grid; font-size: .75rem; font-weight: 900; gap: 6px; }
.decision-note { color: #77591e; font-size: .76rem; grid-column: 1 / -1; line-height: 1.5; margin: -4px 0 0; }
.guided-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 20px; }
.draft-result { background: #e3efec; border: 1px solid #a9c9c2; border-radius: 14px; margin-top: 26px; padding: 22px; }
.draft-result h4:focus { border-radius: 4px; outline: 3px solid var(--mint-deep); outline-offset: 4px; }
.draft-result > div > p:last-child { color: #48615e; line-height: 1.5; }
.digest-list { display: grid; gap: 12px; margin: 18px 0 0; }
.digest-list div { border-top: 1px solid #bfd2ce; padding-top: 11px; }
.digest-list dt { color: #4b5f5c; font-size: .7rem; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; }
.digest-list dd { margin: 6px 0 0; overflow-wrap: anywhere; }
.digest-list code { font-size: .74rem; }
.verification-workbench { border-top: 1px solid #bac7c3; margin-top: 34px; padding-top: 32px; }
.verification-workbench > p { color: var(--paper-muted); line-height: 1.55; max-width: 850px; }
.verification-privacy { margin-top: 16px; }
.verification-status { background: var(--paper-bright); border: 1px solid #b9c9c5; border-radius: 13px; margin-top: 18px; padding: 18px; }
.verification-status strong { font-family: Georgia, serif; font-size: 1.2rem; font-weight: 500; }
.verification-status p { color: var(--paper-muted); line-height: 1.5; margin: 6px 0 0; }
.verification-meter { background: #d8dfdc; border-radius: 999px; height: 8px; margin-top: 17px; overflow: hidden; }
.verification-meter span { background: var(--mint-deep); display: block; height: 100%; transform: scaleX(0); transform-origin: left; transition: transform .2s ease; }
.verification-counts { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 18px 0 0; }
.verification-counts div { border-top: 1px solid #d1dad7; padding-top: 10px; }
.verification-counts dt { color: #526763; font-size: .67rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.verification-counts dd { font-size: .86rem; margin: 5px 0 0; }
.plan-workbench { border-top: 1px solid #bac7c3; margin-top: 34px; padding-top: 32px; }
.plan-workbench > p { color: var(--paper-muted); line-height: 1.55; max-width: 850px; }
.plan-options { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.plan-options legend { grid-column: 1 / -1; }
.check-label { align-items: center; display: grid !important; grid-template-columns: 22px 1fr; min-height: 44px; }
.check-label input { height: 20px; margin: 0; width: 20px; }
.plan-options small { color: var(--paper-muted); display: block; font-size: .76rem; font-weight: 500; line-height: 1.45; margin-top: 4px; }
.planning-gate { display: grid; gap: 9px; margin-top: 18px; }
.gate-item { background: #fff5df; border-left: 4px solid var(--gold); border-radius: 7px; padding: 13px 14px; }
.gate-item strong { display: block; font-size: .83rem; }
.gate-item p { color: #6e5c38; font-size: .78rem; line-height: 1.5; margin: 5px 0 0; }
.quality-decision-board { border-top: 1px solid #b8cbc7; margin-top: 22px; padding-top: 20px; }
.quality-decision-board h5 { color: var(--paper-text); font-family: Georgia, serif; font-size: 1.2rem; font-weight: 500; margin: 0; }
.quality-decision-board > div > p:last-child { color: var(--paper-muted); font-size: .78rem; line-height: 1.5; margin: 7px 0 0; }
.quality-board-list { display: grid; gap: 13px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; }
.quality-card { background: var(--paper-bright); border: 1px solid #b7c7c3; border-radius: 12px; min-width: 0; padding: 17px; }
.quality-card-head { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }
.quality-card h6 { color: var(--paper-text); font-family: Georgia, serif; font-size: 1.05rem; font-weight: 500; margin: 0; }
.quality-status { background: #e8ded0; border-radius: 999px; color: #68501c; flex: 0 0 auto; font-size: .65rem; font-weight: 900; letter-spacing: .035em; margin: 0; padding: 6px 8px; text-transform: uppercase; }
.quality-summary { color: var(--paper-muted); font-size: .75rem; line-height: 1.5; margin: 11px 0 0; }
.quality-details { display: grid; gap: 9px; margin: 14px 0 0; }
.quality-details div { border-top: 1px solid #d2dcd9; padding-top: 9px; }
.quality-details dt { color: #506562; font-size: .64rem; font-weight: 900; letter-spacing: .055em; text-transform: uppercase; }
.quality-details dd { color: var(--paper-muted); font-size: .74rem; line-height: 1.5; margin: 4px 0 0; }
.quality-card ul { margin: 8px 0 0; padding-left: 18px; }
.quality-card li { color: var(--paper-muted); font-size: .72rem; line-height: 1.45; }
.quality-evidence-list { display: grid; gap: 9px; list-style: none; padding-left: 0 !important; }
.quality-evidence-item { border-left: 3px solid #b9ccc7; padding-left: 9px; }
.quality-requirement-copy, .quality-evidence-state { display: block; }
.quality-evidence-state { color: #6d581f; font-size: .66rem; font-weight: 900; letter-spacing: .035em; margin-top: 3px; text-transform: uppercase; }
.quality-asset-disclosure { border-top: 1px solid #d2dcd9; margin-top: 11px; padding-top: 9px; }
.quality-asset-disclosure summary { color: #3e5d59; cursor: pointer; font-size: .7rem; font-weight: 900; }
.quality-asset-disclosure li { overflow-wrap: anywhere; }
.processing-outline { border-top: 1px solid #b8cbc7; margin-top: 22px; padding-top: 20px; }
.processing-outline h5 { color: var(--paper-ink); font-family: Georgia, serif; font-size: 1.15rem; font-weight: 500; margin: 0; }
.processing-outline > div > p:last-child { color: var(--paper-muted); font-size: .78rem; line-height: 1.5; margin: 7px 0 0; }
.outline-list { display: grid; gap: 11px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 15px; }
.outline-card { background: #f4f1e9; border: 1px solid #bdc9c6; border-radius: 11px; min-width: 0; padding: 15px; }
.outline-card h6 { color: var(--paper-ink); font-family: Georgia, serif; font-size: 1rem; font-weight: 500; margin: 0; }
.outline-card p, .outline-card li { color: var(--paper-muted); font-size: .74rem; line-height: 1.45; }
.outline-card ul { margin: 8px 0 0; padding-left: 18px; }
.route-list { display: grid; gap: 13px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 20px; }
.route-card { background: var(--paper-bright); border: 1px solid #bdc9c6; border-radius: 12px; min-width: 0; padding: 17px; }
.route-card h5 { font-family: Georgia, serif; font-size: 1.1rem; font-weight: 500; margin: 0; }
.route-card .route-status { color: #77591e; font-size: .77rem; font-weight: 900; margin: 8px 0; }
.route-card p, .route-card li { color: var(--paper-muted); font-size: .75rem; line-height: 1.45; }
.route-card ul { margin: 10px 0 0; padding-left: 19px; }
.route-card code { display: block; font-size: .68rem; margin-top: 9px; overflow-wrap: anywhere; }

.photo-quality-workbench { border-top: 3px solid #a85f38; margin-top: 42px; min-width: 0; padding-top: 34px; }
.photo-quality-workbench > p { color: var(--paper-muted); line-height: 1.55; max-width: 920px; }
.photo-quality-head { align-items: flex-start; }
.photo-quality-counts, .photo-quality-result-facts { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 20px 0 0; }
.photo-quality-counts div, .photo-quality-result-facts div { border-top: 1px solid #d6c6bd; min-width: 0; padding-top: 10px; }
.photo-quality-counts dt, .photo-quality-result-facts dt { color: #6d5c53; font-size: .67rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.photo-quality-counts dd, .photo-quality-result-facts dd { color: var(--paper-text); font-size: .9rem; margin: 5px 0 0; overflow-wrap: anywhere; }
.photo-quality-split-note { border-left: 4px solid #a85f38; margin-top: 20px; padding: 4px 0 4px 14px; }
.photo-quality-split-note strong { font-family: Georgia, serif; font-size: 1.05rem; font-weight: 500; }
.photo-quality-split-note p { color: var(--paper-muted); line-height: 1.5; margin: 5px 0 0; max-width: 850px; }
.photo-quality-assignments { border-bottom: 1px solid #d6c6bd; margin-top: 22px; max-height: 520px; overflow: auto; }
.photo-quality-assignment { align-items: center; border-top: 1px solid #d6c6bd; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr) minmax(150px, 190px); padding: 12px 2px; }
.photo-quality-assignment-copy { min-width: 0; }
.photo-quality-assignment-copy strong { display: block; font-size: .88rem; overflow-wrap: anywhere; }
.photo-quality-assignment-copy span { color: var(--paper-muted); display: block; font-size: .72rem; margin-top: 4px; }
.photo-quality-assignment label { color: #5f5149; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.photo-quality-assignment select { background: var(--paper-bright); border: 1px solid #bca99e; border-radius: 8px; color: var(--paper-text); display: block; font: 700 .82rem/1.2 Inter, system-ui, sans-serif; margin-top: 5px; padding: 9px 10px; width: 100%; }
.photo-quality-status { background: var(--paper-bright); border: 1px solid #cfbdb3; border-left: 5px solid #a85f38; border-radius: 13px; margin-top: 20px; padding: 18px; }
.photo-quality-status[data-state="unavailable"] { border-left-color: #8a8175; }
.photo-quality-status[data-state="running"] { border-left-color: #4679a3; }
.photo-quality-status[data-state="completed"] { border-left-color: #2f766c; }
.photo-quality-status[data-state="cancelled"] { border-left-color: #8a8175; }
.photo-quality-status[data-state="failed"] { border-left-color: #9d4939; }
.photo-quality-status strong { display: block; font-family: Georgia, serif; font-size: 1.2rem; font-weight: 500; }
.photo-quality-status p { color: var(--paper-muted); line-height: 1.5; margin: 6px 0 0; }
.photo-quality-meter { background: #e7ddd7; border-radius: 999px; height: 7px; margin-top: 14px; overflow: hidden; }
.photo-quality-meter span { background: #a85f38; display: block; height: 100%; transform: scaleX(0); transform-origin: left center; transition: transform 180ms ease-out; }
.photo-quality-results { margin-top: 24px; }
.photo-quality-results[hidden] { display: none; }
.photo-quality-readiness { color: #7a3d24; font: 800 .72rem/1.3 Inter, system-ui, sans-serif; letter-spacing: .05em; text-transform: uppercase; }
.photo-quality-result-facts .photo-quality-wide-fact { grid-column: 1 / -1; }
.photo-quality-result-facts code { font-size: .7rem; overflow-wrap: anywhere; white-space: normal; }
.photo-quality-contact-sheet { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 22px; }
.photo-quality-card { background: var(--paper-bright); border: 1px solid #d2c4bb; border-radius: 12px; min-width: 0; overflow: hidden; }
.photo-quality-card img, .photo-quality-image-fallback { aspect-ratio: 3 / 2; background: #2b2927; display: block; object-fit: cover; width: 100%; }
.photo-quality-image-fallback { align-items: center; color: #ded4ce; display: flex; font-size: .78rem; justify-content: center; padding: 18px; text-align: center; }
.photo-quality-card-copy { padding: 13px 14px 15px; }
.photo-quality-card-title { align-items: flex-start; display: flex; gap: 8px; justify-content: space-between; }
.photo-quality-card-title strong { font-size: .82rem; overflow-wrap: anywhere; }
.photo-quality-verdict { border-radius: 999px; flex: none; font-size: .62rem; font-weight: 900; letter-spacing: .04em; padding: 4px 7px; text-transform: uppercase; }
.photo-quality-verdict[data-verdict="pass"] { background: #dcebe5; color: #225d50; }
.photo-quality-verdict[data-verdict="review"] { background: #f2e6c8; color: #73551b; }
.photo-quality-verdict[data-verdict="retake"] { background: #f0d8d1; color: #873c2b; }
.photo-quality-card-meta { color: var(--paper-muted); font-size: .7rem; line-height: 1.45; margin: 8px 0 0; }
.photo-quality-issues { color: #594c45; font-size: .76rem; line-height: 1.45; margin: 10px 0 0; padding-left: 18px; }
.photo-quality-issues li + li { margin-top: 6px; }
.photo-quality-similarity { border-top: 1px solid #d6c6bd; margin-top: 24px; padding-top: 16px; }
.photo-quality-similarity h5 { font-family: Georgia, serif; font-size: 1.05rem; font-weight: 500; margin: 0; }
.photo-quality-similarity ul { color: var(--paper-muted); font-size: .8rem; line-height: 1.5; margin-bottom: 0; padding-left: 20px; }
.local-intake-workspace { border-top: 3px solid var(--mint-deep); min-width: 0; }
.local-intake-workspace-head { align-items: flex-start; }
.local-intake-workspace-intro { color: var(--paper-muted); line-height: 1.58; margin: 16px 0 0; max-width: 980px; }
.local-intake-workspace-boundaries { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 20px 0 0; }
.local-intake-workspace-boundaries div, .local-intake-workspace-progress-facts div, .local-intake-workspace-result-facts div, .local-intake-workspace-truth div { border-top: 1px solid #c6d1ce; min-width: 0; padding-top: 10px; }
.local-intake-workspace-boundaries dt, .local-intake-workspace-progress-facts dt, .local-intake-workspace-result-facts dt, .local-intake-workspace-truth dt { color: #526763; font-size: .67rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.local-intake-workspace-boundaries dd, .local-intake-workspace-progress-facts dd, .local-intake-workspace-result-facts dd, .local-intake-workspace-truth dd { color: var(--paper-text); font-size: .84rem; margin: 5px 0 0; overflow-wrap: anywhere; }
.local-intake-workspace-status { background: var(--paper-bright); border: 1px solid #b9c9c5; border-left: 5px solid #8a8175; border-radius: 13px; margin-top: 20px; padding: 18px; }
.local-intake-workspace-status[data-state="ready"] { border-left-color: var(--mint-deep); }
.local-intake-workspace-status[data-state="copying"], .local-intake-workspace-status[data-state="verifying"], .local-intake-workspace-status[data-state="deleting"] { border-left-color: #4679a3; }
.local-intake-workspace-status[data-state="stored"] { border-left-color: #2f766c; }
.local-intake-workspace-status[data-state="failed"] { border-left-color: #9d4939; }
.local-intake-workspace-status[data-state="deleted"] { border-left-color: #6d625d; }
.local-intake-workspace-status strong { display: block; font-family: Georgia, serif; font-size: 1.2rem; font-weight: 500; }
.local-intake-workspace-status strong:focus { border-radius: 4px; outline: 3px solid var(--mint-deep); outline-offset: 4px; }
.local-intake-workspace-status p { color: var(--paper-muted); line-height: 1.5; margin: 6px 0 0; }
.local-intake-workspace-meter { background: #dce5e2; border-radius: 999px; height: 7px; margin-top: 14px; overflow: hidden; }
.local-intake-workspace-meter span { background: var(--mint-deep); display: block; height: 100%; transform: scaleX(0); transform-origin: left center; transition: transform 180ms ease-out; }
.local-intake-workspace-progress-facts, .local-intake-workspace-result-facts { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 18px 0 0; }
.local-intake-workspace-progress-facts[hidden], .local-intake-workspace-result[hidden], .local-intake-workspace-delete[hidden] { display: none; }
.local-intake-workspace-wide-fact { grid-column: 1 / -1; }
.local-intake-workspace-result-facts code { font-size: .7rem; overflow-wrap: anywhere; white-space: normal; }
.local-intake-workspace-truth-heading { font-family: Georgia, serif; font-size: 1.05rem; font-weight: 500; margin: 24px 0 0; }
.local-intake-workspace-truth { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 14px 0 0; }
.local-intake-workspace-actions { align-items: center; }
.local-intake-workspace-delete { background: #f3dfda; border: 1px solid #d39c90; border-radius: 12px; color: #602a20; margin-top: 22px; padding: 16px; }
.local-intake-workspace-delete > strong { display: block; font-family: Georgia, serif; font-size: 1.08rem; font-weight: 500; }
.local-intake-workspace-delete > p { line-height: 1.5; margin: 6px 0 14px; }
.local-intake-workspace-delete-confirm { align-items: flex-start; display: flex; font-size: .78rem; font-weight: 800; gap: 9px; line-height: 1.45; margin-bottom: 14px; }
.local-intake-workspace-delete-confirm input { flex: none; height: 18px; margin: 1px 0 0; width: 18px; }
.prepared-hd-workbench, .captured-quality-workbench { border-top: 3px solid var(--mint-deep); margin-top: 42px; min-width: 0; padding-top: 34px; }
.prepared-hd-workbench > p, .captured-quality-workbench > p { color: var(--paper-muted); line-height: 1.55; max-width: 900px; }
.prepared-hd-head, .captured-quality-head { align-items: flex-start; }
.prepared-hd-boundaries, .captured-quality-boundaries { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 20px 0 0; }
.prepared-hd-boundaries div, .prepared-hd-result-facts div, .captured-quality-boundaries div, .captured-quality-result-facts div { border-top: 1px solid #c6d1ce; min-width: 0; padding-top: 10px; }
.prepared-hd-boundaries dt, .prepared-hd-result-facts dt, .captured-quality-boundaries dt, .captured-quality-result-facts dt { color: #526763; font-size: .67rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.prepared-hd-boundaries dd, .prepared-hd-result-facts dd, .captured-quality-boundaries dd, .captured-quality-result-facts dd { color: var(--paper-text); font-size: .84rem; margin: 5px 0 0; overflow-wrap: anywhere; }
.prepared-hd-status, .captured-quality-status { background: var(--paper-bright); border: 1px solid #b9c9c5; border-left: 5px solid var(--mint-deep); border-radius: 13px; margin-top: 20px; padding: 18px; }
.prepared-hd-status[data-state="unavailable"], .captured-quality-status[data-state="unavailable"] { border-left-color: #8a8175; }
.prepared-hd-status[data-state="ready"], .captured-quality-status[data-state="ready"] { border-left-color: var(--mint-deep); }
.prepared-hd-status[data-state="running"], .captured-quality-status[data-state="running"] { border-left-color: #4679a3; }
.prepared-hd-status[data-state="completed"], .captured-quality-status[data-state="completed"] { border-left-color: #2f766c; }
.prepared-hd-status[data-state="failed"], .captured-quality-status[data-state="failed"] { border-left-color: #9d4939; }
.prepared-hd-status strong, .captured-quality-status strong { display: block; font-family: Georgia, serif; font-size: 1.2rem; font-weight: 500; }
.prepared-hd-status strong:focus, .captured-quality-status strong:focus { border-radius: 4px; outline: 3px solid var(--mint-deep); outline-offset: 4px; }
.prepared-hd-status p, .captured-quality-status p { color: var(--paper-muted); line-height: 1.5; margin: 6px 0 0; }
.prepared-hd-meter, .captured-quality-meter { background: #dce5e2; border-radius: 999px; height: 7px; margin-top: 14px; overflow: hidden; }
.prepared-hd-meter span, .captured-quality-meter span { background: var(--mint-deep); display: block; height: 100%; transform: scaleX(0); transform-origin: left center; transition: transform 180ms ease-out; }
.prepared-hd-result-facts, .captured-quality-result-facts { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 18px 0 0; }
.prepared-hd-result-facts[hidden], .captured-quality-result-facts[hidden] { display: none; }
.prepared-hd-result-facts .prepared-hd-wide-fact, .captured-quality-result-facts .captured-quality-wide-fact { grid-column: 1 / -1; }
.prepared-hd-result-facts code, .captured-quality-result-facts code { font-size: .7rem; overflow-wrap: anywhere; white-space: normal; }

.offline-preview-workbench { border-top: 3px solid var(--gold); margin-top: 42px; min-width: 0; padding-top: 34px; }
.offline-preview-workbench > p { color: var(--paper-muted); line-height: 1.55; max-width: 850px; }
.offline-preview-head { align-items: flex-start; }
.offline-preview-warning { margin-top: 16px; }
.offline-preview-boundaries { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 20px 0 0; }
.offline-preview-boundaries div, .offline-preview-result-facts div { border-top: 1px solid #c6d1ce; min-width: 0; padding-top: 10px; }
.offline-preview-boundaries dt, .offline-preview-result-facts dt { color: #526763; font-size: .67rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.offline-preview-boundaries dd, .offline-preview-result-facts dd { color: var(--paper-text); font-size: .84rem; margin: 5px 0 0; overflow-wrap: anywhere; }
.offline-preview-status { background: var(--paper-bright); border: 1px solid #b9c9c5; border-left: 5px solid #9b7b34; border-radius: 13px; margin-top: 20px; padding: 18px; }
.offline-preview-status[data-state="ready"] { border-left-color: var(--mint-deep); }
.offline-preview-status[data-state="running"] { border-left-color: #4679a3; }
.offline-preview-status[data-state="verified"] { border-left-color: #2f766c; }
.offline-preview-status[data-state="failed"] { border-left-color: #9d4939; }
.offline-preview-status > strong { font-family: Georgia, serif; font-size: 1.2rem; font-weight: 500; }
.offline-preview-status > strong:focus { border-radius: 4px; outline: 3px solid var(--mint-deep); outline-offset: 4px; }
.offline-preview-status > p { color: var(--paper-muted); line-height: 1.5; margin: 6px 0 0; }
.offline-preview-result-facts { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 18px 0 0; }
.offline-preview-result-facts[hidden] { display: none; }
.offline-preview-result-facts code { font-size: .7rem; overflow-wrap: anywhere; white-space: normal; }
.offline-preview-actions { align-items: center; }
#offline-preview-download-warning { max-width: 850px; }

.boundary { border-top: 1px solid var(--rule); display: grid; gap: 8px; grid-template-columns: minmax(220px, .6fr) minmax(0, 1.4fr); margin-top: 34px; padding: 24px 0 8px; }
.boundary strong { color: var(--gold); font-family: Georgia, serif; font-size: 1.08rem; font-weight: 500; }
.boundary p { color: var(--muted); font-size: .8rem; line-height: 1.5; margin: 0; }
noscript { background: #6f2f24; bottom: 0; color: white; left: 0; padding: 14px; position: fixed; right: 0; text-align: center; }

@media (max-width: 850px) {
  .intro, .result-section.split, .receipt-footer, .boundary { grid-template-columns: 1fr; }
  .status-head, .section-row { align-items: flex-start; flex-direction: column; }
  .section-row > p { text-align: left; }
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .metrics div:nth-child(2) { border-right: 0; }
  .metrics div:nth-child(3), .metrics div:nth-child(4) { border-top: 1px solid #cbd3d0; }
  .metrics div:nth-child(3) { padding-left: 0; }
  .steps { grid-template-columns: repeat(2, 1fr); }
  .decision-card { grid-template-columns: 1fr 1fr; }
  .file-identity { grid-column: 1 / -1; }
  .quality-board-list, .outline-list, .route-list { grid-template-columns: 1fr; }
  .plan-options { grid-template-columns: 1fr; }
  .verification-counts { grid-template-columns: 1fr; }
  .photo-quality-counts, .photo-quality-result-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .photo-quality-contact-sheet { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .local-intake-workspace-boundaries, .local-intake-workspace-truth { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .prepared-hd-boundaries, .prepared-hd-result-facts, .captured-quality-boundaries, .captured-quality-result-facts, .offline-preview-boundaries { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .source-facts-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .source-readiness-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .operator-evidence-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .potree-structural-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .point-value-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .point-value-workbench { grid-template-columns: 1fr; }
  .room-envelope-review-grid { grid-template-columns: 1fr; }
  .room-envelope-review-result dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .point-value-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .point-value-bundle-control, .point-value-zoom-control { grid-column: 1 / -1; }
  .point-value-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .point-value-footer { grid-template-columns: 1fr; }
  .point-value-download-actions { justify-content: flex-start; }
  .local-hd-worker-summary, .local-hd-worker-lanes, .local-hd-worker-components { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 580px) {
  .shell { padding: 17px; }
  .masthead { align-items: flex-start; }
  .brand > span:last-child { display: none; }
  .intro { margin-top: 52px; }
  .intro h1 { font-size: clamp(2.35rem, 13vw, 3.6rem); }
  .workbench { border-radius: 16px; padding: 18px; }
  .status-actions { flex-direction: column; width: 100%; }
  .button { width: 100%; }
  .steps { grid-template-columns: 1fr; }
  .metrics { grid-template-columns: 1fr; }
  .local-hd-worker-summary, .local-hd-worker-lanes, .local-hd-worker-components { grid-template-columns: 1fr; }
  .local-e57-summary, .local-e57-columns { grid-template-columns: 1fr; }
  .local-e57-head, .local-e57-subhead { align-items: flex-start; flex-direction: column; }
  .local-hd-worker-head, .local-hd-worker-subhead { align-items: flex-start; flex-direction: column; }
  .local-hd-worker-component dl div { grid-template-columns: 1fr; }
  .metrics div { border-right: 0; border-top: 1px solid #cbd3d0; padding-left: 0; }
  .metrics div:first-child { border-top: 0; }
  .action-list > div, .duplicate-group { grid-template-columns: 1fr; }
  .form-grid, .plan-options, .decision-card { grid-template-columns: 1fr; }
  .file-identity { grid-column: auto; }
  .decision-heading { align-items: flex-start; flex-direction: column; }
  .quality-card-head { align-items: flex-start; flex-direction: column; }
  .quality-status { max-width: 100%; white-space: normal; }
  .decision-note { grid-column: auto; }
  .guided-actions { flex-direction: column; }
  .photo-quality-counts, .photo-quality-result-facts, .photo-quality-contact-sheet { grid-template-columns: 1fr; }
  .photo-quality-assignment { align-items: stretch; grid-template-columns: 1fr; }
  .photo-quality-head { align-items: flex-start; flex-direction: column; }
  .local-intake-workspace-boundaries, .local-intake-workspace-progress-facts, .local-intake-workspace-result-facts, .local-intake-workspace-truth { grid-template-columns: 1fr; }
  .local-intake-workspace-head, .local-intake-workspace-actions { align-items: flex-start; flex-direction: column; }
  .local-intake-workspace-actions, .local-intake-workspace-delete .button { width: 100%; }
  .prepared-hd-boundaries, .prepared-hd-result-facts, .captured-quality-boundaries, .captured-quality-result-facts, .offline-preview-boundaries, .offline-preview-result-facts { grid-template-columns: 1fr; }
  .prepared-hd-head, .captured-quality-head, .offline-preview-head { align-items: flex-start; flex-direction: column; }
  .source-facts-summary, .source-fact-columns { grid-template-columns: 1fr; }
  .source-fact-card-head, .source-facts-footer, .source-readiness-footer, .operator-evidence-footer, .potree-v7-heading, .potree-bundle-card-head, .potree-refinement-card-head, .v7-inherited-heading { align-items: flex-start; flex-direction: column; }
  .source-readiness-summary, .readiness-counts { grid-template-columns: 1fr; }
  .source-readiness-head, .readiness-lane-head { align-items: flex-start; flex-direction: column; }
  .operator-evidence-summary { grid-template-columns: 1fr; }
  .operator-evidence-head, .operator-evidence-group-head, .operator-evidence-item-head { align-items: flex-start; flex-direction: column; }
  .potree-structural-facts { grid-template-columns: 1fr; }
  .point-value-summary, .point-value-controls, .point-value-facts { grid-template-columns: 1fr; }
  .point-value-bundle-control, .point-value-zoom-control { grid-column: auto; }
  .point-value-image-viewport { min-height: 260px; }
  .point-value-download-actions { flex-direction: column; width: 100%; }
  .room-envelope-review { padding: 15px; }
  .room-envelope-review-head, .room-envelope-result-footer { align-items: flex-start; flex-direction: column; }
  .room-envelope-identity-fields, .room-envelope-coordinate-entry, .room-envelope-review-result dl { grid-template-columns: 1fr; }
  .room-envelope-coordinate-entry .button, .room-envelope-result-footer .button { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
}`;

export const LOCAL_FOUNDRY_APP_JAVASCRIPT = String.raw`(() => {
  "use strict";

  const sessionKey = "omnitwin.foundry.local-session-token";
  const suppliedToken = new URLSearchParams(window.location.search).get("token");
  if (suppliedToken) {
    window.sessionStorage.setItem(sessionKey, suppliedToken);
    window.history.replaceState(null, "", window.location.pathname);
  }
  const token = suppliedToken || window.sessionStorage.getItem(sessionKey);

  const byId = (id) => document.getElementById(id);
  const statusHeading = byId("status-heading");
  const statusCopy = byId("status-copy");
  const sourceLabel = byId("source-label");
  const expiresAt = byId("expires-at");
  const sessionWarning = byId("session-warning");
  const progressBar = byId("progress-bar");
  const results = byId("results");
  const errorPanel = byId("error-panel");
  const errorCopy = byId("error-copy");
  const downloadButton = byId("download-button");
  const downloadHandoffButton = byId("download-handoff-button");
  const handoffDownloadHelp = byId("handoff-download-help");
  const stopButton = byId("stop-button");
  const localHdWorkerLanes = byId("local-hd-worker-lanes");
  const localHdWorkerComponents = byId("local-hd-worker-components");
  const localHdWorkerExclusions = byId("local-hd-worker-exclusions");
  const localHdWorkerLegacy = byId("local-hd-worker-legacy");
  const localE57Artifacts = byId("local-e57-artifacts");
  const localE57OpenItems = byId("local-e57-open-items");
  const guidedWorkflow = byId("guided-workflow");
  const admissionForm = byId("admission-form");
  const decisionList = byId("decision-list");
  const guidedError = byId("guided-error");
  const admissionSuccess = byId("admission-success");
  const verificationWorkbench = byId("verification-workbench");
  const verificationSavedDraftContext = byId("verification-saved-draft-context");
  const verificationError = byId("verification-error");
  const planWorkbench = byId("plan-workbench");
  const planResult = byId("plan-result");
  const planError = byId("plan-error");
  const sourceFactsPanel = byId("source-facts");
  const sourceFactsSummary = byId("source-facts-summary");
  const sourceFactsBlocker = byId("source-facts-blocker");
  const sourceFactsList = byId("source-facts-list");
  const potreeSourceFactsPanel = byId("potree-source-facts");
  const potreeSourceFactsList = byId("potree-source-facts-list");
  const sourceFactsDownloadStatus = byId("source-facts-download-status");
  const pointValueDiagnosticPanel = byId("point-value-diagnostic");
  const pointValueSummary = byId("point-value-summary");
  const pointValueWarning = byId("point-value-warning");
  const pointValueBundleSelect = byId("point-value-bundle-select");
  const pointValueImage = byId("point-value-image");
  const pointValueImageStage = byId("point-value-image-stage");
  const pointValueImageViewport = byId("point-value-image-viewport");
  const pointValueCaption = byId("point-value-caption");
  const pointValueFacts = byId("point-value-facts");
  const pointValueRemainingSummary = byId("point-value-remaining-summary");
  const pointValueRemainingList = byId("point-value-remaining-list");
  const pointValueDownloadStatus = byId("point-value-download-status");
  const pointValueZoom = byId("point-value-zoom");
  const pointValueZoomOutput = byId("point-value-zoom-output");
  const roomEnvelopeOverlay = byId("room-envelope-overlay");
  const roomEnvelopeReviewStatus = byId("room-envelope-review-status");
  const roomEnvelopeHorizontalView = byId("room-envelope-horizontal-view");
  const roomEnvelopeReviewForm = byId("room-envelope-review-form");
  const roomEnvelopeVertexList = byId("room-envelope-vertex-list");
  const roomEnvelopePolygonHelp = byId("room-envelope-polygon-help");
  const roomEnvelopeReviewError = byId("room-envelope-review-error");
  const roomEnvelopeReviewResult = byId("room-envelope-review-result");
  const sourceReadinessPanel = byId("source-readiness");
  const sourceReadinessSummary = byId("source-readiness-summary");
  const sourceReadinessBlocker = byId("source-readiness-blocker");
  const sourceReadinessLanes = byId("source-readiness-lanes");
  const potreeSourceReadinessPanel = byId("potree-source-readiness");
  const potreeSourceReadinessList = byId("potree-source-readiness-list");
  const sourceReadinessFooter = byId("source-readiness-footer");
  const sourceReadinessDownloadStatus = byId("source-readiness-download-status");
  const operatorEvidencePanel = byId("operator-evidence-checklist");
  const operatorEvidenceSummary = byId("operator-evidence-summary");
  const operatorEvidenceBlocker = byId("operator-evidence-blocker");
  const operatorEvidenceGroups = byId("operator-evidence-groups");
  const potreeOperatorEvidencePanel = byId("potree-operator-evidence");
  const potreeOperatorEvidenceList = byId("potree-operator-evidence-list");
  const operatorEvidenceFooter = byId("operator-evidence-footer");
  const operatorEvidenceDownloadStatus = byId("operator-evidence-download-status");
  const localIntakeWorkspacePanel = byId("local-intake-workspace");
  const localIntakeWorkspaceStatus = byId("local-intake-workspace-status");
  const localIntakeWorkspaceMeter = byId("local-intake-workspace-meter");
  const localIntakeWorkspaceProgressFacts = byId("local-intake-workspace-progress-facts");
  const localIntakeWorkspaceResult = byId("local-intake-workspace-result");
  const localIntakeWorkspaceError = byId("local-intake-workspace-error");
  const localIntakeWorkspaceDelete = byId("local-intake-workspace-delete");
  const confirmDeleteLocalIntakeWorkspace = byId("confirm-delete-local-intake-workspace");
  const preparedHdPanel = byId("prepared-hd-dataset");
  const preparedHdStatus = byId("prepared-hd-status");
  const preparedHdError = byId("prepared-hd-error");
  const preparedHdResultFacts = byId("prepared-hd-result-facts");
  const photoQualityPanel = byId("photo-capture-quality");
  const photoQualityAssignments = byId("photo-quality-assignments");
  const photoQualityStatus = byId("photo-quality-status");
  const photoQualityError = byId("photo-quality-error");
  const photoQualityResults = byId("photo-quality-results");
  const photoQualityContactSheet = byId("photo-quality-contact-sheet");
  const photoQualityProtocolGaps = byId("photo-quality-protocol-gaps");
  const photoQualitySimilarity = byId("photo-quality-similarity");
  const capturedQualityPanel = byId("captured-quality-comparison");
  const capturedQualityStatus = byId("captured-quality-status");
  const capturedQualityError = byId("captured-quality-error");
  const capturedQualityResultFacts = byId("captured-quality-result-facts");
  const offlinePreviewPanel = byId("offline-normalization-preview");
  const offlinePreviewStatus = byId("offline-preview-status");
  const offlinePreviewError = byId("offline-preview-error");
  const offlinePreviewResultFacts = byId("offline-preview-result-facts");
  let receipt = null;
  let sourceFacts = null;
  let sourceReadiness = null;
  let operatorEvidenceChecklist = null;
  let pointValueDiagnostic = null;
  let pointValueCurrentImage = null;
  let roomEnvelopeReviewArtifact = null;
  let roomEnvelopeReviewedPreviews = new Map();
  let roomEnvelopeVertices = [];
  let roomEnvelopeActiveBundleSha256 = null;
  let roomEnvelopeSubmitting = false;
  let pollTimer = null;
  let maximumGuidedFiles = 500;
  let admissionArtifact = null;
  let verificationArtifact = null;
  let verificationAdmissionResultSha256 = null;
  let verificationPollTimer = null;
  let currentVerificationChecked = false;
  let pendingVerificationStartRequestId = null;
  let pendingVerificationResumeRequestId = null;
  let planArtifact = null;
  let localIntakeWorkspaceArtifact = null;
  let localIntakeWorkspacePollTimer = null;
  let pendingLocalIntakeWorkspaceRequestId = null;
  let pendingLocalIntakeWorkspaceCancellationId = null;
  let pendingLocalIntakeWorkspaceDeletionId = null;
  let downloadedLocalIntakeWorkspaceReport = false;
  let preparedHdArtifact = null;
  let preparedHdPollTimer = null;
  let pendingPreparedHdRequestId = null;
  let pendingPreparedHdCancellationId = null;
  let downloadedPreparedHdReport = false;
  let photoQualityArtifact = null;
  let photoQualityPollTimer = null;
  let pendingPhotoQualityRequestId = null;
  let pendingPhotoQualityCancellationId = null;
  let downloadedPhotoQualityReport = false;
  let photoQualityAssignmentSignature = null;
  let photoQualityLiveSignature = null;
  let capturedQualityArtifact = null;
  let capturedQualityPollTimer = null;
  let pendingCapturedQualityRequestId = null;
  let pendingCapturedQualityCancellationId = null;
  let downloadedCapturedQualityReport = false;
  let offlinePreviewArtifact = null;
  let offlinePreviewPollTimer = null;
  let pendingOfflinePreviewRequestId = null;
  let downloadedOfflinePreviewOutput = false;
  let downloadedOfflinePreviewReport = false;
  let reviewDirty = false;
  let planDirty = false;
  let reviewRevision = 0;
  let planRevision = 0;
  let completeHandoffStatus = "not_ready";
  let completeHandoffRevisionSha256 = null;
  let completeHandoffMaximumFiles = 500;
  let completeHandoffMaximumSerializedBytes = 32 * 1024 * 1024;
  let requestedCompleteHandoffRevisionSha256 = null;
  const COMPLETE_HANDOFF_REQUESTED_MESSAGE = "Download requested. The source was rechecked first, and the file sent to your browser exactly matches the review, plan, and comparison that were built when you clicked. Check your Downloads folder before closing this session.";
  let sessionExpiresAtMs = null;
  let sessionPhase = "inspecting";
  let localHdWorkerRendered = false;
  let downloadedReceipt = false;
  let downloadedLatestReview = false;
  let downloadedLatestResult = false;
  let downloadedLatestPlan = false;
  const READY_SESSION_POLL_MS = 15_000;
  const VERIFICATION_POLL_MS = 650;
  const LOCAL_INTAKE_WORKSPACE_POLL_MS = 650;
  const PREPARED_HD_POLL_MS = 650;
  const PHOTO_QUALITY_POLL_MS = 650;
  const CAPTURED_QUALITY_POLL_MS = 650;
  const OFFLINE_PREVIEW_POLL_MS = 650;
  const SESSION_WARNING_MS = 15 * 60 * 1_000;

  const formatNames = {
    matterport_e57: "Matterport E57 point cloud",
    generic_e57: "E57 point cloud",
    las_laz: "LAS or LAZ point cloud",
    xyz_point_cloud: "XYZ point cloud",
    ply_point_cloud: "PLY point cloud",
    matterport_panorama: "Matterport panorama",
    dslr_image: "DSLR photograph",
    generic_image: "Image",
    panorama_360: "360-degree panorama",
    phone_image: "Phone photograph",
    drone_media: "Drone photo or video",
    rgbd: "Colour and depth capture",
    sensor_log_mcap: "MCAP sensor log",
    imu: "Motion sensor data",
    gnss_rtk: "Survey positioning data",
    obj: "OBJ mesh",
    glb_gltf: "GLB or glTF 3D scene",
    spz: "SPZ Gaussian splat",
    sog: "SOG Gaussian splat",
    gaussian_ply: "PLY Gaussian splat",
    xgrids_xbin: "XGRIDS proprietary capture",
    lcc: "LCC project",
    lcc2: "LCC2 project",
    matterpak_bundle: "MatterPak bundle",
    video: "Video",
    colmap_sparse_model: "COLMAP camera model",
    colmap_database: "COLMAP image database",
    trajectory: "Camera trajectory",
    fbx: "FBX scene",
    cad_bim: "CAD or BIM file",
    floor_plan: "Floor plan",
    openusd: "OpenUSD 3D scene",
    calibration_bundle: "Camera calibration bundle",
    control_network: "Survey control network",
    manual_evidence: "Manual evidence note",
    evidence_record: "Evidence record"
  };

  const sourceFactFormatNames = {
    e57: "E57",
    gaussian_ply: "Gaussian PLY",
    glb: "Binary glTF",
    gltf_json: "JSON glTF",
    iso_bmff: "ISO Base Media video container",
    jpeg: "JPEG image container",
    json: "Bounded JSON syntax and shape",
    media_container: "Media container not established",
    obj: "OBJ",
    png: "PNG image container",
    ply: "Ordinary point PLY fixed-width layout",
    sog: "SOG",
    spz: "SPZ",
    csv: "UTF-8 CSV record structure",
    calibration_trajectory_document: "Calibration or trajectory document not established"
  };

  const reasonNames = {
    format_unknown: "Format is unknown",
    format_ambiguous: "Format needs confirmation",
    low_confidence_detection: "Format clue is weak",
    opaque_or_proprietary_format: "Vendor-controlled format",
    rights_unreviewed: "Usage rights are not reviewed",
    provenance_unreviewed: "File origin is not recorded"
  };

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = String(value);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const digits = index === 0 ? 0 : 2;
    return (bytes / Math.pow(1024, index)).toFixed(digits) + " " + units[index];
  }

  function friendlyFormat(file) {
    if (!file.detection || file.detection.status === "unknown") return "Unknown format";
    if (file.detection.status === "ambiguous") return "Several formats possible";
    const candidate = file.detection.candidates && file.detection.candidates[0];
    if (!candidate) return "Unknown format";
    return formatNames[candidate.inputType] || candidate.inputType.replaceAll("_", " ");
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function setStepState(step, state) {
    step.dataset.state = state;
    const spoken = step.querySelector(".step-state-sr");
    if (spoken) spoken.textContent = state === "done" ? "Complete" : state === "active" ? "Current step" : "Not started";
    if (state === "active") step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  }

  function setSteps(phase) {
    const inspect = byId("step-inspect");
    const built = byId("step-receipt");
    const review = byId("step-review");
    const plan = byId("step-plan");
    const save = byId("step-save");
    for (const step of [inspect, built, review, plan, save]) setStepState(step, "waiting");
    if (phase === "complete") {
      for (const step of [inspect, built, review, plan, save]) setStepState(step, "done");
      progressBar.dataset.progress = "100";
    } else if (phase === "plan") {
      for (const step of [inspect, built, review, plan]) setStepState(step, "done");
      setStepState(save, "active");
      progressBar.dataset.progress = "92";
    } else if (phase === "draft") {
      for (const step of [inspect, built, review]) setStepState(step, "done");
      setStepState(plan, "active");
      progressBar.dataset.progress = "72";
    } else if (phase === "ready") {
      setStepState(inspect, "done");
      setStepState(built, "done");
      setStepState(review, "active");
      progressBar.dataset.progress = "46";
    } else if (phase === "failed") {
      setStepState(inspect, "active");
      progressBar.dataset.progress = "16";
    } else {
      setStepState(inspect, "active");
      progressBar.dataset.progress = "20";
    }
  }

  function renderFormats(files) {
    const counts = new Map();
    for (const file of files) {
      const name = friendlyFormat(file);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const target = byId("format-list");
    target.replaceChildren();
    const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    for (const item of sorted) {
      const row = element("div");
      row.append(element("strong", "", item[0]), element("span", "", item[1] + (item[1] === 1 ? " file" : " files")));
      target.append(row);
    }
    setText("metric-formats", sorted.length);
  }

  function renderQuarantine(files) {
    const reasons = new Map();
    for (const file of files) {
      for (const item of file.quarantine || []) {
        const current = reasons.get(item.reason) || { count: 0, nextAction: item.nextAction };
        current.count += 1;
        reasons.set(item.reason, current);
      }
    }
    const target = byId("quarantine-list");
    target.replaceChildren();
    for (const item of Array.from(reasons.entries()).sort((left, right) => right[1].count - left[1].count)) {
      const row = element("div");
      const title = element("strong", "", reasonNames[item[0]] || item[0].replaceAll("_", " "));
      title.append(element("span", "", item[1].count + (item[1].count === 1 ? " file affected" : " files affected")));
      row.append(title, element("p", "", item[1].nextAction));
      target.append(row);
    }
  }

  function renderDuplicates(groups) {
    const target = byId("duplicate-list");
    target.replaceChildren();
    setText("metric-duplicates", groups.length);
    setText("duplicate-note", groups.length === 0 ? "No exact duplicates found." : groups.length + (groups.length === 1 ? " exact duplicate group found." : " exact duplicate groups found."));
    const visible = groups.slice(0, 50);
    for (const group of visible) {
      const box = element("div", "duplicate-group");
      const summary = element("div");
      summary.append(element("strong", "", formatBytes(group.sizeBytes)), element("code", "", group.sha256));
      const paths = element("ul");
      const visiblePaths = group.paths.slice(0, 100);
      for (const path of visiblePaths) paths.append(element("li", "", path));
      if (group.paths.length > visiblePaths.length) {
        paths.append(element("li", "", (group.paths.length - visiblePaths.length) + " more exact-copy paths are listed in the downloaded receipt."));
      }
      box.append(summary, paths);
      target.append(box);
    }
    if (groups.length > visible.length) target.append(element("p", "", "The receipt contains " + (groups.length - visible.length) + " more duplicate groups."));
  }

  function renderFiles(files) {
    const target = byId("file-table-body");
    target.replaceChildren();
    const visible = files.slice(0, 500);
    for (const file of visible) {
      const row = element("tr");
      const firstReason = file.quarantine && file.quarantine[0];
      row.append(
        element("td", "", file.path),
        element("td", "", friendlyFormat(file)),
        element("td", "", formatBytes(file.sizeBytes)),
        element("td", "", firstReason ? (reasonNames[firstReason.reason] || firstReason.reason.replaceAll("_", " ")) : "Held for review"),
        element("td", "", firstReason ? firstReason.nextAction : "Review this file before admission.")
      );
      target.append(row);
    }
    setText("file-limit-note", files.length > visible.length ? "Showing the first 500 files. Download the receipt for all " + files.length + "." : "All " + files.length + (files.length === 1 ? " file is shown." : " files are shown."));
  }

  function option(value, label, disabled) {
    const node = element("option", "", label);
    node.value = value;
    node.disabled = Boolean(disabled);
    return node;
  }

  function clearDetectedCandidate(file) {
    if (!file.detection || file.detection.status !== "detected") return null;
    const candidate = file.detection.candidates && file.detection.candidates[0];
    if (!candidate || candidate.confidence === "low") return null;
    return candidate;
  }

  function exclusionOptions(select, file) {
    select.append(
      option("", "Choose why it stays out", false),
      option("unsupported_format", "Format is not supported here", false),
      option("rights_not_cleared", "Rights are not cleared", false),
      option("provenance_unknown", "Origin is not known", false)
    );
    const isExactDuplicate = receipt && receipt.duplicateGroups.some((group) => group.paths.includes(file.path));
    if (isExactDuplicate) select.append(option("duplicate_content", "Exact duplicate kept outside draft", false));
    select.append(
      option("unrelated_to_project", "Not part of this project", false),
      option("superseded_input", "Replaced by another input", false),
      option("operator_rejected", "Leave out after human review", false)
    );
  }

  function roleOptions(select, candidate) {
    select.append(option("", "Choose its origin", false));
    if (candidate && candidate.inputType === "xgrids_xbin") {
      select.append(option("reference_only", "Reference only — payload stays blocked", false));
      return;
    }
    select.append(
      option("raw_capture", "Original captured data", false),
      option("official_export", "Official vendor export", false),
      option("reference_only", "Reference only", false)
    );
  }

  function updateDecisionCard(index) {
    const action = byId("decision-action-" + index);
    const choice = byId("decision-choice-" + index);
    const card = byId("decision-card-" + index);
    const note = byId("decision-note-" + index);
    const choiceLabel = choice.parentElement.querySelector(".decision-choice-label");
    const file = receipt && receipt.files[index];
    if (!file) return;
    const candidate = clearDetectedCandidate(file);
    choice.replaceChildren();
    if (action.value === "admit") {
      choice.disabled = false;
      choiceLabel.textContent = "Origin label";
      roleOptions(choice, candidate);
      note.textContent = candidate && candidate.inputType === "xgrids_xbin"
        ? "This vendor-controlled file can only be recorded as reference-only. Its payload is not decoded or authorized for processing."
        : "This label records origin. It does not prove physical accuracy or usage rights.";
    } else if (action.value === "exclude") {
      choice.disabled = false;
      choiceLabel.textContent = "Reason for leaving it out";
      exclusionOptions(choice, file);
      note.textContent = "Leaving a file out changes only this in-memory draft. The source file is not moved or deleted.";
    } else {
      choice.append(option("", "Choose keep or leave out first", false));
      choice.disabled = true;
      choiceLabel.textContent = "Next choice";
      note.textContent = candidate
        ? "Choose one draft decision. Rights and physical truth remain unresolved either way."
        : "This screen cannot safely keep an unknown, ambiguous, or weakly identified format. Leave it out, then ask the capture operator for a documented official export before starting a new session.";
    }
    card.dataset.complete = "false";
    updateDecisionProgress();
  }

  function updateDecisionProgress() {
    if (!receipt) return;
    let complete = 0;
    for (let index = 0; index < receipt.files.length; index += 1) {
      const action = byId("decision-action-" + index);
      const choice = byId("decision-choice-" + index);
      const card = byId("decision-card-" + index);
      const done = Boolean(action && choice && action.value && choice.value);
      if (card) card.dataset.complete = String(done);
      if (done) complete += 1;
    }
    setText("decision-progress", complete + " of " + receipt.files.length + " files decided");
  }

  function renderGuidedWorkflow(value) {
    guidedWorkflow.hidden = false;
    decisionList.replaceChildren();
    if (value.files.length > maximumGuidedFiles) {
      decisionList.append(element("p", "plain-warning", "This receipt has more than " + maximumGuidedFiles + " files. Download it and give it to the project's authorized capture reviewer so no file is silently omitted."));
      byId("build-admission-button").disabled = true;
      setText("decision-progress", "Guided review unavailable for this file count");
      return;
    }
    for (let index = 0; index < value.files.length; index += 1) {
      const file = value.files[index];
      const candidate = clearDetectedCandidate(file);
      const card = element("article", "decision-card");
      card.id = "decision-card-" + index;
      card.dataset.complete = "false";

      const identity = element("div", "file-identity");
      identity.append(
        element("code", "", file.path),
        element("span", "", friendlyFormat(file) + " · " + formatBytes(file.sizeBytes))
      );

      const actionLabel = element("label", "", "Draft decision");
      const action = element("select");
      action.id = "decision-action-" + index;
      action.append(
        option("", "Not decided", false),
        option("admit", candidate ? "Keep in review draft" : "Keep requires stronger evidence", !candidate),
        option("exclude", "Leave out of review draft", false)
      );
      actionLabel.append(action);

      const choiceLabel = element("label");
      choiceLabel.append(element("span", "decision-choice-label", "Next choice"));
      const choice = element("select");
      choice.id = "decision-choice-" + index;
      choice.disabled = true;
      choice.append(option("", "Choose keep or leave out first", false));
      choiceLabel.append(choice);

      const note = element("p", "decision-note", candidate
        ? "Choose one draft decision. Rights and physical truth remain unresolved either way."
        : "This screen cannot safely keep an unknown, ambiguous, or weakly identified format. Leave it out, then ask the capture operator for a documented official export before starting a new session.");
      note.id = "decision-note-" + index;
      action.addEventListener("change", () => updateDecisionCard(index));
      choice.addEventListener("change", updateDecisionProgress);
      card.append(identity, actionLabel, choiceLabel, note);
      decisionList.append(card);
    }
    updateDecisionProgress();
  }

  function showPanelError(panel, message) {
    panel.textContent = message;
    panel.hidden = false;
    panel.focus();
  }

  function clearPanelError(panel) {
    panel.hidden = true;
    panel.textContent = "";
  }

  function setAdmissionEditingLocked(locked) {
    for (const control of admissionForm.querySelectorAll("input, select")) {
      control.disabled = locked;
    }
    byId("build-admission-button").disabled = locked;
    byId("admission-lock-note").hidden = !locked;
  }

  async function errorMessage(response, fallback) {
    try {
      const body = await response.json();
      return typeof body.error === "string" ? body.error : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  async function postJson(path, value) {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error(await errorMessage(response, "The local server rejected this draft safely."));
    return response.json();
  }

  function newVerificationRequestId() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function newOfflinePreviewRequestId() {
    return newVerificationRequestId();
  }

  function newPreparedHdRequestId() {
    return newVerificationRequestId();
  }

  function newCapturedQualityRequestId() {
    return newVerificationRequestId();
  }

  function newPhotoQualityRequestId() {
    return newVerificationRequestId();
  }

  function isOfflinePreviewDigest(value) {
    return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  }

  function hasExactObjectKeys(value, expectedKeys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = expectedKeys.slice().sort();
    return actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]);
  }

  function isCapturedQualityDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  }

  function isPhotoQualityRelativePath(value) {
    if (typeof value !== "string" || value.length < 1 || value.length > 1024 || value.includes("\\") || value.includes(":")) return false;
    const parts = value.split("/");
    return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
  }

  function parseLocalIntakeWorkspace(value) {
    if (!hasExactObjectKeys(value, [
      "schemaVersion",
      "state",
      "authority",
      "operation",
      "configured",
      "receiptSha256",
      "requestId",
      "message",
      "failureCode",
      "progress",
      "workspace"
    ])) {
      throw new Error("The local server returned a workspace field this page does not accept.");
    }
    if (
      value.schemaVersion !== "omnitwin.foundry.local-intake-workspace-controller.v0" ||
      value.authority !== "none" ||
      typeof value.configured !== "boolean" ||
      !["copy_into_local_workspace", "delete_local_workspace_copy", null].includes(value.operation)
    ) {
      throw new Error("The local server returned an unsafe local-workspace boundary.");
    }
    if (![
      "unavailable",
      "ready",
      "copying",
      "verifying",
      "stored",
      "failed",
      "deleting",
      "deleted"
    ].includes(value.state)) {
      throw new Error("The local server returned an unknown local-workspace state.");
    }
    if (value.receiptSha256 !== null && !isCapturedQualityDigest(value.receiptSha256)) {
      throw new Error("The local server returned an invalid local-workspace receipt reference.");
    }
    if (
      value.requestId !== null &&
      (typeof value.requestId !== "string" || !/^[a-f0-9]{32}$/.test(value.requestId))
    ) {
      throw new Error("The local server returned an invalid local-workspace request reference.");
    }
    if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > 500) {
      throw new Error("The local server returned an invalid local-workspace message.");
    }
    if (
      value.failureCode !== null &&
      (typeof value.failureCode !== "string" || !/^LOCAL_INTAKE_WORKSPACE_[A-Z0-9_]+$/.test(value.failureCode))
    ) {
      throw new Error("The local server returned an invalid local-workspace failure code.");
    }
    if (value.progress !== null) {
      if (!hasExactObjectKeys(value.progress, [
        "copiedFileCount",
        "fileCount",
        "copiedBytes",
        "totalBytes"
      ])) {
        throw new Error("The local server returned an invalid local-workspace progress summary.");
      }
      for (const field of ["copiedFileCount", "fileCount", "copiedBytes", "totalBytes"]) {
        if (!Number.isSafeInteger(value.progress[field]) || value.progress[field] < 0) {
          throw new Error("The local server returned an invalid local-workspace progress count.");
        }
      }
      if (
        value.progress.copiedFileCount > value.progress.fileCount ||
        value.progress.copiedBytes > value.progress.totalBytes
      ) {
        throw new Error("The local server returned inconsistent local-workspace progress counts.");
      }
    }
    if (value.workspace !== null) {
      if (!hasExactObjectKeys(value.workspace, [
        "workspaceSha256",
        "fileCount",
        "totalBytes",
        "truth"
      ]) || !hasExactObjectKeys(value.workspace.truth, [
        "pendingReview",
        "admitted",
        "excluded",
        "captured",
        "enhancedCaptured",
        "generatedCinematic",
        "conceptImagination"
      ])) {
        throw new Error("The local server returned an invalid local-workspace summary.");
      }
      if (
        !isCapturedQualityDigest(value.workspace.workspaceSha256) ||
        !Number.isSafeInteger(value.workspace.fileCount) ||
        value.workspace.fileCount < 0 ||
        !Number.isSafeInteger(value.workspace.totalBytes) ||
        value.workspace.totalBytes < 0
      ) {
        throw new Error("The local server returned an invalid local-workspace identity.");
      }
      for (const field of [
        "pendingReview",
        "admitted",
        "excluded",
        "captured",
        "enhancedCaptured",
        "generatedCinematic",
        "conceptImagination"
      ]) {
        if (!Number.isSafeInteger(value.workspace.truth[field]) || value.workspace.truth[field] < 0) {
          throw new Error("The local server returned an invalid local-workspace truth count.");
        }
      }
      if (
        value.workspace.truth.pendingReview + value.workspace.truth.admitted + value.workspace.truth.excluded !== value.workspace.fileCount ||
        value.workspace.truth.captured + value.workspace.truth.enhancedCaptured + value.workspace.truth.generatedCinematic + value.workspace.truth.conceptImagination !== value.workspace.truth.admitted
      ) {
        throw new Error("The local server returned inconsistent local-workspace truth counts.");
      }
    }
    const unavailable = value.state === "unavailable" &&
      value.configured === false &&
      value.operation === null &&
      value.receiptSha256 === null &&
      value.requestId === null &&
      value.failureCode === null &&
      value.progress === null &&
      value.workspace === null;
    const ready = value.state === "ready" &&
      value.configured === true &&
      value.operation === null &&
      value.receiptSha256 !== null &&
      value.requestId === null &&
      value.failureCode === null &&
      value.progress === null &&
      value.workspace === null;
    const copyingOrVerifying = ["copying", "verifying"].includes(value.state) &&
      value.configured === true &&
      value.operation === "copy_into_local_workspace" &&
      value.receiptSha256 !== null &&
      value.requestId !== null &&
      value.failureCode === null &&
      value.progress !== null &&
      value.workspace === null;
    const stored = value.state === "stored" &&
      value.configured === true &&
      value.operation === "copy_into_local_workspace" &&
      value.receiptSha256 !== null &&
      value.requestId !== null &&
      value.failureCode === null &&
      value.progress !== null &&
      value.workspace !== null &&
      value.progress.copiedFileCount === value.progress.fileCount &&
      value.progress.copiedBytes === value.progress.totalBytes &&
      value.progress.fileCount === value.workspace.fileCount &&
      value.progress.totalBytes === value.workspace.totalBytes;
    const copyFailed = value.state === "failed" &&
      value.configured === true &&
      value.operation === "copy_into_local_workspace" &&
      value.receiptSha256 !== null &&
      value.requestId !== null &&
      value.failureCode !== null &&
      value.workspace === null;
    const deleteFailed = value.state === "failed" &&
      value.configured === true &&
      value.operation === "delete_local_workspace_copy" &&
      value.receiptSha256 !== null &&
      value.requestId !== null &&
      value.failureCode !== null &&
      value.progress === null &&
      value.workspace !== null;
    const inspectionFailed = value.state === "failed" &&
      value.configured === true &&
      value.operation === null &&
      value.receiptSha256 === null &&
      value.requestId === null &&
      value.failureCode === "LOCAL_INTAKE_WORKSPACE_INSPECTION_FAILED" &&
      value.progress === null &&
      value.workspace === null;
    const deleting = value.state === "deleting" &&
      value.configured === true &&
      value.operation === "delete_local_workspace_copy" &&
      value.receiptSha256 !== null &&
      value.requestId !== null &&
      value.failureCode === null &&
      value.progress === null &&
      value.workspace !== null;
    const deleted = value.state === "deleted" &&
      value.configured === true &&
      value.operation === "delete_local_workspace_copy" &&
      value.receiptSha256 !== null &&
      value.requestId !== null &&
      value.failureCode === null &&
      value.progress === null &&
      value.workspace === null;
    if (!unavailable && !ready && !copyingOrVerifying && !stored && !copyFailed && !deleteFailed && !inspectionFailed && !deleting && !deleted) {
      throw new Error("The local server returned an internally inconsistent local-workspace state.");
    }
    return value;
  }

  function parsePreparedHdDataset(value) {
    if (!hasExactObjectKeys(value, [
      "schemaVersion",
      "state",
      "authority",
      "operation",
      "receiptSha256",
      "requestId",
      "message",
      "failureCode",
      "report"
    ])) {
      throw new Error("The local server returned a prepared-dataset field this page does not accept.");
    }
    if (
      value.schemaVersion !== "omnitwin.foundry.local-prepared-hd-dataset-gate.v0" ||
      value.authority !== "none" ||
      value.operation !== "prepared_dataset_validation_only"
    ) {
      throw new Error("The local server returned an unsafe prepared-dataset boundary.");
    }
    const states = ["unavailable", "ready", "running", "completed", "failed"];
    if (!states.includes(value.state)) {
      throw new Error("The local server returned an unknown prepared-dataset state.");
    }
    if (
      value.receiptSha256 !== null && !isCapturedQualityDigest(value.receiptSha256)
    ) {
      throw new Error("The local server returned an invalid prepared-dataset source receipt.");
    }
    if (
      value.requestId !== null &&
      (typeof value.requestId !== "string" || !/^[a-f0-9]{32}$/.test(value.requestId))
    ) {
      throw new Error("The local server returned an invalid prepared-dataset request reference.");
    }
    if (
      typeof value.message !== "string" ||
      value.message.length < 1 ||
      value.message.length > 500
    ) {
      throw new Error("The local server returned an invalid prepared-dataset message.");
    }
    if (
      value.failureCode !== null &&
      (typeof value.failureCode !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value.failureCode))
    ) {
      throw new Error("The local server returned an invalid prepared-dataset failure code.");
    }
    if (value.report !== null) {
      if (!hasExactObjectKeys(value.report, [
        "schemaVersion",
        "readinessReceiptSha256",
        "sourceReceiptSha256",
        "cameraCount",
        "imageCount",
        "runtimeImageCount",
        "trainImageCount",
        "heldoutImageCount",
        "pointCount",
        "depthPriorCount"
      ])) {
        throw new Error("The local server returned an invalid prepared-dataset report summary.");
      }
      if (
        value.report.schemaVersion !== "omnitwin.foundry.prepared-hd-dataset-readiness.v0" ||
        !isCapturedQualityDigest(value.report.readinessReceiptSha256) ||
        !isCapturedQualityDigest(value.report.sourceReceiptSha256)
      ) {
        throw new Error("The local server returned an invalid prepared-dataset report identity.");
      }
      for (const field of [
        "cameraCount",
        "imageCount",
        "runtimeImageCount",
        "trainImageCount",
        "heldoutImageCount",
        "pointCount",
        "depthPriorCount"
      ]) {
        if (!Number.isSafeInteger(value.report[field]) || value.report[field] < 0) {
          throw new Error("The local server returned an invalid prepared-dataset evidence count.");
        }
      }
      if (
        value.report.cameraCount < 1 ||
        value.report.imageCount < 1 ||
        value.report.runtimeImageCount !== value.report.imageCount ||
        value.report.trainImageCount + value.report.heldoutImageCount !== value.report.imageCount ||
        value.report.trainImageCount < 1 ||
        value.report.heldoutImageCount < 1 ||
        value.report.depthPriorCount !== value.report.trainImageCount
      ) {
        throw new Error("The local server returned inconsistent prepared-dataset evidence counts.");
      }
    }
    const unavailable = value.state === "unavailable" && value.requestId === null && value.report === null;
    const ready = value.state === "ready" && value.receiptSha256 !== null && value.requestId === null && value.failureCode === null && value.report === null;
    const running = value.state === "running" && value.receiptSha256 !== null && value.requestId !== null && value.failureCode === null && value.report === null;
    const completed = value.state === "completed" && value.receiptSha256 !== null && value.requestId !== null && value.failureCode === null && value.report !== null && value.report.sourceReceiptSha256 === value.receiptSha256;
    const failed = value.state === "failed" && value.receiptSha256 !== null && value.requestId !== null && value.failureCode !== null && value.report === null;
    if (!unavailable && !ready && !running && !completed && !failed) {
      throw new Error("The local server returned an internally inconsistent prepared-dataset state.");
    }
    return value;
  }

  function clearPreparedHdPoll() {
    if (preparedHdPollTimer !== null) window.clearTimeout(preparedHdPollTimer);
    preparedHdPollTimer = null;
  }

  function schedulePreparedHdPoll() {
    if (
      preparedHdPollTimer !== null ||
      !preparedHdArtifact ||
      preparedHdArtifact.state !== "running" ||
      typeof preparedHdArtifact.requestId !== "string"
    ) return;
    preparedHdPollTimer = window.setTimeout(() => {
      preparedHdPollTimer = null;
      void pollPreparedHdDataset();
    }, PREPARED_HD_POLL_MS);
  }

  function showPreparedHdBoundaryFailure(message) {
    clearPreparedHdPoll();
    preparedHdArtifact = null;
    pendingPreparedHdRequestId = null;
    pendingPreparedHdCancellationId = null;
    preparedHdPanel.hidden = false;
    preparedHdStatus.dataset.state = "failed";
    setText("prepared-hd-status-heading", "Prepared package information is unavailable");
    setText("prepared-hd-status-copy", "Nothing was accepted as a prepared-dataset result.");
    byId("prepared-hd-meter-bar").style.transform = "scaleX(0)";
    preparedHdResultFacts.hidden = true;
    byId("start-prepared-hd-button").hidden = false;
    byId("start-prepared-hd-button").disabled = true;
    byId("cancel-prepared-hd-button").hidden = true;
    byId("download-prepared-hd-report-button").hidden = true;
    showPanelError(preparedHdError, message);
  }

  function renderPreparedHdDataset(value, focusHeading = false, expectedRequestId = null) {
    let parsed;
    try {
      parsed = parsePreparedHdDataset(value);
    } catch (error) {
      showPreparedHdBoundaryFailure(
        error instanceof Error ? error.message : "The prepared-dataset status could not be checked safely."
      );
      return false;
    }
    if (expectedRequestId !== null && parsed.requestId !== expectedRequestId) return false;
    if (
      preparedHdArtifact &&
      preparedHdArtifact.requestId !== null &&
      preparedHdArtifact.requestId === parsed.requestId
    ) {
      const currentIsTerminal = ["completed", "failed"].includes(preparedHdArtifact.state);
      if (currentIsTerminal && parsed.state !== preparedHdArtifact.state) return false;
      if (
        pendingPreparedHdCancellationId === parsed.requestId &&
        parsed.state === "running"
      ) return false;
    }
    const previousRequestId = preparedHdArtifact && preparedHdArtifact.requestId;
    if (previousRequestId !== parsed.requestId) downloadedPreparedHdReport = false;
    preparedHdArtifact = parsed;
    if (pendingPreparedHdRequestId === parsed.requestId) pendingPreparedHdRequestId = null;
    if (
      pendingPreparedHdCancellationId === parsed.requestId &&
      parsed.state !== "running"
    ) pendingPreparedHdCancellationId = null;
    preparedHdPanel.hidden = false;
    preparedHdStatus.dataset.state = parsed.state;
    clearPanelError(preparedHdError);

    const start = byId("start-prepared-hd-button");
    const cancel = byId("cancel-prepared-hd-button");
    const download = byId("download-prepared-hd-report-button");
    start.hidden = parsed.state === "running" || parsed.state === "completed";
    start.disabled = parsed.state !== "ready";
    start.textContent = parsed.state === "failed"
      ? "Start a new local session to try again"
      : parsed.state === "unavailable"
        ? "Prepared package unavailable"
        : "Validate prepared package";
    cancel.hidden = parsed.state !== "running";
    download.hidden = parsed.state !== "completed";
    download.textContent = downloadedPreparedHdReport
      ? "Download readiness receipt again"
      : "Download readiness receipt";
    preparedHdResultFacts.hidden = parsed.state !== "completed";
    byId("prepared-hd-meter-bar").style.transform = "scaleX(" + (
      parsed.state === "completed" ? "1" : parsed.state === "running" ? "0.45" : "0"
    ) + ")";

    if (parsed.state === "ready") {
      setText("prepared-hd-status-heading", "Prepared package is ready for its input check");
      setText("prepared-hd-status-copy", parsed.message);
      clearPreparedHdPoll();
    } else if (parsed.state === "running") {
      setText("prepared-hd-status-heading", "Validating camera geometry and dataset evidence");
      setText("prepared-hd-status-copy", parsed.message);
      schedulePreparedHdPoll();
    } else if (parsed.state === "completed") {
      setText("prepared-hd-status-heading", "Prepared input contract passed");
      setText("prepared-hd-status-copy", "Prepared package validated. Photo registration, reconstruction, training, and enhancement were not performed.");
      setText("prepared-hd-camera-count", parsed.report.cameraCount.toLocaleString());
      setText("prepared-hd-image-count", parsed.report.imageCount.toLocaleString());
      setText("prepared-hd-runtime-image-count", parsed.report.runtimeImageCount.toLocaleString());
      setText("prepared-hd-train-image-count", parsed.report.trainImageCount.toLocaleString());
      setText("prepared-hd-heldout-image-count", parsed.report.heldoutImageCount.toLocaleString());
      setText("prepared-hd-point-count", parsed.report.pointCount.toLocaleString());
      setText("prepared-hd-depth-prior-count", parsed.report.depthPriorCount.toLocaleString());
      setText("prepared-hd-report-sha", parsed.report.readinessReceiptSha256);
      clearPreparedHdPoll();
    } else if (parsed.state === "failed") {
      setText("prepared-hd-status-heading", "The prepared package did not pass");
      setText("prepared-hd-status-copy", parsed.message);
      showPanelError(preparedHdError, "No readiness receipt was retained. Start a new local session after correcting the package.");
      clearPreparedHdPoll();
    } else {
      setText("prepared-hd-status-heading", "Prepared package check unavailable");
      setText("prepared-hd-status-copy", parsed.message);
      clearPreparedHdPoll();
    }
    if (focusHeading) {
      const heading = byId("prepared-hd-status-heading");
      heading.tabIndex = -1;
      heading.focus();
    }
    updateSessionCountdown();
    return true;
  }

  async function pollPreparedHdDataset() {
    if (
      !preparedHdArtifact ||
      preparedHdArtifact.state !== "running" ||
      typeof preparedHdArtifact.requestId !== "string"
    ) return;
    const expectedRequestId = preparedHdArtifact.requestId;
    try {
      const value = await postJson("/api/prepared-hd-dataset/status", { requestId: expectedRequestId });
      if (!preparedHdArtifact || preparedHdArtifact.requestId !== expectedRequestId) return;
      renderPreparedHdDataset(value, false, expectedRequestId);
    } catch (error) {
      if (preparedHdArtifact && preparedHdArtifact.requestId === expectedRequestId) {
        showPanelError(
          preparedHdError,
          error instanceof Error ? error.message : "The prepared-dataset status could not be checked."
        );
        schedulePreparedHdPoll();
      }
    }
  }

  async function recoverPreparedHdAfterLostResponse(requestId) {
    try {
      const value = await postJson("/api/prepared-hd-dataset/status", { requestId });
      return renderPreparedHdDataset(value, true, requestId);
    } catch (_error) {
      return false;
    }
  }

  function clearLocalIntakeWorkspacePoll() {
    if (localIntakeWorkspacePollTimer !== null) {
      window.clearTimeout(localIntakeWorkspacePollTimer);
    }
    localIntakeWorkspacePollTimer = null;
  }

  function localIntakeWorkspaceIsActive(value) {
    return Boolean(value && ["copying", "verifying", "deleting"].includes(value.state));
  }

  function scheduleLocalIntakeWorkspacePoll() {
    if (
      localIntakeWorkspacePollTimer !== null ||
      !localIntakeWorkspaceArtifact ||
      !localIntakeWorkspaceIsActive(localIntakeWorkspaceArtifact) ||
      typeof localIntakeWorkspaceArtifact.requestId !== "string"
    ) return;
    localIntakeWorkspacePollTimer = window.setTimeout(() => {
      localIntakeWorkspacePollTimer = null;
      void pollLocalIntakeWorkspace();
    }, LOCAL_INTAKE_WORKSPACE_POLL_MS);
  }

  function showLocalIntakeWorkspaceBoundaryFailure(message) {
    clearLocalIntakeWorkspacePoll();
    localIntakeWorkspaceArtifact = null;
    pendingLocalIntakeWorkspaceRequestId = null;
    pendingLocalIntakeWorkspaceCancellationId = null;
    pendingLocalIntakeWorkspaceDeletionId = null;
    localIntakeWorkspacePanel.hidden = false;
    localIntakeWorkspaceStatus.dataset.state = "failed";
    setText("local-intake-workspace-status-heading", "Local workspace information is unavailable");
    setText("local-intake-workspace-status-copy", "Nothing was accepted as a verified local-workspace result.");
    localIntakeWorkspaceMeter.setAttribute("aria-valuenow", "0");
    localIntakeWorkspaceMeter.setAttribute("aria-valuetext", "No verified progress accepted");
    byId("local-intake-workspace-meter-bar").style.transform = "scaleX(0)";
    localIntakeWorkspaceProgressFacts.hidden = true;
    localIntakeWorkspaceResult.hidden = true;
    localIntakeWorkspaceDelete.hidden = true;
    confirmDeleteLocalIntakeWorkspace.checked = false;
    byId("start-local-intake-workspace-button").hidden = false;
    byId("start-local-intake-workspace-button").disabled = true;
    byId("cancel-local-intake-workspace-button").hidden = true;
    byId("download-local-intake-workspace-report-button").hidden = true;
    byId("delete-local-intake-workspace-button").disabled = true;
    showPanelError(localIntakeWorkspaceError, message);
  }

  function renderLocalIntakeWorkspace(value, focusHeading = false, expectedRequestId = null) {
    let parsed;
    try {
      parsed = parseLocalIntakeWorkspace(value);
    } catch (error) {
      showLocalIntakeWorkspaceBoundaryFailure(
        error instanceof Error ? error.message : "The local-workspace status could not be checked safely."
      );
      return false;
    }
    const cancelledRequestReturnedReady = expectedRequestId !== null &&
      pendingLocalIntakeWorkspaceCancellationId === expectedRequestId &&
      parsed.state === "ready" &&
      parsed.requestId === null;
    if (
      expectedRequestId !== null &&
      parsed.requestId !== expectedRequestId &&
      !cancelledRequestReturnedReady
    ) return false;
    if (
      localIntakeWorkspaceArtifact &&
      localIntakeWorkspaceArtifact.requestId !== null &&
      localIntakeWorkspaceArtifact.requestId === parsed.requestId
    ) {
      const currentIsTerminal = ["stored", "failed", "deleted"].includes(localIntakeWorkspaceArtifact.state);
      if (currentIsTerminal && parsed.state !== localIntakeWorkspaceArtifact.state) return false;
      if (
        pendingLocalIntakeWorkspaceCancellationId === parsed.requestId &&
        ["copying", "verifying"].includes(parsed.state)
      ) return false;
    }
    const previousRequestId = localIntakeWorkspaceArtifact && localIntakeWorkspaceArtifact.requestId;
    const previousWorkspaceSha256 = localIntakeWorkspaceArtifact &&
      localIntakeWorkspaceArtifact.workspace &&
      localIntakeWorkspaceArtifact.workspace.workspaceSha256;
    const nextWorkspaceSha256 = parsed.workspace && parsed.workspace.workspaceSha256;
    if (previousRequestId !== parsed.requestId || previousWorkspaceSha256 !== nextWorkspaceSha256) {
      downloadedLocalIntakeWorkspaceReport = false;
      confirmDeleteLocalIntakeWorkspace.checked = false;
    }
    localIntakeWorkspaceArtifact = parsed;
    if (pendingLocalIntakeWorkspaceRequestId === parsed.requestId) {
      pendingLocalIntakeWorkspaceRequestId = null;
    }
    if (
      pendingLocalIntakeWorkspaceCancellationId !== null &&
      (!localIntakeWorkspaceIsActive(parsed) || cancelledRequestReturnedReady)
    ) {
      pendingLocalIntakeWorkspaceCancellationId = null;
    }
    if (
      pendingLocalIntakeWorkspaceDeletionId === parsed.requestId &&
      parsed.state !== "deleting"
    ) {
      pendingLocalIntakeWorkspaceDeletionId = null;
    }

    localIntakeWorkspacePanel.hidden = false;
    localIntakeWorkspaceStatus.dataset.state = parsed.state;
    clearPanelError(localIntakeWorkspaceError);
    const start = byId("start-local-intake-workspace-button");
    const cancel = byId("cancel-local-intake-workspace-button");
    const download = byId("download-local-intake-workspace-report-button");
    const deleteButton = byId("delete-local-intake-workspace-button");
    const copyActive = ["copying", "verifying"].includes(parsed.state);
    const deleteable = parsed.state === "stored" || (
      parsed.state === "failed" &&
      parsed.operation === "delete_local_workspace_copy" &&
      parsed.workspace !== null
    );
    start.hidden = !["unavailable", "ready", "failed"].includes(parsed.state) || deleteable;
    start.disabled = parsed.state !== "ready";
    start.textContent = parsed.state === "ready"
      ? "Keep verified copy"
      : parsed.state === "failed"
        ? "Start a new local session to try again"
        : "Local workspace unavailable";
    cancel.hidden = !copyActive;
    cancel.disabled = !copyActive;
    download.hidden = parsed.state !== "stored";
    download.disabled = parsed.state !== "stored";
    download.textContent = downloadedLocalIntakeWorkspaceReport
      ? "Download workspace record again"
      : "Download workspace record";
    localIntakeWorkspaceDelete.hidden = !deleteable;
    if (!deleteable) confirmDeleteLocalIntakeWorkspace.checked = false;
    deleteButton.disabled = !deleteable || !confirmDeleteLocalIntakeWorkspace.checked;

    localIntakeWorkspaceProgressFacts.hidden = parsed.progress === null;
    if (parsed.progress !== null) {
      setText(
        "local-intake-workspace-copied-files",
        parsed.progress.copiedFileCount.toLocaleString() + " of " + parsed.progress.fileCount.toLocaleString()
      );
      setText(
        "local-intake-workspace-copied-bytes",
        formatBytes(parsed.progress.copiedBytes) + " of " + formatBytes(parsed.progress.totalBytes)
      );
    }
    const ratio = parsed.progress !== null
      ? parsed.progress.totalBytes > 0
        ? parsed.progress.copiedBytes / parsed.progress.totalBytes
        : parsed.progress.fileCount > 0
          ? parsed.progress.copiedFileCount / parsed.progress.fileCount
          : ["stored", "deleted"].includes(parsed.state) ? 1 : 0
      : ["stored", "deleted"].includes(parsed.state) ? 1 : 0;
    const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    localIntakeWorkspaceMeter.setAttribute("aria-valuenow", String(percent));
    localIntakeWorkspaceMeter.setAttribute("aria-valuetext", percent + "% of the verified local copy completed");
    byId("local-intake-workspace-meter-bar").style.transform = "scaleX(" + ratio + ")";

    localIntakeWorkspaceResult.hidden = parsed.workspace === null;
    if (parsed.workspace !== null) {
      setText("local-intake-workspace-file-count", parsed.workspace.fileCount.toLocaleString());
      setText("local-intake-workspace-total-bytes", formatBytes(parsed.workspace.totalBytes));
      setText("local-intake-workspace-sha", parsed.workspace.workspaceSha256);
      setText("local-intake-workspace-truth-pending-review", parsed.workspace.truth.pendingReview.toLocaleString());
      setText("local-intake-workspace-truth-admitted", parsed.workspace.truth.admitted.toLocaleString());
      setText("local-intake-workspace-truth-excluded", parsed.workspace.truth.excluded.toLocaleString());
      setText("local-intake-workspace-truth-captured", parsed.workspace.truth.captured.toLocaleString());
      setText("local-intake-workspace-truth-enhanced-captured", parsed.workspace.truth.enhancedCaptured.toLocaleString());
      setText("local-intake-workspace-truth-generated-cinematic", parsed.workspace.truth.generatedCinematic.toLocaleString());
      setText("local-intake-workspace-truth-concept-imagination", parsed.workspace.truth.conceptImagination.toLocaleString());
    }

    if (parsed.state === "ready") {
      setText("local-intake-workspace-status-heading", "Ready to keep a verified local copy");
      setText("local-intake-workspace-status-copy", parsed.message);
      clearLocalIntakeWorkspacePoll();
    } else if (parsed.state === "copying") {
      setText("local-intake-workspace-status-heading", "Copying the checked source");
      setText("local-intake-workspace-status-copy", parsed.message);
      scheduleLocalIntakeWorkspacePoll();
    } else if (parsed.state === "verifying") {
      setText("local-intake-workspace-status-heading", "Verifying every copied file");
      setText("local-intake-workspace-status-copy", parsed.message);
      scheduleLocalIntakeWorkspacePoll();
    } else if (parsed.state === "stored") {
      setText("local-intake-workspace-status-heading", "Verified local copy stored");
      setText("local-intake-workspace-status-copy", parsed.message);
      clearLocalIntakeWorkspacePoll();
    } else if (parsed.state === "deleting") {
      setText("local-intake-workspace-status-heading", "Deleting the local copy and stopping");
      setText("local-intake-workspace-status-copy", parsed.message);
      scheduleLocalIntakeWorkspacePoll();
    } else if (parsed.state === "deleted") {
      setText("local-intake-workspace-status-heading", "Local workspace copy deleted");
      setText("local-intake-workspace-status-copy", parsed.message);
      clearLocalIntakeWorkspacePoll();
      clearVerificationPoll();
      clearPreparedHdPoll();
      clearPhotoQualityPoll();
      clearCapturedQualityPoll();
      clearOfflinePreviewPoll();
      stopButton.disabled = true;
      statusHeading.textContent = "Local copy deleted; session stopping";
      statusCopy.textContent = "The original source is unchanged. You can close this tab.";
      window.sessionStorage.removeItem(sessionKey);
    } else if (parsed.state === "failed") {
      const deletionFailed = parsed.operation === "delete_local_workspace_copy" && parsed.workspace !== null;
      setText(
        "local-intake-workspace-status-heading",
        deletionFailed ? "The local copy was not deleted" : "The local copy could not be completed"
      );
      setText("local-intake-workspace-status-copy", parsed.message);
      showPanelError(
        localIntakeWorkspaceError,
        deletionFailed
          ? "The verified local copy remains in place. Confirm again to retry, or stop the session without deleting it."
          : "No verified local copy was retained. Start a new local session after checking the workspace setup."
      );
      clearLocalIntakeWorkspacePoll();
    } else {
      setText("local-intake-workspace-status-heading", "Local workspace is not available");
      setText("local-intake-workspace-status-copy", parsed.message);
      clearLocalIntakeWorkspacePoll();
    }
    if (focusHeading) {
      const heading = byId("local-intake-workspace-status-heading");
      heading.tabIndex = -1;
      heading.focus();
    }
    updateSessionCountdown();
    return true;
  }

  async function pollLocalIntakeWorkspace() {
    if (
      !localIntakeWorkspaceArtifact ||
      !localIntakeWorkspaceIsActive(localIntakeWorkspaceArtifact) ||
      typeof localIntakeWorkspaceArtifact.requestId !== "string"
    ) return;
    const expectedRequestId = localIntakeWorkspaceArtifact.requestId;
    try {
      const value = await postJson("/api/local-intake-workspace/status", { requestId: expectedRequestId });
      if (!localIntakeWorkspaceArtifact || localIntakeWorkspaceArtifact.requestId !== expectedRequestId) return;
      renderLocalIntakeWorkspace(value, false, expectedRequestId);
    } catch (error) {
      if (localIntakeWorkspaceArtifact && localIntakeWorkspaceArtifact.requestId === expectedRequestId) {
        showPanelError(
          localIntakeWorkspaceError,
          error instanceof Error ? error.message : "The local-workspace status could not be checked."
        );
        scheduleLocalIntakeWorkspacePoll();
      }
    }
  }

  async function recoverLocalIntakeWorkspaceAfterLostResponse(requestId) {
    try {
      const value = await postJson("/api/local-intake-workspace/status", { requestId });
      return renderLocalIntakeWorkspace(value, true, requestId);
    } catch (_error) {
      return false;
    }
  }

  async function downloadLocalIntakeWorkspaceReport(button) {
    if (
      !localIntakeWorkspaceArtifact ||
      localIntakeWorkspaceArtifact.state !== "stored" ||
      typeof localIntakeWorkspaceArtifact.requestId !== "string" ||
      !localIntakeWorkspaceArtifact.workspace ||
      !isCapturedQualityDigest(localIntakeWorkspaceArtifact.workspace.workspaceSha256)
    ) {
      throw new Error("The verified local-workspace record is no longer current.");
    }
    const expectedRequestId = localIntakeWorkspaceArtifact.requestId;
    const expectedWorkspaceDigest = localIntakeWorkspaceArtifact.workspace.workspaceSha256;
    button.disabled = true;
    try {
      const response = await fetch(apiUrl("/api/local-intake-workspace/report"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: expectedRequestId }),
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "The workspace record could not be downloaded."));
      }
      const blob = await response.blob();
      if (
        !localIntakeWorkspaceArtifact ||
        localIntakeWorkspaceArtifact.state !== "stored" ||
        localIntakeWorkspaceArtifact.requestId !== expectedRequestId ||
        !localIntakeWorkspaceArtifact.workspace ||
        localIntakeWorkspaceArtifact.workspace.workspaceSha256 !== expectedWorkspaceDigest
      ) {
        throw new Error("The local-workspace result changed while its record was being checked.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "foundry-local-intake-workspace-record-v0.json";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      return true;
    } finally {
      button.disabled = false;
    }
  }

  function localIntakeWorkspaceNeedsAttention() {
    return localIntakeWorkspaceIsActive(localIntakeWorkspaceArtifact);
  }

  function clearLocalIntakeWorkspaceClientState() {
    clearLocalIntakeWorkspacePoll();
    localIntakeWorkspaceArtifact = null;
    pendingLocalIntakeWorkspaceRequestId = null;
    pendingLocalIntakeWorkspaceCancellationId = null;
    pendingLocalIntakeWorkspaceDeletionId = null;
    downloadedLocalIntakeWorkspaceReport = false;
    confirmDeleteLocalIntakeWorkspace.checked = false;
  }

  function parsePhotoCaptureQuality(value) {
    if (!hasExactObjectKeys(value, [
      "state",
      "runRevision",
      "message",
      "receiptSha256",
      "requestId",
      "candidates",
      "progress",
      "report",
      "failureCode"
    ])) {
      throw new Error("The local server returned a photo-workbench field this page does not accept.");
    }
    const states = ["unavailable", "ready", "running", "completed", "cancelled", "failed"];
    const phases = ["unavailable", "ready", "reading_pixels", "binding_report", "completed", "cancelled", "failed"];
    if (!states.includes(value.state) || typeof value.message !== "string" || value.message.length < 1 || value.message.length > 500) {
      throw new Error("The local server returned an unknown photo-workbench boundary.");
    }
    if (!Number.isSafeInteger(value.runRevision) || value.runRevision < 0 || value.runRevision > 1000000) {
      throw new Error("The local server returned an invalid photo-workbench run revision.");
    }
    if (value.receiptSha256 !== null && !isCapturedQualityDigest(value.receiptSha256)) {
      throw new Error("The local server returned an invalid photo-workbench receipt reference.");
    }
    if (value.requestId !== null && (typeof value.requestId !== "string" || !/^[a-f0-9]{32}$/.test(value.requestId))) {
      throw new Error("The local server returned an invalid photo-workbench request reference.");
    }
    if (value.failureCode !== null && (typeof value.failureCode !== "string" || !/^[A-Z0-9_]{3,128}$/.test(value.failureCode))) {
      throw new Error("The local server returned an invalid photo-workbench failure code.");
    }
    if (!Array.isArray(value.candidates) || value.candidates.length > 500) {
      throw new Error("The local server returned an invalid photo-workbench candidate list.");
    }
    const candidatePaths = new Set();
    for (const candidate of value.candidates) {
      if (
        !hasExactObjectKeys(candidate, ["path", "mediaType", "sizeBytes", "suggestedRole", "assignedRole", "protocolSlot"]) ||
        !isPhotoQualityRelativePath(candidate.path) ||
        !["image/jpeg", "image/png"].includes(candidate.mediaType) ||
        !Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes < 0 ||
        !["build", "heldout", "ignore"].includes(candidate.suggestedRole) ||
        (candidate.assignedRole !== null && !["build", "heldout", "ignore"].includes(candidate.assignedRole)) ||
        (candidate.protocolSlot !== null && (typeof candidate.protocolSlot !== "string" || !/^RR-PILOT-(?:MAP-[AB]-0[1-9]|S0[1-6]-[AB])$/.test(candidate.protocolSlot))) ||
        candidatePaths.has(candidate.path)
      ) {
        throw new Error("The local server returned an invalid photo-workbench candidate.");
      }
      candidatePaths.add(candidate.path);
    }
    if (
      !hasExactObjectKeys(value.progress, ["phase", "completed", "total", "currentPath"]) ||
      !phases.includes(value.progress.phase) ||
      !Number.isSafeInteger(value.progress.completed) || value.progress.completed < 0 ||
      !Number.isSafeInteger(value.progress.total) || value.progress.total < 0 ||
      value.progress.completed > value.progress.total ||
      (value.progress.currentPath !== null && (!isPhotoQualityRelativePath(value.progress.currentPath) || !candidatePaths.has(value.progress.currentPath)))
    ) {
      throw new Error("The local server returned invalid photo-workbench progress.");
    }
    if (value.report !== null) {
      const reportKeys = [
        "schemaVersion", "reportSha256", "generatedAt", "readiness", "protocolStatus",
        "buildCount", "heldoutCount", "ignoredCount", "passCount", "reviewCount", "retakeCount",
        "missingBuildSlots", "missingHeldoutSlots", "duplicateSlots", "misassignedSlots", "unmatchedAssignedPaths",
        "similarityFindings", "photos"
      ];
      if (
        !hasExactObjectKeys(value.report, reportKeys) ||
        value.report.schemaVersion !== "omnitwin.foundry.photo-capture-quality-report.v0" ||
        !isCapturedQualityDigest(value.report.reportSha256) ||
        typeof value.report.generatedAt !== "string" || !Number.isFinite(Date.parse(value.report.generatedAt)) ||
        !["capture_quality_ready", "review_required", "retake_required"].includes(value.report.readiness) ||
        !["complete_unreviewed", "incomplete"].includes(value.report.protocolStatus)
      ) {
        throw new Error("The local server returned an invalid photo-workbench report summary.");
      }
      for (const key of ["buildCount", "heldoutCount", "ignoredCount", "passCount", "reviewCount", "retakeCount"]) {
        if (!Number.isSafeInteger(value.report[key]) || value.report[key] < 0 || value.report[key] > 500) {
          throw new Error("The local server returned an invalid photo-workbench report count.");
        }
      }
      for (const key of ["missingBuildSlots", "missingHeldoutSlots", "duplicateSlots", "misassignedSlots"]) {
        if (!Array.isArray(value.report[key]) || value.report[key].length > 30 || value.report[key].some((slot) => typeof slot !== "string" || !/^RR-PILOT-(?:MAP-[AB]-0[1-9]|S0[1-6]-[AB])$/.test(slot))) {
          throw new Error("The local server returned invalid photo-workbench protocol gaps.");
        }
      }
      if (!Array.isArray(value.report.unmatchedAssignedPaths) || value.report.unmatchedAssignedPaths.length > 500 || value.report.unmatchedAssignedPaths.some((path) => !isPhotoQualityRelativePath(path) || !candidatePaths.has(path))) {
        throw new Error("The local server returned invalid unmatched photo-workbench assignments.");
      }
      if (!Array.isArray(value.report.photos) || value.report.photos.length > 500 || !Array.isArray(value.report.similarityFindings) || value.report.similarityFindings.length > 4000) {
        throw new Error("The local server returned an invalid photo-workbench evidence list.");
      }
      const imageIds = new Set();
      for (const photo of value.report.photos) {
        if (
          !hasExactObjectKeys(photo, [
            "imageId", "path", "role", "protocolSlot", "verdict", "decodeStatus",
            "megapixels", "tenengrad", "shadowClippedFraction", "highlightClippedFraction",
            "rawCounterpartState", "issues", "thumbnail"
          ]) ||
          typeof photo.imageId !== "string" || !/^photo-[a-f0-9]{24}$/.test(photo.imageId) || imageIds.has(photo.imageId) ||
          !isPhotoQualityRelativePath(photo.path) || !candidatePaths.has(photo.path) ||
          !["build", "heldout"].includes(photo.role) ||
          (photo.protocolSlot !== null && (typeof photo.protocolSlot !== "string" || !/^RR-PILOT-(?:MAP-[AB]-0[1-9]|S0[1-6]-[AB])$/.test(photo.protocolSlot))) ||
          !["pass", "review", "retake"].includes(photo.verdict) ||
          !["decoded", "decode_failed"].includes(photo.decodeStatus) ||
          !["present_unreviewed", "missing"].includes(photo.rawCounterpartState) ||
          !Array.isArray(photo.issues) || photo.issues.length > 16
        ) {
          throw new Error("The local server returned an invalid photo-workbench photo result.");
        }
        imageIds.add(photo.imageId);
        for (const issue of photo.issues) {
          if (!hasExactObjectKeys(issue, ["code", "severity", "guidance"]) || typeof issue.code !== "string" || !/^[a-z_]{3,64}$/.test(issue.code) || !["review", "retake"].includes(issue.severity) || typeof issue.guidance !== "string" || issue.guidance.length < 1 || issue.guidance.length > 500) {
            throw new Error("The local server returned invalid photo-workbench guidance.");
          }
        }
        if (photo.decodeStatus === "decoded") {
          if (
            !Number.isFinite(photo.megapixels) || photo.megapixels <= 0 ||
            !Number.isFinite(photo.tenengrad) || photo.tenengrad < 0 ||
            !Number.isFinite(photo.shadowClippedFraction) || photo.shadowClippedFraction < 0 || photo.shadowClippedFraction > 1 ||
            !Number.isFinite(photo.highlightClippedFraction) || photo.highlightClippedFraction < 0 || photo.highlightClippedFraction > 1 ||
            !hasExactObjectKeys(photo.thumbnail, ["mediaType", "sha256", "widthPx", "heightPx"]) ||
            photo.thumbnail.mediaType !== "image/webp" || !isCapturedQualityDigest(photo.thumbnail.sha256) ||
            !Number.isSafeInteger(photo.thumbnail.widthPx) || photo.thumbnail.widthPx < 1 ||
            !Number.isSafeInteger(photo.thumbnail.heightPx) || photo.thumbnail.heightPx < 1
          ) {
            throw new Error("The local server returned invalid decoded photo metrics.");
          }
        } else if (photo.megapixels !== null || photo.tenengrad !== null || photo.shadowClippedFraction !== null || photo.highlightClippedFraction !== null || photo.thumbnail !== null) {
          throw new Error("The local server returned inconsistent failed-decode evidence.");
        }
      }
      for (const finding of value.report.similarityFindings) {
        if (
          !hasExactObjectKeys(finding, ["leftImageId", "rightImageId", "kind", "hammingDistance", "guidance"]) ||
          !imageIds.has(finding.leftImageId) || !imageIds.has(finding.rightImageId) || finding.leftImageId === finding.rightImageId ||
          !["within_role_near_duplicate", "cross_role_holdout_overlap_risk"].includes(finding.kind) ||
          !Number.isSafeInteger(finding.hammingDistance) || finding.hammingDistance < 0 || finding.hammingDistance > 5 ||
          typeof finding.guidance !== "string" || finding.guidance.length < 1 || finding.guidance.length > 500
        ) {
          throw new Error("The local server returned an invalid photo-workbench similarity finding.");
        }
      }
      if (
        value.report.buildCount + value.report.heldoutCount + value.report.ignoredCount !== value.candidates.length ||
        value.report.photos.length !== value.report.buildCount + value.report.heldoutCount ||
        value.report.passCount + value.report.reviewCount + value.report.retakeCount !== value.report.photos.length
      ) {
        throw new Error("The local server returned internally inconsistent photo-workbench counts.");
      }
    }
    const ready = value.state === "ready" && value.receiptSha256 !== null && value.requestId === null && value.candidates.length > 0 && value.failureCode === null && value.report === null && value.progress.phase === "ready" && value.progress.total === 0;
    const unavailable = value.state === "unavailable" && value.requestId === null && value.candidates.length === 0 && value.failureCode === null && value.report === null && value.progress.phase === "unavailable";
    const running = value.state === "running" && value.receiptSha256 !== null && value.requestId !== null && value.candidates.length > 0 && value.failureCode === null && value.report === null && ["reading_pixels", "binding_report"].includes(value.progress.phase);
    const completed = value.state === "completed" && value.receiptSha256 !== null && value.requestId !== null && value.failureCode === null && value.report !== null && value.progress.phase === "completed" && value.progress.completed === value.progress.total;
    const cancelled = value.state === "cancelled" && value.requestId !== null && value.failureCode === null && value.report === null && value.progress.phase === "cancelled";
    const failed = value.state === "failed" && value.requestId !== null && value.failureCode !== null && value.report === null && value.progress.phase === "failed";
    if (!ready && !unavailable && !running && !completed && !cancelled && !failed) {
      throw new Error("The local server returned an internally inconsistent photo-workbench state.");
    }
    return value;
  }

  function clearPhotoQualityPoll() {
    if (photoQualityPollTimer !== null) window.clearTimeout(photoQualityPollTimer);
    photoQualityPollTimer = null;
  }

  function schedulePhotoQualityPoll() {
    if (photoQualityPollTimer !== null || !photoQualityArtifact || photoQualityArtifact.state !== "running" || typeof photoQualityArtifact.requestId !== "string") return;
    photoQualityPollTimer = window.setTimeout(() => {
      photoQualityPollTimer = null;
      void pollPhotoCaptureQuality();
    }, PHOTO_QUALITY_POLL_MS);
  }

  function updatePhotoAssignmentCounts() {
    if (!photoQualityArtifact) return;
    const counts = { build: 0, heldout: 0, ignore: 0 };
    photoQualityArtifact.candidates.forEach((_candidate, index) => {
      const select = document.getElementById("photo-quality-role-" + index);
      const role = select instanceof HTMLSelectElement ? select.value : "ignore";
      if (Object.prototype.hasOwnProperty.call(counts, role)) counts[role] += 1;
    });
    setText("photo-quality-build-count", counts.build + " / 18");
    setText("photo-quality-heldout-count", counts.heldout + " / 12");
    setText("photo-quality-ignore-count", counts.ignore.toLocaleString());
  }

  function renderPhotoAssignments(candidates, locked) {
    const signature = JSON.stringify(candidates.map((candidate) => [candidate.path, candidate.suggestedRole, candidate.assignedRole, candidate.protocolSlot]));
    if (signature !== photoQualityAssignmentSignature) {
      photoQualityAssignmentSignature = signature;
      photoQualityAssignments.replaceChildren();
      candidates.forEach((candidate, index) => {
        const row = element("div", "photo-quality-assignment");
        const copy = element("div", "photo-quality-assignment-copy");
        copy.append(element("strong", "", candidate.path));
        copy.append(element("span", "", (candidate.protocolSlot || "Not in the 30-photo naming protocol") + " · " + candidate.mediaType.replace("image/", "").toUpperCase() + " · " + formatBytes(candidate.sizeBytes)));
        const label = element("label");
        label.htmlFor = "photo-quality-role-" + index;
        label.append(
          element("span", "", "Use in pilot"),
          element("span", "sr-only", " for " + candidate.path)
        );
        const select = document.createElement("select");
        select.id = "photo-quality-role-" + index;
        for (const optionSpec of [
          ["build", "Build input"],
          ["heldout", "Held-out test"],
          ["ignore", "Ignore in this check"]
        ]) {
          const option = document.createElement("option");
          option.value = optionSpec[0];
          option.textContent = optionSpec[1];
          option.selected = (candidate.assignedRole || candidate.suggestedRole) === optionSpec[0];
          select.append(option);
        }
        select.addEventListener("change", updatePhotoAssignmentCounts);
        label.append(select);
        row.append(copy, label);
        photoQualityAssignments.append(row);
      });
    }
    for (const select of photoQualityAssignments.querySelectorAll("select")) select.disabled = locked;
    updatePhotoAssignmentCounts();
  }

  function photoThumbnailUrl(requestId, photo) {
    return "/api/photo-capture-quality/thumbnail" +
      "?token=" + encodeURIComponent(token) +
      "&requestId=" + encodeURIComponent(requestId) +
      "&imageId=" + encodeURIComponent(photo.imageId) +
      "&digest=" + encodeURIComponent(photo.thumbnail.sha256);
  }

  function renderPhotoQualityResults(parsed) {
    const report = parsed.report;
    photoQualityResults.hidden = false;
    setText("photo-quality-readiness", report.readiness.replaceAll("_", " "));
    setText("photo-quality-pass-count", report.passCount.toLocaleString());
    setText("photo-quality-review-count", report.reviewCount.toLocaleString());
    setText("photo-quality-retake-count", report.retakeCount.toLocaleString());
    setText("photo-quality-protocol-status", report.protocolStatus === "complete_unreviewed" ? "30 slots complete · unreviewed" : "Incomplete");
    setText("photo-quality-report-sha", report.reportSha256);
    const gapGroups = [
      ["Missing build slots", report.missingBuildSlots],
      ["Missing held-out slots", report.missingHeldoutSlots],
      ["Duplicate slots", report.duplicateSlots],
      ["Misassigned slots", report.misassignedSlots],
      ["Assigned photos outside the naming protocol", report.unmatchedAssignedPaths]
    ].filter((entry) => entry[1].length > 0);
    photoQualityProtocolGaps.replaceChildren();
    photoQualityProtocolGaps.hidden = gapGroups.length === 0;
    if (gapGroups.length > 0) {
      photoQualityProtocolGaps.append(element("strong", "", "Repair the 30-photo protocol"));
      const list = element("ul");
      gapGroups.forEach((entry) => list.append(element("li", "", entry[0] + ": " + entry[1].join(", "))));
      photoQualityProtocolGaps.append(list);
    }
    photoQualityContactSheet.replaceChildren();
    for (const photo of report.photos) {
      const card = element("article", "photo-quality-card");
      if (photo.thumbnail !== null) {
        const image = document.createElement("img");
        image.alt = "Local preview of " + photo.path;
        image.loading = "lazy";
        image.decoding = "async";
        image.width = photo.thumbnail.widthPx;
        image.height = photo.thumbnail.heightPx;
        image.src = photoThumbnailUrl(parsed.requestId, photo);
        card.append(image);
      } else {
        card.append(element("div", "photo-quality-image-fallback", "Pixels could not be decoded"));
      }
      const copy = element("div", "photo-quality-card-copy");
      const title = element("div", "photo-quality-card-title");
      title.append(element("strong", "", photo.path));
      const verdict = element("span", "photo-quality-verdict", photo.verdict);
      verdict.dataset.verdict = photo.verdict;
      title.append(verdict);
      copy.append(title);
      const metrics = photo.decodeStatus === "decoded"
        ? photo.megapixels.toFixed(1) + " MP · edge score " + photo.tenengrad.toFixed(5) + " · " + photo.role
        : "Decode failed · " + photo.role;
      copy.append(element("p", "photo-quality-card-meta", metrics + " · RAW " + (photo.rawCounterpartState === "present_unreviewed" ? "present, unreviewed" : "missing")));
      const issues = element("ul", "photo-quality-issues");
      if (photo.issues.length === 0) issues.append(element("li", "", "No frozen capture-quality warning."));
      else photo.issues.forEach((issue) => issues.append(element("li", "", issue.guidance)));
      copy.append(issues);
      card.append(copy);
      photoQualityContactSheet.append(card);
    }
    photoQualitySimilarity.replaceChildren();
    photoQualitySimilarity.hidden = report.similarityFindings.length === 0;
    if (report.similarityFindings.length > 0) {
      photoQualitySimilarity.append(element("h5", "", "Near-duplicate and split-overlap review"));
      const list = element("ul");
      const photoPaths = new Map(report.photos.map((photo) => [photo.imageId, photo.path]));
      report.similarityFindings.forEach((finding) => {
        const leftPath = photoPaths.get(finding.leftImageId) || finding.leftImageId;
        const rightPath = photoPaths.get(finding.rightImageId) || finding.rightImageId;
        list.append(element("li", "", leftPath + " ↔ " + rightPath + ": " + finding.guidance + " Hamming distance: " + finding.hammingDistance + "."));
      });
      photoQualitySimilarity.append(list);
    }
  }

  function showPhotoQualityBoundaryFailure(message) {
    clearPhotoQualityPoll();
    photoQualityArtifact = null;
    pendingPhotoQualityRequestId = null;
    photoQualityPanel.hidden = false;
    photoQualityStatus.dataset.state = "failed";
    setText("photo-quality-status-heading", "Photo information is unavailable");
    setText("photo-quality-status-copy", "Nothing was accepted as a capture-quality result.");
    byId("photo-quality-meter-bar").style.transform = "scaleX(0)";
    photoQualityResults.hidden = true;
    byId("start-photo-quality-button").disabled = true;
    byId("cancel-photo-quality-button").hidden = true;
    byId("download-photo-quality-report-button").hidden = true;
    showPanelError(photoQualityError, message);
  }

  function renderPhotoCaptureQuality(value, focusHeading = false, expectedRequestId = null) {
    let parsed;
    try {
      parsed = parsePhotoCaptureQuality(value);
    } catch (error) {
      showPhotoQualityBoundaryFailure(error instanceof Error ? error.message : "The photo-workbench status could not be checked safely.");
      return false;
    }
    if (expectedRequestId !== null && parsed.requestId !== expectedRequestId) return false;
    if (photoQualityArtifact && parsed.runRevision < photoQualityArtifact.runRevision) return false;
    if (photoQualityArtifact && photoQualityArtifact.runRevision === parsed.runRevision && photoQualityArtifact.requestId !== null && photoQualityArtifact.requestId === parsed.requestId) {
      const terminal = ["completed", "cancelled", "failed"].includes(photoQualityArtifact.state);
      if (terminal && parsed.state !== photoQualityArtifact.state) return false;
      if (pendingPhotoQualityCancellationId === parsed.requestId && parsed.state === "running") return false;
    }
    if (parsed.state === "unavailable" && photoQualityArtifact === null) {
      clearPhotoQualityPoll();
      photoQualityPanel.hidden = true;
      return true;
    }
    const previousRequestId = photoQualityArtifact && photoQualityArtifact.requestId;
    if (previousRequestId !== parsed.requestId) downloadedPhotoQualityReport = false;
    photoQualityArtifact = parsed;
    if (pendingPhotoQualityRequestId === parsed.requestId) pendingPhotoQualityRequestId = null;
    if (pendingPhotoQualityCancellationId === parsed.requestId && ["completed", "cancelled", "failed"].includes(parsed.state)) pendingPhotoQualityCancellationId = null;
    photoQualityPanel.hidden = false;
    photoQualityStatus.dataset.state = parsed.state;
    clearPanelError(photoQualityError);
    const locked = ["running", "completed", "failed"].includes(parsed.state);
    renderPhotoAssignments(parsed.candidates, locked);
    const start = byId("start-photo-quality-button");
    const cancel = byId("cancel-photo-quality-button");
    const download = byId("download-photo-quality-report-button");
    start.hidden = ["running", "completed"].includes(parsed.state);
    start.disabled = !["ready", "cancelled"].includes(parsed.state);
    start.textContent = parsed.state === "cancelled" ? "Check these photos again" : parsed.state === "failed" ? "Start a new local session to try again" : "Check these photos";
    cancel.hidden = parsed.state !== "running";
    download.hidden = parsed.state !== "completed";
    download.textContent = downloadedPhotoQualityReport ? "Download photo report again" : "Download photo report";
    photoQualityResults.hidden = parsed.state !== "completed";
    const fraction = parsed.progress.total > 0 ? Math.min(1, parsed.progress.completed / parsed.progress.total) : parsed.state === "completed" ? 1 : 0;
    byId("photo-quality-meter-bar").style.transform = "scaleX(" + fraction.toFixed(4) + ")";
    const meter = byId("photo-quality-meter");
    meter.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
    meter.setAttribute("aria-valuetext", parsed.progress.total > 0 ? parsed.progress.completed + " of " + parsed.progress.total + " selected photos" : parsed.message);
    const liveBucket = parsed.progress.total > 0 ? Math.floor(fraction * 4) : 0;
    const liveSignature = parsed.state + ":" + parsed.progress.phase + ":" + liveBucket;
    if (liveSignature !== photoQualityLiveSignature) {
      photoQualityLiveSignature = liveSignature;
      setText("photo-quality-live", parsed.state === "running" ? parsed.progress.completed + " of " + parsed.progress.total + " selected photos checked." : parsed.message);
    }
    if (parsed.state === "ready") {
      setText("photo-quality-status-heading", "Confirm the build and held-out split");
      setText("photo-quality-status-copy", parsed.message);
      clearPhotoQualityPoll();
    } else if (parsed.state === "running") {
      setText("photo-quality-status-heading", parsed.progress.phase === "binding_report" ? "Binding the final report" : "Checking the real photo pixels");
      setText("photo-quality-status-copy", parsed.message + " " + parsed.progress.completed + " of " + parsed.progress.total + " selected photos complete.");
      schedulePhotoQualityPoll();
    } else if (parsed.state === "completed") {
      setText("photo-quality-status-heading", "Photo capture check complete");
      setText("photo-quality-status-copy", parsed.message);
      renderPhotoQualityResults(parsed);
      clearPhotoQualityPoll();
    } else if (parsed.state === "cancelled") {
      setText("photo-quality-status-heading", "Photo check cancelled");
      setText("photo-quality-status-copy", parsed.message);
      clearPhotoQualityPoll();
    } else if (parsed.state === "failed") {
      setText("photo-quality-status-heading", "The photo check did not finish");
      setText("photo-quality-status-copy", parsed.message);
      showPanelError(photoQualityError, "Result not retained: " + parsed.failureCode + ". Start a new local session before trying again.");
      clearPhotoQualityPoll();
    }
    if (focusHeading) {
      const heading = byId("photo-quality-status-heading");
      heading.tabIndex = -1;
      heading.focus();
    }
    updateSessionCountdown();
    return true;
  }

  async function pollPhotoCaptureQuality() {
    if (!photoQualityArtifact || photoQualityArtifact.state !== "running" || typeof photoQualityArtifact.requestId !== "string") return;
    const expectedRequestId = photoQualityArtifact.requestId;
    try {
      const value = await postJson("/api/photo-capture-quality/status", { requestId: expectedRequestId });
      if (!photoQualityArtifact || photoQualityArtifact.requestId !== expectedRequestId) return;
      renderPhotoCaptureQuality(value, false, expectedRequestId);
    } catch (error) {
      if (photoQualityArtifact && photoQualityArtifact.requestId === expectedRequestId) {
        showPanelError(photoQualityError, error instanceof Error ? error.message : "The photo-workbench status could not be checked.");
        schedulePhotoQualityPoll();
      }
    }
  }

  async function recoverPhotoQualityAfterLostResponse(requestId) {
    try {
      const value = await postJson("/api/photo-capture-quality/status", { requestId });
      return renderPhotoCaptureQuality(value, true, requestId);
    } catch (_error) {
      return false;
    }
  }

  function parseCapturedQualityComparison(value) {
    if (!hasExactObjectKeys(value, [
      "state",
      "requestId",
      "authority",
      "winner",
      "message",
      "failureCode",
      "progress",
      "report"
    ])) {
      throw new Error("The local server returned a captured-quality field this page does not accept.");
    }
    const states = ["unavailable", "ready", "running", "completed", "failed"];
    const phases = [
      "unavailable",
      "ready",
      "starting",
      "verifying_sources",
      "starting_renderer",
      "capturing",
      "scoring",
      "finalizing",
      "completed",
      "failed"
    ];
    if (!states.includes(value.state) || value.authority !== "none" || value.winner !== "not_selected") {
      throw new Error("The local server returned an unknown captured-quality boundary.");
    }
    if (
      value.requestId !== null &&
      (typeof value.requestId !== "string" || !/^[a-f0-9]{32}$/.test(value.requestId))
    ) {
      throw new Error("The local server returned an invalid captured-quality request reference.");
    }
    if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > 500) {
      throw new Error("The local server returned an invalid captured-quality message.");
    }
    if (
      value.failureCode !== null &&
      (typeof value.failureCode !== "string" || !/^[A-Z0-9_]{3,128}$/.test(value.failureCode))
    ) {
      throw new Error("The local server returned an invalid captured-quality failure code.");
    }
    if (
      !hasExactObjectKeys(value.progress, ["phase", "completed", "total"]) ||
      !phases.includes(value.progress.phase) ||
      !Number.isSafeInteger(value.progress.completed) ||
      !Number.isSafeInteger(value.progress.total) ||
      value.progress.completed < 0 ||
      value.progress.total < 0 ||
      value.progress.completed > value.progress.total
    ) {
      throw new Error("The local server returned invalid captured-quality progress.");
    }
    if (value.report !== null) {
      if (
        !hasExactObjectKeys(value.report, [
          "schemaVersion",
          "reportSha256",
          "generatedAt",
          "sourceReceiptSha256",
          "rendererProfileId",
          "viewCount",
          "captureCount",
          "pairMetricCount"
        ]) ||
        value.report.schemaVersion !== "omnitwin.foundry.captured-quality-comparison-report.v0" ||
        !isCapturedQualityDigest(value.report.reportSha256) ||
        (value.report.sourceReceiptSha256 !== null && !isCapturedQualityDigest(value.report.sourceReceiptSha256)) ||
        typeof value.report.generatedAt !== "string" ||
        !Number.isFinite(Date.parse(value.report.generatedAt)) ||
        typeof value.report.rendererProfileId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.report.rendererProfileId) ||
        value.report.viewCount !== 6 ||
        value.report.captureCount !== 24 ||
        value.report.pairMetricCount !== 6
      ) {
        throw new Error("The local server returned an invalid captured-quality report summary.");
      }
    }
    const ready = value.state === "ready" && value.requestId === null && value.failureCode === null && value.report === null && value.progress.phase === "ready" && value.progress.completed === 0 && value.progress.total === 0;
    const unavailable = value.state === "unavailable" && value.report === null && value.progress.phase === "unavailable" && value.progress.completed === 0 && value.progress.total === 0;
    const running = value.state === "running" && value.requestId !== null && value.failureCode === null && value.report === null && ["starting", "verifying_sources", "starting_renderer", "capturing", "scoring", "finalizing"].includes(value.progress.phase) && value.progress.total > 0;
    const completed = value.state === "completed" && value.requestId !== null && value.failureCode === null && value.report !== null && value.progress.phase === "completed" && value.progress.completed === value.report.captureCount && value.progress.total === value.report.captureCount;
    const failed = value.state === "failed" && value.failureCode !== null && value.report === null && value.progress.phase === "failed" && value.progress.completed === 0 && value.progress.total === 0;
    if (!ready && !unavailable && !running && !completed && !failed) {
      throw new Error("The local server returned an internally inconsistent captured-quality state.");
    }
    return value;
  }

  function clearCapturedQualityPoll() {
    if (capturedQualityPollTimer !== null) window.clearTimeout(capturedQualityPollTimer);
    capturedQualityPollTimer = null;
  }

  function scheduleCapturedQualityPoll() {
    if (
      capturedQualityPollTimer !== null ||
      !capturedQualityArtifact ||
      capturedQualityArtifact.state !== "running" ||
      typeof capturedQualityArtifact.requestId !== "string"
    ) return;
    capturedQualityPollTimer = window.setTimeout(() => {
      capturedQualityPollTimer = null;
      void pollCapturedQualityComparison();
    }, CAPTURED_QUALITY_POLL_MS);
  }

  function showCapturedQualityBoundaryFailure(message) {
    clearCapturedQualityPoll();
    capturedQualityArtifact = null;
    pendingCapturedQualityRequestId = null;
    capturedQualityPanel.hidden = false;
    capturedQualityStatus.dataset.state = "failed";
    setText("captured-quality-status-heading", "Comparison information is unavailable");
    setText("captured-quality-status-copy", "Nothing was accepted as a comparison result.");
    byId("captured-quality-meter-bar").style.transform = "scaleX(0)";
    capturedQualityResultFacts.hidden = true;
    byId("start-captured-quality-button").hidden = false;
    byId("start-captured-quality-button").disabled = true;
    byId("cancel-captured-quality-button").hidden = true;
    byId("download-captured-quality-report-button").hidden = true;
    showPanelError(capturedQualityError, message);
  }

  function renderCapturedQualityComparison(value, focusHeading = false, expectedRequestId = null) {
    let parsed;
    try {
      parsed = parseCapturedQualityComparison(value);
    } catch (error) {
      showCapturedQualityBoundaryFailure(
        error instanceof Error ? error.message : "The captured-quality status could not be checked safely."
      );
      return false;
    }
    if (expectedRequestId !== null && parsed.requestId !== expectedRequestId) return false;
    if (
      capturedQualityArtifact &&
      capturedQualityArtifact.requestId !== null &&
      capturedQualityArtifact.requestId === parsed.requestId
    ) {
      const currentIsTerminal = ["completed", "failed"].includes(capturedQualityArtifact.state);
      if (currentIsTerminal && parsed.state !== capturedQualityArtifact.state) return false;
      if (
        pendingCapturedQualityCancellationId === parsed.requestId &&
        parsed.state === "running"
      ) return false;
    }
    if (parsed.state === "unavailable" && capturedQualityArtifact === null) {
      clearCapturedQualityPoll();
      capturedQualityPanel.hidden = true;
      return true;
    }

    const previousRequestId = capturedQualityArtifact && capturedQualityArtifact.requestId;
    if (previousRequestId !== parsed.requestId) downloadedCapturedQualityReport = false;
    capturedQualityArtifact = parsed;
    if (pendingCapturedQualityRequestId === parsed.requestId) pendingCapturedQualityRequestId = null;
    if (
      pendingCapturedQualityCancellationId === parsed.requestId &&
      ["completed", "failed"].includes(parsed.state)
    ) pendingCapturedQualityCancellationId = null;
    capturedQualityPanel.hidden = false;
    capturedQualityStatus.dataset.state = parsed.state;
    clearPanelError(capturedQualityError);

    const start = byId("start-captured-quality-button");
    const cancel = byId("cancel-captured-quality-button");
    const download = byId("download-captured-quality-report-button");
    start.hidden = parsed.state === "running" || parsed.state === "completed";
    start.disabled = parsed.state !== "ready";
    start.textContent = parsed.state === "failed" ? "Start a new local session to try again" : "Run local comparison";
    cancel.hidden = parsed.state !== "running";
    download.hidden = parsed.state !== "completed";
    download.textContent = downloadedCapturedQualityReport ? "Download comparison report again" : "Download comparison report";
    capturedQualityResultFacts.hidden = parsed.state !== "completed";

    const fraction = parsed.progress.total > 0
      ? Math.min(1, parsed.progress.completed / parsed.progress.total)
      : parsed.state === "completed" ? 1 : 0;
    byId("captured-quality-meter-bar").style.transform = "scaleX(" + fraction.toFixed(4) + ")";

    if (parsed.state === "ready") {
      setText("captured-quality-status-heading", "Ready for the exact local comparison");
      setText("captured-quality-status-copy", parsed.message);
      clearCapturedQualityPoll();
    } else if (parsed.state === "running") {
      setText("captured-quality-status-heading", "Comparing the frozen Quality and Mobile captures");
      setText("captured-quality-status-copy", parsed.message + " " + parsed.progress.completed + " of " + parsed.progress.total + " checks complete.");
      scheduleCapturedQualityPoll();
    } else if (parsed.state === "completed") {
      setText("captured-quality-status-heading", "Local captured-quality comparison complete");
      setText("captured-quality-status-copy", parsed.message);
      setText("captured-quality-view-count", parsed.report.viewCount.toLocaleString());
      setText("captured-quality-capture-count", parsed.report.captureCount.toLocaleString());
      setText("captured-quality-source-integrity", "8 exact files matched before and after capture");
      setText("captured-quality-winner", "Not selected");
      setText("captured-quality-report-sha", parsed.report.reportSha256);
      clearCapturedQualityPoll();
    } else if (parsed.state === "failed") {
      setText("captured-quality-status-heading", "The local comparison did not finish");
      setText("captured-quality-status-copy", parsed.message);
      showPanelError(capturedQualityError, "Result not retained: " + parsed.failureCode + ". Start a new local session before trying again.");
      clearCapturedQualityPoll();
    } else {
      setText("captured-quality-status-heading", "Captured-quality comparison unavailable");
      setText("captured-quality-status-copy", parsed.message);
      clearCapturedQualityPoll();
    }
    if (focusHeading) {
      const heading = byId("captured-quality-status-heading");
      heading.tabIndex = -1;
      heading.focus();
    }
    updateSessionCountdown();
    return true;
  }

  async function pollCapturedQualityComparison() {
    if (
      !capturedQualityArtifact ||
      capturedQualityArtifact.state !== "running" ||
      typeof capturedQualityArtifact.requestId !== "string"
    ) return;
    const expectedRequestId = capturedQualityArtifact.requestId;
    try {
      const value = await postJson("/api/captured-quality-comparison/status", { requestId: expectedRequestId });
      if (!capturedQualityArtifact || capturedQualityArtifact.requestId !== expectedRequestId) return;
      renderCapturedQualityComparison(value, false, expectedRequestId);
    } catch (error) {
      if (capturedQualityArtifact && capturedQualityArtifact.requestId === expectedRequestId) {
        showPanelError(
          capturedQualityError,
          error instanceof Error ? error.message : "The captured-quality status could not be checked."
        );
        scheduleCapturedQualityPoll();
      }
    }
  }

  async function recoverCapturedQualityAfterLostResponse(requestId) {
    try {
      const value = await postJson("/api/captured-quality-comparison/status", { requestId });
      return renderCapturedQualityComparison(value, true, requestId);
    } catch (_error) {
      return false;
    }
  }

  function parseOfflineNormalizationPreview(value) {
    if (!value || typeof value !== "object") {
      throw new Error("The local server did not provide a safe offline preview status.");
    }
    if (!hasExactObjectKeys(value, [
      "state",
      "previewAssetId",
      "requestId",
      "message",
      "source",
      "output",
      "productionExecution",
      "authority",
      "serverPersistence",
      "custody",
      "trustedSourceOnly",
      "localVolumeEstablished",
      "sandboxEstablished"
    ])) {
      throw new Error("The local server returned an offline preview field this page does not accept.");
    }
    const states = ["blocked", "ready", "running", "verified", "failed"];
    if (!states.includes(value.state)) {
      throw new Error("The local server returned an unknown offline preview state.");
    }
    if (
      value.productionExecution !== "disabled" ||
      value.authority !== "none" ||
      value.serverPersistence !== "none" ||
      value.custody !== "session_memory_only" ||
      value.trustedSourceOnly !== true ||
      value.localVolumeEstablished !== false ||
      value.sandboxEstablished !== false
    ) {
      throw new Error("The local server returned an unsafe offline preview boundary.");
    }
    if (
      value.previewAssetId !== null &&
      (typeof value.previewAssetId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/.test(value.previewAssetId))
    ) {
      throw new Error("The local server returned an invalid offline preview asset reference.");
    }
    if (
      value.requestId !== null &&
      (typeof value.requestId !== "string" || !/^[a-f0-9]{32}$/.test(value.requestId))
    ) {
      throw new Error("The local server returned an invalid offline preview request reference.");
    }
    if (typeof value.message !== "string" || value.message.length > 500) {
      throw new Error("The local server returned an invalid offline preview message.");
    }
    if (value.source !== null && (
      !hasExactObjectKeys(value.source, ["sizeBytes", "sha256"]) ||
      !Number.isSafeInteger(value.source.sizeBytes) ||
      value.source.sizeBytes < 1 ||
      !isOfflinePreviewDigest(value.source.sha256)
    )) {
      throw new Error("The local server returned an invalid offline preview source summary.");
    }
    if (value.output !== null && (
      !hasExactObjectKeys(value.output, ["sizeBytes", "sha256", "reportSha256", "semanticExactMatch"]) ||
      !Number.isSafeInteger(value.output.sizeBytes) ||
      value.output.sizeBytes < 1 ||
      !isOfflinePreviewDigest(value.output.sha256) ||
      !isOfflinePreviewDigest(value.output.reportSha256) ||
      value.output.semanticExactMatch !== true
    )) {
      throw new Error("The local server returned an invalid offline preview result summary.");
    }
    const blockedReferenceIsConsistent = value.state !== "blocked" || (
      value.output === null && (
        (value.requestId === null && value.previewAssetId === null) ||
        (value.requestId !== null && value.previewAssetId !== null)
      )
    );
    if (
      !blockedReferenceIsConsistent ||
      (value.state === "ready" && (value.previewAssetId === null || value.source === null || value.requestId !== null || value.output !== null)) ||
      (value.state === "running" && (value.previewAssetId === null || value.source === null || value.requestId === null || value.output !== null)) ||
      (value.state === "verified" && (value.previewAssetId === null || value.source === null || value.requestId === null || value.output === null)) ||
      (value.state === "failed" && (value.previewAssetId === null || value.requestId === null || value.output !== null))
    ) {
      throw new Error("The local server returned an internally inconsistent offline preview state.");
    }
    return value;
  }

  function clearOfflinePreviewPoll() {
    if (offlinePreviewPollTimer !== null) window.clearTimeout(offlinePreviewPollTimer);
    offlinePreviewPollTimer = null;
  }

  function scheduleOfflinePreviewPoll() {
    if (
      offlinePreviewPollTimer !== null ||
      !offlinePreviewArtifact ||
      offlinePreviewArtifact.state !== "running" ||
      typeof offlinePreviewArtifact.requestId !== "string"
    ) return;
    offlinePreviewPollTimer = window.setTimeout(() => {
      offlinePreviewPollTimer = null;
      void pollOfflineNormalizationPreview();
    }, OFFLINE_PREVIEW_POLL_MS);
  }

  function showOfflinePreviewBoundaryFailure(message) {
    clearOfflinePreviewPoll();
    offlinePreviewArtifact = null;
    pendingOfflinePreviewRequestId = null;
    offlinePreviewPanel.hidden = false;
    offlinePreviewStatus.dataset.state = "blocked";
    setText("offline-preview-status-heading", "Offline preview information is unavailable");
    setText("offline-preview-status-copy", message + " Nothing ran and no output is available.");
    offlinePreviewResultFacts.hidden = true;
    byId("start-offline-preview-button").disabled = true;
    byId("start-offline-preview-button").hidden = false;
    byId("cancel-offline-preview-button").hidden = true;
    byId("download-offline-preview-output-button").hidden = true;
    byId("download-offline-preview-report-button").hidden = true;
  }

  function renderOfflineNormalizationPreview(
    value,
    focusHeading = false,
    expectedRequestId = null,
    allowClearedRequest = false
  ) {
    let parsed;
    try {
      parsed = parseOfflineNormalizationPreview(value);
    } catch (error) {
      showOfflinePreviewBoundaryFailure(
        error instanceof Error ? error.message : "The offline preview status could not be checked safely."
      );
      return false;
    }
    if (
      expectedRequestId !== null &&
      parsed.requestId !== expectedRequestId &&
      !(allowClearedRequest && parsed.requestId === null)
    ) {
      return false;
    }

    const previousRequestId = offlinePreviewArtifact && offlinePreviewArtifact.requestId;
    if (previousRequestId !== parsed.requestId) {
      downloadedOfflinePreviewOutput = false;
      downloadedOfflinePreviewReport = false;
    }
    offlinePreviewArtifact = parsed;
    if (
      pendingOfflinePreviewRequestId !== null &&
      parsed.requestId === pendingOfflinePreviewRequestId
    ) {
      pendingOfflinePreviewRequestId = null;
    }
    offlinePreviewPanel.hidden = false;
    offlinePreviewStatus.dataset.state = parsed.state;
    clearPanelError(offlinePreviewError);
    offlinePreviewResultFacts.hidden = parsed.state !== "verified";

    const start = byId("start-offline-preview-button");
    const cancel = byId("cancel-offline-preview-button");
    const downloadOutput = byId("download-offline-preview-output-button");
    const downloadReport = byId("download-offline-preview-report-button");
    const canStart = parsed.previewAssetId !== null && parsed.source !== null && parsed.state === "ready";
    start.hidden = parsed.state === "running" || parsed.state === "verified";
    start.disabled = !canStart;
    start.textContent = parsed.state === "failed"
      ? "Start a new local session to try again"
      : parsed.state === "blocked"
        ? "Preview unavailable"
        : "Request preview";
    cancel.hidden = parsed.state !== "running";
    downloadOutput.hidden = parsed.state !== "verified";
    downloadReport.hidden = parsed.state !== "verified";
    downloadOutput.textContent = downloadedOfflinePreviewOutput ? "Download private GLB again" : "Download private GLB";
    downloadReport.textContent = downloadedOfflinePreviewReport ? "Download verification report again" : "Download verification report";

    if (parsed.state === "blocked") {
      setText("offline-preview-status-heading", "Offline preview blocked");
      setText("offline-preview-status-copy", parsed.message + " Nothing unverified is available.");
      clearOfflinePreviewPoll();
    } else if (parsed.state === "ready") {
      setText("offline-preview-status-heading", "Ready to attempt the private format preview");
      setText("offline-preview-status-copy", "A matching permit is present. The source will be read again and checked before any storage-format preview begins.");
      clearOfflinePreviewPoll();
    } else if (parsed.state === "running") {
      setText("offline-preview-status-heading", "Running the private format preview in memory");
      setText("offline-preview-status-copy", "The helper thread is checking and repacking bytes in memory. No production job is running and no server file is being written.");
      scheduleOfflinePreviewPoll();
    } else if (parsed.state === "verified") {
      setText("offline-preview-status-heading", "Decoded geometry matched after the format preview");
      setText("offline-preview-status-copy", "Fresh checks found the same decoded geometry before and after. This proves storage-format equality only; it does not prove accuracy or production readiness.");
      setText("offline-preview-source-size", formatBytes(parsed.source.sizeBytes));
      setText("offline-preview-output-size", formatBytes(parsed.output.sizeBytes));
      setText("offline-preview-semantic-match", "Exact decoded-geometry match verified");
      setText("offline-preview-output-sha", parsed.output.sha256);
      setText("offline-preview-report-sha", parsed.output.reportSha256);
      clearOfflinePreviewPoll();
    } else {
      setText("offline-preview-status-heading", "The private format preview could not be verified");
      setText("offline-preview-status-copy", "No output is available. Check the trusted source, then start a new local session with a new permit before trying again.");
      clearOfflinePreviewPoll();
    }
    if (focusHeading) {
      const heading = byId("offline-preview-status-heading");
      heading.tabIndex = -1;
      heading.focus();
    }
    updateSessionCountdown();
    return true;
  }

  async function pollOfflineNormalizationPreview() {
    if (
      !offlinePreviewArtifact ||
      offlinePreviewArtifact.state !== "running" ||
      typeof offlinePreviewArtifact.requestId !== "string"
    ) return;
    const expectedRequestId = offlinePreviewArtifact.requestId;
    try {
      const value = await postJson("/api/offline-normalization-preview/status", {
        requestId: expectedRequestId
      });
      if (
        !offlinePreviewArtifact ||
        offlinePreviewArtifact.requestId !== expectedRequestId
      ) return;
      renderOfflineNormalizationPreview(value, false, expectedRequestId);
    } catch (error) {
      if (
        offlinePreviewArtifact &&
        offlinePreviewArtifact.requestId === expectedRequestId
      ) {
        showPanelError(
          offlinePreviewError,
          error instanceof Error ? error.message : "The private format preview status could not be checked safely."
        );
      }
    }
  }

  function verificationReference() {
    if (!verificationArtifact) throw new Error("Start the approved-file check first.");
    return {
      jobId: verificationArtifact.jobId,
      revision: verificationArtifact.revision,
      run: verificationArtifact.run
    };
  }

  function clearVerificationPoll() {
    if (verificationPollTimer !== null) window.clearTimeout(verificationPollTimer);
    verificationPollTimer = null;
  }

  function renderVerification(value, focusHeading = false) {
    if (
      !value ||
      typeof value.jobId !== "string" ||
      !Number.isSafeInteger(value.revision) ||
      !Number.isSafeInteger(value.run) ||
      !Number.isSafeInteger(value.totalFiles) ||
      !Number.isSafeInteger(value.totalBytes) ||
      !Number.isSafeInteger(value.filesChecked) ||
      !Number.isSafeInteger(value.bytesChecked)
    ) {
      throw new Error("The local server returned an invalid approved-file check summary.");
    }
    if (
      verificationArtifact &&
      verificationArtifact.jobId === value.jobId &&
      (
        value.run < verificationArtifact.run ||
        (value.run === verificationArtifact.run && value.revision < verificationArtifact.revision)
      )
    ) {
      return;
    }
    verificationArtifact = value;
    setAdmissionEditingLocked(value.phase === "checking");
    verificationWorkbench.hidden = false;
    clearPanelError(verificationError);
    setText("verification-status-copy", value.message);
    setText("verification-file-count", value.filesChecked.toLocaleString() + " of " + value.totalFiles.toLocaleString());
    setText("verification-byte-count", formatBytes(value.bytesChecked) + " of " + formatBytes(value.totalBytes));
    const fraction = value.totalBytes > 0
      ? Math.min(1, value.bytesChecked / value.totalBytes)
      : value.filesChecked >= value.totalFiles ? 1 : 0;
    byId("verification-meter-bar").style.transform = "scaleX(" + fraction.toFixed(4) + ")";

    const start = byId("start-verification-button");
    const cancel = byId("cancel-verification-button");
    const resume = byId("resume-verification-button");
    const report = byId("report-verification-button");
    start.hidden = value.phase === "checking" || value.phase === "stopped_for_now";
    cancel.hidden = value.phase !== "checking";
    resume.hidden = value.phase !== "stopped_for_now";
    report.hidden = value.phase !== "finished";
    start.textContent = value.phase === "finished"
      ? "Run verification again"
      : value.phase === "could_not_finish"
        ? "Run a fresh file check"
        : "Check approved files again";

    if (value.phase === "checking") {
      setText("verification-status-heading", "Checking approved files on this computer");
      clearVerificationPoll();
      verificationPollTimer = window.setTimeout(pollVerification, VERIFICATION_POLL_MS);
    } else if (value.phase === "stopped_for_now") {
      setText("verification-status-heading", "Stopped safely for now");
      clearVerificationPoll();
    } else if (value.phase === "finished") {
      setText("verification-status-heading", value.reportReady ? "All approved files matched during this check" : "Checking the final report");
      clearVerificationPoll();
    } else {
      setText("verification-status-heading", "The approved files could not be verified");
      clearVerificationPoll();
    }
    if (focusHeading) {
      const heading = byId("verification-status-heading");
      heading.tabIndex = -1;
      heading.focus();
    }
  }

  async function pollVerification() {
    if (!verificationArtifact || verificationArtifact.phase !== "checking") return;
    try {
      const value = await postJson("/api/reference-verification/status", verificationReference());
      renderVerification(value);
    } catch (error) {
      clearVerificationPoll();
      showPanelError(verificationError, error instanceof Error ? error.message : "The approved-file check status could not be read safely.");
    }
  }

  async function restoreCurrentVerification(state) {
    if (currentVerificationChecked || state.phase !== "ready") return;
    currentVerificationChecked = true;
    const admissionDigest = state.guidedWorkflow && state.guidedWorkflow.admissionResultSha256;
    if (typeof admissionDigest === "string") {
      verificationAdmissionResultSha256 = admissionDigest;
      verificationWorkbench.hidden = false;
      verificationSavedDraftContext.hidden = false;
      setAdmissionEditingLocked(true);
    }
    try {
      const response = await postJson("/api/reference-verification/current", {});
      if (response && response.current) renderVerification(response.current);
      else setAdmissionEditingLocked(false);
    } catch (error) {
      setAdmissionEditingLocked(false);
      if (typeof admissionDigest === "string") {
        showPanelError(verificationError, error instanceof Error ? error.message : "The saved approved-file check could not be read safely.");
      }
    }
  }

  async function recoverCurrentVerificationAfterLostResponse(expected) {
    try {
      const response = await postJson("/api/reference-verification/current", {});
      if (!response || !response.current) return false;
      if (expected.kind === "new_job" && expected.previousJobId && response.current.jobId === expected.previousJobId) {
        return false;
      }
      if (
        expected.kind === "next_run" &&
        (response.current.jobId !== expected.jobId || response.current.run <= expected.run)
      ) {
        return false;
      }
      renderVerification(response.current, true);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function downloadJson(path, filename, button, digest = null, isStillCurrent = null) {
    button.disabled = true;
    try {
      const url = digest === null
        ? apiUrl(path)
        : path + "?token=" + encodeURIComponent(token) + "&digest=" + encodeURIComponent(digest);
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorMessage(response, "The draft could not be downloaded."));
      const blob = await response.blob();
      if (typeof isStillCurrent === "function" && !isStillCurrent()) {
        throw new Error("Your choices changed while the complete file was being prepared. Nothing was saved. Build the latest choices, then try again.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      return true;
    } finally {
      button.disabled = false;
    }
  }

  async function downloadOfflinePreviewArtifact(path, filename, digest, button) {
    if (
      !offlinePreviewArtifact ||
      offlinePreviewArtifact.state !== "verified" ||
      typeof offlinePreviewArtifact.requestId !== "string" ||
      !isOfflinePreviewDigest(digest)
    ) {
      throw new Error("The verified private preview is no longer current.");
    }
    const expectedRequestId = offlinePreviewArtifact.requestId;
    const accepted = window.confirm(
      "Download this private preview file now? This creates another copy in your browser’s Downloads location, which may be cloud-synced. You control the downloaded copy; the app keeps its separate memory copy until expiry or stop."
    );
    if (!accepted) return false;
    button.disabled = true;
    try {
      const requestUrl = path +
        "?token=" + encodeURIComponent(token) +
        "&requestId=" + encodeURIComponent(expectedRequestId) +
        "&digest=" + encodeURIComponent(digest);
      const response = await fetch(requestUrl, {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "The private preview file could not be downloaded."));
      }
      const blob = await response.blob();
      if (
        !offlinePreviewArtifact ||
        offlinePreviewArtifact.state !== "verified" ||
        offlinePreviewArtifact.requestId !== expectedRequestId
      ) {
        throw new Error("The private preview changed while the download was being checked. Request it again from the current result.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      return true;
    } finally {
      button.disabled = false;
    }
  }

  async function downloadPreparedHdReport(button) {
    if (
      !preparedHdArtifact ||
      preparedHdArtifact.state !== "completed" ||
      typeof preparedHdArtifact.requestId !== "string" ||
      !preparedHdArtifact.report ||
      !isCapturedQualityDigest(preparedHdArtifact.report.readinessReceiptSha256)
    ) {
      throw new Error("The completed prepared-dataset receipt is no longer current.");
    }
    const expectedRequestId = preparedHdArtifact.requestId;
    const expectedDigest = preparedHdArtifact.report.readinessReceiptSha256;
    button.disabled = true;
    try {
      const requestUrl = "/api/prepared-hd-dataset/report" +
        "?token=" + encodeURIComponent(token) +
        "&requestId=" + encodeURIComponent(expectedRequestId) +
        "&digest=" + encodeURIComponent(expectedDigest);
      const response = await fetch(requestUrl, {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "The prepared-dataset receipt could not be downloaded."));
      }
      const blob = await response.blob();
      if (
        !preparedHdArtifact ||
        preparedHdArtifact.state !== "completed" ||
        preparedHdArtifact.requestId !== expectedRequestId ||
        !preparedHdArtifact.report ||
        preparedHdArtifact.report.readinessReceiptSha256 !== expectedDigest
      ) {
        throw new Error("The prepared-dataset result changed while the receipt was being checked.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "foundry-prepared-hd-dataset-readiness-v0.json";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      return true;
    } finally {
      button.disabled = false;
    }
  }

  function preparedHdNeedsAttention() {
    if (!preparedHdArtifact) return false;
    if (preparedHdArtifact.state === "running") return true;
    return preparedHdArtifact.state === "completed" && !downloadedPreparedHdReport;
  }

  function clearPreparedHdClientState() {
    clearPreparedHdPoll();
    preparedHdArtifact = null;
    pendingPreparedHdRequestId = null;
    pendingPreparedHdCancellationId = null;
    downloadedPreparedHdReport = false;
  }

  async function downloadPhotoQualityReport(button) {
    if (
      !photoQualityArtifact ||
      photoQualityArtifact.state !== "completed" ||
      typeof photoQualityArtifact.requestId !== "string" ||
      !photoQualityArtifact.report ||
      !isCapturedQualityDigest(photoQualityArtifact.report.reportSha256)
    ) {
      throw new Error("The completed photo-workbench report is no longer current.");
    }
    const expectedRequestId = photoQualityArtifact.requestId;
    const expectedDigest = photoQualityArtifact.report.reportSha256;
    button.disabled = true;
    try {
      const requestUrl = "/api/photo-capture-quality/report" +
        "?token=" + encodeURIComponent(token) +
        "&requestId=" + encodeURIComponent(expectedRequestId) +
        "&digest=" + encodeURIComponent(expectedDigest);
      const response = await fetch(requestUrl, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorMessage(response, "The photo-workbench report could not be downloaded."));
      const blob = await response.blob();
      if (!photoQualityArtifact || photoQualityArtifact.state !== "completed" || photoQualityArtifact.requestId !== expectedRequestId || !photoQualityArtifact.report || photoQualityArtifact.report.reportSha256 !== expectedDigest) {
        throw new Error("The photo-workbench result changed while the report was being checked.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "foundry-photo-capture-quality-report-v0.json";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      return true;
    } finally {
      button.disabled = false;
    }
  }

  function photoQualityNeedsAttention() {
    if (!photoQualityArtifact) return false;
    if (photoQualityArtifact.state === "running") return true;
    return photoQualityArtifact.state === "completed" && !downloadedPhotoQualityReport;
  }

  function clearPhotoQualityClientState() {
    clearPhotoQualityPoll();
    photoQualityArtifact = null;
    pendingPhotoQualityRequestId = null;
    pendingPhotoQualityCancellationId = null;
    downloadedPhotoQualityReport = false;
    photoQualityAssignmentSignature = null;
    photoQualityLiveSignature = null;
    photoQualityContactSheet.replaceChildren();
  }

  async function downloadCapturedQualityReport(button) {
    if (
      !capturedQualityArtifact ||
      capturedQualityArtifact.state !== "completed" ||
      typeof capturedQualityArtifact.requestId !== "string" ||
      !capturedQualityArtifact.report ||
      !isCapturedQualityDigest(capturedQualityArtifact.report.reportSha256)
    ) {
      throw new Error("The completed captured-quality report is no longer current.");
    }
    const expectedRequestId = capturedQualityArtifact.requestId;
    const expectedDigest = capturedQualityArtifact.report.reportSha256;
    button.disabled = true;
    try {
      const requestUrl = "/api/captured-quality-comparison/report" +
        "?token=" + encodeURIComponent(token) +
        "&requestId=" + encodeURIComponent(expectedRequestId) +
        "&digest=" + encodeURIComponent(expectedDigest);
      const response = await fetch(requestUrl, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "The captured-quality report could not be downloaded."));
      }
      const blob = await response.blob();
      if (
        !capturedQualityArtifact ||
        capturedQualityArtifact.state !== "completed" ||
        capturedQualityArtifact.requestId !== expectedRequestId ||
        !capturedQualityArtifact.report ||
        capturedQualityArtifact.report.reportSha256 !== expectedDigest
      ) {
        throw new Error("The captured-quality result changed while the report was being checked.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "foundry-captured-quality-comparison-report-v0.json";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      return true;
    } finally {
      button.disabled = false;
    }
  }

  function capturedQualityNeedsAttention() {
    if (!capturedQualityArtifact) return false;
    if (capturedQualityArtifact.state === "running") return true;
    return capturedQualityArtifact.state === "completed" && !downloadedCapturedQualityReport;
  }

  function clearCapturedQualityClientState() {
    clearCapturedQualityPoll();
    capturedQualityArtifact = null;
    pendingCapturedQualityRequestId = null;
    pendingCapturedQualityCancellationId = null;
    downloadedCapturedQualityReport = false;
  }

  function offlinePreviewNeedsAttention() {
    if (!offlinePreviewArtifact) return false;
    if (offlinePreviewArtifact.state === "running") return true;
    return offlinePreviewArtifact.state === "verified" &&
      (!downloadedOfflinePreviewOutput || !downloadedOfflinePreviewReport);
  }

  function clearOfflinePreviewClientState() {
    clearOfflinePreviewPoll();
    offlinePreviewArtifact = null;
    pendingOfflinePreviewRequestId = null;
    downloadedOfflinePreviewOutput = false;
    downloadedOfflinePreviewReport = false;
  }

  function collectDecisions() {
    if (!receipt) throw new Error("The receipt is not ready.");
    return receipt.files.map((file, index) => {
      const action = byId("decision-action-" + index).value;
      const choice = byId("decision-choice-" + index).value;
      if (!action || !choice) throw new Error("Choose keep or leave out, then complete the second choice for every file.");
      if (action === "exclude") return { action: "exclude", path: file.path, reason: choice };
      const candidate = clearDetectedCandidate(file);
      if (!candidate) throw new Error("A file without a clear format cannot be kept by this simple screen.");
      return {
        action: "admit",
        path: file.path,
        inputType: candidate.inputType,
        role: choice,
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: []
      };
    });
  }

  function markAdmissionStale() {
    reviewDirty = true;
    reviewRevision += 1;
    planRevision += 1;
    updateSessionCountdown();
    clearVerificationPoll();
    syncCompleteHandoffAvailability();
    if (!admissionArtifact) return;
    admissionArtifact = null;
    planArtifact = null;
    admissionSuccess.hidden = true;
    planWorkbench.hidden = true;
    planResult.hidden = true;
    if (!verificationArtifact || verificationArtifact.phase !== "checking") {
      verificationArtifact = null;
      verificationAdmissionResultSha256 = null;
      pendingVerificationStartRequestId = null;
      pendingVerificationResumeRequestId = null;
      verificationWorkbench.hidden = true;
    } else {
      verificationWorkbench.hidden = false;
      showPanelError(verificationError, "The choices changed while the approved-file check is running. Stop that check before building a new review draft.");
    }
    downloadedLatestReview = false;
    downloadedLatestResult = false;
    downloadedLatestPlan = false;
    setSteps("ready");
    showPanelError(guidedError, "The choices changed. Build a new review draft before downloading or comparing plans.");
  }

  function renderAdmissionSuccess(value) {
    planDirty = planDirty || Boolean(planArtifact && !downloadedLatestPlan);
    admissionArtifact = value;
    clearVerificationPoll();
    verificationArtifact = null;
    verificationAdmissionResultSha256 = null;
    pendingVerificationStartRequestId = null;
    pendingVerificationResumeRequestId = null;
    verificationWorkbench.hidden = false;
    verificationSavedDraftContext.hidden = true;
    setText("verification-status-heading", "Ready when you are");
    setText("verification-status-copy", "Starting this check does not approve rights, prove measurements, or run reconstruction.");
    setText("verification-file-count", "0 of " + value.admittedFileCount.toLocaleString());
    setText("verification-byte-count", "0 B");
    byId("verification-meter-bar").style.transform = "scaleX(0)";
    byId("start-verification-button").hidden = false;
    byId("start-verification-button").textContent = "Check approved files again";
    byId("cancel-verification-button").hidden = true;
    byId("resume-verification-button").hidden = true;
    byId("report-verification-button").hidden = true;
    clearPanelError(verificationError);
    setAdmissionEditingLocked(false);
    planArtifact = null;
    reviewDirty = false;
    completeHandoffStatus = "preparing";
    completeHandoffRevisionSha256 = null;
    syncCompleteHandoffAvailability();
    scheduleImmediateStateRefresh();
    downloadedLatestReview = false;
    downloadedLatestResult = false;
    downloadedLatestPlan = false;
    setText("review-sha", value.reviewSha256);
    setText("result-sha", value.resultSha256);
    setText("admission-summary", value.admittedFileCount + " file" + (value.admittedFileCount === 1 ? "" : "s") + " kept and " + value.excludedFileCount + " left out. Rights still require review. Execution is not authorized.");
    admissionSuccess.hidden = false;
    planWorkbench.hidden = false;
    planResult.hidden = true;
    clearPanelError(guidedError);
    clearPanelError(planError);
    setSteps("draft");
    const heading = byId("admission-success-heading");
    heading.tabIndex = -1;
    heading.focus();
  }

  function updateSessionCountdown() {
    if (!Number.isFinite(sessionExpiresAtMs)) return;
    const remainingMs = Math.max(0, sessionExpiresAtMs - Date.now());
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    const remainingCopy = remainingMs < 60_000
      ? "less than one minute left"
      : "about " + remainingMinutes + " minute" + (remainingMinutes === 1 ? " left" : "s left");
    expiresAt.textContent = new Date(sessionExpiresAtMs).toLocaleString() + " — " + remainingCopy;
    if (sessionPhase !== "ready" || remainingMs > SESSION_WARNING_MS) {
      sessionWarning.hidden = true;
      return;
    }
    sessionWarning.hidden = false;
    sessionWarning.textContent = reviewDirty
      ? "This local session ends in " + remainingCopy + ". Your latest file choices have not been built into a draft. Build and download them now, or they will be lost."
      : planDirty
        ? "This local session ends in " + remainingCopy + ". Your latest plan choices have not been built into a preview. Build and request its download now, or they will be lost."
        : localIntakeWorkspaceNeedsAttention()
          ? "This local session ends in " + remainingCopy + ". The verified local copy is still being copied, checked, or deleted. Let it finish or cancel the copy before time ends."
          : preparedHdNeedsAttention()
            ? "This local session ends in " + remainingCopy + ". The prepared-dataset check is running or its completed receipt has not been downloaded. Stop it or download the current receipt now."
          : photoQualityNeedsAttention()
            ? "This local session ends in " + remainingCopy + ". The local photo check is running or its completed report has not been downloaded. Stop it or download the current report now."
          : capturedQualityNeedsAttention()
            ? "This local session ends in " + remainingCopy + ". The local captured-quality comparison is running or its completed report has not been downloaded. Stop it or download the current report now."
            : offlinePreviewNeedsAttention()
            ? "This local session ends in " + remainingCopy + ". A private format preview is running or the app still holds its memory copy. Stop it or request the current downloads now; the app will clear that buffer on a best-effort basis when time ends."
              : "This local session ends in " + remainingCopy + ". Request any current downloads now. A private verification resume record may remain on this computer; no full capture file is staged or uploaded.";
  }

  function appendQualityAssetDisclosure(parent, label, assets, emptyCopy) {
    const represented = Array.isArray(assets) ? assets : [];
    const disclosure = element("details", "quality-asset-disclosure");
    disclosure.append(element("summary", "", label + " (" + represented.length + ")"));
    const list = element("ul");
    if (represented.length === 0) list.append(element("li", "", emptyCopy));
    for (const asset of represented) {
      list.append(element("li", "", asset.relativePath + " (" + asset.assetId + ")"));
    }
    disclosure.append(list);
    parent.append(disclosure);
  }

  function renderQualityDecisionBoard(board) {
    const target = byId("quality-decision-board-list");
    target.replaceChildren();
    if (!board || board.state !== "available") {
      const card = element("article", "quality-card");
      card.append(
        element("h6", "", "Quality decision support unavailable"),
        element("p", "quality-summary", "No partial board is shown because at least one admitted XBIN file has no reviewed processing route."),
        element("p", "quality-summary", board && board.nextAction ? board.nextAction : "Request an official export in an open documented format.")
      );
      const affected = board && Array.isArray(board.affectedAssets)
        ? board.affectedAssets
        : [];
      appendQualityAssetDisclosure(
        card,
        "Blocked XBIN files",
        affected,
        "No affected file identity was returned."
      );
      target.append(card);
      return;
    }

    const statusLabels = {
      comparison_required: "Comparison required",
      candidate: "Candidate · gain unmeasured",
      source_capture_needed: "More captured input needed",
      requested: "Requested · gain unmeasured"
    };
    const evidenceStateLabels = {
      not_present: "Not present in the admitted manifest",
      present_unreviewed: "Present, not reviewed",
      reviewed_present: "Reviewed evidence present",
      not_evaluated: "Not evaluated by this board"
    };
    const appendDetail = (details, label, value) => {
      const row = element("div");
      row.append(element("dt", "", label), element("dd", "", value));
      details.append(row);
    };
    for (const decision of board.cards || []) {
      const card = element("article", "quality-card");
      const heading = element("div", "quality-card-head");
      heading.append(
        element("h6", "", decision.heading),
        element("p", "quality-status", statusLabels[decision.status] || "Gain unmeasured")
      );
      card.append(heading, element("p", "quality-summary", decision.mechanism));
      const details = element("dl", "quality-details");
      appendDetail(details, "Expected gain", "Unmeasured");
      appendDetail(details, "Can do", decision.canDo);
      appendDetail(details, "Cannot do", decision.cannotDo);
      appendDetail(details, "Likely failure", decision.likelyFailure);
      appendDetail(details, "Decisive next test", decision.decisiveNextTest);

      const evidenceRow = element("div");
      evidenceRow.append(element("dt", "", "Evidence requirements"));
      const evidenceValue = element("dd");
      const evidenceList = element("ul", "quality-evidence-list");
      for (const evidence of decision.evidenceRequirements || []) {
        const item = element("li", "quality-evidence-item");
        item.append(
          element("span", "quality-requirement-copy", evidence.requirement),
          element("span", "quality-evidence-state", evidenceStateLabels[evidence.state] || "State unavailable")
        );
        if (evidence.representedAssets && evidence.representedAssets.length > 0) {
          appendQualityAssetDisclosure(
            item,
            "Represented evidence files",
            evidence.representedAssets,
            "No evidence file is represented."
          );
        }
        evidenceList.append(item);
      }
      evidenceValue.append(evidenceList);
      evidenceRow.append(evidenceValue);
      details.append(evidenceRow);

      const alternativeRow = element("div");
      alternativeRow.append(element("dt", "", "Alternatives"));
      const alternativeValue = element("dd");
      const alternativeList = element("ul");
      for (const item of decision.alternatives || []) alternativeList.append(element("li", "", item));
      alternativeValue.append(alternativeList);
      alternativeRow.append(alternativeValue);
      details.append(alternativeRow);

      card.append(details);
      appendQualityAssetDisclosure(
        card,
        "All represented strategy files",
        decision.representedAssets,
        "No admitted file currently supports this strategy."
      );
      target.append(card);
    }
  }

  function renderProcessingOutline(outline) {
    const target = byId("processing-outline-list");
    target.replaceChildren();
    if (!outline || outline.state !== "outline_only") {
      const card = element("article", "outline-card");
      card.append(
        element("h6", "", "File-to-activity outline unavailable"),
        element("p", "", "No partial outline is shown because at least one admitted XBIN file has no reviewed processing route.")
      );
      const affected = outline && Array.isArray(outline.affectedAssets)
        ? outline.affectedAssets
        : [];
      if (affected.length > 0) {
        const list = element("ul");
        for (const asset of affected.slice(0, 8)) {
          list.append(element("li", "", asset.relativePath + " (" + asset.assetId + ")"));
        }
        if (affected.length > 8) list.append(element("li", "", (affected.length - 8) + " more blocked files"));
        card.append(list);
      }
      target.append(card);
      return;
    }
    for (const lane of outline.lanes || []) {
      const card = element("article", "outline-card");
      const count = lane.representedAssets.length;
      card.append(
        element("h6", "", lane.heading),
        element("p", "", lane.explanation),
        element("p", "", count + (count === 1 ? " represented file" : " represented files") + ". A file may be represented somewhere in this lane, not in every activity.")
      );
      const list = element("ul");
      for (const asset of lane.representedAssets.slice(0, 8)) {
        list.append(element("li", "", asset.relativePath + " (" + asset.assetId + ")"));
      }
      if (count > 8) list.append(element("li", "", (count - 8) + " more represented files"));
      card.append(list);
      target.append(card);
    }
  }

  function renderPlanPreview(value) {
    const preview = value.preview;
    renderQualityDecisionBoard(value.qualityDecisionBoard);
    renderProcessingOutline(value.processingOutline);
    planArtifact = preview;
    planDirty = false;
    completeHandoffStatus = "preparing";
    completeHandoffRevisionSha256 = null;
    syncCompleteHandoffAvailability();
    scheduleImmediateStateRefresh();
    downloadedLatestPlan = false;
    setText("plan-result-heading", preview.human.headline);
    setText("plan-summary", preview.human.summary + " Next: " + preview.human.nextAction);
    const gate = byId("planning-gate");
    gate.replaceChildren();
    if (preview.planningGate.blockers.length === 0) {
      const clear = element("div", "gate-item");
      clear.append(element("strong", "", "No planning-gate blocker found"), element("p", "", "This still does not authorize a program, upload, purchase, or reconstruction."));
      gate.append(clear);
    } else {
      for (const blocker of preview.planningGate.blockers) {
        const item = element("div", "gate-item");
        item.append(element("strong", "", blocker.explanation), element("p", "", blocker.nextAction));
        gate.append(item);
      }
    }
    const routeList = byId("route-list");
    routeList.replaceChildren();
    const routes = [].concat(preview.routes.local || [], preview.routes.cloud || []);
    for (const route of routes) {
      const card = element("article", "route-card");
      const status = route.status === "plan_available" ? "No planning blocker found — nothing is authorized to run" : "Blocked as planned";
      card.append(element("h5", "", route.heading), element("p", "route-status", status), element("p", "", route.plainLanguageStatus));
      if (route.cost && route.cost.state === "calculated_from_supplied_snapshot") {
        card.append(element("p", "", "Supplied estimate: $" + route.cost.amountUsd.toFixed(2) + " USD. No provider was contacted."));
      } else {
        card.append(element("p", "", "No provider charge was supplied. Electricity, staff time, and hardware wear are not priced here."));
      }
      if (route.blockers && route.blockers.length > 0) {
        const list = element("ul");
        for (const blocker of route.blockers) list.append(element("li", "", blocker.explanation));
        card.append(list);
      }
      if (route.jobSpecSha256) card.append(element("code", "", route.jobSpecSha256));
      routeList.append(card);
    }
    planResult.hidden = false;
    clearPanelError(planError);
    setSteps("plan");
    const heading = byId("plan-result-heading");
    heading.tabIndex = -1;
    heading.focus();
  }

  function markPlanStale() {
    planDirty = true;
    planRevision += 1;
    syncCompleteHandoffAvailability();
    if (!planArtifact) return;
    planArtifact = null;
    downloadedLatestPlan = false;
    planResult.hidden = true;
    setSteps("draft");
    showPanelError(planError, "The plan choices changed. Build a new preview before downloading it.");
  }

  function sourceFactLabel(value) {
    const exact = {
      actualByteLength: "Actual byte length",
      declaredByteLength: "Header-declared byte length",
      physicalLengthBytes: "Header-declared physical bytes",
      xmlPhysicalOffsetBytes: "XML physical offset",
      xmlLogicalLengthBytes: "XML logical bytes",
      pageSizeBytes: "Page size",
      fileLengthMatchesHeader: "Header length matches exact bytes",
      nativeCoordinateBounds: "Native-coordinate bounds",
      fanTriangleEquivalentCount: "Fan-triangle equivalent (syntactic only)",
      materialLibraryDeclarationCount: "Material-library declarations",
      unsupportedDirectiveCount: "Unsupported directives",
      uriDeclarationCounts: "URI declarations (not opened)",
      assetVersion: "Declared glTF asset version",
      vertexStrideBytes: "Bytes per Gaussian record",
      payloadBytes: "Declared fixed-width payload bytes",
      lineEndings: "Header line endings",
      extraProperties: "Additional scalar properties",
      indicesContiguous: "SH property indices contiguous"
    };
    if (exact[value]) return exact[value];
    return String(value)
      .replaceAll("_", " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (character) => character.toUpperCase());
  }

  function sourceFactScalar(value) {
    if (value === null) return "Not declared";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : "Not established";
    const text = String(value);
    const previewLimit = 320;
    return text.length <= previewLimit
      ? text
      : text.slice(0, previewLimit) + "… [display truncated; complete value is in the source-facts download]";
  }

  function appendSourceFactRows(target, value, trail) {
    if (value === null || typeof value !== "object") {
      const row = element("div");
      row.append(element("dt", "", trail.map(sourceFactLabel).join(" · ")));
      row.append(element("dd", "", sourceFactScalar(value)));
      target.append(row);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        appendSourceFactRows(target, "None declared", trail);
        return;
      }
      if (value.every((item) => item === null || typeof item !== "object")) {
        const previewLimit = 48;
        const preview = value.slice(0, previewLimit).map(sourceFactScalar).join(", ");
        const remainder = value.length - previewLimit;
        appendSourceFactRows(
          target,
          preview + (remainder > 0
            ? " … [" + remainder.toLocaleString() + " more; complete list is in the source-facts download]"
            : ""),
          trail,
        );
        return;
      }
      for (let index = 0; index < value.length; index += 1) {
        appendSourceFactRows(target, value[index], trail.concat(String(index + 1)));
      }
      return;
    }
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      appendSourceFactRows(target, "None declared", trail);
      return;
    }
    for (const key of keys) appendSourceFactRows(target, value[key], trail.concat(key));
  }

  function appendSourceUnknown(target, unknown) {
    if (typeof unknown === "string") {
      target.append(element("li", "", sourceFactLabel(unknown)));
      return;
    }
    if (!unknown || typeof unknown !== "object") return;
    const label = unknown.label || unknown.id || unknown.code || "Unknown property";
    const reason = unknown.reason || unknown.message;
    const nextTest = unknown.decisiveNextTest;
    const item = element("li", "", sourceFactLabel(label) + (reason ? " — " + String(reason) : ""));
    if (nextTest) {
      item.append(element("span", "source-fact-next-test", "Next test: " + String(nextTest)));
    }
    target.append(item);
  }

  function appendGaussianPlyProperties(target, properties) {
    if (!Array.isArray(properties) || properties.length === 0) return;
    const details = element("details", "source-fact-property-details");
    details.append(element("summary", "", properties.length + " declared Gaussian PLY properties and byte offsets"));
    const wrap = element("div", "source-fact-property-wrap");
    const table = element("table", "source-fact-property-table");
    const head = element("thead");
    const headerRow = element("tr");
    for (const label of ["Order", "Property", "Type", "Offset", "Role"]) {
      headerRow.append(element("th", "", label));
    }
    head.append(headerRow);
    const body = element("tbody");
    for (const property of properties) {
      const row = element("tr");
      row.append(
        element("td", "", sourceFactScalar(Number(property.ordinal) + 1)),
        element("td", "", sourceFactScalar(property.name)),
        element("td", "", sourceFactScalar(property.declaredType) + " · " + sourceFactScalar(property.canonicalType)),
        element("td", "", sourceFactScalar(property.byteOffset) + " B"),
        element("td", "", sourceFactLabel(property.role) + (property.roleIndex === null ? "" : " " + sourceFactScalar(property.roleIndex)))
      );
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    details.append(wrap);
    target.append(details);
  }

  function appendPointPlyProperties(target, properties) {
    if (!Array.isArray(properties) || properties.length === 0) return;
    const details = element("details", "source-fact-property-details");
    details.append(element("summary", "", properties.length + " declared point PLY properties and byte offsets"));
    const wrap = element("div", "source-fact-property-wrap");
    const table = element("table", "source-fact-property-table");
    const head = element("thead");
    const headerRow = element("tr");
    for (const label of ["Order", "Property", "Type", "Offset", "Width"]) {
      headerRow.append(element("th", "", label));
    }
    head.append(headerRow);
    const body = element("tbody");
    for (const property of properties) {
      const row = element("tr");
      row.append(
        element("td", "", sourceFactScalar(Number(property.ordinal) + 1)),
        element("td", "", sourceFactScalar(property.name)),
        element("td", "", sourceFactScalar(property.declaredType) + " · " + sourceFactScalar(property.canonicalType)),
        element("td", "", sourceFactScalar(property.byteOffset) + " B"),
        element("td", "", sourceFactScalar(property.byteWidth) + " B")
      );
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    details.append(wrap);
    target.append(details);
  }

  function renderInheritedSourceFacts(value) {
    if (value.state === "unavailable") {
      const reason = value.reason || {};
      sourceFactsBlocker.append(
        element("strong", "", reason.message || "Source facts are unavailable for this mixed source."),
        element("p", "", reason.nextAction || "Request an official export in an open documented format.")
      );
      if (Array.isArray(value.affectedSources) && value.affectedSources.length > 0) {
        const list = element("ul");
        for (const source of value.affectedSources) list.append(element("li", "", source.path));
        sourceFactsBlocker.append(list);
      }
      sourceFactsBlocker.hidden = false;
      return;
    }

    for (const asset of value.assets) {
      const card = element("article", "source-fact-card");
      const heading = element("div", "source-fact-card-head");
      const identity = element("div");
      identity.append(
        element("h4", "", asset.source.path),
        element("p", "source-fact-identity", formatBytes(asset.source.sizeBytes) + " · SHA-256 " + asset.source.sha256),
        element("p", "source-fact-identity", "Evidence profile: " + (sourceFactFormatNames[asset.format] || sourceFactLabel(asset.format)))
      );
      const receiptCandidates = asset.source.receiptCandidateInputTypes;
      const isRegistrationDocument = asset.source.inputType === "trajectory" || asset.source.inputType === "calibration_bundle";
      const isMediaContainer = Array.isArray(receiptCandidates) && !isRegistrationDocument;
      const isPointPly = asset.source.inputType === "ply_point_cloud" && asset.format === "ply";
      if (Array.isArray(receiptCandidates) && receiptCandidates.length > 0) {
        identity.append(
          element(
            "p",
            "source-fact-identity source-fact-role-boundary",
            "Receipt candidates retained: " + receiptCandidates.map((inputType) => formatNames[inputType] || sourceFactLabel(inputType)).join(" · ") + (isRegistrationDocument
              ? ". Document structure does not establish field semantics, clock or units, frames, transform conventions, calibration validity, provenance, registration, or accuracy."
              : ". Container facts do not select a camera or panorama role, or a captured, enhanced, generated, or concept provenance class.")
          )
        );
      }
      const status = element(
        "span",
        "source-fact-status",
        asset.inspection.state === "established"
          ? (isMediaContainer
            ? "Container facts established"
            : isRegistrationDocument
              ? "Document structure established"
              : isPointPly
                ? "Point layout established"
              : "Facts established")
          : (isMediaContainer
            ? "Container facts not established"
            : isRegistrationDocument
              ? "Document structure not established"
              : isPointPly
                ? "Point layout not established"
              : "Still has gaps")
      );
      status.dataset.state = asset.inspection.state;
      heading.append(identity, status);
      card.append(heading);

      const columns = element("div", "source-fact-columns");
      const established = element("section", "source-fact-column");
      const establishedHeading = isMediaContainer
        ? asset.inspection.state === "established"
          ? "Established container facts from these exact bytes"
          : "No container facts established from these exact bytes"
        : isRegistrationDocument
          ? asset.inspection.state === "established"
            ? "Established document structure from these exact bytes"
            : "No document structure established from these exact bytes"
        : isPointPly
          ? asset.inspection.state === "established"
            ? "Established point layout from these exact bytes"
            : "No point layout established from these exact bytes"
        : "Established from these exact bytes";
      established.append(element("h5", "", establishedHeading));
      if (asset.facts) {
        const gaussianProperties = asset.format === "gaussian_ply" && asset.facts.gaussians && Array.isArray(asset.facts.gaussians.properties)
          ? asset.facts.gaussians.properties
          : [];
        const pointProperties = asset.format === "ply" && asset.facts.vertices && Array.isArray(asset.facts.vertices.properties)
          ? asset.facts.vertices.properties
          : [];
        let displayedFacts = asset.facts;
        if (gaussianProperties.length > 0) {
          const gaussianSummary = {};
          for (const [key, item] of Object.entries(asset.facts.gaussians)) {
            if (key !== "properties") gaussianSummary[key] = item;
          }
          displayedFacts = Object.assign({}, asset.facts, { gaussians: gaussianSummary });
        }
        if (pointProperties.length > 0) {
          const pointSummary = {};
          for (const [key, item] of Object.entries(asset.facts.vertices)) {
            if (key !== "properties") pointSummary[key] = item;
          }
          displayedFacts = Object.assign({}, asset.facts, { vertices: pointSummary });
        }
        const facts = element("dl");
        appendSourceFactRows(facts, displayedFacts, []);
        established.append(facts);
        appendGaussianPlyProperties(established, gaussianProperties);
        appendPointPlyProperties(established, pointProperties);
      } else {
        established.append(element("p", "source-fact-identity", sourceFactLabel(asset.inspection.code)));
      }
      const unknown = element("section", "source-fact-column");
      unknown.append(element("h5", "", isMediaContainer
        ? "Still unknown beyond the container"
        : isRegistrationDocument
          ? "Still unknown beyond document structure"
          : isPointPly
            ? "Still unknown beyond point layout"
          : "Still unknown"));
      const unknownList = element("ul");
      for (const item of asset.unknowns || []) appendSourceUnknown(unknownList, item);
      if (unknownList.childElementCount === 0) unknownList.append(element("li", "", "No additional V6 unknown code was emitted."));
      unknown.append(unknownList);
      columns.append(established, unknown);
      card.append(columns);
      sourceFactsList.append(card);
    }
  }

  function expectedPotreeMemberRoles(bundle) {
    const roles = new Set((bundle.members || []).map((member) => member.role));
    return ["metadata", "hierarchy", "octree"].filter((role) => !roles.has(role));
  }

  function potreeCompatibilityNotes(bundle) {
    const notes = [];
    const missingRoles = expectedPotreeMemberRoles(bundle);
    if (missingRoles.length > 0) {
      notes.push({ kind: "Deviation", message: "Exact three-member identity is incomplete: missing " + missingRoles.map(sourceFactLabel).join(", ") + "." });
    }
    if (!bundle.inspection || bundle.inspection.state !== "established") {
      notes.push({
        kind: "Deviation",
        message: "The supported structural profile was not established: " +
          sourceFactLabel(bundle.inspection && bundle.inspection.code || "inspection result unavailable") + "."
      });
      return notes;
    }
    const facts = bundle.facts;
    const compatibility = facts && facts.compatibility;
    const depthDiffers = compatibility
      ? compatibility.declaredHierarchyDepth === "differs_from_observed_accepted"
      : facts && facts.hierarchy && facts.hierarchy.declaredDepthMatchesObservedMaximum === false;
    if (depthDiffers) {
      notes.push({ kind: "Deviation", message: "The metadata-declared hierarchy depth differs from the maximum depth observed in the reachable hierarchy." });
    }
    const leafChildMasksObserved = compatibility
      ? compatibility.leafChildMasks === "observed_and_accepted_by_official_loader_semantics"
      : facts && facts.hierarchy && Number(facts.hierarchy.leafRecordsWithChildren) > 0;
    if (leafChildMasksObserved) {
      notes.push({ kind: "Deviation", message: Number(facts.hierarchy.leafRecordsWithChildren).toLocaleString() + " leaf hierarchy records advertise child masks." });
    }
    if (compatibility && compatibility.proxyReplacementDeclarations === "target_record_overwrite_mismatches_observed_and_accepted") {
      notes.push({
        kind: "Deviation",
        message: "Official-loader target-record overwrite semantics accept proxy replacement declaration differences: " +
          Number(facts.hierarchy.proxyReplacementChildMaskMismatchCount).toLocaleString() + " child-mask and " +
          Number(facts.hierarchy.proxyReplacementPointCountMismatchCount).toLocaleString() + " point-count mismatches were observed."
      });
    }
    const attributesWithoutHistograms = facts && facts.metadata && Array.isArray(facts.metadata.attributes)
      ? facts.metadata.attributes.filter((attribute) => attribute.histogramDeclared === false)
      : [];
    const histogramBoundary = compatibility
      ? compatibility.attributeHistograms === "omitted_and_accepted" || compatibility.attributeHistograms === "partially_declared"
      : attributesWithoutHistograms.length > 0;
    if (histogramBoundary) {
      const affectedAttributes = attributesWithoutHistograms.length > 0
        ? " for " + attributesWithoutHistograms.map((attribute) => attribute.name).join(", ")
        : "";
      notes.push({
        kind: "Boundary",
        message: "Metadata omits optional attribute histograms" + affectedAttributes + "; the official loader can calculate histograms after loading, so this is recorded without treating it as corruption."
      });
    }
    return notes;
  }

  function appendPotreeMemberIdentities(parent, bundle) {
    const details = element("details", "potree-member-details");
    details.open = true;
    details.append(element("summary", "", "Exact three-member identity (" + (bundle.members || []).length.toLocaleString() + " of 3 present)"));
    const list = element("ul", "potree-member-list");
    for (const member of bundle.members || []) {
      const item = element("li");
      item.append(
        element("strong", "", sourceFactLabel(member.role) + " member"),
        element("code", "", member.path),
        element("span", "", formatBytes(member.sizeBytes) + " · SHA-256 " + member.sha256)
      );
      list.append(item);
    }
    for (const role of expectedPotreeMemberRoles(bundle)) {
      const item = element("li");
      item.append(
        element("strong", "", sourceFactLabel(role) + " member"),
        element("span", "", "Not present in this exact receipt candidate; no three-member structural result can be established.")
      );
      list.append(item);
    }
    details.append(list);
    parent.append(details);
  }

  function appendPotreeCompatibility(parent, bundle) {
    const notes = potreeCompatibilityNotes(bundle);
    const details = element("details", "potree-compatibility-details");
    details.append(element("summary", "", "Compatibility deviations and boundaries (" + notes.length.toLocaleString() + " observed notes)"));
    const list = element("ul", "potree-compatibility-list");
    if (notes.length === 0) {
      list.append(element("li", "", "No supported-profile compatibility deviation or boundary was observed. Rendering and viewer fidelity remain unknown."));
    } else {
      for (const note of notes) list.append(element("li", "", note.kind + ": " + note.message));
    }
    if (bundle.facts && Array.isArray(bundle.facts.limitations)) {
      for (const limitation of bundle.facts.limitations) {
        list.append(element("li", "", "Frozen scope boundary: " + sourceFactLabel(limitation)));
      }
    }
    details.append(list);
    parent.append(details);
  }

  function appendPotreeUnknowns(parent, bundle) {
    const unknowns = Array.isArray(bundle.unknowns) ? bundle.unknowns : [];
    const details = element("details", "potree-unknown-details");
    details.append(element("summary", "", "Still unknown (" + unknowns.length.toLocaleString() + ")"));
    const list = element("ul", "potree-unknown-list");
    for (const unknown of unknowns) {
      const item = element("li");
      item.append(
        element("strong", "", unknown.label || sourceFactLabel(unknown.code || "Unknown")),
        element("span", "", unknown.reason || "This fact was not established."),
        element("span", "source-fact-next-test", "Next test: " + (unknown.decisiveNextTest || "Obtain digest-bound independent evidence."))
      );
      list.append(item);
    }
    if (unknowns.length === 0) list.append(element("li", "", "No Potree V7 unknown was emitted."));
    details.append(list);
    parent.append(details);
  }

  function renderPotreeSourceFacts(bundles) {
    potreeSourceFactsList.replaceChildren();
    const values = Array.isArray(bundles) ? bundles : [];
    potreeSourceFactsPanel.hidden = values.length === 0;
    for (const bundle of values) {
      const card = element("article", "potree-bundle-card");
      card.dataset.bundleSha256 = bundle.bundleSha256;
      const head = element("div", "potree-bundle-card-head");
      const identity = element("div");
      identity.append(
        element("h5", "", bundle.bundleRoot || "Selected receipt root"),
        element("p", "potree-bundle-identity", "Bundle fingerprint SHA-256 " + bundle.bundleSha256),
        element("p", "potree-bundle-identity", "Inspection " + bundle.inspection.code + " · " + sourceFactLabel(bundle.inspection.category) + " · " + sourceFactLabel(bundle.inspection.coverage))
      );
      const status = element("span", "source-fact-status", bundle.inspection.state === "established" ? "Structure established" : "Structure not established");
      status.dataset.state = bundle.inspection.state;
      head.append(identity, status);
      card.append(head);

      if (bundle.facts) {
        const structural = element("dl", "potree-structural-facts");
        const items = [
          ["Declared points", bundle.facts.metadata.pointCount],
          ["Point record", bundle.facts.metadata.recordStrideBytes + " B"],
          ["Reachable hierarchy nodes", bundle.facts.hierarchy.logicalNodeCount],
          ["Hierarchy bytes", bundle.facts.hierarchy.sourceSizeBytes],
          ["Exact octree bytes", bundle.facts.octree.sourceSizeBytes],
          ["Covered without gaps", bundle.facts.octree.payloadRangesDisjointAndGapless ? "Yes" : "No"],
          ["Proxy declarations", sourceFactLabel(bundle.facts.compatibility.proxyReplacementDeclarations)]
        ];
        for (const item of items) {
          const block = element("div");
          block.append(element("dt", "", item[0]), element("dd", "", sourceFactScalar(item[1])));
          structural.append(block);
        }
        card.append(structural);
      }
      appendPotreeMemberIdentities(card, bundle);
      appendPotreeCompatibility(card, bundle);
      appendPotreeUnknowns(card, bundle);
      potreeSourceFactsList.append(card);
    }
  }

  function renderSourceFacts(value) {
    sourceFacts = value;
    sourceFactsDownloadStatus.textContent = "";
    sourceFactsPanel.hidden = false;
    sourceFactsSummary.replaceChildren();
    sourceFactsList.replaceChildren();
    sourceFactsBlocker.replaceChildren();
    sourceFactsBlocker.hidden = true;
    setText("source-facts-sha", value.factsSha256);

    const inherited = value.inherited;
    const summary = value.summary || {};
    const summaryItems = [
      ["Files in receipt", summary.receiptFileCount],
      ["Inherited V6 assets", summary.inheritedAssetCount],
      ["Potree bundles", summary.potreeBundleCount],
      ["Potree structures established", summary.establishedPotreeBundleCount],
      ["Not established or untargeted", Number(summary.factsNotEstablishedPotreeBundleCount || 0) + Number(summary.untargetedFileCount || 0)]
    ];
    for (const item of summaryItems) {
      const block = element("div");
      block.append(element("dt", "", item[0]), element("dd", "", Number(item[1] || 0).toLocaleString()));
      sourceFactsSummary.append(block);
    }
    if (!inherited) {
      sourceFactsBlocker.append(element("strong", "", "The inherited V6 source-facts artifact is missing."));
      sourceFactsBlocker.hidden = false;
      renderPotreeSourceFacts([]);
      return;
    }
    renderInheritedSourceFacts(inherited);
    renderPotreeSourceFacts(value.potreeBundles);
  }

  const pointValueViewLabels = {
    position_0_1: "Position components 0–1",
    position_0_2: "Position components 0–2",
    position_1_2: "Position components 1–2"
  };

  const pointValueModeLabels = {
    omitted_component: "Omitted component colour",
    intensity_byte: "Raw intensity byte",
    opaque_vendor_byte: "Opaque vendor byte",
    record_density: "Record density"
  };

  const roomEnvelopeViewOrder = ["position_0_1", "position_0_2", "position_1_2"];
  const roomEnvelopeVisitIds = {
    position_0_1: "room-envelope-visit-position-0-1",
    position_0_2: "room-envelope-visit-position-0-2",
    position_1_2: "room-envelope-visit-position-1-2"
  };

  function pointValueSelectedRadio(name, fallback) {
    const selected = document.querySelector('input[name="' + name + '"]:checked');
    return selected && typeof selected.value === "string" ? selected.value : fallback;
  }

  function pointValueVector(values) {
    return Array.isArray(values)
      ? "[" + values.map((value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 7 })).join(", ") + "]"
      : "Not established";
  }

  function pointValueMean(distribution, recordCount) {
    return distribution && Number.isFinite(distribution.sum) && recordCount > 0
      ? (distribution.sum / recordCount).toLocaleString(undefined, { maximumFractionDigits: 4 })
      : "Not established";
  }

  function pointValuePreviewUrl(path, bundle, image) {
    return path +
      "?token=" + encodeURIComponent(token) +
      "&bundleSha256=" + encodeURIComponent(bundle.bundleSha256) +
      "&viewId=" + encodeURIComponent(image.viewId) +
      "&mode=" + encodeURIComponent(image.mode) +
      "&sha256=" + encodeURIComponent(image.sha256);
  }

  function pointValueFactCard(heading, copy) {
    const card = element("article", "point-value-fact-card");
    card.append(element("h4", "", heading), element("p", "", copy));
    return card;
  }

  function roomEnvelopeShowError(message, focus = false) {
    roomEnvelopeReviewError.textContent = message;
    roomEnvelopeReviewError.hidden = false;
    if (focus) roomEnvelopeReviewError.focus();
  }

  function roomEnvelopeClearError() {
    roomEnvelopeReviewError.textContent = "";
    roomEnvelopeReviewError.hidden = true;
  }

  function roomEnvelopeOrientation(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function roomEnvelopeOnSegment(a, b, point) {
    return roomEnvelopeOrientation(a, b, point) === 0 &&
      point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) &&
      point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
  }

  function roomEnvelopeSegmentsIntersect(a, b, c, d) {
    const abC = roomEnvelopeOrientation(a, b, c);
    const abD = roomEnvelopeOrientation(a, b, d);
    const cdA = roomEnvelopeOrientation(c, d, a);
    const cdB = roomEnvelopeOrientation(c, d, b);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    return (abC === 0 && roomEnvelopeOnSegment(a, b, c)) ||
      (abD === 0 && roomEnvelopeOnSegment(a, b, d)) ||
      (cdA === 0 && roomEnvelopeOnSegment(c, d, a)) ||
      (cdB === 0 && roomEnvelopeOnSegment(c, d, b));
  }

  function roomEnvelopePolygonIssue() {
    if (roomEnvelopeVertices.length < 3) return "Add at least three unique vertices.";
    if (new Set(roomEnvelopeVertices.map((point) => point[0] + "," + point[1])).size !== roomEnvelopeVertices.length) {
      return "Each vertex must be unique.";
    }
    let twiceArea = 0;
    for (let index = 0; index < roomEnvelopeVertices.length; index += 1) {
      const current = roomEnvelopeVertices[index];
      const next = roomEnvelopeVertices[(index + 1) % roomEnvelopeVertices.length];
      twiceArea += current[0] * next[1] - next[0] * current[1];
    }
    if (Math.abs(twiceArea) / 2 < 64) return "The outline is too small; use a polygon area of at least 64 intrinsic pixels squared.";
    for (let left = 0; left < roomEnvelopeVertices.length; left += 1) {
      const leftNext = (left + 1) % roomEnvelopeVertices.length;
      const a = roomEnvelopeVertices[left];
      const b = roomEnvelopeVertices[leftNext];
      for (let right = left + 1; right < roomEnvelopeVertices.length; right += 1) {
        const rightNext = (right + 1) % roomEnvelopeVertices.length;
        if (left === right || leftNext === right || rightNext === left || (left === 0 && rightNext === 0)) continue;
        if (roomEnvelopeSegmentsIntersect(a, b, roomEnvelopeVertices[right], roomEnvelopeVertices[rightNext])) {
          return "The outline crosses itself. Remove or reorder vertices so the edges do not intersect.";
        }
      }
    }
    return null;
  }

  function roomEnvelopeCurrentView() {
    return pointValueSelectedRadio("point-value-plane", "position_0_1");
  }

  function roomEnvelopeReviewIsAvailable() {
    return roomEnvelopeReviewArtifact &&
      (roomEnvelopeReviewArtifact.state === "ready" || roomEnvelopeReviewArtifact.state === "completed");
  }

  function roomEnvelopeDrawingIsAvailable() {
    return Boolean(
      roomEnvelopeReviewIsAvailable() &&
      pointValueCurrentImage &&
      pointValueCurrentImage.bundle.bundleSha256 === roomEnvelopeActiveBundleSha256 &&
      roomEnvelopeCurrentView() === roomEnvelopeHorizontalView.value
    );
  }

  function renderRoomEnvelopeOverlay() {
    roomEnvelopeOverlay.replaceChildren();
    const canDraw = roomEnvelopeDrawingIsAvailable();
    roomEnvelopeOverlay.dataset.enabled = String(canDraw);
    const visibleVertices = canDraw ? roomEnvelopeVertices : [];
    const svgNamespace = "http://www.w3.org/2000/svg";
    const points = visibleVertices.map((point) => point[0] + "," + point[1]).join(" ");
    if (visibleVertices.length >= 3) {
      const polygon = document.createElementNS(svgNamespace, "polygon");
      polygon.setAttribute("points", points);
      polygon.setAttribute("fill", "rgba(255, 211, 92, .2)");
      polygon.setAttribute("stroke", "#ffd35c");
      polygon.setAttribute("stroke-width", "3");
      polygon.setAttribute("vector-effect", "non-scaling-stroke");
      roomEnvelopeOverlay.append(polygon);
    } else if (visibleVertices.length >= 2) {
      const line = document.createElementNS(svgNamespace, "polyline");
      line.setAttribute("points", points);
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "#ffd35c");
      line.setAttribute("stroke-width", "3");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      roomEnvelopeOverlay.append(line);
    }
    for (const point of visibleVertices) {
      const marker = document.createElementNS(svgNamespace, "circle");
      marker.setAttribute("cx", String(point[0]));
      marker.setAttribute("cy", String(point[1]));
      marker.setAttribute("r", "7");
      marker.setAttribute("fill", "#fff4c7");
      marker.setAttribute("stroke", "#6d5317");
      marker.setAttribute("stroke-width", "2");
      marker.setAttribute("vector-effect", "non-scaling-stroke");
      roomEnvelopeOverlay.append(marker);
    }
    roomEnvelopeOverlay.setAttribute(
      "aria-label",
      canDraw
        ? "Room-envelope fit-seed polygon with " + visibleVertices.length + " ordered intrinsic-pixel vertices. Click to add another vertex."
        : "Room-envelope drawing is available only while the proposed horizontal projection is displayed."
    );
  }

  function renderRoomEnvelopeDraft() {
    for (const viewId of roomEnvelopeViewOrder) {
      const marker = byId(roomEnvelopeVisitIds[viewId]);
      const preview = roomEnvelopeReviewedPreviews.get(viewId);
      marker.dataset.reviewed = String(Boolean(preview));
      marker.textContent = preview
        ? "Marked · " + (pointValueModeLabels[preview.mode] || sourceFactLabel(preview.mode)) + " · " + preview.sha256.slice(0, 10) + "…"
        : "Not marked";
    }
    roomEnvelopeVertexList.replaceChildren();
    roomEnvelopeVertices.forEach((point, index) => {
      const item = element("li");
      item.append(element("span", "", "Vertex " + (index + 1) + ": " + point[0] + ", " + point[1]));
      const remove = element("button", "", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove vertex " + (index + 1) + " at " + point[0] + ", " + point[1]);
      remove.addEventListener("click", () => {
        roomEnvelopeVertices.splice(index, 1);
        roomEnvelopeClearError();
        renderRoomEnvelopeDraft();
      });
      item.append(remove);
      roomEnvelopeVertexList.append(item);
    });
    setText("room-envelope-vertex-count", roomEnvelopeVertices.length + " of 64");
    byId("room-envelope-undo").disabled = roomEnvelopeVertices.length === 0;
    byId("room-envelope-clear").disabled = roomEnvelopeVertices.length === 0;
    const drawingAvailable = roomEnvelopeDrawingIsAvailable();
    byId("room-envelope-x").disabled = !drawingAvailable;
    byId("room-envelope-y").disabled = !drawingAvailable;
    byId("room-envelope-add-vertex").disabled = !drawingAvailable || roomEnvelopeVertices.length >= 64;
    byId("room-envelope-mark-preview").disabled = !roomEnvelopeReviewIsAvailable() || !pointValueCurrentImage;
    const issue = roomEnvelopePolygonIssue();
    const reviewedCount = roomEnvelopeViewOrder.filter((viewId) => roomEnvelopeReviewedPreviews.has(viewId)).length;
    roomEnvelopePolygonHelp.textContent = !drawingAvailable
      ? "Display the proposed horizontal projection to draw or edit its outline. Your ordered vertices stay bound to that projection."
      : issue || "Simple polygon ready. All coordinates are intrinsic 0–1023 pixels, not physical units.";
    byId("room-envelope-submit").disabled = roomEnvelopeSubmitting ||
      !drawingAvailable || reviewedCount !== 3 || issue !== null;
    renderRoomEnvelopeOverlay();
  }

  function resetRoomEnvelopeDraft(bundleSha256) {
    roomEnvelopeActiveBundleSha256 = bundleSha256;
    roomEnvelopeReviewedPreviews = new Map();
    roomEnvelopeVertices = [];
    roomEnvelopeClearError();
    renderRoomEnvelopeDraft();
  }

  function addRoomEnvelopeVertex(x, y) {
    if (!roomEnvelopeDrawingIsAvailable()) {
      roomEnvelopeShowError("Display the proposed horizontal projection before adding a vertex.");
      return;
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 1023 || y < 0 || y > 1023) {
      roomEnvelopeShowError("X and Y must each be a whole intrinsic-pixel value from 0 through 1023.");
      return;
    }
    if (roomEnvelopeVertices.length >= 64) {
      roomEnvelopeShowError("This bounded review accepts at most 64 vertices.");
      return;
    }
    if (roomEnvelopeVertices.some((point) => point[0] === x && point[1] === y)) {
      roomEnvelopeShowError("That intrinsic-pixel vertex is already in the outline.");
      return;
    }
    roomEnvelopeClearError();
    roomEnvelopeVertices.push([x, y]);
    renderRoomEnvelopeDraft();
  }

  function renderRoomEnvelopeReviewState(value) {
    if (!value || !["unavailable", "ready", "completed"].includes(value.state)) {
      roomEnvelopeReviewArtifact = null;
      roomEnvelopeReviewStatus.textContent = "The local server did not return a usable room-envelope review boundary.";
      roomEnvelopeReviewResult.hidden = true;
      renderRoomEnvelopeDraft();
      return;
    }
    roomEnvelopeReviewArtifact = value;
    roomEnvelopeReviewStatus.textContent = value.message;
    const report = value.state === "completed" ? value.report : null;
    if (report && typeof report.reportSha256 === "string") {
      setText("room-envelope-included-count", Number(report.includedRecordCount).toLocaleString());
      setText("room-envelope-excluded-count", Number(report.excludedRecordCount).toLocaleString());
      setText(
        "room-envelope-eligibility",
        report.eligibility === "eligible_for_fit_only_diagnostic"
          ? "Eligible for fit-only diagnostic"
          : "Not eligible"
      );
      setText("room-envelope-report-sha", report.reportSha256);
      roomEnvelopeReviewResult.hidden = false;
    } else {
      roomEnvelopeReviewResult.hidden = true;
      setText("room-envelope-report-sha", "Not ready");
    }
    renderRoomEnvelopeDraft();
  }

  function renderPointValueCurrentBundle() {
    if (!pointValueDiagnostic) return;
    const factsV8 = pointValueDiagnostic.sourceFacts;
    const overlays = factsV8 && Array.isArray(factsV8.pointValueBundles)
      ? factsV8.pointValueBundles
      : [];
    const selectedSha = pointValueBundleSelect.value;
    const bundle = overlays.find((candidate) => candidate.bundleSha256 === selectedSha) || overlays[0];
    pointValueFacts.replaceChildren();
    pointValueWarning.replaceChildren();
    pointValueWarning.hidden = true;
    pointValueRemainingList.replaceChildren();
    pointValueCurrentImage = null;
    pointValueImage.removeAttribute("src");
    renderRoomEnvelopeDraft();

    if (!bundle) {
      pointValueCaption.textContent = "No V7-established Potree bundle was available for numeric decoding.";
      pointValueWarning.append(
        element("strong", "", "No decoded point preview was established."),
        element("p", "", "The V8 artifact remains downloadable, but no image is available for this source set.")
      );
      pointValueWarning.hidden = false;
      return;
    }
    pointValueBundleSelect.value = bundle.bundleSha256;
    if (roomEnvelopeActiveBundleSha256 !== bundle.bundleSha256) {
      resetRoomEnvelopeDraft(bundle.bundleSha256);
    }
    const outcome = bundle.pointValues;
    const remaining = Array.isArray(bundle.remainingUnknownCodes)
      ? bundle.remainingUnknownCodes
      : [];
    pointValueRemainingSummary.textContent = "What this still does not establish (" + remaining.length.toLocaleString() + ")";
    for (const code of remaining) {
      pointValueRemainingList.append(element("li", "", sourceFactLabel(code)));
    }

    if (!outcome || outcome.state !== "established" || !outcome.facts) {
      pointValueCaption.textContent = "No diagnostic image was issued for this exact bundle.";
      pointValueWarning.append(
        element("strong", "", "Numeric values were not established for this bundle."),
        element("p", "", "Recorded outcome: " + sourceFactLabel(outcome && outcome.code || "point value result unavailable") + ". No partial preview is shown.")
      );
      pointValueWarning.hidden = false;
      pointValueFacts.append(
        pointValueFactCard("Bundle fingerprint", bundle.bundleSha256),
        pointValueFactCard("Outcome", sourceFactLabel(outcome && outcome.category || "not established"))
      );
      return;
    }

    const facts = outcome.facts;
    const duplicate = facts.deepProfile;
    const duplicateCopy = duplicate && duplicate.state === "performed"
      ? Number(duplicate.uniquePositionCount).toLocaleString() + " unique positions; " +
        Number(duplicate.duplicatePositionRecordCount).toLocaleString() + " records beyond the first at repeated positions; maximum multiplicity " +
        Number(duplicate.maximumPositionMultiplicity).toLocaleString() + ". This is an observation, not a corruption claim."
      : "Exact duplicate profiling was not performed because the transparent point-count threshold was exceeded.";
    pointValueFacts.append(
      pointValueFactCard(
        "Decoder-coordinate range",
        "Minimum " + pointValueVector(facts.position.decodedMin) + "; maximum " + pointValueVector(facts.position.decodedMax) + ". No units, orientation, frame, or physical meaning are established."
      ),
      pointValueFactCard(
        "Intensity byte",
        "Observed " + Number(facts.intensity.observedMin).toLocaleString() + "–" + Number(facts.intensity.observedMax).toLocaleString() +
        " across " + Number(facts.intensity.distinctCount).toLocaleString() + " byte values; mean " + pointValueMean(facts.intensity, facts.recordCount) + "."
      ),
      pointValueFactCard(
        "Opaque vendor byte",
        "Declared name “lcc prediction”; observed " + Number(facts.opaqueVendorByte.observedMin).toLocaleString() + "–" +
        Number(facts.opaqueVendorByte.observedMax).toLocaleString() + " across " + Number(facts.opaqueVendorByte.distinctCount).toLocaleString() +
        " byte values; mean " + pointValueMean(facts.opaqueVendorByte, facts.recordCount) + ". Its semantics remain unknown."
      ),
      pointValueFactCard("Repeated-position profile", duplicateCopy)
    );

    const warnings = Array.isArray(facts.qualityWarnings) ? facts.qualityWarnings : [];
    if (warnings.length > 0) {
      pointValueWarning.append(
        element("strong", "", "A concentrated repeated-position pattern is visible."),
        element("p", "", "The app reports the exact concentration instead of hiding overdraw. The bytes alone do not establish its cause.")
      );
      const warningList = element("ul");
      for (const warning of warnings) warningList.append(element("li", "", sourceFactLabel(warning)));
      pointValueWarning.append(warningList);
      pointValueWarning.hidden = false;
    }

    const viewId = pointValueSelectedRadio("point-value-plane", "position_0_1");
    const mode = pointValueSelectedRadio("point-value-mode", "omitted_component");
    const images = facts.previews && Array.isArray(facts.previews.images)
      ? facts.previews.images
      : [];
    const image = images.find((candidate) => candidate.viewId === viewId && candidate.mode === mode);
    if (!image) {
      pointValueCaption.textContent = "The selected digest-bound preview is unavailable.";
      return;
    }
    pointValueCurrentImage = { bundle, image };
    pointValueImage.alt = (pointValueViewLabels[viewId] || sourceFactLabel(viewId)) +
      " deterministic point diagnostic using " + (pointValueModeLabels[mode] || sourceFactLabel(mode)) +
      "; no units, up axis, or physical orientation are asserted.";
    pointValueImage.src = pointValuePreviewUrl("/api/potree-point-preview", bundle, image);
    pointValueCaption.textContent =
      (pointValueViewLabels[viewId] || sourceFactLabel(viewId)) + " · " +
      (pointValueModeLabels[mode] || sourceFactLabel(mode)) + " · " +
      Number(image.occupiedPixelCount).toLocaleString() + " occupied pixels · maximum " +
      Number(image.maxRecordsPerPixel).toLocaleString() + " records in one pixel. For each occupied pixel, the record with the numerically greatest omitted position component is drawn; ties keep the lowest source ordinal.";
    renderRoomEnvelopeDraft();
    if (typeof pointValueImageViewport.scrollTo === "function") {
      pointValueImageViewport.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }

  function renderPointValueDiagnostic(value) {
    pointValueDiagnostic = value;
    pointValueDiagnosticPanel.hidden = false;
    pointValueDownloadStatus.textContent = "";
    const factsV8 = value.sourceFacts;
    const readinessV8 = value.sourceReadiness;
    const checklistV8 = value.operatorEvidenceChecklist;
    setText("point-value-facts-sha", factsV8.factsSha256);
    pointValueSummary.replaceChildren();
    const summary = factsV8.summary || {};
    const checklistSummary = checklistV8 && checklistV8.summary || {};
    const summaryItems = [
      ["Records decoded", summary.decodedRecordCount],
      ["Diagnostic PNGs", summary.previewImageCount],
      ["Bundles established", summary.pointValueEstablishedBundleCount],
      ["V7 request resolved", checklistSummary.resolvedPotreeUnknownRequestCount],
      ["Potree unknowns left", summary.remainingPotreeUnknownCount]
    ];
    for (const item of summaryItems) {
      const block = element("div");
      block.append(element("dt", "", item[0]), element("dd", "", Number(item[1] || 0).toLocaleString()));
      pointValueSummary.append(block);
    }
    pointValueBundleSelect.replaceChildren();
    for (const bundle of factsV8.pointValueBundles || []) {
      const option = element("option", "", (bundle.bundleRoot || "Selected receipt root") + " · " + bundle.bundleSha256.slice(0, 12) + "…");
      option.value = bundle.bundleSha256;
      pointValueBundleSelect.append(option);
    }
    if (pointValueBundleSelect.options.length === 0) {
      const option = element("option", "", "No V7-established bundle");
      option.value = "";
      pointValueBundleSelect.append(option);
      pointValueBundleSelect.disabled = true;
    } else {
      pointValueBundleSelect.disabled = false;
    }
    if (!readinessV8 || !checklistV8) {
      pointValueWarning.append(element("strong", "", "The V8 evidence chain is incomplete."));
      pointValueWarning.hidden = false;
    }
    renderPointValueCurrentBundle();
  }

  function sourceReadinessStatusLabel(status) {
    const labels = {
      all_observed_facts_established: "All observed Source Facts V6 established",
      evidence_incomplete: "Evidence incomplete",
      no_source_observed: "No source observed",
      blocked: "Evaluation withheld",
      facts_established: "Source Facts V6 established",
      facts_not_established: "Evidence incomplete",
      outside_source_facts_v6: "Outside Source Facts V6",
      ambiguous_format: "Format ambiguous",
      unclassified_format: "Format unclassified"
    };
    return labels[status] || sourceFactLabel(status || "evidence_incomplete");
  }

  function sourceReadinessLaneCounts(lane) {
    return lane.counts && typeof lane.counts === "object" ? lane.counts : {};
  }

  function appendSourceReadinessPaths(parent, paths, label) {
    if (!Array.isArray(paths) || paths.length === 0) return;
    const details = element("details", "readiness-details readiness-gap-paths");
    details.append(element("summary", "", label + " (" + paths.length.toLocaleString() + ")"));
    const list = element("ul");
    for (const path of paths) {
      const value = typeof path === "string" ? path : path && (path.path || path.relativePath);
      if (value) {
        const item = element("li");
        item.append(element("code", "", String(value)));
        list.append(item);
      }
    }
    details.append(list);
    parent.append(details);
  }

  function appendSourceReadinessGap(parent, gap) {
    if (!gap || typeof gap !== "object") return;
    const item = element("li");
    item.append(element("strong", "", gap.label || sourceFactLabel(gap.code || "Evidence gap")));
    if (gap.reason) item.append(element("p", "", String(gap.reason)));
    if (gap.decisiveNextTest) {
      item.append(element("span", "readiness-gap-next", "Next test: " + String(gap.decisiveNextTest)));
    }
    appendSourceReadinessPaths(item, gap.sourcePaths || [], "Affected source paths");
    parent.append(item);
  }

  function renderInheritedSourceReadiness(value) {
    if (value.state === "blocked") {
      const blocked = value.blockedReason || {};
      const affectedSources = blocked.affectedSources || [];
      sourceReadinessSummary.hidden = true;
      sourceReadinessLanes.hidden = true;
      sourceReadinessBlocker.append(
        element("strong", "", blocked.message || "The source map is withheld for this source set."),
        element("p", "", blocked.nextAction || "Request an official export in an open documented format.")
      );
      appendSourceReadinessPaths(sourceReadinessBlocker, affectedSources, "Affected source paths");
      sourceReadinessBlocker.hidden = false;
      return;
    }

    for (const lane of value.lanes || []) {
      const row = element("article", "source-readiness-lane");
      row.dataset.laneId = lane.id;
      const head = element("div", "readiness-lane-head");
      const heading = element("div");
      heading.append(
        element("h4", "", lane.heading),
        element("p", "readiness-lane-meaning", lane.meaning),
        element("code", "readiness-reason-code", "Reason code: " + lane.reasonCode)
      );
      const status = element("span", "readiness-status", sourceReadinessStatusLabel(lane.status));
      status.dataset.state = lane.status;
      head.append(heading, status);
      row.append(head);

      const counts = element("dl", "readiness-counts");
      for (const [key, count] of Object.entries(sourceReadinessLaneCounts(lane))) {
        if (count === undefined) continue;
        const block = element("div");
        block.append(element("dt", "", sourceFactLabel(key)), element("dd", "", Number(count).toLocaleString()));
        counts.append(block);
      }
      row.append(counts);

      const representedSources = Array.isArray(lane.representedSources) ? lane.representedSources : [];
      if (representedSources.length > 0) {
        const details = element("details", "readiness-details");
        details.append(element("summary", "", "Sources represented (" + representedSources.length.toLocaleString() + ")"));
        const list = element("ul", "readiness-source-list");
        for (const source of representedSources) {
          const item = element("li");
          item.append(
            element("code", "", source.path),
            element("span", "", "SHA-256 " + source.sha256),
            element("span", "", sourceReadinessStatusLabel(source.status))
          );
          list.append(item);
        }
        details.append(list);
        row.append(details);
      }

      const laneGenericGaps = Array.isArray(value.gaps)
        ? value.gaps.filter((gap) => Array.isArray(gap.laneIds) && gap.laneIds.includes(lane.id))
        : [];
      const unknowns = [
        ...(Array.isArray(lane.unknowns) ? lane.unknowns : []),
        ...laneGenericGaps
      ];
      if (unknowns.length > 0) {
        const details = element("details", "readiness-details");
        details.append(element("summary", "", "Grouped gaps (" + unknowns.length.toLocaleString() + ")"));
        const list = element("ul", "readiness-gap-list");
        for (const unknown of unknowns) appendSourceReadinessGap(list, unknown);
        details.append(list);
        row.append(details);
      }

      const nextTests = Array.isArray(lane.decisiveNextTests) ? lane.decisiveNextTests : [];
      const next = element("div", "readiness-next");
      next.append(element("strong", "", nextTests.length === 1 ? "Decisive next test" : "Decisive next tests"));
      const nextList = element("ul", "readiness-next-tests");
      if (nextTests.length === 0) {
        nextList.append(element("li", "", "No additional receipt-stage test is declared."));
      } else {
        for (const test of nextTests) nextList.append(element("li", "", String(test)));
      }
      next.append(nextList);
      row.append(next);
      sourceReadinessLanes.append(row);
    }
  }

  function renderPotreeSourceReadiness(refinements) {
    potreeSourceReadinessList.replaceChildren();
    const values = Array.isArray(refinements) ? refinements : [];
    potreeSourceReadinessPanel.hidden = values.length === 0;
    for (const refinement of values) {
      const bundle = refinement.sourceFactsBundle || {};
      const card = element("article", "potree-refinement-card");
      card.dataset.bundleSha256 = bundle.bundleSha256 || "";
      const head = element("div", "potree-refinement-card-head");
      const identity = element("div");
      identity.append(
        element("h5", "", bundle.bundleRoot || "Selected receipt root"),
        element("p", "potree-bundle-identity", "Bundle fingerprint SHA-256 " + (bundle.bundleSha256 || "Not established")),
        element("p", "potree-bundle-identity", "Refines point geometry evidence only · inherited V6 rows remain unchanged")
      );
      const status = element("span", "readiness-status", refinement.status === "facts_established" ? "Potree structure established" : "Potree structure not established");
      status.dataset.state = refinement.status === "facts_established" ? "all_observed_facts_established" : "evidence_incomplete";
      head.append(identity, status);
      card.append(head);
      card.append(element("p", "", "Inspection " + sourceFactLabel(bundle.inspection && bundle.inspection.code || "not available") + ". This is format evidence, not processing readiness."));

      const superseded = Array.isArray(refinement.supersededInheritedEvidence)
        ? refinement.supersededInheritedEvidence
        : [];
      const details = element("details", "potree-member-details");
      details.append(element("summary", "", "View-only inherited-path refinements (" + superseded.length.toLocaleString() + ")"));
      const list = element("ul", "potree-supersession-list");
      for (const row of superseded) {
        const item = element("li");
        item.append(
          element("code", "", row.path),
          element("span", "", sourceReadinessStatusLabel(row.inheritedStatus) + " → " + (row.refinedStatus === "facts_established" ? "Potree structure established" : "Potree structure not established") + " · inherited gap " + row.inheritedGapCode)
        );
        list.append(item);
      }
      if (superseded.length === 0) {
        list.append(element("li", "", "No generic inherited member-path gap was superseded in this view."));
      }
      details.append(list);
      card.append(details);
      appendPotreeMemberIdentities(card, bundle);
      appendPotreeCompatibility(card, bundle);
      potreeSourceReadinessList.append(card);
    }
  }

  function renderSourceReadiness(value) {
    sourceReadiness = value;
    sourceReadinessDownloadStatus.textContent = "";
    sourceReadinessPanel.hidden = false;
    sourceReadinessSummary.replaceChildren();
    sourceReadinessBlocker.replaceChildren();
    sourceReadinessLanes.replaceChildren();
    sourceReadinessSummary.hidden = false;
    sourceReadinessBlocker.hidden = true;
    sourceReadinessLanes.hidden = false;
    sourceReadinessFooter.hidden = false;
    setText("source-readiness-sha", value.readinessSha256);

    const summary = value.summary || {};
    const summaryItems = [
      ["Files in receipt", summary.receiptFileCount],
      ["Potree bundles", summary.potreeBundleCount],
      ["Potree structures established", summary.potreeBundleEstablishedCount],
      ["Potree structures not established", summary.potreeBundleFactsNotEstablishedCount],
      ["Exact Potree member paths", summary.potreeMemberSourceCount],
      ["Inherited paths refined in this view", summary.supersededInheritedPathCount]
    ];
    for (const item of summaryItems) {
      const block = element("div");
      block.append(element("dt", "", item[0]), element("dd", "", Number(item[1] || 0).toLocaleString()));
      sourceReadinessSummary.append(block);
    }

    if (!value.inherited) {
      sourceReadinessSummary.hidden = true;
      sourceReadinessLanes.hidden = true;
      sourceReadinessBlocker.append(element("strong", "", "The inherited V6 readiness map is missing."));
      sourceReadinessBlocker.hidden = false;
      renderPotreeSourceReadiness([]);
      return;
    }
    renderInheritedSourceReadiness(value.inherited);
    renderPotreeSourceReadiness(value.potreeBundleRefinements);
  }

  function operatorEvidencePriorityLabel(priority) {
    const labels = {
      blocking: "Blocking evidence dependency",
      high: "Resolve existing-source foundation",
      normal: "Establish an unproven fact",
      conditional: "Conditional source opportunity"
    };
    return labels[priority] || sourceFactLabel(priority || "evidence request");
  }

  function appendOperatorEvidenceSources(parent, sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
      parent.append(element("p", "evidence-no-source", "No existing source path — this conditional request concerns a missing source family. Its necessity is not evaluated."));
      return;
    }
    const details = element("details", "evidence-source-details");
    const distinctContentCount = new Set(sources.map((source) => String(source.sha256) + ":" + String(source.sizeBytes))).size;
    const pathLabel = sources.length === 1 ? "path" : "paths";
    const contentLabel = distinctContentCount === 1 ? "content" : "contents";
    details.append(element("summary", "", "Affected source paths (" + sources.length.toLocaleString() + " " + pathLabel + " · " + distinctContentCount.toLocaleString() + " distinct " + contentLabel + ")"));
    let populated = false;
    details.addEventListener("toggle", () => {
      if (!details.open || populated) return;
      populated = true;
      const list = element("ul", "evidence-source-list");
      for (const source of sources) {
        const item = element("li");
        item.append(
          element("code", "", source.path),
          element("span", "", "SHA-256 " + source.sha256)
        );
        if (Array.isArray(source.laneIds) && source.laneIds.length > 0) {
          item.append(element("span", "", "Source families: " + source.laneIds.map(sourceFactLabel).join(", ")));
        }
        if (source.duplicate && source.duplicate.status === "exact_content_duplicate") {
          item.append(element("span", "", "Content identity: exact-content duplicate · group SHA-256 " + source.duplicate.groupSha256));
        } else if (source.duplicate && source.duplicate.status === "unique") {
          item.append(element("span", "", "Content identity: unique within this receipt"));
        }
        if (source.readinessStatus) {
          item.append(element("span", "", "Readiness evidence: " + sourceReadinessStatusLabel(source.readinessStatus)));
        }
        if (source.inspection) {
          item.append(element("span", "", "Inspection: " + source.inspection.code + " · " + source.inspection.category + " · " + source.inspection.coverage));
        }
        list.append(item);
      }
      details.append(list);
    });
    parent.append(details);
  }

  function appendOperatorEvidenceRequest(parent, value) {
    const request = element("div", "evidence-request-panel");
    request.append(
      element("strong", "", "Requested evidence"),
      element("p", "", value.requestedEvidence || "No evidence request was recorded.")
    );
    parent.append(request);

    const completion = element("section", "evidence-completion");
    completion.append(element("strong", "", "Completion evidence"));
    const criteria = element("ol");
    for (const requirement of value.completionEvidenceRequirements || []) {
      criteria.append(element("li", "", String(requirement)));
    }
    completion.append(criteria);
    parent.append(completion);
    if (value.completionLimits) {
      parent.append(element("p", "evidence-completion-limits", "Still not established: " + String(value.completionLimits)));
    }
  }

  function renderOperatorEvidenceItem(item) {
    const row = element("article", "operator-evidence-item");
    row.dataset.evidenceCode = item.evidenceCode;
    const head = element("div", "operator-evidence-item-head");
    const identity = element("div");
    identity.append(
      element("h5", "", item.label),
      element("code", "operator-evidence-meta", "Evidence code: " + item.evidenceCode + " · " + sourceFactLabel(item.category) + " · necessity not evaluated")
    );
    const priority = element("span", "evidence-priority", operatorEvidencePriorityLabel(item.evidencePriority));
    priority.dataset.priority = item.evidencePriority;
    head.append(identity, priority);
    row.append(head);
    row.append(element("p", "operator-evidence-reason", item.reason));
    appendOperatorEvidenceRequest(row, item);
    row.append(element("span", "evidence-lanes", "Affected source families: " + (item.laneIds || []).map(sourceFactLabel).join(", ")));
    appendOperatorEvidenceSources(row, item.affectedSources || []);
    return row;
  }

  function renderInheritedOperatorEvidenceChecklist(value) {
    if (value.state === "blocked") {
      const blocked = value.blockedReason || {};
      operatorEvidenceSummary.hidden = true;
      operatorEvidenceGroups.hidden = true;
      operatorEvidenceBlocker.append(
        element("strong", "", blocked.label || "Request an official open-format export"),
        element("p", "", blocked.reason || "The checklist is blocked by an opaque source."),
        element("span", "evidence-priority", operatorEvidencePriorityLabel("blocking"))
      );
      operatorEvidenceBlocker.querySelector(".evidence-priority").dataset.priority = "blocking";
      appendOperatorEvidenceRequest(operatorEvidenceBlocker, blocked);
      appendOperatorEvidenceSources(operatorEvidenceBlocker, blocked.affectedSources || []);
      operatorEvidenceBlocker.hidden = false;
      return;
    }

    const itemsById = new Map((value.items || []).map((item) => [item.id, item]));
    for (const group of value.groups || []) {
      const section = element("section", "operator-evidence-group");
      section.dataset.groupId = group.id;
      const head = element("div", "operator-evidence-group-head");
      const identity = element("div");
      identity.append(
        element("h4", "", group.heading),
        element("p", "", group.meaning)
      );
      const priority = element("span", "evidence-priority", operatorEvidencePriorityLabel(group.priority));
      priority.dataset.priority = group.priority;
      head.append(identity, priority);
      section.append(head);
      const list = element("div", "operator-evidence-items");
      for (const itemId of group.itemIds || []) {
        const item = itemsById.get(itemId);
        if (item) list.append(renderOperatorEvidenceItem(item));
      }
      section.append(list);
      operatorEvidenceGroups.append(section);
    }
  }

  function renderPotreeEvidenceRequest(request) {
    const row = element("article", "operator-evidence-item");
    row.dataset.evidenceCode = request.evidenceCode;
    const inspection = request.sourceFactsBundle && request.sourceFactsBundle.inspection
      ? request.sourceFactsBundle.inspection
      : { code: "INSPECTION_NOT_AVAILABLE", coverage: "none" };
    const head = element("div", "operator-evidence-item-head");
    const identity = element("div");
    identity.append(
      element("h5", "", request.label),
      element("code", "operator-evidence-meta", "Evidence code: " + request.evidenceCode + " · point geometry · necessity not evaluated")
    );
    const priority = element("span", "evidence-priority", request.basisKind === "potree_bundle_inspection_failure" ? "Resolve structural inspection" : "Establish an unproven Potree fact");
    priority.dataset.priority = request.basisKind === "potree_bundle_inspection_failure" ? "high" : "normal";
    head.append(identity, priority);
    row.append(head);
    row.append(
      element("p", "operator-evidence-reason", request.reason),
      element("p", "operator-evidence-meta", "Requested, not performed · inspection " + inspection.code + " · " + sourceFactLabel(inspection.coverage))
    );
    const requested = element("div", "evidence-request-panel");
    requested.append(
      element("strong", "", "Requested evidence"),
      element("p", "", request.requestedEvidence)
    );
    row.append(requested);
    appendOperatorEvidenceSources(row, request.affectedSources || []);
    return row;
  }

  function renderPotreeOperatorEvidence(requests, supersededRefs) {
    potreeOperatorEvidenceList.replaceChildren();
    const values = Array.isArray(requests) ? requests : [];
    const refs = Array.isArray(supersededRefs) ? supersededRefs : [];
    potreeOperatorEvidencePanel.hidden = values.length === 0 && refs.length === 0;
    const groups = new Map();
    for (const request of values) {
      const key = request.bundleSha256;
      const group = groups.get(key) || { bundleRoot: request.bundleRoot, requests: [] };
      group.requests.push(request);
      groups.set(key, group);
    }
    for (const reference of refs) {
      const key = reference.bundleSha256;
      const group = groups.get(key) || { bundleRoot: reference.bundleRoot, requests: [] };
      groups.set(key, group);
    }
    for (const [bundleSha256, group] of groups) {
      const card = element("article", "potree-evidence-card");
      card.dataset.bundleSha256 = bundleSha256;
      card.append(
        element("h5", "", group.bundleRoot || "Selected receipt root"),
        element("p", "potree-bundle-identity", "Bundle fingerprint SHA-256 " + bundleSha256)
      );
      const list = element("div", "operator-evidence-items");
      for (const request of group.requests) list.append(renderPotreeEvidenceRequest(request));
      card.append(list);

      const bundleRefs = refs.filter((reference) => reference.bundleSha256 === bundleSha256);
      const details = element("details", "potree-member-details");
      details.append(element("summary", "", "Inherited V6 request references refined in this view (" + bundleRefs.length.toLocaleString() + ")"));
      const refList = element("ul", "potree-supersession-list");
      for (const reference of bundleRefs) {
        const item = element("li");
        item.append(
          element("strong", "", reference.inheritedEvidenceCode),
          element("span", "", "Inherited request " + reference.inheritedItemId + " remains preserved."),
          ...reference.sourcePaths.map((path) => element("code", "", path))
        );
        refList.append(item);
      }
      if (bundleRefs.length === 0) refList.append(element("li", "", "No inherited V6 request reference is refined for this bundle."));
      details.append(refList);
      card.append(details);
      potreeOperatorEvidenceList.append(card);
    }
  }

  function renderOperatorEvidenceChecklist(value) {
    operatorEvidenceChecklist = value;
    operatorEvidencePanel.hidden = false;
    operatorEvidenceSummary.replaceChildren();
    operatorEvidenceBlocker.replaceChildren();
    operatorEvidenceGroups.replaceChildren();
    operatorEvidenceSummary.hidden = false;
    operatorEvidenceBlocker.hidden = true;
    operatorEvidenceGroups.hidden = false;
    operatorEvidenceFooter.hidden = false;
    operatorEvidenceDownloadStatus.textContent = "";
    setText("operator-evidence-sha", value.checklistSha256);

    const summary = value.summary || {};
    const summaryItems = [
      ["Inherited V6 requests", summary.inheritedEvidenceRequestCount],
      ["Potree requests", summary.potreeEvidenceRequestCount],
      ["Structural inspection requests", summary.potreeInspectionFailureRequestCount],
      ["Potree unknown requests", summary.potreeUnknownRequestCount],
      ["Exact Potree member paths", summary.affectedPotreeMemberSourceCount],
      ["Inherited source paths refined in this view", summary.supersededInheritedSourcePathCount]
    ];
    for (const item of summaryItems) {
      const block = element("div");
      block.append(element("dt", "", item[0]), element("dd", "", Number(item[1] || 0).toLocaleString()));
      operatorEvidenceSummary.append(block);
    }
    if (!value.inherited) {
      operatorEvidenceSummary.hidden = true;
      operatorEvidenceGroups.hidden = true;
      operatorEvidenceBlocker.append(element("strong", "", "The inherited V6 operator evidence checklist is missing."));
      operatorEvidenceBlocker.hidden = false;
      renderPotreeOperatorEvidence([], []);
      return;
    }
    renderInheritedOperatorEvidenceChecklist(value.inherited);
    renderPotreeOperatorEvidence(value.potreeEvidenceRequests, value.supersededInheritedRequestRefs);
  }

  function requireLocalE57IntakeEnvironmentReadiness(value, parentManifestSha256) {
    const topLevelKeys = [
      "schemaVersion",
      "environmentSha256",
      "parentHdWorkerManifestSha256",
      "overall",
      "environmentState",
      "installationState",
      "bundleVerificationState",
      "binding",
      "execution",
      "authority",
      "target",
      "summary",
      "activity",
      "artifacts",
      "compatibility",
      "bundle",
      "openItems",
      "nextAction",
      "followUp"
    ];
    const isNonemptyString = (input, maximumLength = 1000) =>
      typeof input === "string" && input.trim().length > 0 && input.length <= maximumLength;
    if (!hasExactObjectKeys(value, topLevelKeys)) {
      throw new Error("The local server returned no exact E57 environment closure.");
    }
    const exactStates = {
      schemaVersion: "omnitwin.local-foundry.local-e57-intake-environment-readiness.v0",
      overall: "exact_artifacts_recorded_bundle_not_materialized_not_execution_ready",
      environmentState: "recorded_with_materialization_and_runtime_closure_open",
      installationState: "not_installed",
      bundleVerificationState: "not_performed",
      binding: "not_bound_to_current_source_or_plan",
      execution: "disabled",
      authority: "none"
    };
    for (const key of Object.keys(exactStates)) {
      if (value[key] !== exactStates[key]) {
        throw new Error("The E57 environment crossed a fail-closed state boundary.");
      }
    }
    if (
      !/^[a-f0-9]{64}$/.test(value.environmentSha256 || "") ||
      value.environmentSha256 !==
        "34ad3f54ea5a5afcca908c66f48ab039381d6910b2372afbafee0c1f8545ea1e" ||
      !/^[a-f0-9]{64}$/.test(value.parentHdWorkerManifestSha256 || "") ||
      value.parentHdWorkerManifestSha256 !== parentManifestSha256
    ) {
      throw new Error("The E57 environment is not bound to this exact worker plan.");
    }
    if (
      !hasExactObjectKeys(value.target, [
        "operatingSystem",
        "architecture",
        "pythonVersion",
        "pythonAbi",
        "laneScope",
        "parentE57CandidateDisposition",
        "unifiedWithOpen3d"
      ]) ||
      value.target.operatingSystem !== "windows" ||
      value.target.architecture !== "x64" ||
      value.target.pythonVersion !== "3.13.14" ||
      value.target.pythonAbi !== "cp313" ||
      value.target.laneScope !== "e57_read_only_intake_only" ||
      value.target.parentE57CandidateDisposition !== "superseded_by_this_environment" ||
      value.target.unifiedWithOpen3d !== false
    ) {
      throw new Error("The E57 environment target is not the exact independent cp313 lane.");
    }
    if (
      !hasExactObjectKeys(value.summary, [
        "artifactCount",
        "dependencyEdgeCount",
        "pye57MemberCount",
        "legalMaterialCount",
        "openItemCount"
      ]) ||
      value.summary.artifactCount !== 4 ||
      value.summary.dependencyEdgeCount !== 3 ||
      value.summary.pye57MemberCount !== 13 ||
      value.summary.legalMaterialCount !== 29 ||
      value.summary.openItemCount !== 6
    ) {
      throw new Error("The E57 environment summary does not match its exact closure record.");
    }
    if (
      !hasExactObjectKeys(value.activity, [
        "packageInstallerUsed",
        "systemInstallationPerformed",
        "isolatedArchiveExtractionPerformed",
        "isolatedSyntheticCompatibilitySmokePerformed",
        "venueDataAccessed",
        "userProvidedSourceFileRead",
        "syntheticFixtureFileRead",
        "cloudWorkloadStarted"
      ]) ||
      value.activity.packageInstallerUsed !== false ||
      value.activity.systemInstallationPerformed !== false ||
      value.activity.isolatedArchiveExtractionPerformed !== true ||
      value.activity.isolatedSyntheticCompatibilitySmokePerformed !== true ||
      value.activity.venueDataAccessed !== false ||
      value.activity.userProvidedSourceFileRead !== false ||
      value.activity.syntheticFixtureFileRead !== true ||
      value.activity.cloudWorkloadStarted !== false
    ) {
      throw new Error("The E57 environment activity record is inconsistent.");
    }
    const artifactContract = {
      "cpython-runtime": [
        "CPython",
        "3.13.14",
        "python-3.13.14-embed-amd64.zip",
        10964839,
        "90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907",
        "not_applicable",
        "not_applicable",
        "win_amd64"
      ],
      "pye57-wheel": [
        "pye57",
        "0.4.19",
        "pye57-0.4.19-cp313-cp313-win_amd64.whl",
        1130809,
        "d27332054bf18689acb45470a3bc16d4c21ed7b0b0848c56ef9e42cc8980a3c4",
        "cp313",
        "cp313",
        "win_amd64"
      ],
      "numpy-wheel": [
        "NumPy",
        "2.5.1",
        "numpy-2.5.1-cp313-cp313-win_amd64.whl",
        12425674,
        "6c3fe51bc6a16453d452997053454f309e8e0ed7b42d6b361ce4ac8c32913d74",
        "cp313",
        "cp313",
        "win_amd64"
      ],
      "pyquaternion-wheel": [
        "pyquaternion",
        "0.9.9",
        "pyquaternion-0.9.9-py3-none-any.whl",
        14361,
        "e65f6e3f7b1fdf1a9e23f82434334a1ae84f14223eee835190cd2e841f8172ec",
        "py3",
        "none",
        "any"
      ]
    };
    if (!Array.isArray(value.artifacts) || value.artifacts.length !== 4) {
      throw new Error("The E57 environment does not contain four exact archives.");
    }
    const artifactIds = value.artifacts.map((artifact) => artifact && artifact.id);
    if (
      new Set(artifactIds).size !== 4 ||
      artifactIds.join("|") !== Object.keys(artifactContract).join("|")
    ) {
      throw new Error("The E57 environment artifact identities changed.");
    }
    for (const artifact of value.artifacts) {
      if (!hasExactObjectKeys(artifact, [
        "id",
        "packageName",
        "version",
        "filename",
        "byteSize",
        "sha256",
        "pythonTag",
        "abiTag",
        "platformTag"
      ])) {
        throw new Error("An E57 environment archive contains an unexpected field.");
      }
      const expected = artifactContract[artifact.id];
      const actual = [
        artifact.packageName,
        artifact.version,
        artifact.filename,
        artifact.byteSize,
        artifact.sha256,
        artifact.pythonTag,
        artifact.abiTag,
        artifact.platformTag
      ];
      if (!expected || actual.some((entry, index) => entry !== expected[index])) {
        throw new Error("An E57 environment archive no longer matches its exact receipt.");
      }
    }
    if (
      !hasExactObjectKeys(value.compatibility, [
        "state",
        "label",
        "fixture",
        "bundleUnderTest",
        "venueDataAccessed",
        "limitation"
      ]) ||
      value.compatibility.state !== "isolated_unbundled_synthetic_smoke_passed" ||
      value.compatibility.label !== "Synthetic compatibility observed; bundle not tested" ||
      value.compatibility.fixture !== "synthetic_three_cartesian_point_e57" ||
      value.compatibility.bundleUnderTest !== false ||
      value.compatibility.venueDataAccessed !== false ||
      !isNonemptyString(value.compatibility.limitation, 700)
    ) {
      throw new Error("The E57 environment compatibility evidence is overstated or incomplete.");
    }
    if (
      !hasExactObjectKeys(value.bundle, [
        "state",
        "legalPackState",
        "microsoftCppRuntimeState",
        "cleanHostVerificationState",
        "adapterBindingState"
      ]) ||
      value.bundle.state !== "not_materialized" ||
      value.bundle.legalPackState !== "not_assembled" ||
      value.bundle.microsoftCppRuntimeState !== "host_dependency_observed_not_closed" ||
      value.bundle.cleanHostVerificationState !== "not_performed" ||
      value.bundle.adapterBindingState !== "not_wired"
    ) {
      throw new Error("The E57 environment incorrectly claims a closed bundle.");
    }
    const exactOpenItemIds = [
      "microsoft-cpp-runtime",
      "pybind11-build-version",
      "redistribution-pack",
      "exact-extracted-member-manifest",
      "clean-host-bundle-smoke",
      "adapter-runtime-bundle-binding"
    ];
    if (
      !Array.isArray(value.openItems) ||
      value.openItems.length !== 6 ||
      value.openItems.map((item) => item && item.id).join("|") !== exactOpenItemIds.join("|")
    ) {
      throw new Error("The E57 environment does not preserve all six open bundle gates.");
    }
    for (const item of value.openItems) {
      if (
        !hasExactObjectKeys(item, ["id", "label", "reason", "decisiveNextTest"]) ||
        !isNonemptyString(item.label, 160) ||
        !isNonemptyString(item.reason, 700) ||
        !isNonemptyString(item.decisiveNextTest, 700)
      ) {
        throw new Error("The E57 environment contains an invalid open gate.");
      }
    }
    if (!isNonemptyString(value.nextAction, 700)) {
      throw new Error("The E57 environment has no bounded next action.");
    }
    const followUp = value.followUp;
    if (
      !hasExactObjectKeys(followUp, [
        "schemaVersion",
        "parentEnvironmentSha256",
        "state",
        "candidateBundle",
        "legalPack",
        "microsoftCppRuntime",
        "pybind11",
        "adapter",
        "cleanHostQualification",
        "remainingGates",
        "execution",
        "authority",
        "userOrVenueDataAccessed",
        "nextAction"
      ]) ||
      followUp.schemaVersion !== "omnitwin.local-foundry.local-e57-runtime-bundle-follow-up.v0" ||
      followUp.parentEnvironmentSha256 !== value.environmentSha256 ||
      followUp.state !== "candidate_materialized_repeat_receipt_matched_clean_host_open" ||
      followUp.execution !== "disabled" ||
      followUp.authority !== "none" ||
      followUp.userOrVenueDataAccessed !== false ||
      !isNonemptyString(followUp.nextAction, 700)
    ) {
      throw new Error("The E57 runtime follow-up crossed its fail-closed boundary.");
    }
    const candidate = followUp.candidateBundle;
    if (
      !hasExactObjectKeys(candidate, [
        "receiptPath",
        "bundleReceiptSha256",
        "rawReceiptSha256",
        "receiptByteSize",
        "fileCount",
        "totalFileBytes",
        "repeatBuildCount",
        "repeatReceiptByteExact",
        "applicationInstalled"
      ]) ||
      candidate.receiptPath !== "configs/reconstruction/local-e57-runtime-bundle-v0.receipt.json" ||
      candidate.bundleReceiptSha256 !== "9d93928658fb650a319edf1b65bad250b8fa213d810e3554d5e345b42a974696" ||
      candidate.rawReceiptSha256 !== "a617c29cd7e19c17cda0bc61f365c36d382df35c8b73b57a766f32291f1d4e24" ||
      candidate.receiptByteSize !== 183683 ||
      candidate.fileCount !== 1032 ||
      candidate.totalFileBytes !== 66757784 ||
      candidate.repeatBuildCount !== 2 ||
      candidate.repeatReceiptByteExact !== true ||
      candidate.applicationInstalled !== false
    ) {
      throw new Error("The E57 candidate bundle no longer matches its repeated receipt.");
    }
    if (
      !hasExactObjectKeys(followUp.legalPack, [
        "state",
        "materialCount",
        "pybind11NoticeByteSize",
        "pybind11NoticeSha256",
        "parentEnvironmentLegalReceiptsApplied"
      ]) ||
      followUp.legalPack.state !== "assembled_in_candidate_bundle" ||
      followUp.legalPack.materialCount !== 30 ||
      followUp.legalPack.pybind11NoticeByteSize !== 1684 ||
      followUp.legalPack.pybind11NoticeSha256 !== "83965b843b98f670d3a85bd041ed4b372c8ec50d7b4a5995a83ac697ba675dcb" ||
      followUp.legalPack.parentEnvironmentLegalReceiptsApplied !== true
    ) {
      throw new Error("The E57 legal pack is incomplete or overstated.");
    }
    if (
      !hasExactObjectKeys(followUp.microsoftCppRuntime, [
        "disposition",
        "selectedVersion",
        "installerBundled",
        "installationState",
        "organizationRedistributionAuthorization"
      ]) ||
      followUp.microsoftCppRuntime.disposition !== "central_prerequisite_direct_from_microsoft" ||
      followUp.microsoftCppRuntime.selectedVersion !== "14.51.36247" ||
      followUp.microsoftCppRuntime.installerBundled !== false ||
      followUp.microsoftCppRuntime.installationState !== "not_performed" ||
      followUp.microsoftCppRuntime.organizationRedistributionAuthorization !== "not_evidenced"
    ) {
      throw new Error("The declared Microsoft runtime prerequisite is not fail-closed.");
    }
    if (
      !hasExactObjectKeys(followUp.pybind11, [
        "versionClaim",
        "noticeState",
        "buildProvenanceState"
      ]) ||
      followUp.pybind11.versionClaim !== "inferred_3.0.1_not_attested" ||
      followUp.pybind11.noticeState !== "exact_version_invariant_notice_included" ||
      followUp.pybind11.buildProvenanceState !== "unresolved_opaque_publisher_binary"
    ) {
      throw new Error("The pybind11 record overstates publisher build provenance.");
    }
    if (
      !hasExactObjectKeys(followUp.adapter, [
        "wiringState",
        "productionBindingState",
        "defaultBinding",
        "looseDependencyFoldersAcceptedForExecution"
      ]) ||
      followUp.adapter.wiringState !== "complete_and_fail_closed" ||
      followUp.adapter.productionBindingState !== "withheld_pending_clean_host_qualification" ||
      followUp.adapter.defaultBinding !== null ||
      followUp.adapter.looseDependencyFoldersAcceptedForExecution !== false
    ) {
      throw new Error("The E57 adapter is not preserving its withheld production binding.");
    }
    if (
      !hasExactObjectKeys(followUp.cleanHostQualification, [
        "state",
        "requiredBeforeProductionBinding",
        "userOrVenueDataRequired"
      ]) ||
      followUp.cleanHostQualification.state !== "not_performed" ||
      followUp.cleanHostQualification.requiredBeforeProductionBinding !== true ||
      followUp.cleanHostQualification.userOrVenueDataRequired !== false
    ) {
      throw new Error("The clean-host qualification state is overstated.");
    }
    const followUpGateIds = [
      "central-runtime-setup-review",
      "clean-host-qualification",
      "production-adapter-binding"
    ];
    if (
      !Array.isArray(followUp.remainingGates) ||
      followUp.remainingGates.length !== 3 ||
      followUp.remainingGates.map((gate) => gate && gate.id).join("|") !== followUpGateIds.join("|")
    ) {
      throw new Error("The E57 runtime follow-up does not preserve all remaining gates.");
    }
    for (const gate of followUp.remainingGates) {
      if (
        !hasExactObjectKeys(gate, ["id", "label", "reason", "decisiveNextTest"]) ||
        !isNonemptyString(gate.label, 160) ||
        !isNonemptyString(gate.reason, 700) ||
        !isNonemptyString(gate.decisiveNextTest, 700)
      ) {
        throw new Error("The E57 runtime follow-up contains an invalid gate.");
      }
    }
    return value;
  }

  function requireLocalHdWorkerReadiness(value) {
    const topLevelKeys = [
      "schemaVersion",
      "manifestSha256",
      "overall",
      "manifestState",
      "installationState",
      "runtimeVerificationState",
      "binding",
      "execution",
      "authority",
      "summary",
      "activity",
      "architecture",
      "capabilityLanes",
      "components",
      "exclusions",
      "legacyWorkerImageRefusal",
      "nextAction",
      "e57Environment"
    ];
    if (!hasExactObjectKeys(value, topLevelKeys)) {
      throw new Error("The local server returned no build-owned worker environment plan.");
    }
    const isNonemptyString = (input, maximumLength = 1000) =>
      typeof input === "string" && input.trim().length > 0 && input.length <= maximumLength;
    const hasUniqueSafeIds = (items) => {
      const ids = items.map((item) => item && item.id);
      return ids.every((id) => typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,119}$/.test(id)) &&
        new Set(ids).size === ids.length;
    };
    const hasExactIdSet = (items, expectedIds) => {
      const actual = items.map((item) => item.id).sort();
      const expected = [...expectedIds].sort();
      return actual.length === expected.length &&
        actual.every((id, index) => id === expected[index]);
    };
    const exactStates = {
      schemaVersion: "omnitwin.local-foundry.local-hd-worker-readiness.v0",
      overall: "planned_not_installed_not_execution_ready",
      manifestState: "recorded_with_open_closure_items",
      installationState: "not_installed",
      runtimeVerificationState: "not_performed",
      binding: "not_bound_to_current_source_or_plan",
      execution: "disabled",
      authority: "none"
    };
    for (const key of Object.keys(exactStates)) {
      if (value[key] !== exactStates[key]) {
        throw new Error("The local server returned a worker environment state this page does not accept.");
      }
    }
    if (!/^[a-f0-9]{64}$/.test(value.manifestSha256 || "")) {
      throw new Error("The worker environment plan has no valid fingerprint.");
    }
    if (
      !hasExactObjectKeys(value.summary, [
        "capabilityLaneCount",
        "componentCount",
        "openComponentClosureCount",
        "exclusionCount"
      ]) ||
      !hasExactObjectKeys(value.activity, [
        "workerInstallationPerformed",
        "workerRuntimeVerificationPerformed",
        "venueDataAccessed",
        "cloudWorkloadStarted",
        "modelOptimizationStarted"
      ]) ||
      !hasExactObjectKeys(value.architecture, [
        "localWindowsGaussianTraining",
        "gaussianTrainingLocation",
        "gpuWorkerImage"
      ])
    ) {
      throw new Error("The worker environment plan is missing its fail-closed summary.");
    }
    if (
      value.activity.workerInstallationPerformed !== false ||
      value.activity.workerRuntimeVerificationPerformed !== false ||
      value.activity.venueDataAccessed !== false ||
      value.activity.cloudWorkloadStarted !== false ||
      value.activity.modelOptimizationStarted !== false ||
      value.architecture.localWindowsGaussianTraining !== "not_enabled" ||
      value.architecture.gaussianTrainingLocation !== "reviewed_remote_gpu_worker_only" ||
      value.architecture.gpuWorkerImage !== "not_defined"
    ) {
      throw new Error("The worker environment plan crossed a disabled activity boundary.");
    }
    if (
      !Array.isArray(value.capabilityLanes) ||
      !Array.isArray(value.components) ||
      !Array.isArray(value.exclusions) ||
      value.summary.capabilityLaneCount !== 5 ||
      value.summary.componentCount !== 8 ||
      value.summary.openComponentClosureCount !== 8 ||
      value.summary.exclusionCount !== 6 ||
      value.summary.capabilityLaneCount !== value.capabilityLanes.length ||
      value.summary.componentCount !== value.components.length ||
      value.summary.openComponentClosureCount !== value.components.length ||
      value.summary.exclusionCount !== value.exclusions.length
    ) {
      throw new Error("The worker environment plan has inconsistent counts.");
    }
    const laneContract = {
      camera_registration: ["local_windows_candidate", "planned_closure_incomplete_execution_disabled"],
      e57_read_only_intake: ["local_windows_candidate", "planned_closure_incomplete_execution_disabled"],
      gaussian_training: ["reviewed_remote_gpu_worker_only", "execution_disabled_under_current_architecture"],
      geometry_registration_and_qa: ["local_windows_candidate", "planned_closure_incomplete_execution_disabled"],
      photometric_compensation: ["reviewed_remote_gpu_worker_only", "planned_closure_incomplete_execution_disabled"]
    };
    if (
      !hasUniqueSafeIds(value.capabilityLanes) ||
      !hasExactIdSet(value.capabilityLanes, Object.keys(laneContract))
    ) {
      throw new Error("The worker environment plan does not contain the exact five capability lanes.");
    }
    for (const lane of value.capabilityLanes) {
      const expectedLane = laneContract[lane.id];
      if (
        !hasExactObjectKeys(lane, [
          "id",
          "label",
          "runtimeProfile",
          "executionLocation",
          "state",
          "boundary"
        ]) ||
        !isNonemptyString(lane.label, 160) ||
        !isNonemptyString(lane.runtimeProfile, 240) ||
        !isNonemptyString(lane.boundary, 700) ||
        !expectedLane ||
        lane.executionLocation !== expectedLane[0] ||
        lane.state !== expectedLane[1]
      ) {
        throw new Error("The worker environment plan contains an invalid capability lane.");
      }
    }
    const exactComponentIds = [
      "pye57",
      "libe57format",
      "xerces-c",
      "open3d",
      "colmap",
      "hloc",
      "gsplat",
      "ppisp"
    ];
    if (
      !hasUniqueSafeIds(value.components) ||
      !hasExactIdSet(value.components, exactComponentIds)
    ) {
      throw new Error("The worker environment plan does not contain the exact root components.");
    }
    for (const component of value.components) {
      if (
        !hasExactObjectKeys(component, [
          "id",
          "label",
          "role",
          "exactVersion",
          "exactRevision",
          "sourceArtifactSha256",
          "licenseSpdx",
          "noticeClosureStatus",
          "closureStatus"
        ]) ||
        !isNonemptyString(component.label, 120) ||
        !isNonemptyString(component.role, 240) ||
        !isNonemptyString(component.exactVersion, 80) ||
        !/^[a-f0-9]{40}$/.test(component.exactRevision || "") ||
        !/^[a-f0-9]{64}$/.test(component.sourceArtifactSha256 || "") ||
        !isNonemptyString(component.licenseSpdx, 120) ||
        component.closureStatus !== "root_identity_pinned_dependency_closure_open" ||
        !["missing_from_selected_binary", "open_dependency_notice_review"].includes(component.noticeClosureStatus)
      ) {
        throw new Error("The worker environment plan contains an invalid root component.");
      }
    }
    const exactExclusionIds = [
      "pdal-deferred",
      "raw-xgrids-formats",
      "legacy-moving-main-spz",
      "legacy-moving-main-dn-splatter",
      "unlisted-models-and-datasets",
      "ai-captured-truth-substitution"
    ];
    if (
      !hasUniqueSafeIds(value.exclusions) ||
      !hasExactIdSet(value.exclusions, exactExclusionIds)
    ) {
      throw new Error("The worker environment plan does not contain the exact exclusions.");
    }
    for (const exclusion of value.exclusions) {
      if (
        !hasExactObjectKeys(exclusion, ["id", "label", "reason"]) ||
        !isNonemptyString(exclusion.label, 160) ||
        !isNonemptyString(exclusion.reason, 700)
      ) {
        throw new Error("The worker environment plan contains an invalid exclusion.");
      }
    }
    if (
      !hasExactObjectKeys(value.legacyWorkerImageRefusal, ["disposition", "reason"]) ||
      value.legacyWorkerImageRefusal.disposition !== "do_not_build_run_or_deploy" ||
      !isNonemptyString(value.legacyWorkerImageRefusal.reason, 700) ||
      !isNonemptyString(value.nextAction, 700)
    ) {
      throw new Error("The worker environment plan is missing its legacy refusal or next action.");
    }
    requireLocalE57IntakeEnvironmentReadiness(
      value.e57Environment,
      value.manifestSha256
    );
    return value;
  }

  function renderLocalE57IntakeEnvironmentReadiness(input) {
    const value = input;
    const followUp = value.followUp;
    setText(
      "local-e57-runtime",
      "CPython " + value.target.pythonVersion + " · aggregate E57 lane"
    );
    setText(
      "local-e57-artifact-count",
      value.summary.artifactCount.toLocaleString() + " recorded"
    );
    setText(
      "local-e57-member-count",
      followUp.candidateBundle.fileCount.toLocaleString() + " receipt-listed"
    );
    setText(
      "local-e57-open-count",
      followUp.remainingGates.length.toLocaleString() + " still open"
    );
    setText("local-e57-compatibility", "Candidate receipt reproduced byte-for-byte");
    setText(
      "local-e57-limitation",
      "The bundle and 30-item legal pack are assembled, but this is not a clean-host runtime qualification."
    );
    setText("local-e57-next-action", followUp.nextAction);
    setText("local-e57-sha", followUp.candidateBundle.bundleReceiptSha256);

    localE57Artifacts.replaceChildren();
    for (const artifact of value.artifacts) {
      const card = element("article", "local-e57-artifact");
      card.append(
        element("strong", "", artifact.packageName + " " + artifact.version),
        element("span", "", artifact.filename + " · " + artifact.byteSize.toLocaleString() + " bytes"),
        element("code", "", artifact.sha256)
      );
      localE57Artifacts.append(card);
    }

    localE57OpenItems.replaceChildren();
    for (const item of followUp.remainingGates) {
      const card = element("article", "local-e57-open-item");
      card.append(
        element("strong", "", item.label),
        element("p", "", item.reason),
        element("em", "", "Next test: " + item.decisiveNextTest)
      );
      localE57OpenItems.append(card);
    }
  }

  function renderLocalHdWorkerReadiness(input) {
    const value = requireLocalHdWorkerReadiness(input);
    setText("local-hd-worker-manifest-state", "Root identities recorded; closures open");
    setText("local-hd-worker-installation-state", "Not installed");
    setText("local-hd-worker-runtime-state", "Not tested");
    setText("local-hd-worker-execution-state", "Disabled");
    setText("local-hd-worker-lane-count", value.capabilityLanes.length.toLocaleString() + " plans");
    setText("local-hd-worker-component-count", value.components.length.toLocaleString() + " components");
    setText("local-hd-worker-exclusion-count", value.exclusions.length.toLocaleString() + " exclusions");
    setText("local-hd-worker-sha", value.manifestSha256);
    setText("local-hd-worker-next-action", value.nextAction);
    renderLocalE57IntakeEnvironmentReadiness(value.e57Environment);

    localHdWorkerLanes.replaceChildren();
    for (const lane of value.capabilityLanes) {
      const card = element("article", "local-hd-worker-lane");
      card.dataset.location = lane.executionLocation;
      const isHistoricalE57Parent = lane.id === "e57_read_only_intake";
      const location = isHistoricalE57Parent
        ? "Historical parent candidate — superseded for E57"
        : lane.executionLocation === "reviewed_remote_gpu_worker_only"
          ? "Separate reviewed GPU worker only"
          : "Local Windows candidate only";
      const state = isHistoricalE57Parent
        ? "Retained only for T-535 lineage"
        : lane.state === "execution_disabled_under_current_architecture"
          ? "Execution disabled under current architecture"
          : "Closure incomplete; execution disabled";
      const runtimeProfile = isHistoricalE57Parent
        ? lane.runtimeProfile + " — not the current E57 target"
        : lane.runtimeProfile;
      card.append(
        element("h5", "", lane.label),
        element("strong", "", location + " · " + state),
        element("p", "", runtimeProfile),
        element("p", "", lane.boundary)
      );
      localHdWorkerLanes.append(card);
    }

    localHdWorkerComponents.replaceChildren();
    for (const component of value.components) {
      const card = element("article", "local-hd-worker-component");
      card.append(
        element("h5", "", component.label + " " + component.exactVersion),
        element("p", "", component.role)
      );
      const facts = element("dl");
      const factRows = [
        ["Exact revision", component.exactRevision, true],
        ["Artifact SHA-256", component.sourceArtifactSha256, true],
        ["Root licence", component.licenseSpdx, false],
        ["Dependency closure", "Open — this root pin is not an installable worker", false],
        [
          "Notice closure",
          component.noticeClosureStatus === "missing_from_selected_binary"
            ? "Required legal files are missing from the selected binary"
            : "Dependency and notice review remains open",
          false
        ]
      ];
      for (const row of factRows) {
        const block = element("div");
        const valueNode = row[2]
          ? element("code", "", row[1])
          : element("span", "", row[1]);
        const definition = element("dd");
        definition.append(valueNode);
        block.append(element("dt", "", row[0]), definition);
        facts.append(block);
      }
      card.append(facts);
      localHdWorkerComponents.append(card);
    }

    localHdWorkerExclusions.replaceChildren();
    for (const exclusion of value.exclusions) {
      const block = element("div", "local-hd-worker-exclusion");
      block.append(
        element("strong", "", exclusion.label),
        element("p", "", exclusion.reason)
      );
      localHdWorkerExclusions.append(block);
    }

    localHdWorkerLegacy.replaceChildren();
    const legacyHeading = element("strong", "", "Do not build, run, or deploy the legacy worker image");
    const legacyPath = element("code", "", "infra/runpod/Dockerfile");
    const legacyCopy = element("p");
    legacyCopy.append(legacyPath, document.createTextNode(" — " + value.legacyWorkerImageRefusal.reason));
    localHdWorkerLegacy.append(legacyHeading, legacyCopy);
    localHdWorkerRendered = true;
  }

  function updateSaveStep() {
    if (
      planArtifact &&
      downloadedReceipt &&
      downloadedLatestReview &&
      downloadedLatestResult &&
      downloadedLatestPlan
    ) {
      setSteps("complete");
      statusCopy.textContent = "All four current JSON download requests were sent to your browser. Check your Downloads folder before closing. These drafts still authorize no processing, training, spending, or publishing.";
    }
  }

  function syncCompleteHandoffAvailability(state = null) {
    if (state !== null) {
      const guided = state.guidedWorkflow;
      if (guided && Number.isInteger(guided.completeHandoffMaximumFiles)) {
        completeHandoffMaximumFiles = guided.completeHandoffMaximumFiles;
      }
      if (guided && Number.isInteger(guided.completeHandoffMaximumSerializedBytes)) {
        completeHandoffMaximumSerializedBytes = guided.completeHandoffMaximumSerializedBytes;
      }
      completeHandoffStatus = guided && typeof guided.completeHandoff === "string"
        ? guided.completeHandoff
        : "not_ready";
      completeHandoffRevisionSha256 = guided && typeof guided.completeHandoffRevisionSha256 === "string"
        ? guided.completeHandoffRevisionSha256
        : null;
    }

    if (reviewDirty) {
      downloadHandoffButton.disabled = true;
      handoffDownloadHelp.textContent = "Your file choices changed. Build a new review draft first so the complete file cannot contain an older review.";
      return;
    }
    if (planDirty) {
      downloadHandoffButton.disabled = true;
      handoffDownloadHelp.textContent = "Your plan choices changed. Build a new plan preview first so the complete file cannot contain an older plan.";
      return;
    }
    if (completeHandoffStatus === "ready" && completeHandoffRevisionSha256 !== null) {
      downloadHandoffButton.disabled = false;
      downloadHandoffButton.textContent = requestedCompleteHandoffRevisionSha256 === completeHandoffRevisionSha256
        ? "Download this complete file again"
        : "Download one complete file";
      handoffDownloadHelp.textContent = requestedCompleteHandoffRevisionSha256 === completeHandoffRevisionSha256
        ? COMPLETE_HANDOFF_REQUESTED_MESSAGE
        : "Ready to prepare. When you click, the app builds the complete file, then reads the source again and confirms that every fingerprint still matches. The complete file must stay under " + formatBytes(completeHandoffMaximumSerializedBytes) + ".";
      return;
    }
    downloadHandoffButton.disabled = true;
    if (completeHandoffStatus === "preparing") {
      handoffDownloadHelp.textContent = "Preparing one complete file for the latest review, plan, and comparison you built.";
      return;
    }
    if (completeHandoffStatus === "source_too_large") {
      handoffDownloadHelp.textContent = "This source has more than " + completeHandoffMaximumFiles.toLocaleString() + " files, so one complete file is not available. Use the separate downloads shown below.";
      return;
    }
    if (completeHandoffStatus === "unavailable") {
      handoffDownloadHelp.textContent = "The complete file could not be prepared or the source could not be safely rechecked. This can happen when the file would exceed " + formatBytes(completeHandoffMaximumSerializedBytes) + ". Use the separate downloads, or start a new local session.";
      return;
    }
    handoffDownloadHelp.textContent = "The complete file will be prepared after the read-only source check finishes.";
  }

  function scheduleImmediateStateRefresh() {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(loadState, 0);
  }

  function renderReceipt(value, facts) {
    receipt = value;
    results.hidden = false;
    errorPanel.hidden = true;
    downloadButton.disabled = false;
    setText("metric-files", value.summary.fileCount.toLocaleString());
    setText("metric-size", formatBytes(value.summary.totalBytes));
    setText("receipt-sha", value.receiptSha256);
    renderFormats(value.files);
    renderQuarantine(value.files);
    renderDuplicates(value.duplicateGroups);
    renderFiles(value.files);
    if (facts) renderSourceFacts(facts);
    renderGuidedWorkflow(value);
  }

  function syncServerAdmissionBinding(state) {
    const serverDigest = state.guidedWorkflow && state.guidedWorkflow.admissionResultSha256;
    const localDigest = verificationAdmissionResultSha256 || (admissionArtifact && admissionArtifact.resultSha256);
    if (!localDigest || serverDigest === localDigest) return;
    clearVerificationPoll();
    verificationArtifact = null;
    verificationAdmissionResultSha256 = typeof serverDigest === "string" ? serverDigest : null;
    pendingVerificationStartRequestId = null;
    pendingVerificationResumeRequestId = null;
    admissionArtifact = null;
    planArtifact = null;
    admissionSuccess.hidden = true;
    planWorkbench.hidden = true;
    planResult.hidden = true;
    currentVerificationChecked = false;
    setAdmissionEditingLocked(false);
    verificationWorkbench.hidden = typeof serverDigest !== "string";
    verificationSavedDraftContext.hidden = typeof serverDigest !== "string";
    setText("verification-status-heading", "The review draft changed in another page");
    setText("verification-status-copy", "The earlier file-check result is hidden because it belongs to a different review draft. Check the current choices before starting again.");
    setText("verification-file-count", "0 of 0");
    setText("verification-byte-count", "0 B");
    byId("verification-meter-bar").style.transform = "scaleX(0)";
    byId("start-verification-button").hidden = typeof serverDigest !== "string";
    byId("start-verification-button").textContent = "Check approved files again";
    byId("cancel-verification-button").hidden = true;
    byId("resume-verification-button").hidden = true;
    byId("report-verification-button").hidden = true;
    showPanelError(verificationError, "Another page changed the review draft. The old verification result is no longer shown as current.");
  }

  function renderState(state) {
    sourceLabel.textContent = state.sourceLabel;
    sessionExpiresAtMs = Date.parse(state.expiresAt);
    sessionPhase = state.phase;
    updateSessionCountdown();
    if (!localHdWorkerRendered) renderLocalHdWorkerReadiness(state.localHdWorker);
    if (state.localIntakeWorkspace !== undefined) {
      const expectedLocalIntakeWorkspaceRequestId = pendingLocalIntakeWorkspaceDeletionId ||
        pendingLocalIntakeWorkspaceRequestId ||
        pendingLocalIntakeWorkspaceCancellationId ||
        (
          localIntakeWorkspaceArtifact &&
          typeof localIntakeWorkspaceArtifact.requestId === "string"
            ? localIntakeWorkspaceArtifact.requestId
            : null
        );
      renderLocalIntakeWorkspace(
        state.localIntakeWorkspace,
        false,
        expectedLocalIntakeWorkspaceRequestId
      );
    } else if (!localIntakeWorkspaceArtifact) {
      localIntakeWorkspacePanel.hidden = true;
    }
    if (state.preparedHdDataset !== undefined) {
      const expectedPreparedHdRequestId = pendingPreparedHdRequestId || (
        preparedHdArtifact && preparedHdArtifact.state === "running"
          ? preparedHdArtifact.requestId
          : null
      );
      renderPreparedHdDataset(
        state.preparedHdDataset,
        false,
        expectedPreparedHdRequestId
      );
    } else if (!preparedHdArtifact) {
      preparedHdPanel.hidden = true;
    }
    if (state.photoCaptureQuality !== undefined) {
      const expectedPhotoRequestId = pendingPhotoQualityRequestId || (
        photoQualityArtifact && photoQualityArtifact.state === "running"
          ? photoQualityArtifact.requestId
          : null
      );
      renderPhotoCaptureQuality(
        state.photoCaptureQuality,
        false,
        expectedPhotoRequestId
      );
    } else if (!photoQualityArtifact) {
      photoQualityPanel.hidden = true;
    }
    if (state.capturedQualityComparison !== undefined) {
      const expectedComparisonRequestId = pendingCapturedQualityRequestId || (
        capturedQualityArtifact && capturedQualityArtifact.state === "running"
          ? capturedQualityArtifact.requestId
          : null
      );
      renderCapturedQualityComparison(
        state.capturedQualityComparison,
        false,
        expectedComparisonRequestId
      );
    } else if (!capturedQualityArtifact) {
      capturedQualityPanel.hidden = true;
    }
    if (state.offlineNormalizationPreview !== undefined) {
      const expectedPreviewRequestId = pendingOfflinePreviewRequestId || (
        offlinePreviewArtifact && offlinePreviewArtifact.state === "running"
          ? offlinePreviewArtifact.requestId
          : null
      );
      renderOfflineNormalizationPreview(
        state.offlineNormalizationPreview,
        false,
        expectedPreviewRequestId
      );
    } else if (!offlinePreviewArtifact) {
      offlinePreviewPanel.hidden = true;
    }
    if (state.guidedWorkflow && Number.isInteger(state.guidedWorkflow.maximumFiles)) {
      maximumGuidedFiles = state.guidedWorkflow.maximumFiles;
    }
    syncCompleteHandoffAvailability(state);
    if (state.phase === "ready" && state.receipt) {
      statusHeading.textContent = "Receipt ready — no files are approved yet";
      statusCopy.textContent = "The read-only check finished. Download the receipt or review the plain-language findings below.";
      setSteps("ready");
      if (!receipt) renderReceipt(state.receipt, state.sourceFacts);
      else if (!sourceFacts && state.sourceFacts) renderSourceFacts(state.sourceFacts);
      if (!sourceReadiness && state.sourceReadiness) renderSourceReadiness(state.sourceReadiness);
      if (!operatorEvidenceChecklist && state.operatorEvidenceChecklist) {
        renderOperatorEvidenceChecklist(state.operatorEvidenceChecklist);
      }
      if (!pointValueDiagnostic && state.pointValueDiagnostic) {
        renderPointValueDiagnostic(state.pointValueDiagnostic);
      }
      if (state.roomEnvelopeReview !== undefined) {
        renderRoomEnvelopeReviewState(state.roomEnvelopeReview);
      }
      syncServerAdmissionBinding(state);
      void restoreCurrentVerification(state);
      return true;
    }
    if (state.phase === "failed") {
      statusHeading.textContent = "The local check stopped safely";
      statusCopy.textContent = "No receipt was issued and no source file was changed.";
      errorCopy.textContent = state.safeFailure || "Check that the source still exists and did not change, then start a new local session.";
      errorPanel.hidden = false;
      setSteps("failed");
      return true;
    }
    if (state.phase === "stopping") {
      statusHeading.textContent = "Stopping this local session";
      statusCopy.textContent = "The loopback server is closing.";
      stopButton.disabled = true;
      return true;
    }
    statusHeading.textContent = "Reading file names, sizes, and fingerprints";
    statusCopy.textContent = state.progress.message;
    setSteps("inspecting");
    return false;
  }

  function apiUrl(path) {
    return path + "?token=" + encodeURIComponent(token);
  }

  async function loadState() {
    try {
      const response = await fetch(apiUrl("/api/state"), { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(response.status === 401 ? "This local session link is missing or has expired." : "The local server did not answer safely.");
      const state = await response.json();
      const finished = renderState(state);
      if (!finished) {
        pollTimer = window.setTimeout(loadState, 450);
      } else if (state.phase === "ready") {
        // Keep the clock and expiry warning alive during a long human review.
        pollTimer = window.setTimeout(loadState, READY_SESSION_POLL_MS);
      }
    } catch (error) {
      clearLocalIntakeWorkspacePoll();
      clearPreparedHdPoll();
      clearPhotoQualityPoll();
      clearCapturedQualityPoll();
      clearOfflinePreviewPoll();
      statusHeading.textContent = "This local session is unavailable";
      statusCopy.textContent = reviewDirty
        ? "The session ended before your latest file choices were built. Start a new local session and review them again; no source file was changed."
        : planDirty
          ? "The session ended before your latest plan choices were built. Start a new local session and prepare the preview again; no reconstruction work ran."
          : localIntakeWorkspaceNeedsAttention()
            ? "The verified local-copy action may still be running because the local session cannot be reached. Check the local workspace before starting again; the original source was not changed."
            : preparedHdNeedsAttention()
              ? "The prepared-dataset check or its receipt may no longer be available because the local session cannot be reached. Start a new local session; the source package was not changed."
            : photoQualityNeedsAttention()
              ? "The photo capture check or its report may no longer be available because the local session cannot be reached. Start a new local session; your source files were not changed."
            : capturedQualityNeedsAttention()
              ? "The captured-quality comparison or its report may no longer be available because the local session cannot be reached. Start a new local session; your source files were not changed."
              : offlinePreviewNeedsAttention()
              ? "The private format preview may no longer be available because the local session cannot be reached. Start a new session; no production job ran."
                : error instanceof Error ? error.message : "Start a new local session from the terminal.";
      stopButton.disabled = true;
      downloadButton.disabled = true;
      completeHandoffStatus = "unavailable";
      completeHandoffRevisionSha256 = null;
      downloadHandoffButton.disabled = true;
      syncCompleteHandoffAvailability();
    }
  }

  admissionForm.addEventListener("input", markAdmissionStale);
  admissionForm.addEventListener("change", markAdmissionStale);
  admissionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = byId("build-admission-button");
    clearPanelError(guidedError);
    try {
      if (!receipt) throw new Error("Wait for the receipt before building a review draft.");
      const projectId = byId("project-id").value.trim();
      const reviewedBy = byId("operator-name").value.trim();
      if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(projectId)) {
        throw new Error("Project ID must start with a lower-case letter or number and use only lower-case letters, numbers, dots, dashes, or underscores.");
      }
      if (!reviewedBy) throw new Error("Enter the name of the person preparing this draft.");
      const decisions = collectDecisions();
      const submittedReviewRevision = reviewRevision;
      planRevision += 1;
      button.disabled = true;
      button.textContent = "Checking every file and fingerprint…";
      const result = await postJson("/api/admission-draft", {
        receiptSha256: receipt.receiptSha256,
        projectId,
        reviewedBy,
        sourceMedia: byId("source-media").value,
        caseSensitivity: byId("case-sensitivity").value,
        decisions
      });
      if (reviewRevision !== submittedReviewRevision) {
        throw new Error("The file choices changed while the draft was being checked. Build it again so the result matches what is on screen.");
      }
      renderAdmissionSuccess(result);
    } catch (error) {
      showPanelError(guidedError, error instanceof Error ? error.message : "The review draft could not be built. No source file was changed.");
    } finally {
      button.disabled = false;
      button.textContent = "Build review draft";
    }
  });

  byId("start-verification-button").addEventListener("click", async () => {
    const button = byId("start-verification-button");
    const previousJobId = verificationArtifact ? verificationArtifact.jobId : null;
    clearPanelError(verificationError);
    try {
      const admissionDigest = admissionArtifact && admissionArtifact.resultSha256
        ? admissionArtifact.resultSha256
        : verificationAdmissionResultSha256;
      if (!admissionDigest) throw new Error("Build the review draft before checking its approved files.");
      button.disabled = true;
      button.textContent = "Starting the local file check…";
      verificationAdmissionResultSha256 = admissionDigest;
      pendingVerificationStartRequestId = pendingVerificationStartRequestId || newVerificationRequestId();
      const value = await postJson("/api/reference-verification/start", {
        admissionResultSha256: verificationAdmissionResultSha256,
        requestId: pendingVerificationStartRequestId
      });
      renderVerification(value, true);
      pendingVerificationStartRequestId = null;
    } catch (error) {
      if (await recoverCurrentVerificationAfterLostResponse({ kind: "new_job", previousJobId })) {
        pendingVerificationStartRequestId = null;
      } else {
        showPanelError(verificationError, error instanceof Error ? error.message : "The approved-file check could not start safely.");
      }
      button.textContent = "Check approved files again";
    } finally {
      button.disabled = false;
    }
  });

  byId("cancel-verification-button").addEventListener("click", async () => {
    const button = byId("cancel-verification-button");
    clearPanelError(verificationError);
    try {
      button.disabled = true;
      button.textContent = "Stopping after the current read…";
      const value = await postJson("/api/reference-verification/cancel", verificationReference());
      renderVerification(value, true);
    } catch (error) {
      showPanelError(verificationError, error instanceof Error ? error.message : "The approved-file check could not be stopped safely.");
    } finally {
      button.disabled = false;
      button.textContent = "Stop for now";
    }
  });

  byId("resume-verification-button").addEventListener("click", async () => {
    const button = byId("resume-verification-button");
    const previousReference = verificationReference();
    clearPanelError(verificationError);
    try {
      if (!verificationAdmissionResultSha256) {
        throw new Error("Build a fresh review draft before restarting this check.");
      }
      button.disabled = true;
      button.textContent = "Restarting from the beginning…";
      pendingVerificationResumeRequestId = pendingVerificationResumeRequestId || newVerificationRequestId();
      const value = await postJson("/api/reference-verification/resume", Object.assign(
        verificationReference(),
        {
          admissionResultSha256: verificationAdmissionResultSha256,
          requestId: pendingVerificationResumeRequestId
        }
      ));
      renderVerification(value, true);
      pendingVerificationResumeRequestId = null;
    } catch (error) {
      if (await recoverCurrentVerificationAfterLostResponse({
        kind: "next_run",
        jobId: previousReference.jobId,
        run: previousReference.run
      })) {
        pendingVerificationResumeRequestId = null;
      } else {
        showPanelError(verificationError, error instanceof Error ? error.message : "The approved-file check could not restart safely.");
      }
    } finally {
      button.disabled = false;
      button.textContent = "Continue checking from the beginning";
    }
  });

  byId("report-verification-button").addEventListener("click", async () => {
    const button = byId("report-verification-button");
    clearPanelError(verificationError);
    try {
      button.disabled = true;
      button.textContent = "Confirming the saved result…";
      const value = await postJson("/api/reference-verification/report", verificationReference());
      renderVerification(value, true);
    } catch (error) {
      showPanelError(verificationError, error instanceof Error ? error.message : "The final report could not be confirmed safely.");
    } finally {
      button.disabled = false;
      button.textContent = "Confirm final report";
    }
  });

  function collectPhotoQualityAssignments() {
    if (!photoQualityArtifact || !Array.isArray(photoQualityArtifact.candidates)) {
      throw new Error("The photo candidate list is not ready.");
    }
    return photoQualityArtifact.candidates.map((candidate, index) => {
      const select = byId("photo-quality-role-" + index);
      if (!(select instanceof HTMLSelectElement) || !["build", "heldout", "ignore"].includes(select.value)) {
        throw new Error("Choose build, held-out, or ignore for every eligible photo.");
      }
      return { path: candidate.path, role: select.value };
    });
  }

  confirmDeleteLocalIntakeWorkspace.addEventListener("change", () => {
    const canDelete = Boolean(
      localIntakeWorkspaceArtifact &&
      localIntakeWorkspaceArtifact.workspace &&
      (
        localIntakeWorkspaceArtifact.state === "stored" ||
        (
          localIntakeWorkspaceArtifact.state === "failed" &&
          localIntakeWorkspaceArtifact.operation === "delete_local_workspace_copy"
        )
      )
    );
    byId("delete-local-intake-workspace-button").disabled =
      !canDelete || !confirmDeleteLocalIntakeWorkspace.checked;
  });

  byId("start-local-intake-workspace-button").addEventListener("click", async () => {
    const button = byId("start-local-intake-workspace-button");
    clearPanelError(localIntakeWorkspaceError);
    const requestId = pendingLocalIntakeWorkspaceRequestId || newVerificationRequestId();
    try {
      if (
        !localIntakeWorkspaceArtifact ||
        localIntakeWorkspaceArtifact.state !== "ready" ||
        !isCapturedQualityDigest(localIntakeWorkspaceArtifact.receiptSha256)
      ) {
        throw new Error("The receipt-bound local workspace is not ready for a verified copy.");
      }
      pendingLocalIntakeWorkspaceRequestId = requestId;
      button.disabled = true;
      button.textContent = "Starting verified copy…";
      const value = await postJson("/api/local-intake-workspace/start", {
        requestId,
        receiptSha256: localIntakeWorkspaceArtifact.receiptSha256,
        confirmation: "copy_into_local_workspace"
      });
      if (
        pendingLocalIntakeWorkspaceRequestId !== requestId &&
        (!localIntakeWorkspaceArtifact || localIntakeWorkspaceArtifact.requestId !== requestId)
      ) return;
      renderLocalIntakeWorkspace(value, true, requestId);
    } catch (error) {
      if (!(await recoverLocalIntakeWorkspaceAfterLostResponse(requestId))) {
        pendingLocalIntakeWorkspaceRequestId = null;
        showPanelError(
          localIntakeWorkspaceError,
          error instanceof Error ? error.message : "The verified local copy could not start."
        );
      }
    } finally {
      button.disabled = !localIntakeWorkspaceArtifact || localIntakeWorkspaceArtifact.state !== "ready";
      if (!button.hidden) button.textContent = localIntakeWorkspaceArtifact && localIntakeWorkspaceArtifact.state === "ready"
        ? "Keep verified copy"
        : "Local workspace unavailable";
    }
  });

  byId("cancel-local-intake-workspace-button").addEventListener("click", async () => {
    const button = byId("cancel-local-intake-workspace-button");
    let expectedRequestId = null;
    clearPanelError(localIntakeWorkspaceError);
    try {
      if (
        !localIntakeWorkspaceArtifact ||
        !["copying", "verifying"].includes(localIntakeWorkspaceArtifact.state) ||
        typeof localIntakeWorkspaceArtifact.requestId !== "string"
      ) {
        throw new Error("The verified local copy is not running.");
      }
      expectedRequestId = localIntakeWorkspaceArtifact.requestId;
      pendingLocalIntakeWorkspaceCancellationId = expectedRequestId;
      clearLocalIntakeWorkspacePoll();
      button.disabled = true;
      button.textContent = "Cancelling copy…";
      const value = await postJson("/api/local-intake-workspace/cancel", {
        requestId: expectedRequestId
      });
      if (!localIntakeWorkspaceArtifact || localIntakeWorkspaceArtifact.requestId !== expectedRequestId) return;
      renderLocalIntakeWorkspace(value, true, expectedRequestId);
    } catch (error) {
      const recovered = expectedRequestId !== null &&
        await recoverLocalIntakeWorkspaceAfterLostResponse(expectedRequestId);
      if (!recovered) {
        if (pendingLocalIntakeWorkspaceCancellationId === expectedRequestId) {
          pendingLocalIntakeWorkspaceCancellationId = null;
        }
        showPanelError(
          localIntakeWorkspaceError,
          error instanceof Error ? error.message : "The verified local copy could not be cancelled."
        );
        scheduleLocalIntakeWorkspacePoll();
      }
    } finally {
      button.disabled = false;
      button.textContent = "Cancel copying";
    }
  });

  byId("download-local-intake-workspace-report-button").addEventListener("click", async () => {
    const button = byId("download-local-intake-workspace-report-button");
    clearPanelError(localIntakeWorkspaceError);
    try {
      downloadedLocalIntakeWorkspaceReport = await downloadLocalIntakeWorkspaceReport(button);
      button.textContent = downloadedLocalIntakeWorkspaceReport
        ? "Download workspace record again"
        : "Download workspace record";
    } catch (error) {
      showPanelError(
        localIntakeWorkspaceError,
        error instanceof Error ? error.message : "The verified workspace record could not be downloaded."
      );
    }
  });

  byId("delete-local-intake-workspace-button").addEventListener("click", async () => {
    const button = byId("delete-local-intake-workspace-button");
    const requestId = newVerificationRequestId();
    clearPanelError(localIntakeWorkspaceError);
    try {
      if (
        !localIntakeWorkspaceArtifact ||
        !localIntakeWorkspaceArtifact.workspace ||
        !isCapturedQualityDigest(localIntakeWorkspaceArtifact.receiptSha256) ||
        !isCapturedQualityDigest(localIntakeWorkspaceArtifact.workspace.workspaceSha256) ||
        !confirmDeleteLocalIntakeWorkspace.checked ||
        !(
          localIntakeWorkspaceArtifact.state === "stored" ||
          (
            localIntakeWorkspaceArtifact.state === "failed" &&
            localIntakeWorkspaceArtifact.operation === "delete_local_workspace_copy"
          )
        )
      ) {
        throw new Error("Confirm deletion of the current verified local copy first.");
      }
      const receiptSha256 = localIntakeWorkspaceArtifact.receiptSha256;
      const workspaceDigest = localIntakeWorkspaceArtifact.workspace.workspaceSha256;
      pendingLocalIntakeWorkspaceDeletionId = requestId;
      clearLocalIntakeWorkspacePoll();
      button.disabled = true;
      button.textContent = "Deleting local copy…";
      const value = await postJson("/api/local-intake-workspace/delete-and-stop", {
        requestId,
        receiptSha256,
        workspaceSha256: workspaceDigest,
        confirmation: "delete_local_workspace_copy"
      });
      if (pendingLocalIntakeWorkspaceDeletionId !== requestId) return;
      renderLocalIntakeWorkspace(value, true, requestId);
    } catch (error) {
      if (!(await recoverLocalIntakeWorkspaceAfterLostResponse(requestId))) {
        if (pendingLocalIntakeWorkspaceDeletionId === requestId) {
          pendingLocalIntakeWorkspaceDeletionId = null;
        }
        showPanelError(
          localIntakeWorkspaceError,
          error instanceof Error ? error.message : "The local copy could not be deleted."
        );
      }
    } finally {
      const canDelete = Boolean(
        localIntakeWorkspaceArtifact &&
        localIntakeWorkspaceArtifact.workspace &&
        (
          localIntakeWorkspaceArtifact.state === "stored" ||
          (
            localIntakeWorkspaceArtifact.state === "failed" &&
            localIntakeWorkspaceArtifact.operation === "delete_local_workspace_copy"
          )
        )
      );
      button.disabled = !canDelete || !confirmDeleteLocalIntakeWorkspace.checked;
      button.textContent = "Delete local copy and stop";
    }
  });

  byId("start-prepared-hd-button").addEventListener("click", async () => {
    const button = byId("start-prepared-hd-button");
    clearPanelError(preparedHdError);
    const requestId = pendingPreparedHdRequestId || newPreparedHdRequestId();
    try {
      if (
        !preparedHdArtifact ||
        preparedHdArtifact.state !== "ready" ||
        !isCapturedQualityDigest(preparedHdArtifact.receiptSha256)
      ) {
        throw new Error("The receipt-bound prepared package is not ready for validation.");
      }
      pendingPreparedHdRequestId = requestId;
      button.disabled = true;
      button.textContent = "Starting prepared package check…";
      const value = await postJson("/api/prepared-hd-dataset/start", {
        requestId,
        receiptSha256: preparedHdArtifact.receiptSha256
      });
      if (
        pendingPreparedHdRequestId !== requestId &&
        (!preparedHdArtifact || preparedHdArtifact.requestId !== requestId)
      ) return;
      renderPreparedHdDataset(value, true, requestId);
    } catch (error) {
      if (!(await recoverPreparedHdAfterLostResponse(requestId))) {
        pendingPreparedHdRequestId = null;
        showPanelError(
          preparedHdError,
          error instanceof Error ? error.message : "The prepared package check could not start."
        );
      }
    } finally {
      button.disabled = !preparedHdArtifact || preparedHdArtifact.state !== "ready";
      if (!button.hidden) button.textContent = preparedHdArtifact && preparedHdArtifact.state === "failed"
        ? "Start a new local session to try again"
        : preparedHdArtifact && preparedHdArtifact.state === "unavailable"
          ? "Prepared package unavailable"
          : "Validate prepared package";
    }
  });

  byId("cancel-prepared-hd-button").addEventListener("click", async () => {
    const button = byId("cancel-prepared-hd-button");
    let expectedRequestId = null;
    clearPanelError(preparedHdError);
    try {
      if (
        !preparedHdArtifact ||
        preparedHdArtifact.state !== "running" ||
        typeof preparedHdArtifact.requestId !== "string"
      ) {
        throw new Error("The prepared package check is not running.");
      }
      expectedRequestId = preparedHdArtifact.requestId;
      pendingPreparedHdCancellationId = expectedRequestId;
      clearPreparedHdPoll();
      button.disabled = true;
      button.textContent = "Stopping and discarding…";
      const value = await postJson("/api/prepared-hd-dataset/cancel", {
        requestId: expectedRequestId
      });
      if (!preparedHdArtifact || preparedHdArtifact.requestId !== expectedRequestId) return;
      renderPreparedHdDataset(value, true, expectedRequestId);
    } catch (error) {
      const recovered = expectedRequestId !== null &&
        await recoverPreparedHdAfterLostResponse(expectedRequestId);
      if (!recovered) {
        if (pendingPreparedHdCancellationId === expectedRequestId) {
          pendingPreparedHdCancellationId = null;
        }
        showPanelError(
          preparedHdError,
          error instanceof Error ? error.message : "The prepared package check could not be stopped."
        );
        schedulePreparedHdPoll();
      }
    } finally {
      button.disabled = false;
      button.textContent = "Stop and discard";
    }
  });

  byId("download-prepared-hd-report-button").addEventListener("click", async () => {
    const button = byId("download-prepared-hd-report-button");
    clearPanelError(preparedHdError);
    try {
      downloadedPreparedHdReport = await downloadPreparedHdReport(button);
      button.textContent = downloadedPreparedHdReport
        ? "Download readiness receipt again"
        : "Download readiness receipt";
      updateSessionCountdown();
    } catch (error) {
      showPanelError(
        preparedHdError,
        error instanceof Error ? error.message : "The prepared-dataset receipt could not be downloaded."
      );
    }
  });

  byId("start-photo-quality-button").addEventListener("click", async () => {
    const button = byId("start-photo-quality-button");
    clearPanelError(photoQualityError);
    const requestId = pendingPhotoQualityRequestId || (
      photoQualityArtifact && photoQualityArtifact.requestId && photoQualityArtifact.state !== "cancelled"
        ? photoQualityArtifact.requestId
        : newPhotoQualityRequestId()
    );
    try {
      if (!photoQualityArtifact || !["ready", "cancelled"].includes(photoQualityArtifact.state) || !isCapturedQualityDigest(photoQualityArtifact.receiptSha256)) {
        throw new Error("The receipt-bound photo workbench is not ready.");
      }
      const assignments = collectPhotoQualityAssignments();
      pendingPhotoQualityRequestId = requestId;
      button.disabled = true;
      button.textContent = "Starting local photo check…";
      const value = await postJson("/api/photo-capture-quality/start", {
        requestId,
        receiptSha256: photoQualityArtifact.receiptSha256,
        assignments
      });
      if (pendingPhotoQualityRequestId !== requestId && (!photoQualityArtifact || photoQualityArtifact.requestId !== requestId)) return;
      renderPhotoCaptureQuality(value, true, requestId);
    } catch (error) {
      if (!(await recoverPhotoQualityAfterLostResponse(requestId))) {
        pendingPhotoQualityRequestId = null;
        showPanelError(photoQualityError, error instanceof Error ? error.message : "The photo-workbench check could not start.");
      }
    } finally {
      button.disabled = !photoQualityArtifact || !["ready", "cancelled"].includes(photoQualityArtifact.state);
      if (!button.hidden) button.textContent = photoQualityArtifact && photoQualityArtifact.state === "cancelled" ? "Check these photos again" : "Check these photos";
    }
  });

  byId("cancel-photo-quality-button").addEventListener("click", async () => {
    const button = byId("cancel-photo-quality-button");
    let expectedRequestId = null;
    clearPanelError(photoQualityError);
    try {
      if (!photoQualityArtifact || photoQualityArtifact.state !== "running" || typeof photoQualityArtifact.requestId !== "string") {
        throw new Error("The photo-workbench check is not running.");
      }
      expectedRequestId = photoQualityArtifact.requestId;
      pendingPhotoQualityCancellationId = expectedRequestId;
      clearPhotoQualityPoll();
      button.disabled = true;
      button.textContent = "Stopping and discarding…";
      const value = await postJson("/api/photo-capture-quality/cancel", { requestId: expectedRequestId });
      if (!photoQualityArtifact || photoQualityArtifact.requestId !== expectedRequestId) return;
      renderPhotoCaptureQuality(value, true, expectedRequestId);
    } catch (error) {
      const recovered = expectedRequestId !== null && await recoverPhotoQualityAfterLostResponse(expectedRequestId);
      if (!recovered) {
        if (pendingPhotoQualityCancellationId === expectedRequestId) pendingPhotoQualityCancellationId = null;
        showPanelError(photoQualityError, error instanceof Error ? error.message : "The photo-workbench check could not be stopped.");
        schedulePhotoQualityPoll();
      }
    } finally {
      button.disabled = false;
      button.textContent = "Stop and discard";
    }
  });

  byId("download-photo-quality-report-button").addEventListener("click", async () => {
    const button = byId("download-photo-quality-report-button");
    clearPanelError(photoQualityError);
    try {
      downloadedPhotoQualityReport = await downloadPhotoQualityReport(button);
      button.textContent = downloadedPhotoQualityReport ? "Download photo report again" : "Download photo report";
      updateSessionCountdown();
    } catch (error) {
      showPanelError(photoQualityError, error instanceof Error ? error.message : "The photo-workbench report could not be downloaded.");
    }
  });

  byId("start-captured-quality-button").addEventListener("click", async () => {
    const button = byId("start-captured-quality-button");
    clearPanelError(capturedQualityError);
    const requestId = pendingCapturedQualityRequestId || newCapturedQualityRequestId();
    try {
      if (!capturedQualityArtifact || capturedQualityArtifact.state !== "ready") {
        throw new Error("The exact local captured-quality comparison is not ready.");
      }
      pendingCapturedQualityRequestId = requestId;
      button.disabled = true;
      button.textContent = "Starting local comparison…";
      const value = await postJson("/api/captured-quality-comparison/start", { requestId });
      if (
        pendingCapturedQualityRequestId !== requestId &&
        (!capturedQualityArtifact || capturedQualityArtifact.requestId !== requestId)
      ) return;
      renderCapturedQualityComparison(value, true, requestId);
    } catch (error) {
      if (!(await recoverCapturedQualityAfterLostResponse(requestId))) {
        showPanelError(
          capturedQualityError,
          error instanceof Error ? error.message : "The captured-quality comparison could not start."
        );
      }
    } finally {
      button.disabled = !capturedQualityArtifact || capturedQualityArtifact.state !== "ready";
      if (!button.hidden) button.textContent = capturedQualityArtifact && capturedQualityArtifact.state === "failed"
        ? "Start a new local session to try again"
        : "Run local comparison";
    }
  });

  byId("cancel-captured-quality-button").addEventListener("click", async () => {
    const button = byId("cancel-captured-quality-button");
    let expectedRequestId = null;
    clearPanelError(capturedQualityError);
    try {
      if (
        !capturedQualityArtifact ||
        capturedQualityArtifact.state !== "running" ||
        typeof capturedQualityArtifact.requestId !== "string"
      ) {
        throw new Error("The captured-quality comparison is not running.");
      }
      expectedRequestId = capturedQualityArtifact.requestId;
      pendingCapturedQualityCancellationId = expectedRequestId;
      clearCapturedQualityPoll();
      button.disabled = true;
      button.textContent = "Stopping and discarding…";
      const value = await postJson("/api/captured-quality-comparison/cancel", { requestId: expectedRequestId });
      if (!capturedQualityArtifact || capturedQualityArtifact.requestId !== expectedRequestId) return;
      renderCapturedQualityComparison(value, true, expectedRequestId);
    } catch (error) {
      const recovered = expectedRequestId !== null &&
        await recoverCapturedQualityAfterLostResponse(expectedRequestId);
      if (!recovered) {
        if (pendingCapturedQualityCancellationId === expectedRequestId) {
          pendingCapturedQualityCancellationId = null;
        }
        showPanelError(
          capturedQualityError,
          error instanceof Error ? error.message : "The captured-quality comparison could not be stopped."
        );
        scheduleCapturedQualityPoll();
      }
    } finally {
      button.disabled = false;
      button.textContent = "Stop and discard";
    }
  });

  byId("download-captured-quality-report-button").addEventListener("click", async () => {
    const button = byId("download-captured-quality-report-button");
    clearPanelError(capturedQualityError);
    try {
      downloadedCapturedQualityReport = await downloadCapturedQualityReport(button);
      button.textContent = downloadedCapturedQualityReport
        ? "Download comparison report again"
        : "Download comparison report";
      updateSessionCountdown();
    } catch (error) {
      showPanelError(
        capturedQualityError,
        error instanceof Error ? error.message : "The captured-quality report could not be downloaded."
      );
    }
  });

  byId("start-offline-preview-button").addEventListener("click", async () => {
    const button = byId("start-offline-preview-button");
    clearPanelError(offlinePreviewError);
    try {
      if (!receipt) throw new Error("Wait for the intake receipt before starting the private format preview.");
      if (
        !offlinePreviewArtifact ||
         offlinePreviewArtifact.previewAssetId === null ||
         offlinePreviewArtifact.source === null ||
         offlinePreviewArtifact.state !== "ready"
       ) {
         throw new Error("The private format preview is not ready for its one permitted attempt.");
      }
      const requestId = pendingOfflinePreviewRequestId || newOfflinePreviewRequestId();
      pendingOfflinePreviewRequestId = requestId;
      button.disabled = true;
      button.textContent = "Requesting the private preview…";
      const value = await postJson("/api/offline-normalization-preview/start", {
        receiptSha256: receipt.receiptSha256,
        previewAssetId: offlinePreviewArtifact.previewAssetId,
        requestId
      });
      if (
        pendingOfflinePreviewRequestId !== requestId &&
        (!offlinePreviewArtifact || offlinePreviewArtifact.requestId !== requestId)
      ) return;
      renderOfflineNormalizationPreview(value, true, requestId);
    } catch (error) {
      if (
        pendingOfflinePreviewRequestId !== null ||
        !offlinePreviewArtifact ||
        offlinePreviewArtifact.state !== "running"
      ) {
        showPanelError(
          offlinePreviewError,
          error instanceof Error ? error.message : "The private format preview could not start safely."
        );
      }
    } finally {
      button.disabled = offlinePreviewArtifact === null ||
        offlinePreviewArtifact.state !== "ready";
      if (!button.hidden) {
        button.textContent = offlinePreviewArtifact && offlinePreviewArtifact.state === "failed"
          ? "Start a new local session to try again"
          : offlinePreviewArtifact && offlinePreviewArtifact.state === "blocked"
            ? "Preview unavailable"
            : "Request preview";
      }
    }
  });

  byId("cancel-offline-preview-button").addEventListener("click", async () => {
    const button = byId("cancel-offline-preview-button");
    clearPanelError(offlinePreviewError);
    try {
      if (
        !offlinePreviewArtifact ||
        offlinePreviewArtifact.state !== "running" ||
        typeof offlinePreviewArtifact.requestId !== "string"
      ) {
        throw new Error("The private format preview is not running.");
      }
      const expectedRequestId = offlinePreviewArtifact.requestId;
      button.disabled = true;
      button.textContent = "Stopping and discarding…";
      const value = await postJson("/api/offline-normalization-preview/cancel", {
        requestId: expectedRequestId
      });
      if (
        !offlinePreviewArtifact ||
        offlinePreviewArtifact.requestId !== expectedRequestId
      ) return;
      renderOfflineNormalizationPreview(value, true, expectedRequestId, true);
    } catch (error) {
      showPanelError(
        offlinePreviewError,
        error instanceof Error ? error.message : "The private format preview could not be stopped safely."
      );
    } finally {
      button.disabled = false;
      button.textContent = "Stop and discard";
    }
  });

  byId("download-offline-preview-output-button").addEventListener("click", async () => {
    const button = byId("download-offline-preview-output-button");
    try {
      if (!offlinePreviewArtifact || offlinePreviewArtifact.output === null) {
        throw new Error("A verified private GLB is not available.");
      }
      downloadedOfflinePreviewOutput = await downloadOfflinePreviewArtifact(
        "/api/offline-normalization-preview/output",
        "foundry-private-offline-glb-format-preview.glb",
        offlinePreviewArtifact.output.sha256,
        button
      );
      button.textContent = downloadedOfflinePreviewOutput ? "Download private GLB again" : "Download private GLB";
      updateSessionCountdown();
    } catch (error) {
      showPanelError(
        offlinePreviewError,
        error instanceof Error ? error.message : "The private GLB could not be downloaded."
      );
    }
  });

  byId("download-offline-preview-report-button").addEventListener("click", async () => {
    const button = byId("download-offline-preview-report-button");
    try {
      if (!offlinePreviewArtifact || offlinePreviewArtifact.output === null) {
        throw new Error("A verified private preview report is not available.");
      }
      downloadedOfflinePreviewReport = await downloadOfflinePreviewArtifact(
        "/api/offline-normalization-preview/report",
        "foundry-private-offline-glb-format-preview-report.json",
        offlinePreviewArtifact.output.reportSha256,
        button
      );
      button.textContent = downloadedOfflinePreviewReport ? "Download verification report again" : "Download verification report";
      updateSessionCountdown();
    } catch (error) {
      showPanelError(
        offlinePreviewError,
        error instanceof Error ? error.message : "The private preview report could not be downloaded."
      );
    }
  });

  byId("hd-appearance").addEventListener("change", markPlanStale);
  for (const id of ["build-mesh", "semantic-inference", "neural-representation"]) {
    byId(id).addEventListener("change", markPlanStale);
  }

  byId("build-plan-button").addEventListener("click", async () => {
    const button = byId("build-plan-button");
    clearPanelError(planError);
    try {
      if (!admissionArtifact) throw new Error("Build the review draft before comparing plans.");
      const hdAppearance = byId("hd-appearance").value;
      const buildNeuralRepresentation = byId("neural-representation").checked;
      if (buildNeuralRepresentation && hdAppearance !== "rights_gated_training") {
        throw new Error("A trainable neural scene requires the explicit rights-gated training choice. Nothing was changed.");
      }
      const submittedPlanRevision = planRevision;
      button.disabled = true;
      button.textContent = "Checking routes, rights, capacity, and cost evidence…";
      const result = await postJson("/api/plan-preview", {
        hdAppearance,
        includeSemanticInference: byId("semantic-inference").checked,
        buildOperationalMesh: byId("build-mesh").checked,
        buildNeuralRepresentation,
        admissionResultSha256: admissionArtifact.resultSha256
      });
      if (planRevision !== submittedPlanRevision) {
        throw new Error("The plan choices changed while the preview was being checked. Build it again so the result matches what is on screen.");
      }
      renderPlanPreview(result);
    } catch (error) {
      showPanelError(planError, error instanceof Error ? error.message : "The plan preview could not be built. Nothing ran and no provider was contacted.");
    } finally {
      button.disabled = false;
      button.textContent = "Build plan preview";
    }
  });

  downloadHandoffButton.addEventListener("click", async () => {
    if (
      !receipt ||
      reviewDirty ||
      planDirty ||
      completeHandoffStatus !== "ready" ||
      completeHandoffRevisionSha256 === null
    ) {
      syncCompleteHandoffAvailability();
      return;
    }
    const requestedRevisionSha256 = completeHandoffRevisionSha256;
    const requestedReviewRevision = reviewRevision;
    const requestedPlanRevision = planRevision;
    try {
      downloadHandoffButton.textContent = "Building and rechecking…";
      handoffDownloadHelp.textContent = "Please wait. Large local folders can take several seconds. Nothing is uploaded or changed.";
      await downloadJson(
        "/api/local-inspection-handoff-package",
        "foundry-local-inspection-handoff-package-v0.json",
        downloadHandoffButton,
        requestedRevisionSha256,
        () =>
          !reviewDirty &&
          !planDirty &&
          reviewRevision === requestedReviewRevision &&
          planRevision === requestedPlanRevision &&
          completeHandoffRevisionSha256 === requestedRevisionSha256
      );
      requestedCompleteHandoffRevisionSha256 = requestedRevisionSha256;
      syncCompleteHandoffAvailability();
    } catch (error) {
      completeHandoffStatus = "preparing";
      completeHandoffRevisionSha256 = null;
      syncCompleteHandoffAvailability();
      scheduleImmediateStateRefresh();
      handoffDownloadHelp.textContent = error instanceof Error
        ? error.message
        : "The complete handoff could not be downloaded. No source file was changed.";
    }
  });

  byId("download-receipt-secondary").addEventListener("click", async () => {
    const button = byId("download-receipt-secondary");
    try {
      downloadedReceipt = await downloadJson(
        "/api/receipt",
        "foundry-universal-intake-receipt-v0.json",
        button,
      );
      updateSaveStep();
    } catch (error) {
      showPanelError(guidedError, error instanceof Error ? error.message : "The receipt could not be downloaded. No source file was changed.");
    }
  });

  for (const control of document.querySelectorAll('input[name="point-value-plane"], input[name="point-value-mode"]')) {
    control.addEventListener("change", () => {
      renderPointValueCurrentBundle();
      renderRoomEnvelopeDraft();
    });
  }
  pointValueBundleSelect.addEventListener("change", () => {
    renderPointValueCurrentBundle();
    renderRoomEnvelopeDraft();
  });
  function updatePointValueZoom() {
    const zoom = Number(pointValueZoom.value);
    pointValueImageStage.style.width = (Number.isFinite(zoom) ? zoom * 100 : 100) + "%";
    pointValueZoomOutput.value = (Number.isFinite(zoom) ? zoom : 1).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "×";
  }
  pointValueZoom.addEventListener("input", updatePointValueZoom);
  updatePointValueZoom();
  byId("point-value-zoom-reset").addEventListener("click", () => {
    pointValueZoom.value = "1";
    pointValueZoom.dispatchEvent(new Event("input"));
    if (typeof pointValueImageViewport.scrollTo === "function") {
      pointValueImageViewport.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  });
  pointValueImage.addEventListener("error", () => {
    pointValueCaption.textContent = "The selected digest-bound PNG could not be loaded from this local session. Refresh the page and try the current artifact again.";
  });

  roomEnvelopeOverlay.addEventListener("click", (event) => {
    if (!roomEnvelopeDrawingIsAvailable() || event.button !== 0) return;
    const bounds = roomEnvelopeOverlay.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = Math.max(0, Math.min(1023, Math.floor((event.clientX - bounds.left) * 1024 / bounds.width)));
    const y = Math.max(0, Math.min(1023, Math.floor((event.clientY - bounds.top) * 1024 / bounds.height)));
    addRoomEnvelopeVertex(x, y);
  });

  byId("room-envelope-mark-preview").addEventListener("click", () => {
    if (!pointValueCurrentImage || !roomEnvelopeReviewIsAvailable()) {
      roomEnvelopeShowError("Wait for one exact digest-bound V8 preview before marking it reviewed.");
      return;
    }
    const current = pointValueCurrentImage;
    roomEnvelopeReviewedPreviews.set(current.image.viewId, {
      bundleSha256: current.bundle.bundleSha256,
      viewId: current.image.viewId,
      mode: current.image.mode,
      sha256: current.image.sha256,
      pixelSha256: current.image.pixelSha256
    });
    roomEnvelopeClearError();
    roomEnvelopeReviewStatus.textContent = (pointValueViewLabels[current.image.viewId] || sourceFactLabel(current.image.viewId)) + " marked against exact PNG " + current.image.sha256 + ".";
    renderRoomEnvelopeDraft();
  });

  roomEnvelopeHorizontalView.addEventListener("change", () => {
    const changedOutline = roomEnvelopeVertices.length > 0;
    roomEnvelopeVertices = [];
    const radio = document.querySelector('input[name="point-value-plane"][value="' + roomEnvelopeHorizontalView.value + '"]');
    if (radio) radio.checked = true;
    roomEnvelopeClearError();
    renderPointValueCurrentBundle();
    if (changedOutline) {
      roomEnvelopeReviewStatus.textContent = "The proposed horizontal projection changed, so the earlier projection-specific outline was cleared.";
    }
    renderRoomEnvelopeDraft();
  });

  byId("room-envelope-add-vertex").addEventListener("click", () => {
    const xInput = byId("room-envelope-x");
    const yInput = byId("room-envelope-y");
    if (xInput.value.trim() === "" || yInput.value.trim() === "") {
      roomEnvelopeShowError("Enter both X and Y before adding a keyboard-accessible vertex.");
      return;
    }
    addRoomEnvelopeVertex(Number(xInput.value), Number(yInput.value));
  });

  byId("room-envelope-undo").addEventListener("click", () => {
    roomEnvelopeVertices.pop();
    roomEnvelopeClearError();
    renderRoomEnvelopeDraft();
  });

  byId("room-envelope-clear").addEventListener("click", () => {
    roomEnvelopeVertices = [];
    roomEnvelopeClearError();
    renderRoomEnvelopeDraft();
  });

  for (const control of roomEnvelopeReviewForm.querySelectorAll("input, select, textarea")) {
    control.addEventListener("input", renderRoomEnvelopeDraft);
    control.addEventListener("change", renderRoomEnvelopeDraft);
  }

  roomEnvelopeReviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    roomEnvelopeClearError();
    try {
      if (!roomEnvelopeReviewForm.reportValidity()) return;
      if (!receipt || !pointValueDiagnostic || !pointValueCurrentImage) {
        throw new Error("Wait for the current receipt, V8 facts, and exact preview before storing this review.");
      }
      const bundleSha256 = pointValueCurrentImage.bundle.bundleSha256;
      if (bundleSha256 !== roomEnvelopeActiveBundleSha256) {
        throw new Error("The selected exact bundle changed. Review its three previews again.");
      }
      const reviewedPreviews = roomEnvelopeViewOrder.map((viewId) => roomEnvelopeReviewedPreviews.get(viewId));
      if (reviewedPreviews.some((preview) => !preview || preview.bundleSha256 !== bundleSha256)) {
        throw new Error("Mark one exact current preview for each of the three component projections.");
      }
      const issue = roomEnvelopePolygonIssue();
      if (issue) throw new Error(issue);
      roomEnvelopeSubmitting = true;
      renderRoomEnvelopeDraft();
      roomEnvelopeReviewStatus.textContent = "Rechecking exact source members and counting records inside the intrinsic-pixel outline…";
      const value = await postJson("/api/room-envelope-review", {
        receiptSha256: receipt.receiptSha256,
        sourceFactsSha256: pointValueDiagnostic.sourceFacts.factsSha256,
        bundleSha256,
        horizontalViewId: roomEnvelopeHorizontalView.value,
        reviewedPreviews: reviewedPreviews.map((preview) => ({
          viewId: preview.viewId,
          mode: preview.mode,
          sha256: preview.sha256,
          pixelSha256: preview.pixelSha256
        })),
        polygonIntrinsicPixels: roomEnvelopeVertices.map((point) => [point[0], point[1]]),
        roomLabel: byId("room-envelope-room-label").value.trim(),
        reviewerLabel: byId("room-envelope-reviewer").value.trim(),
        decision: byId("room-envelope-decision").value,
        note: byId("room-envelope-note").value.trim()
      });
      renderRoomEnvelopeReviewState(value);
    } catch (error) {
      roomEnvelopeShowError(
        error instanceof Error ? error.message : "The room-envelope review could not be stored. No source file was changed.",
        true
      );
    } finally {
      roomEnvelopeSubmitting = false;
      renderRoomEnvelopeDraft();
    }
  });

  byId("download-room-envelope-report").addEventListener("click", async () => {
    const button = byId("download-room-envelope-report");
    const report = roomEnvelopeReviewArtifact && roomEnvelopeReviewArtifact.state === "completed"
      ? roomEnvelopeReviewArtifact.report
      : null;
    if (!report || typeof report.reportSha256 !== "string") {
      roomEnvelopeShowError("A completed room-envelope review is not available for download.");
      return;
    }
    try {
      await downloadJson(
        "/api/room-envelope-review-report",
        "foundry-room-envelope-review-v0.json",
        button,
        report.reportSha256
      );
      roomEnvelopeReviewStatus.textContent = "Canonical authority-none review JSON received for fingerprint " + report.reportSha256 + ".";
    } catch (error) {
      roomEnvelopeShowError(error instanceof Error ? error.message : "The room-envelope review could not be downloaded.", true);
    }
  });

  byId("download-point-value-image-button").addEventListener("click", async () => {
    const button = byId("download-point-value-image-button");
    if (!pointValueCurrentImage) {
      pointValueDownloadStatus.textContent = "No current diagnostic PNG is available.";
      return;
    }
    const current = pointValueCurrentImage;
    button.disabled = true;
    pointValueDownloadStatus.textContent = "Requesting the exact current diagnostic PNG…";
    try {
      const response = await fetch(
        pointValuePreviewUrl("/api/potree-point-preview-download", current.bundle, current.image),
        { cache: "no-store", credentials: "same-origin" }
      );
      if (!response.ok) throw new Error(await errorMessage(response, "The diagnostic PNG could not be downloaded."));
      if (
        !pointValueCurrentImage ||
        pointValueCurrentImage.image.sha256 !== current.image.sha256 ||
        pointValueCurrentImage.bundle.bundleSha256 !== current.bundle.bundleSha256
      ) {
        throw new Error("The selected diagnostic changed during download. Request the current image again.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = current.image.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      pointValueDownloadStatus.textContent = "Exact PNG received for fingerprint " + current.image.sha256 + ".";
    } catch (error) {
      pointValueDownloadStatus.textContent = error instanceof Error
        ? error.message
        : "The diagnostic PNG could not be downloaded.";
    } finally {
      button.disabled = false;
    }
  });

  byId("download-source-facts-v8-button").addEventListener("click", async () => {
    const button = byId("download-source-facts-v8-button");
    try {
      await downloadJson(
        "/api/source-facts-v8",
        "foundry-universal-source-facts-v8.json",
        button,
        pointValueDiagnostic && pointValueDiagnostic.sourceFacts.factsSha256
      );
      pointValueDownloadStatus.textContent = "Exact V8 source facts received.";
    } catch (error) {
      pointValueDownloadStatus.textContent = error instanceof Error ? error.message : "The V8 source facts could not be downloaded.";
    }
  });

  byId("download-source-readiness-v8-button").addEventListener("click", async () => {
    const button = byId("download-source-readiness-v8-button");
    try {
      await downloadJson(
        "/api/source-readiness-v8",
        "foundry-source-readiness-map-v8.json",
        button,
        pointValueDiagnostic && pointValueDiagnostic.sourceReadiness.readinessSha256
      );
      pointValueDownloadStatus.textContent = "Exact V8 readiness map received.";
    } catch (error) {
      pointValueDownloadStatus.textContent = error instanceof Error ? error.message : "The V8 readiness map could not be downloaded.";
    }
  });

  byId("download-operator-evidence-v8-button").addEventListener("click", async () => {
    const button = byId("download-operator-evidence-v8-button");
    try {
      await downloadJson(
        "/api/operator-evidence-checklist-v8",
        "foundry-operator-evidence-checklist-v8.json",
        button,
        pointValueDiagnostic && pointValueDiagnostic.operatorEvidenceChecklist.checklistSha256
      );
      pointValueDownloadStatus.textContent = "Exact V8 checklist received.";
    } catch (error) {
      pointValueDownloadStatus.textContent = error instanceof Error ? error.message : "The V8 checklist could not be downloaded.";
    }
  });

  byId("download-source-facts-button").addEventListener("click", async () => {
    const button = byId("download-source-facts-button");
    sourceFactsDownloadStatus.textContent = "Requesting the exact current source facts…";
    try {
      await downloadJson(
        "/api/source-facts",
        "foundry-universal-source-facts-v7.json",
        button,
        sourceFacts && sourceFacts.factsSha256
      );
      sourceFactsDownloadStatus.textContent = "Exact source-facts response received for fingerprint " + sourceFacts.factsSha256 + ".";
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "The Source Facts artifact could not be downloaded. No source file was changed.";
      sourceFactsDownloadStatus.textContent = message;
      statusCopy.textContent = message;
    }
  });

  byId("download-source-readiness-button").addEventListener("click", async () => {
    const button = byId("download-source-readiness-button");
    sourceReadinessDownloadStatus.textContent = "Requesting the exact current readiness map…";
    try {
      await downloadJson(
        "/api/source-readiness",
        "foundry-source-readiness-map-v7.json",
        button,
        sourceReadiness && sourceReadiness.readinessSha256
      );
      sourceReadinessDownloadStatus.textContent = "Exact readiness-map response received for fingerprint " + sourceReadiness.readinessSha256 + ".";
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "The Source Readiness Map could not be downloaded. No source file was changed.";
      sourceReadinessDownloadStatus.textContent = message;
      statusCopy.textContent = message;
    }
  });

  byId("download-operator-evidence-button").addEventListener("click", async () => {
    const button = byId("download-operator-evidence-button");
    operatorEvidenceDownloadStatus.textContent = "Requesting the exact current checklist…";
    try {
      await downloadJson(
        "/api/operator-evidence-checklist",
        "foundry-operator-evidence-checklist-v7.json",
        button,
        operatorEvidenceChecklist && operatorEvidenceChecklist.checklistSha256
      );
      operatorEvidenceDownloadStatus.textContent = "Exact checklist response received for fingerprint " + operatorEvidenceChecklist.checklistSha256 + ".";
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "The Operator Evidence Checklist could not be downloaded. No source file was changed.";
      operatorEvidenceDownloadStatus.textContent = message;
      statusCopy.textContent = message;
    }
  });

  byId("download-review-button").addEventListener("click", async () => {
    const button = byId("download-review-button");
    try {
      downloadedLatestReview = await downloadJson("/api/admission-review", "foundry-admission-review-draft.json", button, admissionArtifact.reviewSha256);
      updateSaveStep();
    } catch (error) {
      showPanelError(guidedError, error instanceof Error ? error.message : "The review draft could not be downloaded.");
    }
  });

  byId("download-result-button").addEventListener("click", async () => {
    const button = byId("download-result-button");
    try {
      downloadedLatestResult = await downloadJson("/api/admission-result", "foundry-admission-result-draft.json", button, admissionArtifact.resultSha256);
      updateSaveStep();
    } catch (error) {
      showPanelError(guidedError, error instanceof Error ? error.message : "The result draft could not be downloaded.");
    }
  });

  byId("download-plan-button").addEventListener("click", async () => {
    const button = byId("download-plan-button");
    try {
      downloadedLatestPlan = await downloadJson("/api/plan-dossier", "foundry-plan-preview.json", button, planArtifact.previewSha256);
      updateSaveStep();
    } catch (error) {
      showPanelError(planError, error instanceof Error ? error.message : "The plan preview could not be downloaded.");
    }
  });

  downloadButton.addEventListener("click", async () => {
    if (!receipt) return;
    downloadButton.disabled = true;
    try {
      const response = await fetch(apiUrl("/api/receipt"), { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("Receipt download failed.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "foundry-universal-intake-receipt-v0.json";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      downloadedReceipt = true;
      updateSaveStep();
    } catch (_error) {
      statusCopy.textContent = "The receipt could not be downloaded. The source files were not changed.";
    } finally {
      downloadButton.disabled = false;
    }
  });

  stopButton.addEventListener("click", async () => {
    const unsavedDraft = admissionArtifact && (!downloadedLatestReview || !downloadedLatestResult);
    const unsavedPlan = planArtifact && !downloadedLatestPlan;
    const verificationStillRunning = verificationArtifact && verificationArtifact.phase === "checking";
    const localWorkspaceNeedsAttention = localIntakeWorkspaceNeedsAttention();
    const preparedDatasetNeedsAttention = preparedHdNeedsAttention();
    const photoQualityNeedsReview = photoQualityNeedsAttention();
    const capturedComparisonNeedsAttention = capturedQualityNeedsAttention();
    const privatePreviewNeedsAttention = offlinePreviewNeedsAttention();
    if ((reviewDirty || planDirty || unsavedDraft || unsavedPlan || verificationStillRunning || preparedDatasetNeedsAttention || photoQualityNeedsReview || capturedComparisonNeedsAttention || privatePreviewNeedsAttention || localWorkspaceNeedsAttention) && !window.confirm("Stop this local session now? Any running file check, verified local copy, prepared-dataset check, photo capture check, captured-quality comparison, and private format preview will be stopped first. Review edits and undownloaded reports may be lost. Your original source files will not be changed.")) {
      return;
    }
    stopButton.disabled = true;
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    clearLocalIntakeWorkspacePoll();
    clearPreparedHdPoll();
    clearPhotoQualityPoll();
    clearCapturedQualityPoll();
    clearOfflinePreviewPoll();
    try {
      const response = await fetch(apiUrl("/api/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("The local server did not accept the stop request.");
      const stopResult = await response.json();
      if (
        !stopResult ||
        stopResult.stopping !== true ||
        stopResult.verificationStopped !== true ||
        stopResult.preparedHdDatasetStopped !== true ||
        stopResult.photoCaptureQualityStopped !== true ||
        stopResult.capturedQualityComparisonStopped !== true ||
        stopResult.offlinePreviewStopped !== true ||
        stopResult.localIntakeWorkspaceStopped !== true
      ) {
        throw new Error("The local server did not confirm that all local work stopped safely.");
      }
      reviewDirty = false;
      planDirty = false;
      admissionArtifact = null;
      planArtifact = null;
      clearVerificationPoll();
      pendingVerificationStartRequestId = null;
      pendingVerificationResumeRequestId = null;
      clearLocalIntakeWorkspaceClientState();
      clearPreparedHdClientState();
      clearPhotoQualityClientState();
      clearCapturedQualityClientState();
      clearOfflinePreviewClientState();
      statusHeading.textContent = "Stopping the local session safely";
      statusCopy.textContent = "The local work has stopped. The local server is closing; you can close this tab.";
      window.sessionStorage.removeItem(sessionKey);
    } catch (_error) {
      statusHeading.textContent = "Could not confirm that the local session stopped";
      statusCopy.textContent = "Go back to the terminal that started this app and press Ctrl+C now. The server may still be running.";
      stopButton.disabled = false;
      scheduleLocalIntakeWorkspacePoll();
      schedulePreparedHdPoll();
      schedulePhotoQualityPoll();
      scheduleCapturedQualityPoll();
      scheduleOfflinePreviewPoll();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    const unsavedDraft = admissionArtifact && (!downloadedLatestReview || !downloadedLatestResult);
    const unsavedPlan = planArtifact && !downloadedLatestPlan;
    const verificationStillRunning = verificationArtifact && verificationArtifact.phase === "checking";
    const localWorkspaceNeedsAttention = localIntakeWorkspaceNeedsAttention();
    const preparedDatasetNeedsAttention = preparedHdNeedsAttention();
    const photoQualityNeedsReview = photoQualityNeedsAttention();
    const capturedComparisonNeedsAttention = capturedQualityNeedsAttention();
    const privatePreviewNeedsAttention = offlinePreviewNeedsAttention();
    if (!reviewDirty && !planDirty && !unsavedDraft && !unsavedPlan && !verificationStillRunning && !preparedDatasetNeedsAttention && !photoQualityNeedsReview && !capturedComparisonNeedsAttention && !privatePreviewNeedsAttention && !localWorkspaceNeedsAttention) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (!token) {
    statusHeading.textContent = "This local session link is incomplete";
    statusCopy.textContent = "Start the local app from the terminal and open the exact link it prints.";
    stopButton.disabled = true;
  } else {
    void loadState();
  }
})();`;
