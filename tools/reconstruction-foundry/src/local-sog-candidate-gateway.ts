import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  sha256RegularFileWithHead,
  type ExpectedRegularFileIdentity,
} from "@omnitwin/reconstruction-foundry";

export const LOCAL_SOG_CANDIDATE_DESCRIPTOR_V0 =
  "omnitwin.local-foundry.sog-candidate-descriptor.v0";
export const GRAND_HALL_SMALL_MANIFEST_SHA256 =
  "sha256:f4ba054a560ec86fa75d623d10924ba6bf00c6790745137ec4a2c144a64da12d";
export const GRAND_HALL_SMALL_FRONTIER_RECEIPT_SHA256 =
  "sha256:fb6c12052b4029457c28e812b8d3290553415e5e69e9ae31cb08ad92d1a5d5f1";

const EXPECTED_MANIFEST_FILE_NAME = "Grand_Hall_Small.lcc2";
const EXPECTED_MANIFEST_RELATIVE_PATH = "lcc2-result/Grand_Hall_Small.lcc2";
const EXPECTED_MANIFEST_SIZE_BYTES = 108_795;
const LCC2_GUID = "8539a47831505d8b5c0891353d7f05d1";
const CANDIDATE_DIGEST_DOMAIN = "VENVIEWER_LOCAL_GRAND_HALL_SOG_CANDIDATE_V0";
export const GRAND_HALL_OPERATOR_ATTESTATION_STATEMENT =
  "The operator attests that the customer owns all supplied venue data and derivatives, whether commissioned, created, or captured by the customer, and authorizes their use for all Venviewer product purposes, including internal development, customer-facing experiences, derived assets, model-assisted reconstruction, publication, and distribution.";
export const GRAND_HALL_OPERATOR_ATTESTATION_SHA256 = `sha256:${createHash(
  "sha256",
)
  .update(GRAND_HALL_OPERATOR_ATTESTATION_STATEMENT, "utf8")
  .digest("hex")}`;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MEMBER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export const LOCAL_SOG_CANDIDATE_MAX_MEMBER_BYTES = 16 * 1024 * 1024;
export const LOCAL_EXACT_READ_ONLY_GRANT_MAX_MEMBERS = 256;
export const LOCAL_EXACT_READ_ONLY_GRANT_MAX_MEMBER_BYTES = 80 * 1024 * 1024;

export type LocalSogCandidateTierId = "desktop" | "mobile";

