import { z } from "zod";

export const LOCAL_SOG_CANDIDATE_QUERY_PARAM = "localSogCandidate";
export const LOCAL_SOG_MOBILE_MAX_VIEWPORT_WIDTH = 1_099;
export const LOCAL_SOG_CANDIDATE_SCHEMA_VERSION =
  "omnitwin.local-foundry.sog-candidate-descriptor.v0";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const TREE_ADDRESS_PATTERN = /^\d+(?:_\d+)+$/u;
const EXPECTED_DESCRIPTOR_PATH = "/api/local-sog-candidate";
const EXPECTED_MEMBER_PATH_PREFIX = "/api/local-sog-candidate/members/";

const GRAND_HALL_SMALL_MANIFEST_SHA256 =
  "sha256:f4ba054a560ec86fa75d623d10924ba6bf00c6790745137ec4a2c144a64da12d";
const GRAND_HALL_SMALL_FRONTIER_RECEIPT_SHA256 =
  "sha256:fb6c12052b4029457c28e812b8d3290553415e5e69e9ae31cb08ad92d1a5d5f1";
const GRAND_HALL_SMALL_CANDIDATE_DIGEST =
  "sha256:1a2303e1d3c850d85e078edf966f3b10c9e06d7a8134403302a18e78f7a45b00";
const GRAND_HALL_OPERATOR_ATTESTATION =
  "The operator attests that the customer owns all supplied venue data and derivatives, whether commissioned, created, or captured by the customer, and authorizes their use for all Venviewer product purposes, including internal development, customer-facing experiences, derived assets, model-assisted reconstruction, publication, and distribution.";
const GRAND_HALL_OPERATOR_ATTESTATION_SHA256 =
  "sha256:e8659e0c6e757a5bfd167b3b2abfa4ae729a44f5249fefe2cfcb0497d3d2c2cb";

interface PinnedMember {
  readonly memberId: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly splatCount: number;
}

const DESKTOP_MEMBERS = [
  {
    memberId: "desktop-0",
    relativePath: "lcc2-result/data/3dgs/0_1_0_1_0.sog",
    sha256: "sha256:4cdb89b8dad1cd6eaf560d4aa643e19c7398e3c449c7c8969b9487264f74275c",
    sizeBytes: 11_522_216,
    splatCount: 643_263,
  },
  {
    memberId: "desktop-1",
    relativePath: "lcc2-result/data/3dgs/0_3_0_1_0.sog",
    sha256: "sha256:ee8785d1639e23917e7755c127c5fa67b3c575ea26934a8282594ec0831e567b",
    sizeBytes: 11_656_582,
    splatCount: 649_182,
  },
  {
    memberId: "desktop-2",
    relativePath: "lcc2-result/data/3dgs/0_5_0_0_1.sog",
    sha256: "sha256:dab77f8d9c0e55d659cb293fbc35392058b6810564e9b839d0e594460794e751",
    sizeBytes: 11_246_512,
    splatCount: 615_820,
  },
  {
    memberId: "desktop-3",
    relativePath: "lcc2-result/data/3dgs/0_7_0_1_0.sog",
    sha256: "sha256:b51f3ac35985e464ae09bd9c169d224b08a3be5052919971cc0ccfb2c9178c04",
    sizeBytes: 10_563_035,
    splatCount: 574_703,
  },
] as const satisfies readonly PinnedMember[];

const MOBILE_MEMBERS = [
  {
    memberId: "mobile-0",
    relativePath: "lcc2-result/data/3dgs/0_3_0_0.sog",
    sha256: "sha256:1f49fe1bd35f4e9d4207680ac9303d5ade56219c04eb0bc64451e514e4c55d7f",
    sizeBytes: 10_356_300,
    splatCount: 563_937,
  },
  {
    memberId: "mobile-1",
    relativePath: "lcc2-result/data/3dgs/0_6_0_0.sog",
    sha256: "sha256:8890d03b096bd1489fb113daddfa175f653824be4cc1bafdef11925fc51e3786",
    sizeBytes: 9_841_081,
    splatCount: 525_405,
  },
  {
    memberId: "mobile-2",
    relativePath: "lcc2-result/data/3dgs/0_7_0_0.sog",
    sha256: "sha256:1df5d7758af4dfb0a155e16799c8915ae850de342354d203ee7284cb17c4c75c",
    sizeBytes: 4_244_114,
    splatCount: 151_432,
  },
] as const satisfies readonly PinnedMember[];

