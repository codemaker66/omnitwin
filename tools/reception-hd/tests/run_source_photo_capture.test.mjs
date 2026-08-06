import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CAPTURE_PLAN_SCHEMA_VERSION,
  CAPTURE_RECEIPT_SCHEMA_VERSION,
  assertRuntimeBuildInputSetUnchanged,
  assetSetDigest,
  buildCameraQuery,
  buildCaptureReceipt,
  captureAll,
  parseJsonDocument,
  parseCapturePlan,
  parseCliArguments,
  expectedReceptionRendererBinding,
  isIntentionallyBlockedCaptureRequest,
  prepareImmutableCaptureWebApp,
  snapshotCaptureToolchain,
  snapshotCaptureToolchainTree,
  snapshotRuntimeBuildInputs,
  startImmutableCaptureWebServer,
  validateAssetRequests,
  validateFrameEvidence,
  verifyRuntimeBuildSnapshot,
} from "../run_source_photo_capture.mjs";
import {
  RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS,
} from "../../../packages/web/scripts/reception-capture-runtime-build-digest.mjs";


const digest = (value) => createHash("sha256").update(value).digest("hex");
const REPO_ROOT = path.resolve(".");

test("runtime input re-enumeration rejects added, deleted, renamed, or linked paths", () => {
  const admitted = ["packages/types/src/index.ts", "packages/web/src/main.tsx"];
  assert.doesNotThrow(() => assertRuntimeBuildInputSetUnchanged(admitted, [...admitted]));
  for (const changed of [
    [...admitted, "packages/web/src/new-runtime.ts"],
    [admitted[0]],
    [admitted[0], "packages/web/src/renamed.tsx"],
    [admitted[0], "packages/web/src/linked-runtime.tsx"],
  ]) {
    assert.throws(
      () => assertRuntimeBuildInputSetUnchanged(admitted, changed),
      /path set changed after capture admission/u,
    );
  }
});

async function createRuntimeInputTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), "reception-runtime-tree-"));
  for (const repositoryPath of RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS) {
    const target = path.join(root, ...repositoryPath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "fixture\n");
  }
  await mkdir(path.join(root, "packages", "types", "dist"), { recursive: true });
  await mkdir(path.join(root, "packages", "types", "src"), { recursive: true });
  await mkdir(path.join(root, "packages", "web", "src", "pages", "living-hall"), { recursive: true });
  const versions = [
    ["three", "three", "0.180.0"],
    [path.join("@sparkjsdev", "spark"), "@sparkjsdev/spark", "2.0.0"],
    [path.join("@react-three", "fiber"), "@react-three/fiber", "8.18.0"],
    ["vite", "vite", "6.4.3"],
    [path.join("@vitejs", "plugin-react"), "@vitejs/plugin-react", "4.3.4"],
    [path.join("@playwright", "test"), "@playwright/test", "1.59.1"],
  ];
  await writeFile(path.join(root, "packages", "web", "package.json"), JSON.stringify({
    dependencies: { three: "0.180.0", "@sparkjsdev/spark": "2.0.0", "@react-three/fiber": "8.18.0" },
    devDependencies: { vite: "6.4.3", "@vitejs/plugin-react": "4.3.4", "@playwright/test": "1.59.1" },
  }));
  for (const [packagePath, name, version] of versions) {
    const directory = path.join(root, "packages", "web", "node_modules", packagePath);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version }));
  }
  await writeFile(
    path.join(root, "packages", "web", "src", "pages", "living-hall", "reception-capture-binding-v1.json"),
    JSON.stringify({ lockedRuntimeVersions: {
      three: "0.180.0", spark: "2.0.0", reactThreeFiber: "8.18.0",
      vite: "6.4.3", viteReactPlugin: "4.3.4", playwrightTest: "1.59.1",
    } }),
  );
  await writeFile(path.join(root, "packages", "web", "src", "runtime-entry.ts"), "export {};\n");
  return root;
}