export interface LocalExactReadOnlyMemberGrantV0 {
  readonly memberId: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

interface ExpectedMember extends LocalExactReadOnlyMemberGrantV0 {
  readonly fileIndex: number;
  readonly splatCount: number;
}

const DESKTOP_MEMBERS = Object.freeze([
  {
    memberId: "desktop-0",
    fileIndex: 6,
    relativePath: "data/3dgs/0_1_0_1_0.sog",
    sha256:
      "sha256:4cdb89b8dad1cd6eaf560d4aa643e19c7398e3c449c7c8969b9487264f74275c",
    sizeBytes: 11_522_216,
    splatCount: 643_263,
  },
  {
    memberId: "desktop-1",
    fileIndex: 7,
    relativePath: "data/3dgs/0_3_0_1_0.sog",
    sha256:
      "sha256:ee8785d1639e23917e7755c127c5fa67b3c575ea26934a8282594ec0831e567b",
    sizeBytes: 11_656_582,
    splatCount: 649_182,
  },
  {
    memberId: "desktop-2",
    fileIndex: 8,
    relativePath: "data/3dgs/0_5_0_0_1.sog",
    sha256:
      "sha256:dab77f8d9c0e55d659cb293fbc35392058b6810564e9b839d0e594460794e751",
    sizeBytes: 11_246_512,
    splatCount: 615_820,
  },
  {
    memberId: "desktop-3",
    fileIndex: 9,
    relativePath: "data/3dgs/0_7_0_1_0.sog",
    sha256:
      "sha256:b51f3ac35985e464ae09bd9c169d224b08a3be5052919971cc0ccfb2c9178c04",
    sizeBytes: 10_563_035,
    splatCount: 574_703,
  },
] as const satisfies readonly ExpectedMember[]);

const MOBILE_MEMBERS = Object.freeze([
  {
    memberId: "mobile-0",
    fileIndex: 3,
    relativePath: "data/3dgs/0_3_0_0.sog",
    sha256:
      "sha256:1f49fe1bd35f4e9d4207680ac9303d5ade56219c04eb0bc64451e514e4c55d7f",
    sizeBytes: 10_356_300,
    splatCount: 563_937,
  },
  {
    memberId: "mobile-1",
    fileIndex: 4,
    relativePath: "data/3dgs/0_6_0_0.sog",
    sha256:
      "sha256:8890d03b096bd1489fb113daddfa175f653824be4cc1bafdef11925fc51e3786",
    sizeBytes: 9_841_081,
    splatCount: 525_405,
  },
  {
    memberId: "mobile-2",
    fileIndex: 5,
    relativePath: "data/3dgs/0_7_0_0.sog",
    sha256:
      "sha256:1df5d7758af4dfb0a155e16799c8915ae850de342354d203ee7284cb17c4c75c",
    sizeBytes: 4_244_114,
    splatCount: 151_432,
  },
] as const satisfies readonly ExpectedMember[]);

const EXPECTED_MEMBERS = Object.freeze([...DESKTOP_MEMBERS, ...MOBILE_MEMBERS]);

export interface LocalSogCandidateGrantOptionsV0 {
  /** Trusted process input. Never returned to the browser. */
  readonly sourceRoot: string;
  /** Safe path relative to sourceRoot. */
  readonly manifestRelativePath: string;
  /**
   * Explicit operator assertion for this local session. This is not legal
   * review, publication approval, or independent rights verification.
   */
  readonly ownerAuthorizedVenviewerProductUse: boolean;
  /** Optional exact consumer origin for a separate local Venviewer dev app. */
  readonly allowedConsumerOrigin?: string;
}

export interface LocalSogCandidateMemberDescriptorV0 {
  readonly memberId: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly splatCount: number;
  readonly url: string;
}

export interface LocalSogCandidateTierDescriptorV0 {
  readonly id: LocalSogCandidateTierId;
  readonly memberCount: number;
  readonly splatCount: number;
  readonly sizeBytes: number;
  readonly members: readonly LocalSogCandidateMemberDescriptorV0[];
}

export interface LocalSogCandidateDescriptorV0 {
  readonly schemaVersion: typeof LOCAL_SOG_CANDIDATE_DESCRIPTOR_V0;
  readonly candidateId: "grand-hall-small-lcc2-8539a478-v1";
  readonly candidateRevision: 1;
  readonly runtimeRegistration: "not_registered";
  readonly candidateDigest: string;
  readonly venueSlug: "trades-hall";
  readonly roomSlug: "grand-hall";
  readonly usage: "appearance_only";
  readonly labels: {
    readonly title: "Grand Hall — captured visual candidate";
    readonly source: "XGRIDS PortalCam · Grand Hall Small";
    readonly status: "Owner-authorized Venviewer use · unreviewed visual only";
    readonly caveat: "Appearance only; no placement, measurement, collision, operational export, or production activation authority. Publication rights are owner-authorized; this unregistered candidate remains technically QA-inactive.";
  };
  readonly source: {
    readonly kind: "xgrids_lcc2_sog";
    readonly manifestSha256: typeof GRAND_HALL_SMALL_MANIFEST_SHA256;
    readonly frontierReceiptSha256: typeof GRAND_HALL_SMALL_FRONTIER_RECEIPT_SHA256;
    readonly lcc2Guid: typeof LCC2_GUID;
    readonly pathExposed: false;
    readonly inventory: {
      readonly sog: { readonly count: 19 };
      readonly meshPly: { readonly count: 14 };
      readonly bvh: { readonly count: 14 };
      readonly obj: { readonly count: 1 };
      readonly poses: { readonly count: 2894 };
    };
  };
  readonly rights: {
    readonly basis: "customer_owned";
    readonly evidenceState: "operator_supplied_unverified";
    readonly evidenceReference: "user-attestation:2026-08-19";
    readonly attestationStatement: typeof GRAND_HALL_OPERATOR_ATTESTATION_STATEMENT;
    readonly attestationSha256: string;
    readonly scope: "all_venviewer_product_purposes";
    readonly licensedUse: "authorized_for_all_venviewer_product_purposes";
    readonly publicationAndDistributionRights: "owner_authorized";
    readonly licensingBlocker: false;
    readonly runtimeActivation: "technically_inactive_pending_alignment_qa_and_promotion";
  };
  readonly authority: {
    readonly appearance: "local_unreviewed_candidate";
    readonly geometry: "none";
    readonly placement: "none";
    readonly measurement: "none";
    readonly collision: "none";
    readonly export: "none";
  };
  readonly transform: {
    readonly state: "unreviewed_visual_only";
    readonly sourceFrame: "xgrids_lcc2_local";
    readonly targetFrame: null;
    readonly units: "not_established";
    readonly matrix: null;
  };
  readonly presentationTransform: {
    readonly state: "unreviewed_visual_only";
    readonly position: readonly [0, 0, 0];
    readonly rotation: readonly [-1.5707963267948966, 0, 0];
    readonly scale: 1;
    readonly notTransformArtifactV0: true;
    readonly note: "Presentation framing only; not ARF→CVF or CVF→RRF registration.";
  };
  readonly presentationCamera: {
    readonly state: "unreviewed_visual_only";
    readonly position: readonly [-8, 2, 8];
    readonly target: readonly [-8, 2, 0];
    readonly fov: 65;
    readonly controls: "bounded_orbit";
    readonly notTransformArtifactV0: true;
  };
  readonly availableEvidence: {
    readonly inventory: {
      readonly state: "bounded_inventory_observation";
      readonly fileCount: 52;
      readonly totalBytes: 182313418;
      readonly sogFiles: 19;
      readonly meshPlyFiles: 14;
      readonly btreeFiles: 14;
      readonly objFiles: 1;
      readonly poseFiles: 1;
      readonly poseCount: 2894;
      readonly otherFiles: 3;
    };
    readonly delivery: {
      readonly streamableFormat: "sog";
      readonly streamableMemberCount: 7;
      readonly selectedTiers: readonly ["desktop", "mobile"];
      readonly unstreamedEvidence: readonly [
        "other_sog_alternatives",
        "mesh_ply",
        "btree",
        "obj",
        "poses",
        "manifest_report_thumbnail",
      ];
    };
    readonly operationalAuthority: "none";
  };
  readonly tiers: readonly [
    LocalSogCandidateTierDescriptorV0,
    LocalSogCandidateTierDescriptorV0,
  ];
  readonly capabilities: {
    readonly publication: false;
    readonly export: false;
    readonly measurement: false;
    readonly activation: false;
  };
}

interface LocatedMember {
  readonly expected: LocalExactReadOnlyMemberGrantV0;
  readonly absolutePath: string;
  readonly identity: ExpectedRegularFileIdentity;
}

export interface LocalSogCandidateMemberLeaseV0 {
  readonly memberId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly start: number;
  readonly end: number;
  readonly contentLength: number;
  readonly statusCode: 200 | 206;
  readonly contentRange: string | null;
  readonly createReadStream: () => Readable;
  readonly close: () => Promise<void>;
}

export type LocalSogCandidateMemberReadResultV0 =
  | { readonly state: "ready"; readonly lease: LocalSogCandidateMemberLeaseV0 }
  | { readonly state: "range_not_satisfiable"; readonly sizeBytes: number };

export interface PreparedLocalExactReadOnlyMemberGrantV0 {
  readonly openMember: (
    memberId: string,
    rangeHeader: string | undefined,
  ) => Promise<LocalSogCandidateMemberReadResultV0>;
}

export class LocalSogCandidateGatewayError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalSogCandidateGatewayError";
  }
}

