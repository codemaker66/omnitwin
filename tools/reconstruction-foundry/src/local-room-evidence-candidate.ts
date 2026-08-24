import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";
import {
  GRAND_HALL_SMALL_FRONTIER_RECEIPT_SHA256,
  GRAND_HALL_SMALL_MANIFEST_SHA256,
  compileGrandHallSmallLocalSogCandidateDescriptorV0,
  prepareLocalExactReadOnlyMemberGrantV0,
  type LocalExactReadOnlyMemberGrantV0,
  type LocalSogCandidateMemberLeaseV0,
  type PreparedLocalExactReadOnlyMemberGrantV0,
} from "./local-sog-candidate-gateway.js";

export const LOCAL_ROOM_EVIDENCE_CANDIDATE_V0 =
  "omnitwin.local-foundry.room-evidence-candidate.v0";
export const GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_STATEMENT =
  "The operator attests that the customer owns all supplied venue data and derivatives, whether commissioned, created, or captured by the customer, and authorizes their use for all Venviewer product purposes, including internal development, customer-facing experiences, derived assets, model-assisted reconstruction, publication, and distribution.";
export const GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_SHA256 = `sha256:${createHash(
  "sha256",
)
  .update(GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_STATEMENT, "utf8")
  .digest("hex")}`;

export const TRADES_HALL_TWIN_SOURCE_MANIFEST_SHA256 =
  "sha256:96b5448ae8fbb706d85530a288b9462c7eca4ea8f8d9ff668058954901996220";
export const TRADES_HALL_TWIN_SOURCE_MANIFEST_SIZE_BYTES = 136_368;
const TWIN_SOURCE_MEMBER_COUNT = 448;
const TWIN_SOURCE_TOTAL_BYTES = 576_580_078;
const TWIN_GRAND_HALL_NODE_COUNT = 49;
const TWIN_GRAND_HALL_MEMBER_COUNT = 148;
export const ROOM_EVIDENCE_DIGEST_DOMAIN =
  "VENVIEWER_LOCAL_GRAND_HALL_ROOM_EVIDENCE_CANDIDATE_V0";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const MEMBER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SUFFIX_PATTERN = /^[a-z0-9]{2,8}$/u;
const MAX_SMALL_CONCURRENT_LEASES = 4;
const MAX_TOTAL_IN_FLIGHT_BYTES = 96 * 1024 * 1024;
const MAX_VIDEO_CONCURRENT_LEASES = 1;
export const MAX_ROOM_EVIDENCE_DESCRIPTOR_BYTES = 512 * 1024;

const EXPECTED_LCC2_MANIFEST_RELATIVE_PATH =
  "lcc2-result/Grand_Hall_Small.lcc2";
const EXPECTED_LCC2_MANIFEST_SIZE_BYTES = 108_795;

interface ExpectedMediaMember extends LocalExactReadOnlyMemberGrantV0 {
  readonly suffix: string;
  readonly mediaType: string;
  readonly role: string;
  readonly authority: "none";
  readonly alignment: "unregistered" | "source_manifest_frame_only";
  readonly provenance: string;
  readonly width?: number;
  readonly height?: number;
  readonly classification?: string;
  readonly vertexCount?: number;
  readonly faceCount?: number;
}

const LCC2_MESH_MEMBERS = Object.freeze([
  [
    "mesh-0-0-0-0",
    "data/mesh/0_0_0_0.ply",
    104_947,
    "8e806d3ec8c0b17623b05986b4ccd0d5a2bf9822f3f1ff0388ce990c4cce91c9",
    4_030,
    4_337,
  ],
  [
    "mesh-0-0-0-1",
    "data/mesh/0_0_0_1.ply",
    102_266,
    "a57a102518ab9837f9b7daebc27f55a6c59c9f8cead83cb5c1811a4869ad80db",
    3_799,
    4_344,
  ],
  [
    "mesh-0-1-0-0",
    "data/mesh/0_1_0_0.ply",
    144_256,
    "ad347ac9d5cb1570a2a026fe5d4f8dbcd2a5734b8f5c1f87e480d6a97aed9dc2",
    5_164,
    6_314,
  ],
  [
    "mesh-0-1-0-1",
    "data/mesh/0_1_0_1.ply",
    59_494,
    "1336c3033e9d2db7038907b694a5d1f230275b94cc0fce0b925a95abd84148c1",
    2_228,
    2_504,
  ],
  [
    "mesh-0-2-0-0",
    "data/mesh/0_2_0_0.ply",
    106_255,
    "8a350100ea2f30c1f0d6cf145afa6cef7f8eaa2f6571f0941be317013784c064",
    4_373,
    4_121,
  ],
  [
    "mesh-0-2-0-1",
    "data/mesh/0_2_0_1.ply",
    36_926,
    "e36efdc9c27766d894b2ccb805f306bae83897b11bac1737944999f67b1ce092",
    1_474,
    1_464,
  ],
  [
    "mesh-0-3-0-0",
    "data/mesh/0_3_0_0.ply",
    107_961,
    "6757f389ae1dcae7151ef577081e226543d4e41520e8712ad73a016678f90569",
    4_500,
    4_135,
  ],
  [
    "mesh-0-3-0-1",
    "data/mesh/0_3_0_1.ply",
    53_074,
    "3f5921c381f6d8377c3735144895d8c913b072b69dfd0c92758341fb3ef6bee4",
    2_018,
    2_204,
  ],
  [
    "mesh-0-4-0-0",
    "data/mesh/0_4_0_0.ply",
    57_704,
    "f6c0a766127c43f32620067416cf1c1da89c58cb9b2b9a99283a959e0306498d",
    2_367,
    2_238,
  ],
  [
    "mesh-0-4-0-1",
    "data/mesh/0_4_0_1.ply",
    147_368,
    "0f3aec59336a83463f56464afd052a46217d5866c796552bb4e407d2c57767d0",
    5_744,
    6_018,
  ],
  [
    "mesh-0-5-0-0",
    "data/mesh/0_5_0_0.ply",
    210_201,
    "d3ffca0ce8867e01ba9167ba49b6c601acbfb827e0016cbbf6aa36ea74cd9a0c",
    7_105,
    9_595,
  ],
  [
    "mesh-0-6-0-0",
    "data/mesh/0_6_0_0.ply",
    212_218,
    "9970b7e1e6931c3443c1032bfb652c4ae894cb6e7b99bc1698c4483f2fd8efb5",
    8_052,
    8_876,
  ],
  [
    "mesh-0-7-0-0",
    "data/mesh/0_7_0_0.ply",
    54_261,
    "773f5961c7ab00953f6951e641e847434657cc7c783c21dea95708d463265b91",
    2_313,
    2_023,
  ],
  [
    "mesh-0-7-0-1",
    "data/mesh/0_7_0_1.ply",
    163_566,
    "430411019ba33888dacc0182b5882700785826428d540912bbbf488e13ca4ac0",
    5_770,
    7_240,
  ],
] as const);

const LCC2_BTREE_IDENTITIES = Object.freeze([
  [
    "0_0_0_0.btree",
    20_896,
    "e87cce2bfdf99e16274577d3fed8e5339c2450936c8162bceb44627d6afd718d",
  ],
  [
    "0_0_0_1.btree",
    21_536,
    "67ad3100f1eb404065e3a8693178545c7b7fbbc360d57decc753b44cee81a19c",
  ],
  [
    "0_1_0_0.btree",
    30_240,
    "e8e61d2c7b84eeb3dec0215bb9f80c089ad48f523d51e26213a8823666ee4115",
  ],
  [
    "0_1_0_1.btree",
    11_808,
    "6e2901ba1cf46df40aceabf41d44064fd47df99b135723d4d70282358d8f7bb1",
  ],
  [
    "0_2_0_0.btree",
    19_808,
    "88ae80450fbbdf5ec6f1c09ca631736b33676dc353f03070de77b13c68f2f5e4",
  ],
  [
    "0_2_0_1.btree",
    7_328,
    "7756fe3463405dc9ab49a5119e4bf2ed1f5e876e9e4ed8921f8b8f0dae7deb27",
  ],
  [
    "0_3_0_0.btree",
    20_192,
    "a6b4cda28ecb9e7f731158a313c169d4be0e8252e5e3511db5acde4c70ec2635",
  ],
  [
    "0_3_0_1.btree",
    10_464,
    "2dafe5346c4cab0e124311a7e448a085de95947b77d9e5948011276a4f92092e",
  ],
  [
    "0_4_0_0.btree",
    10_976,
    "1327e2e763ef6fec4a9e62c1c28999c26db2cfe27cd6edbfa00dd04762791b61",
  ],
  [
    "0_4_0_1.btree",
    28_192,
    "5c0f5b4d1979f363031ad5bc1159641a9a5aac3dcf20f97c64f2a85d4fd352d0",
  ],
  [
    "0_5_0_0.btree",
    44_896,
    "c220fea7f9864c243a7b7d888d9ad8a507f074daede20d53892ffe85a97f1c6d",
  ],
  [
    "0_6_0_0.btree",
    43_232,
    "c757c0d65bf264ffae1df9776c85ed7fd7c06a1fa5f29365a5affee2a810a34f",
  ],
  [
    "0_7_0_0.btree",
    9_760,
    "2041ebd710142a35aeeb5ece793ecfd39cfebaf79899d093f19332c335fef370",
  ],
  [
    "0_7_0_1.btree",
    34_848,
    "2f39e3d5b727982348f857974c24437a2ef718856d683449b85bbc139f5ad615",
  ],
] as const);

