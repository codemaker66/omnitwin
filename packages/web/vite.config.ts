import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import {
  assertRequiredProductionEnv,
  getSentrySourceMapUploadConfig,
  resolveWebClerkPublishableKey,
} from "./src/lib/production-env";
import {
  computeReceptionCaptureRuntimeEnvironmentDigest,
  computeReceptionCaptureRuntimeBuildDigest,
} from "./scripts/reception-capture-runtime-build-digest.mjs";

/** Local Reception splats are ignored evidence fixtures. Vite normally copies
 *  every public/ file into dist, so remove this one internal subtree from all
 *  build artifacts even when an operator builds from a populated workstation. */
function omitInternalReceptionSplats(): PluginOption {
  let outputDirectory = "";
  return {
    name: "omit-internal-reception-splats",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const target = resolve(outputDirectory, "splats", "reception");
      const fromOutput = relative(outputDirectory, target);
      if (
        outputDirectory === "" ||
        fromOutput === "" ||
        fromOutput === ".." ||
        fromOutput.startsWith(`..${sep}`) ||
        isAbsolute(fromOutput)
      ) {
        throw new Error("Refusing to remove an internal preview path outside the build output.");
      }
      await rm(target, { recursive: true, force: true });
    },
  };
}

type SentrySourceMapUpload = NonNullable<
  ReturnType<typeof getSentrySourceMapUploadConfig>
>;

function receptionCaptureRuntimeDigests(
  repositoryRoot: string,
  env: Record<string, string>,
): { build: string; environment: string } {
  const receptionCaptureEnvironment = {
    VITE_RECEPTION_MOBILE_ORIGIN: env.VITE_RECEPTION_MOBILE_ORIGIN,
    VITE_RECEPTION_QUALITY_ORIGIN: env.VITE_RECEPTION_QUALITY_ORIGIN,
  };
  return {
    build: computeReceptionCaptureRuntimeBuildDigest(repositoryRoot),
    environment: computeReceptionCaptureRuntimeEnvironmentDigest(receptionCaptureEnvironment),
  };
}

function createSentryPlugins(
  sourceMapUpload: SentrySourceMapUpload | null,
): PluginOption[] {
  if (sourceMapUpload === null) return [];

  return sentryVitePlugin({
    authToken: sourceMapUpload.authToken,
    org: sourceMapUpload.org,
    project: sourceMapUpload.project,
    release: {
      name: sourceMapUpload.release,
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
  });
}

function manualVendorChunk(id: string): string | undefined {
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
}

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
  const webRoot = fileURLToPath(new URL(".", import.meta.url));
  const env = loadEnv(mode, webRoot, "");
  assertRequiredProductionEnv(mode, env);
  const repositoryRoot = resolve(webRoot, "../..");
  const receptionCaptureRuntime = receptionCaptureRuntimeDigests(repositoryRoot, env);
  const clerkPublishableKey = resolveWebClerkPublishableKey(env) ?? "";
  const sentrySourceMapUpload = mode === "production"
    ? getSentrySourceMapUploadConfig(env)
    : null;

  return {
    plugins: [
      react(),
      omitInternalReceptionSplats(),
      ...createSentryPlugins(sentrySourceMapUpload),
    ],
    define: {
      __VENVIEWER_CLERK_PUBLISHABLE_KEY__: JSON.stringify(clerkPublishableKey),
      __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST__: JSON.stringify(
        receptionCaptureRuntime.build,
      ),
      __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST__: JSON.stringify(
        receptionCaptureRuntime.environment,
      ),
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
          manualChunks: manualVendorChunk,
        },
      },
    },
  };
});
