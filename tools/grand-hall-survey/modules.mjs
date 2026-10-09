// Resolves the libraries these tools use from the workspace packages that
// already depend on them, so the survey needs no install of its own.
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const web = createRequire(new URL("../../packages/web/package.json", import.meta.url));
const foundry = createRequire(new URL("../../packages/reconstruction-foundry/package.json", import.meta.url));
const drei = createRequire(web.resolve("@react-three/drei/package.json"));

/** Imports an ES module resolved by one of the workspace's resolvers. */
async function load(resolver, specifier) {
  return import(pathToFileURL(resolver.resolve(specifier)).href);
}

/** Playwright's browsers (a CommonJS package: its exports arrive as the default). */
export const playwright = async () => {
  const module = await load(web, "@playwright/test");
  return module.chromium !== undefined ? module : module.default;
};
export const three = () => load(web, "three");
export const meshBvh = () => load(drei, "three-mesh-bvh");
export const meshoptimizer = () => load(foundry, "meshoptimizer");
export const gltfCore = () => load(foundry, "@gltf-transform/core");
export const gltfExtensions = () => load(foundry, "@gltf-transform/extensions");
/** The directory three is installed in, for the measuring page's import map. */
export const threeDirectory = () => dirname(dirname(web.resolve("three")));
