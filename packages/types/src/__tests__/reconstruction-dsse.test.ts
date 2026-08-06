import { describe, expect, it } from "vitest";
import {
  RECONSTRUCTION_DSSE_MAX_SIGNATURES,
  ReconstructionDsseEnvelopeSchema,
} from "../reconstruction-dsse.js";
import {
  ReconstructionDsseEnvelopeSchema as BroadReleaseEnvelopeSchema,
} from "../reconstruction-release.js";

const SIGNATURE = Buffer.alloc(64, 7).toString("base64");

describe("narrow reconstruction DSSE surface", () => {
  it("is the exact schema re-exported by the broad release module", () => {
    expect(BroadReleaseEnvelopeSchema).toBe(ReconstructionDsseEnvelopeSchema);
    expect(RECONSTRUCTION_DSSE_MAX_SIGNATURES).toBe(16);
  });

  it("accepts one canonical Ed25519 signature", () => {
    expect(ReconstructionDsseEnvelopeSchema.parse({
      payloadType: "application/vnd.in-toto+json",
      payload: Buffer.from("{}", "utf8").toString("base64"),
      signatures: [{ keyid: "release-key", sig: SIGNATURE }],
    })).toEqual({
      payloadType: "application/vnd.in-toto+json",
      payload: "e30=",
      signatures: [{ keyid: "release-key", sig: SIGNATURE }],
    });
  });

  it("rejects duplicate keys, non-canonical base64, and wrong signature size", () => {
    const validSignature = { keyid: "release-key", sig: SIGNATURE };
    expect(ReconstructionDsseEnvelopeSchema.safeParse({
      payloadType: "application/vnd.in-toto+json",
      payload: "e31=",
      signatures: [validSignature],
    }).success).toBe(false);
    expect(ReconstructionDsseEnvelopeSchema.safeParse({
      payloadType: "application/vnd.in-toto+json",
      payload: "e30=",
      signatures: [validSignature, validSignature],
    }).success).toBe(false);
    expect(ReconstructionDsseEnvelopeSchema.safeParse({
      payloadType: "application/vnd.in-toto+json",
      payload: "e30=",
      signatures: [{ keyid: "release-key", sig: Buffer.alloc(63).toString("base64") }],
    }).success).toBe(false);
  });
});
