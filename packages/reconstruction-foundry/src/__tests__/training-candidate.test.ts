import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TrainingCandidateVerificationV0Schema,
  canonicalTrainingCandidateVerificationJson,
  verifyTrainingCandidateBundle,
} from "../training-candidate.js";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";

const roots: string[] = [];
const VENUE_ID = "trades-hall";
const RUN_ID = "20260713T120000Z-pod-abc123";

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-training-candidate-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verificationDigest(material: unknown): string {
  return `sha256:${domainSeparatedSha256(
    "OMNITWIN_FOUNDRY_TRAINING_CANDIDATE_VERIFICATION_V0",
    toCanonicalJson(material),
  )}`;
}

function gaussianPly(): Buffer {
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "element vertex 1",
    "property float x",
    "property float y",
    "property float z",
    "property float f_dc_0",
    "property float f_dc_1",
    "property float f_dc_2",
    "property float opacity",
    "property float scale_0",
    "property float scale_1",
    "property float scale_2",
    "property float rot_0",
    "property float rot_1",
    "property float rot_2",
    "property float rot_3",
    "end_header",
    "",
  ].join("\n");
  const payload = Buffer.alloc(14 * 4);
  payload.writeFloatLE(1, 10 * 4);
  return Buffer.concat([Buffer.from(header, "ascii"), payload]);
}

async function writeManifest(root: string): Promise<void> {
  const names = (await readdir(root))
    .filter((name) => name !== "manifest.json")
    .sort((left, right) => left.localeCompare(right));
  const files = await Promise.all(names.map(async (name) => {
    const bytes = await readFile(join(root, name));
    return { name, size: bytes.length, sha256: sha256(bytes) };
  }));
  await writeFile(join(root, "manifest.json"), JSON.stringify({
    schema_version: "venviewer.assetbundle.v0",
    venue_id: VENUE_ID,
    run_id: RUN_ID,
    signature: { status: "placeholder", algorithm: null, key_id: null, value: null },
    files,
    total_size: files.reduce((total, file) => total + file.size, 0),
  }, null, 2));
}

async function validBundle(options: { readonly bilateralGrid?: boolean } = {}): Promise<string> {
  const base = await tempRoot();
  const root = join(base, RUN_ID);
  await mkdir(root);
  const bilateralGrid = options.bilateralGrid ?? false;
  await Promise.all([
    writeFile(join(root, "scene.ply"), gaussianPly()),
    writeFile(join(root, "training_config.json"), JSON.stringify({
      config_path: "/workspace/code/configs/training/config_b.yaml",
      config_sha256: "b".repeat(64),
      seed: 42,
      invocation_argv: ["python", "-m", "venviewer_training.simple_trainer_depth", "default"],
      trainer_image: `registry.example/trainer@sha256:${"d".repeat(64)}`,
      max_steps: 1000,
      antialiased: true,
      depth_loss: true,
      depth_lambda: 0.02,
      with_ut: true,
      with_eval3d: true,
      post_processing: bilateralGrid ? "bilateral_grid" : "none",
      sh_degree: 0,
      ...(bilateralGrid ? { bilateral_grid_shape: [2, 2, 2] } : {}),
      strategy: {
        type: "MCMCStrategy",
        cap_max: 5_000_000,
        noise_lr: 500_000,
        refine_start_iter: 100,
        refine_stop_iter: 900,
        refine_every: 100,
        min_opacity: 0.005,
      },
      extra_flags: ["--enable-mip-splatting", "--enable-3dgut"],
    })),
    writeFile(join(root, "training_metrics.jsonl"), [
      JSON.stringify({ step: 500, loss: 0.04, psnr: 20 }),
      JSON.stringify({
        step: 1000,
        loss: 0.02,
        psnr: 24,
        eval_psnr: 23.5,
        eval_ssim: 0.85,
        eval_lpips: 0.18,
      }),
      "",
    ].join("\n")),
    writeFile(join(root, "eval_holdout.json"), JSON.stringify({
      config: { split: "fixed-v1" },
      data: "/workspace/data",
      device: "cuda",
      torch_version: "2.4.1+cu124",
      summary: { psnr: 23.5, ssim: 0.85, lpips: 0.18, fps: null },
      per_image: [{ name: "holdout-001.jpg", psnr: 23.5, ssim: 0.85, lpips: 0.18 }],
    })),
    writeFile(join(root, "hardware.json"), JSON.stringify({
      gpu: "NVIDIA A100-SXM4-80GB",
      device_count: 1,
      torch: "2.4.1+cu124",
      cuda: "12.4",
      driver: "560.35.03",
      trainer_image: `registry.example/trainer@sha256:${"d".repeat(64)}`,
      pod_id: "pod-abc123",
      pod_region: "runpod-eu-ro-1",
    })),
    writeFile(join(root, "git_state.json"), JSON.stringify({
      sha: "a".repeat(40),
      branch: "main",
      remote: "ssh://git.example/omnitwin.git",
      dirty: false,
    })),
    writeFile(join(root, "colmap_input.json"), JSON.stringify({
      n_cameras: 1,
      n_images: 287,
      n_points3D: 198_432,
      image_width: 5472,
      image_height: 3648,
      point_bbox_min: [-12.4, -8.7, -2.1],
      point_bbox_max: [13.1, 9.2, 4.3],
    })),
    ...(bilateralGrid ? [writeFile(join(root, "bilateral_grid.bin"), Buffer.alloc(2 * 2 * 2 * 4))] : []),
  ]);
  await writeManifest(root);
  return root;
}