test("runtime input re-enumeration catches a real file added after admission", async () => {
  const root = await createRuntimeInputTree();
  try {
    const snapshot = await snapshotRuntimeBuildInputs(root);
    await verifyRuntimeBuildSnapshot(snapshot);
    await writeFile(path.join(root, "packages", "web", "src", "late-runtime.ts"), "export {};\n");
    await assert.rejects(
      verifyRuntimeBuildSnapshot(snapshot),
      /path set changed after capture admission/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture plans reject asset origins the real preflight cannot use", () => {
  for (const invalidOrigin of [
    "http://localhost:5181",
    "https://127.0.0.1:5181",
    "http://127.0.0.1",
    "http://user@127.0.0.1:5181",
  ]) {
    const protocol = protocolFixture();
    const plan = planFixture(protocol);
    plan.candidates[0].assetOrigin = invalidOrigin;
    assert.throws(() => parseCapturePlan(plan, protocol), /assetOrigin/u);
  }
});

test("only known presentation-font requests are silently blocked", () => {
  const exact = new URL(
    "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1;1,9..144,300..700,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap",
  );
  assert.equal(isIntentionallyBlockedCaptureRequest(exact, "GET", "stylesheet"), true);
  for (const [url, method, resourceType] of [
    [new URL("https://fonts.googleapis.com/css2?family=Newsreader"), "GET", "stylesheet"],
    [new URL("https://fonts.gstatic.com/s/newsreader/font.woff2"), "GET", "font"],
    [new URL(exact.href.replace("fonts.googleapis.com", "fonts.googleapis.com:444")), "GET", "stylesheet"],
    [exact, "POST", "stylesheet"],
    [exact, "GET", "font"],
  ]) {
    assert.equal(isIntentionallyBlockedCaptureRequest(url, method, resourceType), false);
  }
});

async function runProcess(command, args, environment = process.env) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    signal: controller.signal,
    env: environment,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  }).finally(() => clearTimeout(timer));
  if (code !== 0) throw new Error(Buffer.concat(stderr).toString("utf8"));
  return Buffer.concat(stdout).toString("utf8");
}

function transposeMatrix(values) {
  return Array.from({ length: 16 }, (_, index) => values[(index % 4) * 4 + Math.floor(index / 4)]);
}

async function startServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server did not expose a port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function fixturePageConfig(candidates, protocol) {
  const camera = protocol.views[0].camera;
  return {
    candidates: Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, {
      profileId: candidate.profileId,
      splatCount: candidate.expectedSplatCount,
      assetSetSha256: candidate.assetSetSha256,
      assetUrls: candidate.assets.map((asset) => new URL(asset.requestPath, candidate.assetOrigin).href),
      assets: candidate.assets.map((asset) => ({
        candidateId: candidate.candidateId,
        requestPath: asset.requestPath,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        sourceId: `local-preflight:${candidate.candidateId}:${asset.requestPath.slice(asset.requestPath.lastIndexOf("/") + 1)}`,
      })),
    }])),
    viewMatrix: transposeMatrix(camera.worldToCamera).join(","),
    projectionMatrix: transposeMatrix(camera.projectionMatrix).join(","),
    renderer: protocol.rendererBinding,
    frameDomain: "venviewer.reception-presented-frame.v1\u0000",
    background: [5, 8, 7],
  };
}

function fixtureSetupScript(pageConfig) {
  return `const all = ${JSON.stringify(pageConfig)};
    const query = new URLSearchParams(location.search);
    const candidateId = query.get("candidate");
    const config = all.candidates[candidateId];
    const root = document.querySelector(".lh-root");
    const scene = document.querySelector(".lh-scene");
    root.dataset.preflightCandidateId = candidateId;
    root.dataset.preflightRuntimeProfileId = config.profileId;
    root.dataset.preflightReviewViewId = "experimental-e57:" + query.get("experimentalViewId");
    root.dataset.preflightLoadedAssetSetSha256 = config.assetSetSha256;
    root.dataset.preflightRendererConfigDigest = all.renderer.digest;
    root.dataset.preflightRuntimeBuildDigest = all.renderer.runtimeBuildDigest;
    root.dataset.preflightRuntimeEnvironmentDigest = all.renderer.runtimeEnvironmentDigest;
    root.dataset.preflightProfileDigest = all.renderer.profileDigest;
    root.dataset.preflightToneMapDigest = all.renderer.toneMapDigest;
    root.dataset.preflightExposureDigest = all.renderer.exposureDigest;
    root.dataset.preflightColourSpaceDigest = all.renderer.colourSpaceDigest;
    scene.dataset.cameraPosition = query.get("camera");
    scene.dataset.cameraViewMatrix = all.viewMatrix;
    scene.dataset.cameraProjectionMatrix = all.projectionMatrix;
    const canonical = (value) => {
      if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
      if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
      return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
    };
    const sha = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const matrix = [1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1];
    const session = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    let sequence = 0;`;
}

