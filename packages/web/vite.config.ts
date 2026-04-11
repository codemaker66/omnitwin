import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ---------------------------------------------------------------------------
// Vite config — punch list #16 bundle splitting
//
// Three explicit vendor chunks let the editor's heavy 3D dependencies stay
// out of every other route's initial download:
//   - react-vendor: react/dom/router (every route needs it; cacheable)
//   - three:        three.js + R3F + drei + stdlib (only the editor needs it)
//   - clerk:        @clerk/clerk-react (login, register, dashboard need it;
//                   anonymous /hallkeeper/:id and /editor guests do NOT)
//
// Page chunks (one per route) emit automatically because router.tsx wraps
// every page in React.lazy(() => import(...)). Rollup creates a chunk per
// dynamic-import boundary.
// ---------------------------------------------------------------------------

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "three": ["three", "@react-three/fiber", "@react-three/drei", "three-stdlib"],
          "clerk": ["@clerk/clerk-react"],
        },
      },
    },
  },
});