export interface PreparedLocalSogCandidateGatewayV0 {
  readonly allowedConsumerOrigin: string | null;
  readonly descriptor: (
    gatewayOrigin: string,
    sessionToken: string,
  ) => LocalSogCandidateDescriptorV0;
  readonly acceptsRequestOrigin: (
    requestOrigin: string | undefined,
    gatewayOrigin: string,
  ) => boolean;
  readonly corsHeaders: (
    requestOrigin: string | undefined,
    gatewayOrigin: string,
  ) => Readonly<Record<string, string>>;
  readonly openMember: (
    memberId: string,
    rangeHeader: string | undefined,
  ) => Promise<LocalSogCandidateMemberReadResultV0>;
}

function fail(message: string): never {
  throw new LocalSogCandidateGatewayError(message);
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replace(/^\\\\\?\\/u, "");
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparablePath(root), comparablePath(candidate));
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function identityFromStats(metadata: Stats): ExpectedRegularFileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  };
}

function sameIdentity(
  left: ExpectedRegularFileIdentity,
  right: ExpectedRegularFileIdentity,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function assertSafeRelativePath(path: string): void {
  const parts = path.split("/");
  if (
    path.length === 0 ||
    path.length > 2_048 ||
    path !== path.normalize("NFC") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    parts.some(
      (part) =>
        part === "" || part === "." || part === ".." || /[<>:"|?*]/u.test(part),
    )
  ) {
    fail("The local candidate manifest path is not a safe relative path.");
  }
}

async function locateRoot(sourceRoot: string): Promise<string> {
  if (
    sourceRoot.length === 0 ||
    sourceRoot.includes("\0") ||
    !isAbsolute(sourceRoot) ||
    (process.platform === "win32" &&
      sourceRoot.replaceAll("/", "\\").startsWith("\\\\"))
  ) {
    return fail(
      "The local candidate source root must be an absolute local path.",
    );
  }
  try {
    const requested = resolve(sourceRoot);
    const metadata = await lstat(requested);
    const canonical = await realpath(requested);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      comparablePath(canonical) !== comparablePath(requested)
    ) {
      return fail(
        "The local candidate source root must be a direct directory.",
      );
    }
    return canonical;
  } catch (error: unknown) {
    if (error instanceof LocalSogCandidateGatewayError) throw error;
    return fail("The local candidate source root is unavailable.");
  }
}

async function locateRegularFile(
  root: string,
  relativePath: string,
): Promise<{
  readonly absolutePath: string;
  readonly identity: ExpectedRegularFileIdentity;
}> {
  assertSafeRelativePath(relativePath);
  const requested = resolve(root, ...relativePath.split("/"));
  if (!pathIsWithin(root, requested)) {
    return fail(
      "A local candidate member would escape the selected source root.",
    );
  }
  try {
    const metadata = await lstat(requested);
    const canonical = await realpath(requested);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      comparablePath(canonical) !== comparablePath(requested) ||
      !pathIsWithin(root, canonical)
    ) {
      return fail(
        "A local candidate member is indirect or is not a regular file.",
      );
    }
    return { absolutePath: canonical, identity: identityFromStats(metadata) };
  } catch (error: unknown) {
    if (error instanceof LocalSogCandidateGatewayError) throw error;
    return fail("A required local candidate member is unavailable.");
  }
}

