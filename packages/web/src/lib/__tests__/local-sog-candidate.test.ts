import { describe, expect, it } from "vitest";
import { historicalRuntimeViewerCapacity } from "../historical-runtime-cache.js";
import {
  LOCAL_SOG_CANDIDATE_QUERY_PARAM,
  localSogCandidateRequestFromSearchParams,
  parseLocalSogCandidateDescriptor,
  selectLocalSogCandidateTier,
} from "../local-sog-candidate.js";

const TOKEN = "t".repeat(43);
const ORIGIN = "http://127.0.0.1:43127";
const DESCRIPTOR_URL = `${ORIGIN}/api/local-sog-candidate?token=${TOKEN}`;

function member(
  memberId: string,
  relativePath: string,
  sha256: string,
  sizeBytes: number,
  splatCount: number,
) {
  return {
    memberId,
    relativePath,
    sha256,
    sizeBytes,
    splatCount,
    url: `${ORIGIN}/api/local-sog-candidate/members/${memberId}.sog?token=${TOKEN}`,
  };
}

function descriptor(): Record<string, unknown> {
  return {
    schemaVersion: "omnitwin.local-foundry.sog-candidate-descriptor.v0",
    candidateId: "grand-hall-small-lcc2-8539a478-v1",
    candidateRevision: 1,
    candidateDigest: "sha256:1a2303e1d3c850d85e078edf966f3b10c9e06d7a8134403302a18e78f7a45b00",
    runtimeRegistration: "not_registered",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    usage: "appearance_only",
    labels: {
      title: "Grand Hall — captured visual candidate",
      source: "XGRIDS PortalCam · Grand Hall Small",
      status: "Owner-authorized Venviewer use · unreviewed visual only",
      caveat: "Appearance only; no placement, measurement, collision, operational export, or production activation authority. Publication rights are owner-authorized; this unregistered candidate remains technically QA-inactive.",
    },
    source: {
      kind: "xgrids_lcc2_sog",
      manifestSha256: "sha256:f4ba054a560ec86fa75d623d10924ba6bf00c6790745137ec4a2c144a64da12d",
      frontierReceiptSha256: "sha256:fb6c12052b4029457c28e812b8d3290553415e5e69e9ae31cb08ad92d1a5d5f1",
      lcc2Guid: "8539a47831505d8b5c0891353d7f05d1",
      pathExposed: false,
      inventory: {
        sog: { count: 19 },
        meshPly: { count: 14 },
        bvh: { count: 14 },
        obj: { count: 1 },
        poses: { count: 2_894 },
      },
    },
    rights: {
      basis: "customer_owned",
      evidenceState: "operator_supplied_unverified",
      evidenceReference: "user-attestation:2026-08-19",
      attestationStatement: "The operator attests that the customer owns all supplied venue data and derivatives, whether commissioned, created, or captured by the customer, and authorizes their use for all Venviewer product purposes, including internal development, customer-facing experiences, derived assets, model-assisted reconstruction, publication, and distribution.",
      attestationSha256: "sha256:e8659e0c6e757a5bfd167b3b2abfa4ae729a44f5249fefe2cfcb0497d3d2c2cb",
      scope: "all_venviewer_product_purposes",
      licensedUse: "authorized_for_all_venviewer_product_purposes",
      publicationAndDistributionRights: "owner_authorized",
      licensingBlocker: false,
      runtimeActivation: "technically_inactive_pending_alignment_qa_and_promotion",
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
      sourceFrame: "xgrids_lcc2_local",
      targetFrame: null,
      units: "not_established",
      matrix: null,
    },
    presentationTransform: {
      state: "unreviewed_visual_only",
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      scale: 1,
      notTransformArtifactV0: true,
      note: "Presentation framing only; not ARF→CVF or CVF→RRF registration.",
    },
    presentationCamera: {
      state: "unreviewed_visual_only",
      position: [-8, 2, 8],
      target: [-8, 2, 0],
      fov: 65,
      controls: "bounded_orbit",
      notTransformArtifactV0: true,
    },
    availableEvidence: {
      inventory: {
        state: "bounded_inventory_observation",
        fileCount: 52,
        totalBytes: 182_313_418,
        sogFiles: 19,
        meshPlyFiles: 14,
        btreeFiles: 14,
        objFiles: 1,
        poseFiles: 1,
        poseCount: 2_894,
        otherFiles: 3,
      },
      delivery: {
        streamableFormat: "sog",
        streamableMemberCount: 7,
        selectedTiers: ["desktop", "mobile"],
        unstreamedEvidence: [
          "other_sog_alternatives",
          "mesh_ply",
          "btree",
          "obj",
          "poses",
          "manifest_report_thumbnail",
        ],
      },
      operationalAuthority: "none",
    },
    tiers: [
      {
        id: "desktop",
        memberCount: 4,
        splatCount: 2_482_968,
        sizeBytes: 44_988_345,
        members: [
          member("desktop-0", "lcc2-result/data/3dgs/0_1_0_1_0.sog", "sha256:4cdb89b8dad1cd6eaf560d4aa643e19c7398e3c449c7c8969b9487264f74275c", 11_522_216, 643_263),
          member("desktop-1", "lcc2-result/data/3dgs/0_3_0_1_0.sog", "sha256:ee8785d1639e23917e7755c127c5fa67b3c575ea26934a8282594ec0831e567b", 11_656_582, 649_182),
          member("desktop-2", "lcc2-result/data/3dgs/0_5_0_0_1.sog", "sha256:dab77f8d9c0e55d659cb293fbc35392058b6810564e9b839d0e594460794e751", 11_246_512, 615_820),
          member("desktop-3", "lcc2-result/data/3dgs/0_7_0_1_0.sog", "sha256:b51f3ac35985e464ae09bd9c169d224b08a3be5052919971cc0ccfb2c9178c04", 10_563_035, 574_703),
        ],
      },
      {
        id: "mobile",
        memberCount: 3,
        splatCount: 1_240_774,
        sizeBytes: 24_441_495,
        members: [
          member("mobile-0", "lcc2-result/data/3dgs/0_3_0_0.sog", "sha256:1f49fe1bd35f4e9d4207680ac9303d5ade56219c04eb0bc64451e514e4c55d7f", 10_356_300, 563_937),
          member("mobile-1", "lcc2-result/data/3dgs/0_6_0_0.sog", "sha256:8890d03b096bd1489fb113daddfa175f653824be4cc1bafdef11925fc51e3786", 9_841_081, 525_405),
          member("mobile-2", "lcc2-result/data/3dgs/0_7_0_0.sog", "sha256:1df5d7758af4dfb0a155e16799c8915ae850de342354d203ee7284cb17c4c75c", 4_244_114, 151_432),
        ],
      },
    ],
    capabilities: {
      publication: false,
      export: false,
      measurement: false,
      activation: false,
    },
  };
}

