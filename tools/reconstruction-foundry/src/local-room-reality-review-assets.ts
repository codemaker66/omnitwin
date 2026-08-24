import { LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT } from "./local-e57-visual-review-assets.js";

export const LOCAL_ROOM_REALITY_REVIEW_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reconstruction Foundry · Room candidate review</title>
    <link rel="stylesheet" href="/room-review.css">
    <script src="/room-review.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#visual-review-workbench">Skip to the review workspace</a>
    <main class="shell">
      <header class="masthead">
        <a class="brand" href="/" aria-label="Back to Reconstruction Foundry intake">
          <span class="brand-mark" aria-hidden="true">RF</span>
          <span>Reconstruction Foundry</span>
        </a>
        <span class="trust-line"><span aria-hidden="true"></span>Loopback only · local JSON inspection</span>
      </header>

      <section class="intro">
        <p class="eyebrow">Room Reality Package · local candidate</p>
        <h1>Review what is known. Record what must change.</h1>
        <p>This screen has two bounded paths: inspect a generated authority-none E57 crop JSON in this browser, or review candidate metadata through the loopback dossier API. A crop stays in browser memory unless you explicitly ask the local 127.0.0.1 process to compile a classification mask; that request is never sent externally or persisted. This page never opens raw E57 or source images, changes artifact geometry, grants authority, exports a package, or runs Foundry.</p>
      </section>

      <section class="boundary" aria-labelledby="boundary-heading">
        <div>
          <p class="eyebrow">Hard boundary</p>
          <h2 id="boundary-heading">A review draft is not an approval</h2>
        </div>
        <dl>
          <div><dt>Authority</dt><dd>None</dd></div>
          <div><dt>Raw/source media read</dt><dd>Not performed</dd></div>
          <div><dt>Corrections applied</dt><dd>Preview only · never persisted</dd></div>
          <div><dt>Package export</dt><dd>Not authorized</dd></div>
          <div><dt>Runtime activation</dt><dd>Not authorized</dd></div>
          <div><dt>Generated crop transfer</dt><dd>Browser memory by default · explicit mask action sends only to this 127.0.0.1 process</dd></div>
        </dl>
      </section>

      <section id="visual-review-workbench" class="workbench visual-workbench" aria-labelledby="visual-load-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Bounded visual inspection</p>
            <h2 id="visual-load-heading">Open a generated E57 point crop</h2>
            <p>Choose or drop one <code>FoundryE57GeometryCropV0</code> JSON artifact. The browser checks its strict shape, self-digests, authority-none policy, point counts, bounds, source binding, frame, and units before drawing. It remains in browser memory unless you explicitly create a mask, which sends the crop only to this local 127.0.0.1 process for shared deterministic compilation.</p>
          </div>
          <span class="badge">Browser memory by default</span>
        </div>

        <div class="visual-file-grid">
          <label id="primary-crop-drop" class="drop-control">Primary generated crop
            <input id="primary-crop-file" type="file" accept="application/json,.json">
            <strong>Choose JSON or drop exactly one file</strong>
            <small>Maximum 12 MiB and 50,000 accepted points. Raw E57, GLB, images, and other JSON contracts fail closed.</small>
          </label>
          <label id="comparison-crop-drop" class="drop-control">Optional comparison crop
            <input id="comparison-crop-file" type="file" accept="application/json,.json">
            <strong>Choose a second generated crop</strong>
            <small>Overlay is allowed only for a distinct artifact bound to the same exact source bytes, source facts, frame, axes, and units.</small>
          </label>
        </div>
        <div class="actions visual-load-actions">
          <button id="clear-primary-crop" class="button button-secondary" type="button">Clear visual inspection</button>
          <button id="clear-comparison-crop" class="button button-secondary" type="button">Clear comparison</button>
        </div>
        <div id="visual-load-error" class="error" role="alert" tabindex="-1" hidden></div>
        <p id="visual-load-status" class="visual-status" role="status" aria-live="polite">No generated crop is open.</p>

        <section id="point-visual-surface" class="point-visual-surface" aria-labelledby="point-visual-heading" hidden>
          <div class="section-heading compact">
            <div>
              <p class="eyebrow">Local projection</p>
              <h3 id="point-visual-heading">Inspect points and declared crop bounds</h3>
              <p>This is an orthographic visual aid, not a survey tool. Orbit, zoom, overlay, and correction controls change only this preview. They do not alter the artifact or create a TransformArtifact, Scene Authority Map, QA result, mask, or approved crop.</p>
            </div>
            <span class="badge badge-warning">Authority none</span>
          </div>
          <dl id="visual-artifact-facts" class="facts visual-facts"></dl>

          <div class="canvas-shell">
            <canvas id="point-crop-canvas" tabindex="0" role="img" aria-label="Interactive orthographic projection of the validated authority-none E57 crop points and bounds"></canvas>
            <div class="canvas-legend" aria-hidden="true">
              <span><i class="legend-primary"></i>Primary</span>
              <span id="comparison-legend" hidden><i class="legend-comparison"></i>Comparison</span>
              <span><i class="legend-crop"></i>Declared crop</span>
              <span><i class="legend-annotation"></i>Preview annotation</span>
            </div>
          </div>
          <div class="viewer-controls" aria-label="Point preview controls">
            <button id="visual-reset-view" class="button button-secondary" type="button">Reset view</button>
            <button id="visual-zoom-in" class="button button-secondary" type="button" aria-label="Zoom point preview in">Zoom in</button>
            <button id="visual-zoom-out" class="button button-secondary" type="button" aria-label="Zoom point preview out">Zoom out</button>
            <span id="visual-camera-readout" class="camera-readout"></span>
          </div>
          <div id="comparison-controls" class="comparison-controls" hidden>
            <label class="check-control"><input id="comparison-visible" type="checkbox" checked> Show compatible comparison overlay</label>
            <label>Comparison opacity
              <input id="comparison-opacity" type="range" min="0" max="1" step="0.05" value="0.55">
              <small>At least 5% opacity and one accepted comparison point are required before source comparison can be assessed.</small>
            </label>
          </div>

          <section id="classification-mask-panel" class="mask-panel" aria-labelledby="classification-mask-heading">
            <div class="section-heading compact">
              <div>
                <p class="eyebrow">Optional authority-none classification</p>
                <h3 id="classification-mask-heading">Build a movable or privacy exclusion mask</h3>
                <p>Rules bind the original generated crop coordinates in the raw <code>e57_root</code> frame, in metres. Preview translation, rotation, scale, camera, and annotation bounds are deliberately ignored. Clicking “Compile mask locally” sends the already-open generated crop and these rules only to this page’s token-bound 127.0.0.1 Node process. Nothing is uploaded externally or persisted by the server.</p>
              </div>
              <span class="badge badge-warning">Not reviewed · authority none</span>
            </div>

            <div class="mask-rule-builder">
              <div class="mask-rule-fields">
                <label>Rule ID
                  <input id="mask-rule-id" type="text" minlength="1" maxlength="120" pattern="[a-z0-9][a-z0-9._-]*" placeholder="movable-stage-001">
                  <small>Lowercase letters, numbers, dots, underscores, and hyphens only.</small>
                </label>
                <label>Classification
                  <select id="mask-rule-classification">
                    <option value="captured_movable_visual_excluded">Movable captured content</option>
                    <option value="privacy_excluded">Privacy exclusion</option>
                  </select>
                </label>
                <label>Selection method
                  <select id="mask-selection-kind">
                    <option value="inclusive_bounds_e57_root_m">Raw E57-root AABB</option>
                    <option value="exact_point_references">Exact retained-point references</option>
                  </select>
                </label>
              </div>

              <fieldset id="mask-bounds-fields">
                <legend>Inclusive raw E57-root bounds (metres)</legend>
                <div class="numeric-grid bounds-grid">
                  <label>Min X<input id="mask-min-x" type="number" step="0.001"></label>
                  <label>Min Y<input id="mask-min-y" type="number" step="0.001"></label>
                  <label>Min Z<input id="mask-min-z" type="number" step="0.001"></label>
                  <label>Max X<input id="mask-max-x" type="number" step="0.001"></label>
                  <label>Max Y<input id="mask-max-y" type="number" step="0.001"></label>
                  <label>Max Z<input id="mask-max-z" type="number" step="0.001"></label>
                </div>
              </fieldset>

              <label id="mask-exact-fields" hidden>Exact retained-point references
                <textarea id="mask-exact-references" rows="5" maxlength="2000000" spellcheck="false" placeholder="0:12&#10;0:13"></textarea>
                <small>One <code>scanIndex:sourcePointIndex</code> pair per line. The local shared compiler derives and verifies full exact selectors.</small>
              </label>

              <label>Rule rationale
                <textarea id="mask-rule-rationale" rows="3" minlength="20" maxlength="1000" placeholder="Explain why these exact retained points are movable content or privacy-sensitive."></textarea>
              </label>
              <div class="actions">
                <button id="add-mask-rule" class="button button-secondary" type="button">Add raw-frame rule</button>
              </div>
              <div id="mask-rule-error" class="error" role="alert" tabindex="-1" hidden></div>
              <ol id="mask-rule-list" class="mask-rule-list"></ol>
            </div>

            <div class="mask-authorship-fields">
              <label>Operator reference
                <input id="mask-operator-id" type="text" minlength="2" maxlength="160" placeholder="local-operator-001">
              </label>
              <label>Operator display name
                <input id="mask-operator-name" type="text" minlength="2" maxlength="160" autocomplete="name">
              </label>
              <label class="mask-purpose-note">Purpose note
                <textarea id="mask-purpose-note" rows="3" minlength="20" maxlength="1000" placeholder="Describe why this authority-none exclusion draft is being prepared."></textarea>
              </label>
            </div>
            <div class="actions">
              <button id="compile-classification-mask" class="button button-primary" type="button" disabled>Compile mask locally</button>
            </div>
            <div id="mask-compile-error" class="error" role="alert" tabindex="-1" hidden></div>
            <p id="mask-compile-status" class="visual-status" role="status" aria-live="polite">Open a non-empty generated crop and add at least one rule.</p>

            <section id="classification-mask-result" class="draft-result" aria-labelledby="classification-mask-result-heading" hidden>
              <div>
                <p class="eyebrow">Local classification draft only</p>
                <h4 id="classification-mask-result-heading">Every retained crop point was partitioned exactly once</h4>
                <p>Matched counts below come from the shared compiler result. They are not human review, Scene Authority, geometry authority, QA approval, package export, or runtime activation.</p>
              </div>
              <dl class="draft-facts mask-result-facts">
                <div><dt>Mask fingerprint</dt><dd><code id="classification-mask-sha"></code></dd></div>
                <div><dt>Movable excluded</dt><dd id="mask-movable-count">0</dd></div>
                <div><dt>Privacy excluded</dt><dd id="mask-privacy-count">0</dd></div>
                <div><dt>Unclassified static candidates</dt><dd id="mask-static-count">0</dd></div>
                <div><dt>Review status</dt><dd>Not reviewed</dd></div>
                <div><dt>Authority</dt><dd>None</dd></div>
              </dl>
              <ol id="mask-rule-counts" class="mask-rule-counts"></ol>
              <div class="actions">
                <button id="download-classification-mask" class="button button-secondary" type="button">Download authority-none mask JSON</button>
              </div>
              <p class="download-warning">The download contains the self-digested classification draft and retained point identities. Your Downloads location may be cloud-synced.</p>
            </section>
          </section>

          <form id="visual-observation-form" class="visual-observation-form">
            <div class="section-heading compact">
              <div>
                <p class="eyebrow">Seven explicit decisions</p>
                <h3>Record only what this preview showed</h3>
                <p>Loading or rendering never decides a dimension. Source comparison, alignment, scale, crop, completeness, privacy, and movable objects all begin as not assessed. “No preview issue observed” still means no approval or authority.</p>
              </div>
            </div>
            <div id="visual-decision-grid" class="visual-decision-grid"></div>

            <div class="section-heading compact">
              <div>
                <p class="eyebrow">Preview annotation</p>
                <h3>Describe a possible correction or bounded region</h3>
                <p>The controls below may change the drawing and can be recorded in a draft. They never rewrite points, crop bytes, masks, transforms, or package members.</p>
              </div>
            </div>
            <div class="annotation-fields">
              <label>Dimension
                <select id="visual-annotation-dimension"></select>
              </label>
              <label class="annotation-note">Observation note
                <textarea id="visual-annotation-note" minlength="12" maxlength="1000" rows="3" placeholder="Describe exactly what is visible and what remains unverified."></textarea>
              </label>
            </div>

            <fieldset>
              <legend>Preview-only alignment and scale values</legend>
              <div class="numeric-grid correction-grid">
                <label>Translate X (m)<input id="visual-translate-x" type="number" step="0.001" value="0"></label>
                <label>Translate Y (m)<input id="visual-translate-y" type="number" step="0.001" value="0"></label>
                <label>Translate Z (m)<input id="visual-translate-z" type="number" step="0.001" value="0"></label>
                <label>Rotate X (°)<input id="visual-rotate-x" type="number" step="0.1" value="0"></label>
                <label>Rotate Y (°)<input id="visual-rotate-y" type="number" step="0.1" value="0"></label>
                <label>Rotate Z (°)<input id="visual-rotate-z" type="number" step="0.1" value="0"></label>
                <label>Scale multiplier<input id="visual-scale" type="number" min="0.001" max="1000" step="0.001" value="1"></label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Preview-only crop/privacy/movable-region bounds (metres)</legend>
              <div class="numeric-grid bounds-grid">
                <label>Min X<input id="visual-bound-min-x" type="number" step="0.001"></label>
                <label>Min Y<input id="visual-bound-min-y" type="number" step="0.001"></label>
                <label>Min Z<input id="visual-bound-min-z" type="number" step="0.001"></label>
                <label>Max X<input id="visual-bound-max-x" type="number" step="0.001"></label>
                <label>Max Y<input id="visual-bound-max-y" type="number" step="0.001"></label>
                <label>Max Z<input id="visual-bound-max-z" type="number" step="0.001"></label>
              </div>
            </fieldset>
            <div class="actions">
              <button id="add-visual-annotation" class="button button-secondary" type="button">Add preview-only annotation</button>
            </div>
            <div id="visual-annotation-error" class="error" role="alert" tabindex="-1" hidden></div>
            <ol id="visual-annotation-list" class="annotation-list"></ol>

            <label class="reviewer-field">Visual reviewer name
              <input id="visual-reviewed-by" type="text" minlength="2" maxlength="160" autocomplete="name" required>
              <small>This identifies who prepared a local inspection draft. It grants no reviewer role or approval authority.</small>
            </label>
            <div class="actions">
              <button id="build-visual-draft" class="button button-primary" type="submit">Build local visual inspection draft</button>
            </div>
          </form>
          <div id="visual-draft-error" class="error" role="alert" tabindex="-1" hidden></div>

          <section id="visual-draft-result" class="draft-result" aria-labelledby="visual-draft-heading" hidden>
            <div>
              <p class="eyebrow">Local visual inspection only</p>
              <h3 id="visual-draft-heading">Artifacts, view, choices, and annotations are fingerprinted</h3>
              <p>No geometry was changed and no approval, authority, export, or runtime activation was created.</p>
            </div>
            <dl class="draft-facts">
              <div><dt>Visual draft fingerprint</dt><dd><code id="visual-draft-sha"></code></dd></div>
              <div><dt>Release eligibility</dt><dd>Blocked</dd></div>
              <div><dt>Authority</dt><dd>None</dd></div>
            </dl>
            <div class="actions">
              <button id="download-visual-draft" class="button button-secondary" type="button">Download visual inspection draft JSON</button>
            </div>
            <p class="download-warning">The download contains observations and fingerprints, not point data or a Room Reality Package. Your Downloads location may be cloud-synced.</p>
          </section>
        </section>
      </section>

      <section id="review-workspace" class="workbench" aria-labelledby="load-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">1 · Open exact JSON</p>
            <h2 id="load-heading">Load a candidate review dossier</h2>
            <p>Use an authority-none Room Reality Package assembly, or a dossier containing <code>candidate</code> plus optional strict transform, Scene Authority Map, and QA bodies. Evidence bodies are validated but remain caller-supplied and unauthenticated.</p>
          </div>
          <span class="badge">Session memory only</span>
        </div>
        <form id="load-form" class="load-form">
          <label class="file-control">Choose JSON dossier
            <input id="dossier-file" type="file" accept="application/json,.json">
            <small>The browser reads only this JSON selection. Do not select capture media.</small>
          </label>
          <label>Or paste JSON
            <textarea id="dossier-json" rows="7" spellcheck="false" placeholder="Paste an authority-none assembly or review dossier"></textarea>
          </label>
          <div class="actions">
            <button class="button button-primary" type="submit">Open local review</button>
            <button id="clear-button" class="button button-secondary" type="button">Clear input</button>
          </div>
        </form>
        <div id="load-error" class="error" role="alert" tabindex="-1" hidden></div>
      </section>

      <section id="surface" class="surface" aria-labelledby="surface-heading" hidden>
        <div class="surface-hero">
          <div>
            <p class="eyebrow">2 · Inspect status</p>
            <h2 id="surface-heading">Candidate evidence boundary</h2>
            <p id="surface-summary"></p>
          </div>
          <span class="badge badge-warning">Blocked from release</span>
        </div>

        <dl id="candidate-facts" class="facts"></dl>

        <section aria-labelledby="contracts-heading">
          <div class="section-heading compact">
            <div>
              <p class="eyebrow">Existing contracts</p>
              <h3 id="contracts-heading">Transform, Scene Authority, and QA evidence</h3>
              <p>“Contract valid” means the JSON body has the existing strict shape and self-digest rules. It does not authenticate the caller, asset identity, source bytes, or physical truth.</p>
            </div>
          </div>
          <div id="contract-cards" class="contract-grid"></div>
        </section>

        <form id="decision-form" class="decision-form">
          <div class="section-heading compact">
            <div>
              <p class="eyebrow">3 · Record a draft</p>
              <h3>Decide every review dimension</h3>
              <p>The observed status is fixed by this exact review surface. Your choices can leave a gap open, request a correction artifact, or draft-block the local candidate. They cannot approve it.</p>
            </div>
          </div>
          <div id="dimension-cards" class="dimension-grid"></div>
          <label class="reviewer-field">Reviewer name
            <input id="reviewed-by" type="text" minlength="2" maxlength="160" autocomplete="name" required>
            <small>This records who prepared the local draft. It grants no review authority.</small>
          </label>
          <div class="actions">
            <button class="button button-primary" type="submit">Build digest-bound review draft</button>
          </div>
        </form>
        <div id="draft-error" class="error" role="alert" tabindex="-1" hidden></div>

        <section id="draft-result" class="draft-result" aria-labelledby="draft-heading" hidden>
          <div>
            <p class="eyebrow">Draft recorded in session memory</p>
            <h3 id="draft-heading">Exact choices, exact fingerprint</h3>
            <p id="draft-summary"></p>
          </div>
          <dl class="draft-facts">
            <div><dt>Draft fingerprint</dt><dd><code id="draft-sha"></code></dd></div>
            <div><dt>Release eligibility</dt><dd>Blocked</dd></div>
            <div><dt>Authority</dt><dd>None</dd></div>
          </dl>
          <div class="actions">
            <button id="download-draft" class="button button-secondary" type="button">Download review draft JSON</button>
          </div>
          <p class="download-warning">A browser download creates another copy in your Downloads location, which may be cloud-synced. This is a review record, not a Room Reality Package export.</p>
        </section>
      </section>

      <footer>
        <strong>The room stays architectural; furniture stays planner state.</strong>
        <p>Captured tables, chairs, staging, bars, and other movable objects never become placement, measurement, collision, or export authority through this screen.</p>
      </footer>
    </main>
    <noscript>This local review needs JavaScript. It never contacts an external service.</noscript>
  </body>