function fixtureCaptureScript(protocol) {
  return `Promise.all(config.assetUrls.map((url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error("asset request failed");
      return response.arrayBuffer();
    }))).then(() => {
      scene.dataset.loadedSourceCount = String(config.assetUrls.length);
      scene.dataset.loadedSplatCount = String(config.splatCount);
      scene.dataset.cameraReady = "true";
      scene.dataset.sceneState = "live";
      window.__venviewerCaptureV1 = { capture: async (request) => {
        sequence += 1;
        const width = ${protocol.views[0].camera.imageWidth};
        const height = ${protocol.views[0].camera.imageHeight};
        const pixels = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const stripe = (Math.floor(x / 5) + Math.floor(y / 7)) % 2;
          const panel = x > width / 4 && x < width * 3 / 4 && y > height / 4 && y < height * 3 / 4;
          pixels[index] = panel ? 112 : stripe ? 38 : 188;
          pixels[index + 1] = panel ? 65 : stripe ? 164 : 92;
          pixels[index + 2] = panel ? 52 : stripe ? 211 : 43;
          pixels[index + 3] = 255;
        }
        const pixelDigest = await sha(pixels);
        const counts = config.assets.map((_asset, index) => index === config.assets.length - 1 ? config.splatCount - Math.floor(config.splatCount / config.assets.length) * index : Math.floor(config.splatCount / config.assets.length));
        const assetReceipts = config.assets.map((asset, index) => ({ ...asset, renderProfileId: "reception-fixed-fine-review-v1", meshUuid: "fixture-mesh-" + index, splatCount: counts[index], initialized: true, visible: true, opacity: 1, maxSh: 3, enableLod: false, matrixWorld: matrix }));
        const frame = {
          schemaVersion: request.schemaVersion, protocolDigest: request.protocolDigest,
          challengeNonce: request.challengeNonce, documentSessionId: session,
          renderSequence: sequence, presentedFrameId: "fixture-" + session.slice(0, 16) + "-" + sequence,
          candidateId, viewId: query.get("experimentalViewId"), assetSetSha256: config.assetSetSha256,
          assetReceipts, profileId: config.profileId, loadedSourceCount: config.assets.length,
          loadedSplatCount: config.splatCount, rendererBinding: all.renderer,
          camera: { positionMetres: query.get("camera").split(",").map(Number), quaternion: [0,0,0,1], worldMatrix: matrix, worldToCamera: all.viewMatrix.split(",").map(Number), projectionMatrix: all.projectionMatrix.split(",").map(Number) },
          renderer: { browserUserAgent: navigator.userAgent, webglVersion: "WebGL 2.0 fixture", webglShadingLanguageVersion: "WebGL GLSL ES 3.00 fixture", webglVendor: "fixture-vendor", webglRenderer: "fixture-renderer", threeFrame: sequence, sparkLastFrame: sequence, sparkActiveSplats: Math.max(1, config.splatCount - 1), drawingBufferWidth: width, drawingBufferHeight: height, effectiveDpr: 1, outputColorSpace: "srgb", toneMapping: 4, toneMappingExposure: 1, antialias: false, alpha: true, premultipliedAlpha: true, contextLost: false, sparkSorting: false, sparkEnableLod: false, sparkRenderSize: [width,height] },
          framebufferPixelSha256: pixelDigest,
        };
        const rendererFrameDigest = await sha(new TextEncoder().encode(all.frameDomain + canonical(frame)));
        let binary = ""; for (const byte of pixels) binary += String.fromCharCode(byte);
        return { ...frame, rendererFrameDigest, framebufferRgbaBase64: btoa(binary) };
      }};
    });`;
}

function fixtureHtml(candidates, protocol) {
  const setup = fixtureSetupScript(fixturePageConfig(candidates, protocol));
  const capture = fixtureCaptureScript(protocol);
  return `<!doctype html><html><head><style>
    html,body,.lh-root,.lh-scene{margin:0;width:100%;height:100%;overflow:hidden}
    body{background:repeating-linear-gradient(0deg,#26384a 0 5px,#d9a24a 5px 9px)}
    .lh-scene{background:repeating-linear-gradient(90deg,transparent 0 11px,rgba(255,255,255,.45) 11px 14px)}
    .lh-scene::after{content:"";display:block;width:54%;height:42%;margin:19% 0 0 23%;border:4px solid #f5ead8;background:#713f32}
  </style></head><body><div class="lh-root"><div class="lh-scene"></div></div>
  <script>${setup}${capture}</script></body></html>`;
}

