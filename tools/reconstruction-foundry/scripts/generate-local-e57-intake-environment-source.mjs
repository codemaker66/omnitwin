import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "../../..");
const MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  "configs/reconstruction/local-e57-intake-environment-v0.manifest.json",
);
const OUTPUT_PATH = resolve(
  REPOSITORY_ROOT,
  "tools/reconstruction-foundry/src/local-e57-intake-environment.generated.ts",
);
const TEMPORARY_PATH = `${OUTPUT_PATH}.tmp`;
const DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0";

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("The E57 manifest contains a non-finite number.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") {
    throw new Error("The E57 manifest contains a non-canonical value.");
  }
  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function computeEnvironmentSha256(payload) {
  return createHash("sha256")
    .update(DIGEST_DOMAIN, "ascii")
    .update(Buffer.from([0]))
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

export function verifyReviewedEnvironmentDocument(document) {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    !/^[a-f0-9]{64}$/u.test(document.environmentSha256 ?? "")
  ) {
    throw new Error("The checked-in E57 environment manifest is invalid.");
  }
  const { environmentSha256, ...payload } = document;
  if (environmentSha256 !== computeEnvironmentSha256(payload)) {
    throw new Error(
      "The checked-in E57 environment fingerprint does not match its canonical payload.",
    );
  }
  return document;
}

async function generateReviewedEnvironmentSource() {
  const document = verifyReviewedEnvironmentDocument(
    JSON.parse(await readFile(MANIFEST_PATH, "utf8")),
  );
  const source = [
    "/**",
    " * Generated from configs/reconstruction/local-e57-intake-environment-v0.manifest.json.",
    " * Do not edit by hand; regenerate after the checked-in manifest is reviewed.",
    " */",
    `export const LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_DOCUMENT: unknown = ${JSON.stringify(document, null, 2)};`,
    "",
  ].join("\n");

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await rm(TEMPORARY_PATH, { force: true });
  try {
    await writeFile(TEMPORARY_PATH, source, { encoding: "utf8", flag: "wx" });
    await rename(TEMPORARY_PATH, OUTPUT_PATH);
  } finally {
    await rm(TEMPORARY_PATH, { force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  await generateReviewedEnvironmentSource();
}