</html>`;

export const LOCAL_ROOM_REALITY_REVIEW_CSS = String.raw`:root {
  color-scheme: dark;
  --ink: #091314;
  --ink-soft: #102224;
  --paper: #eeeae0;
  --paper-bright: #f8f5ee;
  --text: #f7f1e7;
  --muted: #a9bbb7;
  --paper-text: #172425;
  --paper-muted: #50615e;
  --mint: #7ee0d1;
  --mint-deep: #236b64;
  --gold: #f0bd63;
  --danger: #a74535;
  --rule: rgba(255, 255, 255, .12);
  background: var(--ink);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-behavior: smooth; }
body { margin: 0; min-height: 100vh; }
body::before { background: radial-gradient(circle at 82% -8%, rgba(87, 195, 180, .22), transparent 35rem), linear-gradient(145deg, #081213, #112426 58%, #071011); content: ""; inset: 0; position: fixed; z-index: -1; }
button, input, select, textarea { font: inherit; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible { outline: 3px solid var(--mint); outline-offset: 3px; }
.skip-link { background: var(--paper-bright); color: var(--paper-text); left: 16px; padding: 12px 16px; position: fixed; top: -80px; z-index: 20; }
.skip-link:focus { top: 16px; }
.shell { margin: 0 auto; max-width: 1440px; padding: clamp(20px, 4vw, 64px); }
.masthead { align-items: center; display: flex; gap: 24px; justify-content: space-between; }
.brand { align-items: center; color: var(--text); display: inline-flex; font-size: .86rem; font-weight: 850; gap: 10px; text-decoration: none; }
.brand-mark { align-items: center; background: var(--mint); border-radius: 8px; color: #0b2221; display: inline-flex; font-family: Georgia, serif; font-size: .76rem; height: 32px; justify-content: center; width: 32px; }
.trust-line { align-items: center; border: 1px solid rgba(126, 224, 209, .3); border-radius: 999px; color: var(--mint); display: flex; font-size: .72rem; font-weight: 850; gap: 8px; padding: 10px 13px; }
.trust-line span { background: var(--mint); border-radius: 50%; box-shadow: 0 0 0 4px rgba(126, 224, 209, .12); height: 7px; width: 7px; }
.intro { margin: clamp(64px, 9vw, 120px) 0 46px; max-width: 1050px; }
.intro h1 { font-family: Georgia, "Times New Roman", serif; font-size: clamp(2.7rem, 6vw, 6rem); font-weight: 500; letter-spacing: -.055em; line-height: .95; margin: 8px 0 0; }
.intro > p:last-child { color: var(--muted); font-size: clamp(1rem, 1.5vw, 1.18rem); line-height: 1.65; margin: 26px 0 0; max-width: 840px; }
.eyebrow { color: var(--mint-deep); font-size: .68rem; font-weight: 950; letter-spacing: .12em; margin: 0 0 8px; text-transform: uppercase; }
.intro .eyebrow { color: var(--mint); }
.boundary { border: 1px solid rgba(240, 189, 99, .32); border-radius: 18px; display: grid; gap: 34px; grid-template-columns: minmax(230px, .6fr) minmax(0, 1.4fr); margin-bottom: 24px; padding: clamp(22px, 3vw, 36px); }
.boundary h2 { font-family: Georgia, serif; font-size: 1.8rem; font-weight: 500; margin: 0; }
.boundary dl { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; }
.boundary dl div { border-top: 1px solid var(--rule); padding-top: 10px; }
.boundary dt { color: var(--gold); font-size: .65rem; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; }
.boundary dd { color: var(--text); font-size: .8rem; line-height: 1.4; margin: 5px 0 0; }
.workbench, .surface { background: var(--paper); border: 1px solid rgba(255, 255, 255, .38); border-radius: 22px; box-shadow: 0 28px 90px rgba(0, 0, 0, .3); color: var(--paper-text); padding: clamp(22px, 4vw, 46px); }
.surface { margin-top: 24px; }
.section-heading, .surface-hero { align-items: flex-start; display: flex; gap: 28px; justify-content: space-between; }
.section-heading h2, .surface-hero h2 { font-family: Georgia, serif; font-size: clamp(1.8rem, 3vw, 2.8rem); font-weight: 500; letter-spacing: -.035em; margin: 0; }
.section-heading h3, .surface h3, .draft-result h3, .draft-result h4 { font-family: Georgia, serif; font-size: 1.55rem; font-weight: 500; margin: 0; }
.section-heading p:last-child, .surface-hero p:last-child { color: var(--paper-muted); line-height: 1.55; margin: 9px 0 0; max-width: 850px; }
.section-heading.compact { border-top: 1px solid #bdcac7; margin-top: 34px; padding-top: 28px; }
.badge { align-items: center; background: #d7ebe6; border: 1px solid #a7ccc4; border-radius: 999px; color: #174e49; display: inline-flex; flex: 0 0 auto; font-size: .72rem; font-weight: 900; min-height: 38px; padding: 8px 13px; }
.badge-warning { background: #efe0c6; border-color: #d6b87f; color: #6d5018; }
.load-form { display: grid; gap: 18px; margin-top: 28px; }
label { color: #3f5653; display: grid; font-size: .78rem; font-weight: 900; gap: 8px; }
label small { color: var(--paper-muted); font-size: .72rem; font-weight: 500; line-height: 1.45; }
input, select, textarea { background: var(--paper-bright); border: 1px solid #91a7a2; border-radius: 9px; color: var(--paper-text); min-height: 46px; padding: 10px 12px; width: 100%; }
textarea { line-height: 1.45; min-height: 120px; resize: vertical; }
.actions { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; }
.button { border: 0; border-radius: 999px; cursor: pointer; font-weight: 900; min-height: 46px; padding: 11px 19px; }
.button-primary { background: var(--mint-deep); color: white; }
.button-secondary { background: transparent; border: 1px solid #839995; color: #274441; }
.button:disabled { cursor: not-allowed; opacity: .55; }
.error { background: #f1d9d3; border: 1px solid #ca8d80; border-left: 5px solid var(--danger); border-radius: 11px; color: #6c261b; line-height: 1.5; margin-top: 20px; padding: 16px; }
.facts { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 28px 0 0; }
.facts div, .draft-facts div { border-top: 1px solid #bccbc7; min-width: 0; padding-top: 11px; }
.facts dt, .draft-facts dt { color: #506562; font-size: .65rem; font-weight: 950; letter-spacing: .07em; text-transform: uppercase; }
.facts dd, .draft-facts dd { font-size: .82rem; line-height: 1.45; margin: 6px 0 0; overflow-wrap: anywhere; }
.facts code, .draft-facts code { font-size: .69rem; }
.contract-grid { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 20px; }
.contract-card, .dimension-card { background: var(--paper-bright); border: 1px solid #bdcbc8; border-radius: 14px; min-width: 0; padding: 18px; }
.contract-card h4, .dimension-card h4 { font-family: Georgia, serif; font-size: 1.18rem; font-weight: 500; margin: 0; }
.contract-card > p { color: var(--paper-muted); font-size: .75rem; line-height: 1.5; }
.contract-card details, .dimension-card details { border-top: 1px solid #d4ddda; margin-top: 12px; padding-top: 10px; }
summary { color: #315b57; cursor: pointer; font-size: .72rem; font-weight: 900; }
.contract-card ul, .dimension-card ul { margin: 10px 0 0; padding-left: 18px; }
.contract-card li, .dimension-card li { color: var(--paper-muted); font-size: .7rem; line-height: 1.5; overflow-wrap: anywhere; }
.dimension-grid { display: grid; gap: 15px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 20px; }
.dimension-head { align-items: flex-start; display: flex; gap: 14px; justify-content: space-between; }
.status { background: #e9decb; border-radius: 999px; color: #6d521b; flex: 0 0 auto; font-size: .62rem; font-weight: 950; letter-spacing: .04em; padding: 6px 8px; text-transform: uppercase; }
.dimension-finding, .dimension-next { color: var(--paper-muted); font-size: .74rem; line-height: 1.5; }
.dimension-next { border-left: 3px solid #84b8ae; padding-left: 10px; }
.dimension-fields { display: grid; gap: 12px; margin-top: 16px; }
.dimension-fields textarea { min-height: 88px; }
.reviewer-field { margin-top: 22px; max-width: 520px; }
.decision-form > .actions { margin-top: 20px; }
.draft-result { background: #dfece8; border: 1px solid #a8c9c1; border-radius: 16px; margin-top: 24px; padding: clamp(20px, 3vw, 30px); }
.draft-result > div:first-child > p:last-child { color: #46605c; line-height: 1.5; margin: 8px 0 0; }
.draft-facts { display: grid; gap: 12px; grid-template-columns: 2fr 1fr 1fr; margin: 22px 0; }
.download-warning { color: #5c5140; font-size: .72rem; line-height: 1.5; margin: 14px 0 0; }
.visual-workbench { margin-bottom: 24px; }
.visual-file-grid { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 28px; }
.drop-control { align-content: center; background: var(--paper-bright); border: 1px dashed #769c95; border-radius: 14px; cursor: pointer; min-height: 152px; padding: 20px; transition: background-color 180ms ease, border-color 180ms ease, transform 180ms ease; }
.drop-control:hover, .drop-control.is-dragging { background: #dceee9; border-color: var(--mint-deep); transform: translateY(-1px); }
.drop-control input { background: transparent; border: 0; min-height: 44px; padding: 0; }
.drop-control strong { color: #254b47; font-family: Georgia, serif; font-size: 1.08rem; font-weight: 500; }
.visual-load-actions { margin-top: 16px; }
.visual-status { color: var(--paper-muted); font-size: .78rem; line-height: 1.5; margin: 16px 0 0; }
.point-visual-surface { border-top: 1px solid #bdcac7; margin-top: 28px; }
.visual-facts { margin-bottom: 20px; }
.canvas-shell { background: #071112; border: 1px solid #31514e; border-radius: 16px; min-height: 320px; overflow: hidden; position: relative; }
#point-crop-canvas { cursor: grab; display: block; height: clamp(340px, 55vw, 680px); touch-action: none; width: 100%; }
#point-crop-canvas:active { cursor: grabbing; }
.canvas-legend { align-items: center; background: rgba(7, 17, 18, .86); border: 1px solid rgba(255, 255, 255, .12); border-radius: 999px; bottom: 14px; color: #dce9e6; display: flex; flex-wrap: wrap; font-size: .68rem; gap: 14px; left: 14px; padding: 9px 12px; pointer-events: none; position: absolute; }
.canvas-legend span { align-items: center; display: inline-flex; gap: 6px; }
.canvas-legend i { border-radius: 50%; display: inline-block; height: 8px; width: 8px; }
.legend-primary { background: #7ee0d1; }
.legend-comparison { background: #c495ff; }
.legend-crop { background: #f0bd63; }
.legend-annotation { background: #ff7894; }
.viewer-controls { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.camera-readout { color: var(--paper-muted); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .7rem; margin-left: auto; }
.comparison-controls { align-items: end; background: #e0ebe8; border: 1px solid #b6cbc6; border-radius: 12px; display: grid; gap: 16px; grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr); margin-top: 14px; padding: 16px; }
.check-control { align-items: center; display: flex; gap: 10px; min-height: 46px; }
.check-control input { min-height: 24px; width: 24px; }
.mask-panel { border-top: 1px solid #bdcac7; margin-top: 34px; }
.mask-rule-builder { background: #e3ece9; border: 1px solid #b7cbc6; border-radius: 14px; margin-top: 20px; padding: clamp(16px, 3vw, 24px); }
.mask-rule-fields, .mask-authorship-fields { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mask-authorship-fields { margin-top: 20px; }
.mask-purpose-note { grid-column: 1 / -1; }
.mask-rule-builder > label { margin-top: 18px; }
.mask-rule-builder > .actions { margin-top: 16px; }
.mask-rule-list, .mask-rule-counts { display: grid; gap: 10px; list-style: none; margin: 18px 0 0; padding: 0; }
.mask-rule-list li, .mask-rule-counts li { align-items: flex-start; background: var(--paper-bright); border: 1px solid #bdcbc8; border-radius: 12px; display: flex; gap: 14px; justify-content: space-between; min-width: 0; padding: 14px; }
.mask-rule-list li > div, .mask-rule-counts li > div { min-width: 0; }
.mask-rule-list strong, .mask-rule-counts strong { color: #274441; font-size: .8rem; overflow-wrap: anywhere; }
.mask-rule-list p, .mask-rule-counts p { color: var(--paper-muted); font-size: .72rem; line-height: 1.45; margin: 5px 0 0; overflow-wrap: anywhere; }
.mask-rule-list button { flex: 0 0 auto; min-height: 44px; width: auto; }
.mask-result-facts { grid-template-columns: 2fr repeat(5, minmax(0, 1fr)); }
.visual-decision-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 20px; }
.visual-decision-card { background: var(--paper-bright); border: 1px solid #bdcbc8; border-radius: 14px; display: grid; gap: 12px; padding: 18px; }
.visual-decision-card h4 { font-family: Georgia, serif; font-size: 1.1rem; font-weight: 500; margin: 0; }
.annotation-fields { display: grid; gap: 14px; grid-template-columns: minmax(220px, .55fr) minmax(0, 1.45fr); margin-top: 20px; }
fieldset { border: 1px solid #bdcbc8; border-radius: 14px; margin: 18px 0 0; padding: 18px; }
legend { color: #345a56; font-size: .72rem; font-weight: 900; padding: 0 8px; }
.numeric-grid { display: grid; gap: 12px; }
.correction-grid { grid-template-columns: repeat(4, minmax(110px, 1fr)); }
.bounds-grid { grid-template-columns: repeat(3, minmax(110px, 1fr)); }
.annotation-list { display: grid; gap: 10px; list-style: none; margin: 18px 0 0; padding: 0; }
.annotation-list li { align-items: flex-start; background: #e3ece9; border: 1px solid #bdcbc8; border-radius: 12px; display: flex; gap: 14px; justify-content: space-between; padding: 14px; }
.annotation-list li > div { min-width: 0; }
.annotation-list p { color: var(--paper-muted); font-size: .73rem; line-height: 1.45; margin: 4px 0 0; }
.annotation-list button { flex: 0 0 auto; min-height: 44px; width: auto; }
footer { border-top: 1px solid var(--rule); margin-top: 46px; padding: 28px 0; }
footer strong { font-family: Georgia, serif; font-size: 1.35rem; font-weight: 500; }
footer p { color: var(--muted); line-height: 1.55; margin: 8px 0 0; max-width: 850px; }
code { overflow-wrap: anywhere; }

@media (max-width: 980px) {
  .boundary { grid-template-columns: 1fr; }
  .contract-grid { grid-template-columns: 1fr; }
  .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .correction-grid { grid-template-columns: repeat(2, minmax(110px, 1fr)); }
  .mask-result-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 680px) {
  .shell { padding: 20px; }
  .masthead, .section-heading, .surface-hero { align-items: flex-start; flex-direction: column; }
  .trust-line { border-radius: 12px; }
  .intro { margin-top: 64px; }
  .boundary dl, .facts, .dimension-grid, .draft-facts { grid-template-columns: 1fr; }
  .visual-file-grid, .visual-decision-grid, .annotation-fields, .comparison-controls, .correction-grid, .bounds-grid, .mask-rule-fields, .mask-authorship-fields, .mask-result-facts { grid-template-columns: 1fr; }
  .mask-purpose-note { grid-column: auto; }
  .dimension-head { flex-direction: column; }
  .status { white-space: normal; }
  .actions { align-items: stretch; flex-direction: column; }
  .button { width: 100%; }
  .viewer-controls .button { width: auto; }
  .camera-readout { margin-left: 0; width: 100%; }
  .canvas-legend { border-radius: 12px; right: 14px; }
  #point-crop-canvas { height: 420px; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
}`;

const LOCAL_ROOM_REALITY_METADATA_REVIEW_JAVASCRIPT = String.raw`(() => {
  "use strict";

  const sessionKey = "omnitwin.foundry.local-session-token";
  const suppliedToken = new URLSearchParams(window.location.search).get("token");
  if (suppliedToken) {
    window.sessionStorage.setItem(sessionKey, suppliedToken);
    window.history.replaceState(null, "", window.location.pathname);
  }
  const token = suppliedToken || window.sessionStorage.getItem(sessionKey);
  const byId = (id) => document.getElementById(id);
  const loadForm = byId("load-form");
  const dossierFile = byId("dossier-file");
  const dossierJson = byId("dossier-json");
  const loadError = byId("load-error");
  const surfacePanel = byId("surface");
  const decisionForm = byId("decision-form");
  const draftError = byId("draft-error");
  const draftResult = byId("draft-result");
  let currentSurface = null;
  let currentDraft = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function showError(target, message) {
    target.textContent = message;
    target.hidden = false;
    target.focus();
  }

  function clearError(target) {
    target.textContent = "";
    target.hidden = true;
  }

  function apiUrl(path) {
    if (!token) throw new Error("This local session link is missing or expired.");
    return path + "?token=" + encodeURIComponent(token);
  }

  async function requestJson(path, options) {
    const response = await fetch(apiUrl(path), options);
    const value = await response.json().catch(() => ({ error: "The local app returned an unreadable response." }));
    if (!response.ok) throw new Error(value.error || "The local request failed safely.");
    return value;
  }

  function appendFact(target, label, value) {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    target.append(row);
  }

  function statusLabel(status) {
    const labels = {
      not_performed: "Not performed",
      not_reviewed: "Not reviewed",
      not_verified: "Not verified",
      reference_ids_only: "Reference IDs only",
      partially_validated_untrusted: "Partially validated · untrusted",
      contract_validated_untrusted: "Contract valid · untrusted",
      qa_reported_untrusted: "QA reported · untrusted",
      unavailable: "Unavailable"
    };
    return labels[status] || "Unresolved";
  }

  function appendReferenceDetails(parent, references, emptyCopy) {
    const details = element("details");
    details.append(element("summary", "", references.length + " referenced identifier" + (references.length === 1 ? "" : "s")));
    const list = element("ul");
    if (references.length === 0) list.append(element("li", "", emptyCopy));
    for (const reference of references) list.append(element("li", "", reference));
    details.append(list);
    parent.append(details);
  }

  function renderContractCard(heading, referenced, supplied, rows) {
    const card = element("article", "contract-card");
    card.append(
      element("h4", "", heading),
      element("p", "", supplied.length + " strict JSON " + (supplied.length === 1 ? "body" : "bodies") + " supplied for " + referenced.length + " candidate reference" + (referenced.length === 1 ? "." : "s."))
    );
    appendReferenceDetails(card, referenced, "The blocked candidate carries no reference IDs for this contract.");
    const details = element("details");
    details.append(element("summary", "", "Inspect supplied contract summaries"));
    const list = element("ul");
    if (rows.length === 0) list.append(element("li", "", "No strict contract body was supplied. IDs alone are not evidence bodies."));
    for (const row of rows) list.append(element("li", "", row));
    details.append(list);
    card.append(details);
    return card;
  }

  function renderContracts(surface) {
    const evidence = surface.contractEvidence;
    const target = byId("contract-cards");
    target.replaceChildren();
    target.append(
      renderContractCard(
        "TransformArtifactV0",
        evidence.transformReferenceIds,
        evidence.transforms,
        evidence.transforms.map((item) => item.referenceId + ": " + item.sourceFrame + " → " + item.targetFrame + ", " + item.units + ", " + item.alignmentMethod + ", RMSE " + (item.residualRmseM === null ? "not recorded" : item.residualRmseM + " m") + ". Identity remains untrusted.")
      ),
      renderContractCard(
        "Scene Authority Map",
        evidence.sceneAuthorityMapReferenceIds,
        evidence.sceneAuthorityMaps,
        evidence.sceneAuthorityMaps.map((item) => item.referenceId + ": " + item.regionCount + " region" + (item.regionCount === 1 ? "" : "s") + ", " + item.exportAuthorityNoneCount + " with export authority none. Identity remains untrusted.")
      ),
      renderContractCard(
        "QA reports",
        evidence.qualityReportReferenceIds,
        evidence.qualityReports,
        evidence.qualityReports.map((item) => item.referenceId + ": contract outcome " + item.outcome + " under " + item.profileVersion + ". This does not prove crop, privacy, or complete coverage.")
      )
    );
  }

  function renderDimensions(surface) {
    const target = byId("dimension-cards");
    target.replaceChildren();
    for (const dimension of surface.dimensions) {
      const card = element("article", "dimension-card");
      card.dataset.dimensionId = dimension.id;
      const head = element("div", "dimension-head");
      head.append(element("h4", "", dimension.label), element("span", "status", statusLabel(dimension.observedStatus)));
      card.append(
        head,
        element("p", "dimension-finding", dimension.finding),
        element("p", "dimension-next", "Decisive next action: " + dimension.decisiveNextAction)
      );
      appendReferenceDetails(card, dimension.evidenceReferences, "No candidate reference is available for this dimension.");
      const fields = element("div", "dimension-fields");
      const actionLabel = element("label", "", "Draft action");
      const select = element("select");
      select.dataset.role = "action";
      select.setAttribute("aria-label", dimension.label + " draft action");
      for (const action of dimension.allowedActions) {
        const option = element("option", "", action.label);
        option.value = action.id;
        option.title = action.meaning;
        select.append(option);
      }
      actionLabel.append(select);
      const noteLabel = element("label", "", "Reason for this draft choice");
      const note = element("textarea");
      note.dataset.role = "note";
      note.required = true;
      note.minLength = 12;
      note.maxLength = 1000;
      note.rows = 3;
      note.setAttribute("aria-label", dimension.label + " review note");
      note.placeholder = "Record what remains unknown or what evidence is required.";
      noteLabel.append(note);
      fields.append(actionLabel, noteLabel);
      card.append(fields);
      target.append(card);
    }
  }

  function renderSurface(surface) {
    currentSurface = surface;
    currentDraft = null;
    draftResult.hidden = true;
    clearError(draftError);
    const candidateStatus = surface.candidate.status === "blocked"
      ? "is blocked"
      : "is a local unverified candidate";
    byId("surface-summary").textContent = "Package “" + surface.candidate.packageId + "” " + candidateStatus + ". Every correction and release capability remains disabled.";
    const facts = byId("candidate-facts");
    facts.replaceChildren();
    appendFact(facts, "Package", surface.candidate.packageId);
    appendFact(facts, "Project", surface.candidate.projectId);
    appendFact(facts, "Assembly fingerprint", surface.candidate.assemblySha256);
    appendFact(facts, "Review surface fingerprint", surface.reviewSurfaceSha256);
    appendFact(facts, "Rights state", surface.candidate.ingestLegalReviewState.replaceAll("_", " "));
    appendFact(facts, "Release blockers", surface.candidate.releaseBlockers.length + " unresolved gate" + (surface.candidate.releaseBlockers.length === 1 ? "" : "s"));
    renderContracts(surface);
    renderDimensions(surface);
    surfacePanel.hidden = false;
    surfacePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderDraft(draft) {
    currentDraft = draft;
    byId("draft-sha").textContent = draft.reviewDraftSha256;
    byId("draft-summary").textContent = draft.disposition === "blocked_by_operator_draft"
      ? "This operator draft records a local candidate block. It is still not a release rejection or authority decision."
      : "Every dimension remains unresolved or has a correction request. No approval, correction, export, or activation was created.";
    draftResult.hidden = false;
    draftResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function normalizedDossier(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value.assemblySha256 === "string") {
      return { candidate: value };
    }
    return value;
  }

  async function loadDossierText() {
    const pasted = dossierJson.value.trim();
    if (pasted) return pasted;
    const file = dossierFile.files && dossierFile.files[0];
    if (!file) throw new Error("Choose or paste one JSON candidate dossier.");
    if (file.size > 2 * 1024 * 1024) throw new Error("The JSON dossier exceeds the 2 MiB local review limit.");
    return file.text();
  }

  loadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError(loadError);
    try {
      const text = await loadDossierText();
      const parsed = normalizedDossier(JSON.parse(text));
      const surface = await requestJson("/api/room-reality-review/dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      renderSurface(surface);
    } catch (error) {
      showError(loadError, error instanceof Error ? error.message : "The JSON dossier could not be opened safely.");
    }
  });

  byId("clear-button").addEventListener("click", () => {
    dossierJson.value = "";
    dossierFile.value = "";
    clearError(loadError);
  });

  decisionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError(draftError);
    if (!currentSurface) {
      showError(draftError, "Open a current candidate review dossier first.");
      return;
    }
    try {
      const decisions = [];
      for (const card of byId("dimension-cards").querySelectorAll("[data-dimension-id]")) {
        decisions.push({
          dimensionId: card.dataset.dimensionId,
          action: card.querySelector('[data-role="action"]').value,
          note: card.querySelector('[data-role="note"]').value.trim()
        });
      }
      const draft = await requestJson("/api/room-reality-review/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewSurfaceSha256: currentSurface.reviewSurfaceSha256,
          candidateAssemblySha256: currentSurface.candidate.assemblySha256,
          reviewedAt: new Date().toISOString(),
          reviewedBy: byId("reviewed-by").value.trim(),
          decisions
        })
      });
      renderDraft(draft);
    } catch (error) {
      showError(draftError, error instanceof Error ? error.message : "The review draft could not be built safely.");
    }
  });

  byId("download-draft").addEventListener("click", () => {
    if (!currentDraft) return;
    const blob = new Blob([JSON.stringify(currentDraft, null, 2) + "\n"], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = element("a");
    anchor.href = objectUrl;
    anchor.download = "foundry-room-reality-review-draft-v0.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  });

  async function restoreState() {
    if (!token) {
      showError(loadError, "This local session link is missing or expired. Return to the Foundry intake page.");
      for (const control of loadForm.elements) control.disabled = true;
      return;
    }
    try {
      const state = await requestJson("/api/room-reality-review/state", { method: "GET" });
      if (state.state === "ready") {
        renderSurface(state.surface);
        if (state.draft) renderDraft(state.draft);
      }
    } catch (error) {
      showError(loadError, error instanceof Error ? error.message : "The local review state is unavailable.");
    }
  }

  void restoreState();
})();`;

export const LOCAL_ROOM_REALITY_REVIEW_JAVASCRIPT =
  `${LOCAL_ROOM_REALITY_METADATA_REVIEW_JAVASCRIPT}\n${LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT}`;
