import { readFile } from "node:fs/promises";
import { sha256Bytes } from "../hash.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0,
  FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
  FoundryNormalizeMeshGlbReportV0Schema,
  __testOnlyNormalizeMeshGlbBytes,
  computeFoundryNormalizeMeshGlbInvocationSha256,
  computeFoundryNormalizeMeshGlbReportSha256,
  runFoundryNormalizeMeshGlbWorker,
  verifyFoundryNormalizeMeshGlbProof,
  type FoundryNormalizeMeshGlbInvocationV0,
  type FoundryNormalizeMeshGlbReportV0,
  type RunFoundryNormalizeMeshGlbWorkerOptions,
} from "../normalize-mesh-glb-worker.js";
import { glbFixture } from "./fixture.js";
import { describe, expect, it } from "vitest";

function invocation(bytes: Uint8Array): FoundryNormalizeMeshGlbInvocationV0 {
  return {
    schemaVersion: FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0,
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    executionMode: "test_only_pure_core_proof",
    source: {
      assetId: "fixture-mesh",
      inputType: "glb_gltf",
      mediaType: "model/gltf-binary",
      sizeBytes: bytes.byteLength,
      sha256: `sha256:${sha256Bytes(bytes)}`,
    },
    authority: "none",
  };
}

function readJson(bytes: Buffer): Record<string, unknown> {
  const jsonLength = bytes.readUInt32LE(12);
  const text = bytes
    .subarray(20, 20 + jsonLength)
    .toString("utf8")
    .replace(/ +$/u, "");
  return JSON.parse(text) as Record<string, unknown>;
}

