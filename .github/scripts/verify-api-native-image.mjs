import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

// Run only in the final API image, with this file mounted read-only at /tmp.
// No API boot, database, credentials, network access, fixture files or exploit
// samples are needed. The caller should additionally use Docker --network=none.
// The two large, uniform valid WebPs exercise the real 70,000,000-pixel limit;
// allow 2 GiB of container memory and at least 180 seconds for the whole run.
const report = {
  schema: "venviewer/native-image-check/1",
  startedAt: new Date().toISOString(),
  status: "running",
  limits: { sharp: "0.35.4", libvips: "8.18.6", libheif: "1.23.2", inputPixels: 70_000_000 },
  cases: [],
  limitations: [
    "Generated benign images and bounded truncation/container checks; no exploit reproduction or fuzzing.",
    "WebP inspector behavior and the loaded libheif version are checked; HEIF decoding is not exercised.",
    "No network, database, authentication, HTTP integration or production deployment qualification.",
    "The caller must retain the actual image ID/digest with this receipt; a supplied tag alone is not image provenance.",
  ],
};

function emit(kind, value) {
  process.stdout.write(`${JSON.stringify({ kind, ...value })}\n`);
}

function errorDetails(error) {
  return { name: error?.name ?? typeof error, code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error),
    cause: error?.cause instanceof Error ? error.cause.message : null };
}

function assertVersionAtLeast(actual, minimum, label) {
  assert.equal(typeof actual, "string", `${label} version is missing`);
  assert.match(actual, /^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/, `${label} must report a stable semantic version`);
  const current = actual.split("+")[0].split(".").map(Number);
  const required = minimum.split(".").map(Number);
  let comparison = 0;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== required[index]) { comparison = current[index] > required[index] ? 1 : -1; break; }
  }
  assert.ok(comparison >= 0, `${label} ${actual} is below required ${minimum}`);
}

async function packageAtEntry(entry, expectedName) {
  let directory = dirname(await realpath(entry));
  while (directory !== dirname(directory)) {
    const manifestPath = join(directory, "package.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.name === expectedName) return { directory, manifestPath, manifest };
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    directory = dirname(directory);
  }
  throw new Error(`Could not find ${expectedName} package manifest for ${entry}`);
}

function assertShippedPath(path) {
  const fromApp = relative("/app", path);
  assert.ok(fromApp !== ".." && !fromApp.startsWith(`..${sep}`) && !fromApp.startsWith(sep),
    `Resolved package is outside the final /app deployment: ${path}`);
}

async function runCase(name, action) {
  const start = performance.now();
  try {
    const evidence = await action();
    const result = { name, status: "passed", durationMs: Math.round(performance.now() - start), ...evidence };
    report.cases.push(result);
    emit("case", result);
  } catch (error) {
    const result = { name, status: "failed", durationMs: Math.round(performance.now() - start), error: errorDetails(error) };
    report.cases.push(result);
    emit("case", result);
  }
}

function bytesEvidence(bytes) {
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function primaryChunk(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + length <= bytes.length, "Generated fixture has an invalid chunk table");
    if (kind === "VP8 " || kind === "VP8L") return { kind, offset, length, payload: offset + 8 };
    offset += 8 + length + length % 2;
  }
  throw new Error("Generated WebP contains no primary image chunk");
}