function pinnedMemberSchema(member: PinnedMember) {
  return z.object({
    memberId: z.literal(member.memberId),
    relativePath: z.literal(member.relativePath),
    sha256: z.literal(member.sha256),
    sizeBytes: z.literal(member.sizeBytes),
    splatCount: z.literal(member.splatCount),
    url: z.string().url(),
  }).strict();
}

const DesktopTierSchema = z.object({
  id: z.literal("desktop"),
  memberCount: z.literal(4),
  splatCount: z.literal(2_482_968),
  sizeBytes: z.literal(44_988_345),
  members: z.tuple([
    pinnedMemberSchema(DESKTOP_MEMBERS[0]),
    pinnedMemberSchema(DESKTOP_MEMBERS[1]),
    pinnedMemberSchema(DESKTOP_MEMBERS[2]),
    pinnedMemberSchema(DESKTOP_MEMBERS[3]),
  ]),
}).strict();

const MobileTierSchema = z.object({
  id: z.literal("mobile"),
  memberCount: z.literal(3),
  splatCount: z.literal(1_240_774),
  sizeBytes: z.literal(24_441_495),
  members: z.tuple([
    pinnedMemberSchema(MOBILE_MEMBERS[0]),
    pinnedMemberSchema(MOBILE_MEMBERS[1]),
    pinnedMemberSchema(MOBILE_MEMBERS[2]),
  ]),
}).strict();