function protocolFixture() {
  const quality = candidateFixture("quality", "http://127.0.0.1:5181", 2_000_000);
  const mobile = candidateFixture("mobile", "http://127.0.0.1:5182", 1_900_000);
  return {
    protocolDigest: digest("protocol"),
    candidateIds: ["quality", "mobile"],
    candidateBindings: [quality, mobile].map(({ candidateId, assetSetSha256, profileId, expectedSplatCount }) => ({ candidateId, assetSetSha256, profileId, expectedSplatCount })),
    rendererBinding: {
      digest: digest("renderer"),
      runtimeBuildDigest: digest("runtime-build"),
      runtimeEnvironmentDigest: digest("runtime-environment"),
      profileDigest: digest("profile"),
      toneMapDigest: digest("tone-map"),
      exposureDigest: digest("exposure"),
      colourSpaceDigest: digest("srgb"),
    },
    captureBinding: {
      evidenceClass: "diagnostic_renderer_owned_telemetry",
      runnerImplementation: { sha256: digest("synthetic-runner") },
    },
    views: [
      {
        viewId: "fireplace-01",
        roomStateDigest: digest("room-state"),
        cameraDigest: digest("camera"),
        camera: {
          imageWidth: 1200,
          imageHeight: 900,
          positionMetres: [1, 2, 3],
          targetMetres: [4, 5, 6],
          up: [0, 1, 0],
          verticalFovDegrees: 48,
          worldToCamera: Array.from({ length: 16 }, (_, index) => index),
          projectionMatrix: Array.from({ length: 16 }, (_, index) => index + 20),
          viewport: { cssWidth: 1200, cssHeight: 900, devicePixelRatio: 1 },
        },
      },
    ],
  };
}

function candidateFixture(candidateId, assetOrigin, expectedSplatCount) {
  const assets = Array.from({ length: 4 }, (_, index) => ({
    requestPath: `/${candidateId}-${index + 1}.splat`,
    localPath: path.resolve(`C:/generated/assets/${candidateId}-${index + 1}.splat`),
    sha256: digest(`${candidateId}-asset-${index + 1}`),
    sizeBytes: 1000 + index,
  }));
  return {
    candidateId,
    assetSetSha256: assetSetDigest(assets),
    profileId: `${candidateId}-profile-v1`,
    expectedSplatCount,
    assetOrigin,
    assets,
  };
}

function planFixture(protocol = protocolFixture()) {
  return {
    schemaVersion: CAPTURE_PLAN_SCHEMA_VERSION,
    authority: "none",
    protocolDigest: protocol.protocolDigest,
    webOrigin: "http://127.0.0.1:4173",
    candidates: [
      candidateFixture("quality", "http://127.0.0.1:5181", 2_000_000),
      candidateFixture("mobile", "http://127.0.0.1:5182", 1_900_000),
    ],
  };
}

async function createAssetCandidate(root, candidateId, expectedSplatCount) {
  const bodies = new Map();
  const assets = [];
  const requestCounter = { count: 0 };
  for (let index = 1; index <= 2; index += 1) {
    const requestPath = `/${candidateId}-${index}.splat`;
    const bytes = Buffer.from(`${candidateId}-synthetic-asset-${index}`, "utf8");
    const localPath = path.join(root, `${candidateId}-${index}.splat`);
    await writeFile(localPath, bytes, { flag: "wx" });
    bodies.set(requestPath, bytes);
    assets.push({ requestPath, localPath, sha256: digest(bytes), sizeBytes: bytes.length });
  }
  const server = await startServer((request, response) => {
    requestCounter.count += 1;
    const body = bodies.get(new URL(request.url, "http://127.0.0.1").pathname);
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (body === undefined) {
      response.writeHead(404).end();
    } else {
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
      response.end(body);
    }
  });
  return {
    server,
    requestCounter,
    candidate: {
      candidateId,
      assetSetSha256: assetSetDigest(assets),
      profileId: `${candidateId}-profile-v1`,
      expectedSplatCount,
      assetOrigin: server.origin,
      assets,
    },
  };
}

function smallBrowserProtocol() {
  const protocol = protocolFixture();
  const camera = protocol.views[0].camera;
  camera.imageWidth = 96;
  camera.imageHeight = 96;
  camera.viewport = { cssWidth: 96, cssHeight: 96, devicePixelRatio: 1 };
  return protocol;
}