async function verifyExactFile(
  root: string,
  relativePath: string,
  expectedSizeBytes: number,
  expectedSha256: string,
): Promise<{
  readonly absolutePath: string;
  readonly identity: ExpectedRegularFileIdentity;
}> {
  const located = await locateRegularFile(root, relativePath);
  if (located.identity.size !== expectedSizeBytes) {
    return fail("A local candidate member does not match its validated size.");
  }
  const digest = await sha256RegularFileWithHead(
    located.absolutePath,
    0,
    located.identity,
  );
  if (`sha256:${digest.sha256}` !== expectedSha256) {
    return fail(
      "A local candidate member does not match its validated SHA-256.",
    );
  }
  const after = identityFromStats(await lstat(located.absolutePath));
  if (!sameIdentity(located.identity, after)) {
    return fail(
      "A local candidate member changed while its grant was prepared.",
    );
  }
  return located;
}

function validateConsumerOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("The local candidate consumer origin is invalid.");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.origin !== value
  ) {
    return fail(
      "The local candidate consumer origin must be an exact http://127.0.0.1:<port> origin.",
    );
  }
  return parsed.origin;
}

function sum(
  members: readonly ExpectedMember[],
  field: "sizeBytes" | "splatCount",
): number {
  return members.reduce((total, member) => total + member[field], 0);
}

