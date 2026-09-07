**Read this when:** a splat scene appears blank or never streams in a browser tool.

# Separate browser instrumentation failures from site failures

On 2026-09-03, the then-available embedded Claude Browser pane showed a blank
Grand Hall on both local and live routes. Scene state reported completion but no
tile requests appeared in its logs; Playwright Chromium rendered the same local
route. This is a dated observation of that integration, not a permanent statement
about every embedded browser or proof of a specific worker-networking cause.

For a current failure, inspect actual tile requests/responses, scene counters,
failed versus loaded tiles, WebGL state and console errors. A settled count includes
failures and does not prove a drawn room. Neither an HTTP 200 nor a missing loading
indicator establishes asset readiness.

Use the supported browser first. If its instrumentation cannot establish the
result, compare the same revision, route and data with an available real-browser
harness such as `packages/web/scripts/splat-drag-budget.mjs`. Record the browser,
device, relevant difference and any fallback. Do not dismiss a black canvas as
"the pane" without isolating it; a tool limitation is also not proof the site fails.

Keep performance measurements separate from screenshot/readback work, which can
stall the GPU and distort timings.