const LCC2_SOG_IDENTITIES = Object.freeze([
  [
    "0_0_0_1_0_1.sog",
    11_106_664,
    "84d2a6f366eb1b7da6464c81865949d9ffbc00f12b282495ce6bd5ea1e309be8",
  ],
  [
    "0_0.sog",
    6_701_022,
    "ee974b15718e8aacf6cc4c3ddb208602bd18e5c8363159a12acd9702f4dcbe60",
  ],
  [
    "0_1_0_1_0_1.sog",
    10_482_734,
    "fb005534fb203ee9f72e08eb0c5d09017410bffa6f47956bb39898cdc95365db",
  ],
  [
    "0_1_0_1_0.sog",
    11_522_216,
    "4cdb89b8dad1cd6eaf560d4aa643e19c7398e3c449c7c8969b9487264f74275c",
  ],
  [
    "0_2_0_1_0_0.sog",
    10_287_440,
    "63198a6f95dfe76ff557de64c836d77c900be8ba7a6289e2f75ebe195b543d65",
  ],
  [
    "0_3_0_0.sog",
    10_356_300,
    "1f49fe1bd35f4e9d4207680ac9303d5ade56219c04eb0bc64451e514e4c55d7f",
  ],
  [
    "0_3_0_1_0_0.sog",
    11_390_318,
    "5d394064a76c5dc22a91f3c5642644bcad37ae188dff104e659c90255b0ee3c6",
  ],
  [
    "0_3_0_1_0.sog",
    11_656_582,
    "ee8785d1639e23917e7755c127c5fa67b3c575ea26934a8282594ec0831e567b",
  ],
  [
    "0_4_0_1_0_0.sog",
    11_223_206,
    "d337ed3ee1c0a86645b76656919e0767699a90e8fa11683db88f64c01f4e4632",
  ],
  [
    "0_5_0_0_1_0.sog",
    11_246_948,
    "fe79f0e75395554a3465861adc6fab03403cdc1d1c519ca7e79b5b00c9798634",
  ],
  [
    "0_5_0_0_1.sog",
    11_246_512,
    "dab77f8d9c0e55d659cb293fbc35392058b6810564e9b839d0e594460794e751",
  ],
  [
    "0_6_0_0_1_0.sog",
    10_377_664,
    "a73bdbde75aca7350b52efafca7931532f204279f54f32a0e699c1fc3b2c7c15",
  ],
  [
    "0_6_0_0.sog",
    9_841_081,
    "8890d03b096bd1489fb113daddfa175f653824be4cc1bafdef11925fc51e3786",
  ],
  [
    "0_6_0.sog",
    10_167_205,
    "8f88c06aed6b7fbd45c2048062ac1e3b485848f4e7a9482ef661b40769ba060c",
  ],
  [
    "0_7_0_0.sog",
    4_244_114,
    "1df5d7758af4dfb0a155e16799c8915ae850de342354d203ee7284cb17c4c75c",
  ],
  [
    "0_7_0_1_0_0.sog",
    12_269_919,
    "4548bf537f5f9618400dc6b57a6ca39c1e3c33ba9f2563bd73d6df22c5ea30d5",
  ],
  [
    "0_7_0_1_0.sog",
    10_563_035,
    "b51f3ac35985e464ae09bd9c169d224b08a3be5052919971cc0ccfb2c9178c04",
  ],
  [
    "0_7_0.sog",
    2_851_674,
    "fb48f3462508b0f4d537ca01f507d3ab2e8769f1c50c54e80ce25b36918c85df",
  ],
  [
    "env.sog",
    208_814,
    "0db3b0b2c56e81321a2e03071eff71e2bc90d19720f00ef0e1da5fbb4d90effe",
  ],
] as const);

const PUBLIC_IMAGE_MEMBERS = Object.freeze([
  [
    "reference-grand-hall-room",
    "grand-hall-room.jpg",
    530_489,
    "d57068f806f1d0d826a55b9cc2c19a63523fc47d71d326375d23427352e7905a",
    1_535,
    1_024,
    "captured_reference_image",
  ],
  [
    "reference-grand-hall-dark",
    "grand-hall-dark.jpg",
    187_509,
    "d1973ea03f25251106780b1e8cf0825a457fb6355cc77b764132ed57c26af45f",
    1_672,
    941,
    "captured_reference_image",
  ],
  [
    "reference-grand-hall-scaled",
    "Grand-Hall-scaled-opt.jpg",
    441_993,
    "1a12a119faf4621d48efeec7c51ff061e9c06c33ef2d8f9007341952e72351bb",
    1_400,
    934,
    "captured_reference_image",
  ],
  [
    "reference-grand-hall-facade",
    "grand-hall-facade-3.jpg",
    2_723_505,
    "cfe61807deb0dbae2bdeaee7abf4617d6fd7523c004e6763914c0c7c47d69601",
    1_400,
    990,
    "venue_exterior_reference_image",
  ],
  [
    "reference-grand-hall-floorplan",
    "grand-hall-floorplan.png",
    53_188,
    "532c8bc1f3a18a81aac246234ae401facd3e4d33645393d5d58dfba9bd752aad",
    1_000,
    644,
    "reference_floorplan_image",
  ],
] as const);

const EXTERNAL_CAPTURED_IMAGE = Object.freeze({
  memberId: "operator-grand-hall-reference-image",
  sizeBytes: 566_888,
  sha256:
    "sha256:93d3d926f28f0f5fad0d04f8e7f6db196f5c8849c6392a491d9cf7dd71853e53",
  width: 1_500,
  height: 1_001,
  suffix: "jpg",
  mediaType: "image/jpeg",
});

const EXTERNAL_GENERATED_IMAGE = Object.freeze({
  memberId: "operator-generated-grand-hall-reference",
  sizeBytes: 2_667_303,
  sha256:
    "sha256:9ecae501d7de555fb9669d5ef1223045cac7fe1f4a0a8243ac037da0dadbf49d",
  width: 1_122,
  height: 1_402,
  suffix: "png",
  mediaType: "image/png",
});

const EXTERNAL_REFERENCE_VIDEO = Object.freeze({
  memberId: "edited-trades-hall-reference-video",
  sizeBytes: 75_597_063,
  sha256:
    "sha256:e0c0e4e63e6466cc2649e274a067c29848ae9c6c9ca993fd56413659b9e579da",
  suffix: "mov",
  mediaType: "video/quicktime",
});

const E57_STAGE = Object.freeze({
  role: "immutable_capture_stage",
  mediaType: "application/json",
  manifestSizeBytes: 50_122,
  manifestSha256:
    "sha256:c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff",
  fileCount: 156,
  totalBytes: 22_277_494_876,
  inspection: Object.freeze({
    sizeBytes: 6_099_107,
    sha256:
      "sha256:368a4fc7799470feadac5820485854b9093c8b7de2f5ab2fc2288f2777c815c8",
    role: "capture_intake_inspection",
    mediaType: "application/json",
  }),
  e57: Object.freeze({
    sizeBytes: 20_518_437_888,
    sha256:
      "sha256:975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
    role: "metric_point_cloud_capture",
    mediaType: "model/e57",
  }),
  matterpakObj: Object.freeze({
    sizeBytes: 38_381_816,
    sha256:
      "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
    role: "venue_wide_reference_geometry",
    mediaType: "model/obj",
  }),
});

const XGRIDS_RAW_FILES = Object.freeze([
  [
    "portalcam-xbin",
    "2026-05-31-115112.xbin",
    5_587_927_040,
    "a7cc3b3198385e62598301f529a9df8dbc9b5b26e5ff8aad98a6ae58dd378d2c",
    "application/x-xgrids-xbin",
    "raw_portalcam_capture",
  ],
  [
    "portalcam-control-points",
    "project_data/control_points.csv",
    0,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "text/csv",
    "control_points",
  ],
  [
    "portalcam-gnss",
    "project_data/gnss.csv",
    823_731,
    "6ca560af782965315b00c616cbedd8a25950c23099a095437e9cb577b47d0494",
    "text/csv",
    "gnss_trajectory",
  ],
  [
    "portalcam-ulg",
    "project_data/log/data.ulg",
    7_631_121,
    "e212e38f815182d9e17947cff2e9cd944996ede521037a05bad99392ed41c723",
    "application/octet-stream",
    "flight_log",
  ],
  [
    "portalcam-lixel",
    "project_data/log/lixel.zip",
    34_676_446,
    "0ab6ef2350a071d7ccdcad8c22fa5853eb47bac58ff6fa809172efc5ad521dd3",
    "application/zip",
    "vendor_archive",
  ],
  [
    "portalcam-project",
    "project_data/log/project.json",
    2_415,
    "fc5f59bf39a90cdea9c1529d446dbf708fe56d56928ae589de25894d085163ef",
    "application/json",
    "project_metadata",
  ],
  [
    "portalcam-hierarchy",
    "project_data/model/hierarchy.bin",
    4_708,
    "5ed241c3db8e02c42026e1f983870a55d44978e36125efb67977171fd0bab711",
    "application/octet-stream",
    "vendor_hierarchy",
  ],
  [
    "portalcam-log",
    "project_data/model/log.txt",
    22_541,
    "2496228c6d1630b8589e754236041d5839cab1d62ae9e0f1e3adace8fcf154bd",
    "text/plain",
    "processing_log",
  ],
  [
    "portalcam-metadata",
    "project_data/model/metadata.json",
    1_299,
    "466839fd562a5ba838dc6d1e8d26072d581b8cde7796d9849b04d344fc3cc7ab",
    "application/json",
    "capture_metadata",
  ],
  [
    "portalcam-octree",
    "project_data/model/octree.bin",
    6_080_872,
    "fa2c8d21ae72ab0cb6b25191e4a381522b96ab00368ad9083c4b2a3727f2a077",
    "application/octet-stream",
    "vendor_octree",
  ],
  [
    "portalcam-poses",
    "project_data/poses.csv",
    496_660,
    "c9088c482e29ddfee315de1030ad1d0dd7bd998804d9484ca45bc64c9b8d1ccd",
    "text/csv",
    "camera_trajectory",
  ],
  [
    "portalcam-preview",
    "project_data/preview_photo.jpg",
    264_821,
    "502092cd4569f470fd810481cf028f2772373e346fc5f1c63081543a87a21afc",
    "image/jpeg",
    "capture_preview",
  ],
] as const);