function stableCandidateMaterial(): object {
  return {
    candidateId: "grand-hall-small-lcc2-8539a478-v1",
    candidateRevision: 1,
    runtimeRegistration: "not_registered",
    sourceManifestSha256: GRAND_HALL_SMALL_MANIFEST_SHA256,
    frontierReceiptSha256: GRAND_HALL_SMALL_FRONTIER_RECEIPT_SHA256,
    rightsBasis: "customer_owned",
    rightsEvidenceState: "operator_supplied_unverified",
    rightsEvidenceReference: "user-attestation:2026-08-19",
    attestationStatement: GRAND_HALL_OPERATOR_ATTESTATION_STATEMENT,
    attestationSha256: GRAND_HALL_OPERATOR_ATTESTATION_SHA256,
    rightsScope: "all_venviewer_product_purposes",
    licensedUse: "authorized_for_all_venviewer_product_purposes",
    publicationAndDistributionRights: "owner_authorized",
    licensingBlocker: false,
    authority: "none",
    usage: "appearance_only",
    transformState: "unreviewed_visual_only",
    presentationTransform: {
      position: [0, 0, 0],
      rotation: [-1.5707963267948966, 0, 0],
      scale: 1,
    },
    presentationCamera: {
      position: [-8, 2, 8],
      target: [-8, 2, 0],
      fov: 65,
      controls: "bounded_orbit",
    },
    tiers: [
      {
        id: "desktop",
        members: DESKTOP_MEMBERS.map((member) => ({
          ...member,
          relativePath: `lcc2-result/${member.relativePath}`,
        })),
      },
      {
        id: "mobile",
        members: MOBILE_MEMBERS.map((member) => ({
          ...member,
          relativePath: `lcc2-result/${member.relativePath}`,
        })),
      },
    ],
  };
}