describe("D-014 training-candidate verification", () => {
  it("deterministically verifies an exact extracted bundle without granting authority", async () => {
    const root = await validBundle();
    const first = await verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    });
    const second = await verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      venueId: VENUE_ID,
      runId: RUN_ID,
      outcome: "valid_untrusted_training_candidate",
      trustStatus: "untrusted_candidate_verified",
      releaseEligibility: "blocked_missing_control_bindings_and_signature",
      authority: "none",
      controlBindings: {
        ingestManifest: "missing_from_legacy_d014_v0",
        jobSpec: "missing_from_legacy_d014_v0",
        providerPlan: "missing_from_legacy_d014_v0",
        attemptLedger: "missing_from_legacy_d014_v0",
        qualityContract: "missing_from_legacy_d014_v0",
      },
      metricRows: 2,
      finalMetricStep: 1000,
      gaussianVertexCount: 1,
      capabilities: {
        localVerification: "completed_verified",
        execution: "not_authorized",
        modelTraining: "not_authorized",
        objectStoreMutation: "not_authorized",
        signing: "not_authorized",
        publication: "not_authorized",
        promotion: "not_authorized",
      },
    });
    expect(first.files.map((file) => file.name)).toEqual([...first.files.map((file) => file.name)].sort());
    expect(TrainingCandidateVerificationV0Schema.parse(first)).toEqual(first);
    expect(canonicalTrainingCandidateVerificationJson(first)).toContain(first.verificationSha256);
  });

  it("rejects impossible self-digested dossiers and derived-digest drift", async () => {
    const root = await validBundle();
    const verified = await verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    });
    const { verificationSha256: _digest, ...material } = verified;
    const withoutManifest = material.files.filter((file) => file.name !== "manifest.json");
    const fabricatedFiles = [...withoutManifest, {
      name: "bilateral_grid.bin" as const,
      sizeBytes: 4,
      sha256: `sha256:${"f".repeat(64)}`,
    }].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const fabricatedMaterial = {
      ...material,
      files: fabricatedFiles,
      totalContentSizeBytes: fabricatedFiles.reduce((total, file) => total + file.sizeBytes, 0),
    };
    expect(TrainingCandidateVerificationV0Schema.safeParse({
      ...fabricatedMaterial,
      verificationSha256: verificationDigest(fabricatedMaterial),
    }).success).toBe(false);

    const contentDrift = { ...material, contentSetSha256: `sha256:${"0".repeat(64)}` };
    expect(TrainingCandidateVerificationV0Schema.safeParse({
      ...contentDrift,
      verificationSha256: verificationDigest(contentDrift),
    }).success).toBe(false);

    const manifestDrift = { ...material, manifestSha256: `sha256:${"1".repeat(64)}` };
    expect(TrainingCandidateVerificationV0Schema.safeParse({
      ...manifestDrift,
      verificationSha256: verificationDigest(manifestDrift),
    }).success).toBe(false);
  });

  it("rejects identity drift, signed-looking producer output, and dossier tampering", async () => {
    const root = await validBundle();
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: "different-hall",
      expectedRunId: RUN_ID,
    })).rejects.toThrow("expected control-plane identity");

    const manifest = JSON.parse((await readFile(join(root, "manifest.json"))).toString("utf8"));
    manifest.signature = {
      status: "signed",
      algorithm: "ed25519",
      key_id: "forged",
      value: "forged",
    };
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("D-014 candidate contract");

    const cleanRoot = await validBundle();
    const verified = await verifyTrainingCandidateBundle({
      bundleRoot: cleanRoot,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    });
    expect(TrainingCandidateVerificationV0Schema.safeParse({
      ...verified,
      metricRows: verified.metricRows + 1,
    }).success).toBe(false);
  });

  it("rejects unaccounted or nested output instead of hashing a partial subset", async () => {
    const unexpected = await validBundle();
    await writeFile(join(unexpected, "trainer.log"), "unaccounted");
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: unexpected,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("Unexpected D-014 candidate file");

    const nested = await validBundle();
    const nestedPath = join(nested, "ckpts");
    await mkdir(nestedPath);
    await writeFile(join(nestedPath, "checkpoint.pt"), "unaccounted");
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: nested,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("only its exact top-level contract files");
  });

  it("rejects byte tampering even when the changed file keeps the same size", async () => {
    const root = await validBundle();
    const path = join(root, "scene.ply");
    const bytes = await readFile(path);
    bytes[bytes.length - 1] = 1;
    await writeFile(path, bytes);

    await expect(verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("does not match manifest.json");
  });

  it("rejects content files with aliases outside the candidate root", async () => {
    const root = await validBundle();
    await link(join(root, "scene.ply"), join(dirname(root), "scene-alias.ply"));
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("additional hard links");
  });

  it("rejects semantically invalid metrics even when the manifest hashes them", async () => {
    const root = await validBundle();
    await writeFile(join(root, "training_metrics.jsonl"), [
      JSON.stringify({ step: 500, loss: 0.04 }),
      JSON.stringify({ step: 500, loss: 0.03 }),
      "",
    ].join("\n"));
    await writeManifest(root);

    await expect(verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("strictly increasing step");

    const incomplete = await validBundle();
    await writeFile(join(incomplete, "training_metrics.jsonl"), `${JSON.stringify({
      step: 500,
      loss: 0.04,
    })}\n`);
    await writeManifest(incomplete);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: incomplete,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("must equal training_config.max_steps");

    const duplicateKey = await validBundle();
    await writeFile(join(duplicateKey, "training_metrics.jsonl"), [
      '{"step":999,"step":1,"loss":0.04}',
      JSON.stringify({
        step: 1000,
        loss: 0.02,
        eval_psnr: 23.5,
        eval_ssim: 0.85,
        eval_lpips: 0.18,
      }),
      "",
    ].join("\n"));
    await writeManifest(duplicateKey);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: duplicateKey,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("duplicate object key");
  });

  it("rejects a merely PLY-looking scene that is not a gsplat binary artifact", async () => {
    const root = await validBundle();
    await writeFile(join(root, "scene.ply"), "ply\nformat ascii 1.0\nelement vertex 1\nend_header\n0 0 0\n");
    await writeManifest(root);

    await expect(verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("binary_little_endian");

    const truncated = await validBundle();
    const bytes = await readFile(join(truncated, "scene.ply"));
    await writeFile(join(truncated, "scene.ply"), bytes.subarray(0, bytes.length - 4));
    await writeManifest(truncated);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: truncated,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("payload size must exactly match");

    const wrongDegree = await validBundle();
    const configPath = join(wrongDegree, "training_config.json");
    const config = JSON.parse((await readFile(configPath)).toString("utf8"));
    config.sh_degree = 1;
    await writeFile(configPath, JSON.stringify(config));
    await writeManifest(wrongDegree);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: wrongDegree,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("exact gsplat float32 property order for sh_degree=1");

    const commentTerminator = await validBundle();
    const commentPath = join(commentTerminator, "scene.ply");
    const commentBytes = await readFile(commentPath);
    const malformed = Buffer.from(commentBytes.toString("binary").replace(
      "end_header\n",
      "comment end_header\n",
    ), "binary");
    await writeFile(commentPath, malformed);
    await writeManifest(commentTerminator);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: commentTerminator,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("exact standalone end_header line");

    const mixedTerminator = await validBundle();
    const mixedPath = join(mixedTerminator, "scene.ply");
    const mixedBytes = await readFile(mixedPath);
    const injected = Buffer.from(mixedBytes.toString("binary").replace(
      "end_header\n",
      "end_header\r\n\nend_header\n",
    ), "binary");
    await writeFile(mixedPath, injected);
    await writeManifest(mixedTerminator);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: mixedTerminator,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("payload size must exactly match");
  });

  it("streams every Gaussian value and rejects NaN or a zero rotation quaternion", async () => {
    const nonfinite = await validBundle();
    const nonfinitePath = join(nonfinite, "scene.ply");
    const nonfiniteBytes = await readFile(nonfinitePath);
    const payloadOffset = nonfiniteBytes.indexOf(Buffer.from("end_header\n")) + "end_header\n".length;
    nonfiniteBytes.writeFloatLE(Number.NaN, payloadOffset);
    await writeFile(nonfinitePath, nonfiniteBytes);
    await writeManifest(nonfinite);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: nonfinite,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("non-finite Gaussian value");

    const zeroRotation = await validBundle();
    const rotationPath = join(zeroRotation, "scene.ply");
    const rotationBytes = await readFile(rotationPath);
    const rotationPayloadOffset = rotationBytes.indexOf(Buffer.from("end_header\n")) + "end_header\n".length;
    rotationBytes.writeFloatLE(0, rotationPayloadOffset + 10 * 4);
    await writeFile(rotationPath, rotationBytes);
    await writeManifest(zeroRotation);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: zeroRotation,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("zero-length Gaussian rotation quaternion");
  });

  it("rejects duplicate JSON keys and byte-order marks before schema parsing", async () => {
    const duplicate = await validBundle();
    const configPath = join(duplicate, "training_config.json");
    const config = (await readFile(configPath)).toString("utf8");
    await writeFile(configPath, config.replace('"max_steps":1000', '"max_steps":1000,"max_steps":1000'));
    await writeManifest(duplicate);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: duplicate,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("duplicate object key");

    const bom = await validBundle();
    const hardwarePath = join(bom, "hardware.json");
    await writeFile(hardwarePath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      await readFile(hardwarePath),
    ]));
    await writeManifest(bom);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: bom,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("byte-order mark");
  });

  it("rejects whitespace hardware placeholders and out-of-range evaluation values", async () => {
    const whitespace = await validBundle();
    const hardwarePath = join(whitespace, "hardware.json");
    const hardware = JSON.parse((await readFile(hardwarePath)).toString("utf8"));
    hardware.gpu = "   ";
    await writeFile(hardwarePath, JSON.stringify(hardware));
    await writeManifest(whitespace);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: whitespace,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("D-014 candidate contract");

    const overflow = await validBundle();
    const evaluationPath = join(overflow, "eval_holdout.json");
    const evaluation = JSON.parse((await readFile(evaluationPath)).toString("utf8"));
    evaluation.summary.psnr = 1e308;
    evaluation.per_image[0].psnr = 1e308;
    await writeFile(evaluationPath, JSON.stringify(evaluation));
    await writeManifest(overflow);
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: overflow,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("D-014 candidate contract");
  });

  it("fails closed on bilateral-grid candidates until serialization is specified", async () => {
    const root = await validBundle({ bilateralGrid: true });
    await expect(verifyTrainingCandidateBundle({
      bundleRoot: root,
      expectedVenueId: VENUE_ID,
      expectedRunId: RUN_ID,
    })).rejects.toThrow("view count, channels, layout, dtype, endian, and serialization");
  });
});
