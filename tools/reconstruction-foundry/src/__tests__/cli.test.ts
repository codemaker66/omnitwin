import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type {
  CandidateGetResult,
  CandidateObjectStore,
  CandidatePutInput,
} from "@omnitwin/reconstruction-foundry";
import {
  FOUNDRY_CLI_USAGE,
  candidateStoreFromEnvironment,
  parseFoundryCliArgs,
  runFoundryCli,
} from "../cli.js";

class UnusedStore implements CandidateObjectStore {
  putIfAbsent(_input: CandidatePutInput): Promise<"created" | "exists"> {
    return Promise.reject(new Error("not used"));
  }

  get(_key: string): Promise<CandidateGetResult> {
    return Promise.resolve({ contentLength: 1, body: Readable.from([Buffer.from("x")]) });
  }
}

describe("Reconstruction Foundry CLI", () => {
  it("parses only the deliberately bounded operator commands", () => {
    expect(parseFoundryCliArgs(["inspect-intake", "--source", "capture-drop"]))
      .toEqual({ kind: "inspect-intake", source: "capture-drop" });
    expect(parseFoundryCliArgs([
      "admit-intake-draft",
      "--receipt", "receipt.json",
      "--review", "review.json",
    ])).toEqual({
      kind: "admit-intake-draft",
      receipt: "receipt.json",
      review: "review.json",
    });
    expect(parseFoundryCliArgs([
      "stage-intake-draft",
      "--source", "capture-drop",
      "--receipt", "receipt.json",
      "--review", "review.json",
      "--out", "stage",
    ])).toEqual({
      kind: "stage-intake-draft",
      source: "capture-drop",
      receipt: "receipt.json",
      review: "review.json",
      out: "stage",
    });
    expect(parseFoundryCliArgs([
      "plan-job-draft",
      "--request", "request.json",
      "--manifest", "manifest.json",
    ])).toEqual({
      kind: "plan-job-draft",
      request: "request.json",
      manifest: "manifest.json",
    });
    expect(parseFoundryCliArgs([
      "verify-training-candidate",
      "--bundle", "candidate",
      "--venue-id", "trades-hall",
      "--run-id", "20260713T120000Z-pod-abc123",
    ])).toEqual({
      kind: "verify-training-candidate",
      bundle: "candidate",
      venueId: "trades-hall",
      runId: "20260713T120000Z-pod-abc123",
    });
    expect(parseFoundryCliArgs(["prepare", "--bundle", "source", "--out", "evidence"]))
      .toEqual({ kind: "prepare", bundle: "source", out: "evidence" });
    expect(parseFoundryCliArgs(["upload-candidate", "--prepared", "evidence"]))
      .toEqual({ kind: "upload-candidate", prepared: "evidence" });
    expect(parseFoundryCliArgs(["verify-candidate", "--prefix", `candidates/hall/${"a".repeat(64)}`]))
      .toEqual({ kind: "verify-candidate", prefix: `candidates/hall/${"a".repeat(64)}` });
    expect(parseFoundryCliArgs(["prepare-signing-request", "--payload", "payload.json", "--out", "request"]))
      .toEqual({ kind: "prepare-signing-request", payload: "payload.json", out: "request" });
    expect(parseFoundryCliArgs([
      "assemble-attestation",
      "--payload", "payload.json",
      "--key-id", "trusted-key",
      "--signature-base64", "YWJjZA==",
      "--out", "envelope.json",
    ])).toEqual({
      kind: "assemble-attestation",
      payload: "payload.json",
      keyId: "trusted-key",
      signatureBase64: "YWJjZA==",
      out: "envelope.json",
    });
    expect(() => parseFoundryCliArgs(["publish", "--prefix", "x"])).toThrow("Unknown Foundry command");
    expect(() => parseFoundryCliArgs([
      "assemble-attestation",
      "--payload", "payload.json",
      "--key-id", "trusted-key",
      "--signature-base64", "YWJjZA==",
      "--out", "envelope.json",
      "--private-key", "secret.pem",
    ])).toThrow("Unknown CLI option");
    expect(() => parseFoundryCliArgs(["prepare", "--bundle", "source", "--out", "x", "--force", "yes"]))
      .toThrow("Unknown CLI option");
    expect(() => parseFoundryCliArgs([
      "stage-intake-draft",
      "--source", "capture-drop",
      "--receipt", "receipt.json",
      "--review", "review.json",
      "--out", "stage",
      "--execute", "yes",
    ])).toThrow("Unknown CLI option");
  });

  it("shows the safety boundary in help", async () => {
    const write = vi.fn<(text: string) => void>();
    await runFoundryCli(["help"], { env: {}, write });
    expect(write).toHaveBeenCalledWith(`${FOUNDRY_CLI_USAGE}\n`);
    expect(FOUNDRY_CLI_USAGE).toContain("no publish, promote, rollback, delete");
    expect(FOUNDRY_CLI_USAGE).toContain("accept no private key");
    expect(FOUNDRY_CLI_USAGE).toContain("non-authoritative draft manifest");
    expect(FOUNDRY_CLI_USAGE).toContain("Planning emits only non-dispatchable JobSpecs");
    expect(FOUNDRY_CLI_USAGE).toContain("untrusted/blocked evidence dossier");
  });

  it("dispatches local intake inspection without requiring cloud credentials", async () => {
    const inspectIntake = vi.fn(() => Promise.resolve({ receiptSha256: "a".repeat(64) }));
    const write = vi.fn<(text: string) => void>();

    await runFoundryCli(["inspect-intake", "--source", "capture-drop"], {
      env: {},
      write,
      inspectIntake,
    });

    expect(inspectIntake).toHaveBeenCalledWith("capture-drop");
    expect(write).toHaveBeenCalledWith(expect.stringContaining(`"receiptSha256": "${"a".repeat(64)}"`));
  });

  it("dispatches draft admission and local staging without cloud credentials", async () => {
    const admitIntake = vi.fn(() => Promise.resolve({ authority: "none" }));
    const stageIntake = vi.fn(() => Promise.resolve({ outputDirectory: "stage" }));
    const write = vi.fn<(text: string) => void>();

    await runFoundryCli([
      "admit-intake-draft",
      "--receipt", "receipt.json",
      "--review", "review.json",
    ], { env: {}, write, admitIntake });
    await runFoundryCli([
      "stage-intake-draft",
      "--source", "capture-drop",
      "--receipt", "receipt.json",
      "--review", "review.json",
      "--out", "stage",
    ], { env: {}, write, stageIntake });

    expect(admitIntake).toHaveBeenCalledWith({
      receiptPath: "receipt.json",
      reviewPath: "review.json",
    });
    expect(stageIntake).toHaveBeenCalledWith({
      sourcePath: "capture-drop",
      receiptPath: "receipt.json",
      reviewPath: "review.json",
      outputDirectory: "stage",
    });
  });

  it("compiles plan-only routing without cloud credentials or execution", async () => {
    const planJob = vi.fn(() => Promise.resolve({
      capabilities: { execution: "not_authorized" },
    }));
    const write = vi.fn<(text: string) => void>();

    await runFoundryCli([
      "plan-job-draft",
      "--request", "request.json",
      "--manifest", "manifest.json",
    ], { env: {}, write, planJob });

    expect(planJob).toHaveBeenCalledWith({
      requestPath: "request.json",
      manifestPath: "manifest.json",
    });
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"execution": "not_authorized"'));
  });

  it("verifies an extracted training candidate locally without cloud credentials", async () => {
    const verifyTrainingCandidate = vi.fn(() => Promise.resolve({
      trustStatus: "untrusted_candidate_verified",
      releaseEligibility: "blocked_missing_control_bindings_and_signature",
    }));
    const write = vi.fn<(text: string) => void>();

    await runFoundryCli([
      "verify-training-candidate",
      "--bundle", "candidate",
      "--venue-id", "trades-hall",
      "--run-id", "20260713T120000Z-pod-abc123",
    ], { env: {}, write, verifyTrainingCandidate });

    expect(verifyTrainingCandidate).toHaveBeenCalledWith({
      bundleRoot: "candidate",
      expectedVenueId: "trades-hall",
      expectedRunId: "20260713T120000Z-pod-abc123",
    });
    expect(write).toHaveBeenCalledWith(expect.stringContaining(
      '"releaseEligibility": "blocked_missing_control_bindings_and_signature"',
    ));
  });

  it("dispatches prepare without requiring cloud credentials", async () => {
    const prepare = vi.fn(() => Promise.resolve({ releaseDigest: "digest" }));
    const write = vi.fn<(text: string) => void>();
    await runFoundryCli(["prepare", "--bundle", "source", "--out", "evidence"], {
      env: {},
      write,
      prepare,
    });
    expect(prepare).toHaveBeenCalledWith({ bundleRoot: "source", outDir: "evidence" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"releaseDigest": "digest"'));
  });

  it("dispatches remote verification through an injected private store", async () => {
    const verify = vi.fn(() => Promise.resolve({ outcome: "passed" }));
    const write = vi.fn<(text: string) => void>();
    const store = new UnusedStore();
    const prefix = `candidates/hall/${"a".repeat(64)}`;
    await runFoundryCli(["verify-candidate", "--prefix", prefix], {
      env: {},
      write,
      createStore: () => store,
      verify,
    });
    expect(verify).toHaveBeenCalledWith({ candidatePrefix: prefix, store });
  });

  it("fails before network access when an R2 credential is missing", () => {
    expect(() => candidateStoreFromEnvironment({})).toThrow("FOUNDRY_R2_ACCOUNT_ID");
  });
});