function candidateDigest(): string {
  const hash = createHash("sha256");
  hash.update(`${CANDIDATE_DIGEST_DOMAIN}\n`, "utf8");
  hash.update(JSON.stringify(stableCandidateMaterial()), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function memberUrl(
  gatewayOrigin: string,
  sessionToken: string,
  memberId: string,
): string {
  const url = new URL(
    `/api/local-sog-candidate/members/${encodeURIComponent(memberId)}.sog`,
    gatewayOrigin,
  );
  url.searchParams.set("token", sessionToken);
  return url.toString();
}

function tierDescriptor(
  id: LocalSogCandidateTierId,
  members: readonly ExpectedMember[],
  gatewayOrigin: string,
  sessionToken: string,
): LocalSogCandidateTierDescriptorV0 {
  return Object.freeze({
    id,
    memberCount: members.length,
    splatCount: sum(members, "splatCount"),
    sizeBytes: sum(members, "sizeBytes"),
    members: Object.freeze(
      members.map((member) =>
        Object.freeze({
          memberId: member.memberId,
          relativePath: `lcc2-result/${member.relativePath}`,
          sha256: member.sha256,
          sizeBytes: member.sizeBytes,
          splatCount: member.splatCount,
          url: memberUrl(gatewayOrigin, sessionToken, member.memberId),
        }),
      ),
    ),
  });
}

export function compileGrandHallSmallLocalSogCandidateDescriptorV0(
  gatewayOrigin: string,
  sessionToken: string,
): LocalSogCandidateDescriptorV0 {
  const tiers: readonly [
    LocalSogCandidateTierDescriptorV0,
    LocalSogCandidateTierDescriptorV0,
  ] = Object.freeze([
    tierDescriptor("desktop", DESKTOP_MEMBERS, gatewayOrigin, sessionToken),
    tierDescriptor("mobile", MOBILE_MEMBERS, gatewayOrigin, sessionToken),
  ]);
  return Object.freeze({
    schemaVersion: LOCAL_SOG_CANDIDATE_DESCRIPTOR_V0,
    candidateId: "grand-hall-small-lcc2-8539a478-v1",
    candidateRevision: 1,
    runtimeRegistration: "not_registered",
    candidateDigest: candidateDigest(),
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    usage: "appearance_only",
    labels: Object.freeze({
      title: "Grand Hall — captured visual candidate",
      source: "XGRIDS PortalCam · Grand Hall Small",
      status: "Owner-authorized Venviewer use · unreviewed visual only",
      caveat:
        "Appearance only; no placement, measurement, collision, operational export, or production activation authority. Publication rights are owner-authorized; this unregistered candidate remains technically QA-inactive.",
    }),
    source: Object.freeze({
      kind: "xgrids_lcc2_sog",
      manifestSha256: GRAND_HALL_SMALL_MANIFEST_SHA256,
      frontierReceiptSha256: GRAND_HALL_SMALL_FRONTIER_RECEIPT_SHA256,
      lcc2Guid: LCC2_GUID,
      pathExposed: false,
      inventory: Object.freeze({
        sog: Object.freeze({ count: 19 }),
        meshPly: Object.freeze({ count: 14 }),
        bvh: Object.freeze({ count: 14 }),
        obj: Object.freeze({ count: 1 }),
        poses: Object.freeze({ count: 2_894 }),
      }),
    }),
    rights: Object.freeze({
      basis: "customer_owned",
      evidenceState: "operator_supplied_unverified",
      evidenceReference: "user-attestation:2026-08-19",
      attestationStatement: GRAND_HALL_OPERATOR_ATTESTATION_STATEMENT,
      attestationSha256: GRAND_HALL_OPERATOR_ATTESTATION_SHA256,
      scope: "all_venviewer_product_purposes",
      licensedUse: "authorized_for_all_venviewer_product_purposes",
      publicationAndDistributionRights: "owner_authorized",
      licensingBlocker: false,
      runtimeActivation:
        "technically_inactive_pending_alignment_qa_and_promotion",
    }),
    authority: Object.freeze({
      appearance: "local_unreviewed_candidate",
      geometry: "none",
      placement: "none",
      measurement: "none",
      collision: "none",
      export: "none",
    }),
    transform: Object.freeze({
      state: "unreviewed_visual_only",
      sourceFrame: "xgrids_lcc2_local",
      targetFrame: null,
      units: "not_established",
      matrix: null,
    }),
    presentationTransform: Object.freeze({
      state: "unreviewed_visual_only",
      position: Object.freeze([0, 0, 0] as const),
      rotation: Object.freeze([-1.5707963267948966, 0, 0] as const),
      scale: 1,
      notTransformArtifactV0: true,
      note: "Presentation framing only; not ARF→CVF or CVF→RRF registration.",
    }),
    presentationCamera: Object.freeze({
      state: "unreviewed_visual_only",
      position: Object.freeze([-8, 2, 8] as const),
      target: Object.freeze([-8, 2, 0] as const),
      fov: 65,
      controls: "bounded_orbit",
      notTransformArtifactV0: true,
    }),
    availableEvidence: Object.freeze({
      inventory: Object.freeze({
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
      }),
      delivery: Object.freeze({
        streamableFormat: "sog",
        streamableMemberCount: 7,
        selectedTiers: Object.freeze(["desktop", "mobile"] as const),
        unstreamedEvidence: Object.freeze([
          "other_sog_alternatives",
          "mesh_ply",
          "btree",
          "obj",
          "poses",
          "manifest_report_thumbnail",
        ] as const),
      }),
      operationalAuthority: "none",
    }),
    tiers,
    capabilities: Object.freeze({
      publication: false,
      export: false,
      measurement: false,
      activation: false,
    }),
  });
}

function parseRange(
  value: string | undefined,
  sizeBytes: number,
):
  | { readonly state: "ready"; readonly start: number; readonly end: number }
  | { readonly state: "range_not_satisfiable" } {
  if (value === undefined) {
    return { state: "ready", start: 0, end: sizeBytes - 1 };
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (match === null) return { state: "range_not_satisfiable" };
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText.length === 0 && endText.length === 0) {
    return { state: "range_not_satisfiable" };
  }
  if (startText.length === 0) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { state: "range_not_satisfiable" };
    }
    return {
      state: "ready",
      start: Math.max(0, sizeBytes - suffixLength),
      end: sizeBytes - 1,
    };
  }
  const start = Number(startText);
  const requestedEnd = endText.length === 0 ? sizeBytes - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= sizeBytes
  ) {
    return { state: "range_not_satisfiable" };
  }
  return { state: "ready", start, end: Math.min(requestedEnd, sizeBytes - 1) };
}

async function readVerifiedOpenMemberBytes(
  handle: FileHandle,
  member: LocatedMember,
): Promise<Buffer> {
  const before = identityFromStats(await handle.stat());
  if (!sameIdentity(member.identity, before)) {
    return fail("A local candidate member changed before it could be read.");
  }
  const bytes = Buffer.allocUnsafe(member.expected.sizeBytes);
  let position = 0;
  while (position < bytes.length) {
    const { bytesRead } = await handle.read(
      bytes,
      position,
      bytes.length - position,
      position,
    );
    if (bytesRead === 0) {
      return fail("A local candidate member ended before its validated size.");
    }
    position += bytesRead;
  }
  const [after, pathAfter] = await Promise.all([
    handle.stat(),
    lstat(member.absolutePath),
  ]);
  if (
    position !== member.expected.sizeBytes ||
    pathAfter.isSymbolicLink() ||
    !pathAfter.isFile() ||
    pathAfter.nlink !== 1 ||
    !sameIdentity(before, identityFromStats(after)) ||
    !sameIdentity(before, identityFromStats(pathAfter)) ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
      member.expected.sha256
  ) {
    return fail(
      "A local candidate member no longer matches its exact validated bytes.",
    );
  }
  return bytes;
}

