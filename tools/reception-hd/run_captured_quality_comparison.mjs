#!/usr/bin/env node

/**
 * Replay the two frozen Reception Room candidates through the real local page.
 *
 * This runner is deliberately authority-none. It verifies exact local inputs,
 * permits browser traffic to three loopback origins only, captures two repeats
 * of six reviewed views, and emits input for the Foundry report compiler. It
 * never selects a physical or visual-quality winner.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOTAL_CAPTURES = 24;
const VIEWPORT = Object.freeze({ widthPx: 1200, heightPx: 900, deviceScaleFactor: 1 });
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u;

export const QUALITY_PROFILE = Object.freeze({
  candidateId: "quality",
  profileId: "quality-sog-fine-v1",
  expectedGaussianCount: 2_002_009,
  assets: Object.freeze([
    Object.freeze({ fileName: "0_15_0_0.sog", sizeBytes: 10_279_160, sha256: "111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368" }),
    Object.freeze({ fileName: "0_1_0_5.sog", sizeBytes: 10_047_085, sha256: "559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1" }),
    Object.freeze({ fileName: "0_6_0_0.sog", sizeBytes: 10_368_228, sha256: "182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238" }),
    Object.freeze({ fileName: "0_7_0_0.sog", sizeBytes: 5_040_628, sha256: "3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf" }),
  ]),
});

export const MOBILE_PROFILE = Object.freeze({
  candidateId: "mobile",
  profileId: "mobile-spz-fine-v1",
  expectedGaussianCount: 1_978_258,
  assets: Object.freeze([
    Object.freeze({ fileName: "0_13_0_0.spz", sizeBytes: 8_620_036, sha256: "82bbbd033609f99f05c45c177ada552b87b905255ac515014f75561c292bf55c" }),
    Object.freeze({ fileName: "0_3_0_0.spz", sizeBytes: 9_199_830, sha256: "13200d905d50160034538e705b60c549aaf82348679791f801efa3f9e52171b3" }),
    Object.freeze({ fileName: "0_7_0_1.spz", sizeBytes: 8_768_751, sha256: "5d4e274df25aae56a8989416e1078fc86912b4c7b053b1c7d3c25a6e484a80df" }),
    Object.freeze({ fileName: "0_8_0_0.spz", sizeBytes: 3_422_064, sha256: "925c90a714abf7ed9cacea65a4abf4de1ff225ead2ef503aadcf836068ab62ed" }),
  ]),
});

export const REVIEW_VIEWS = Object.freeze([
  Object.freeze({ viewId: "overview", position: [-2.408, 1.449, 9.752], target: [-2.652, -5.022, -11.676], up: [0, 1, 0], verticalFovDegrees: 48, nearClip: 0.1, farClip: 120 }),
  Object.freeze({ viewId: "timber-left", position: [-2.408, 1.449, 9.752], target: [-6.5, -3.5, -11.5], up: [0, 1, 0], verticalFovDegrees: 25, nearClip: 0.1, farClip: 120 }),
  Object.freeze({ viewId: "timber-right", position: [-2.408, 1.449, 9.752], target: [0, -3.5, -11.5], up: [0, 1, 0], verticalFovDegrees: 25, nearClip: 0.1, farClip: 120 }),
  Object.freeze({ viewId: "floor-surface", position: [-2.408, 1.449, 9.752], target: [-3, -5, -4], up: [0, 1, 0], verticalFovDegrees: 28, nearClip: 0.1, farClip: 120 }),
  Object.freeze({ viewId: "ceiling-moulding", position: [-2.408, 1.449, 9.752], target: [-3, 0, -11.5], up: [0, 1, 0], verticalFovDegrees: 24, nearClip: 0.1, farClip: 120 }),
  Object.freeze({ viewId: "column-skirting", position: [-2.408, 1.449, 9.752], target: [1, -3, -10], up: [0, 1, 0], verticalFovDegrees: 24, nearClip: 0.1, farClip: 120 }),
]);

const VALUE_OPTIONS = new Map([
  ["--repo-root", "repoRoot"],
  ["--quality-root", "qualityRoot"],
  ["--mobile-root", "mobileRoot"],
  ["--output-root", "outputRoot"],
  ["--request-id", "requestId"],
]);
const FLAG_OPTIONS = new Map([
  ["--help", "help"],
  ["--verify-only", "verifyOnly"],
]);

export function parseCliArguments(argv) {
  const parsed = { help: false, verifyOnly: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (seen.has(token)) throw new Error(`duplicate option: ${token}`);
    if (FLAG_OPTIONS.has(token)) {
      seen.add(token);
      parsed[FLAG_OPTIONS.get(token)] = true;
      continue;
    }
    const key = VALUE_OPTIONS.get(token);
    if (key === undefined) throw new Error(token?.startsWith("--") ? `unknown option: ${token}` : `unexpected positional argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`option ${token} requires exactly one value`);
    seen.add(token);
    parsed[key] = value;
    index += 1;
  }
  if (parsed.help) {
    if (argv.length !== 1) throw new Error("--help must be used alone");
    return parsed;
  }
  for (const [option, key] of VALUE_OPTIONS) {
    if (parsed[key] === undefined) throw new Error(`missing required option: ${option}`);
  }
  for (const option of ["--repo-root", "--quality-root", "--mobile-root", "--output-root"]) {
    const key = VALUE_OPTIONS.get(option);
    if (!path.isAbsolute(parsed[key])) throw new Error(`${option} must be an absolute path`);
    parsed[key] = path.normalize(parsed[key]);
  }
  if (!REQUEST_ID.test(parsed.requestId)) throw new Error("--request-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,95}");
  return parsed;
}

function pathIsInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifyPinnedProfile(root, candidateId, assets) {
  if (!path.isAbsolute(root)) throw new Error(`${candidateId} root must be absolute`);
  const rootInfo = await lstat(root).catch(() => null);
  if (rootInfo === null || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`${candidateId} root is not a real directory: ${root}`);
  const canonicalRoot = await realpath(root);
  const labels = new Set();
  const bindings = [];
  for (const asset of assets) {
    if (labels.has(asset.fileName)) throw new Error(`${candidateId} source name is duplicated: ${asset.fileName}`);
    labels.add(asset.fileName);
    if (path.basename(asset.fileName) !== asset.fileName || asset.fileName === "." || asset.fileName === "..") throw new Error(`${candidateId} source path escapes its named root: ${asset.fileName}`);
    const sourcePath = path.resolve(canonicalRoot, asset.fileName);
    if (!pathIsInside(canonicalRoot, sourcePath)) throw new Error(`${candidateId} source path escapes its named root: ${asset.fileName}`);
    const info = await lstat(sourcePath).catch(() => null);
    if (info === null) throw new Error(`${candidateId} source missing: ${asset.fileName}`);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${candidateId} source must be a regular non-symlink file: ${asset.fileName}`);
    const canonicalSource = await realpath(sourcePath);
    if (!pathIsInside(canonicalRoot, canonicalSource)) throw new Error(`${candidateId} source path escapes its named root: ${asset.fileName}`);
    if (info.size !== asset.sizeBytes) throw new Error(`${candidateId} source size mismatch for ${asset.fileName}: expected ${asset.sizeBytes}, observed ${info.size}`);
    const digest = await sha256File(canonicalSource);
    if (digest !== asset.sha256.toLowerCase()) throw new Error(`${candidateId} source SHA-256 mismatch for ${asset.fileName}: expected ${asset.sha256}, observed ${digest}`);
    const after = await stat(canonicalSource);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error(`${candidateId} source changed while it was being verified: ${asset.fileName}`);
    bindings.push({ candidateId, fileName: asset.fileName, sizeBytes: info.size, sha256: digest });
  }
  return bindings;
}

function progress(phase, completedCaptures) {
  process.stderr.write(`CAPTURE_PROGRESS ${JSON.stringify({ phase, completedCaptures, totalCaptures: TOTAL_CAPTURES })}\n`);
}

function sourceSnapshot(bindings, profileId) {
  return bindings.map((binding) => ({ profileId, pathLabel: binding.fileName, sizeBytes: binding.sizeBytes, sha256: binding.sha256 }));
}

function sameBindings(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function waitForWatchdogMessage(child, nonce, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`cleanup watchdog did not report ${expectedType}`)), 10_000);
    const onMessage = (message) => {
      if (message?.nonce === nonce && message?.type === expectedType) finish();
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => finish(new Error(`cleanup watchdog exited before ${expectedType}: ${code ?? signal}`));
    function finish(error) {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error === undefined) resolve();
      else reject(error);
    }
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForWatchdogExit(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("cleanup watchdog did not exit")), 10_000);
    const onError = (error) => finish(error);
    const onExit = (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`cleanup watchdog exited unsuccessfully: ${code ?? signal}`));
    };
    function finish(error) {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error === undefined) resolve();
      else reject(error);
    }
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function sendWatchdogMessage(child, message) {
  return new Promise((resolve, reject) => {
    child.send(message, (error) => {
      if (error === null || error === undefined) resolve();
      else reject(error);
    });
  });
}

export async function startCleanupWatchdog(tempRoot) {
  const nonce = randomBytes(16).toString("hex");
  const markerPath = path.join(tempRoot, ".captured-quality-owner.json");
  await writeFile(markerPath, JSON.stringify({ pid: process.pid, nonce }), { flag: "wx" });
  const watchdogSource = String.raw`
    const fs = require("node:fs");
    const [rawPid, target, expectedNonce] = process.argv.slice(1);
    const ownerPid = Number(rawPid);
    const marker = require("node:path").join(target, ".captured-quality-owner.json");
    let released = false;
    const isOwned = () => {
      try {
        const value = JSON.parse(fs.readFileSync(marker, "utf8"));
        return value.pid === ownerPid && value.nonce === expectedNonce;
      } catch { return false; }
    };
    process.on("message", (message) => {
      if (message?.nonce !== expectedNonce) return;
      if (message?.type === "release" || message?.type === "abort") {
        released = true;
        process.exit(0);
      }
    });
    process.on("disconnect", () => {
      if (!released && isOwned()) fs.rmSync(target, { recursive: true, force: true });
      process.exit(0);
    });
    process.send({ type: "ready", nonce: expectedNonce });
  `;
  const watchdog = spawn(
    process.execPath,
    ["-e", watchdogSource, String(process.pid), tempRoot, nonce],
    {
      detached: true,
      shell: false,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    },
  );
  await waitForWatchdogMessage(watchdog, nonce, "ready");
  let stopped = false;
  return {
    markerPath,
    async stop(mode = "abort") {
      if (stopped) return;
      const exited = waitForWatchdogExit(watchdog);
      await sendWatchdogMessage(watchdog, { type: mode, nonce });
      await exited;
      stopped = true;
    },
  };
}

function waitMilliseconds(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function renameDirectoryWithRetry(
  source,
  target,
  {
    renameDirectory = rename,
    pathExists = exists,
    wait = waitMilliseconds,
    signal,
  } = {},
) {
  const retryDelaysMs = [0, 25, 75, 150, 300];
  for (const [attempt, delayMs] of retryDelaysMs.entries()) {
    if (delayMs > 0) await wait(delayMs);
    throwIfAborted(signal);
    if (await pathExists(target)) throw new Error(`final output appeared during replay and will not be replaced: ${target}`);
    throwIfAborted(signal);
    try {
      await renameDirectory(source, target);
      return { abortedAfterRename: signal?.aborted === true };
    } catch (error) {
      const retryable = error?.code === "EPERM" || error?.code === "EBUSY";
      if (!retryable || attempt === retryDelaysMs.length - 1) throw error;
    }
  }
}

async function directoryIdentity(directory) {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory()) throw new Error(`atomic output is not a directory: ${directory}`);
  return {
    device: info.dev,
    inode: info.ino,
    birthtimeNanoseconds: info.birthtimeNs,
  };
}

function sameDirectoryIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.birthtimeNanoseconds === right.birthtimeNanoseconds;
}

async function removeJustCommittedOwnedFinal(finalRoot, expectedIdentity) {
  const observedIdentity = await directoryIdentity(finalRoot).catch(() => null);
  if (observedIdentity === null || !sameDirectoryIdentity(observedIdentity, expectedIdentity)) {
    throw new Error(
      `cancel cleanup refused to remove a final directory not owned by this replay: ${finalRoot}`,
    );
  }
  await rm(finalRoot, { recursive: true, force: true });
}

export async function commitAtomicOutputDirectory(
  tempRoot,
  finalRoot,
  watchdog,
  signal,
  renameOptions = {},
) {
  throwIfAborted(signal);
  const ownedDirectoryIdentity = await directoryIdentity(tempRoot);
  throwIfAborted(signal);
  await watchdog.stop("release");
  await rm(watchdog.markerPath, { force: true });
  throwIfAborted(signal);
  const renameResult = await renameDirectoryWithRetry(tempRoot, finalRoot, {
    ...renameOptions,
    signal,
  });
  const observedFinalIdentity = await directoryIdentity(finalRoot);
  if (!sameDirectoryIdentity(observedFinalIdentity, ownedDirectoryIdentity)) {
    throw new Error(`atomic output identity changed during commit: ${finalRoot}`);
  }
  if (renameResult.abortedAfterRename || signal?.aborted === true) {
    await removeJustCommittedOwnedFinal(finalRoot, ownedDirectoryIdentity);
    throw abortError(signal);
  }
}

function contentType(fileName) {
  return fileName.endsWith(".sog") ? "application/octet-stream" : "application/octet-stream";
}

function parseRange(header, size) {
  if (header === undefined) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1), partial: true };
}

async function startAssetServer(root, assets) {
  const canonicalRoot = await realpath(root);
  const allowed = new Map(assets.map((asset) => [`/${asset.fileName}`, asset]));
  const telemetry = { requestCount: 0, servedBytes: 0 };
  const server = createServer(async (request, response) => {
    telemetry.requestCount += 1;
    try {
      const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
      const asset = allowed.get(decodeURIComponent(parsed.pathname));
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Range");
      response.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range");
      if (request.method === "OPTIONS" && asset !== undefined) {
        response.writeHead(204).end();
        return;
      }
      if (asset === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
        response.writeHead(asset === undefined ? 404 : 405, { "Cache-Control": "no-store" }).end();
        return;
      }
      const sourcePath = path.resolve(canonicalRoot, asset.fileName);
      if (!pathIsInside(canonicalRoot, sourcePath)) throw new Error("allowlisted asset escaped its root");
      const info = await stat(sourcePath);
      if (info.size !== asset.sizeBytes) throw new Error(`asset changed before serving: ${asset.fileName}`);
      const range = parseRange(request.headers.range, info.size);
      if (range === null) {
        response.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        return;
      }
      const bytes = range.end - range.start + 1;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", contentType(asset.fileName));
      response.setHeader("Content-Length", String(bytes));
      if (range.partial) response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
      response.writeHead(range.partial ? 206 : 200);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      telemetry.servedBytes += bytes;
      const stream = createReadStream(sourcePath, { start: range.start, end: range.end });
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store" });
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("loopback asset server did not expose a TCP port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    telemetry,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function helpText() {
  return [
    "Reception captured-quality comparison replay",
    "",
    "Required (all values must be explicit absolute paths):",
    "  --repo-root PATH --quality-root PATH --mobile-root PATH",
    "  --output-root PATH --request-id SAFE_ID",
    "",
    "Optional:",
    "  --verify-only  Verify the eight frozen source identities; do not open a browser.",
    "  --help         Show this text.",
  ].join("\n");
}

async function exists(target) {
  return lstat(target).then(() => true, () => false);
}

async function startViteServer(webRoot, qualityOrigin, mobileOrigin) {
  const webRequire = createRequire(path.join(webRoot, "package.json"));
  const viteEntry = webRequire.resolve("vite");
  const { createServer: createViteServer } = await import(pathToFileURL(viteEntry).href);
  const previousQualityOrigin = process.env.VITE_RECEPTION_QUALITY_ORIGIN;
  const previousMobileOrigin = process.env.VITE_RECEPTION_MOBILE_ORIGIN;
  process.env.VITE_RECEPTION_QUALITY_ORIGIN = qualityOrigin;
  process.env.VITE_RECEPTION_MOBILE_ORIGIN = mobileOrigin;
  let server;
  try {
    server = await createViteServer({
      root: webRoot,
      appType: "spa",
      clearScreen: false,
      logLevel: "silent",
      plugins: [{
        name: "captured-quality-loopback-only-index",
        enforce: "pre",
        transformIndexHtml(html) {
          return html.replace(
            /\s*<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/giu,
            "",
          );
        },
      }],
      server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false },
    });
    await server.listen();
  } finally {
    if (previousQualityOrigin === undefined) delete process.env.VITE_RECEPTION_QUALITY_ORIGIN;
    else process.env.VITE_RECEPTION_QUALITY_ORIGIN = previousQualityOrigin;
    if (previousMobileOrigin === undefined) delete process.env.VITE_RECEPTION_MOBILE_ORIGIN;
    else process.env.VITE_RECEPTION_MOBILE_ORIGIN = previousMobileOrigin;
  }
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    await server.close();
    throw new Error("Vite did not expose a loopback TCP port");
  }
  return { origin: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error("captured-quality replay cancelled");
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) throw abortError(signal);
}

async function raceAbort(promise, signal) {
  throwIfAborted(signal);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function parseNumberList(value, expectedLength, label) {
  const parsed = String(value ?? "").split(",").map(Number);
  if (parsed.length !== expectedLength || parsed.some((entry) => !Number.isFinite(entry))) throw new Error(`${label} is missing or invalid`);
  return parsed;
}

function percentile(values, proportion) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(proportion * ordered.length) - 1));
  return ordered[index];
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG" || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("Playwright did not return a valid PNG");
  return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) };
}

function normalizedNetworkOrigin(url) {
  if (url.protocol === "ws:") return `http://${url.host}`;
  if (url.protocol === "wss:") return `https://${url.host}`;
  return url.origin;
}

async function captureMatrix({ webRoot, webOrigin, qualityOrigin, mobileOrigin, tempRoot, signal }) {
  const webRequire = createRequire(path.join(webRoot, "package.json"));
  const { chromium } = webRequire("@playwright/test");
  const browser = await raceAbort(chromium.launch({ headless: true }), signal);
  const allowedOrigins = new Set([webOrigin, qualityOrigin, mobileOrigin]);
  const externalRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  const captures = [];
  const cameraByView = new Map();
  let activeAssetRequests = [];
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: VIEWPORT.widthPx, height: VIEWPORT.heightPx },
      deviceScaleFactor: VIEWPORT.deviceScaleFactor,
      colorScheme: "dark",
      locale: "en-GB",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (!allowedOrigins.has(requestUrl.origin)) {
        externalRequests.push(route.request().url());
        await route.abort("blockedbyclient");
        return;
      }
      if (requestUrl.origin === qualityOrigin || requestUrl.origin === mobileOrigin) activeAssetRequests.push(requestUrl.href);
      await route.continue();
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("websocket", (socket) => {
      const socketUrl = new URL(socket.url());
      if (!allowedOrigins.has(normalizedNetworkOrigin(socketUrl))) externalRequests.push(socket.url());
    });

    let completed = 0;
    for (const profile of [QUALITY_PROFILE, MOBILE_PROFILE]) {
      const expectedOrigin = profile.candidateId === "quality" ? qualityOrigin : mobileOrigin;
      const expectedUrls = new Set(profile.assets.map((asset) => `${expectedOrigin}/${asset.fileName}`));
      const expectedBytes = profile.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
      for (const view of REVIEW_VIEWS) {
        throwIfAborted(signal);
        activeAssetRequests = [];
        const startedAt = performance.now();
        const url = `${webOrigin}/dev/reception-quality-preflight?${new URLSearchParams({ candidate: profile.candidateId, view: view.viewId, capture: "1" })}`;
        await raceAbort(page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }), signal);
        await raceAbort(page.waitForFunction(
          ({ candidateId, expectedCount, viewId }) => {
            const root = document.querySelector(".lh-root");
            const scene = document.querySelector(".lh-scene");
            return root instanceof HTMLElement && scene instanceof HTMLElement
              && root.dataset.preflightCandidateId === candidateId
              && root.dataset.preflightReviewViewId === viewId
              && scene.dataset.sceneState === "live"
              && scene.dataset.cameraReady === "true"
              && scene.dataset.loadedSourceCount === "4"
              && scene.dataset.loadedSplatCount === String(expectedCount);
          },
          { candidateId: profile.candidateId, expectedCount: profile.expectedGaussianCount, viewId: view.viewId },
          { timeout: 90_000 },
        ), signal);
        const liveAt = performance.now();
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
        const scene = await page.locator(".lh-scene").evaluate((element) => ({ ...element.dataset }));
        const rootDataset = await page.locator(".lh-root").evaluate((element) => ({ ...element.dataset }));
        if (externalRequests.length !== 0) throw new Error(`blocked non-loopback browser request: ${externalRequests[0]}`);
        if (pageErrors.length !== 0) throw new Error(`page error: ${pageErrors[0]}`);
        if (consoleErrors.length !== 0) throw new Error(`browser console error: ${consoleErrors[0]}`);
        const requested = new Set(activeAssetRequests.map((entry) => {
          const parsed = new URL(entry);
          return `${parsed.origin}${parsed.pathname}`;
        }));
        for (const expectedUrl of expectedUrls) if (!requested.has(expectedUrl)) throw new Error(`${profile.candidateId}/${view.viewId} did not request ${expectedUrl}`);
        for (const requestedUrl of requested) if (!expectedUrls.has(requestedUrl)) throw new Error(`${profile.candidateId}/${view.viewId} requested an unpinned candidate asset: ${requestedUrl}`);
        if (rootDataset.preflightRuntimeProfileId !== profile.profileId || rootDataset.preflightExpectedSplatCount !== String(profile.expectedGaussianCount)) throw new Error(`${profile.candidateId}/${view.viewId} rendered the wrong frozen profile`);
        if (scene.renderProfileId !== "reception-fixed-fine-review-v1") throw new Error("real scene rendered an unexpected profile");
        const position = parseNumberList(scene.cameraPosition, 3, "camera position");
        const viewMatrix = parseNumberList(scene.cameraViewMatrix, 16, "camera view matrix");
        const projectionMatrix = parseNumberList(scene.cameraProjectionMatrix, 16, "camera projection matrix");
        if (position.some((value, index) => Math.abs(value - view.position[index]) > 1e-9)) throw new Error(`${view.viewId} camera position drifted`);
        const cameraReceipt = { position, viewMatrix, projectionMatrix };
        const priorCamera = cameraByView.get(view.viewId);
        if (priorCamera !== undefined && JSON.stringify(priorCamera) !== JSON.stringify(cameraReceipt)) throw new Error(`${view.viewId} camera matrices differed between candidates`);
        cameraByView.set(view.viewId, cameraReceipt);

        for (const repeat of [1, 2]) {
          throwIfAborted(signal);
          const settleStartedAt = performance.now();
          const frameSamples = await raceAbort(page.evaluate(async () => {
            await document.fonts.ready;
            const samples = [];
            let previous = await new Promise((resolve) => requestAnimationFrame(resolve));
            for (let index = 0; index < 60; index += 1) {
              const next = await new Promise((resolve) => requestAnimationFrame(resolve));
              samples.push(next - previous);
              previous = next;
            }
            return samples;
          }), signal);
          const settledAt = performance.now();
          const screenshotStartedAt = performance.now();
          const screenshot = await raceAbort(page.screenshot({ type: "png", animations: "disabled", caret: "hide", scale: "device" }), signal);
          const screenshotEndedAt = performance.now();
          const dimensions = pngDimensions(screenshot);
          if (dimensions.widthPx !== VIEWPORT.widthPx || dimensions.heightPx !== VIEWPORT.heightPx) throw new Error("screenshot dimensions did not match the frozen viewport");
          const variantId = `${profile.candidateId}-repeat-${repeat}`;
          const name = `matrix-${view.viewId}-${variantId}.png`;
          await writeFile(path.join(tempRoot, "captures", name), screenshot, { flag: "wx" });
          const totalDurationMs = screenshotEndedAt - startedAt;
          captures.push({
            candidateId: profile.candidateId,
            profileId: profile.profileId,
            viewId: view.viewId,
            repeat,
            name,
            screenshot: { mediaType: "image/png", ...dimensions, sizeBytes: screenshot.byteLength, sha256: sha256Bytes(screenshot) },
            telemetry: {
              loadedAssetCount: 4,
              loadedBytes: expectedBytes,
              decodedGaussianCount: profile.expectedGaussianCount,
              assetLoadDurationMs: liveAt - startedAt,
              settleDurationMs: settledAt - settleStartedAt,
              screenshotDurationMs: screenshotEndedAt - screenshotStartedAt,
              totalDurationMs,
              frameSampleCount: frameSamples.length,
              frameTimeP50Ms: percentile(frameSamples, 0.5),
              frameTimeP95Ms: percentile(frameSamples, 0.95),
              frameTimeP99Ms: percentile(frameSamples, 0.99),
            },
          });
          completed += 1;
          progress("capturing", completed);
        }
      }
    }
    if (externalRequests.length !== 0) throw new Error(`blocked non-loopback browser request: ${externalRequests[0]}`);
    if (pageErrors.length !== 0) throw new Error(`page error: ${pageErrors[0]}`);
    if (consoleErrors.length !== 0) throw new Error(`browser console error: ${consoleErrors[0]}`);
    return { captures, cameraByView, externalRequests, consoleErrors };
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function runPython(pythonFile, args, cwd, signal) {
  throwIfAborted(signal);
  const executable = process.platform === "win32" ? "python" : "python3";
  const child = spawn(executable, [pythonFile, ...args], { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const onAbort = () => child.kill("SIGTERM");
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, exitSignal) => resolve({ code, exitSignal }));
    });
    throwIfAborted(signal);
    if (result.code !== 0) throw new Error(`${path.basename(pythonFile)} failed (${result.code ?? result.exitSignal}): ${Buffer.concat(stderr).toString("utf8").trim()}`);
    if (Buffer.concat(stdout).toString("utf8").trim() !== "") throw new Error(`${path.basename(pythonFile)} wrote unexpected stdout while --output was supplied`);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function toCompileCaptures(captures, profile) {
  return {
    profileId: profile.profileId,
    views: REVIEW_VIEWS.map((view) => ({
      viewId: view.viewId,
      repeats: [1, 2].map((repeat) => {
        const capture = captures.find((entry) => entry.profileId === profile.profileId && entry.viewId === view.viewId && entry.repeat === repeat);
        if (capture === undefined) throw new Error(`missing ${profile.profileId}/${view.viewId}/repeat-${repeat}`);
        return { repeat, screenshot: capture.screenshot, telemetry: capture.telemetry };
      }),
    })),
  };
}

function parseCompareReport(rawText) {
  if (/\b(?:NaN|-Infinity)\b/u.test(rawText)) throw new Error("compare_fixed_views.py emitted a non-finite metric");
  return JSON.parse(rawText.replace(/\bInfinity\b/gu, "null"));
}

function buildPairMetrics(compareReport, captures) {
  return REVIEW_VIEWS.map((view) => ({
    viewId: view.viewId,
    repeats: [1, 2].map((repeat) => {
      const key = `quality-repeat-${repeat}__mobile-repeat-${repeat}`;
      const row = compareReport.comparisons?.[key]?.perView?.find((entry) => entry.view === view.viewId);
      if (row === undefined || !Number.isFinite(row.mae) || !Number.isFinite(row.ssim) || (row.psnrDb !== null && !Number.isFinite(row.psnrDb))) throw new Error(`pixel scorer omitted ${view.viewId}/repeat-${repeat}`);
      const quality = captures.find((entry) => entry.candidateId === "quality" && entry.viewId === view.viewId && entry.repeat === repeat);
      const mobile = captures.find((entry) => entry.candidateId === "mobile" && entry.viewId === view.viewId && entry.repeat === repeat);
      if (quality === undefined || mobile === undefined) throw new Error(`capture binding missing for ${view.viewId}/repeat-${repeat}`);
      return {
        repeat,
        qualityScreenshotSha256: quality.screenshot.sha256,
        mobileScreenshotSha256: mobile.screenshot.sha256,
        metrics: {
          comparedPixelCount: VIEWPORT.widthPx * VIEWPORT.heightPx,
          meanAbsoluteError: row.mae,
          rootMeanSquareError: row.psnrDb === null ? 0 : Number((10 ** (-row.psnrDb / 20)).toFixed(12)),
          psnrDb: row.psnrDb,
          ssim: row.ssim,
        },
      };
    }),
  }));
}

async function executeReplay(arguments_, signal) {
  const repoRoot = await realpath(arguments_.repoRoot).catch(() => {
    throw new Error(`repo root does not exist: ${arguments_.repoRoot}`);
  });
  const webRoot = path.join(repoRoot, "packages", "web");
  const runnerPath = path.join(repoRoot, "tools", "reception-hd", "run_captured_quality_comparison.mjs");
  const comparePath = path.join(repoRoot, "tools", "reception-hd", "compare_fixed_views.py");
  const triagePath = path.join(repoRoot, "tools", "reception-hd", "triage_fixed_views.py");
  const rendererProfilePath = path.join(webRoot, "src", "pages", "living-hall", "reception-viewer-profile.ts");
  for (const requiredPath of [runnerPath, comparePath, triagePath, rendererProfilePath, path.join(webRoot, "package.json")]) {
    if (!(await exists(requiredPath))) throw new Error(`required repo file is missing: ${path.relative(repoRoot, requiredPath)}`);
    if (!pathIsInside(repoRoot, requiredPath)) throw new Error(`required repo file escaped --repo-root: ${requiredPath}`);
  }

  progress("verifying_sources", 0);
  const qualityBefore = await verifyPinnedProfile(arguments_.qualityRoot, QUALITY_PROFILE.candidateId, QUALITY_PROFILE.assets);
  const mobileBefore = await verifyPinnedProfile(arguments_.mobileRoot, MOBILE_PROFILE.candidateId, MOBILE_PROFILE.assets);
  const preCapture = [
    ...sourceSnapshot(qualityBefore, QUALITY_PROFILE.profileId),
    ...sourceSnapshot(mobileBefore, MOBILE_PROFILE.profileId),
  ];
  progress("verifying_sources", 0);

  if (arguments_.verifyOnly) {
    return {
      verifyOnly: true,
      output: {
        schemaVersion: "venviewer.reception-captured-quality-source-verification.v1",
        requestId: arguments_.requestId,
        status: "verified",
        sources: preCapture,
      },
    };
  }

  const requestedOutputRoot = path.resolve(arguments_.outputRoot);
  const canonicalQualityRoot = await realpath(arguments_.qualityRoot);
  const canonicalMobileRoot = await realpath(arguments_.mobileRoot);
  for (const sourceRoot of [canonicalQualityRoot, canonicalMobileRoot]) {
    if (pathIsInside(sourceRoot, requestedOutputRoot) || pathIsInside(requestedOutputRoot, sourceRoot)) throw new Error("--output-root must not overlap either named source root");
  }
  await mkdir(requestedOutputRoot, { recursive: true });
  const outputInfo = await lstat(arguments_.outputRoot);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) throw new Error("--output-root must be a real, non-symlink directory");
  const canonicalOutputRoot = await realpath(arguments_.outputRoot);
  for (const sourceRoot of [canonicalQualityRoot, canonicalMobileRoot]) {
    if (pathIsInside(sourceRoot, canonicalOutputRoot) || pathIsInside(canonicalOutputRoot, sourceRoot)) throw new Error("--output-root must not overlap either named source root");
  }
  const finalRoot = path.join(canonicalOutputRoot, arguments_.requestId);
  const tempRoot = path.join(canonicalOutputRoot, `.${arguments_.requestId}.tmp-${process.pid}`);
  if (!pathIsInside(canonicalOutputRoot, finalRoot) || !pathIsInside(canonicalOutputRoot, tempRoot)) throw new Error("request output escaped --output-root");
  if (await exists(finalRoot)) throw new Error(`final output already exists and will not be replaced: ${finalRoot}`);
  if (await exists(tempRoot)) throw new Error(`temporary output already exists and will not be replaced: ${tempRoot}`);

  let committed = false;
  let qualityServer;
  let mobileServer;
  let viteServer;
  let cleanupWatchdog;
  try {
    await mkdir(path.join(tempRoot, "captures"), { recursive: true });
    await mkdir(path.join(tempRoot, "reports"), { recursive: true });
    cleanupWatchdog = await startCleanupWatchdog(tempRoot);
    const rendererProfileSha256 = await sha256File(rendererProfilePath);
    const runnerSha256 = await sha256File(runnerPath);
    const compareImplementationSha256 = await sha256File(comparePath);
    const triageImplementationSha256 = await sha256File(triagePath);

    progress("starting_renderer", 0);
    qualityServer = await startAssetServer(canonicalQualityRoot, QUALITY_PROFILE.assets);
    mobileServer = await startAssetServer(canonicalMobileRoot, MOBILE_PROFILE.assets);
    viteServer = await startViteServer(webRoot, qualityServer.origin, mobileServer.origin);
    progress("starting_renderer", 0);

    const captured = await captureMatrix({
      webRoot,
      webOrigin: viteServer.origin,
      qualityOrigin: qualityServer.origin,
      mobileOrigin: mobileServer.origin,
      tempRoot,
      signal,
    });

    const sourceServerTelemetry = {
      quality: { ...qualityServer.telemetry },
      mobile: { ...mobileServer.telemetry },
    };

    await viteServer.close();
    viteServer = undefined;
    await qualityServer.close();
    qualityServer = undefined;
    await mobileServer.close();
    mobileServer = undefined;

    progress("verifying_sources", TOTAL_CAPTURES);
    const qualityAfter = await verifyPinnedProfile(canonicalQualityRoot, QUALITY_PROFILE.candidateId, QUALITY_PROFILE.assets);
    const mobileAfter = await verifyPinnedProfile(canonicalMobileRoot, MOBILE_PROFILE.candidateId, MOBILE_PROFILE.assets);
    if (!sameBindings(qualityBefore, qualityAfter) || !sameBindings(mobileBefore, mobileAfter)) throw new Error("one or more frozen candidate sources changed between pre- and post-capture verification");
    const postCapture = [
      ...sourceSnapshot(qualityAfter, QUALITY_PROFILE.profileId),
      ...sourceSnapshot(mobileAfter, MOBILE_PROFILE.profileId),
    ];
    if ((await sha256File(rendererProfilePath)) !== rendererProfileSha256) throw new Error("renderer profile source changed during capture");
    if ((await sha256File(runnerPath)) !== runnerSha256) throw new Error("captured-quality runner changed during capture");
    progress("verifying_sources", TOTAL_CAPTURES);

    const screenshotIntegrity = captured.captures.map((capture) => ({ name: capture.name, bytes: capture.screenshot.sizeBytes, sha256: capture.screenshot.sha256 }));
    const captureManifest = {
      schemaVersion: "venviewer.reception-captured-quality-capture-manifest.v1",
      requestId: arguments_.requestId,
      screenshotIntegrity,
    };
    const captureManifestPath = path.join(tempRoot, "reports", "capture-manifest.json");
    await writeFile(captureManifestPath, `${JSON.stringify(captureManifest, null, 2)}\n`, { flag: "wx" });

    progress("scoring", TOTAL_CAPTURES);
    const compareOutputPath = path.join(tempRoot, "reports", "compare-fixed-views.json");
    const triageOutputPath = path.join(tempRoot, "reports", "triage-fixed-views.json");
    const pairArgs = [
      "--pair", "quality-repeat-1:mobile-repeat-1",
      "--pair", "quality-repeat-2:mobile-repeat-2",
    ];
    await runPython(comparePath, ["--root", path.join(tempRoot, "captures"), "--output", compareOutputPath, ...pairArgs], repoRoot, signal);
    await runPython(triagePath, ["--root", path.join(tempRoot, "captures"), "--output", triageOutputPath, "--capture-manifest", captureManifestPath, ...pairArgs], repoRoot, signal);
    const compareBytes = await readFile(compareOutputPath);
    const triageBytes = await readFile(triageOutputPath);
    const compareReport = parseCompareReport(compareBytes.toString("utf8"));
    if (compareReport.schemaVersion !== "venviewer.reception-room-fixed-view-metrics.v1") throw new Error("pixel scorer returned an unexpected schema");
    const triageReport = JSON.parse(triageBytes.toString("utf8"));
    if (triageReport.schemaVersion !== "venviewer.reception-room-fixed-view-cv-triage.v2") throw new Error("regression triage returned an unexpected schema");
    if ((await sha256File(comparePath)) !== compareImplementationSha256) throw new Error("pixel scorer implementation changed during scoring");
    if ((await sha256File(triagePath)) !== triageImplementationSha256) throw new Error("regression triage implementation changed during scoring");
    progress("scoring", TOTAL_CAPTURES);

    const views = REVIEW_VIEWS.map((view) => {
      const camera = captured.cameraByView.get(view.viewId);
      if (camera === undefined) throw new Error(`camera receipt missing for ${view.viewId}`);
      return {
        viewId: view.viewId,
        kind: "other_reviewed",
        camera: {
          model: "perspective",
          position: view.position,
          target: view.target,
          up: view.up,
          verticalFovDegrees: view.verticalFovDegrees,
          nearClip: view.nearClip,
          farClip: view.farClip,
          viewMatrix: camera.viewMatrix,
          projectionMatrix: camera.projectionMatrix,
        },
      };
    });
    const compileInput = {
      generatedAt: new Date().toISOString(),
      sourceReceiptSha256: null,
      candidateProfiles: [QUALITY_PROFILE, MOBILE_PROFILE].map((profile) => ({
        profileId: profile.profileId,
        expectedGaussianCount: profile.expectedGaussianCount,
        decodedGaussianCount: profile.expectedGaussianCount,
        assets: profile.assets.map((asset) => ({ pathLabel: asset.fileName, sizeBytes: asset.sizeBytes, sha256: asset.sha256 })),
      })),
      rendererProfile: { id: "reception-viewer-profile-source-v1", profileSha256: rendererProfileSha256 },
      viewport: VIEWPORT,
      views,
      captures: [
        toCompileCaptures(captured.captures, QUALITY_PROFILE),
        toCompileCaptures(captured.captures, MOBILE_PROFILE),
      ],
      pairMetrics: buildPairMetrics(compareReport, captured.captures),
      sourceIntegrity: { preCapture, postCapture, allSourcesUnchanged: true },
      scorer: {
        id: "reception-fixed-view-pixel-metrics-v1",
        version: compareReport.schemaVersion,
        implementationSha256: compareImplementationSha256,
        receiptSha256: sha256Bytes(compareBytes),
      },
    };

    const repeatability = [QUALITY_PROFILE, MOBILE_PROFILE].flatMap((profile) => REVIEW_VIEWS.map((view) => {
      const first = captured.captures.find((capture) => capture.profileId === profile.profileId && capture.viewId === view.viewId && capture.repeat === 1);
      const second = captured.captures.find((capture) => capture.profileId === profile.profileId && capture.viewId === view.viewId && capture.repeat === 2);
      if (first === undefined || second === undefined) throw new Error("repeatability binding is incomplete");
      return { profileId: profile.profileId, viewId: view.viewId, byteIdentical: first.screenshot.sha256 === second.screenshot.sha256, repeat1Sha256: first.screenshot.sha256, repeat2Sha256: second.screenshot.sha256 };
    }));
    for (const mismatch of repeatability.filter((entry) => !entry.byteIdentical)) {
      process.stderr.write(`CAPTURE_NOTE repeat mismatch ${mismatch.profileId}/${mismatch.viewId}; winner remains not_selected\n`);
    }
    const runnerObservation = {
      schemaVersion: "venviewer.reception-captured-quality-runner-observation.v1",
      requestId: arguments_.requestId,
      authority: "none",
      winner: "not_selected",
      externalRequests: captured.externalRequests.length,
      repeatability,
      consoleErrors: captured.consoleErrors,
      toolReceipts: {
        runnerSha256,
        rendererProfileSha256,
        compareFixedViews: { implementationSha256: compareImplementationSha256, receiptSha256: sha256Bytes(compareBytes) },
        triageFixedViews: { implementationSha256: triageImplementationSha256, receiptSha256: sha256Bytes(triageBytes) },
      },
      sourceServers: {
        quality: sourceServerTelemetry.quality,
        mobile: sourceServerTelemetry.mobile,
      },
      compileInputSha256: sha256Bytes(Buffer.from(JSON.stringify(compileInput), "utf8")),
    };

    progress("finalizing", TOTAL_CAPTURES);
    if ((await sha256File(rendererProfilePath)) !== rendererProfileSha256) throw new Error("renderer profile source changed before finalization");
    if ((await sha256File(runnerPath)) !== runnerSha256) throw new Error("captured-quality runner changed before finalization");
    await writeFile(path.join(tempRoot, "compile-input.json"), `${JSON.stringify(compileInput, null, 2)}\n`, { flag: "wx" });
    await writeFile(path.join(tempRoot, "runner-observation.json"), `${JSON.stringify(runnerObservation, null, 2)}\n`, { flag: "wx" });
    throwIfAborted(signal);
    await commitAtomicOutputDirectory(
      tempRoot,
      finalRoot,
      cleanupWatchdog,
      signal,
    );
    committed = true;
    progress("finalizing", TOTAL_CAPTURES);
    return { verifyOnly: false, output: compileInput, finalRoot };
  } finally {
    await viteServer?.close().catch(() => undefined);
    await qualityServer?.close().catch(() => undefined);
    await mobileServer?.close().catch(() => undefined);
    if (!committed) {
      await cleanupWatchdog?.stop("abort").catch(() => undefined);
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function main() {
  let arguments_;
  try {
    arguments_ = parseCliArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`CAPTURE_ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }
  if (arguments_.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  const cancellation = new AbortController();
  const cancel = (signalName) => cancellation.abort(new Error(`captured-quality replay cancelled by ${signalName}`));
  const onSigint = () => cancel("SIGINT");
  const onSigterm = () => cancel("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const result = await executeReplay(arguments_, cancellation.signal);
    process.stdout.write(`${JSON.stringify(result.output)}\n`);
  } catch (error) {
    process.stderr.write(`CAPTURE_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = cancellation.signal.aborted ? 130 : 1;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath !== null && invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
