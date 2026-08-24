import { createHash } from "node:crypto";
import { link, lstat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GRAND_HALL_OPERATOR_ATTESTATION_SHA256,
  GRAND_HALL_OPERATOR_ATTESTATION_STATEMENT,
  compileGrandHallSmallLocalSogCandidateDescriptorV0,
  prepareGrandHallSmallLocalSogCandidateGatewayV0,
  prepareLocalExactReadOnlyMemberGrantV0,
  type LocalExactReadOnlyMemberGrantV0,
  type LocalSogCandidateMemberLeaseV0,
} from "../local-sog-candidate-gateway.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fixture(members: Readonly<Record<string, Buffer>>): Promise<{
  readonly root: string;
  readonly grants: readonly LocalExactReadOnlyMemberGrantV0[];
}> {
  const root = await mkdtemp(join(tmpdir(), "foundry-sog-grant-"));
  cleanup.push(root);
  await mkdir(join(root, "members"));
  const grants: LocalExactReadOnlyMemberGrantV0[] = [];
  for (const [memberId, bytes] of Object.entries(members)) {
    const relativePath = `members/${memberId}.sog`;
    await writeFile(join(root, ...relativePath.split("/")), bytes);
    grants.push({
      memberId,
      relativePath,
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
    });
  }
  return { root, grants };
}

function readLease(lease: LocalSogCandidateMemberLeaseV0): Promise<Buffer> {
  return new Promise((resolveBytes, rejectBytes) => {
    const chunks: Buffer[] = [];
    const stream = lease.createReadStream();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("error", rejectBytes);
    stream.once("end", () => {
      void lease
        .close()
        .then(() => {
          resolveBytes(Buffer.concat(chunks));
        })
        .catch(rejectBytes);
    });
  });
}

describe("local exact read-only SOG member grant", () => {
  it("streams only granted exact bytes and supports one bounded byte range", async () => {
    const source = await fixture({
      "desktop-0": Buffer.from("0123456789", "utf8"),
      "desktop-1": Buffer.from("abcdefghij", "utf8"),
    });
    const grant = await prepareLocalExactReadOnlyMemberGrantV0({
      sourceRoot: source.root,
      members: source.grants,
    });

    const full = await grant.openMember("desktop-0", undefined);
    expect(full.state).toBe("ready");
    if (full.state !== "ready") throw new Error("expected a full member lease");
    expect(full.lease).toMatchObject({
      statusCode: 200,
      start: 0,
      end: 9,
      contentLength: 10,
      contentRange: null,
      sha256: source.grants[0]?.sha256,
    });
    await expect(readLease(full.lease)).resolves.toEqual(
      Buffer.from("0123456789", "utf8"),
    );

    const partial = await grant.openMember("desktop-1", "bytes=2-5");
    expect(partial.state).toBe("ready");
    if (partial.state !== "ready") throw new Error("expected a range lease");
    expect(partial.lease).toMatchObject({
      statusCode: 206,
      start: 2,
      end: 5,
      contentLength: 4,
      contentRange: "bytes 2-5/10",
    });
    await expect(readLease(partial.lease)).resolves.toEqual(
      Buffer.from("cdef", "utf8"),
    );
  });

  it("rejects ungranted members, multi-ranges, and unsatisfiable ranges", async () => {
    const source = await fixture({
      "mobile-0": Buffer.from("0123456789", "utf8"),
    });
    const grant = await prepareLocalExactReadOnlyMemberGrantV0({
      sourceRoot: source.root,
      members: source.grants,
    });

    await expect(grant.openMember("env", undefined)).rejects.toThrow(
      "not granted",
    );
    await expect(
      grant.openMember("mobile-0", "bytes=0-1,4-5"),
    ).resolves.toEqual({ state: "range_not_satisfiable", sizeBytes: 10 });
    await expect(grant.openMember("mobile-0", "bytes=10-12")).resolves.toEqual({
      state: "range_not_satisfiable",
      sizeBytes: 10,
    });
  });

  it("refuses a same-inode, same-size in-place mutation after grant preparation", async () => {
    const original = Buffer.from("original-bytes", "utf8");
    const replacement = Buffer.from("mutated!-bytes", "utf8");
    expect(replacement.length).toBe(original.length);
    const source = await fixture({ "desktop-0": original });
    const path = join(source.root, "members", "desktop-0.sog");
    const before = await lstat(path);
    const grant = await prepareLocalExactReadOnlyMemberGrantV0({
      sourceRoot: source.root,
      members: source.grants,
    });

    await writeFile(path, replacement);
    const after = await lstat(path);
    expect(after.size).toBe(before.size);
    expect(after.ino).toBe(before.ino);
    await expect(grant.openMember("desktop-0", undefined)).rejects.toThrow(
      /changed|matches/u,
    );
  });

  it("leases immutable transient bytes before source mutation can affect consumption", async () => {
    const original = Buffer.from("stable-buffer", "utf8");
    const replacement = Buffer.from("mutate-buffer", "utf8");
    expect(replacement.length).toBe(original.length);
    const source = await fixture({ "desktop-0": original });
    const grant = await prepareLocalExactReadOnlyMemberGrantV0({
      sourceRoot: source.root,
      members: source.grants,
    });
    const opened = await grant.openMember("desktop-0", undefined);
    expect(opened.state).toBe("ready");
    if (opened.state !== "ready")
      throw new Error("expected an immutable lease");

    await writeFile(join(source.root, "members", "desktop-0.sog"), replacement);
    await expect(readLease(opened.lease)).resolves.toEqual(original);
  });

  it("refuses hard-linked or digest-mismatched sources", async () => {
    const source = await fixture({
      "desktop-0": Buffer.from("captured", "utf8"),
    });
    const memberPath = join(source.root, "members", "desktop-0.sog");
    await link(memberPath, join(source.root, "members", "linked.sog"));
    await expect(
      prepareLocalExactReadOnlyMemberGrantV0({
        sourceRoot: source.root,
        members: source.grants,
      }),
    ).rejects.toThrow(/indirect|regular file/u);

    await rm(join(source.root, "members", "linked.sog"));
    await expect(
      prepareLocalExactReadOnlyMemberGrantV0({
        sourceRoot: source.root,
        members: [
          {
            ...source.grants[0]!,
            sha256: `sha256:${"0".repeat(64)}`,
          },
        ],
      }),
    ).rejects.toThrow("validated SHA-256");
  });
});