async function openVerifiedMember(
  member: LocatedMember,
  rangeHeader: string | undefined,
): Promise<LocalSogCandidateMemberReadResultV0> {
  const selectedRange = parseRange(rangeHeader, member.expected.sizeBytes);
  if (selectedRange.state === "range_not_satisfiable") {
    return {
      state: "range_not_satisfiable",
      sizeBytes: member.expected.sizeBytes,
    };
  }
  const pathMetadata = await lstat(member.absolutePath);
  if (
    pathMetadata.isSymbolicLink() ||
    !pathMetadata.isFile() ||
    pathMetadata.nlink !== 1 ||
    !sameIdentity(member.identity, identityFromStats(pathMetadata))
  ) {
    return fail(
      "A local candidate member changed after its grant was prepared.",
    );
  }
  const handle = await open(member.absolutePath, "r");
  let bytes: Buffer;
  try {
    bytes = await readVerifiedOpenMemberBytes(handle, member);
  } finally {
    await handle.close();
  }
  return {
    state: "ready",
    lease: createMemberLease(member.expected, selectedRange, bytes),
  };
}

function createMemberLease(
  member: LocalExactReadOnlyMemberGrantV0,
  range: { readonly start: number; readonly end: number },
  immutableBytes: Buffer,
): LocalSogCandidateMemberLeaseV0 {
  let streamCreated = false;
  let closed = false;
  let bytes: Buffer | null = immutableBytes;
  const close = (): Promise<void> => {
    if (!closed) {
      closed = true;
      bytes = null;
    }
    return Promise.resolve();
  };
  const createReadStream = (): Readable => {
    if (streamCreated || closed || bytes === null) {
      return fail("A local candidate member lease can be consumed only once.");
    }
    streamCreated = true;
    return Readable.from([bytes.subarray(range.start, range.end + 1)]);
  };
  const partial = range.start !== 0 || range.end !== member.sizeBytes - 1;
  return Object.freeze({
    memberId: member.memberId,
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    start: range.start,
    end: range.end,
    contentLength: range.end - range.start + 1,
    statusCode: partial ? 206 : 200,
    contentRange: partial
      ? `bytes ${String(range.start)}-${String(range.end)}/${String(member.sizeBytes)}`
      : null,
    createReadStream,
    close,
  });
}

function memberMap(
  located: readonly LocatedMember[],
): ReadonlyMap<string, LocatedMember> {
  const result = new Map<string, LocatedMember>();
  const paths = new Set<string>();
  for (const member of located) {
    if (
      !MEMBER_ID_PATTERN.test(member.expected.memberId) ||
      result.has(member.expected.memberId) ||
      paths.has(member.expected.relativePath)
    ) {
      return fail(
        "The local candidate member grant contains an invalid identifier.",
      );
    }
    if (!SHA256_PATTERN.test(member.expected.sha256)) {
      return fail(
        "The local candidate member grant contains an invalid SHA-256.",
      );
    }
    result.set(member.expected.memberId, member);
    paths.add(member.expected.relativePath);
  }
  return result;
}

