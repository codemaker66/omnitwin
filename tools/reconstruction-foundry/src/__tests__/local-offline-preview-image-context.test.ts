import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  LOCAL_OFFLINE_PREVIEW_CONTAINER_FIXED_ENTRYPOINT_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2,
} from "../local-offline-normalization-preview-container-preflight.js";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(
  TEST_DIRECTORY,
  "..",
  "..",
  "scripts",
  "build-offline-preview-image-context.mjs",
);
const PRODUCTION_APPROVAL_PATH = resolve(
  TEST_DIRECTORY,
  "..",
  "..",
  "scripts",
  "offline-preview-image-context-production-approval.generated.mjs",
);

const ARTIFACT_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-worker-artifact.v1";
const GRAPH_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-worker-build-graph.v1";
const IMAGE_CONTEXT_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-image-context.v1";
const WIRE_SOURCE_PATH =
  "packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.ts";
const APPROVAL_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-image-context-production-approval.v1";
const TEST_ONLY_APPROVAL_KIND = "__testOnly_non_authoritative_approval";
const NODE_ARTIFACT_LABEL =
  "io.omnitwin.foundry.runtime.node-artifact-sha256";
const APPROVAL_SCOPE_LABEL =
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.approvalScope;
const QUALIFICATION_STATUS_LABEL =
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.qualificationStatus;

const STATIC_IMPORTS = Object.freeze(["node:crypto", "node:url"]);
const RUNTIME_BUILTINS = Object.freeze([
  "node:crypto",
  "node:module",
  "node:url",
  "url",
]);
const FORBIDDEN_SPECIFIERS = Object.freeze([
  "node:child_process",
  "node:cluster",
  "node:dgram",
  "node:fs",
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:vm",
  "node:worker_threads",
]);

interface GeneratorInput {
  workerArtifactDirectory: string;
  nodeBinaryPath: string;
  busyBoxBinaryPath: string;
  seccompProfilePath: string;
  outputDirectory: string;
}

interface GeneratorSummary {
  readonly status: "unqualified";
  readonly imageDigest: null;
  readonly outputDirectory: string;
  readonly manifestSha256: string;
}

type ProductionGenerator = (input: unknown) => Promise<GeneratorSummary>;
type TestOnlyGenerator = (
  input: unknown,
  approval: unknown,
  options: unknown,
) => Promise<GeneratorSummary>;

interface Fixture {
  readonly root: string;
  readonly artifactDirectory: string;
  readonly workerPath: string;
  readonly graphPath: string;
  readonly artifactPath: string;
  readonly nodePath: string;
  readonly busyBoxPath: string;
  readonly seccompPath: string;
  readonly outputDirectory: string;
  readonly protocolSha256: string;
  readonly workerSha256: string;
  readonly approval: JsonObject;
}

interface JsonObject {
  [key: string]: unknown;
}