export const LocalSogCandidateDescriptorSchema = z.object({
  schemaVersion: z.literal(LOCAL_SOG_CANDIDATE_SCHEMA_VERSION),
  candidateId: z.literal("grand-hall-small-lcc2-8539a478-v1"),
  candidateRevision: z.literal(1),
  candidateDigest: z.literal(GRAND_HALL_SMALL_CANDIDATE_DIGEST),
  runtimeRegistration: z.literal("not_registered"),
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.literal("grand-hall"),
  usage: z.literal("appearance_only"),
  labels: z.object({
    title: z.literal("Grand Hall — captured visual candidate"),
    source: z.literal("XGRIDS PortalCam · Grand Hall Small"),
    status: z.literal("Owner-authorized Venviewer use · unreviewed visual only"),
    caveat: z.literal(
      "Appearance only; no placement, measurement, collision, operational export, or production activation authority. Publication rights are owner-authorized; this unregistered candidate remains technically QA-inactive.",
    ),
  }).strict(),
  source: z.object({
    kind: z.literal("xgrids_lcc2_sog"),
    manifestSha256: z.literal(GRAND_HALL_SMALL_MANIFEST_SHA256),
    frontierReceiptSha256: z.literal(GRAND_HALL_SMALL_FRONTIER_RECEIPT_SHA256),
    lcc2Guid: z.literal("8539a47831505d8b5c0891353d7f05d1"),
    pathExposed: z.literal(false),
    inventory: z.object({
      sog: z.object({ count: z.literal(19) }).strict(),
      meshPly: z.object({ count: z.literal(14) }).strict(),
      bvh: z.object({ count: z.literal(14) }).strict(),
      obj: z.object({ count: z.literal(1) }).strict(),
      poses: z.object({ count: z.literal(2_894) }).strict(),
    }).strict(),
  }).strict(),
  rights: z.object({
    basis: z.literal("customer_owned"),
    evidenceState: z.literal("operator_supplied_unverified"),
    evidenceReference: z.literal("user-attestation:2026-08-19"),
    attestationStatement: z.literal(GRAND_HALL_OPERATOR_ATTESTATION),
    attestationSha256: z.literal(GRAND_HALL_OPERATOR_ATTESTATION_SHA256),
    scope: z.literal("all_venviewer_product_purposes"),
    licensedUse: z.literal("authorized_for_all_venviewer_product_purposes"),
    publicationAndDistributionRights: z.literal("owner_authorized"),
    licensingBlocker: z.literal(false),
    runtimeActivation: z.literal(
      "technically_inactive_pending_alignment_qa_and_promotion",
    ),
  }).strict(),
  authority: z.object({
    appearance: z.literal("local_unreviewed_candidate"),
    geometry: z.literal("none"),
    placement: z.literal("none"),
    measurement: z.literal("none"),
    collision: z.literal("none"),
    export: z.literal("none"),
  }).strict(),
  transform: z.object({
    state: z.literal("unreviewed_visual_only"),
    sourceFrame: z.literal("xgrids_lcc2_local"),
    targetFrame: z.null(),
    units: z.literal("not_established"),
    matrix: z.null(),
  }).strict(),
  presentationTransform: z.object({
    state: z.literal("unreviewed_visual_only"),
    position: z.tuple([z.literal(0), z.literal(0), z.literal(0)]),
    rotation: z.tuple([z.literal(-1.5707963267948966), z.literal(0), z.literal(0)]),
    scale: z.literal(1),
    notTransformArtifactV0: z.literal(true),
    note: z.literal("Presentation framing only; not ARF→CVF or CVF→RRF registration."),
  }).strict(),
  presentationCamera: z.object({
    state: z.literal("unreviewed_visual_only"),
    position: z.tuple([z.literal(-8), z.literal(2), z.literal(8)]),
    target: z.tuple([z.literal(-8), z.literal(2), z.literal(0)]),
    fov: z.literal(65),
    controls: z.literal("bounded_orbit"),
    notTransformArtifactV0: z.literal(true),
  }).strict(),
  availableEvidence: z.object({
    inventory: z.object({
      state: z.literal("bounded_inventory_observation"),
      fileCount: z.literal(52),
      totalBytes: z.literal(182_313_418),
      sogFiles: z.literal(19),
      meshPlyFiles: z.literal(14),
      btreeFiles: z.literal(14),
      objFiles: z.literal(1),
      poseFiles: z.literal(1),
      poseCount: z.literal(2_894),
      otherFiles: z.literal(3),
    }).strict(),
    delivery: z.object({
      streamableFormat: z.literal("sog"),
      streamableMemberCount: z.literal(7),
      selectedTiers: z.tuple([z.literal("desktop"), z.literal("mobile")]),
      unstreamedEvidence: z.tuple([
        z.literal("other_sog_alternatives"),
        z.literal("mesh_ply"),
        z.literal("btree"),
        z.literal("obj"),
        z.literal("poses"),
        z.literal("manifest_report_thumbnail"),
      ]),
    }).strict(),
    operationalAuthority: z.literal("none"),
  }).strict(),
  tiers: z.tuple([DesktopTierSchema, MobileTierSchema]),
  capabilities: z.object({
    publication: z.literal(false),
    export: z.literal(false),
    measurement: z.literal(false),
    activation: z.literal(false),
  }).strict(),
}).strict();

export type LocalSogCandidateDescriptor = z.infer<typeof LocalSogCandidateDescriptorSchema>;
export type LocalSogCandidateTier = LocalSogCandidateDescriptor["tiers"][number];
export type LocalSogCandidateMember = LocalSogCandidateTier["members"][number];

export type LocalSogCandidateRequest =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "ready"; readonly descriptorUrl: string };

export type LocalSogCandidateSelectedMember = LocalSogCandidateMember & {
  readonly identity: string;
};

export interface LocalSogCandidateSelection {
  readonly tier: LocalSogCandidateTier;
  readonly members: readonly LocalSogCandidateSelectedMember[];
  readonly selectionKey: string;
}