async function main() {
  assert.equal(process.platform, "linux", "This qualification must run in the actual final Linux API image");
  assert.equal(process.arch, "x64", "Qualify the deployed linux/amd64 architecture");
  assert.equal(process.cwd(), "/app", "Run from the final image WORKDIR /app");
  const apiManifest = JSON.parse(await readFile("/app/package.json", "utf8"));
  assert.equal(apiManifest.name, "@omnitwin/api", "Mounted checkout is not the deployed API package");
  const apiRequire = createRequire("/app/package.json");
  const foundryEntry = await realpath(apiRequire.resolve("@omnitwin/reconstruction-foundry"));
  assert.ok(foundryEntry.endsWith("/dist/index.js"), "Use node --conditions=omnitwin-dist; TS source is not runtime evidence");
  assertShippedPath(foundryEntry);
  const foundry = await packageAtEntry(foundryEntry, "@omnitwin/reconstruction-foundry");
  const inspectorPath = await realpath(join(dirname(foundryEntry), "webp.js"));
  assertShippedPath(inspectorPath);
  // This is the exact dependency resolution used by dist/webp.js, not a root,
  // globally installed, downloaded or host-mounted Sharp copy.
  const foundryRequire = createRequire(inspectorPath);
  const sharpEntry = await realpath(foundryRequire.resolve("sharp"));
  assertShippedPath(sharpEntry);
  const sharpPackage = await packageAtEntry(sharpEntry, "sharp");
  const sharpModule = await import(pathToFileURL(sharpEntry).href);
  const sharp = sharpModule.default;
  assert.equal(typeof sharp, "function", "Resolved Sharp module has no callable default export");
  const { inspectWebpBytes, FOUNDRY_WEBP_MAX_BYTES, getImageDecoderRuntime } = await import(pathToFileURL(inspectorPath).href);
  assert.equal(typeof inspectWebpBytes, "function");
  assert.equal(FOUNDRY_WEBP_MAX_BYTES, 32 * 1024 * 1024, "Review the harness if the shipped byte contract changes");

  const previousExcludeNetwork = process.report.excludeNetwork;
  let runtimeReport;
  try {
    process.report.excludeNetwork = true;
    runtimeReport = process.report.getReport();
  } finally {
    process.report.excludeNetwork = previousExcludeNetwork;
  }
  const libcLoaders = (await readdir("/lib")).filter(name => name.startsWith("ld-musl-") && name.endsWith(".so.1"));
  let muslPackageVersion = null;
  if (libcLoaders.length > 0) {
    const installed = await readFile("/lib/apk/db/installed", "utf8");
    const musl = installed.split(/\n\n/).find(block => /^P:musl$/m.test(block));
    muslPackageVersion = musl?.match(/^V:(.+)$/m)?.[1] ?? null;
    assert.ok(muslPackageVersion, "Alpine musl loader exists but its installed package version is missing");
  }
  const libc = runtimeReport.header.glibcVersionRuntime
    ? { family: "glibc", runtime: runtimeReport.header.glibcVersionRuntime, compiler: runtimeReport.header.glibcVersionCompiler ?? null }
    : libcLoaders.length > 0 ? { family: "musl", packageVersion: muslPackageVersion, loaders: libcLoaders.map(name => `/lib/${name}`) } : { family: "unknown" };
  const nativeObjects = runtimeReport.sharedObjects.filter(path => /sharp|vips|heif|webp|ld-musl|libc\.so/i.test(path));
  const sharpCacheBefore = sharp.cache();
  const sharpConcurrencyBefore = sharp.concurrency();
  // Bound validation resources without changing any image or decoder limit.
  sharp.cache(false);
  sharp.concurrency(1);
  report.runtime = {
    platform: process.platform, architecture: process.arch, node: process.version,
    nodeVersions: process.versions, execPath: process.execPath, execArgv: process.execArgv,
    uid: process.getuid(), gid: process.getgid(), libc,
    osRelease: (await readFile("/etc/os-release", "utf8")).trim(),
    packages: {
      api: { name: apiManifest.name, version: apiManifest.version, manifestPath: "/app/package.json" },
      foundry: { name: foundry.manifest.name, version: foundry.manifest.version, manifestPath: foundry.manifestPath,
        entry: foundryEntry, inspector: inspectorPath, inspectorSha256: createHash("sha256").update(await readFile(inspectorPath)).digest("hex") },
      sharp: { version: sharpPackage.manifest.version, manifestPath: sharpPackage.manifestPath, entry: sharpEntry },
    },
    nativeVersions: sharp.versions, nativeObjects,
    validationResources: { cacheBefore: sharpCacheBefore, concurrencyBefore: sharpConcurrencyBefore,
      cache: sharp.cache(), concurrency: sharp.concurrency() },
  };
  emit("runtime", report.runtime);
  assertVersionAtLeast(sharpPackage.manifest.version, report.limits.sharp, "Sharp package");
  assertVersionAtLeast(sharp.versions.sharp, report.limits.sharp, "Loaded Sharp");
  assert.equal(sharp.versions.sharp, sharpPackage.manifest.version, "Loaded Sharp and package versions differ");
  assertVersionAtLeast(sharp.versions.heif, report.limits.libheif, "Loaded libheif");
  assertVersionAtLeast(sharp.versions.vips, report.limits.libvips, "Loaded libvips");
  assert.equal(libc.family, "musl", "Qualify the deployed Alpine musl runtime");
  const startupDiagnostic = getImageDecoderRuntime();
  assert.deepEqual(startupDiagnostic.versions, sharp.versions, "API startup diagnostic must report the actually loaded decoder");
  assert.equal(startupDiagnostic.architecture, process.arch);
  assert.equal(startupDiagnostic.libc.family, libc.family);
  report.startupDiagnostic = startupDiagnostic;

  const uniform = (width, height, lossless) => sharp({ create: {
    width, height, channels: 3, background: { r: 36, g: 48, b: 65 },
  } }).webp({ lossless, quality: 82, effort: 0 }).toBuffer();
  const reject = async (bytes, sizeBytes, code) => {
    let caught;
    try { await inspectWebpBytes(bytes, sizeBytes); } catch (error) { caught = error; }
    assert.ok(caught instanceof Error, `Expected ${code}; inspector accepted the image`);
    assert.equal(caught.name, "FoundryIntegrityError");
    assert.equal(caught.code, code, `Unexpected inspector error: ${caught.message}`);
    return { ...bytesEvidence(bytes), declaredInputBytes: sizeBytes, rejected: errorDetails(caught) };
  };

  const lossless = await uniform(64, 32, true);
  const lossy = await uniform(64, 32, false);
  for (const [name, bytes, encoding] of [["accepted lossless WebP", lossless, "VP8L"], ["accepted lossy WebP", lossy, "VP8"]]) {
    await runCase(name, async () => {
      const dimensions = await inspectWebpBytes(bytes, bytes.length);
      assert.deepEqual(dimensions, { width: 64, height: 32, encoding });
      return { ...bytesEvidence(bytes), dimensions };
    });
  }
  await runCase("wrong-format generated PNG", async () => {
    const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#243041" } }).png().toBuffer();
    return reject(png, png.length, "INVALID_WEBP_HEADER");
  });
  await runCase("truncated RIFF header", () => reject(lossless.subarray(0, 11), 11, "INVALID_WEBP_HEADER"));
  await runCase("input byte count differs from buffer", () => reject(lossless, lossless.length + 1, "INVALID_WEBP_HEADER"));
  await runCase("length-consistent WebP exceeds 32 MiB cap", async () => {
    // A valid unknown RIFF chunk pads a real image past the byte cap. Keeping
    // actual and declared lengths equal isolates this guard from size mismatch.
    const paddedSize = FOUNDRY_WEBP_MAX_BYTES + 2;
    const padded = Buffer.alloc(paddedSize);
    lossless.copy(padded);
    padded.writeUInt32LE(padded.length - 8, 4);
    padded.write("JUNK", lossless.length, "ascii");
    padded.writeUInt32LE(padded.length - lossless.length - 8, lossless.length + 4);
    return reject(padded, padded.length, "INVALID_WEBP_HEADER");
  });
  await runCase("RIFF declared size mismatch", async () => {
    const changed = Buffer.from(lossless);
    changed.writeUInt32LE(lossless.length - 4, 4); // Same boundary mutation as formats.test.ts.
    return reject(changed, changed.length, "WEBP_SIZE_MISMATCH");
  });
  await runCase("truncated chunk at the container boundary", async () => {
    const changed = Buffer.from(lossless.subarray(0, lossless.length - 2));
    changed.writeUInt32LE(changed.length - 8, 4);
    return reject(changed, changed.length, "INVALID_WEBP_CHUNK");
  });
  await runCase("truncated encoded stream with complete container framing", async () => {
    // Retain only the generated lossy image's real 10-byte frame header; repair
    // container lengths so the shipped full native decode must reject it.
    const chunk = primaryChunk(lossy);
    assert.equal(chunk.kind, "VP8 ");
    assert.ok(chunk.length > 10);
    const changed = Buffer.concat([lossy.subarray(0, 12), lossy.subarray(chunk.offset, chunk.payload + 10)]);
    changed.writeUInt32LE(changed.length - 8, 4);
    changed.writeUInt32LE(10, 16);
    return reject(changed, changed.length, "WEBP_DECODE_FAILED");
  });
  await runCase("valid generated animation is not an allowed panorama", async () => {
    const width = 16, frameHeight = 8, channels = 3;
    const raw = Buffer.alloc(width * frameHeight * 2 * channels);
    raw.fill(36, 0, width * frameHeight * channels);
    raw.fill(180, width * frameHeight * channels);
    const animated = await sharp(raw, { raw: { width, height: frameHeight * 2, channels, pageHeight: frameHeight } })
      .webp({ lossless: true, effort: 0, loop: 0, delay: [100, 100] }).toBuffer();
    const metadata = await sharp(animated, { animated: true }).metadata();
    assert.equal(metadata.pages, 2, "Generated animation must actually contain two frames");
    return { ...await reject(animated, animated.length, "UNSUPPORTED_WEBP_ANIMATION"), generatedPages: metadata.pages };
  });
  await runCase("accepted exact 70,000,000-pixel boundary", async () => {
    const bytes = await uniform(10_000, 7_000, true);
    const dimensions = await inspectWebpBytes(bytes, bytes.length);
    assert.equal(dimensions.width, 10_000);
    assert.equal(dimensions.height, 7_000);
    assert.equal(dimensions.width * dimensions.height, report.limits.inputPixels);
    return { ...bytesEvidence(bytes), dimensions, pixels: dimensions.width * dimensions.height };
  });
  await runCase("valid image above 70,000,000 pixels is rejected", async () => {
    const bytes = await uniform(10_000, 7_001, true);
    const evidence = await reject(bytes, bytes.length, "WEBP_DECODE_FAILED");
    assert.match(evidence.rejected.cause ?? "", /pixel limit/i, "Rejection must be the pixel cap, not unrelated corruption");
    return { ...evidence, generatedDimensions: { width: 10_000, height: 7_001 }, pixels: 70_010_000 };
  });
  assert.equal(report.cases.length, 12, "All declared checks must run");
  report.status = report.cases.every(result => result.status === "passed") ? "passed" : "failed";
}

try { await main(); } catch (error) { report.status = "failed"; report.error = errorDetails(error); }
report.completedAt = new Date().toISOString();
report.passed = report.cases.filter(result => result.status === "passed").length;
report.failed = report.cases.filter(result => result.status === "failed").length;
report.resourceUsage = process.resourceUsage();
emit("receipt", report);
if (report.status !== "passed") process.exitCode = 1;