const temporaryRoots: string[] = [];
let generateProduction: ProductionGenerator;
let generateTestOnly: TestOnlyGenerator;

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("Unsupported fixture JSON value");
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function makeStaticAmd64Elf(markers: readonly string[], programType = 1): Buffer {
  const headerBytes = 64;
  const programHeaderBytes = 56;
  const markerBytes = Buffer.from(`${markers.join("\0")}\0`, "ascii");
  const bytes = Buffer.alloc(headerBytes + programHeaderBytes + markerBytes.length);
  bytes.set([0x7f, 0x45, 0x4c, 0x46], 0);
  bytes[4] = 2;
  bytes[5] = 1;
  bytes[6] = 1;
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(0x3e, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(0x40_0000n, 24);
  bytes.writeBigUInt64LE(BigInt(headerBytes), 32);
  bytes.writeUInt16LE(headerBytes, 52);
  bytes.writeUInt16LE(programHeaderBytes, 54);
  bytes.writeUInt16LE(1, 56);
  bytes.writeUInt32LE(programType, headerBytes);
  bytes.writeUInt32LE(5, headerBytes + 4);
  bytes.writeBigUInt64LE(0n, headerBytes + 8);
  bytes.writeBigUInt64LE(0x40_0000n, headerBytes + 16);
  bytes.writeBigUInt64LE(0x40_0000n, headerBytes + 24);
  bytes.writeBigUInt64LE(BigInt(bytes.length), headerBytes + 32);
  bytes.writeBigUInt64LE(BigInt(bytes.length), headerBytes + 40);
  bytes.writeBigUInt64LE(0x1000n, headerBytes + 48);
  markerBytes.copy(bytes, headerBytes + programHeaderBytes);
  return bytes;
}

function testGraphInputs(protocolSha256: string): JsonObject[] {
  const records: JsonObject[] = [{
    path: WIRE_SOURCE_PATH,
    sizeBytes: 31,
    sha256: protocolSha256,
  }];
  for (let index = 0; index < 22; index += 1) {
    const suffix = String(index).padStart(2, "0");
    records.push({
      path: `fixtures/offline-preview-image-context-input-${suffix}.ts`,
      sizeBytes: index + 1,
      sha256: sha256(`__testOnly graph input ${suffix}`),
    });
  }
  return records.sort((left, right) => {
    const leftPath = String(left.path);
    const rightPath = String(right.path);
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
}

function validGraph(inputs: readonly JsonObject[]): JsonObject {
  return {
    schemaVersion: GRAPH_SCHEMA,
    inputs,
    staticRuntimeImports: STATIC_IMPORTS,
    declaredRuntimeBuiltins: RUNTIME_BUILTINS,
    forbiddenRuntimeSpecifiers: FORBIDDEN_SPECIFIERS,
    dynamicImportReview: {
      package: "gltf-validator@2.0.0-dev.3.10",
      requestedBuiltin: "url",
      createRequireBannerRequired: true,
    },
  };
}

function validArtifact(
  workerBytes: Uint8Array,
  graphBytes: Uint8Array,
): JsonObject {
  return {
    schemaVersion: ARTIFACT_SCHEMA,
    workerKind: "offline_normalization_preview",
    platform: "linux/amd64",
    builder: {
      hostPlatform: "win32/x64",
      nodeVersion: "v22.18.0",
      esbuildVersion: "0.25.0",
      esbuildShimSha256: sha256("fixture esbuild shim"),
      esbuildPlatformBinarySha256: sha256("fixture esbuild binary"),
      target: "node22.18",
      format: "esm",
      createRequireBannerSha256: sha256("fixture banner"),
    },
    workerBundle: {
      path: "/opt/worker/worker.mjs",
      sizeBytes: workerBytes.byteLength,
      sha256: sha256(workerBytes),
    },
    buildGraph: {
      path: "worker-build-graph.json",
      sizeBytes: graphBytes.byteLength,
      sha256: sha256(graphBytes),
    },
    repeatability: {
      cleanBuildCount: 2,
      byteIdentical: true,
    },
  };
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "offline-preview-image-context-test-"));
  temporaryRoots.push(root);
  const artifactDirectory = join(root, "artifact");
  await mkdir(artifactDirectory);
  const workerBytes = Buffer.from("reviewed worker fixture\n", "utf8");
  const protocolSha256 = sha256("reviewed wire protocol source fixture\n");
  const graphInputs = testGraphInputs(protocolSha256);
  const graphBytes = canonicalBytes(validGraph(graphInputs));
  const artifactBytes = canonicalBytes(validArtifact(workerBytes, graphBytes));
  const workerPath = join(artifactDirectory, "worker.mjs");
  const graphPath = join(artifactDirectory, "worker-build-graph.json");
  const artifactPath = join(artifactDirectory, "artifact.json");
  const nodePath = join(root, "node-linux-amd64-v22.18.0");
  const busyBoxPath = join(root, "busybox-linux-amd64-static");
  const seccompPath = join(root, "seccomp.json");
  const seccompBytes = Buffer.from(`${JSON.stringify({
    defaultAction: "SCMP_ACT_ERRNO",
    defaultErrnoRet: 1,
    syscalls: [{ names: ["read", "write"], action: "SCMP_ACT_ALLOW" }],
  }, null, 2)}\n`, "utf8");
  await Promise.all([
    writeFile(workerPath, workerBytes),
    writeFile(graphPath, graphBytes),
    writeFile(artifactPath, artifactBytes),
    writeFile(nodePath, makeStaticAmd64Elf(["Node.js", "v22.18.0"])),
    writeFile(
      busyBoxPath,
      makeStaticAmd64Elf([
        "BusyBox v1.36.1 (fixture) multi-call binary.",
        "timeout",
      ]),
    ),
    writeFile(seccompPath, seccompBytes),
  ]);
  return {
    root,
    artifactDirectory,
    workerPath,
    graphPath,
    artifactPath,
    nodePath,
    busyBoxPath,
    seccompPath,
    outputDirectory: join(root, "sealed-image-inputs"),
    protocolSha256,
    workerSha256: sha256(workerBytes),
    approval: {
      schemaVersion: APPROVAL_SCHEMA,
      approvalKind: TEST_ONLY_APPROVAL_KIND,
      artifactManifestSha256: sha256(artifactBytes),
      buildGraphSha256: sha256(graphBytes),
      workerBundleSha256: sha256(workerBytes),
      seccompProfileSha256: sha256(seccompBytes),
      buildGraphInputs: graphInputs,
    },
  };
}

function inputFor(fixture: Fixture, outputDirectory = fixture.outputDirectory): GeneratorInput {
  return {
    workerArtifactDirectory: fixture.artifactDirectory,
    nodeBinaryPath: fixture.nodePath,
    busyBoxBinaryPath: fixture.busyBoxPath,
    seccompProfilePath: fixture.seccompPath,
    outputDirectory,
  };
}

function testOnlyOptions(overrides: Partial<{
  failureAfterFileCount: number | null;
  beforePublication: ((stagingPath: string) => Promise<void>) | null;
  afterRenameBeforeVerification: ((outputPath: string) => Promise<void>) | null;
}> = {}): JsonObject {
  return {
    __testOnlyFailureAfterFileCount: overrides.failureAfterFileCount ?? null,
    __testOnlyBeforePublication: overrides.beforePublication ?? null,
    __testOnlyAfterRenameBeforeVerification:
      overrides.afterRenameBeforeVerification ?? null,
    __testOnlyAllowBestAvailablePublication: true,
  };
}

function generateFixture(
  fixture: Fixture,
  input: unknown = inputFor(fixture),
  approval: unknown = fixture.approval,
  options: unknown = testOnlyOptions(),
): Promise<GeneratorSummary> {
  return generateTestOnly(input, approval, options);
}

async function approvalForCurrentSeccomp(fixture: Fixture): Promise<JsonObject> {
  return {
    ...fixture.approval,
    seccompProfileSha256: sha256(await readFile(fixture.seccompPath)),
  };
}

async function rewriteGraph(
  fixture: Fixture,
  update: (graph: JsonObject) => void,
): Promise<void> {
  const graph = JSON.parse(await readFile(fixture.graphPath, "utf8")) as JsonObject;
  update(graph);
  const graphBytes = canonicalBytes(graph);
  const artifact = JSON.parse(await readFile(fixture.artifactPath, "utf8")) as JsonObject;
  artifact.buildGraph = {
    path: "worker-build-graph.json",
    sizeBytes: graphBytes.byteLength,
    sha256: sha256(graphBytes),
  };
  await Promise.all([
    writeFile(fixture.graphPath, graphBytes),
    writeFile(fixture.artifactPath, canonicalBytes(artifact)),
  ]);
}

async function treeBytes(root: string): Promise<ReadonlyMap<string, Buffer>> {
  const result = new Map<string, Buffer>();
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(path, relativePath);
      else result.set(relativePath, await readFile(path));
    }
  }
  await visit(root, "");
  return result;
}

