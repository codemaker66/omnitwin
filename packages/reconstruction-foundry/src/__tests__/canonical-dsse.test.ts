import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { domainSeparatedSha256, stableCanonicalJson } from "../canonical-json.js";
import { verifyDsseEnvelope } from "../dsse.js";

function pae(payloadType: string, payload: Buffer): Buffer {
  const type = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${String(type.length)} `, "ascii"),
    type,
    Buffer.from(` ${String(payload.length)} `, "ascii"),
    payload,
  ]);
}

describe("canonical release evidence", () => {
  it("sorts object keys and domain-separates release digests", () => {
    expect(stableCanonicalJson({ z: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"z":1}');
    const value = { digest: "a".repeat(64) } as const;
    expect(domainSeparatedSha256("VENVIEWER_RELEASE_V1", value)).toHaveLength(64);
    expect(domainSeparatedSha256("VENVIEWER_RELEASE_V1", value)).not.toBe(
      domainSeparatedSha256("VENVIEWER_QA_V1", value),
    );
  });

  it("verifies an Ed25519 DSSE envelope against a pinned payload digest", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const payloadType = "application/vnd.venviewer.reconstruction-release.v1+json";
    const payload = Buffer.from('{"release":"ok"}', "utf8");
    const signature = sign(null, pae(payloadType, payload), privateKey);
    const result = verifyDsseEnvelope({
      payloadType,
      payload: payload.toString("base64"),
      signatures: [{ keyid: "test-key", sig: signature.toString("base64") }],
    }, new Map([["test-key", publicKey]]), {
      payloadType,
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
    });
    expect(result.verifiedKeyIds).toEqual(["test-key"]);
    expect(Buffer.from(result.payload)).toEqual(payload);
  });

  it("fails closed for untrusted or tampered DSSE evidence", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const payloadType = "application/vnd.venviewer.reconstruction-release.v1+json";
    const payload = Buffer.from("payload", "utf8");
    const signature = sign(null, pae(payloadType, payload), privateKey);
    expect(() => verifyDsseEnvelope({
      payloadType,
      payload: payload.toString("base64"),
      signatures: [{ keyid: "unknown", sig: signature.toString("base64") }],
    }, new Map(), {
      payloadType,
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
    })).toThrow("no valid signature");
  });

  it("rejects non-canonical signature pad bits before verification", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const payload = Buffer.from("payload", "utf8");
    expect(() => verifyDsseEnvelope({
      payloadType: "application/vnd.in-toto+json",
      payload: payload.toString("base64"),
      signatures: [{ keyid: "test-key", sig: `${Buffer.alloc(63).toString("base64")}AR==` }],
    }, new Map([["test-key", publicKey]]), {
      payloadType: "application/vnd.in-toto+json",
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
    })).toThrow("canonical base64");
  });

  it("rejects private and non-Ed25519 trusted keys", () => {
    const ed25519 = generateKeyPairSync("ed25519");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const payloadType = "application/vnd.in-toto+json";
    const payload = Buffer.from("payload", "utf8");
    const signature = sign(null, pae(payloadType, payload), ed25519.privateKey).toString("base64");
    const envelope = {
      payloadType,
      payload: payload.toString("base64"),
      signatures: [{ keyid: "test-key", sig: signature }],
    };
    const expected = {
      payloadType,
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
    };
    expect(() => verifyDsseEnvelope(
      envelope,
      new Map([["test-key", ed25519.privateKey]]),
      expected,
    )).toThrow("public keys only");
    expect(() => verifyDsseEnvelope(
      envelope,
      new Map([["test-key", rsa.publicKey]]),
      expected,
    )).toThrow("Ed25519 public key");
  });
});
