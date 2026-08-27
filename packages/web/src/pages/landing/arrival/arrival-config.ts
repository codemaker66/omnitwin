/**
 * Google Map Tiles API key for the Arrival hero. Absent in dev until the key
 * lands in packages/web/.env.local; absence must degrade to the static hero
 * photo, never throw (spec §6). Bracket access per useTwinManifest.ts:26.
 */
export function googleTilesApiKey(): string | null {
  const raw = import.meta.env["VITE_GOOGLE_MAPS_TILES_KEY"];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Google Maps brand-attribution logo, passed as `logoUrl` to
 * `GoogleCloudAuthPlugin` (see GoogleTilesStage.tsx). Google's Map Tiles API
 * Policies require two separate attributions — a text/copyright line (which
 * the plugin already emitted) and this logo credit, sized 16-19dp tall with
 * 10dp/5dp clear space (developers.google.com/maps/documentation/tile/
 * policies, "Display Google Maps attribution", fetched 2026-08-27; see
 * docs/operations/arrival-google-tiles.md Finding 2). Without a non-empty
 * `logoUrl`, `GoogleCloudAuthPlugin.getAttributions()` never pushes the logo
 * credit at all (`if (this.logoUrl)` — node_modules/3d-tiles-renderer/src/
 * core/plugins/GoogleCloudAuthPlugin.js:120-125) — that was the shipped bug.
 *
 * Self-hosted, root-relative — same convention as FRESH_ARMS/
 * FRESH_HERITAGE_ART (packages/web/src/pages/fresh/fresh-copy.ts) and
 * packages/web/public/images/brand/. This is deliberate, not merely
 * convenient: Google does not publish a stable, directly hotlinkable image
 * URL for this mark. Its policies page links only a downloadable archive —
 * https://developers.google.com/static/maps/documentation/images/
 * Google_Maps_Attribution_Assets.zip (confirmed live via HEAD request
 * 2026-08-27: `content-type: application/zip`, `content-disposition:
 * attachment`) — meant to be unpacked and self-hosted by the integrator, not
 * fetched from Google's servers at runtime. (The two illustration images
 * embedded on that same policies page — .../static/maps/images/
 * 02_GMP_Logo_Alternates.jpg and .../03_GMP_Logo_Size_Specs.jpg, both
 * confirmed live, both 100-200KB JPEGs — are documentation spec-sheet
 * graphics with multiple variants and dimension callouts printed on them,
 * NOT a usable production mark; do not repurpose either as this value.)
 * Self-hosting also sidesteps any CSP img-src allowlisting for a third-party
 * host and any dependency on Google's asset CDN being reachable at render
 * time (offline dev, flaky network, or a promotional-video capture session).
 *
 * NEEDS_CONTEXT — the file this path points to has not been added to the
 * repo yet. Downloading and unpacking Google's zip, and picking the
 * color/size variant with sufficient contrast against the Arrival hero's
 * imagery, is a human judgment call (and a file download this agent could
 * not authorize itself) — it still needs to happen, with the chosen asset
 * committed at this exact path, before Task 16 (production key rollout).
 * Do not substitute a hand-drawn or third-party-hosted stand-in for
 * Google's own trademarked mark. Tracked in docs/operations/
 * arrival-google-tiles.md's Deployment checklist.
 */
export const GOOGLE_MAPS_ATTRIBUTION_LOGO_URL = "/images/brand/google-maps-attribution-logo.png";