async function createBrowserFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "source-photo-capture-test-"));
  const tempRoot = path.join(root, "output");
  await mkdir(path.join(tempRoot, "captures"), { recursive: true });
  await mkdir(path.join(tempRoot, "receipts"), { recursive: true });
  const protocol = smallBrowserProtocol();
  const quality = await createAssetCandidate(root, "quality", 2_000_000);
  const mobile = await createAssetCandidate(root, "mobile", 1_900_000);
  const candidates = [quality.candidate, mobile.candidate];
  protocol.candidateBindings = candidates.map(({ candidateId, assetSetSha256, profileId, expectedSplatCount }) => ({ candidateId, assetSetSha256, profileId, expectedSplatCount }));
  const web = await startServer((_request, response) => {
    const body = Buffer.from(fixtureHtml(candidates, protocol), "utf8");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length });
    response.end(body);
  });
  const rawPlan = {
    schemaVersion: CAPTURE_PLAN_SCHEMA_VERSION,
    authority: "none",
    protocolDigest: protocol.protocolDigest,
    webOrigin: web.origin,
    candidates,
  };
  const plan = parseCapturePlan(rawPlan, protocol);
  const html = Buffer.from(fixtureHtml(candidates, protocol), "utf8");
  const pageApp = {
    responses: new Map([["/index.html", { bytes: html, contentType: "text/html; charset=utf-8" }]]),
    manifest: { digest: digest(html) },
  };
  const captureProvenance = {
    planSha256: digest(JSON.stringify(rawPlan)),
    planSizeBytes: Buffer.byteLength(JSON.stringify(rawPlan)),
    webOrigin: plan.webOrigin,
    servedPageManifestDigest: pageApp.manifest.digest,
    captureToolchainDigest: digest("fixture-toolchain"),
  };
  const webRequire = createRequire(path.resolve("packages/web/package.json"));
  const { chromium } = webRequire("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const binding = {
    frameDomain: "venviewer.reception-presented-frame.v1\u0000",
    captureBackgroundRgb: [5, 8, 7],
    expectedSplatMeshMatrixWorld: [1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1],
  };
  return {
    root,
    tempRoot,
    protocol,
    plan,
    browser,
    binding,
    pageApp,
    captureProvenance,
    servers: [web, quality.server, mobile.server],
    assetRequestCounters: [quality.requestCounter, mobile.requestCounter],
  };
}

async function closeBrowserFixture(fixture) {
  await fixture.browser?.close();
  await Promise.all(fixture.servers?.map((server) => server.close()) ?? []);
  if (fixture.root !== undefined) await rm(fixture.root, { recursive: true, force: true });
}

async function unusedLoopbackOrigin() {
  const reservation = await startServer((_request, response) => response.end());
  const { origin } = reservation;
  await reservation.close();
  return origin;
}

