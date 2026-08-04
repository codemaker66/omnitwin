export const LOCAL_FOUNDRY_APP_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reconstruction Foundry · Local intake check</title>
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
            <button id="download-button" class="button button-primary" type="button" disabled>Download receipt</button>
            <button id="stop-button" class="button button-quiet" type="button">Stop local session</button>
          </div>
        </div>

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
                <p class="section-label">Universal Source Facts V5</p>
                <h3 id="source-facts-heading">What these exact bytes declare</h3>
              </div>
              <span class="authority-badge">Read only · authority none</span>
            </div>
            <p class="source-facts-intro">Established facts come only from the fingerprinted E57, binary GLB, OBJ, SPZ, stored-ZIP SOG v2, classic Gaussian PLY, JPEG, PNG, ISO Base Media, CSV, and JSON bytes shown below. Image or video container structure does not prove decoded content or capture role. Calibration or trajectory document structure does not prove field semantics, clock or units, frames, transform conventions, calibration validity, provenance, registration, accuracy, ownership, or permission to process. Coverage applies only to the selected receipt root and file set.</p>
            <dl id="source-facts-summary" class="source-facts-summary"></dl>
            <div id="source-facts-blocker" class="plain-warning" hidden></div>
            <div id="source-facts-list" class="source-facts-list"></div>
            <footer class="source-facts-footer">
              <div><span>Source facts fingerprint</span><code id="source-facts-sha">Not ready</code></div>
              <p id="source-facts-download-status" class="operator-evidence-download-status" role="status" aria-live="polite" aria-atomic="true"></p>
              <button id="download-source-facts-button" class="button button-quiet" type="button">Download source facts</button>
            </footer>
          </section>

          <section id="source-readiness" class="result-section source-readiness" aria-labelledby="source-readiness-heading" hidden>
            <div class="section-row source-readiness-head">
              <div>
                <p class="section-label">Source Readiness Map V5</p>
                <h3 id="source-readiness-heading">What this source set covers—and what is still missing</h3>
              </div>
              <span class="authority-badge">Pre-admission map · authority none</span>
            </div>
            <p class="source-readiness-intro">This reports receipt-stage candidates and byte-fact coverage only. It does not approve files, compile a route or recipe, select a worker or provider, establish rights, accuracy, or registration, or say anything can run.</p>
            <dl id="source-readiness-summary" class="source-readiness-summary"></dl>
            <div id="source-readiness-blocker" class="plain-warning source-readiness-blocker" role="alert" aria-live="assertive" aria-atomic="true" hidden></div>
            <div id="source-readiness-lanes" class="source-readiness-lanes"></div>
            <footer id="source-readiness-footer" class="source-readiness-footer">
              <div><span>Map fingerprint</span><code id="source-readiness-sha">Not established</code></div>
              <p id="source-readiness-download-status" class="operator-evidence-download-status" role="status" aria-live="polite" aria-atomic="true"></p>
              <button id="download-source-readiness-button" class="button button-quiet" type="button">Download readiness map</button>
            </footer>
          </section>

          <section id="operator-evidence-checklist" class="result-section operator-evidence-checklist" aria-labelledby="operator-evidence-checklist-heading" hidden>
            <div class="section-row operator-evidence-head">
              <div>
                <p class="section-label">Operator Evidence Checklist V5</p>
                <h3 id="operator-evidence-checklist-heading">What to collect or verify next</h3>
              </div>
              <span class="authority-badge">Pre-admission requests · authority none</span>
            </div>
            <p class="operator-evidence-intro">This checklist turns the exact current Source Readiness gaps into evidence requests. Its ordering describes evidence dependencies only. It does not decide which requests your intended output needs, collect evidence, mark anything complete, approve a file, establish rights, accuracy, or registration, compile a route or recipe, select a worker or provider, or authorize work.</p>
            <dl id="operator-evidence-summary" class="operator-evidence-summary"></dl>
            <div id="operator-evidence-blocker" class="plain-warning operator-evidence-blocker" role="status" aria-live="polite" aria-atomic="true" hidden></div>
            <div id="operator-evidence-groups" class="operator-evidence-groups"></div>
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
.button { border-radius: 9px; cursor: pointer; font-size: .76rem; font-weight: 900; min-height: 44px; padding: 0 14px; transition: transform 150ms ease, opacity 150ms ease; }
.button:active { transform: scale(.975); }
.button:disabled { cursor: not-allowed; opacity: .46; }
.button-primary { background: #153d3c; border: 1px solid #153d3c; color: var(--paper-bright); }
.button-quiet { background: transparent; border: 1px solid #aab8b4; color: #344c4a; }
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
  .offline-preview-boundaries { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .source-facts-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .source-readiness-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .operator-evidence-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
  .offline-preview-boundaries, .offline-preview-result-facts { grid-template-columns: 1fr; }
  .offline-preview-head { align-items: flex-start; flex-direction: column; }
  .source-facts-summary, .source-fact-columns { grid-template-columns: 1fr; }
  .source-fact-card-head, .source-facts-footer, .source-readiness-footer, .operator-evidence-footer { align-items: flex-start; flex-direction: column; }
  .source-readiness-summary, .readiness-counts { grid-template-columns: 1fr; }
  .source-readiness-head, .readiness-lane-head { align-items: flex-start; flex-direction: column; }
  .operator-evidence-summary { grid-template-columns: 1fr; }
  .operator-evidence-head, .operator-evidence-group-head, .operator-evidence-item-head { align-items: flex-start; flex-direction: column; }
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
  const stopButton = byId("stop-button");
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
  const sourceFactsDownloadStatus = byId("source-facts-download-status");
  const sourceReadinessPanel = byId("source-readiness");
  const sourceReadinessSummary = byId("source-readiness-summary");
  const sourceReadinessBlocker = byId("source-readiness-blocker");
  const sourceReadinessLanes = byId("source-readiness-lanes");
  const sourceReadinessFooter = byId("source-readiness-footer");
  const sourceReadinessDownloadStatus = byId("source-readiness-download-status");
  const operatorEvidencePanel = byId("operator-evidence-checklist");
  const operatorEvidenceSummary = byId("operator-evidence-summary");
  const operatorEvidenceBlocker = byId("operator-evidence-blocker");
  const operatorEvidenceGroups = byId("operator-evidence-groups");
  const operatorEvidenceFooter = byId("operator-evidence-footer");
  const operatorEvidenceDownloadStatus = byId("operator-evidence-download-status");
  const offlinePreviewPanel = byId("offline-normalization-preview");
  const offlinePreviewStatus = byId("offline-preview-status");
  const offlinePreviewError = byId("offline-preview-error");
  const offlinePreviewResultFacts = byId("offline-preview-result-facts");
  let receipt = null;
  let sourceFacts = null;
  let sourceReadiness = null;
  let operatorEvidenceChecklist = null;
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
  let offlinePreviewArtifact = null;
  let offlinePreviewPollTimer = null;
  let pendingOfflinePreviewRequestId = null;
  let downloadedOfflinePreviewOutput = false;
  let downloadedOfflinePreviewReport = false;
  let reviewDirty = false;
  let planDirty = false;
  let reviewRevision = 0;
  let planRevision = 0;
  let sessionExpiresAtMs = null;
  let sessionPhase = "inspecting";
  let downloadedReceipt = false;
  let downloadedLatestReview = false;
  let downloadedLatestResult = false;
  let downloadedLatestPlan = false;
  const READY_SESSION_POLL_MS = 15_000;
  const VERIFICATION_POLL_MS = 650;
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

  async function downloadJson(path, filename, button, digest = null) {
    button.disabled = true;
    try {
      const url = digest === null
        ? apiUrl(path)
        : path + "?token=" + encodeURIComponent(token) + "&digest=" + encodeURIComponent(digest);
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorMessage(response, "The draft could not be downloaded."));
      const blob = await response.blob();
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

  function renderSourceFacts(value) {
    sourceFacts = value;
    sourceFactsDownloadStatus.textContent = "";
    sourceFactsPanel.hidden = false;
    sourceFactsSummary.replaceChildren();
    sourceFactsList.replaceChildren();
    sourceFactsBlocker.replaceChildren();
    sourceFactsBlocker.hidden = true;
    setText("source-facts-sha", value.factsSha256);

    const unresolvedFactCount = value.state === "available"
      ? value.assets.reduce((total, asset) => total + (asset.unknowns || []).length, 0)
      : 0;
    const summaryItems = [
      ["Files in receipt", value.summary.receiptFileCount],
      ["Target sources", value.summary.assetCount],
      ["Facts established", value.summary.establishedCount],
      ["Unresolved facts", unresolvedFactCount],
      ["Sources not established or untargeted", value.summary.factsNotEstablishedCount + value.summary.untargetedFileCount]
    ];
    for (const item of summaryItems) {
      const block = element("div");
      block.append(element("dt", "", item[0]), element("dd", "", Number(item[1]).toLocaleString()));
      sourceFactsSummary.append(block);
    }

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
              : "Facts established")
          : (isMediaContainer
            ? "Container facts not established"
            : isRegistrationDocument
              ? "Document structure not established"
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
        : "Established from these exact bytes";
      established.append(element("h5", "", establishedHeading));
      if (asset.facts) {
        const gaussianProperties = asset.format === "gaussian_ply" && asset.facts.gaussians && Array.isArray(asset.facts.gaussians.properties)
          ? asset.facts.gaussians.properties
          : [];
        let displayedFacts = asset.facts;
        if (gaussianProperties.length > 0) {
          const gaussianSummary = {};
          for (const [key, item] of Object.entries(asset.facts.gaussians)) {
            if (key !== "properties") gaussianSummary[key] = item;
          }
          displayedFacts = Object.assign({}, asset.facts, { gaussians: gaussianSummary });
        }
        const facts = element("dl");
        appendSourceFactRows(facts, displayedFacts, []);
        established.append(facts);
        appendGaussianPlyProperties(established, gaussianProperties);
      } else {
        established.append(element("p", "source-fact-identity", sourceFactLabel(asset.inspection.code)));
      }
      const unknown = element("section", "source-fact-column");
      unknown.append(element("h5", "", isMediaContainer
        ? "Still unknown beyond the container"
        : isRegistrationDocument
          ? "Still unknown beyond document structure"
          : "Still unknown"));
      const unknownList = element("ul");
      for (const item of asset.unknowns || []) appendSourceUnknown(unknownList, item);
      if (unknownList.childElementCount === 0) unknownList.append(element("li", "", "No additional V5 unknown code was emitted."));
      unknown.append(unknownList);
      columns.append(established, unknown);
      card.append(columns);
      sourceFactsList.append(card);
    }
  }

  function sourceReadinessStatusLabel(status) {
    const labels = {
      all_observed_facts_established: "All observed Source Facts V5 established",
      evidence_incomplete: "Evidence incomplete",
      no_source_observed: "No source observed",
      blocked: "Evaluation withheld",
      facts_established: "Source Facts V5 established",
      facts_not_established: "Evidence incomplete",
      outside_source_facts_v5: "Outside Source Facts V5",
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

    const summary = value.summary || {};
    const groupedGapCount = Number.isFinite(summary.gapCount)
      ? summary.gapCount
      : Array.isArray(value.gaps) ? value.gaps.length : 0;
    const summaryItems = [
      ["Files in receipt", summary.receiptFileCount === undefined ? (value.files || []).length : summary.receiptFileCount],
      ["Sources represented", summary.representedFileCount === undefined ? 0 : summary.representedFileCount],
      ["Grouped gaps", groupedGapCount]
    ];
    for (const item of summaryItems) {
      const block = element("div");
      block.append(element("dt", "", item[0]), element("dd", "", Number(item[1]).toLocaleString()));
      sourceReadinessSummary.append(block);
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

    const summary = value.summary || {};
    const affectedSourceCount = summary.affectedSourceCount === undefined ? 0 : summary.affectedSourceCount;
    const distinctContentCount = summary.distinctContentCount === undefined ? 0 : summary.distinctContentCount;
    const summaryItems = [
      ["Evidence requests", summary.evidenceRequestCount === undefined ? (value.items || []).length : summary.evidenceRequestCount],
      ["Source paths / distinct contents", Number(affectedSourceCount).toLocaleString() + " / " + Number(distinctContentCount).toLocaleString()],
      ["Existing-source foundations", summary.highCount === undefined ? 0 : summary.highCount],
      ["Conditional opportunities", summary.conditionalCount === undefined ? 0 : summary.conditionalCount]
    ];
    for (const summaryItem of summaryItems) {
      const block = element("div");
      const displayValue = typeof summaryItem[1] === "number" ? Number(summaryItem[1]).toLocaleString() : String(summaryItem[1]);
      block.append(element("dt", "", summaryItem[0]), element("dd", "", displayValue));
      operatorEvidenceSummary.append(block);
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
      clearOfflinePreviewPoll();
      statusHeading.textContent = "This local session is unavailable";
      statusCopy.textContent = reviewDirty
        ? "The session ended before your latest file choices were built. Start a new local session and review them again; no source file was changed."
        : planDirty
          ? "The session ended before your latest plan choices were built. Start a new local session and prepare the preview again; no reconstruction work ran."
          : offlinePreviewNeedsAttention()
            ? "The private format preview may no longer be available because the local session cannot be reached. Start a new session; no production job ran."
          : error instanceof Error ? error.message : "Start a new local session from the terminal.";
      stopButton.disabled = true;
      downloadButton.disabled = true;
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

  byId("download-source-facts-button").addEventListener("click", async () => {
    const button = byId("download-source-facts-button");
    sourceFactsDownloadStatus.textContent = "Requesting the exact current source facts…";
    try {
      await downloadJson(
        "/api/source-facts",
        "foundry-universal-source-facts-v5.json",
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
        "foundry-source-readiness-map-v5.json",
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
        "foundry-operator-evidence-checklist-v5.json",
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
    const privatePreviewNeedsAttention = offlinePreviewNeedsAttention();
    if ((reviewDirty || planDirty || unsavedDraft || unsavedPlan || verificationStillRunning || privatePreviewNeedsAttention) && !window.confirm("Stop this local session now? Any running file check and private format preview will be stopped first. Review edits may be lost, and the app will clear its preview buffer on a best-effort basis. This is not secure erasure; private operating-system or verification records may remain on this computer. Your source files will not be changed.")) {
      return;
    }
    stopButton.disabled = true;
    if (pollTimer !== null) window.clearTimeout(pollTimer);
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
        stopResult.offlinePreviewStopped !== true
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
      clearOfflinePreviewClientState();
      statusHeading.textContent = "Stopping the local session safely";
      statusCopy.textContent = "The local work has stopped and the app cleared any preview buffer on a best-effort basis. This is not a secure-erasure claim. The local server is closing; you can close this tab.";
      window.sessionStorage.removeItem(sessionKey);
    } catch (_error) {
      statusHeading.textContent = "Could not confirm that the local session stopped";
      statusCopy.textContent = "Go back to the terminal that started this app and press Ctrl+C now. The server may still be running.";
      stopButton.disabled = false;
      scheduleOfflinePreviewPoll();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    const unsavedDraft = admissionArtifact && (!downloadedLatestReview || !downloadedLatestResult);
    const unsavedPlan = planArtifact && !downloadedLatestPlan;
    const verificationStillRunning = verificationArtifact && verificationArtifact.phase === "checking";
    const privatePreviewNeedsAttention = offlinePreviewNeedsAttention();
    if (!reviewDirty && !planDirty && !unsavedDraft && !unsavedPlan && !verificationStillRunning && !privatePreviewNeedsAttention) return;
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