function descriptorUrlError(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "The local SOG candidate descriptor URL is invalid.";
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port.length === 0) {
    return "The local SOG candidate descriptor must use an explicit IPv4 loopback HTTP origin and port.";
  }
  if (url.username.length > 0 || url.password.length > 0 || url.hash.length > 0) {
    return "The local SOG candidate descriptor URL cannot contain credentials or a fragment.";
  }
  if (url.pathname !== EXPECTED_DESCRIPTOR_PATH) {
    return "The local SOG candidate descriptor path is not supported.";
  }
  const keys = [...url.searchParams.keys()];
  const token = url.searchParams.get("token") ?? "";
  if (keys.length !== 1 || keys[0] !== "token" || !TOKEN_PATTERN.test(token)) {
    return "The local SOG candidate descriptor requires one valid ephemeral token.";
  }
  return null;
}

export function localSogCandidateRequestFromSearchParams(
  searchParams: URLSearchParams,
  developmentEnabled: boolean,
): LocalSogCandidateRequest {
  const values = searchParams.getAll(LOCAL_SOG_CANDIDATE_QUERY_PARAM);
  if (values.length === 0) return { kind: "none" };
  if (!developmentEnabled) {
    return {
      kind: "invalid",
      message: "Local SOG candidates are disabled outside development builds.",
    };
  }
  if (values.length !== 1) {
    return {
      kind: "invalid",
      message: "Exactly one local SOG candidate descriptor may be requested.",
    };
  }
  const descriptorUrl = values[0]?.trim() ?? "";
  if (descriptorUrl.length === 0 || descriptorUrl.length > 2_048) {
    return {
      kind: "invalid",
      message: "The local SOG candidate descriptor URL is empty or too long.",
    };
  }
  const error = descriptorUrlError(descriptorUrl);
  return error === null
    ? { kind: "ready", descriptorUrl }
    : { kind: "invalid", message: error };
}

function relativeTreeAddress(relativePath: string): readonly string[] | null {
  if (
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath.split("/").includes("..") ||
    !relativePath.startsWith("lcc2-result/data/3dgs/") ||
    !relativePath.toLowerCase().endsWith(".sog")
  ) {
    return null;
  }
  const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const stem = filename.slice(0, -4);
  return TREE_ADDRESS_PATTERN.test(stem) ? stem.split("_") : null;
}

function assertTierTotals(tier: LocalSogCandidateTier): void {
  const expected = tier.id === "desktop"
    ? { members: 4, splats: 2_482_968, bytes: 44_988_345 }
    : { members: 3, splats: 1_240_774, bytes: 24_441_495 };
  const splats = tier.members.reduce((total, item) => total + item.splatCount, 0);
  const bytes = tier.members.reduce((total, item) => total + item.sizeBytes, 0);
  if (
    tier.memberCount !== expected.members ||
    tier.members.length !== expected.members ||
    tier.splatCount !== expected.splats ||
    splats !== expected.splats ||
    tier.sizeBytes !== expected.bytes ||
    bytes !== expected.bytes
  ) {
    throw new Error(
      `${tier.id} tier exact total mismatch; expected ${expected.members.toLocaleString("en-GB")} members, ` +
      `${expected.splats.toLocaleString("en-GB")} splats, and ${expected.bytes.toLocaleString("en-GB")} bytes.`,
    );
  }
}

function assertMemberUrl(member: LocalSogCandidateMember, descriptorUrl: URL): void {
  const url = new URL(member.url);
  if (url.origin !== descriptorUrl.origin) {
    throw new Error(`Local SOG member ${member.memberId} is outside the descriptor origin.`);
  }
  if (url.protocol !== "http:" || url.username.length > 0 || url.password.length > 0 || url.hash.length > 0) {
    throw new Error(`Local SOG member ${member.memberId} has an unsafe URL.`);
  }
  if (!url.pathname.startsWith(EXPECTED_MEMBER_PATH_PREFIX)) {
    throw new Error(`Local SOG member ${member.memberId} does not use the candidate member route.`);
  }
  const encodedMemberName = url.pathname.slice(EXPECTED_MEMBER_PATH_PREFIX.length);
  if (!encodedMemberName.endsWith(".sog")) {
    throw new Error(`Local SOG member ${member.memberId} does not expose an explicit .sog decoder suffix.`);
  }
  const encodedId = encodedMemberName.slice(0, -4);
  let decodedId: string;
  try {
    decodedId = decodeURIComponent(encodedId);
  } catch {
    throw new Error(`Local SOG member ${member.memberId} has a malformed member URL.`);
  }
  if (
    encodedMemberName.includes("/") ||
    decodedId !== member.memberId ||
    encodedId !== encodeURIComponent(member.memberId)
  ) {
    throw new Error(`Local SOG member ${member.memberId} does not match its member URL.`);
  }
  const descriptorToken = descriptorUrl.searchParams.get("token");
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "token" || url.searchParams.get("token") !== descriptorToken) {
    throw new Error(`Local SOG member ${member.memberId} does not carry the descriptor session token.`);
  }
}

