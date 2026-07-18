import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ReconstructionQaReportSchema,
  ReconstructionReleaseManifestSchema,
  computeReconstructionQaReportDigest,
  computeReconstructionReleaseDigest,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  publicReleaseKeyFor,
  transferImmutableCandidateObject,
  uploadCandidateRelease,
  verifyRemoteCandidateRelease,
} from "../candidate.js";
import { prepareReconstructionRelease } from "../preparation.js";
import { twinFixture } from "./fixture.js";
import { MemoryImmutableStore } from "./store-fixture.js";

const cleanup: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function preparedFixture(): Promise<{
  readonly store: MemoryImmutableStore;
  readonly preparedDirectory: string;
}> {
  const fixture = await twinFixture();
  const output = await mkdtemp(join(tmpdir(), "foundry-upload-"));
  cleanup.push(fixture.root, output);
  const preparedDirectory = join(output, "evidence");
  await prepareReconstructionRelease({ bundleRoot: fixture.root, outDir: preparedDirectory });
  return { store: new MemoryImmutableStore(), preparedDirectory };
}

describe("private candidate commit and remote verification", () => {
  it("uploads content first and the release commit marker last", async () => {
    const fixture = await preparedFixture();
    const receipt = await uploadCandidateRelease(fixture);
    expect(fixture.store.putOrder.at(-1)).toBe(receipt.candidateManifestKey);
    expect(receipt.createdKeys).toHaveLength(receipt.manifest.fileCount + 2);
    expect(receipt.reusedKeys).toHaveLength(0);
    expect(receipt.qaReport.outcome).toBe("passed");
    expect(receipt.verifiedFiles).toHaveLength(receipt.manifest.fileCount);
  });

  it("is idempotent only when every immutable byte is identical", async () => {
    const fixture = await preparedFixture();
    const first = await uploadCandidateRelease(fixture);
    const second = await uploadCandidateRelease(fixture);
    expect(second.createdKeys).toHaveLength(0);
    expect(second.reusedKeys).toHaveLength(first.manifest.fileCount + 2);

    const image = first.manifest.files.find((file) => file.role === "imagery");
    expect(image).toBeDefined();
    const key = `${first.candidatePrefix}/${image!.path}`;
    const bytes = fixture.store.bytes(key);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    fixture.store.set(key, bytes);
    await expect(verifyRemoteCandidateRelease({
      candidatePrefix: first.candidatePrefix,
      store: fixture.store,
    })).rejects.toThrow("readback verification failed");
  });

  it("rebuilds QA instead of trusting a syntactically valid report", async () => {
    const fixture = await preparedFixture();
    const receipt = await uploadCandidateRelease(fixture);
    const original = JSON.parse(fixture.store.bytes(receipt.candidateQaReportKey).toString("utf8"));
    const material = {
      schemaVersion: original.schemaVersion,
      releaseDigest: original.releaseDigest,
      sourceManifestSha256: original.sourceManifestSha256,
      qaProfileVersion: "forged.v1",
      qaProfileDigest: original.qaProfileDigest,
      outcome: original.outcome,
      checks: original.checks,
    };
    const forged = ReconstructionQaReportSchema.parse({
      ...material,
      reportDigest: computeReconstructionQaReportDigest(material),
    });
    fixture.store.set(receipt.candidateQaReportKey, Buffer.from(`${JSON.stringify(forged)}\n`));
    await expect(verifyRemoteCandidateRelease({
      candidatePrefix: receipt.candidatePrefix,
      store: fixture.store,
    })).rejects.toThrow("independently rebuilt");
  });

  it("reruns image-header QA even when an attacker recomputes every surrounding digest", async () => {
    const fixture = await preparedFixture();
    const receipt = await uploadCandidateRelease(fixture);
    const image = receipt.manifest.files.find((file) => file.role === "imagery")!;
    const forgedImage = fixture.store.bytes(`${receipt.candidatePrefix}/${image.path}`);
    forgedImage.writeUIntLE(1023, 24, 3);

    const sourceFile = receipt.manifest.files.find((file) => file.path === "manifest.json")!;
    const sourceRaw = JSON.parse(fixture.store.bytes(`${receipt.candidatePrefix}/manifest.json`).toString("utf8"));
    sourceRaw.contentHashes[image.path] = sha256(forgedImage);
    const forgedSource = Buffer.from(`${JSON.stringify(sourceRaw, null, 2)}\n`);
    const files = receipt.manifest.files.map((file) => {
      if (file.path === image.path) return { ...file, sha256: sha256(forgedImage) };
      if (file.path === sourceFile.path) {
        return { ...file, sha256: sha256(forgedSource), sizeBytes: forgedSource.length };
      }
      return file;
    });
    const releaseDigest = computeReconstructionReleaseDigest(files);
    const manifest = ReconstructionReleaseManifestSchema.parse({
      ...receipt.manifest,
      releaseDigest,
      sourceManifestSha256: sha256(forgedSource),
      files,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    });
    const prefix = `candidates/${manifest.venueSlug}/${manifest.releaseDigest}`;
    for (const file of manifest.files) {
      let bytes = fixture.store.bytes(`${receipt.candidatePrefix}/${file.path}`);
      if (file.path === image.path) bytes = forgedImage;
      if (file.path === "manifest.json") bytes = forgedSource;
      fixture.store.set(`${prefix}/${file.path}`, bytes);
    }

    const reportMaterial = {
      schemaVersion: receipt.qaReport.schemaVersion,
      releaseDigest,
      sourceManifestSha256: manifest.sourceManifestSha256,
      qaProfileVersion: receipt.qaReport.qaProfileVersion,
      qaProfileDigest: receipt.qaReport.qaProfileDigest,
      outcome: receipt.qaReport.outcome,
      checks: receipt.qaReport.checks,
    };
    const report = ReconstructionQaReportSchema.parse({
      ...reportMaterial,
      reportDigest: computeReconstructionQaReportDigest(reportMaterial),
    });
    fixture.store.set(`${prefix}/qa-report.json`, Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
    fixture.store.set(`${prefix}/release-manifest.json`, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));

    await expect(verifyRemoteCandidateRelease({ candidatePrefix: prefix, store: fixture.store }))
      .rejects.toThrow("fully decoded");
  });

  it("fails closed when a declared object is absent", async () => {
    const fixture = await preparedFixture();
    const receipt = await uploadCandidateRelease(fixture);
    fixture.store.delete(receipt.verifiedFiles[0]!.key);
    await expect(verifyRemoteCandidateRelease({
      candidatePrefix: receipt.candidatePrefix,
      store: fixture.store,
    })).rejects.toThrow("missing test object");
  });

  it("transfers a declared object to only its digest-addressed public key", async () => {
    const fixture = await preparedFixture();
    const receipt = await uploadCandidateRelease(fixture);
    const destinationStore = new MemoryImmutableStore();
    const sourceFile = receipt.manifest.files[0]!;
    const sourceKey = `${receipt.candidatePrefix}/${sourceFile.path}`;
    const destinationKey = publicReleaseKeyFor(receipt.manifest, sourceFile.path);
    const result = await transferImmutableCandidateObject({
      sourceStore: fixture.store,
      destinationStore,
      sourceKey,
      destinationKey,
      contentType: sourceFile.mimeType,
      sha256: sourceFile.sha256,
      sizeBytes: sourceFile.sizeBytes,
    });
    expect(result.disposition).toBe("created");
    expect(destinationStore.bytes(destinationKey)).toEqual(fixture.store.bytes(sourceKey));
  });
});
