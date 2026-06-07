import { defineConfig, loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import {
  assertRequiredProductionEnv,
  getSentrySourceMapUploadConfig,
} from "./src/lib/production-env";

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
  const sentrySourceMapUpload = mode === "production"
    ? getSentrySourceMapUploadConfig(env)
    : null;
  const plugins: PluginOption[] = [react()];

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
          manualChunks: {
            "react-vendor": ["react", "react-dom", "react-router-dom"],
            "three": ["three", "@react-three/fiber", "@react-three/drei", "three-stdlib"],
            "spark": ["@sparkjsdev/spark"],
            "clerk": ["@clerk/react"],
          },
        },
      },
    },
  };
});