test("same-version capture toolchain byte mutations change the tree identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-toolchain-tree-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
    await writeFile(path.join(root, "index.js"), "export const value = 1;\n");
    const before = await snapshotCaptureToolchainTree(root, "fixture package");
    await writeFile(path.join(root, "index.js"), "export const value = 2;\n");
    const after = await snapshotCaptureToolchainTree(root, "fixture package");
    assert.notEqual(after.sha256, before.sha256);
    assert.equal(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version, "1.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner-owned web origin rejects a pre-existing lookalike page", async () => {
  const lookalike = await startServer((_request, response) => response.end("fake page"));
  const pageApp = {
    responses: new Map([["/index.html", {
      bytes: Buffer.from("real page"), contentType: "text/html; charset=utf-8",
    }]]),
  };
  try {
    await assert.rejects(
      startImmutableCaptureWebServer(lookalike.origin, pageApp),
      /occupied or cannot be owned/u,
    );
  } finally {
    await lookalike.close();
  }
});

test("immutable build serves admitted bytes even if its old disk path is changed and restored", { timeout: 240_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "immutable-capture-web-"));
  let server;
  try {
    await mkdir(root, { recursive: true });
    const webOrigin = await unusedLoopbackOrigin();
    const protocol = protocolFixture();
    const rawPlan = { ...planFixture(protocol), webOrigin };
    const plan = parseCapturePlan(rawPlan, protocol);
    const webRequire = createRequire(path.resolve("packages/web/package.json"));
    const { chromium } = webRequire("@playwright/test");
    const environment = {
      VITE_RECEPTION_MOBILE_ORIGIN: plan.candidates[1].assetOrigin,
      VITE_RECEPTION_QUALITY_ORIGIN: plan.candidates[0].assetOrigin,
    };
    const rendererBinding = await expectedReceptionRendererBinding(REPO_ROOT, environment);
    const toolchain = await snapshotCaptureToolchain(webRequire, chromium);
    const pageApp = await prepareImmutableCaptureWebApp({
      repoRoot: REPO_ROOT,
      tempRoot: root,
      plan,
      rendererBinding,
      webRequire,
      toolchain,
    });
    const builtJavascript = [...pageApp.responses.entries()]
      .filter(([requestPath]) => requestPath.endsWith(".js"))
      .map(([, response]) => response.bytes.toString("utf8"))
      .join("\n");
    assert.match(builtJavascript, /reception-quality-preflight/u);
    server = await startImmutableCaptureWebServer(webOrigin, pageApp);
    const first = Buffer.from(await (await fetch(`${webOrigin}/dev/reception-quality-preflight`)).arrayBuffer());
    const retainedBuild = path.join(root, "served-page");
    await writeFile(path.join(retainedBuild, "index.html"), "lookalike-mutated-page");
    const secondRequest = fetch(`${webOrigin}/dev/reception-quality-preflight`);
    await writeFile(path.join(retainedBuild, "index.html"), first);
    const second = Buffer.from(await (await secondRequest).arrayBuffer());
    const indexEntry = pageApp.manifest.entries.find((entry) => entry.path === "/index.html");
    assert.equal(digest(first), indexEntry.sha256);
    assert.deepEqual(second, first);
    assert.equal(pageApp.manifest.captureToolchain.digest, toolchain.manifest.digest);
  } finally {
    await server?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

async function freezeGeneratedProtocol(root, candidates) {
  const python = process.platform === "win32" ? "python" : "python3";
  const testModule = path.join(REPO_ROOT, "tools", "reception-hd", "tests", "test_compare_source_photo_renders.py");
  const runnerSource = path.join(REPO_ROOT, "tools", "reception-hd", "run_source_photo_capture.mjs");
  const frozenRunner = path.join(root, "pinned-browser-runner.mjs");
  const bindingsPath = path.join(root, "candidate-bindings.json");
  const rendererBindingPath = path.join(root, "renderer-binding.json");
  const environment = {
    VITE_RECEPTION_MOBILE_ORIGIN: candidates.find(({ candidateId }) => candidateId === "mobile").assetOrigin,
    VITE_RECEPTION_QUALITY_ORIGIN: candidates.find(({ candidateId }) => candidateId === "quality").assetOrigin,
  };
  const expected = await expectedReceptionRendererBinding(REPO_ROOT, environment);
  const rendererBinding = Object.fromEntries([
    "digest", "runtimeBuildDigest", "runtimeEnvironmentDigest", "profileDigest", "toneMapDigest",
    "exposureDigest", "colourSpaceDigest",
  ].map((key) => [key, expected[key]]));
  await writeFile(frozenRunner, await readFile(runnerSource), { flag: "wx" });
  await writeFile(bindingsPath, JSON.stringify(candidates.map(({ candidateId, assetSetSha256, profileId, expectedSplatCount }) => ({ candidateId, assetSetSha256, profileId, expectedSplatCount }))));
  await writeFile(rendererBindingPath, JSON.stringify(rendererBinding));
  const script = [
    "import importlib.util, json, sys",
    "from pathlib import Path",
    "root = Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('source_fixture', sys.argv[2])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "draft = module.write_draft(root, heldout=False)",
    "payload = json.loads(draft.read_text(encoding='utf-8'))",
    "payload['candidateBindings'] = json.loads(Path(sys.argv[3]).read_text(encoding='utf-8'))",
    "payload['rendererBinding'] = json.loads(Path(sys.argv[5]).read_text(encoding='utf-8'))",
    "payload['captureBinding']['runnerImplementation'] = module.file_ref(Path(sys.argv[4]))",
    "draft.write_text(json.dumps(payload, indent=2) + '\\n', encoding='utf-8')",
    "module.MODULE.freeze_protocol(draft, root / 'protocol.json')",
  ].join("\n");
  await runProcess(python, ["-c", script, root, testModule, bindingsPath, frozenRunner, rendererBindingPath]);
  return JSON.parse(await readFile(path.join(root, "protocol.json"), "utf8"));
}

async function createCliFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "source-photo-cli-test-"));
  const quality = await createAssetCandidate(root, "quality", 2_000_000);
  const mobile = await createAssetCandidate(root, "mobile", 1_900_000);
  const candidates = [quality.candidate, mobile.candidate];
  const protocol = await freezeGeneratedProtocol(root, candidates);
  const web = await startServer((_request, response) => {
    const body = Buffer.from(fixtureHtml(candidates, protocol), "utf8");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length });
    response.end(body);
  });
  const plan = {
    schemaVersion: CAPTURE_PLAN_SCHEMA_VERSION,
    authority: "none",
    protocolDigest: protocol.protocolDigest,
    webOrigin: web.origin,
    candidates,
  };
  const planPath = path.join(root, "capture-plan.json");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  return {
    root,
    protocol,
    planPath,
    environment: {
      ...process.env,
      VITE_RECEPTION_MOBILE_ORIGIN: mobile.candidate.assetOrigin,
      VITE_RECEPTION_QUALITY_ORIGIN: quality.candidate.assetOrigin,
    },
    servers: [web, quality.server, mobile.server],
  };
}

async function closeCliFixture(fixture) {
  await Promise.all(fixture.servers?.map((server) => server.close()) ?? []);
  if (fixture.root !== undefined) await rm(fixture.root, { recursive: true, force: true });
}