async function stagingDirectories(fixture: Fixture): Promise<string[]> {
  const prefix = `.${basename(fixture.outputDirectory)}.offline-preview-image-context-staging-`;
  const entries = await readdir(fixture.root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => join(fixture.root, entry.name));
}

function assertTreesEqual(
  left: ReadonlyMap<string, Buffer>,
  right: ReadonlyMap<string, Buffer>,
): void {
  expect([...left.keys()]).toEqual([...right.keys()]);
  for (const [path, bytes] of left) {
    expect(right.get(path)?.equals(bytes), path).toBe(true);
  }
}

function staticAstString(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticAstString(node.left);
    const right = staticAstString(node.right);
    return left === null || right === null ? null : `${left}${right}`;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function auditAdversarialCapabilitySnippet(source: string): string | null {
  const sourceFile = ts.createSourceFile(
    "adversarial-image-context-source.mjs",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const forbiddenNames = new Set([
    "EventSource", "Function", "WebSocket", "XMLHttpRequest", "binding",
    "eval", "fetch", "getBuiltinModule", "require", "rm", "rmdir", "unlink",
  ]);
  let violation: string | null = null;
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(node.importClause.namedBindings)) {
      for (const element of node.importClause.namedBindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (["rm", "rmdir", "unlink"].includes(imported)) {
          violation = `destructive import ${imported}`;
        }
      }
    }
    if (ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      violation = "dynamic import";
    }
    if (ts.isIdentifier(node) && forbiddenNames.has(node.text)) {
      violation = `forbidden identifier ${node.text}`;
    }
    if (ts.isIdentifier(node) &&
        ["global", "globalThis", "window"].includes(node.text)) {
      violation = `global capability ${node.text}`;
    }
    if (ts.isIdentifier(node) && node.text === "process") {
      const parent = node.parent;
      const property = ts.isPropertyAccessExpression(parent) &&
          parent.expression === node
        ? parent.name.text
        : ts.isElementAccessExpression(parent) && parent.expression === node &&
            parent.argumentExpression !== undefined
          ? staticAstString(parent.argumentExpression)
          : null;
      if (property === null ||
          !["argv", "exitCode", "platform", "stderr", "stdout", "version"]
            .includes(property)) {
        violation = `process capability ${property ?? "alias"}`;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violation;
}

beforeAll(async () => {
  const imported: unknown = await import(pathToFileURL(SCRIPT_PATH).href);
  if (typeof imported !== "object" || imported === null) {
    throw new Error("Generator module did not export an object");
  }
  const productionCandidate: unknown = Reflect.get(
    imported,
    "generateOfflinePreviewImageContext",
  );
  const testOnlyCandidate: unknown = Reflect.get(
    imported,
    "generateOfflinePreviewImageContext__testOnly",
  );
  if (typeof productionCandidate !== "function" ||
      typeof testOnlyCandidate !== "function") {
    throw new Error("Generator module did not export generateOfflinePreviewImageContext");
  }
  generateProduction = productionCandidate as ProductionGenerator;
  generateTestOnly = testOnlyCandidate as TestOnlyGenerator;
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

describe("offline preview scratch-image context generator", () => {
  it("emits byte-identical sealed inputs with the exact V2 runtime contract", async () => {
    const fixture = await makeFixture();
    const secondOutput = join(fixture.root, "sealed-image-inputs-repeat");
    const first = await generateFixture(fixture);
    const second = await generateFixture(
      fixture,
      inputFor(fixture, secondOutput),
    );

    expect(first).toMatchObject({
      status: "unqualified",
      imageDigest: null,
      outputDirectory: fixture.outputDirectory,
    });
    expect(second).toMatchObject({ status: "unqualified", imageDigest: null });
    assertTreesEqual(
      await treeBytes(fixture.outputDirectory),
      await treeBytes(secondOutput),
    );

    const manifest = JSON.parse(
      await readFile(
        join(fixture.outputDirectory, "offline-preview-image-context-manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.schemaVersion).toBe(IMAGE_CONTEXT_SCHEMA);
    expect(manifest.qualification).toEqual({
      status: "unqualified",
      code: "BUILD_INPUTS_ONLY_NOT_DOCKER_QUALIFIED",
      authority: "none",
      imageDigest: null,
      imageBuilt: false,
      dockerStarted: false,
      sandboxEstablished: false,
      claimStatus: "unauthenticated_integrity_claim",
    });
    expect(manifest.generatorOperations).toEqual({
      childProcessApiInvokedByGenerator: false,
      externalProcessStartedByGenerator: false,
      networkApiInvokedByGenerator: false,
      inputStorageLocality: "not_established",
      inputReadsMayHydrateExternalStorage: true,
    });
    expect(manifest.generatorOperations).not.toHaveProperty(
      "processApiInvokedByGenerator",
    );
    expect(manifest.approval).toEqual({
      scope: TEST_ONLY_APPROVAL_KIND,
      productionApprovalUsed: false,
      testOnlyNonAuthoritative: true,
      scopeSeccompDigestMatched: true,
    });
    expect(manifest.byteDeterminism).toMatchObject({
      byteIdentical: true,
      scope: "relative_paths_and_file_contents_only",
      filesystemMetadataNormalized: false,
      filesystemMetadataDeterminism: "not_established",
      imageDigestDeterminism: "not_established",
    });
    expect(manifest.publication).toMatchObject({
      strictAtomicNoReplaceClaim: false,
      automaticCleanup: false,
      returnedManifestDigestSource: "post_publish_re_read",
      verificationScope: "point_in_time_only",
      pointInTimeVerificationEstablishesSameUserRaceResistance: false,
    });
    expect(first.manifestSha256).toBe(sha256(await readFile(
      join(fixture.outputDirectory, "offline-preview-image-context-manifest.json"),
    )));
    expect(manifest.runtime.entrypoint).toEqual(
      LOCAL_OFFLINE_PREVIEW_CONTAINER_FIXED_ENTRYPOINT_V2,
    );
    expect(manifest.runtime.environment).toEqual(
      LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2,
    );
    expect(manifest.runtime.workingDirectory).toBe(
      LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2,
    );
    expect(manifest.runtime.stopSignal).toBe(
      LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2,
    );
    expect(manifest.bindings.workerArtifactSha256).toBe(fixture.workerSha256);
    expect(manifest.bindings.workerProtocolSha256).toBe(fixture.protocolSha256);
    expect(manifest.bindings.workerProtocolDerivation).toBe(
      "graph_declared_wire_protocol_source_sha256",
    );
    expect(manifest.bindings.workerProtocolSourcePath).toBe(WIRE_SOURCE_PATH);

    const dockerfile = await readFile(
      join(fixture.outputDirectory, "context", "Dockerfile"),
      "utf8",
    );
    const expectedLabels = {
      [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerKind]:
        "offline_normalization_preview",
      [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerProtocolSha256]:
        fixture.protocolSha256,
      [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerArtifactSha256]:
        fixture.workerSha256,
      [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.seccompProfileSha256]:
        sha256(await readFile(fixture.seccompPath)),
      [NODE_ARTIFACT_LABEL]: sha256(await readFile(fixture.nodePath)),
      [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.watchdogArtifactSha256]:
        sha256(await readFile(fixture.busyBoxPath)),
      [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.watchdogMaximumRuntimeMilliseconds]:
        "60000",
      [APPROVAL_SCOPE_LABEL]: "test_only_non_authoritative",
      [QUALIFICATION_STATUS_LABEL]:
        LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2,
    };
    expect(manifest.runtime.labels).toEqual(expectedLabels);
    expect(dockerfile.startsWith("FROM scratch\n")).toBe(true);
    expect(dockerfile).toContain("USER 10001:10001\n");
    expect(dockerfile).toContain("WORKDIR /\n");
    expect(dockerfile).toContain("STOPSIGNAL SIGKILL\n");
    expect(dockerfile).toContain(
      `ENTRYPOINT ${JSON.stringify(LOCAL_OFFLINE_PREVIEW_CONTAINER_FIXED_ENTRYPOINT_V2)}\n`,
    );
    expect(
      dockerfile.match(/^ENV .+$/gmu),
    ).toEqual(
      LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2.map(
        (entry) => `ENV ${entry}`,
      ),
    );
    for (const [key, value] of Object.entries(expectedLabels)) {
      expect(dockerfile).toContain(`LABEL ${key}=${JSON.stringify(value)}\n`);
    }
    expect(dockerfile).toContain(
      "COPY --chmod=0555 busybox /bin/busybox\n",
    );
    expect(dockerfile).toContain(
      "COPY --chmod=0555 node /usr/local/bin/node\n",
    );
    expect(dockerfile).toContain(
      "COPY --chmod=0444 worker.mjs /opt/worker/worker.mjs\n",
    );
    expect(dockerfile).not.toMatch(/^(?:CMD|EXPOSE|VOLUME|HEALTHCHECK)\b/mu);
    expect(
      dockerfile.trimEnd().split("\n").map((line) => line.split(" ", 1)[0]),
    ).toEqual([
      "FROM",
      "COPY",
      "COPY",
      "COPY",
      "ENV",
      "ENV",
      "ENV",
      "ENV",
      "ENV",
      "WORKDIR",
      "STOPSIGNAL",
      "USER",
      "LABEL",
      "LABEL",
      "LABEL",
      "LABEL",
      "LABEL",
      "LABEL",
      "LABEL",
      "LABEL",
      "LABEL",
      "ENTRYPOINT",
    ]);

    expect(manifest.productionConsumptionPolicy).toEqual({
      requiredApprovalScopeLabel:
        LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2,
      requiredBuildQualificationStatusLabel:
        LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2,
      separateLiveQualificationRequired: true,
      separateLiveQualificationBinding:
        "signed_bundled_release_manifest_exact_image_digest_and_report_sha256",
      currentApprovalScopeLabel: "test_only_non_authoritative",
      currentQualificationStatusLabel: "unqualified",
      eligible: false,
    });
    expect(manifest.sourceObservations.graphBindingObservation).toBe(
      "test_scope_exact_23_record_graph_matched",
    );
    expect(dockerfile).toContain(
      `LABEL ${APPROVAL_SCOPE_LABEL}="test_only_non_authoritative"\n`,
    );
    expect(dockerfile).toContain(
      `LABEL ${QUALIFICATION_STATUS_LABEL}="unqualified"\n`,
    );
    expect(dockerfile).not.toContain(
      `LABEL ${APPROVAL_SCOPE_LABEL}="build_owned_production"`,
    );
    expect(dockerfile).not.toContain(
      `LABEL ${QUALIFICATION_STATUS_LABEL}="qualified"`,
    );

    expect(
      await readFile(join(fixture.outputDirectory, "context", ".dockerignore"), "utf8"),
    ).toBe("*\n!Dockerfile\n!busybox\n!node\n!worker.mjs\n");

    expect(
      [...(await treeBytes(join(fixture.outputDirectory, "context"))).keys()],
    ).toEqual([".dockerignore", "Dockerfile", "busybox", "node", "worker.mjs"]);

    const serializedManifest = JSON.stringify(manifest);
    expect(serializedManifest).not.toContain("staticElfVerified");
    expect(serializedManifest).not.toContain("identityVerified");
    expect(manifest.sourceObservations.node).toMatchObject({
      provenanceEstablished: false,
      identityEstablished: false,
    });
    expect(manifest.sourceObservations.binaryProvenanceStatus).toContain(
      "not_established",
    );
  });

  it("keeps the production CLI closed while no seccomp digest is approved", async () => {
    const fixture = await makeFixture();
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        fixture.artifactDirectory,
        fixture.nodePath,
        fixture.busyBoxPath,
        fixture.seccompPath,
        fixture.outputDirectory,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "production generation has no build-owned approved seccomp digest",
    );
    await expect(generateProduction(inputFor(fixture))).rejects.toThrow(
      /no build-owned approved seccomp digest/u,
    );
    await expect(lstat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("pins the reviewed production artifact and exact 23-record graph", async () => {
    const imported: unknown = await import(pathToFileURL(PRODUCTION_APPROVAL_PATH).href);
    if (typeof imported !== "object" || imported === null) {
      throw new Error("Production approval module did not load");
    }
    const approval: unknown = Reflect.get(
      imported,
      "OFFLINE_PREVIEW_IMAGE_CONTEXT_PRODUCTION_APPROVAL",
    );
    expect(approval).toMatchObject({
      approvalKind: "build_owned_generated_production",
      artifactManifestSha256:
        "sha256:c28e80c5db8c724eb4ba7a1c4e60d2e8aa22f597d0f87fa5060fd958f5b33725",
      buildGraphSha256:
        "sha256:0b7fdf7674cdd0645d268e241908f93077c7d952c99db87db554fd9c67f80d77",
      workerBundleSha256:
        "sha256:de2e5a92f9a9b08352fe54fa0ac9c423c4eb6fe8c3e27c88744df82a63870cea",
      seccompProfileSha256: null,
    });
    if (typeof approval !== "object" || approval === null) {
      throw new Error("Production approval export was not an object");
    }
    const inputs: unknown = Reflect.get(approval, "buildGraphInputs");
    expect(Array.isArray(inputs) ? inputs : []).toHaveLength(23);
    expect(inputs).toContainEqual({
      path: WIRE_SOURCE_PATH,
      sha256:
        "sha256:e8fe93d7d375c283764af21a909e00fc9bb09e11e73702068a0a8c429047fa42",
      sizeBytes: 38899,
    });
  });

  it("enforces a parsed production import graph with no process or network API", async () => {
    const expectedImports = new Map<string, ReadonlyMap<string, readonly string[]>>([
      [SCRIPT_PATH, new Map([
        ["./offline-preview-image-context-production-approval.generated.mjs", [
          "OFFLINE_PREVIEW_IMAGE_CONTEXT_PRODUCTION_APPROVAL:OFFLINE_PREVIEW_IMAGE_CONTEXT_PRODUCTION_APPROVAL",
        ]],
        ["node:crypto", ["createHash:createHash", "randomBytes:randomBytes"]],
        ["node:fs", ["constants:fsConstants"]],
        ["node:fs/promises", [
          "lstat:lstat",
          "mkdir:mkdir",
          "open:open",
          "readdir:readdir",
          "realpath:realpath",
          "rename:rename",
        ]],
        ["node:path", [
          "basename:basename",
          "dirname:dirname",
          "isAbsolute:isAbsolute",
          "join:join",
          "normalize:normalize",
          "posix:posix",
          "resolve:resolve",
        ]],
        ["node:url", ["pathToFileURL:pathToFileURL"]],
        ["node:util", ["TextDecoder:TextDecoder", "types:utilTypes"]],
      ])],
      [PRODUCTION_APPROVAL_PATH, new Map()],
    ]);
    const forbiddenIdentifiers = new Set([
      "fetch",
      "WebSocket",
      "XMLHttpRequest",
      "EventSource",
      "require",
      "eval",
      "Function",
      "rm",
      "rmdir",
      "unlink",
      "getBuiltinModule",
      "binding",
    ]);
    const allowedProcessProperties = new Set([
      "argv",
      "exitCode",
      "platform",
      "stderr",
      "stdout",
      "version",
    ]);
    function staticString(node: ts.Expression): string | null {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = staticString(node.left);
        const right = staticString(node.right);
        return left === null || right === null ? null : `${left}${right}`;
      }
      if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
      return null;
    }
    function accessedProperty(node: ts.Node): string | null {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        return parent.name.text;
      }
      if (ts.isElementAccessExpression(parent) && parent.expression === node &&
          parent.argumentExpression !== undefined) {
        return staticString(parent.argumentExpression);
      }
      return null;
    }
    for (const [path, expected] of expectedImports) {
      const source = await readFile(path, "utf8");
      const sourceFile = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.JS,
      );
      const imports = new Map<string, string[]>();
      let forbiddenCall: string | null = null;
      function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier)) {
          const bindings: string[] = [];
          const clause = node.importClause;
          if (clause?.name !== undefined ||
              (clause?.namedBindings !== undefined &&
                !ts.isNamedImports(clause.namedBindings))) {
            forbiddenCall = "default or namespace import";
          } else if (clause?.namedBindings !== undefined) {
            for (const element of clause.namedBindings.elements) {
              bindings.push(
                `${element.propertyName?.text ?? element.name.text}:${element.name.text}`,
              );
            }
          }
          imports.set(node.moduleSpecifier.text, bindings.sort());
        }
        if (ts.isCallExpression(node)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            forbiddenCall = "dynamic import";
          } else if (ts.isIdentifier(node.expression) &&
              forbiddenIdentifiers.has(node.expression.text)) {
            forbiddenCall = node.expression.text;
          }
        }
        if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text)) {
          forbiddenCall = `forbidden capability identifier ${node.text}`;
        }
        if (ts.isIdentifier(node) && node.text === "process") {
          const property = accessedProperty(node);
          if (property === null || !allowedProcessProperties.has(property)) {
            forbiddenCall = `unreviewed process capability ${property ?? "alias"}`;
          }
        }
        if (ts.isIdentifier(node) &&
            ["global", "globalThis", "window"].includes(node.text)) {
          forbiddenCall = `unreviewed global capability ${node.text}`;
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
      expect(forbiddenCall, path).toBeNull();
      expect([...imports.keys()].sort(), path).toEqual([...expected.keys()].sort());
      for (const [specifier, bindings] of expected) {
        expect(imports.get(specifier), `${path}:${specifier}`).toEqual(
          [...bindings].sort(),
        );
      }
    }
  });

  it.each([
    ["computed getBuiltinModule", `process["getBuiltin" + "Module"]("node:fs")`],
    ["process binding", `process["bind" + "ing"]("fs")`],
    ["aliased process", "const p = process; p.getBuiltinModule('node:fs')"],
    ["global computed fetch", `const request = globalThis["fe" + "tch"]`],
    ["aliased fetch", "const request = fetch"],
    ["WebSocket", "const Socket = WebSocket"],
    ["dynamic import", "const modulePromise = import('node:fs')"],
    ["aliased require", "const load = require"],
    ["aliased destructive fs import", "import { rm as preserve } from 'node:fs/promises'"],
  ] as const)("AST capability guard rejects %s", (_name, source) => {
    expect(auditAdversarialCapabilitySnippet(source)).not.toBeNull();
  });

  it("rejects accessors without invoking them", async () => {
    const fixture = await makeFixture();
    let getterReads = 0;
    const unsafe: Record<string, unknown> = {
      workerArtifactDirectory: fixture.artifactDirectory,
      busyBoxBinaryPath: fixture.busyBoxPath,
      seccompProfilePath: fixture.seccompPath,
      outputDirectory: fixture.outputDirectory,
    };
    Object.defineProperty(unsafe, "nodeBinaryPath", {
      enumerable: true,
      get() {
        getterReads += 1;
        return fixture.nodePath;
      },
    });
    await expect(generateFixture(fixture, unsafe)).rejects.toThrow(
      /own enumerable data properties/u,
    );
    expect(getterReads).toBe(0);
    await expect(lstat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects Proxy input before any reflective Proxy trap runs", async () => {
    const fixture = await makeFixture();
    let trapCalls = 0;
    const proxy = new Proxy(inputFor(fixture), {
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("getPrototypeOf trap must not run");
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error("ownKeys trap must not run");
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error("descriptor trap must not run");
      },
    });
    await expect(generateFixture(fixture, proxy)).rejects.toThrow(
      /Proxy objects are not accepted/u,
    );
    expect(trapCalls).toBe(0);
  });

  it("rejects Proxy approval arrays and records before recursive reflective traps", async () => {
    const fixture = await makeFixture();
    const graphInputs = fixture.approval.buildGraphInputs;
    if (!Array.isArray(graphInputs)) throw new Error("Fixture graph inputs missing");
    let arrayTrapCalls = 0;
    const proxyArray = new Proxy([...graphInputs], {
      ownKeys() {
        arrayTrapCalls += 1;
        throw new Error("array ownKeys trap must not run");
      },
    });
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      { ...fixture.approval, buildGraphInputs: proxyArray },
    )).rejects.toThrow(/approval record is invalid/u);
    expect(arrayTrapCalls).toBe(0);

    const first = graphInputs[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("Fixture graph record missing");
    }
    let recordTrapCalls = 0;
    const proxyRecord = new Proxy(first, {
      getPrototypeOf() {
        recordTrapCalls += 1;
        throw new Error("record getPrototypeOf trap must not run");
      },
      ownKeys() {
        recordTrapCalls += 1;
        throw new Error("record ownKeys trap must not run");
      },
    });
    const nestedInputs = [proxyRecord, ...graphInputs.slice(1)];
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      { ...fixture.approval, buildGraphInputs: nestedInputs },
    )).rejects.toThrow(/invalid or unsorted input record/u);
    expect(recordTrapCalls).toBe(0);
  });

  it.each([
    String.raw`\\server\share\node`,
    String.raw`\\?\C:\reviewed\node`,
    String.raw`\\.\PhysicalDrive0`,
  ])("rejects UNC or Windows device input path %s", async (unsafePath) => {
    const fixture = await makeFixture();
    await expect(generateFixture(fixture, {
      ...inputFor(fixture),
      nodeBinaryPath: unsafePath,
    })).rejects.toThrow(/UNC or device path/u);
  });

  it("snapshots caller fields before asynchronous file work", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture);
    const promised = generateFixture(fixture, input);
    input.outputDirectory = join(fixture.root, "mutated-output");
    await promised;
    expect((await lstat(fixture.outputDirectory)).isDirectory()).toBe(true);
    await expect(lstat(input.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symbolic-link artifact directory", async () => {
    const fixture = await makeFixture();
    const linkedArtifact = join(fixture.root, "linked-artifact");
    await symlink(fixture.artifactDirectory, linkedArtifact, "junction");
    await expect(
      generateFixture(fixture, {
        ...inputFor(fixture),
        workerArtifactDirectory: linkedArtifact,
      }),
    ).rejects.toThrow(/symbolic link/u);
  });

  it("rejects a nonregular binary path", async () => {
    const fixture = await makeFixture();
    const directoryInPlaceOfBinary = join(fixture.root, "not-a-binary");
    await mkdir(directoryInPlaceOfBinary);
    await expect(
      generateFixture(fixture, {
        ...inputFor(fixture),
        nodeBinaryPath: directoryInPlaceOfBinary,
      }),
    ).rejects.toThrow(/Node binary must be a regular file/u);
  });

  it("rejects a worker whose bytes no longer match its reviewed manifest", async () => {
    const fixture = await makeFixture();
    await writeFile(fixture.workerPath, "tampered worker\n");
    await expect(generateFixture(fixture)).rejects.toThrow(
      /worker bundle.*does not match/u,
    );
  });

  it("rejects noncanonical or extended artifact manifests", async () => {
    const fixture = await makeFixture();
    const artifact = JSON.parse(await readFile(fixture.artifactPath, "utf8")) as JsonObject;
    artifact.unreviewed = true;
    await writeFile(fixture.artifactPath, canonicalBytes(artifact));
    await expect(generateFixture(fixture)).rejects.toThrow(
      /artifact manifest shape/u,
    );
  });

  it("requires exactly one reviewed wire-protocol source binding", async () => {
    const fixture = await makeFixture();
    await rewriteGraph(fixture, (graph) => {
      graph.inputs = [{
        path: "packages/reconstruction-foundry/src/not-the-wire.ts",
        sizeBytes: 31,
        sha256: fixture.protocolSha256,
      }];
    });
    await expect(generateFixture(fixture)).rejects.toThrow(
      /exactly one reviewed wire protocol source/u,
    );
  });

  it("rejects a fabricated one-entry graph even when internal hashes are rewritten", async () => {
    const fixture = await makeFixture();
    await rewriteGraph(fixture, (graph) => {
      graph.inputs = [{
        path: WIRE_SOURCE_PATH,
        sizeBytes: 31,
        sha256: fixture.protocolSha256,
      }];
    });
    const approvalWithRewrittenArtifactEnvelope = {
      ...fixture.approval,
      artifactManifestSha256: sha256(await readFile(fixture.artifactPath)),
    };
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      approvalWithRewrittenArtifactEnvelope,
    )).rejects.toThrow(
      /exact 23-record graph.*not approved/u,
    );
  });

  it("rejects a wrong injected approval digest", async () => {
    const fixture = await makeFixture();
    const wrongApproval = {
      ...fixture.approval,
      artifactManifestSha256: `sha256:${"0".repeat(64)}`,
    };
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      wrongApproval,
    )).rejects.toThrow(/artifact manifest digest is not approved/u);
  });

  it("rejects the wrong Node version even when it is an amd64 static ELF", async () => {
    const fixture = await makeFixture();
    await writeFile(fixture.nodePath, makeStaticAmd64Elf(["Node.js", "v22.17.0"]));
    await expect(generateFixture(fixture)).rejects.toThrow(/v22\.18\.0/u);
  });

  it("rejects a dynamically linked BusyBox", async () => {
    const fixture = await makeFixture();
    await writeFile(
      fixture.busyBoxPath,
      makeStaticAmd64Elf(
        ["BusyBox v1.36.1 (fixture) multi-call binary.", "timeout"],
        2,
      ),
    );
    await expect(generateFixture(fixture)).rejects.toThrow(/statically linked/u);
  });

  it("rejects a seccomp profile that allows a forbidden network syscall", async () => {
    const fixture = await makeFixture();
    await writeFile(
      fixture.seccompPath,
      JSON.stringify({
        defaultAction: "SCMP_ACT_ERRNO",
        syscalls: [{ names: ["socket"], action: "SCMP_ACT_ALLOW" }],
      }),
    );
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      await approvalForCurrentSeccomp(fixture),
    )).rejects.toThrow(
      /forbidden syscall.*socket/u,
    );
  });

  it.each([
    ["unknown top-level key", {
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [],
      listenerPath: "/tmp/unsafe-listener",
    }, /unknown or unsafe top-level/u],
    ["control character", {
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [{ names: ["read"], action: "SCMP_ACT_ALLOW", comment: "bad\u0001value" }],
    }, /control character/u],
    ["clone3", {
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [{ names: ["clone3"], action: "SCMP_ACT_ERRNO" }],
    }, /rejected syscall clone3/u],
    ["unmasked clone namespaces", {
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [{ names: ["clone"], action: "SCMP_ACT_ALLOW" }],
    }, /does not mask every namespace/u],
    ["new mount API", {
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [{ names: ["fsopen"], action: "SCMP_ACT_ALLOW" }],
    }, /rejected syscall fsopen/u],
    ["io_uring", {
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [{ names: ["io_uring_setup"], action: "SCMP_ACT_ALLOW" }],
    }, /rejected syscall io_uring_setup/u],
  ] as const)("rejects unsafe seccomp structure: %s", async (_name, profile, error) => {
    const fixture = await makeFixture();
    await writeFile(fixture.seccompPath, JSON.stringify(profile));
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      await approvalForCurrentSeccomp(fixture),
    )).rejects.toThrow(error);
  });

  it("preserves both paths and deletes nothing when staging is swapped", async () => {
    const fixture = await makeFixture();
    let displacedPath = "";
    let replacementPath = "";
    const beforePublication = async (stagingPath: string): Promise<void> => {
      displacedPath = `${stagingPath}.displaced`;
      replacementPath = stagingPath;
      await rename(stagingPath, displacedPath);
      await mkdir(replacementPath);
      await writeFile(join(replacementPath, "attacker-owned.txt"), "must remain\n");
    };
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      fixture.approval,
      testOnlyOptions({ beforePublication }),
    )).rejects.toThrow(/identity changed.*preserved and not deleted/u);
    expect((await lstat(displacedPath)).isDirectory()).toBe(true);
    expect(await readFile(join(replacementPath, "attacker-owned.txt"), "utf8"))
      .toBe("must remain\n");
    await expect(lstat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects a nested post-rename swap and preserves the published paths", async () => {
    const fixture = await makeFixture();
    const displacedContext = join(fixture.root, "published-context-displaced");
    const replacementContext = join(fixture.outputDirectory, "context");
    const afterRenameBeforeVerification = async (): Promise<void> => {
      await rename(replacementContext, displacedContext);
      await mkdir(replacementContext);
      await writeFile(join(replacementContext, "attacker-owned.txt"), "preserve\n");
    };
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      fixture.approval,
      testOnlyOptions({ afterRenameBeforeVerification }),
    )).rejects.toThrow(/unexpected or missing entry/u);
    expect((await lstat(displacedContext)).isDirectory()).toBe(true);
    expect(await readFile(
      join(replacementContext, "attacker-owned.txt"),
      "utf8",
    )).toBe("preserve\n");
    expect((await lstat(fixture.outputDirectory)).isDirectory()).toBe(true);
  });

  it("leaves a partial staging directory intact and publishes nothing", async () => {
    const fixture = await makeFixture();
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      fixture.approval,
      testOnlyOptions({ failureAfterFileCount: 2 }),
    )).rejects.toThrow(/partial staging failure.*preserved/u);
    const staging = await stagingDirectories(fixture);
    expect(staging).toHaveLength(1);
    const stagingPath = staging[0];
    if (stagingPath === undefined) throw new Error("Expected preserved staging path");
    expect((await treeBytes(stagingPath)).size).toBe(2);
    await expect(lstat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite an output created immediately before publication", async () => {
    const fixture = await makeFixture();
    const beforePublication = async (): Promise<void> => {
      await mkdir(fixture.outputDirectory);
      await writeFile(join(fixture.outputDirectory, "owner-marker.txt"), "preserve\n");
    };
    await expect(generateFixture(
      fixture,
      inputFor(fixture),
      fixture.approval,
      testOnlyOptions({ beforePublication }),
    )).rejects.toThrow(/output directory already exists/u);
    expect(await readFile(
      join(fixture.outputDirectory, "owner-marker.txt"),
      "utf8",
    )).toBe("preserve\n");
    expect(await stagingDirectories(fixture)).toHaveLength(1);
  });

  it("refuses to overwrite an existing output directory", async () => {
    const fixture = await makeFixture();
    await mkdir(fixture.outputDirectory);
    await expect(generateFixture(fixture)).rejects.toThrow(
      /output directory already exists/u,
    );
  });
});