describe("Grand Hall local SOG candidate descriptor", () => {
  it("refuses preparation without an explicit operator attestation", async () => {
    await expect(
      prepareGrandHallSmallLocalSogCandidateGatewayV0({
        sourceRoot: "unused-without-attestation",
        manifestRelativePath: "lcc2-result/Grand_Hall_Small.lcc2",
        ownerAuthorizedVenviewerProductUse: false,
      }),
    ).rejects.toThrow(
      "explicit owner-authorized Venviewer product-use attestation",
    );
  });

  it("pins owner-attested appearance-only truth without runtime registration", () => {
    const descriptor = compileGrandHallSmallLocalSogCandidateDescriptorV0(
      "http://127.0.0.1:43127",
      "a".repeat(43),
    );
    const otherSession = compileGrandHallSmallLocalSogCandidateDescriptorV0(
      "http://127.0.0.1:53127",
      "b".repeat(43),
    );

    expect(descriptor).toMatchObject({
      candidateRevision: 1,
      runtimeRegistration: "not_registered",
      usage: "appearance_only",
      source: {
        manifestSha256:
          "sha256:f4ba054a560ec86fa75d623d10924ba6bf00c6790745137ec4a2c144a64da12d",
        frontierReceiptSha256:
          "sha256:fb6c12052b4029457c28e812b8d3290553415e5e69e9ae31cb08ad92d1a5d5f1",
        inventory: {
          sog: { count: 19 },
          meshPly: { count: 14 },
          bvh: { count: 14 },
          obj: { count: 1 },
          poses: { count: 2894 },
        },
      },
      rights: {
        basis: "customer_owned",
        evidenceState: "operator_supplied_unverified",
        attestationStatement: GRAND_HALL_OPERATOR_ATTESTATION_STATEMENT,
        attestationSha256: GRAND_HALL_OPERATOR_ATTESTATION_SHA256,
        licensedUse: "authorized_for_all_venviewer_product_purposes",
        publicationAndDistributionRights: "owner_authorized",
        licensingBlocker: false,
      },
      authority: {
        appearance: "local_unreviewed_candidate",
        geometry: "none",
        placement: "none",
        measurement: "none",
        collision: "none",
        export: "none",
      },
      transform: {
        state: "unreviewed_visual_only",
        targetFrame: null,
        matrix: null,
      },
      presentationTransform: {
        state: "unreviewed_visual_only",
        rotation: [-1.5707963267948966, 0, 0],
        notTransformArtifactV0: true,
      },
      presentationCamera: {
        state: "unreviewed_visual_only",
        position: [-8, 2, 8],
        target: [-8, 2, 0],
        fov: 65,
        controls: "bounded_orbit",
      },
      capabilities: {
        publication: false,
        export: false,
        measurement: false,
        activation: false,
      },
    });
    expect(descriptor.candidateDigest).toBe(
      "sha256:1a2303e1d3c850d85e078edf966f3b10c9e06d7a8134403302a18e78f7a45b00",
    );
    expect(GRAND_HALL_OPERATOR_ATTESTATION_SHA256).toBe(
      "sha256:e8659e0c6e757a5bfd167b3b2abfa4ae729a44f5249fefe2cfcb0497d3d2c2cb",
    );
    expect(descriptor.candidateDigest).toBe(otherSession.candidateDigest);
    expect(
      descriptor.tiers.map((tier) => [
        tier.id,
        tier.memberCount,
        tier.splatCount,
        tier.sizeBytes,
      ]),
    ).toEqual([
      ["desktop", 4, 2_482_968, 44_988_345],
      ["mobile", 3, 1_240_774, 24_441_495],
    ]);
    expect(
      descriptor.tiers
        .flatMap((tier) => tier.members)
        .map((member) => member.relativePath),
    ).toEqual([
      "lcc2-result/data/3dgs/0_1_0_1_0.sog",
      "lcc2-result/data/3dgs/0_3_0_1_0.sog",
      "lcc2-result/data/3dgs/0_5_0_0_1.sog",
      "lcc2-result/data/3dgs/0_7_0_1_0.sog",
      "lcc2-result/data/3dgs/0_3_0_0.sog",
      "lcc2-result/data/3dgs/0_6_0_0.sog",
      "lcc2-result/data/3dgs/0_7_0_0.sog",
    ]);
    const serialized = JSON.stringify(descriptor);
    expect(serialized).not.toContain("runtimePackageId");
    expect(serialized).not.toContain("packageId");
    expect(serialized).not.toContain("env.sog");
    expect(serialized).not.toContain("C:\\Users");
  });
});