test("parseCliArguments accepts explicit absolute paths and verify-only", () => {
  const root = path.resolve("C:/generated/source-photo-capture");
  assert.deepEqual(
    parseCliArguments([
      "--repo-root", root,
      "--protocol", path.join(root, "protocol.json"),
      "--plan", path.join(root, "plan.json"),
      "--output-root", path.join(root, "output"),
      "--verify-only",
    ]),
    {
      help: false,
      verifyOnly: true,
      repoRoot: root,
      protocol: path.join(root, "protocol.json"),
      plan: path.join(root, "plan.json"),
      outputRoot: path.join(root, "output"),
    },
  );
});

for (const [label, args, pattern] of [
  ["unknown option", ["--unknown"], /unknown option/i],
  ["missing value", ["--repo-root"], /requires exactly one value/i],
  ["relative path", ["--repo-root", ".", "--protocol", "a", "--plan", "b", "--output-root", "c"], /must be an absolute path/i],
]) {
  test(`parseCliArguments rejects ${label}`, () => {
    assert.throws(() => parseCliArguments(args), pattern);
  });
}

test("parseCapturePlan accepts only two loopback-bound protocol candidates", () => {
  const protocol = protocolFixture();
  const parsed = parseCapturePlan(planFixture(protocol), protocol);
  assert.equal(parsed.protocolDigest, protocol.protocolDigest);
  assert.deepEqual(parsed.candidates.map((candidate) => candidate.candidateId), ["quality", "mobile"]);
});

for (const [label, mutate, pattern] of [
  ["external web origin", (plan) => { plan.webOrigin = "https://example.com"; }, /loopback/i],
  ["wrong protocol", (plan) => { plan.protocolDigest = digest("other"); }, /protocol digest/i],
  ["candidate mismatch", (plan) => { plan.candidates[0].candidateId = "other"; }, /candidate ids/i],
  ["asset-set mismatch", (plan) => { plan.candidates[0].assets[0].sha256 = digest("other"); }, /asset-set digest/i],
  ["frozen profile mismatch", (plan) => { plan.candidates[0].profileId = "wrong-profile"; }, /frozen candidate binding/i],
  ["duplicate asset origin", (plan) => { plan.candidates[1].assetOrigin = plan.candidates[0].assetOrigin; }, /asset origins/i],
  ["unknown key", (plan) => { plan.surprise = true; }, /keys differ/i],
]) {
  test(`parseCapturePlan rejects ${label}`, () => {
    const protocol = protocolFixture();
    const plan = planFixture(protocol);
    mutate(plan);
    assert.throws(() => parseCapturePlan(plan, protocol), pattern);
  });
}

test("parseJsonDocument rejects duplicate keys before JSON.parse can hide them", () => {
  assert.throws(
    () => parseJsonDocument(Buffer.from('{"authority":"none","authority":"hidden"}', "utf8"), "plan"),
    /duplicate key/i,
  );
});

test("validateAssetRequests requires every pinned URL and no unpinned URL", () => {
  const candidate = parseCapturePlan(planFixture(), protocolFixture()).candidates[0];
  const expected = candidate.assets.map((asset) => new URL(asset.requestPath, candidate.assetOrigin).href);
  assert.doesNotThrow(() => validateAssetRequests(candidate, expected));
  assert.throws(() => validateAssetRequests(candidate, expected.slice(1)), /did not request pinned asset/i);
  assert.throws(() => validateAssetRequests(candidate, [...expected, `${candidate.assetOrigin}/other.splat`]), /unpinned asset/i);
});

test("buildCameraQuery carries the frozen camera without a named-view fallback", () => {
  const view = protocolFixture().views[0];
  const query = new URLSearchParams(buildCameraQuery("quality", view, "capture-001"));
  assert.equal(query.get("candidate"), "quality");
  assert.equal(query.get("camera"), "1,2,3");
  assert.equal(query.get("lookAt"), "4,5,6");
  assert.equal(query.get("up"), "0,1,0");
  assert.equal(query.get("fov"), "48");
  assert.equal(query.get("experimentalViewId"), "fireplace-01");
  assert.equal(query.get("capture"), "1");
  assert.equal(query.get("captureNonce"), "capture-001");
  assert.equal(query.has("view"), false);
});