function assertCandidateMembers(candidate: LocalSogCandidateDescriptor, descriptorUrl: URL): void {
  const identities = new Set<string>();
  const relativePaths = new Set<string>();
  const urls = new Set<string>();
  const frontierDepths: number[] = [];
  for (const tier of candidate.tiers) {
    assertTierTotals(tier);
    const tierDepths = new Set<number>();
    for (const member of tier.members) {
      if (member.relativePath.toLowerCase().endsWith("/env.sog")) {
        throw new Error("The environment member env.sog is never a room candidate tier member.");
      }
      const treeAddress = relativeTreeAddress(member.relativePath);
      if (treeAddress === null) {
        throw new Error(`Local SOG member ${member.memberId} has an invalid relative frontier path.`);
      }
      tierDepths.add(treeAddress.length);
      assertMemberUrl(member, descriptorUrl);
      for (const [set, value, label] of [
        [identities, `${member.memberId}:${member.sha256}`, "identity"],
        [relativePaths, member.relativePath, "relative path"],
        [urls, member.url, "URL"],
      ] as const) {
        if (set.has(value)) throw new Error(`Local SOG member ${label} is duplicated across alternative tiers.`);
        set.add(value);
      }
    }
    if (tierDepths.size !== 1) {
      throw new Error(`${tier.id} tier mixes parent and child frontier depths.`);
    }
    const depth = tierDepths.values().next().value;
    if (typeof depth !== "number") throw new Error(`${tier.id} tier has no frontier depth.`);
    frontierDepths.push(depth);
  }
  if (frontierDepths[0] !== (frontierDepths[1] ?? 0) + 1) {
    throw new Error("Desktop and mobile alternatives do not represent adjacent frontier depths.");
  }
}

export function parseLocalSogCandidateDescriptor(
  value: unknown,
  descriptorUrlString: string,
): LocalSogCandidateDescriptor {
  const requestError = descriptorUrlError(descriptorUrlString);
  if (requestError !== null) throw new Error(requestError);
  const candidate = LocalSogCandidateDescriptorSchema.parse(value);
  assertCandidateMembers(candidate, new URL(descriptorUrlString));
  return candidate;
}

export function selectLocalSogCandidateTier(
  candidate: LocalSogCandidateDescriptor,
  viewportWidth: number,
  maxSplats = 4_000_000,
): LocalSogCandidateSelection {
  const desktopTier = candidate.tiers[0];
  const mobileTier = candidate.tiers[1];
  const tierId =
    viewportWidth <= LOCAL_SOG_MOBILE_MAX_VIEWPORT_WIDTH || desktopTier.splatCount > maxSplats
      ? "mobile"
      : "desktop";
  if (tierId === "mobile" && mobileTier.splatCount > maxSplats) {
    throw new Error(
      `The mobile local SOG tier exceeds this viewer's ${maxSplats.toLocaleString("en-GB")} splat limit.`,
    );
  }
  const tier = candidate.tiers.find((item) => item.id === tierId);
  if (tier === undefined) throw new Error(`The ${tierId} local SOG tier is missing.`);
  const members = tier.members.map((member) => ({
    ...member,
    identity: `${candidate.candidateDigest}:${tier.id}:${member.memberId}:${member.sha256}`,
  }));
  return {
    tier,
    members,
    selectionKey: `${candidate.candidateDigest}:${tier.id}:${members.map((item) => item.identity).join("|")}`,
  };
}
