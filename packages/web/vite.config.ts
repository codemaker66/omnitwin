import { defineConfig, loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import {
  assertRequiredProductionEnv,
  getSentrySourceMapUploadConfig,
  resolveWebClerkPublishableKey,
} from "./src/lib/production-env";
import { splatStagingPlugin } from "./src/lib/splat-staging-plugin";

// ---------------------------------------------------------------------------
// Vite config — punch list #16 bundle splitting
//
// Three explicit vendor chunks let the editor's heavy 3D dependencies stay
// out of every other route's initial download:
//   - react-vendor: react/dom/router (every route needs it; cacheable)
//   - three:        three.js + R3F + drei + stdlib (3D routes only)
//   - spark:        Spark 2.0 splat renderer (splat routes only)
//   - clerk:        @clerk/react (login, register, dashboard need it;
//                   anonymous /hallkeeper/:id and /editor guests do NOT)
//
// Page chunks (one per route) emit automatically because router.tsx wraps
// every page in React.lazy(() => import(...)). Rollup creates a chunk per
// dynamic-import boundary.
// ---------------------------------------------------------------------------

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  assertRequiredProductionEnv(mode, env);
  const clerkPublishableKey = resolveWebClerkPublishableKey(env) ?? "";
  const sentrySourceMapUpload = mode === "production"
    ? getSentrySourceMapUploadConfig(env)
    : null;
  const plugins: PluginOption[] = [react()];

  // Captured splat tiles are staged outside the repository (roughly a gigabyte
  // across the eight Trades Hall rooms), so `public/` cannot hold them. In
  // development they are served from SPLAT_STAGING_ROOT; production points
  // VITE_SPLAT_BASE_URL at R2 instead. Absent the variable, the app still runs
  // and falls back to its procedural scene.
  const splatStaging = splatStagingPlugin(env["SPLAT_STAGING_ROOT"]);
  if (splatStaging !== null) plugins.push(splatStaging);

  // Where a production build fetches captured splat tiles.
  //
  // Tiles are not in the repo, so a production bundle cannot fall back to the
  // dev middleware's "/splats" — that path does not exist on the deployed
  // origin. This resolves to the public R2 bucket the tiles are published to
  // by packages/api/src/scripts/publish-splat-tiles.ts. It is a public bucket
  // URL, not a secret, and a real VITE_SPLAT_BASE_URL always wins so the
  // bucket can be moved without a code change.
  const publishedSplatBaseUrl = "https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats";
  const splatBaseUrl = (env["VITE_SPLAT_BASE_URL"] ?? "").trim().length > 0
    ? (env["VITE_SPLAT_BASE_URL"] ?? "")
    : (mode === "production" ? publishedSplatBaseUrl : "");

  if (sentrySourceMapUpload !== null) {
    plugins.push(...sentryVitePlugin({
      authToken: sentrySourceMapUpload.authToken,
      org: sentrySourceMapUpload.org,
      project: sentrySourceMapUpload.project,
      release: {
        name: sentrySourceMapUpload.release,
        setCommits: false,
      },
      sourcemaps: {
        assets: "./dist/assets/**",
        filesToDeleteAfterUpload: "./dist/assets/**/*.map",
      },
      telemetry: false,
      silent: true,
      bundleSizeOptimizations: {
        excludeReplayCanvas: true,
        excludeReplayIframe: true,
        excludeReplayShadowDom: true,
        excludeReplayWorker: true,
      },
    }));
  }

  return {
    plugins,
    define: {
      __VENVIEWER_CLERK_PUBLISHABLE_KEY__: JSON.stringify(clerkPublishableKey),
      // Baked in so a production bundle knows where published tiles live without
      // requiring a Vercel environment variable. Empty in development, where the
      // staging middleware serves them from "/splats" instead.
      "import.meta.env.VITE_SPLAT_BASE_URL": JSON.stringify(splatBaseUrl),
    },
    build: {
      target: "es2022",
      sourcemap: sentrySourceMapUpload === null ? false : "hidden",
      // The Three/Spark chunks are intentionally large and deliberately lazy:
      // source tests below pin both the split and the absence of Spark from
      // normal editor routes. Raising this limit quiets Vite's generic warning
      // without hiding accidental eager imports.
      chunkSizeWarningLimit: 5_500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");

            if (
              normalizedId.includes("vite/preload-helper") ||
              normalizedId.includes("/node_modules/react/") ||
              normalizedId.includes("/node_modules/react-dom/") ||
              normalizedId.includes("/node_modules/react-router-dom/") ||
              normalizedId.includes("/node_modules/scheduler/") ||
              normalizedId.includes("/node_modules/zustand/")
            ) {
              return "react-vendor";
            }

            if (
              normalizedId.includes("/node_modules/three/") ||
              normalizedId.includes("/node_modules/@react-three/fiber/") ||
              normalizedId.includes("/node_modules/@react-three/drei/") ||
              normalizedId.includes("/node_modules/three-stdlib/")
            ) {
              return "three";
            }

            if (normalizedId.includes("/node_modules/@sparkjsdev/spark/")) {
              return "spark";
            }

            if (normalizedId.includes("/node_modules/@clerk/")) {
              return "clerk";
            }

            return undefined;
          },
        },
      },
    },
  };
});
