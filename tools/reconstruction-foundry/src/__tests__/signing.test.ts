import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CanonicalJsonValueSchema,
  RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION,
  RECONSTRUCTION_ATTESTATION_PREDICATE_TYPE,
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  RECONSTRUCTION_IN_TOTO_STATEMENT_TYPE,
  RECONSTRUCTION_SIGNING_PAYLOAD_SCHEMA_VERSION,
  ReconstructionDsseEnvelopeSchema,
  ReconstructionReleaseSigningPayloadSchema,
  stableCanonicalJson,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  DSSE_PAE_FILE_NAME,
  assembleAttestation,
  prepareSigningRequest,
} from "../signing.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function signingPayloadFixture(): Promise<{
  readonly directory: string;
  readonly path: string;
  readonly payloadUtf8: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "foundry-signing-"));
  cleanup.push(directory);
  const releaseDigest = "a".repeat(64);
  const statement = {
    _type: RECONSTRUCTION_IN_TOTO_STATEMENT_TYPE,
    subject: [{ name: `reconstruction-release/trades-hall/${releaseDigest}`, digest: { sha256: releaseDigest } }],
    predicateType: RECONSTRUCTION_ATTESTATION_PREDICATE_TYPE,
    predicate: {
      schemaVersion: RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION,
      venueSlug: "trades-hall",
      releaseKind: "venue_twin_v1",
      releaseId: "10000000-0000-4000-8000-000000000001",
      releaseDigest,
      sourceManifestSha256: "b".repeat(64),
      releaseManifestSha256: "c".repeat(64),
      qaReportDigest: "d".repeat(64),
      reviewId: "20000000-0000-4000-8000-000000000002",
      reviewDigest: "e".repeat(64),
      reviewedAt: "2026-07-11T08:00:00.000Z",
      reviewerUserId: "30000000-0000-4000-8000-000000000003",
      decision: "approved",
      targetExposure: "public",
      visualEvidence: [{ label: "review board", objectKey: "candidates/trades-hall/evidence/review.webp", sha256: "f".repeat(64) }],
      transformArtifactRef: { artifactId: "transform-v1", artifactDigest: "1".repeat(64) },
      sceneAuthorityMapRef: { artifactId: "scene-map-v1", artifactDigest: "2".repeat(64) },
    },
  };
  const payloadUtf8 = JSON.stringify(statement, null, 2);
  const bytes = Buffer.from(payloadUtf8, "utf8");
  const payload = ReconstructionReleaseSigningPayloadSchema.parse({
    schemaVersion: RECONSTRUCTION_SIGNING_PAYLOAD_SCHEMA_VERSION,
    payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
    releaseId: statement.predicate.releaseId,
    releaseDigest,
    qaReportDigest: statement.predicate.qaReportDigest,
    reviewId: statement.predicate.reviewId,
    reviewDigest: statement.predicate.reviewDigest,
    statement,
    payloadUtf8,
    payloadBase64: bytes.toString("base64"),
    payloadSha256: sha256(bytes),
    payloadByteLength: bytes.length,
  });
  const path = join(directory, "signing-payload.json");
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  return { directory, path, payloadUtf8 };
}

describe("keyless DSSE KMS handoff", () => {
  it("writes the exact DSSE PAE bytes and an idempotent non-signing request", async () => {
    const fixture = await signingPayloadFixture();
    const outDirectory = join(fixture.directory, "request");
    const result = await prepareSigningRequest({ payloadPath: fixture.path, outDirectory });
    const payload = Buffer.from(fixture.payloadUtf8, "utf8");
    const type = Buffer.from(RECONSTRUCTION_DSSE_PAYLOAD_TYPE, "utf8");
    const expected = Buffer.concat([
      Buffer.from(`DSSEv1 ${String(type.length)} `, "ascii"),
      type,
      Buffer.from(` ${String(payload.length)} `, "ascii"),
      payload,
    ]);
    expect(await readFile(join(outDirectory, DSSE_PAE_FILE_NAME))).toEqual(expected);
    expect(result.paeSha256).toBe(sha256(expected));
    await expect(prepareSigningRequest({ payloadPath: fixture.path, outDirectory })).resolves.toEqual(result);
    const template = JSON.parse(await readFile(result.envelopeTemplatePath, "utf8"));
    expect(template.__instructions).toContain("Do not upload");
    expect(template.payload).toBe(payload.toString("base64"));
  });

  it("refuses internally inconsistent downloaded evidence", async () => {
    const fixture = await signingPayloadFixture();
    const raw = JSON.parse(await readFile(fixture.path, "utf8"));
    raw.payloadSha256 = "0".repeat(64);
    await writeFile(fixture.path, `${JSON.stringify(raw)}\n`);
    await expect(prepareSigningRequest({
      payloadPath: fixture.path,
      outDirectory: join(fixture.directory, "request"),
    })).rejects.toThrow("exact serialized statement bytes");
  });

  it("assembles only a canonical 64-byte signature with the exact payload", async () => {
    const fixture = await signingPayloadFixture();
    const signatureBase64 = Buffer.alloc(64, 7).toString("base64");
    const outPath = join(fixture.directory, "attestation.dsse.json");
    const result = await assembleAttestation({
      payloadPath: fixture.path,
      keyId: "venue-release-key-2026",
      signatureBase64,
      outPath,
    });
    const envelope = ReconstructionDsseEnvelopeSchema.parse(JSON.parse(await readFile(outPath, "utf8")));
    expect(envelope.payload).toBe(Buffer.from(fixture.payloadUtf8).toString("base64"));
    expect(envelope.signatures).toEqual([{ keyid: "venue-release-key-2026", sig: signatureBase64 }]);
    const canonical = Buffer.from(stableCanonicalJson(CanonicalJsonValueSchema.parse(envelope)));
    expect(result.envelopeSha256).toBe(sha256(canonical));
  });

  it("rejects malformed or wrong-length KMS output", async () => {
    const fixture = await signingPayloadFixture();
    await expect(assembleAttestation({
      payloadPath: fixture.path,
      keyId: "venue-release-key-2026",
      signatureBase64: Buffer.alloc(63).toString("base64"),
      outPath: join(fixture.directory, "attestation.dsse.json"),
    })).rejects.toThrow("exactly 64");
  });
});