export async function prepareLocalExactReadOnlyMemberGrantV0(options: {
  readonly sourceRoot: string;
  readonly members: readonly LocalExactReadOnlyMemberGrantV0[];
  /** Defaults preserve the original SOG grant. Overrides remain hard-capped. */
  readonly maximumMembers?: number;
  readonly maximumMemberBytes?: number;
}): Promise<PreparedLocalExactReadOnlyMemberGrantV0> {
  const maximumMembers = options.maximumMembers ?? 32;
  const maximumMemberBytes =
    options.maximumMemberBytes ?? LOCAL_SOG_CANDIDATE_MAX_MEMBER_BYTES;
  if (
    !Number.isSafeInteger(maximumMembers) ||
    maximumMembers < 1 ||
    maximumMembers > LOCAL_EXACT_READ_ONLY_GRANT_MAX_MEMBERS
  ) {
    return fail("The local candidate member-count limit is invalid.");
  }
  if (
    !Number.isSafeInteger(maximumMemberBytes) ||
    maximumMemberBytes < 1 ||
    maximumMemberBytes > LOCAL_EXACT_READ_ONLY_GRANT_MAX_MEMBER_BYTES
  ) {
    return fail("The local candidate member-size limit is invalid.");
  }
  if (options.members.length === 0 || options.members.length > maximumMembers) {
    return fail(
      `A local candidate member grant must contain 1 to ${String(maximumMembers)} files.`,
    );
  }
  if (
    options.members.some(
      (member) =>
        !Number.isSafeInteger(member.sizeBytes) ||
        member.sizeBytes <= 0 ||
        member.sizeBytes > maximumMemberBytes,
    )
  ) {
    return fail(
      `Every local candidate member must be between 1 and ${String(maximumMemberBytes)} bytes.`,
    );
  }
  const sourceRoot = await locateRoot(options.sourceRoot);
  const locatedMembers: LocatedMember[] = [];
  for (const expected of options.members) {
    const located = await verifyExactFile(
      sourceRoot,
      expected.relativePath,
      expected.sizeBytes,
      expected.sha256,
    );
    locatedMembers.push({ expected, ...located });
  }
  const members = memberMap(locatedMembers);
  return Object.freeze({
    openMember: async (memberId: string, rangeHeader: string | undefined) => {
      const member = members.get(memberId);
      if (member === undefined) {
        return fail(
          "That local candidate member is not granted for this session.",
        );
      }
      return openVerifiedMember(member, rangeHeader);
    },
  });
}

export async function prepareGrandHallSmallLocalSogCandidateGatewayV0(
  options: LocalSogCandidateGrantOptionsV0,
): Promise<PreparedLocalSogCandidateGatewayV0> {
  if (!options.ownerAuthorizedVenviewerProductUse) {
    return fail(
      "The local candidate requires an explicit owner-authorized Venviewer product-use attestation.",
    );
  }
  assertSafeRelativePath(options.manifestRelativePath);
  if (
    basename(options.manifestRelativePath) !== EXPECTED_MANIFEST_FILE_NAME ||
    options.manifestRelativePath !== EXPECTED_MANIFEST_RELATIVE_PATH
  ) {
    return fail(
      "The selected local candidate is not the validated Grand Hall manifest.",
    );
  }
  const allowedConsumerOrigin = validateConsumerOrigin(
    options.allowedConsumerOrigin,
  );
  const sourceRoot = await locateRoot(options.sourceRoot);
  await verifyExactFile(
    sourceRoot,
    options.manifestRelativePath,
    EXPECTED_MANIFEST_SIZE_BYTES,
    GRAND_HALL_SMALL_MANIFEST_SHA256,
  );
  const lcc2Root = dirname(
    resolve(sourceRoot, ...options.manifestRelativePath.split("/")),
  );
  const memberGrant = await prepareLocalExactReadOnlyMemberGrantV0({
    sourceRoot: lcc2Root,
    members: EXPECTED_MEMBERS,
  });
  return Object.freeze({
    allowedConsumerOrigin,
    descriptor: compileGrandHallSmallLocalSogCandidateDescriptorV0,
    acceptsRequestOrigin: (
      requestOrigin: string | undefined,
      gatewayOrigin: string,
    ) =>
      requestOrigin === undefined ||
      requestOrigin === gatewayOrigin ||
      requestOrigin === allowedConsumerOrigin,
    corsHeaders: (requestOrigin: string | undefined, gatewayOrigin: string) => {
      if (
        requestOrigin === undefined ||
        requestOrigin === gatewayOrigin ||
        requestOrigin !== allowedConsumerOrigin
      ) {
        return Object.freeze({});
      }
      return Object.freeze({
        "Access-Control-Allow-Origin": requestOrigin,
        "Access-Control-Expose-Headers":
          "Accept-Ranges, Content-Length, Content-Range, ETag, X-Foundry-Sha256, X-Foundry-Size-Bytes",
        "Cross-Origin-Resource-Policy": "cross-origin",
        Vary: "Origin",
      });
    },
    openMember: memberGrant.openMember,
  });
}