function rewriteJson(
  bytes: Buffer,
  mutate: (json: Record<string, unknown>) => void,
): Buffer {
  const jsonLength = bytes.readUInt32LE(12);
  const binaryHeader = 20 + jsonLength;
  const binaryLength = bytes.readUInt32LE(binaryHeader);
  const binary = bytes.subarray(
    binaryHeader + 8,
    binaryHeader + 8 + binaryLength,
  );
  const json = readJson(bytes);
  mutate(json);
  const encoded = Buffer.from(JSON.stringify(json), "utf8");
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
  encoded.copy(padded);
  const output = Buffer.alloc(20 + padded.length + 8 + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  const outputBinaryHeader = 20 + padded.length;
  output.writeUInt32LE(binary.length, outputBinaryHeader);
  output.writeUInt32LE(0x004e4942, outputBinaryHeader + 4);
  binary.copy(output, outputBinaryHeader + 8);
  return output;
}

function resignReport(
  report: FoundryNormalizeMeshGlbReportV0,
  mutate: (
    payload: Omit<FoundryNormalizeMeshGlbReportV0, "reportSha256">,
  ) => void,
): FoundryNormalizeMeshGlbReportV0 {
  const cloned = structuredClone(report);
  const { reportSha256: _reportSha256, ...payload } = cloned;
  mutate(payload);
  return FoundryNormalizeMeshGlbReportV0Schema.parse({
    ...payload,
    reportSha256: computeFoundryNormalizeMeshGlbReportSha256(payload),
  });
}

describe.sequential("sealed normalize_mesh_glb/v0 proof", () => {
  it("contains no path IO, process spawning, network client, or lossy transform helper", async () => {
    const source = await readFile(
      new URL("../normalize-mesh-glb-worker.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /from\s+["'](?:node:(?:child_process|fs|http|https|net|path|tls|worker_threads)|@gltf-transform\/functions)["']/u,
    );
    expect(source).not.toMatch(
      /\b(?:fetch|meshopt|quantize|reorder|simplify|weld|prune|dedup)\s*\(/u,
    );
    expect(source).not.toContain("NodeIO");
    expect(source).not.toContain("WebIO");
  });

  it("keeps the production entrypoint disabled before it observes any option", () => {
    const observed: string[] = [];
    const options = new Proxy(
      {},
      {
        get: (_target, key) => {
          observed.push(String(key));
          return undefined;
        },
      },
    ) as RunFoundryNormalizeMeshGlbWorkerOptions;
    let thrown: unknown;
    try {
      runFoundryNormalizeMeshGlbWorker(options);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: "NORMALIZE_MESH_GLB_PRODUCTION_BINDING_UNAVAILABLE",
      message: expect.stringContaining(
        "reviewed verified-stage, manifest, admission, JobSpec, fence, and purpose-aware rights bindings are unavailable",
      ),
    });
    expect(observed).toEqual([]);
  });

  it("manually meshopt-compresses the strict static subset and proves exact decoded semantics", async () => {
    const source = glbFixture();
    const result = await __testOnlyNormalizeMeshGlbBytes(
      invocation(source),
      source,
    );
    const outputJson = readJson(result.normalizedGlb);

    expect(outputJson.extensionsUsed).toEqual(["EXT_meshopt_compression"]);
    expect(outputJson.extensionsRequired).toEqual(["EXT_meshopt_compression"]);
    expect(result.report).toMatchObject({
      authority: "none",
      semanticProof: {
        exactMatch: true,
        accessorCount: 2,
        compressedBufferViewCount: 2,
      },
      validation: {
        before: { errors: 0, warnings: 0 },
        after: { errors: 0, warnings: 0 },
      },
      transform: {
        extension: "EXT_meshopt_compression",
        required: true,
        encoderMethod: "quantize",
        meshoptFilter: "NONE",
      },
    });
    expect(result.report.semanticProof.beforeSha256).toBe(
      result.report.semanticProof.afterSha256,
    );
    expect(FoundryNormalizeMeshGlbReportV0Schema.parse(result.report)).toEqual(
      result.report,
    );
    await expect(
      verifyFoundryNormalizeMeshGlbProof({
        invocation: invocation(source),
        sourceBytes: source,
        normalizedGlb: result.normalizedGlb,
        report: result.report,
      }),
    ).resolves.toBeUndefined();
  });

  it("is byte-deterministic for the pinned fixture and invocation", async () => {
    const source = glbFixture();
    const first = await __testOnlyNormalizeMeshGlbBytes(
      invocation(source),
      source,
    );
    const second = await __testOnlyNormalizeMeshGlbBytes(
      invocation(source),
      source,
    );
    expect(second.normalizedGlb).toEqual(first.normalizedGlb);
    expect(second.report).toEqual(first.report);
  });

  it("rejects source bytes that do not match the exact invocation hash and size", async () => {
    const source = glbFixture();
    const changed = Buffer.from(source);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    await expect(
      __testOnlyNormalizeMeshGlbBytes(invocation(source), changed),
    ).rejects.toThrow("exact size and SHA-256 binding");
  });

  it.each([
    [
      "extras",
      (json: Record<string, unknown>) => {
        (json.nodes as Array<Record<string, unknown>>)[0] = {
          ...(json.nodes as Array<Record<string, unknown>>)[0],
          extras: { hidden: true },
        };
      },
    ],
    [
      "material",
      (json: Record<string, unknown>) => {
        json.materials = [{ pbrMetallicRoughness: {} }];
      },
    ],
    [
      "non-identity transform",
      (json: Record<string, unknown>) => {
        (json.nodes as Array<Record<string, unknown>>)[0] = {
          ...(json.nodes as Array<Record<string, unknown>>)[0],
          translation: [0.000001, 0, 0],
        };
      },
    ],
    [
      "matrix transform",
      (json: Record<string, unknown>) => {
        (json.nodes as Array<Record<string, unknown>>)[0] = {
          ...(json.nodes as Array<Record<string, unknown>>)[0],
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        };
      },
    ],
    [
      "unsigned-byte indices",
      (json: Record<string, unknown>) => {
        (json.accessors as Array<Record<string, unknown>>)[1] = {
          ...(json.accessors as Array<Record<string, unknown>>)[1],
          componentType: 5121,
        };
      },
    ],
    [
      "input extension",
      (json: Record<string, unknown>) => {
        json.extensionsUsed = ["EXT_meshopt_compression"];
      },
    ],
  ] as const)(
    "rejects unsupported %s semantics instead of silently rewriting them",
    async (_label, mutate) => {
      const source = rewriteJson(glbFixture(), mutate);
      await expect(
        __testOnlyNormalizeMeshGlbBytes(invocation(source), source),
      ).rejects.toBeDefined();
    },
  );

  it("rejects non-GLB bytes and keeps the pure core test-only", async () => {
    const source = Buffer.from("not a glb", "utf8");
    await expect(
      __testOnlyNormalizeMeshGlbBytes(invocation(source), source),
    ).rejects.toThrow();

    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(
        __testOnlyNormalizeMeshGlbBytes(invocation(glbFixture()), glbFixture()),
      ).rejects.toThrow("available only when NODE_ENV=test");
    } finally {
      process.env.NODE_ENV = prior;
    }
  });

  it("does not export the test-only transformer from the package root", async () => {
    const root = await import("../index.js");
    expect("__testOnlyNormalizeMeshGlbBytes" in root).toBe(false);
  });

  it("rejects a self-digested proof whose invocation and report lie about the source bytes", async () => {
    const source = glbFixture();
    const goodInvocation = invocation(source);
    const result = await __testOnlyNormalizeMeshGlbBytes(
      goodInvocation,
      source,
    );
    const badInvocation: FoundryNormalizeMeshGlbInvocationV0 = {
      ...goodInvocation,
      source: {
        ...goodInvocation.source,
        sizeBytes: source.length + 1,
        sha256: `sha256:${"0".repeat(64)}`,
      },
    };
    const badReport = resignReport(result.report, (payload) => {
      payload.source = badInvocation.source;
      payload.invocationSha256 =
        computeFoundryNormalizeMeshGlbInvocationSha256(badInvocation);
    });
    await expect(
      verifyFoundryNormalizeMeshGlbProof({
        invocation: badInvocation,
        sourceBytes: source,
        normalizedGlb: result.normalizedGlb,
        report: badReport,
      }),
    ).rejects.toMatchObject({
      code: "NORMALIZE_MESH_GLB_PROOF_BINDING_MISMATCH",
    });
  });

  it("freshly recomputes reported semantic counts and validator versions", async () => {
    const source = glbFixture();
    const sourceInvocation = invocation(source);
    const result = await __testOnlyNormalizeMeshGlbBytes(
      sourceInvocation,
      source,
    );
    const badCounts = resignReport(result.report, (payload) => {
      payload.semanticProof.accessorCount = 99;
      payload.semanticProof.compressedBufferViewCount = 99;
    });
    await expect(
      verifyFoundryNormalizeMeshGlbProof({
        invocation: sourceInvocation,
        sourceBytes: source,
        normalizedGlb: result.normalizedGlb,
        report: badCounts,
      }),
    ).rejects.toMatchObject({
      code: "NORMALIZE_MESH_GLB_PROOF_SEMANTIC_MISMATCH",
    });

    const badValidator = resignReport(result.report, (payload) => {
      payload.validation.before.version = "forged-validator";
      payload.validation.after.version = "forged-validator";
    });
    await expect(
      verifyFoundryNormalizeMeshGlbProof({
        invocation: sourceInvocation,
        sourceBytes: source,
        normalizedGlb: result.normalizedGlb,
        report: badValidator,
      }),
    ).rejects.toMatchObject({
      code: "NORMALIZE_MESH_GLB_PROOF_VALIDATION_MISMATCH",
    });
  });

  it("rejects hostile decoded-view lengths before allocation or meshopt decode", async () => {
    const source = glbFixture();
    const sourceInvocation = invocation(source);
    const result = await __testOnlyNormalizeMeshGlbBytes(
      sourceInvocation,
      source,
    );
    const hostileOutput = rewriteJson(result.normalizedGlb, (json) => {
      const views = json.bufferViews as Array<Record<string, unknown>>;
      if (views[0] !== undefined)
        views[0].byteLength = FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES + 1;
    });
    const hostileReport = resignReport(result.report, (payload) => {
      payload.output.sizeBytes = hostileOutput.length;
      payload.output.sha256 = `sha256:${sha256Bytes(hostileOutput)}`;
    });
    await expect(
      verifyFoundryNormalizeMeshGlbProof({
        invocation: sourceInvocation,
        sourceBytes: source,
        normalizedGlb: hostileOutput,
        report: hostileReport,
      }),
    ).rejects.toMatchObject({ code: "NORMALIZE_MESH_GLB_RESOURCE_BOUNDS" });
  });

  it("independently derives POSITION bounds and rejects forged output metadata", async () => {
    const source = glbFixture();
    const sourceInvocation = invocation(source);
    const result = await __testOnlyNormalizeMeshGlbBytes(
      sourceInvocation,
      source,
    );
    const hostileOutput = rewriteJson(result.normalizedGlb, (json) => {
      const accessors = json.accessors as Array<Record<string, unknown>>;
      if (accessors[0] !== undefined) accessors[0].max = [999, 999, 999];
    });
    const hostileReport = resignReport(result.report, (payload) => {
      payload.output.sizeBytes = hostileOutput.length;
      payload.output.sha256 = `sha256:${sha256Bytes(hostileOutput)}`;
    });
    await expect(
      verifyFoundryNormalizeMeshGlbProof({
        invocation: sourceInvocation,
        sourceBytes: source,
        normalizedGlb: hostileOutput,
        report: hostileReport,
      }),
    ).rejects.toMatchObject({ code: "NORMALIZE_MESH_GLB_ACCESSOR_BOUNDS" });
  });

  it("caps declared report output bytes before public verification can copy them", async () => {
    const source = glbFixture();
    const result = await __testOnlyNormalizeMeshGlbBytes(
      invocation(source),
      source,
    );
    expect(() =>
      resignReport(result.report, (payload) => {
        payload.output.sizeBytes = FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES + 1;
      }),
    ).toThrow();
  });
});