export interface LocalRoomEvidenceCandidateOptionsV0 {
  readonly sourceRoot: string;
  readonly manifestRelativePath: string;
  readonly twinBundleRoot: string;
  readonly ownerAuthorizedVenviewerProductUse: boolean;
  readonly allowedConsumerOrigin?: string;
  readonly publicReferenceImageRoot?: string;
  readonly xgridsRawRoot?: string;
  readonly e57StageRoot?: string;
  readonly referenceVideoPath?: string;
  readonly capturedReferenceImagePath?: string;
  readonly generatedReferenceImagePath?: string;
}

export interface LocalRoomEvidenceMemberDescriptorV0 {
  readonly memberId: string;
  readonly role: string;
  readonly mediaType: string;
  readonly suffix: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly url: string;
  readonly authority: "none";
  readonly alignment: "unregistered" | "source_manifest_frame_only";
  readonly provenance: string;
  readonly width?: number;
  readonly height?: number;
  readonly classification?: string;
  readonly vertexCount?: number;
  readonly faceCount?: number;
}

export interface LocalRoomEvidenceMemberResponseV0 {
  readonly lease: LocalSogCandidateMemberLeaseV0;
  readonly mediaType: string;
  readonly suffix: string;
}

export type LocalRoomEvidenceReadResultV0 =
  | {
      readonly state: "ready";
      readonly response: LocalRoomEvidenceMemberResponseV0;
    }
  | { readonly state: "range_not_satisfiable"; readonly sizeBytes: number };

export type LocalRoomEvidenceRouteV0 =
  | { readonly kind: "descriptor" }
  | {
      readonly kind: "member";
      readonly memberId: string;
      readonly suffix: string;
    }
  | {
      readonly kind: "twin";
      readonly pathToken: string;
      readonly relativePath: string;
    };

export interface PreparedLocalRoomEvidenceCandidateV0 {
  readonly allowedConsumerOrigin: string | null;
  readonly descriptor: (
    gatewayOrigin: string,
    sessionToken: string,
  ) => Readonly<Record<string, unknown>>;
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
    suffix: string,
    rangeHeader: string | undefined,
  ) => Promise<LocalRoomEvidenceReadResultV0>;
  readonly openTwinMember: (
    relativePath: string,
    rangeHeader: string | undefined,
  ) => Promise<LocalRoomEvidenceReadResultV0>;
}

export class LocalRoomEvidenceCandidateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalRoomEvidenceCandidateError";
  }
}

function fail(message: string): never {
  throw new LocalRoomEvidenceCandidateError(message);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function canonicalRoomEvidenceJsonV0(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalRoomEvidenceJsonV0).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalRoomEvidenceJsonV0(record[key])}`,
    )
    .join(",")}}`;
}

export function compileRoomEvidenceCandidateDigestV0(profile: unknown): string {
  return sha256(
    `${ROOM_EVIDENCE_DIGEST_DOMAIN}\n${canonicalRoomEvidenceJsonV0(profile)}`,
  );
}

function withoutSessionUrls(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(withoutSessionUrls);
  const result: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(
    value as Readonly<Record<string, unknown>>,
  )) {
    if (key.toLocaleLowerCase("en-US").endsWith("url")) continue;
    result[key] = withoutSessionUrls(member);
  }
  return Object.freeze(result);
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

async function directRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0"))
    fail("An evidence source root must be an absolute local path.");
  const requested = resolve(path);
  const [metadata, canonical] = await Promise.all([
    lstat(requested),
    realpath(requested),
  ]);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    comparablePath(requested) !== comparablePath(canonical)
  ) {
    fail("An evidence source root must be a direct local directory.");
  }
  return canonical;
}

async function directFile(
  path: string,
  expectedSizeBytes: number,
): Promise<void> {
  if (!isAbsolute(path) || path.includes("\0"))
    fail("An evidence source file must be an absolute local path.");
  const requested = resolve(path);
  const [metadata, canonical] = await Promise.all([
    lstat(requested),
    realpath(requested),
  ]);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    comparablePath(requested) !== comparablePath(canonical) ||
    metadata.size !== expectedSizeBytes
  ) {
    fail(
      "An inventory-only evidence file is indirect or does not match its audited size.",
    );
  }
}

async function directRelativeFileSize(
  root: string,
  relativePath: string,
): Promise<number> {
  if (
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    return fail("An evidence member path is unsafe.");
  }
  const requested = resolve(root, ...relativePath.split("/"));
  if (!pathIsWithin(root, requested))
    fail("An evidence member escapes its source root.");
  const [metadata, canonical] = await Promise.all([
    lstat(requested),
    realpath(requested),
  ]);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    comparablePath(requested) !== comparablePath(canonical) ||
    !pathIsWithin(root, canonical)
  ) {
    fail("An evidence member is indirect or is not a regular file.");
  }
  return metadata.size;
}

async function enumerateDirectRelativeFiles(
  root: string,
): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (
    absoluteDirectory: string,
    prefix: string,
  ): Promise<void> => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath =
        prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = resolve(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink())
        fail("The twin source contains an indirect member.");
      if (entry.isDirectory()) {
        const canonical = await realpath(absolutePath);
        if (
          !pathIsWithin(root, canonical) ||
          comparablePath(canonical) !== comparablePath(absolutePath)
        ) {
          fail("The twin source contains an indirect directory.");
        }
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        await directRelativeFileSize(root, relativePath);
        files.push(relativePath);
      } else {
        fail("The twin source contains a non-regular member.");
      }
    }
  };
  await visit(root, "");
  return Object.freeze(files);
}

function validateConsumerOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("The room-evidence consumer origin is invalid.");
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
      "The room-evidence consumer origin must be an exact http://127.0.0.1:<port> origin.",
    );
  }
  return parsed.origin;
}

async function leaseBytes(
  grant: PreparedLocalExactReadOnlyMemberGrantV0,
  memberId: string,
): Promise<Buffer> {
  const result = await grant.openMember(memberId, undefined);
  if (result.state !== "ready")
    return fail("An exact evidence member could not be read.");
  const chunks: Buffer[] = [];
  const stream = result.lease.createReadStream();
  try {
    for await (const chunk of stream as AsyncIterable<unknown>) {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
      else return fail("An exact evidence stream produced an invalid chunk.");
    }
    return Buffer.concat(chunks);
  } finally {
    await result.lease.close();
  }
}