test("buildCaptureReceipt binds a fresh frame and every frozen identity", () => {
  const protocol = protocolFixture();
  const candidate = parseCapturePlan(planFixture(protocol), protocol).candidates[0];
  const view = protocol.views[0];
  const receipt = buildCaptureReceipt({
    protocol,
    candidate,
    view,
    captureOrdinal: 2,
    renderedFrameCounter: 102,
    capturedAtUtc: "2026-07-22T12:00:02.000Z",
    captureId: "quality-fireplace-01-capture-2",
    reloadId: "quality-fireplace-01-reload-2",
    imageSha256: digest("image"),
    captureRunnerSha256: digest("runner"),
    captureProvenance: {
      planSha256: digest("plan"),
      planSizeBytes: 123,
      webOrigin: "http://127.0.0.1:4173",
      servedPageManifestDigest: digest("served-page"),
      captureToolchainDigest: digest("toolchain"),
    },
    telemetry: {
      presentedFrameId: "presented-quality-102",
      rendererFrameDigest: digest("renderer-frame-102"),
      frameEvidence: { renderSequence: 2 },
    },
  });
  assert.equal(receipt.schemaVersion, CAPTURE_RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.cameraDigest, view.cameraDigest);
  assert.equal(receipt.rendererConfigDigest, protocol.rendererBinding.digest);
  assert.equal(receipt.capturePlanSizeBytes, 123);
  assert.equal(receipt.webOrigin, "http://127.0.0.1:4173");
  assert.equal(receipt.servedPageManifestDigest, digest("served-page"));
  assert.equal(receipt.captureToolchainDigest, digest("toolchain"));
  assert.equal(receipt.renderedFrameCounter, 102);
  assert.deepEqual(receipt.frameEvidence, { renderSequence: 2 });
});

test("validateFrameEvidence requires ordinals, counters, and times to increase", () => {
  const valid = [
    { captureOrdinal: 1, renderedFrameCounter: 100, capturedAtUtc: "2026-07-22T12:00:00.000Z", presentedFrameId: "frame-1", rendererFrameDigest: digest("frame-1") },
    { captureOrdinal: 2, renderedFrameCounter: 101, capturedAtUtc: "2026-07-22T12:00:01.000Z", presentedFrameId: "frame-2", rendererFrameDigest: digest("frame-2") },
    { captureOrdinal: 3, renderedFrameCounter: 102, capturedAtUtc: "2026-07-22T12:00:02.000Z", presentedFrameId: "frame-3", rendererFrameDigest: digest("frame-3") },
  ];
  assert.doesNotThrow(() => validateFrameEvidence(valid));
  assert.throws(
    () => validateFrameEvidence(valid.map((item, index) => ({ ...item, renderedFrameCounter: index === 2 ? 101 : item.renderedFrameCounter }))),
    /frame counters/i,
  );
  assert.throws(
    () => validateFrameEvidence(valid.map((item, index) => ({ ...item, captureOrdinal: index + 2 }))),
    /ordinals/i,
  );
});

test("captureAll records three separately identified frames per candidate on the generated page", { timeout: 30_000 }, async () => {
  let fixture = {};
  try {
    fixture = await createBrowserFixture();
    const candidates = await captureAll({
      browser: fixture.browser,
      protocol: fixture.protocol,
      plan: fixture.plan,
      tempRoot: fixture.tempRoot,
      runnerSha256: digest("synthetic-runner"),
      binding: fixture.binding,
      pageApp: fixture.pageApp,
      captureProvenance: fixture.captureProvenance,
    });
    assert.equal(candidates.length, 2);
    const receiptIds = new Set();
    for (const candidate of candidates) {
      assert.equal(candidate.views.length, 1);
      assert.equal(candidate.views[0].captures.length, 3);
      const receipts = [];
      for (const capture of candidate.views[0].captures) {
        const receiptPath = path.join(fixture.tempRoot, ...capture.receipt.path.split("/"));
        const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
        receipts.push(receipt);
        receiptIds.add(receipt.captureId);
      }
      validateFrameEvidence(receipts);
    }
    assert.equal(receiptIds.size, 6);
    assert.deepEqual(fixture.assetRequestCounters.map((counter) => counter.count), [0, 0]);
  } finally {
    await closeBrowserFixture(fixture);
  }
});

test("the capture CLI rejects a handwritten lookalike page at its requested origin", { timeout: 120_000 }, async () => {
  let fixture = {};
  try {
    fixture = await createCliFixture();
    const outputRoot = path.join(fixture.root, "captured-run");
    await assert.rejects(
      runProcess(process.execPath, [
        path.join(REPO_ROOT, "tools", "reception-hd", "run_source_photo_capture.mjs"),
        "--repo-root", REPO_ROOT,
        "--protocol", path.join(fixture.root, "protocol.json"),
        "--plan", fixture.planPath,
        "--output-root", outputRoot,
      ], fixture.environment),
      /occupied or cannot be owned/u,
    );
  } finally {
    await closeCliFixture(fixture);
  }
});
