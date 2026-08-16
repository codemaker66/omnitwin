import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createGeneratedFurnitureObject,
  GENERATED_FURNITURE_SLUGS,
} from "../src/components/meshes/generated/generatedFurnitureRegistry.js";
import { createGeneratedFurniturePartManifest } from "../src/components/meshes/generated/generatedFurniturePartManifest.js";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_ROOT = resolve(SCRIPT_DIRECTORY, "../../../artifacts/img2threejs");
for (const model of GENERATED_FURNITURE_SLUGS) {
  const outputDirectory = resolve(ARTIFACT_ROOT, model);
  const outputPath = resolve(outputDirectory, "parts.json");
  const manifest = createGeneratedFurniturePartManifest(
    model,
    createGeneratedFurnitureObject(model),
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}
