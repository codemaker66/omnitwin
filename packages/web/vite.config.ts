import { defineConfig, loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import {
  assertRequiredProductionEnv,
  getSentrySourceMapUploadConfig,
  resolveBuildSplatBaseUrl,
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
  // development they are served from SPLAT_STAGING_ROOT; where deployed builds
  // read them is described below. Absent the variable, the app still runs and
  // falls back to its procedural scene.
  const splatStaging = splatStagingPlugin(env["SPLAT_STAGING_ROOT"]);
  if (splatStaging !== null) plugins.push(splatStaging);

  // Where a build fetches captured splat tiles and room packages.
  //
  // "" means the app's own "/splats": served from SPLAT_STAGING_ROOT by the
  // plugin above in development. On Vercel that path redirects to the
  // work-in-progress page while the founder hold stands (vercel.json), so a
  // preview build reads the public R2 bucket directly instead; the bucket's
  // CORS policy admits *.vercel.app. Production keeps "" and the hold. A real
  // VITE_SPLAT_BASE_URL always wins, so the bucket can move without a code change.
  const splatBaseUrl = resolveBuildSplatBaseUrl(env);

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
      // Where captured room assets are fetched from (resolveBuildSplatBaseUrl):
      // an explicit VITE_SPLAT_BASE_URL always wins; a Vercel preview build
      // bakes the public R2 base; every other build, production included,
      // bakes "" — the app's own "/splats", which production holds (it
      // redirects to the work-in-progress page) and development serves from
      // SPLAT_STAGING_ROOT.
      "import.meta.env.VITE_SPLAT_BASE_URL": JSON.stringify(splatBaseUrl),
      // Vercel's deployment environment, so preview links can open splats
      // (T-639) while production keeps the founder hold. Empty outside Vercel.
      "import.meta.env.VITE_DEPLOY_ENV": JSON.stringify(env["VERCEL_ENV"] ?? ""),
    },
    server: {
      // Transform the planner's static import graph when the dev server starts.
      // Otherwise its first navigation pays a long module-transform waterfall;
      // this does not load the route in the browser or affect production bundles.
      warmup: { clientFiles: ["./src/pages/EditorPage.tsx"] },
    },
    worker: { format: "es" },
    optimizeDeps: {
      // The lazy decoder worker otherwise discovers these after the planner
      // starts, causing Vite to reload the document during capture decoding.
      include: [
        "three/addons/gpgpu/CountingSort.js",
        "three/addons/loaders/GaussianSplatPLYLoader.js",
        "three/addons/loaders/SPZLoader.js",
        "three/addons/libs/zstddec.module.js",
        "@jsquash/webp/decode.js",
      ],
    },
    build: {
      target: "es2022",
      sourcemap: sentrySourceMapUpload === null ? false : "hidden",
      // The Three.js chunks are intentionally large and deliberately lazy:
      // source tests below pin both the split and the absence of splat decoding from
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

            // The WebGPU renderer, TSL and the native splat addon stack are
            // needed only by NativeCanvas surfaces. Kept out of "three", the
            // WebGL panorama tour and other plain R3F canvases skip them.
            // TSL addons (the planner's post-processing nodes) import both,
            // so they live here too: left in "three" they would make the two
            // chunks import each other, and the minified build then reads a
            // binding before its chunk has initialised.
            if (
              normalizedId.includes("/node_modules/three/build/three.webgpu") ||
              normalizedId.includes("/node_modules/three/build/three.tsl") ||
              normalizedId.includes("/node_modules/three/examples/jsm/tsl/") ||
              normalizedId.includes("/node_modules/three/examples/jsm/objects/GaussianSplat") ||
              normalizedId.includes("/node_modules/three/examples/jsm/utils/GaussianSplatUtils") ||
              normalizedId.includes("/node_modules/three/examples/jsm/gpgpu/")
            ) {
              return "three-webgpu";
            }

            if (
              normalizedId.includes("/node_modules/three/") ||
              normalizedId.includes("/node_modules/@react-three/fiber/") ||
              normalizedId.includes("/node_modules/@react-three/drei/") ||
              normalizedId.includes("/node_modules/three-stdlib/")
            ) {
              return "three";
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