function assertMagic(member: ExpectedMediaMember, bytes: Buffer): void {
  const ok =
    (member.suffix === "webp" &&
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP") ||
    (member.suffix === "glb" &&
      bytes.length >= 4 &&
      bytes.subarray(0, 4).toString("ascii") === "glTF") ||
    (member.suffix === "jpg" &&
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (member.suffix === "png" &&
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (member.suffix === "ply" &&
      bytes.subarray(0, 3).toString("ascii") === "ply") ||
    (member.suffix === "obj" &&
      /^(?:#.*\r?\n)*(?:v|o|g)\s/mu.test(bytes.toString("utf8"))) ||
    (member.suffix === "json" &&
      ["{", "["].includes(
        bytes
          .toString("utf8", 0, Math.min(bytes.length, 256))
          .trimStart()
          .charAt(0),
      )) ||
    (member.suffix === "mov" &&
      bytes.length >= 12 &&
      bytes.subarray(4, 8).toString("ascii") === "ftyp");
  if (!ok)
    fail(
      `The ${member.memberId} bytes do not agree with their declared suffix and media type.`,
    );
}

async function validateGrantMagic(
  grant: PreparedLocalExactReadOnlyMemberGrantV0,
  members: readonly ExpectedMediaMember[],
): Promise<void> {
  for (const member of members) {
    const bytes = await leaseBytes(grant, member.memberId);
    assertMagic(member, bytes);
    if (member.suffix === "json") JSON.parse(bytes.toString("utf8")) as unknown;
    if (
      member.suffix === "obj" &&
      /^\s*mtllib\s+/imu.test(bytes.toString("utf8"))
    ) {
      fail(
        "The reference OBJ declares an external material library and cannot be granted by this slice.",
      );
    }
  }
}

function lcc2Members(): readonly ExpectedMediaMember[] {
  const meshes = LCC2_MESH_MEMBERS.map(
    ([memberId, relativePath, sizeBytes, digest, vertexCount, faceCount]) => ({
      memberId,
      relativePath: `lcc2-result/${relativePath}`,
      sizeBytes,
      sha256: `sha256:${digest}`,
      suffix: "ply",
      mediaType: "application/octet-stream",
      role: "unregistered_reference_mesh_chunk",
      authority: "none" as const,
      alignment: "unregistered" as const,
      provenance: "xgrids_lcc2_validated_manifest_bundle",
      vertexCount,
      faceCount,
    }),
  );
  return Object.freeze([
    ...meshes,
    {
      memberId: "lcc2-reference-obj",
      relativePath: "mesh-files/Grand_Hall_Small.obj",
      sizeBytes: 2_003_946,
      sha256:
        "sha256:3ff14dc72ce1c2d6e23c3a32062d2f1866c47411616ef1c080eb8345b427026e",
      suffix: "obj",
      mediaType: "model/obj",
      role: "unregistered_reference_geometry",
      authority: "none",
      alignment: "unregistered",
      provenance: "xgrids_lcc2_mesh_export",
      vertexCount: 29_562,
      faceCount: 57_191,
    },
    {
      memberId: "lcc2-thumbnail",
      relativePath: "lcc2-result/info/thumb.jpg",
      sizeBytes: 236_830,
      sha256:
        "sha256:a84b345f283f83066cdb462f29c803f480fa59d9070855f3ba9dc10243350c6d",
      suffix: "jpg",
      mediaType: "image/jpeg",
      role: "capture_preview",
      authority: "none",
      alignment: "unregistered",
      provenance: "xgrids_lcc2_export",
      classification: "captured_reference_image",
    },
    {
      memberId: "lcc2-poses",
      relativePath: "lcc2-result/info/poses.json",
      sizeBytes: 345_181,
      sha256:
        "sha256:9025889ae00a8aa36350f1596fb536cf323c3e5eefa865b063053cac99de2006",
      suffix: "json",
      mediaType: "application/json",
      role: "unregistered_camera_poses",
      authority: "none",
      alignment: "unregistered",
      provenance: "xgrids_lcc2_export",
    },
    {
      memberId: "lcc2-report",
      relativePath: "lcc2-result/info/report.json",
      sizeBytes: 545,
      sha256:
        "sha256:4cadcc8ec2b4aca3ceb9ba0a32d868089b3dd1590c21f501dd3470372c423212",
      suffix: "json",
      mediaType: "application/json",
      role: "capture_report",
      authority: "none",
      alignment: "unregistered",
      provenance: "xgrids_lcc2_export",
    },
  ]);
}

function publicImageMembers(): readonly ExpectedMediaMember[] {
  return Object.freeze(
    PUBLIC_IMAGE_MEMBERS.map(
      ([memberId, relativePath, sizeBytes, digest, width, height, role]) => ({
        memberId,
        relativePath,
        sizeBytes,
        sha256: `sha256:${digest}`,
        suffix: relativePath.endsWith(".png") ? "png" : "jpg",
        mediaType: relativePath.endsWith(".png") ? "image/png" : "image/jpeg",
        role,
        authority: "none" as const,
        alignment: "unregistered" as const,
        provenance: "venviewer_public_reference_media_exact_bytes",
        width,
        height,
        classification: role,
      }),
    ),
  );
}

function memberUrl(
  origin: string,
  token: string,
  member: ExpectedMediaMember,
): string {
  const url = new URL(
    `/api/local-room-evidence-candidate/members/${encodeURIComponent(member.memberId)}.${member.suffix}`,
    origin,
  );
  url.searchParams.set("token", token);
  return url.toString();
}

function profileMember(
  member: ExpectedMediaMember,
): Omit<LocalRoomEvidenceMemberDescriptorV0, "url"> {
  return Object.freeze({
    memberId: member.memberId,
    role: member.role,
    mediaType: member.mediaType,
    suffix: member.suffix,
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    authority: member.authority,
    alignment: member.alignment,
    provenance: member.provenance,
    ...(member.width === undefined ? {} : { width: member.width }),
    ...(member.height === undefined ? {} : { height: member.height }),
    ...(member.classification === undefined
      ? {}
      : { classification: member.classification }),
    ...(member.vertexCount === undefined
      ? {}
      : { vertexCount: member.vertexCount }),
    ...(member.faceCount === undefined ? {} : { faceCount: member.faceCount }),
  });
}

function sourceLedgerMember(
  member: ExpectedMediaMember,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...profileMember(member),
    relativePath: member.relativePath,
  });
}

export function parseLocalRoomEvidenceRouteV0(
  pathname: string,
): LocalRoomEvidenceRouteV0 | null {
  if (pathname === "/api/local-room-evidence-candidate")
    return { kind: "descriptor" };
  const member =
    /^\/api\/local-room-evidence-candidate\/members\/([a-z0-9][a-z0-9-]{0,63})\.([a-z0-9]{2,8})$/u.exec(
      pathname,
    );
  if (member !== null && member[1] !== undefined && member[2] !== undefined) {
    return { kind: "member", memberId: member[1], suffix: member[2] };
  }
  const twin =
    /^\/api\/local-room-evidence-candidate\/twin\/([A-Za-z0-9_-]{43,128})\/(tiles\/scan_\d{3}\/equirect_(?:512|4096|8192)\.webp|mesh\/dollhouse\.glb)$/u.exec(
      pathname,
    );
  if (twin !== null && twin[1] !== undefined && twin[2] !== undefined) {
    return { kind: "twin", pathToken: twin[1], relativePath: twin[2] };
  }
  return null;
}

export function projectGrandHallTwinPresentationManifestV0(
  source: TwinManifest,
): TwinManifest {
  const allowedIds = new Set(
    Array.from(
      { length: TWIN_GRAND_HALL_NODE_COUNT },
      (_, index) => `scan_${String(index).padStart(3, "0")}`,
    ),
  );
  const nodes = source.nodes.filter((node) => allowedIds.has(node.id));
  if (
    nodes.length !== TWIN_GRAND_HALL_NODE_COUNT ||
    nodes.some(
      (node, index) => node.id !== `scan_${String(index).padStart(3, "0")}`,
    )
  ) {
    return fail(
      "The validated twin source does not contain the exact ordered Grand Hall node subset.",
    );
  }
  const contentHashes: Record<string, string> = {};
  const sourceHashes = source.contentHashes ?? {};
  const meshPath = "mesh/dollhouse.glb";
  const meshHash = sourceHashes[meshPath];
  if (meshHash === undefined)
    return fail("The validated twin source has no dollhouse identity.");
  contentHashes[meshPath] = meshHash;
  for (const node of nodes) {
    for (const lod of [512, 4096, 8192] as const) {
      const path = `tiles/${node.id}/equirect_${String(lod)}.webp`;
      const digest = sourceHashes[path];
      if (digest === undefined)
        return fail(
          "The validated twin source is missing a Grand Hall panorama identity.",
        );
      contentHashes[path] = digest;
    }
  }
  const entryNodeId =
    source.entryNodeId !== undefined && allowedIds.has(source.entryNodeId)
      ? source.entryNodeId
      : nodes[0]?.id;
  return TwinManifestSchema.parse({
    ...source,
    name: `${source.name} — Grand Hall review subset`,
    capture: { kind: "matterport-e57", scanCount: TWIN_GRAND_HALL_NODE_COUNT },
    nodes,
    edges: source.edges.filter(
      (edge) => allowedIds.has(edge.a) && allowedIds.has(edge.b),
    ),
    ...(entryNodeId === undefined ? {} : { entryNodeId }),
    ...(entryNodeId === source.entryNodeId && source.entryLook !== undefined
      ? { entryLook: source.entryLook }
      : {}),
    contentHashes,
  });
}

async function prepareTwin(rootInput: string): Promise<{
  readonly root: string;
  readonly manifest: TwinManifest;
  readonly members: readonly ExpectedMediaMember[];
  readonly sourceMembers: readonly ExpectedMediaMember[];
  readonly grantByMemberId: ReadonlyMap<
    string,
    PreparedLocalExactReadOnlyMemberGrantV0
  >;
}> {
  const root = await directRoot(rootInput);
  const manifestGrant = await prepareLocalExactReadOnlyMemberGrantV0({
    sourceRoot: root,
    members: [
      {
        memberId: "twin-source-manifest",
        relativePath: "manifest.json",
        sha256: TRADES_HALL_TWIN_SOURCE_MANIFEST_SHA256,
        sizeBytes: TRADES_HALL_TWIN_SOURCE_MANIFEST_SIZE_BYTES,
      },
    ],
  });
  const source = TwinManifestSchema.parse(
    JSON.parse(
      (await leaseBytes(manifestGrant, "twin-source-manifest")).toString(
        "utf8",
      ),
    ) as unknown,
  );
  if (
    source.nodes.length !== 149 ||
    Object.keys(source.contentHashes ?? {}).length !== TWIN_SOURCE_MEMBER_COUNT
  ) {
    return fail(
      "The validated twin source inventory no longer matches its exact 149-node/448-member contract.",
    );
  }
  const sourceHashes = source.contentHashes ?? {};
  const declaredPaths = Object.keys(sourceHashes);
  const actualPaths = await enumerateDirectRelativeFiles(root);
  const expectedPaths = new Set(["manifest.json", ...declaredPaths]);
  if (
    actualPaths.length !== expectedPaths.size ||
    actualPaths.some((path) => !expectedPaths.has(path))
  ) {
    return fail(
      "The twin source contains a missing, extra, indirect, or undeclared file.",
    );
  }
  const sourceMembers: ExpectedMediaMember[] = [];
  for (const [relativePath, digest] of Object.entries(sourceHashes)) {
    const isMesh = relativePath === "mesh/dollhouse.glb";
    const match = /^tiles\/(scan_\d{3})\/equirect_(512|4096|8192)\.webp$/u.exec(
      relativePath,
    );
    if (!isMesh && match === null)
      return fail(
        "The filtered twin manifest contains an unsupported member path.",
      );
    const sizeBytes = await directRelativeFileSize(root, relativePath);
    let memberId = "twin-dollhouse-mesh";
    if (!isMesh) {
      const scanId = match?.[1];
      const lod = match?.[2];
      if (scanId === undefined || lod === undefined)
        return fail("The twin panorama member identity is invalid.");
      memberId = `twin-${scanId.replace("scan_", "s")}-${lod}`;
    }
    sourceMembers.push({
      memberId,
      relativePath,
      sha256: `sha256:${digest}`,
      sizeBytes,
      suffix: isMesh ? "glb" : "webp",
      mediaType: isMesh ? "model/gltf-binary" : "image/webp",
      role: isMesh ? "venue_context_mesh" : "equirectangular_panorama",
      authority: "none",
      alignment: "source_manifest_frame_only",
      provenance: "verified_trades_hall_twin_0_source_manifest",
      ...(isMesh
        ? {}
        : { width: Number(match?.[2]), height: Number(match?.[2]) / 2 }),
    });
  }
  if (sourceMembers.length !== TWIN_SOURCE_MEMBER_COUNT) {
    return fail(
      "The complete twin source grant must contain exactly 448 members.",
    );
  }
  if (
    sourceMembers.reduce((total, member) => total + member.sizeBytes, 0) +
      TRADES_HALL_TWIN_SOURCE_MANIFEST_SIZE_BYTES !==
    TWIN_SOURCE_TOTAL_BYTES
  ) {
    return fail(
      "The complete twin source no longer matches its exact byte inventory.",
    );
  }
  const grantByMemberId = new Map<
    string,
    PreparedLocalExactReadOnlyMemberGrantV0
  >();
  for (let offset = 0; offset < sourceMembers.length; offset += 224) {
    const batch = sourceMembers.slice(offset, offset + 224);
    const grant = await prepareLocalExactReadOnlyMemberGrantV0({
      sourceRoot: root,
      members: batch,
      maximumMembers: 224,
    });
    for (const member of batch) grantByMemberId.set(member.memberId, grant);
  }
  const sourceByPath = new Map(
    sourceMembers.map((member) => [member.relativePath, member]),
  );
  const manifest = projectGrandHallTwinPresentationManifestV0(source);
  const members = Object.keys(manifest.contentHashes ?? {}).map(
    (path): ExpectedMediaMember => {
      const member = sourceByPath.get(path);
      if (member === undefined)
        return fail(
          "The projected twin member is absent from the verified source.",
        );
      return member;
    },
  );
  if (members.length !== TWIN_GRAND_HALL_MEMBER_COUNT)
    return fail(
      "The filtered twin member grant must contain exactly 148 members.",
    );
  for (const member of members) {
    const grant = grantByMemberId.get(member.memberId);
    if (grant === undefined)
      return fail("The projected twin member has no exact grant.");
    assertMagic(member, await leaseBytes(grant, member.memberId));
  }
  return {
    root,
    manifest,
    members: Object.freeze(members),
    sourceMembers: Object.freeze(sourceMembers),
    grantByMemberId,
  };
}

async function prepareSingleExternal(
  path: string,
  expected: Omit<
    ExpectedMediaMember,
    "relativePath" | "authority" | "alignment" | "provenance" | "role"
  > & {
    readonly role: string;
    readonly classification?: string;
    readonly provenance: string;
  },
): Promise<{
  readonly member: ExpectedMediaMember;
  readonly grant: PreparedLocalExactReadOnlyMemberGrantV0;
}> {
  const member: ExpectedMediaMember = {
    ...expected,
    relativePath: basename(path),
    authority: "none",
    alignment: "unregistered",
  };
  const grant = await prepareLocalExactReadOnlyMemberGrantV0({
    sourceRoot: dirname(path),
    members: [member],
    maximumMemberBytes: member.sizeBytes,
  });
  await validateGrantMagic(grant, [member]);
  return { member, grant };
}

function referenceIdentity(
  id: string,
  sizeBytes: number,
  digest: string,
  mediaType: string,
  role: string,
  reason: string,
  verificationState = "audit_sha256_recorded_current_size_matched_hash_not_recomputed",
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id,
    sizeBytes,
    recordedSha256: digest.startsWith("sha256:") ? digest : `sha256:${digest}`,
    verificationState,
    mediaType,
    role,
    state: "inventory_only",
    authority: "none",
    alignment: "unregistered",
    reason,
  });
}

export async function prepareGrandHallLocalRoomEvidenceCandidateV0(
  options: LocalRoomEvidenceCandidateOptionsV0,
): Promise<PreparedLocalRoomEvidenceCandidateV0> {
  if (!options.ownerAuthorizedVenviewerProductUse)
    return fail(
      "The room-evidence candidate requires the explicit owner authorization attestation.",
    );
  if (options.manifestRelativePath !== EXPECTED_LCC2_MANIFEST_RELATIVE_PATH)
    return fail(
      "The room-evidence candidate requires the exact validated Grand Hall LCC2 manifest.",
    );
  const allowedConsumerOrigin = validateConsumerOrigin(
    options.allowedConsumerOrigin,
  );
  const sourceRoot = await directRoot(options.sourceRoot);
  const lcc2 = lcc2Members();
  const lcc2SogInventory: readonly LocalExactReadOnlyMemberGrantV0[] =
    LCC2_SOG_IDENTITIES.map(([name, sizeBytes, digest], index) => ({
      memberId: `inventory-sog-${String(index).padStart(2, "0")}`,
      relativePath: `lcc2-result/data/3dgs/${name}`,
      sizeBytes,
      sha256: `sha256:${digest}`,
    }));
  const lcc2BtreeInventory: readonly LocalExactReadOnlyMemberGrantV0[] =
    LCC2_BTREE_IDENTITIES.map(([name, sizeBytes, digest], index) => ({
      memberId: `inventory-btree-${String(index).padStart(2, "0")}`,
      relativePath: `lcc2-result/data/mesh/${name}`,
      sizeBytes,
      sha256: `sha256:${digest}`,
    }));
  const lcc2Grant = await prepareLocalExactReadOnlyMemberGrantV0({
    sourceRoot,
    members: [
      {
        memberId: "room-evidence-lcc2-manifest",
        relativePath: options.manifestRelativePath,
        sha256: GRAND_HALL_SMALL_MANIFEST_SHA256,
        sizeBytes: EXPECTED_LCC2_MANIFEST_SIZE_BYTES,
      },
      ...lcc2,
      ...lcc2SogInventory,
      ...lcc2BtreeInventory,
    ],
    maximumMembers: 52,
  });
  await validateGrantMagic(lcc2Grant, lcc2);
  const twin = await prepareTwin(options.twinBundleRoot);

  const publicReferenceImageRoot = options.publicReferenceImageRoot;
  const publicImages =
    publicReferenceImageRoot === undefined ? [] : publicImageMembers();
  const publicImageGrant =
    publicReferenceImageRoot === undefined
      ? undefined
      : await prepareLocalExactReadOnlyMemberGrantV0({
          sourceRoot: publicReferenceImageRoot,
          members: publicImages,
        });
  if (publicImageGrant !== undefined)
    await validateGrantMagic(publicImageGrant, publicImages);

  const externalCaptured =
    options.capturedReferenceImagePath === undefined
      ? undefined
      : await prepareSingleExternal(options.capturedReferenceImagePath, {
          ...EXTERNAL_CAPTURED_IMAGE,
          role: "operator_supplied_reference_image",
          classification: "capture_lineage_unverified",
          provenance: "operator_supplied_reference_lineage_unverified",
        });
  const externalGenerated =
    options.generatedReferenceImagePath === undefined
      ? undefined
      : await prepareSingleExternal(options.generatedReferenceImagePath, {
          ...EXTERNAL_GENERATED_IMAGE,
          role: "generated_reference_image",
          classification: "generated_reference_image",
          provenance:
            "embedded_c2pa_claim_inspected_not_cryptographically_validated_trained_algorithmic_media_openai",
        });
  const externalVideo =
    options.referenceVideoPath === undefined
      ? undefined
      : await prepareSingleExternal(options.referenceVideoPath, {
          ...EXTERNAL_REFERENCE_VIDEO,
          role: "edited_reference_video",
          classification: "capture_or_generation_lineage_unverified",
          provenance: "operator_supplied_edited_reference_export",
        });

  let e57Present = false;
  if (options.e57StageRoot !== undefined) {
    const e57Root = await directRoot(options.e57StageRoot);
    const stageManifest = await prepareLocalExactReadOnlyMemberGrantV0({
      sourceRoot: e57Root,
      members: [
        {
          memberId: "e57-stage-manifest",
          relativePath: "capture-stage-manifest.json",
          sizeBytes: E57_STAGE.manifestSizeBytes,
          sha256: E57_STAGE.manifestSha256,
        },
        {
          memberId: "e57-stage-inspection",
          relativePath: "capture-intake-inspection.json",
          sizeBytes: E57_STAGE.inspection.sizeBytes,
          sha256: E57_STAGE.inspection.sha256,
        },
      ],
    });
    JSON.parse(
      (await leaseBytes(stageManifest, "e57-stage-manifest")).toString("utf8"),
    ) as unknown;
    await directFile(
      resolve(e57Root, "source/e57/cloud_0.e57"),
      E57_STAGE.e57.sizeBytes,
    );
    await directFile(
      resolve(e57Root, "source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.obj"),
      E57_STAGE.matterpakObj.sizeBytes,
    );
    e57Present = true;
  }
  let xgridsPresent = false;
  if (options.xgridsRawRoot !== undefined) {
    const xgridsRoot = await directRoot(options.xgridsRawRoot);
    for (const [, relativePath, sizeBytes] of XGRIDS_RAW_FILES) {
      await directFile(resolve(xgridsRoot, relativePath), sizeBytes);
    }
    xgridsPresent = true;
  }

  const memberEntries = new Map<
    string,
    {
      readonly member: ExpectedMediaMember;
      readonly grant: PreparedLocalExactReadOnlyMemberGrantV0;
      readonly isVideo: boolean;
    }
  >();
  for (const member of lcc2)
    memberEntries.set(member.memberId, {
      member,
      grant: lcc2Grant,
      isVideo: false,
    });
  if (publicImages.length > 0 && publicImageGrant === undefined)
    return fail("The public reference image grant was not prepared.");
  for (const member of publicImages)
    memberEntries.set(member.memberId, {
      member,
      grant:
        publicImageGrant ??
        fail("The public reference image grant was not prepared."),
      isVideo: false,
    });
  for (const external of [externalCaptured, externalGenerated, externalVideo]) {
    if (external !== undefined)
      memberEntries.set(external.member.memberId, {
        member: external.member,
        grant: external.grant,
        isVideo: external === externalVideo,
      });
  }
  const twinEntries = new Map(
    twin.members.map((member) => [member.relativePath, member]),
  );
  let activeLeases = 0;
  let activeVideoLeases = 0;
  let inFlightBytes = 0;

  const boundedOpen = async (
    entry: {
      readonly member: ExpectedMediaMember;
      readonly grant: PreparedLocalExactReadOnlyMemberGrantV0;
      readonly isVideo: boolean;
    },
    rangeHeader: string | undefined,
  ): Promise<LocalRoomEvidenceReadResultV0> => {
    if (
      activeLeases >= MAX_SMALL_CONCURRENT_LEASES ||
      inFlightBytes + entry.member.sizeBytes > MAX_TOTAL_IN_FLIGHT_BYTES ||
      (entry.isVideo && activeVideoLeases >= MAX_VIDEO_CONCURRENT_LEASES)
    )
      return fail(
        "The bounded local evidence stream limit is busy; retry after the current read completes.",
      );
    activeLeases += 1;
    inFlightBytes += entry.member.sizeBytes;
    if (entry.isVideo) activeVideoLeases += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      activeLeases -= 1;
      inFlightBytes -= entry.member.sizeBytes;
      if (entry.isVideo) activeVideoLeases -= 1;
    };
    try {
      const opened = await entry.grant.openMember(
        entry.member.memberId,
        rangeHeader,
      );
      if (opened.state === "range_not_satisfiable") {
        release();
        return opened;
      }
      const originalClose = opened.lease.close;
      const lease: LocalSogCandidateMemberLeaseV0 = Object.freeze({
        ...opened.lease,
        close: async () => {
          try {
            await originalClose();
          } finally {
            release();
          }
        },
      });
      return {
        state: "ready",
        response: {
          lease,
          mediaType: entry.member.mediaType,
          suffix: entry.member.suffix,
        },
      };
    } catch (error: unknown) {
      release();
      throw error;
    }
  };

  const presentationManifestSha256 = sha256(
    canonicalRoomEvidenceJsonV0(twin.manifest),
  );
  const subordinateSogDescriptor =
    compileGrandHallSmallLocalSogCandidateDescriptorV0(
      "http://127.0.0.1:1",
      "a".repeat(43),
    );
  const subordinateSogMaterial = Object.freeze({
    candidateId: subordinateSogDescriptor.candidateId,
    candidateRevision: subordinateSogDescriptor.candidateRevision,
    candidateDigest: subordinateSogDescriptor.candidateDigest,
    profile: withoutSessionUrls(subordinateSogDescriptor),
    manifestSha256: subordinateSogDescriptor.source.manifestSha256,
    frontierReceiptSha256:
      subordinateSogDescriptor.source.frontierReceiptSha256,
    tiers: subordinateSogDescriptor.tiers.map((tier) => ({
      id: tier.id,
      memberCount: tier.memberCount,
      splatCount: tier.splatCount,
      sizeBytes: tier.sizeBytes,
      members: tier.members.map((member) => ({
        memberId: member.memberId,
        relativePath: member.relativePath,
        sha256: member.sha256,
        sizeBytes: member.sizeBytes,
        splatCount: member.splatCount,
      })),
    })),
  });
  const historicalColmapLedger = Object.freeze({
    id: "historical-colmap-cubefaces",
    state: "inventory_only",
    rawManifestSha256:
      "sha256:af47826e91d9cbbac0730019d3c2349ec5534fe4daafe9ac1975ebea4492a4c4",
    canonicalManifestSha256:
      "sha256:63516c0b1c9583086108879659b771809c5bea4272c175c9dbb809a6c66bfd89",
    manifestSizeBytes: 638_899,
    memberCount: 300,
    role: "historical_source_imagery",
    reason:
      "The immutable twin equirect bundle is the preferred non-duplicate browser source.",
    authority: "none",
  });
  const brushLedger = Object.freeze({
    id: "brush-splat-ply-series",
    state: "rejected",
    reason:
      "Discovered derivative series was not admitted because exact per-member identities were not supplied to this candidate and each file exceeds the bounded browser-member policy.",
    authority: "none",
  });
  const pipelineReadySlots = Object.freeze([
    {
      id: "registered_metric_room_mesh",
      state: "not_produced",
      reason:
        "No reviewed registration from source frames into the Grand Hall canonical room frame exists yet.",
    },
    {
      id: "e57_bounded_room_crop",
      state: "not_produced",
      reason:
        "The raw E57 is present but no exact Grand Hall-only bounded browser derivative has passed QA.",
    },
    {
      id: "obj_normalized_room_glb",
      state: "not_produced",
      reason:
        "The XGRIDS OBJ has no declared units or reviewed canonical transform; it remains unregistered reference geometry.",
    },
    {
      id: "movable_object_mask",
      state: "not_produced",
      reason:
        "Captured movable-content classification has not yet produced an immutable mask artifact.",
    },
  ]);
  const rightsProfile = Object.freeze({
    basis: "customer_owned",
    evidenceState: "operator_supplied_unverified",
    evidenceStateMeaning:
      "provenance_authentication_state_only_not_a_use_limitation",
    attestationStatement: GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_STATEMENT,
    attestationSha256: GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_SHA256,
    licensedUse: "authorized_for_all_venviewer_product_purposes",
    publicationAndDistributionRights: "owner_authorized",
    licensingBlocker: false,
    runtimeActivation: "technically_inactive_pending_alignment_qa_and_promotion",
  });
  const authorityProfile = Object.freeze({
    appearance: "local_unreviewed_candidate",
    geometry: "none",
    placement: "none",
    measurement: "none",
    collision: "none",
    export: "none",
  });
  const alignmentProfile = Object.freeze({
    state: "sources_not_registered",
    canonicalFrame: null,
    transforms: Object.freeze([]),
    operationalAuthority: "none",
  });
  const sourceInventories = Object.freeze([
    Object.freeze({
      sourceId: "grand-hall-small-lcc2",
      state: "present_all_52_current_bytes_validated",
      fileCount: 52,
      totalBytes: 182_313_418,
      manifestSha256: GRAND_HALL_SMALL_MANIFEST_SHA256,
    }),
    Object.freeze({
      sourceId: "trades-hall-twin-0",
      state: "present_manifest_and_all_448_current_member_bytes_validated",
      fileCount: 449,
      totalBytes: TWIN_SOURCE_TOTAL_BYTES,
      manifestSha256: TRADES_HALL_TWIN_SOURCE_MANIFEST_SHA256,
    }),
    Object.freeze({
      sourceId: "raw-xgrids-portalcam",
      state: xgridsPresent
        ? "present_current_paths_sizes_matched_audit_hashes_not_recomputed"
        : "not_supplied_to_session",
      fileCount: 12,
      totalBytes: 5_637_931_654,
    }),
    Object.freeze({
      sourceId: "matterport-e57-stage",
      state: e57Present
        ? "present_stage_manifest_and_inspection_validated_e57_obj_sizes_matched_large_member_hashes_not_recomputed"
        : "not_supplied_to_session",
      fileCount: E57_STAGE.fileCount,
      totalBytes: E57_STAGE.totalBytes,
      manifestSha256: E57_STAGE.manifestSha256,
    }),
  ]);
  const lcc2BtreeReference = Object.freeze({
    id: "lcc2-btree-indexes",
    state: "inventory_only_current_bytes_validated_not_streamed",
    count: LCC2_BTREE_IDENTITIES.length,
    identities: LCC2_BTREE_IDENTITIES.map(([name, sizeBytes, digest]) => ({
      id: name,
      sizeBytes,
      sha256: `sha256:${digest}`,
      mediaType: "application/octet-stream",
      role: "vendor_spatial_index",
    })),
    authority: "none",
    reason:
      "No reviewed browser decoder; mesh PLY siblings are granted separately.",
  });
  const lcc2SogReference = Object.freeze({
    id: "lcc2-sog-inventory",
    state: "current_bytes_validated",
    count: LCC2_SOG_IDENTITIES.length,
    selectedRenderableCount: 7,
    identities: LCC2_SOG_IDENTITIES.map(([name, sizeBytes, digest]) => ({
      id: name,
      sizeBytes,
      sha256: `sha256:${digest}`,
      mediaType: "application/x-sog",
      role:
        name === "env.sog"
          ? "excluded_environment_splat"
          : "captured_visual_splat",
    })),
    authority: "none",
    reason:
      "Seven room-only members are selected by the subordinate SOG descriptor; ancestor, alternate-LOD, and environment members remain unstreamed.",
  });
  const xgridsReference = xgridsPresent
    ? XGRIDS_RAW_FILES.map(([id, , sizeBytes, digest, mediaType, role]) =>
        referenceIdentity(
          id,
          sizeBytes,
          digest,
          mediaType,
          role,
          id === "portalcam-xbin"
            ? "No reviewed local XBIN decoder; the audited SHA is recorded and current size matched, but the 5.6 GB file was not rehashed at gateway startup."
            : "Raw PortalCam sidecar retained for provenance; not required by a reviewed browser renderer.",
        ),
      )
    : [
        Object.freeze({
          id: "raw-xgrids-portalcam",
          state: "unavailable",
          reason: "raw_xgrids_root_not_supplied_to_this_session",
        }),
      ];
  const e57Reference = e57Present
    ? [
        referenceIdentity(
          "matterport-e57",
          E57_STAGE.e57.sizeBytes,
          E57_STAGE.e57.sha256,
          "model/e57",
          "metric_point_cloud_capture",
          "Raw 20.5 GB E57 is inventory-only; the browser requires a bounded reviewed derivative.",
          "manifest_verified_current_size_matched_hash_not_recomputed",
        ),
        referenceIdentity(
          "matterpak-obj",
          E57_STAGE.matterpakObj.sizeBytes,
          E57_STAGE.matterpakObj.sha256,
          "model/obj",
          "venue_wide_reference_geometry",
          "Large venue-wide OBJ and external texture set remain inventory-only; the recorded SHA comes from the validated stage manifest and current size matched, but bytes were not rehashed at gateway startup.",
          "manifest_verified_current_size_matched_hash_not_recomputed",
        ),
        Object.freeze({
          id: "matterport-e57-stage",
          state: "inventory_only",
          manifestSha256: E57_STAGE.manifestSha256,
          manifestSizeBytes: E57_STAGE.manifestSizeBytes,
          inspectionSha256: E57_STAGE.inspection.sha256,
          inspectionSizeBytes: E57_STAGE.inspection.sizeBytes,
          verificationState:
            "stage_manifest_and_inspection_current_bytes_validated_large_members_size_matched_hash_not_recomputed",
          fileCount: E57_STAGE.fileCount,
          totalBytes: E57_STAGE.totalBytes,
          role: "immutable_capture_stage",
          authority: "none",
          reason:
            "The stage ledger is retained as provenance; large raw members are not exposed by this bounded review gateway.",
        }),
      ]
    : [
        Object.freeze({
          id: "matterport-e57-stage",
          state: "unavailable",
          reason: "e57_stage_root_not_supplied_to_this_session",
        }),
      ];
  const referenceOnlyProfile = Object.freeze([
    lcc2BtreeReference,
    lcc2SogReference,
    ...xgridsReference,
    ...e57Reference,
    brushLedger,
    historicalColmapLedger,
  ]);
  const allImages = Object.freeze([...publicImages]);
  const unclassifiedImages = Object.freeze(
    externalCaptured === undefined ? [] : [externalCaptured.member],
  );
  const generatedImages = Object.freeze(
    externalGenerated === undefined ? [] : [externalGenerated.member],
  );
  const venueContextMesh = twin.members.find(
    (candidate) => candidate.role === "venue_context_mesh",
  );
  if (venueContextMesh === undefined)
    return fail("The projected twin has no venue-context mesh.");
  const presentationsProfile = Object.freeze({
    splat: Object.freeze({
      state: "renderable",
      usage: "appearance_only",
      candidateId: subordinateSogMaterial.candidateId,
      candidateRevision: subordinateSogMaterial.candidateRevision,
      candidateDigest: subordinateSogMaterial.candidateDigest,
      manifestSha256: subordinateSogMaterial.manifestSha256,
      frontierReceiptSha256: subordinateSogMaterial.frontierReceiptSha256,
      tiers: subordinateSogMaterial.tiers,
      authority: "none",
      alignment: "unregistered",
    }),
    panoramaWalk: Object.freeze({
      state: "renderable",
      sourceId: "trades-hall-twin-0",
      sourceManifestSha256: TRADES_HALL_TWIN_SOURCE_MANIFEST_SHA256,
      sourceManifestSizeBytes: TRADES_HALL_TWIN_SOURCE_MANIFEST_SIZE_BYTES,
      sourceManifestMemberCount: TWIN_SOURCE_MEMBER_COUNT,
      grantedMemberCount: TWIN_GRAND_HALL_MEMBER_COUNT,
      presentationManifestSha256,
      presentationManifest: twin.manifest,
      projectionPolicy:
        "ordered_scan_000_through_scan_048_edges_with_both_endpoints_in_subset_147_panorama_members_plus_one_mesh",
      projectionReason:
        "Only the verified Grand Hall node subset is admitted to this bounded presentation lease.",
      defaultLod: 4096,
      maxAutomaticLod: 4096,
      manualLod: 8192,
      manualLodReason:
        "8192×4096 equirectangles are granted for one-at-a-time zoom intent only; they are never the automatic default.",
      sourceDeclaredTier: twin.manifest.tier,
      sourceDeclaredTierAdoptedAsOperationalAuthority: false,
      authority: "none",
      alignment: "source_manifest_frame_only",
    }),
    venueContextMesh: Object.freeze({
      state: "renderable",
      ...profileMember(venueContextMesh),
    }),
    meshReview: Object.freeze({
      state: "reference_only",
      members: lcc2
        .filter((member) => member.suffix === "ply" || member.suffix === "obj")
        .map(profileMember),
      authority: "none",
      alignment: "unregistered",
    }),
    capturedImages: Object.freeze({
      state: allImages.length === 0 ? "unavailable" : "renderable",
      reason:
        allImages.length === 0
          ? "captured_reference_images_not_supplied_to_this_session"
          : null,
      members: allImages.map(profileMember),
      authority: "none",
      alignment: "unregistered",
    }),
    unclassifiedImages: Object.freeze({
      state: unclassifiedImages.length === 0 ? "unavailable" : "renderable",
      reason:
        unclassifiedImages.length === 0
          ? "operator_reference_image_not_supplied_to_this_session"
          : null,
      members: unclassifiedImages.map(profileMember),
      lineage: "operator_supplied_reference_lineage_unverified",
      authority: "none",
      alignment: "unregistered",
    }),
    generatedImages: Object.freeze({
      state: generatedImages.length === 0 ? "unavailable" : "renderable",
      reason:
        generatedImages.length === 0
          ? "generated_reference_image_not_supplied_to_this_session"
          : null,
      members: generatedImages.map(profileMember),
      provenance:
        generatedImages.length === 0
          ? null
          : "embedded_c2pa_claim_inspected_not_cryptographically_validated_trained_algorithmic_media_openai",
      persistentBadge: generatedImages.length === 0 ? null : "GENERATED",
      authority: "none",
      alignment: "unregistered",
    }),
    videoReference:
      externalVideo === undefined
        ? Object.freeze({
            state: "unavailable",
            reason: "reference_video_not_supplied_to_this_session",
          })
        : Object.freeze({
            state: "renderable",
            member: profileMember(externalVideo.member),
            provenanceClass: "edited_reference_video",
            lineage: "capture_or_generation_lineage_unverified",
            playback: "manual_only",
            preload: "metadata",
            reportedMetadata: Object.freeze({
              codec: "h264",
              width: 1920,
              height: 1080,
              framesPerSecond: 60,
              durationSeconds: 9.37,
              audio: "stereo_lpcm",
              producingSoftware: "Blackmagic Design DaVinci Resolve",
            }),
            authority: "none",
            alignment: "unregistered",
          }),
    reports: Object.freeze({
      state: "reference_only",
      members: lcc2
        .filter((member) => member.suffix === "json")
        .map(profileMember),
      poseCount: 2_894,
      authority: "none",
    }),
  });
  const capabilitiesProfile = Object.freeze({
    localReview: true,
    publicationRights: true,
    publicationRuntimeActive: false,
    exportRights: true,
    operationalExportActive: false,
    measurement: false,
    placement: false,
    collision: false,
    activation: false,
  });
  const sourceLedgerProfile = Object.freeze({
    lcc2: Object.freeze({
      verificationState: "manifest_and_all_51_declared_member_bytes_rehashed",
      manifest: Object.freeze({
        relativePath: options.manifestRelativePath,
        sha256: GRAND_HALL_SMALL_MANIFEST_SHA256,
        sizeBytes: EXPECTED_LCC2_MANIFEST_SIZE_BYTES,
      }),
      frontierReceiptSha256: GRAND_HALL_SMALL_FRONTIER_RECEIPT_SHA256,
      members: Object.freeze([
        ...lcc2.map(sourceLedgerMember),
        ...LCC2_SOG_IDENTITIES.map(([name, sizeBytes, digest]) =>
          Object.freeze({
            relativePath: `lcc2-result/data/3dgs/${name}`,
            sizeBytes,
            sha256: `sha256:${digest}`,
            mediaType: "application/x-sog",
            role:
              name === "env.sog"
                ? "excluded_environment_splat"
                : "captured_visual_splat",
          }),
        ),
        ...LCC2_BTREE_IDENTITIES.map(([name, sizeBytes, digest]) =>
          Object.freeze({
            relativePath: `lcc2-result/data/mesh/${name}`,
            sizeBytes,
            sha256: `sha256:${digest}`,
            mediaType: "application/octet-stream",
            role: "vendor_spatial_index",
          }),
        ),
      ]),
      subordinateSog: subordinateSogMaterial,
    }),
    twin: Object.freeze({
      verificationState:
        "source_manifest_and_all_448_declared_current_member_bytes_rehashed",
      sourceManifestSha256: TRADES_HALL_TWIN_SOURCE_MANIFEST_SHA256,
      sourceManifestSizeBytes: TRADES_HALL_TWIN_SOURCE_MANIFEST_SIZE_BYTES,
      sourceManifestMemberCount: TWIN_SOURCE_MEMBER_COUNT,
      sourceMembers: twin.sourceMembers.map(sourceLedgerMember),
      presentationManifestSha256,
      presentationManifest: twin.manifest,
    }),
    e57: e57Present
      ? Object.freeze({
          verificationState:
            "stage_manifest_and_inspection_rehashed_large_member_sizes_matched_hashes_not_recomputed",
          stageManifest: Object.freeze({
            sha256: E57_STAGE.manifestSha256,
            sizeBytes: E57_STAGE.manifestSizeBytes,
          }),
          inspection: E57_STAGE.inspection,
          e57: Object.freeze({
            recordedSha256: E57_STAGE.e57.sha256,
            sizeBytes: E57_STAGE.e57.sizeBytes,
            mediaType: E57_STAGE.e57.mediaType,
            role: E57_STAGE.e57.role,
          }),
          matterpakObj: Object.freeze({
            recordedSha256: E57_STAGE.matterpakObj.sha256,
            sizeBytes: E57_STAGE.matterpakObj.sizeBytes,
            mediaType: E57_STAGE.matterpakObj.mediaType,
            role: E57_STAGE.matterpakObj.role,
          }),
        })
      : Object.freeze({ state: "not_supplied_to_session" }),
    xgrids: xgridsPresent
      ? Object.freeze({
          verificationState:
            "audit_sha256_recorded_current_paths_and_sizes_matched_hashes_not_recomputed",
          members: XGRIDS_RAW_FILES.map(
            ([id, relativePath, sizeBytes, digest, mediaType, role]) =>
              Object.freeze({
                id,
                relativePath,
                sizeBytes,
                recordedSha256: `sha256:${digest}`,
                mediaType,
                role,
              }),
          ),
        })
      : Object.freeze({ state: "not_supplied_to_session" }),
    historicalColmap: historicalColmapLedger,
    brushSplatSeries: brushLedger,
  });
  const stableMaterial = Object.freeze({
    schemaVersion: LOCAL_ROOM_EVIDENCE_CANDIDATE_V0,
    candidateId: "grand-hall-owner-authorized-local-evidence-v1",
    candidateRevision: 1,
    runtimeRegistration: "not_registered",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    usage: "local_multimodal_review",
    integrity: Object.freeze({
      algorithm: "sha256",
      domain: ROOM_EVIDENCE_DIGEST_DOMAIN,
      canonicalization:
        "utf8_json_recursive_lexicographic_object_keys_array_order_preserved",
    }),
    rights: rightsProfile,
    authority: authorityProfile,
    alignment: alignmentProfile,
    sources: sourceInventories,
    presentations: presentationsProfile,
    referenceOnly: referenceOnlyProfile,
    pipelineReadySlots,
    capabilities: capabilitiesProfile,
    sourceLedger: sourceLedgerProfile,
  });
  const candidateDigest = compileRoomEvidenceCandidateDigestV0(stableMaterial);

  const descriptor = (
    gatewayOrigin: string,
    sessionToken: string,
  ): Readonly<Record<string, unknown>> => {
    if (!SESSION_TOKEN_PATTERN.test(sessionToken))
      return fail("The room-evidence session token is invalid.");
    const payload = Object.freeze({
      schemaVersion: stableMaterial.schemaVersion,
      candidateId: stableMaterial.candidateId,
      candidateRevision: stableMaterial.candidateRevision,
      candidateDigest,
      profileDigest: candidateDigest,
      integrity: stableMaterial.integrity,
      profile: stableMaterial,
      leases: Object.freeze({
        splatDescriptorUrl: new URL(
            `/api/local-sog-candidate?token=${encodeURIComponent(sessionToken)}`,
            gatewayOrigin,
          ).toString(),
        panoramaAssetBaseUrl: new URL(
            `/api/local-room-evidence-candidate/twin/${encodeURIComponent(sessionToken)}/`,
            gatewayOrigin,
          ).toString(),
        venueContextMeshUrl: new URL(
            `/api/local-room-evidence-candidate/twin/${encodeURIComponent(sessionToken)}/mesh/dollhouse.glb`,
            gatewayOrigin,
          ).toString(),
        members: Object.freeze(
          [...memberEntries.values()].map(({ member }) =>
            Object.freeze({
              memberId: member.memberId,
              suffix: member.suffix,
              url: memberUrl(gatewayOrigin, sessionToken, member),
            }),
          ),
        ),
      }),
    });
    if (
      Buffer.byteLength(JSON.stringify(payload), "utf8") >=
      MAX_ROOM_EVIDENCE_DESCRIPTOR_BYTES
    ) {
      return fail(
        "The sealed room-evidence descriptor exceeds the bounded wire-size policy.",
      );
    }
    return payload;
  };

  return Object.freeze({
    allowedConsumerOrigin,
    descriptor,
    acceptsRequestOrigin: (
      requestOrigin: string | undefined,
      gatewayOrigin: string,
    ) =>
      requestOrigin === undefined ||
      requestOrigin === gatewayOrigin ||
      requestOrigin === allowedConsumerOrigin,
    corsHeaders: (requestOrigin: string | undefined, gatewayOrigin: string) =>
      requestOrigin !== undefined &&
      requestOrigin === allowedConsumerOrigin &&
      requestOrigin !== gatewayOrigin
        ? Object.freeze({
            "Access-Control-Allow-Origin": requestOrigin,
            "Access-Control-Expose-Headers":
              "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, X-Foundry-Sha256, X-Foundry-Size-Bytes",
            "Cross-Origin-Resource-Policy": "cross-origin",
            Vary: "Origin",
          })
        : Object.freeze({}),
    openMember: async (
      memberId: string,
      suffix: string,
      rangeHeader: string | undefined,
    ) => {
      if (!MEMBER_ID_PATTERN.test(memberId) || !SUFFIX_PATTERN.test(suffix))
        return fail("The room-evidence member route is invalid.");
      const entry = memberEntries.get(memberId);
      if (entry === undefined || entry.member.suffix !== suffix)
        return fail(
          "That exact room-evidence member and suffix are not granted.",
        );
      return boundedOpen(entry, rangeHeader);
    },
    openTwinMember: async (
      relativePath: string,
      rangeHeader: string | undefined,
    ) => {
      const member = twinEntries.get(relativePath);
      if (member === undefined)
        return fail(
          "That twin member is outside the exact Grand Hall presentation grant.",
        );
      const grant = twin.grantByMemberId.get(member.memberId);
      if (grant === undefined)
        return fail("That twin member has no exact prepared grant.");
      return boundedOpen({ member, grant, isVideo: false }, rangeHeader);
    },
  });
}

export function localRoomEvidenceConsumerUrlV0(
  consumerOrigin: string,
  descriptorUrl: string,
): string {
  const url = new URL("/dev/trades-hall-visual", consumerOrigin);
  url.searchParams.set("venue", "trades-hall");
  url.searchParams.set("room", "grand-hall");
  url.searchParams.set("localRoomEvidence", descriptorUrl);
  return url.toString();
}