describe("local SOG candidate request", () => {
  it("accepts only an explicit token-bearing IPv4 loopback descriptor in development", () => {
    const params = new URLSearchParams({ [LOCAL_SOG_CANDIDATE_QUERY_PARAM]: DESCRIPTOR_URL });

    expect(localSogCandidateRequestFromSearchParams(params, true)).toEqual({
      kind: "ready",
      descriptorUrl: DESCRIPTOR_URL,
    });
    expect(localSogCandidateRequestFromSearchParams(params, false)).toEqual({
      kind: "invalid",
      message: "Local SOG candidates are disabled outside development builds.",
    });
  });

  it.each([
    "http://localhost:43127/api/local-sog-candidate?token=" + TOKEN,
    "http://192.168.1.2:43127/api/local-sog-candidate?token=" + TOKEN,
    "https://127.0.0.1:43127/api/local-sog-candidate?token=" + TOKEN,
    "http://127.0.0.1/api/local-sog-candidate?token=" + TOKEN,
    "http://127.0.0.1:43127/api/local-sog-candidate",
    "http://user:pass@127.0.0.1:43127/api/local-sog-candidate?token=" + TOKEN,
  ])("rejects unsafe descriptor URL %s", (descriptorUrl) => {
    const params = new URLSearchParams({ [LOCAL_SOG_CANDIDATE_QUERY_PARAM]: descriptorUrl });
    expect(localSogCandidateRequestFromSearchParams(params, true).kind).toBe("invalid");
  });
});

describe("local SOG candidate descriptor", () => {
  it("accepts the exact authority-none Grand Hall candidate and retains stable member identities", () => {
    const parsed = parseLocalSogCandidateDescriptor(descriptor(), DESCRIPTOR_URL);

    expect(parsed.candidateId).toBe("grand-hall-small-lcc2-8539a478-v1");
    expect(parsed.runtimeRegistration).toBe("not_registered");
    expect(parsed.authority).toMatchObject({
      geometry: "none",
      placement: "none",
      measurement: "none",
      collision: "none",
      export: "none",
    });
    expect(parsed.tiers.map((tier) => tier.id)).toEqual(["desktop", "mobile"]);
    expect(new Set(parsed.tiers.flatMap((tier) => tier.members.map((item) => item.memberId))).size).toBe(7);
  });

  it("selects one alternative tier at a time and changes stable selection identity across the breakpoint", () => {
    const parsed = parseLocalSogCandidateDescriptor(descriptor(), DESCRIPTOR_URL);
    const desktop = selectLocalSogCandidateTier(parsed, 1_440);
    const mobile = selectLocalSogCandidateTier(parsed, 800);

    expect(desktop.tier.id).toBe("desktop");
    expect(desktop.members).toHaveLength(4);
    expect(desktop.tier.splatCount).toBe(2_482_968);
    expect(mobile.tier.id).toBe("mobile");
    expect(mobile.members).toHaveLength(3);
    expect(mobile.tier.splatCount).toBe(1_240_774);
    expect(mobile.selectionKey).not.toBe(desktop.selectionKey);
    expect(desktop.members.every((item) => !mobile.members.some((other) => other.identity === item.identity))).toBe(true);
  });

  it("uses the existing viewer capacity policy on wide low-memory devices", () => {
    const parsed = parseLocalSogCandidateDescriptor(descriptor(), DESCRIPTOR_URL);
    const fourGbCapacity = historicalRuntimeViewerCapacity({ deviceMemoryGb: 4, mobile: false });
    const eightGbCapacity = historicalRuntimeViewerCapacity({ deviceMemoryGb: 8, mobile: false });

    expect(selectLocalSogCandidateTier(parsed, 1_440, fourGbCapacity.maxSplats).tier.id).toBe("mobile");
    expect(selectLocalSogCandidateTier(parsed, 1_440, eightGbCapacity.maxSplats).tier.id).toBe("desktop");
  });

  it("rejects env members and mixed frontier depths", () => {
    const envCandidate = descriptor();
    const envTiers = envCandidate["tiers"] as Array<{ members: Array<Record<string, unknown>> }>;
    envTiers[0]?.members.splice(0, 1, member(
      "desktop-0",
      "lcc2-result/data/3dgs/env.sog",
      "sha256:4cdb89b8dad1cd6eaf560d4aa643e19c7398e3c449c7c8969b9487264f74275c",
      11_522_216,
      643_263,
    ));
    expect(() => parseLocalSogCandidateDescriptor(envCandidate, DESCRIPTOR_URL)).toThrow();

    const mixedDepthCandidate = descriptor();
    const mixedTiers = mixedDepthCandidate["tiers"] as Array<{ members: Array<Record<string, unknown>> }>;
    if (mixedTiers[0]?.members[0] !== undefined) {
      mixedTiers[0].members[0]["relativePath"] = "lcc2-result/data/3dgs/0_0_0_0.sog";
    }
    expect(() => parseLocalSogCandidateDescriptor(mixedDepthCandidate, DESCRIPTOR_URL)).toThrow();
  });

  it("rejects a resealed member substitution even when every aggregate total still matches", () => {
    const substitutedCandidate = descriptor();
    const tiers = substitutedCandidate["tiers"] as Array<{ members: Array<Record<string, unknown>> }>;
    if (tiers[0]?.members[0] !== undefined) {
      tiers[0].members[0]["sha256"] = `sha256:${"0".repeat(64)}`;
    }

    expect(() => parseLocalSogCandidateDescriptor(substitutedCandidate, DESCRIPTOR_URL)).toThrow();
  });

  it("rejects authority escalation, operational transforms, and inconsistent exact totals", () => {
    const authorityCandidate = descriptor();
    const authority = authorityCandidate["authority"] as Record<string, unknown>;
    authority["measurement"] = "candidate";
    expect(() => parseLocalSogCandidateDescriptor(authorityCandidate, DESCRIPTOR_URL)).toThrow();

    const transformCandidate = descriptor();
    const presentationTransform = transformCandidate["presentationTransform"] as Record<string, unknown>;
    presentationTransform["notTransformArtifactV0"] = false;
    expect(() => parseLocalSogCandidateDescriptor(transformCandidate, DESCRIPTOR_URL)).toThrow();

    const totalsCandidate = descriptor();
    const tiers = totalsCandidate["tiers"] as Array<Record<string, unknown>>;
    if (tiers[0] !== undefined) tiers[0]["splatCount"] = 2_482_967;
    expect(() => parseLocalSogCandidateDescriptor(totalsCandidate, DESCRIPTOR_URL)).toThrow();
  });

  it("rejects a member URL outside the authenticated descriptor origin", () => {
    const candidate = descriptor();
    const tiers = candidate["tiers"] as Array<{ members: Array<Record<string, unknown>> }>;
    if (tiers[0]?.members[0] !== undefined) {
      tiers[0].members[0]["url"] = `http://127.0.0.1:43128/api/local-sog-candidate/members/desktop-0.sog?token=${TOKEN}`;
    }
    expect(() => parseLocalSogCandidateDescriptor(candidate, DESCRIPTOR_URL)).toThrow(/origin/i);
  });

  it("requires an exact member-id binding with an explicit Spark .sog decoder suffix", () => {
    const extensionlessCandidate = descriptor();
    const extensionlessTiers = extensionlessCandidate["tiers"] as Array<{ members: Array<Record<string, unknown>> }>;
    if (extensionlessTiers[0]?.members[0] !== undefined) {
      extensionlessTiers[0].members[0]["url"] =
        `${ORIGIN}/api/local-sog-candidate/members/desktop-0?token=${TOKEN}`;
    }
    expect(() => parseLocalSogCandidateDescriptor(extensionlessCandidate, DESCRIPTOR_URL)).toThrow(/\.sog decoder suffix/i);

    const mismatchedCandidate = descriptor();
    const mismatchedTiers = mismatchedCandidate["tiers"] as Array<{ members: Array<Record<string, unknown>> }>;
    if (mismatchedTiers[0]?.members[0] !== undefined) {
      mismatchedTiers[0].members[0]["url"] =
        `${ORIGIN}/api/local-sog-candidate/members/desktop-1.sog?token=${TOKEN}`;
    }
    expect(() => parseLocalSogCandidateDescriptor(mismatchedCandidate, DESCRIPTOR_URL)).toThrow(/member URL/i);
  });
});
