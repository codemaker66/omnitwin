import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256,
} from "./grand-hall-processed-big-inventory.js";
import { RuntimeSha256Schema } from "./runtime-venue-manifest.js";

/**
 * Authority-none replay evidence for the historical ARF -> CVF ICP seed.
 *
 * This artifact can reproduce and compare a historical candidate overlay. It
 * cannot identify the Grand Hall, accept cleanup, establish coordinates, or
 * authorize a transform, runtime artifact, deployment, or publication.
 */
export const GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1 =
  "venviewer.grand-hall-arf-cvf-registration-seed.v1";
export const GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1 =
  "venviewer.grand-hall.authority-none-icp-replay.v1";
export const GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256 =
  "sha256:ed3ca16cca2e039da4407a5e8025624b87970ae31bb2fa4b7b27b25cb0ba35df";
export const GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_SHA256 =
  GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256;
export const GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256 =
  "sha256:7f2cce27db8e9b5edc9892ac19a705813665fbbe69235f2523b826baf8b530c6";
export const GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256 =
  "sha256:83d9bd9564f3c5212b27260b11d0527ab496f3d1404cc05edd39013e2d3d9332";
export const GRAND_HALL_AUTHORITY_NONE_ICP_UNVALIDATED_WORKER_RECEIPT_SHA256 =
  "sha256:ecf86ad05802aab6c8893bb64942c89b86df24b171927e881035942f5c5d636d";
export const GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256 =
  "sha256:bf8379a0cd870b718c2d4a7d237bbc5b69d2687470ec4adcf369cedd27a60432";
export const GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256 =
  "sha256:5f84fa5a63f9d8fabda0f1a689d15a6c4046fd11e8d1813a53c2544bade798a6";
export const GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_V1 =
  "venviewer.grand-hall.authority-none-icp-two-process-proof.v1";
export const GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256 =
  "sha256:c9d23fa354e1415dd69fed28ebe3e3e2aa638be75283f1a93b707ed5cfd57c62";
export const GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256 =
  "sha256:8711080f64af76ea111185f0e07adf6faafafdb988f7049c9dbec210e4c5768a";
export const GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256 =
  "sha256:52c226b711c321842eecfd587de61103dc16c6c939c3fc1b064e7ab7f56067a6";
export const GRAND_HALL_AUTHORITY_NONE_ICP_CANONICAL_WORKER_RECEIPT_BYTE_LENGTH = 840_753;
export const GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256 =
  GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256;

export const GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT = 40;
export const GRAND_HALL_REGISTRATION_SEED_SOURCE_VERTEX_COUNT = 24_977;
export const GRAND_HALL_REGISTRATION_SEED_TARGET_VERTEX_COUNT = 59_049;

const FLOAT64_HEX = /^[0-9a-f]{16}$/u;
const PositiveCountSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const SafeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const IsoInstantSchema = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

function canonicalDigest(domain: string, value: unknown): `sha256:${string}` {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

function float64HexIsFinite(value: string): boolean {
  if (!FLOAT64_HEX.test(value)) return false;
  const exponent = (BigInt(`0x${value}`) >> 52n) & 0x7ffn;
  return exponent !== 0x7ffn;
}

function float64HexToNumber(value: string): number {
  const bytes = new Uint8Array(8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return new DataView(bytes.buffer).getFloat64(0, false);
}

export const GrandHallRegistrationSeedFloat64HexSchema = z
  .string()
  .regex(
    FLOAT64_HEX,
    "float64 values must be exactly 16 lowercase hexadecimal characters",
  )
  .refine(
    float64HexIsFinite,
    "float64 values must be finite IEEE-754 binary64 bit patterns",
  );
export type GrandHallRegistrationSeedFloat64Hex = z.infer<
  typeof GrandHallRegistrationSeedFloat64HexSchema
>;

const NonNegativeFloat64HexSchema =
  GrandHallRegistrationSeedFloat64HexSchema.refine(
    (value) => BigInt(`0x${value}`) >> 63n === 0n,
    "distance metrics must be non-negative float64 values",
  );

const ExactBigObjIdentitySchema = z
  .object({
    sha256: z.literal(
      "sha256:ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6",
    ),
    byteLength: z.literal(2_222_742),
    vertexRecordCount: z.literal(34_040),
    faceRecordCount: z.literal(59_763),
    orderedVerticesPackedLittleEndianFloat64RawSha256: z.literal(
      "sha256:94515cd5c338cae7b774c698cc880b31c85035f45247aab98f2847a5f4bfdb9e",
    ),
    boundsMetres: z
      .object({
        min: z.tuple([
          z.literal(-31.858929),
          z.literal(-23.662237),
          z.literal(-6.327585),
        ]),
        max: z.tuple([z.literal(3.825), z.literal(4.925), z.literal(8.617472)]),
      })
      .strict(),
  })
  .strict();

const ExactMatterPakObjIdentitySchema = z
  .object({
    sha256: z.literal(
      "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
    ),
    byteLength: z.literal(38_381_816),
    vertexRecordCount: z.literal(237_561),
    faceRecordCount: z.literal(474_049),
    orderedVerticesPackedLittleEndianFloat64RawSha256: z.literal(
      "sha256:6131e230ef394052f760be75bc2b8dcf7812dafe405dad3b22f1fd049cf7a72f",
    ),
    boundsMetres: z
      .object({
        min: z.tuple([
          z.literal(-6.166),
          z.literal(-12.362),
          z.literal(-4.151),
        ]),
        max: z.tuple([
          z.literal(21.365002),
          z.literal(13.696001),
          z.literal(9.05),
        ]),
      })
      .strict(),
  })
  .strict();

const ExactRoom9IdentitySchema = z
  .object({
    groupIndex: z.literal(1),
    subIndex: z.literal(9),
    exactObjGroupSuffix: z.literal("_group001_sub009"),
    groupCount: z.literal(43),
    faceCount: z.literal(119_564),
    uniqueGlobalFaceReferencedVertexCount: z.literal(
      GRAND_HALL_REGISTRATION_SEED_TARGET_VERTEX_COUNT,
    ),
    connectedComponentCount: z.literal(90),
    verticesSharedWithOtherRoomGroups: z.literal(174),
    vertexAabbMetres: z
      .object({
        min: z.tuple([
          z.literal(-2.425),
          z.literal(-11.334001),
          z.literal(-1.02),
        ]),
        max: z.tuple([z.literal(19.695002), z.literal(1.553), z.literal(9.05)]),
      })
      .strict(),
    faceOrdinalInventorySha256: z.literal(
      "sha256:bdad33cd4525d7b2edba37a8b7ee730ea0ba184b32e24e43123a0ad2bc4e4d75",
    ),
  })
  .strict();

const SourceLineageSchema = z
  .object({
    rawXgridsReceiptSha256: z.literal(
      "sha256:dc2259089043ae4a1d95663f251d4bd94699124cd49baa3b8958a0d668389b8a",
    ),
    rawXgridsInventorySha256: z.literal(
      "sha256:6e6fe18c4944cb5a0e68a69c3bc9dbb808835be6293465f50652d47e8df68236",
    ),
    rawXgridsXbinSha256: z.literal(
      "sha256:42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0",
    ),
    processedBigModelGuid: z.literal("2d483e031ad40e259c75f765d6f5fcbb"),
    processedBigInventorySha256: z.literal(
      GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256,
    ),
    historicalSogCoreInventorySha256: z.literal(
      "sha256:4585ff38e79858c35c4c1774a29a759ff85881bf5ee3d46bd7f96cae40e69c5a",
    ),
    historicalSogManifestSha256: z.literal(
      "sha256:927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659",
    ),
    historicalFrontierReceiptSha256: z.literal(
      "sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352",
    ),
  })
  .strict();

const TargetLineageSchema = z
  .object({
    matterPakE57ReceiptSha256: z.literal(
      "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b",
    ),
    room9BoundaryEvidenceSha256: z.literal(
      "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4",
    ),
    room9BoundaryManifestSha256: z.literal(
      "sha256:289dff7895d9e840671d503b74f576460f6e15b7ff32efae0ca12a866a875dd3",
    ),
    interfaceAtlasSha256: z.literal(
      "sha256:6f7b702ef8b74b22e6d83d516ff8a2b160ee78ddcdd66f7a06370982ed96e4bc",
    ),
    scopeReviewPackSha256: z.literal(
      "sha256:0906aeba265aea9879a65c5e7d698ddaaa5e54912d7024868c1a1abaaf618530",
    ),
  })
  .strict();

export const GRAND_HALL_REGISTRATION_SEED_INITIAL_MATRIX_FLOAT64_HEX = [
  "0000000000000000",
  "bff0000000000000",
  "0000000000000000",
  "0000000000000000",
  "3ff0000000000000",
  "0000000000000000",
  "0000000000000000",
  "0000000000000000",
  "0000000000000000",
  "0000000000000000",
  "3ff0000000000000",
  "4002666666666666",
  "0000000000000000",
  "0000000000000000",
  "0000000000000000",
  "3ff0000000000000",
] as const;

export const GRAND_HALL_REGISTRATION_SEED_CANDIDATE_MATRIX_FLOAT64_HEX = [
  "3f93636bdb01efde",
  "bfeffe78b7a6fa57",
  "3f6f54969a53d80a",
  "3fd0fa5d02ee6f80",
  "3feffe87ed5f1b8d",
  "3f9363bd031a1747",
  "3f325da529742bcb",
  "bfd6973baaf46bc0",
  "bf371bbca2c0e350",
  "3f6f4805bc7ebfdf",
  "3feffff09485befd",
  "4002856a4c3755ea",
  "0000000000000000",
  "0000000000000000",
  "0000000000000000",
  "3ff0000000000000",
] as const;

const InitialMatrixSchema = z.tuple(
  GRAND_HALL_REGISTRATION_SEED_INITIAL_MATRIX_FLOAT64_HEX.map((value) =>
    z.literal(value),
  ) as [
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
    z.ZodLiteral<string>,
  ],
);

const SourceSelectionSchema = z
  .object({
    rule: z.literal(
      "all_big_obj_vertices_whose_fixed_initial_placement_is_within_expanded_room9_vertex_aabb",
    ),
    initialPlacement: z
      .object({
        operationOrder: z.literal("positive_90_degrees_about_z_then_translate"),
        translationMetres: z.tuple([
          z.literal(0),
          z.literal(0),
          z.literal(2.3),
        ]),
        rowMajorMatrixFloat64Hex: InitialMatrixSchema,
      })
      .strict(),
    targetEnvelopeBasis: z.literal(
      "exact_room9_unique_face_referenced_vertex_aabb",
    ),
    aabbExpansionMetresFloat64Hex: z.literal("3fe8000000000000"),
    boundaryComparison: z.literal("inclusive_on_all_three_axes"),
    ordering: z.literal(
      "trimesh_loaded_vertex_ordinal_ascending_with_process_false_and_maintain_order_true",
    ),
    expectedSelectedVertexCount: z.literal(
      GRAND_HALL_REGISTRATION_SEED_SOURCE_VERTEX_COUNT,
    ),
    selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256: z.literal(
      "sha256:dd4472d4ae5a0c3a926e69565733923a464a0779e16f37963889184e0db3035d",
    ),
    selectedOriginalVerticesPackedLittleEndianFloat64RawSha256: z.literal(
      "sha256:337109fc3a5b0224df6ef6d90c2e799f31ce9c613d34cb94b666e1382dadefd6",
    ),
    selectedVertexInventoryCount: z.literal(
      GRAND_HALL_REGISTRATION_SEED_SOURCE_VERTEX_COUNT,
    ),
  })
  .strict();

const TargetSelectionSchema = z
  .object({
    rule: z.literal(
      "unique_global_vertices_referenced_by_all_exact_room9_faces",
    ),
    faceSelectionPredicate: z.literal(
      "active_obj_group_string_ends_with__group001_sub009",
    ),
    deduplicationKey: z.literal("matterpak_obj_global_vertex_ordinal"),
    ordering: z.literal("matterpak_obj_global_vertex_ordinal_ascending"),
    selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256:
      z.literal(
        "sha256:91f810dcec2873d9e3d072b3f53b393f82f1ea62c0fc5b1f0095cfbb7db6e917",
      ),
    selectedOrderedVerticesPackedLittleEndianFloat64RawSha256: z.literal(
      "sha256:27e7d980d3e535dad43d59af4c17ff3d8152c0138d5c8904eb2e2e319d5acdde",
    ),
    selectedVertexInventoryCount: z.literal(
      GRAND_HALL_REGISTRATION_SEED_TARGET_VERTEX_COUNT,
    ),
  })
  .strict();

export const GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE = [
  {
    stageOrdinal: 1,
    firstIteration: 1,
    lastIteration: 8,
    iterationCount: 8,
    maximumCorrespondenceDistanceMetresFloat64Hex: "3fe3333333333333",
  },
  {
    stageOrdinal: 2,
    firstIteration: 9,
    lastIteration: 20,
    iterationCount: 12,
    maximumCorrespondenceDistanceMetresFloat64Hex: "3fd6666666666666",
  },
  {
    stageOrdinal: 3,
    firstIteration: 21,
    lastIteration: 32,
    iterationCount: 12,
    maximumCorrespondenceDistanceMetresFloat64Hex: "3fc999999999999a",
  },
  {
    stageOrdinal: 4,
    firstIteration: 33,
    lastIteration: 40,
    iterationCount: 8,
    maximumCorrespondenceDistanceMetresFloat64Hex: "3fbeb851eb851eb8",
  },
] as const;

export const GRAND_HALL_REGISTRATION_SEED_MUTUAL_CORRESPONDENCE_COUNTS = [
  5_404, 5_763, 6_111, 6_482, 6_773, 7_126, 7_386, 7_684, 7_897, 8_170, 8_368,
  8_604, 8_811, 9_020, 9_132, 9_266, 9_309, 9_325, 9_304, 9_298, 9_198, 9_192,
  9_189, 9_197, 9_202, 9_204, 9_204, 9_204, 9_207, 9_203, 9_201, 9_200, 8_280,
  8_283, 8_277, 8_275, 8_284, 8_290, 8_288, 8_294,
] as const;
export const GRAND_HALL_REGISTRATION_SEED_CORRESPONDENCE_PAIR_RAW_SHA256 = [
  "sha256:15e1e2017996b530bf6f48d7e0871094e662988f2e1be07b1ab049e7d4578033",
  "sha256:6af6856ca36a73b7e239892d71a4f9cb1c44ca44cb042acb963a80e41e21f7d1",
  "sha256:336a1a511ca46d4ffbf1a51c6e2603d9d0d228525da9c502b95ca939a39727e8",
  "sha256:177d748a194fcb1bf2f860b3cabbec4f21e77eab3f7d47a2348497330a79a928",
  "sha256:8d9a7611d3c9b83d2ffac8b538ce0b4445628023fd409885ed103f7844858866",
  "sha256:1a024fd3f4fbc03e996b0430d5549be62326ca37e5c98b8c6fdd628ae1114bf5",
  "sha256:64330cebde26268970a53ab6beddfec079afb05f205ab36a981e542de061fddf",
  "sha256:12dfd677da1c13483c3a4d33945ed529b117809019ef7dc40c70de29a2f64547",
  "sha256:9d4bb290df35062c48661b674f81e982f22363d4661c67117c37ba6b1e6fad89",
  "sha256:42f0fd7f7cfb67cb674563d840b627d3fa7fa2d023b0de030b3fbb62fcdef2ed",
  "sha256:c22b0ab42a2003e789d003982c7518532a55b448b4ef513196637d0a06822a25",
  "sha256:3b0bc97c707f9974c6fd5454527c721dd61b2822650ad1fe5b4f942825db971c",
  "sha256:bc0f677d6fae1e5afe18c359784d4cfd9202b2ebc3585d91f13c9dd82990f821",
  "sha256:d4c2b282ad791f35c9ef289499978a2313f8ff14dbbb586bd0e312784a02d756",
  "sha256:62c2984c59724e49192b7f410e6373c2a34244d19a19fecc66c380c98bf65162",
  "sha256:8fc15487424264aef64c0afb82ecaa187aaf222bd372c6fd0cc78891dec292cf",
  "sha256:979f85220faa2eacc00d506bb2a1792d3f89cde3fb1411b81efaafacc15b8315",
  "sha256:f5c0b46f077ab8539eb312f80138a2cb4f7e20b306353236f4f4a1cdafb52db8",
  "sha256:472b254aa97808997253c2eca88e249cc02d6934407d8b5fdef850840e646525",
  "sha256:1c912ac8714920755fd6279530a05c359c662187e0790139474c7e71f1a7746b",
  "sha256:5f49e03b784dbdc43518cd8907a9ce1cf554619e85e3e2710619d8733b655786",
  "sha256:1e9e629076cedad077a1ae463e86a3d2ee83ea46225bf1bd25b38b1f13b73fbd",
  "sha256:6495be9f246bbd1eb81e4a9246f60ef9985d9d15b92bd9abdfe3f0f4063500ff",
  "sha256:100c14f78badc9f171417afa26d10e39ce48682c22e50137c58eea567e1f065a",
  "sha256:64572c8eff9346cb6418dff4014ad227511bedb0732366d2253d175b2226acce",
  "sha256:75c6b723525b68d01e2f006925dcd2c6cf681a66485a46b56b75672b76a8c68e",
  "sha256:e6879a090f029327992893fc1d6f22b81e6ab7532815cc0ecb89755afa5e3e29",
  "sha256:0f120ba6629b379b7c5cea32840c5e0f7568a7ae026e8649737aac7ca764a1a8",
  "sha256:0738625f0847b5cfc5c62a10a1f65563919aac21dede9a860ee98af1ee6816ba",
  "sha256:68fdde175de51856e79a25fa32ed9f7dfdb5ab6f8e9be1e2506fe38ae1790a57",
  "sha256:93f601c276e2c63726510170672593b868f7d0da18c8df27eb3c6872dd9de3d3",
  "sha256:7a37e7af800c58ee05b7ac73078b6b0305f7d1a4ff34151c1cc12fe3e72645ca",
  "sha256:f7b6c0f45efb507811711e4dca5f99b68d4719830573158af61abe24f37072c9",
  "sha256:7531a083caad8140f19ab1cf4f8eaf79ac23cc92de77ed1d9121f8657e0bcfc8",
  "sha256:6724280d5ec162f96801ebdd9baa51af74c0851a7617dca0fde4463ce34023d4",
  "sha256:209faa9322d1efd4ec74f05a4dff8ab261dd44c83f379eebff131965dd77442e",
  "sha256:1fe9c7255b2b03997292ce76e2d97f85ac5843ae77a0d0df0bf4459315c4c6d1",
  "sha256:623f4bfa9183f25b94d558be51f4e83fe55a65bb5e584a1e0c44ed19f448ced8",
  "sha256:5f9a23f61cdca575c7f1f1b38175748359930fb34e870282ba7100d81c7d650b",
  "sha256:d02c5b126b52046d3341cf099aec0c4a2b9a2592fa59d8481f443dc8f4549f3d",
] as const;
export const GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_CORRESPONDENCE_COUNT = 8_290;

function exactScheduleStageSchema(
  stage: (typeof GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE)[number],
) {
  return z
    .object({
      stageOrdinal: z.literal(stage.stageOrdinal),
      firstIteration: z.literal(stage.firstIteration),
      lastIteration: z.literal(stage.lastIteration),
      iterationCount: z.literal(stage.iterationCount),
      maximumCorrespondenceDistanceMetresFloat64Hex: z.literal(
        stage.maximumCorrespondenceDistanceMetresFloat64Hex,
      ),
    })
    .strict();
}

const FixedScheduleSchema = z
  .object({
    method: z.literal("mutual_nearest_neighbor_point_to_point_icp"),
    iterationCount: z.literal(GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT),
    stages: z.tuple([
      exactScheduleStageSchema(GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE[0]),
      exactScheduleStageSchema(GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE[1]),
      exactScheduleStageSchema(GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE[2]),
      exactScheduleStageSchema(GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE[3]),
    ]),
  })
  .strict();

const IterationTraceMaterialSchema = z
  .object({
    iterationOrdinal: z
      .number()
      .int()
      .min(1)
      .max(GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT),
    stageOrdinal: z.number().int().min(1).max(4),
    maximumCorrespondenceDistanceMetresFloat64Hex:
      GrandHallRegistrationSeedFloat64HexSchema,
    sourceVertexCount: PositiveCountSchema,
    targetVertexCount: PositiveCountSchema,
    mutualCorrespondenceCount: z
      .number()
      .int()
      .min(3)
      .max(Number.MAX_SAFE_INTEGER),
    correspondencePairInventoryRawSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((iteration, ctx) => {
    if (
      iteration.mutualCorrespondenceCount > iteration.sourceVertexCount ||
      iteration.mutualCorrespondenceCount > iteration.targetVertexCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mutualCorrespondenceCount"],
        message:
          "mutual correspondence count cannot exceed either input selection count",
      });
    }
  });

export function computeGrandHallRegistrationSeedIterationSha256(
  iteration: z.input<typeof IterationTraceMaterialSchema>,
): `sha256:${string}` {
  const parsed = IterationTraceMaterialSchema.parse(iteration);
  return canonicalDigest(
    `${GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1}.iteration-trace`,
    parsed,
  );
}

const IterationTraceSchema = z
  .object({
    iterationOrdinal: z
      .number()
      .int()
      .min(1)
      .max(GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT),
    stageOrdinal: z.number().int().min(1).max(4),
    maximumCorrespondenceDistanceMetresFloat64Hex:
      GrandHallRegistrationSeedFloat64HexSchema,
    sourceVertexCount: PositiveCountSchema,
    targetVertexCount: PositiveCountSchema,
    mutualCorrespondenceCount: z
      .number()
      .int()
      .min(3)
      .max(Number.MAX_SAFE_INTEGER),
    correspondencePairInventoryRawSha256: RuntimeSha256Schema,
    iterationSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((iteration, ctx) => {
    const { iterationSha256, ...material } = iteration;
    const parsed = IterationTraceMaterialSchema.safeParse(material);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return;
    }
    if (
      iterationSha256 !==
      computeGrandHallRegistrationSeedIterationSha256(parsed.data)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["iterationSha256"],
        message:
          "iteration trace self-digest does not match its canonical material",
      });
    }
  });

const IterationTraceCollectionMaterialSchema = z
  .object({
    iterationCount: z.literal(GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT),
    iterations: z
      .array(IterationTraceSchema)
      .length(GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT),
  })
  .strict()
  .superRefine((trace, ctx) => {
    for (let index = 0; index < trace.iterations.length; index += 1) {
      const iteration = trace.iterations[index];
      if (iteration === undefined) continue;
      const expectedOrdinal = index + 1;
      const stage = GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE.find(
        (candidate) =>
          expectedOrdinal >= candidate.firstIteration &&
          expectedOrdinal <= candidate.lastIteration,
      );
      if (iteration.iterationOrdinal !== expectedOrdinal) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["iterations", index, "iterationOrdinal"],
          message:
            "iteration traces must be complete and ordered from 1 through 40",
        });
      }
      if (
        stage === undefined ||
        iteration.stageOrdinal !== stage.stageOrdinal ||
        iteration.maximumCorrespondenceDistanceMetresFloat64Hex !==
          stage.maximumCorrespondenceDistanceMetresFloat64Hex
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["iterations", index],
          message:
            "iteration trace does not match the fixed stage and distance schedule",
        });
      }
      if (
        iteration.mutualCorrespondenceCount !==
        GRAND_HALL_REGISTRATION_SEED_MUTUAL_CORRESPONDENCE_COUNTS[index]
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["iterations", index, "mutualCorrespondenceCount"],
          message:
            "iteration correspondence count does not match the exact replay trace",
        });
      }
      if (
        iteration.correspondencePairInventoryRawSha256 !==
        GRAND_HALL_REGISTRATION_SEED_CORRESPONDENCE_PAIR_RAW_SHA256[index]
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["iterations", index, "correspondencePairInventoryRawSha256"],
          message:
            "iteration correspondence-pair bytes do not match the exact replay trace",
        });
      }
    }
  });

export function computeGrandHallRegistrationSeedTraceSha256(
  trace: z.input<typeof IterationTraceCollectionMaterialSchema>,
): `sha256:${string}` {
  const parsed = IterationTraceCollectionMaterialSchema.parse(trace);
  return canonicalDigest(
    `${GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1}.full-trace`,
    parsed,
  );
}

const IterationTraceCollectionSchema = z
  .object({
    iterationCount: z.literal(GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT),
    iterations: z
      .array(IterationTraceSchema)
      .length(GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT),
    traceSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((trace, ctx) => {
    const { traceSha256, ...material } = trace;
    const parsed = IterationTraceCollectionMaterialSchema.safeParse(material);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return;
    }
    if (
      traceSha256 !== computeGrandHallRegistrationSeedTraceSha256(parsed.data)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["traceSha256"],
        message:
          "full iteration trace digest does not match its canonical material",
      });
    }
  });

export const GrandHallRegistrationSeedCandidateMatrixFloat64HexSchema = z
  .tuple(
    GRAND_HALL_REGISTRATION_SEED_CANDIDATE_MATRIX_FLOAT64_HEX.map((value) =>
      z.literal(value),
    ) as [
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
      z.ZodLiteral<string>,
    ],
  )
  .superRefine((matrix, ctx) => {
    const rotation = [
      [
        float64HexToNumber(matrix[0]),
        float64HexToNumber(matrix[1]),
        float64HexToNumber(matrix[2]),
      ],
      [
        float64HexToNumber(matrix[4]),
        float64HexToNumber(matrix[5]),
        float64HexToNumber(matrix[6]),
      ],
      [
        float64HexToNumber(matrix[8]),
        float64HexToNumber(matrix[9]),
        float64HexToNumber(matrix[10]),
      ],
    ] as const;
    const axes = [0, 1, 2] as const;
    const tolerance = 1e-10;
    for (const left of axes) {
      for (const right of axes) {
        let dot = 0;
        for (const row of axes) {
          dot += rotation[row][left] * rotation[row][right];
        }
        const expected = left === right ? 1 : 0;
        if (Math.abs(dot - expected) > tolerance) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [left, right],
            message:
              "candidate rotation must be orthonormal and contain no scale or shear",
          });
        }
      }
    }
    const [a, b, c] = rotation[0];
    const [d, e, f] = rotation[1];
    const [g, h, i] = rotation[2];
    const determinant =
      a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(determinant - 1) > tolerance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "candidate rotation determinant must be +1 and cannot reflect geometry",
      });
    }
  });

export const GrandHallRegistrationSeedDistanceMetricsFloat64HexSchema = z
  .object({
    minimumDistanceMetresFloat64Hex: NonNegativeFloat64HexSchema,
    rootMeanSquareDistanceMetresFloat64Hex: NonNegativeFloat64HexSchema,
    meanDistanceMetresFloat64Hex: NonNegativeFloat64HexSchema,
    medianDistanceMetresFloat64Hex: NonNegativeFloat64HexSchema,
    p95DistanceMetresFloat64Hex: NonNegativeFloat64HexSchema,
    maximumDistanceMetresFloat64Hex: NonNegativeFloat64HexSchema,
  })
  .strict()
  .superRefine((metrics, ctx) => {
    const maximum = float64HexToNumber(metrics.maximumDistanceMetresFloat64Hex);
    const minimum = float64HexToNumber(metrics.minimumDistanceMetresFloat64Hex);
    for (const key of [
      "rootMeanSquareDistanceMetresFloat64Hex",
      "meanDistanceMetresFloat64Hex",
      "medianDistanceMetresFloat64Hex",
      "p95DistanceMetresFloat64Hex",
    ] as const) {
      const value = float64HexToNumber(metrics[key]);
      if (value < minimum || value > maximum) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message:
            "distance summary must lie within the recorded minimum and maximum",
        });
      }
    }
    const mean = float64HexToNumber(metrics.meanDistanceMetresFloat64Hex);
    const rms = float64HexToNumber(
      metrics.rootMeanSquareDistanceMetresFloat64Hex,
    );
    const median = float64HexToNumber(metrics.medianDistanceMetresFloat64Hex);
    const p95 = float64HexToNumber(metrics.p95DistanceMetresFloat64Hex);
    if (mean > rms) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rootMeanSquareDistanceMetresFloat64Hex"],
        message:
          "root-mean-square distance cannot be smaller than mean distance",
      });
    }
    if (minimum > median || median > p95 || p95 > maximum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minimum, median, p95, and maximum distances must be ordered",
      });
    }
  });

export const GRAND_HALL_REGISTRATION_SEED_LAST_FIT_METRICS = {
  minimumDistanceMetresFloat64Hex: "3f6d10a461ba9458",
  rootMeanSquareDistanceMetresFloat64Hex: "3fb03441f0b7434f",
  meanDistanceMetresFloat64Hex: "3fad440d6f540876",
  medianDistanceMetresFloat64Hex: "3fab960701bd47e0",
  p95DistanceMetresFloat64Hex: "3fbb54969417cfb6",
  maximumDistanceMetresFloat64Hex: "3fbeb7d15e4e0756",
} as const;

export const GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_METRICS = {
  minimumDistanceMetresFloat64Hex: "3f6c544400686629",
  rootMeanSquareDistanceMetresFloat64Hex: "3fb03363bc9cc3c7",
  meanDistanceMetresFloat64Hex: "3fad424e15832b6b",
  medianDistanceMetresFloat64Hex: "3fab91337b99a84a",
  p95DistanceMetresFloat64Hex: "3fbb55f45f346b95",
  maximumDistanceMetresFloat64Hex: "3fbeb780c2fba79e",
} as const;

export const GRAND_HALL_REGISTRATION_SEED_ALL_SOURCE_TO_TARGET_METRICS = {
  minimumDistanceMetresFloat64Hex: "3f6c544400686629",
  rootMeanSquareDistanceMetresFloat64Hex: "3fd9850bc38eba9b",
  meanDistanceMetresFloat64Hex: "3fd19db541c43308",
  medianDistanceMetresFloat64Hex: "3fc49f78533910d5",
  p95DistanceMetresFloat64Hex: "3feb448ed33e87d8",
  maximumDistanceMetresFloat64Hex: "3ffe5687a4791c83",
} as const;

function exactMetricsSchema(
  metrics:
    | typeof GRAND_HALL_REGISTRATION_SEED_LAST_FIT_METRICS
    | typeof GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_METRICS
    | typeof GRAND_HALL_REGISTRATION_SEED_ALL_SOURCE_TO_TARGET_METRICS,
) {
  return GrandHallRegistrationSeedDistanceMetricsFloat64HexSchema.pipe(
    z
      .object({
        minimumDistanceMetresFloat64Hex: z.literal(
          metrics.minimumDistanceMetresFloat64Hex,
        ),
        rootMeanSquareDistanceMetresFloat64Hex: z.literal(
          metrics.rootMeanSquareDistanceMetresFloat64Hex,
        ),
        meanDistanceMetresFloat64Hex: z.literal(
          metrics.meanDistanceMetresFloat64Hex,
        ),
        medianDistanceMetresFloat64Hex: z.literal(
          metrics.medianDistanceMetresFloat64Hex,
        ),
        p95DistanceMetresFloat64Hex: z.literal(
          metrics.p95DistanceMetresFloat64Hex,
        ),
        maximumDistanceMetresFloat64Hex: z.literal(
          metrics.maximumDistanceMetresFloat64Hex,
        ),
      })
      .strict(),
  );
}

const LastFitMetricsSchema = exactMetricsSchema(
  GRAND_HALL_REGISTRATION_SEED_LAST_FIT_METRICS,
);
const PostfitMutualMetricsSchema = exactMetricsSchema(
  GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_METRICS,
);
const AllSourceToTargetMetricsSchema = exactMetricsSchema(
  GRAND_HALL_REGISTRATION_SEED_ALL_SOURCE_TO_TARGET_METRICS,
);

export function computeGrandHallRegistrationSeedMatrixSha256(
  matrix: z.input<
    typeof GrandHallRegistrationSeedCandidateMatrixFloat64HexSchema
  >,
): `sha256:${string}` {
  const parsed =
    GrandHallRegistrationSeedCandidateMatrixFloat64HexSchema.parse(matrix);
  return canonicalDigest(
    `${GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1}.matrix-f64`,
    parsed,
  );
}

export function computeGrandHallRegistrationSeedMetricsSha256(
  metrics: z.input<
    typeof GrandHallRegistrationSeedDistanceMetricsFloat64HexSchema
  >,
): `sha256:${string}` {
  const parsed =
    GrandHallRegistrationSeedDistanceMetricsFloat64HexSchema.parse(metrics);
  return canonicalDigest(
    `${GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1}.metrics-f64`,
    parsed,
  );
}

const ExactNearestNeighbourTiesSchema = z.tuple([
  z
    .object({
      direction: z.literal("source_to_target"),
      tiedQueryVertexCount: z.literal(1),
      tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256: z.literal(
        "sha256:07e48e05237181ba2b3b532ee75511b2c10e7d8be4b2b30b551ecbb80e622c20",
      ),
    })
    .strict(),
  z
    .object({
      direction: z.literal("target_to_source"),
      tiedQueryVertexCount: z.literal(1_002),
      tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256: z.literal(
        "sha256:2463918bd6d02825251cb09d67087a86802cbf5c42c0b55f5994c41636a4746e",
      ),
    })
    .strict(),
]);

const CorrespondenceAuditSchema = z
  .object({
    correspondenceCount: z.number().int().min(3).max(Number.MAX_SAFE_INTEGER),
    orderedSourceTargetPairsPackedLittleEndianInt64RawSha256:
      RuntimeSha256Schema,
    distancesPackedLittleEndianFloat64RawSha256: RuntimeSha256Schema,
    metrics: GrandHallRegistrationSeedDistanceMetricsFloat64HexSchema,
  })
  .strict();

const FinalResultSchema = z
  .object({
    lastFitInput: CorrespondenceAuditSchema.extend({
      iterationOrdinal: z.literal(GRAND_HALL_REGISTRATION_SEED_ITERATION_COUNT),
      correspondenceCount: z.literal(
        GRAND_HALL_REGISTRATION_SEED_MUTUAL_CORRESPONDENCE_COUNTS[39],
      ),
      orderedSourceTargetPairsPackedLittleEndianInt64RawSha256: z.literal(
        "sha256:d02c5b126b52046d3341cf099aec0c4a2b9a2592fa59d8481f443dc8f4549f3d",
      ),
      distancesPackedLittleEndianFloat64RawSha256: z.literal(
        "sha256:61f56f6eb0c80e805bf33563d4ca9d8844b15fecfc74bdf18c04855a3d3e112a",
      ),
      metrics: LastFitMetricsSchema,
    }).strict(),
    candidateArfToCvfRowMajorMatrixFloat64Hex:
      GrandHallRegistrationSeedCandidateMatrixFloat64HexSchema,
    finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256: z.literal(
      "sha256:c2cd63576b9227ed27a136ff87a4823e6401b5318de27f046a0c05567e0c7d2a",
    ),
    postfitAllSourceToTargetAudit: z
      .object({
        sourceVertexCount: z.literal(
          GRAND_HALL_REGISTRATION_SEED_SOURCE_VERTEX_COUNT,
        ),
        distancesPackedLittleEndianFloat64RawSha256: z.literal(
          "sha256:db86df37dcdab47a1f8e6f146cab61e6a02b5f87dc1b4a0345dbd82972ebb7d4",
        ),
        metrics: AllSourceToTargetMetricsSchema,
      })
      .strict(),
    postfitAudit: CorrespondenceAuditSchema.extend({
      correspondenceCount: z.literal(
        GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_CORRESPONDENCE_COUNT,
      ),
      orderedSourceTargetPairsPackedLittleEndianInt64RawSha256: z.literal(
        "sha256:9ee8d05eab0925f04734700ccd1eeebb7612bc2f81a3a9fd039e6f3f9b0bcc5e",
      ),
      distancesPackedLittleEndianFloat64RawSha256: z.literal(
        "sha256:373711d105def9ab5992788e8ab4bbe05697ceeddce117ba3781477f55a413bd",
      ),
      metrics: PostfitMutualMetricsSchema,
      maximumCorrespondenceDistanceMetresFloat64Hex:
        z.literal("3fbeb851eb851eb8"),
      exactNearestNeighbourTies: ExactNearestNeighbourTiesSchema,
    }).strict(),
    termination: z.literal("fixed_40_iterations"),
    convergenceClaimed: z.literal(false),
  })
  .strict();

const ReplayResultMaterialSchema = z
  .object({
    workerSchemaVersion: z.literal(GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1),
    implementationSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256,
    ),
    environmentLockSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256,
    ),
    environmentLockAppliedToExecution: z.literal(false),
    loadedRuntimeClosureVerifiedAgainstLock: z.literal(false),
    algorithmCanonicalJsonSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
    ),
    seedAdapterCanonicalJsonSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256,
    ),
    sourceSelectedOrdinalInventoryRawSha256: RuntimeSha256Schema,
    sourceSelectedCoordinateInventoryRawSha256: RuntimeSha256Schema,
    targetSelectedOrdinalInventoryRawSha256: RuntimeSha256Schema,
    targetSelectedCoordinateInventoryRawSha256: RuntimeSha256Schema,
    iterationTraceSha256: RuntimeSha256Schema,
    lastFitInputCorrespondenceInventoryRawSha256: RuntimeSha256Schema,
    lastFitInputDistanceInventoryRawSha256: RuntimeSha256Schema,
    lastFitInputCorrespondenceCount: z
      .number()
      .int()
      .min(3)
      .max(Number.MAX_SAFE_INTEGER),
    lastFitInputMetricsSha256: RuntimeSha256Schema,
    finalMatrixSha256: RuntimeSha256Schema,
    finalTransformedSelectedSourceRawSha256: RuntimeSha256Schema,
    postfitAllSourceToTargetDistanceInventoryRawSha256: RuntimeSha256Schema,
    postfitAllSourceToTargetMetricsSha256: RuntimeSha256Schema,
    postfitCorrespondenceInventoryRawSha256: RuntimeSha256Schema,
    postfitCorrespondenceDistanceInventoryRawSha256: RuntimeSha256Schema,
    postfitCorrespondenceCount: z
      .number()
      .int()
      .min(3)
      .max(Number.MAX_SAFE_INTEGER),
    postfitMetricsSha256: RuntimeSha256Schema,
    sourceToTargetTieCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    sourceToTargetTieOrdinalInventoryRawSha256: RuntimeSha256Schema,
    targetToSourceTieCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    targetToSourceTieOrdinalInventoryRawSha256: RuntimeSha256Schema,
    workerCanonicalReceiptSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256,
    ),
  })
  .strict();

export function computeGrandHallRegistrationSeedReplayResultSha256(
  result: z.input<typeof ReplayResultMaterialSchema>,
): `sha256:${string}` {
  const parsed = ReplayResultMaterialSchema.parse(result);
  return canonicalDigest(
    `${GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1}.replay-result`,
    parsed,
  );
}

const ReplayRunBaseSchema = z
  .object({
    replayOrdinal: z.union([z.literal(1), z.literal(2)]),
    workerSchemaVersion: z.literal(GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1),
    implementationSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256,
    ),
    environmentLockSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256,
    ),
    environmentLockAppliedToExecution: z.literal(false),
    loadedRuntimeClosureVerifiedAgainstLock: z.literal(false),
    algorithmCanonicalJsonSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
    ),
    seedAdapterCanonicalJsonSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256,
    ),
    sourceSelectedOrdinalInventoryRawSha256: RuntimeSha256Schema,
    sourceSelectedCoordinateInventoryRawSha256: RuntimeSha256Schema,
    targetSelectedOrdinalInventoryRawSha256: RuntimeSha256Schema,
    targetSelectedCoordinateInventoryRawSha256: RuntimeSha256Schema,
    iterationTraceSha256: RuntimeSha256Schema,
    lastFitInputCorrespondenceInventoryRawSha256: RuntimeSha256Schema,
    lastFitInputDistanceInventoryRawSha256: RuntimeSha256Schema,
    lastFitInputCorrespondenceCount: z
      .number()
      .int()
      .min(3)
      .max(Number.MAX_SAFE_INTEGER),
    lastFitInputMetricsSha256: RuntimeSha256Schema,
    finalMatrixSha256: RuntimeSha256Schema,
    finalTransformedSelectedSourceRawSha256: RuntimeSha256Schema,
    postfitAllSourceToTargetDistanceInventoryRawSha256: RuntimeSha256Schema,
    postfitAllSourceToTargetMetricsSha256: RuntimeSha256Schema,
    postfitCorrespondenceInventoryRawSha256: RuntimeSha256Schema,
    postfitCorrespondenceDistanceInventoryRawSha256: RuntimeSha256Schema,
    postfitCorrespondenceCount: z
      .number()
      .int()
      .min(3)
      .max(Number.MAX_SAFE_INTEGER),
    postfitMetricsSha256: RuntimeSha256Schema,
    sourceToTargetTieCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    sourceToTargetTieOrdinalInventoryRawSha256: RuntimeSha256Schema,
    targetToSourceTieCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    targetToSourceTieOrdinalInventoryRawSha256: RuntimeSha256Schema,
    workerCanonicalReceiptSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256,
    ),
    replayResultSha256: RuntimeSha256Schema,
  })
  .strict();

function replayRunSchema(ordinal: 1 | 2) {
  return ReplayRunBaseSchema.extend({ replayOrdinal: z.literal(ordinal) })
    .strict()
    .superRefine((run, ctx) => {
      const {
        replayOrdinal: _replayOrdinal,
        replayResultSha256,
        ...result
      } = run;
      if (
        replayResultSha256 !==
        computeGrandHallRegistrationSeedReplayResultSha256(result)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["replayResultSha256"],
          message:
            "replay result digest does not match its canonical result bindings",
        });
      }
    });
}

const RepeatabilitySchema = z
  .object({
    method: z.literal(
      "two_separate_os_process_replays_with_identical_bound_inputs",
    ),
    replayCount: z.literal(2),
    twoProcessProofSchemaVersion: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_V1,
    ),
    twoProcessProofCanonicalJsonSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256,
    ),
    twoProcessProofCanonicalJsonVerified: z.literal(true),
    twoProcessProofReceiptBindingVerified: z.literal(true),
    childEntryImplementationSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256,
    ),
    twoProcessRunnerImplementationSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256,
    ),
    canonicalWorkerReceiptByteLength: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_CANONICAL_WORKER_RECEIPT_BYTE_LENGTH,
    ),
    canonicalWorkerReceiptIncludedInProof: z.literal(false),
    runs: z.tuple([replayRunSchema(1), replayRunSchema(2)]),
    determinismScope: z.literal("same_runtime_same_host_only"),
    bitExactCanonicalWorkerReceipt: z.literal(true),
    bitExactMappedIterationTrace: z.literal(true),
    completeWorkerIterationEvidenceBoundByCanonicalReceipt: z.literal(true),
    bitExactFinalCorrespondences: z.literal(true),
    bitExactFinalMatrix: z.literal(true),
    bitExactFinalMetrics: z.literal(true),
  })
  .strict()
  .superRefine((repeatability, ctx) => {
    const [first, second] = repeatability.runs;
    if (first.replayResultSha256 !== second.replayResultSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runs"],
        message:
          "bit-exact repeatability requires identical replay result digests",
      });
    }
  });

const GuardrailsSchema = z
  .object({
    authority: z.literal("none"),
    architecturalEvidence: z.literal(false),
    humanReviewRequiredBeforeAnyPromotion: z.literal(true),
    productionTrust: z.null(),
    roomMembershipAuthority: z.literal("none"),
    sourceSelectionIsGrandHallMask: z.literal(false),
    cleanupDecisionAccepted: z.literal(false),
    matrixPermittedUse: z.literal("historical_candidate_nomination_aid_only"),
    matrixUsedAsMeasurement: z.literal(false),
    matrixUsedAsSolverInput: z.literal(false),
    coordinatePairs: z.null(),
    acceptedTransform: z.null(),
    outputMask: z.null(),
    runtimeAdmission: z.null(),
    deploymentAuthorization: z.null(),
    publicationAuthorization: z.null(),
    permitsCoordinateAcceptance: z.literal(false),
    permitsTransformAcceptance: z.literal(false),
    permitsOutputMasking: z.literal(false),
    permitsRuntimeUse: z.literal(false),
    permitsDeployment: z.literal(false),
    permitsPublication: z.literal(false),
  })
  .strict();

const GrandHallRegistrationSeedV1MaterialBaseSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1),
    artifactId: SafeIdSchema,
    createdAt: IsoInstantSchema,
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    classification: z.literal("historical_replay_candidate"),
    source: z
      .object({
        frame: z.literal("ARF"),
        coordinateConvention: z.literal("xgrids_big_obj_native_source_z_up"),
        exactBigObj: ExactBigObjIdentitySchema,
        upstreamLineage: SourceLineageSchema,
        selection: SourceSelectionSchema,
      })
      .strict(),
    target: z
      .object({
        frame: z.literal("CVF"),
        coordinateConvention: z.literal(
          "matterpak_local_metres_right_handed_z_up",
        ),
        exactMatterPakObj: ExactMatterPakObjIdentitySchema,
        exactRoom9: ExactRoom9IdentitySchema,
        upstreamLineage: TargetLineageSchema,
        selection: TargetSelectionSchema,
      })
      .strict(),
    replayBindings: z
      .object({
        workerSchemaVersion: z.literal(GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1),
        implementationSha256: z.literal(
          GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256,
        ),
        environmentLockSha256: z.literal(
          GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256,
        ),
        environmentLockAppliedToExecution: z.literal(false),
        loadedRuntimeClosureVerifiedAgainstLock: z.literal(false),
        algorithmCanonicalJsonSha256: z.literal(
          GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
        ),
        seedAdapterCanonicalJsonSha256: z.literal(
          GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256,
        ),
        determinismScope: z.literal("same_runtime_same_host_only"),
      })
      .strict(),
    schedule: FixedScheduleSchema,
    iterationTrace: IterationTraceCollectionSchema,
    finalResult: FinalResultSchema,
    repeatability: RepeatabilitySchema,
    guardrails: GuardrailsSchema,
  })
  .strict();

function validateMaterial(
  material: z.infer<typeof GrandHallRegistrationSeedV1MaterialBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  const sourceCount = material.source.selection.selectedVertexInventoryCount;
  const targetCount = material.target.selection.selectedVertexInventoryCount;
  const selectionDigests = [
    material.source.selection
      .selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256,
    material.source.selection
      .selectedOriginalVerticesPackedLittleEndianFloat64RawSha256,
    material.target.selection
      .selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256,
    material.target.selection
      .selectedOrderedVerticesPackedLittleEndianFloat64RawSha256,
  ];
  if (new Set(selectionDigests).size !== selectionDigests.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source", "selection"],
      message:
        "ordinal and coordinate inventories must use their distinct raw-byte digests",
    });
  }
  for (
    let index = 0;
    index < material.iterationTrace.iterations.length;
    index += 1
  ) {
    const iteration = material.iterationTrace.iterations[index];
    if (iteration === undefined) continue;
    if (
      iteration.sourceVertexCount !== sourceCount ||
      iteration.targetVertexCount !== targetCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["iterationTrace", "iterations", index],
        message:
          "every iteration must bind the exact source and target selection counts",
      });
    }
  }

  const lastIteration = material.iterationTrace.iterations.at(-1);
  if (
    lastIteration === undefined ||
    material.finalResult.lastFitInput.correspondenceCount !==
      lastIteration.mutualCorrespondenceCount ||
    material.finalResult.lastFitInput
      .orderedSourceTargetPairsPackedLittleEndianInt64RawSha256 !==
      lastIteration.correspondencePairInventoryRawSha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["finalResult", "lastFitInput"],
      message:
        "last-fit input must equal the distinct iteration-40 prefit correspondence identity",
    });
  }

  const ties = material.finalResult.postfitAudit.exactNearestNeighbourTies;

  const expectedRun = {
    workerSchemaVersion: material.replayBindings.workerSchemaVersion,
    implementationSha256: material.replayBindings.implementationSha256,
    environmentLockSha256: material.replayBindings.environmentLockSha256,
    environmentLockAppliedToExecution:
      material.replayBindings.environmentLockAppliedToExecution,
    loadedRuntimeClosureVerifiedAgainstLock:
      material.replayBindings.loadedRuntimeClosureVerifiedAgainstLock,
    algorithmCanonicalJsonSha256:
      material.replayBindings.algorithmCanonicalJsonSha256,
    seedAdapterCanonicalJsonSha256:
      material.replayBindings.seedAdapterCanonicalJsonSha256,
    sourceSelectedOrdinalInventoryRawSha256:
      material.source.selection
        .selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256,
    sourceSelectedCoordinateInventoryRawSha256:
      material.source.selection
        .selectedOriginalVerticesPackedLittleEndianFloat64RawSha256,
    targetSelectedOrdinalInventoryRawSha256:
      material.target.selection
        .selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256,
    targetSelectedCoordinateInventoryRawSha256:
      material.target.selection
        .selectedOrderedVerticesPackedLittleEndianFloat64RawSha256,
    iterationTraceSha256: material.iterationTrace.traceSha256,
    lastFitInputCorrespondenceInventoryRawSha256:
      material.finalResult.lastFitInput
        .orderedSourceTargetPairsPackedLittleEndianInt64RawSha256,
    lastFitInputDistanceInventoryRawSha256:
      material.finalResult.lastFitInput
        .distancesPackedLittleEndianFloat64RawSha256,
    lastFitInputCorrespondenceCount:
      material.finalResult.lastFitInput.correspondenceCount,
    lastFitInputMetricsSha256: computeGrandHallRegistrationSeedMetricsSha256(
      material.finalResult.lastFitInput.metrics,
    ),
    finalMatrixSha256: computeGrandHallRegistrationSeedMatrixSha256(
      material.finalResult.candidateArfToCvfRowMajorMatrixFloat64Hex,
    ),
    finalTransformedSelectedSourceRawSha256:
      material.finalResult
        .finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256,
    postfitAllSourceToTargetDistanceInventoryRawSha256:
      material.finalResult.postfitAllSourceToTargetAudit
        .distancesPackedLittleEndianFloat64RawSha256,
    postfitAllSourceToTargetMetricsSha256:
      computeGrandHallRegistrationSeedMetricsSha256(
        material.finalResult.postfitAllSourceToTargetAudit.metrics,
      ),
    postfitCorrespondenceInventoryRawSha256:
      material.finalResult.postfitAudit
        .orderedSourceTargetPairsPackedLittleEndianInt64RawSha256,
    postfitCorrespondenceDistanceInventoryRawSha256:
      material.finalResult.postfitAudit
        .distancesPackedLittleEndianFloat64RawSha256,
    postfitCorrespondenceCount:
      material.finalResult.postfitAudit.correspondenceCount,
    postfitMetricsSha256: computeGrandHallRegistrationSeedMetricsSha256(
      material.finalResult.postfitAudit.metrics,
    ),
    sourceToTargetTieCount: ties[0].tiedQueryVertexCount,
    sourceToTargetTieOrdinalInventoryRawSha256:
      ties[0].tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256,
    targetToSourceTieCount: ties[1].tiedQueryVertexCount,
    targetToSourceTieOrdinalInventoryRawSha256:
      ties[1].tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256,
  };
  for (let index = 0; index < material.repeatability.runs.length; index += 1) {
    const run = material.repeatability.runs[index];
    if (run === undefined) continue;
    for (const [key, expected] of Object.entries(expectedRun)) {
      if (run[key as keyof typeof expectedRun] !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repeatability", "runs", index, key],
          message:
            "repeatability run does not bind the packet's exact replay result",
        });
      }
    }
  }
}

export const GrandHallRegistrationSeedV1MaterialSchema =
  GrandHallRegistrationSeedV1MaterialBaseSchema.superRefine(validateMaterial);
export type GrandHallRegistrationSeedV1Material = z.infer<
  typeof GrandHallRegistrationSeedV1MaterialSchema
>;

export function computeGrandHallRegistrationSeedV1Sha256(
  material: z.input<typeof GrandHallRegistrationSeedV1MaterialSchema>,
): `sha256:${string}` {
  const parsed = GrandHallRegistrationSeedV1MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1, parsed);
}

export const GrandHallRegistrationSeedV1Schema =
  GrandHallRegistrationSeedV1MaterialBaseSchema.extend({
    artifactSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((artifact, ctx) => {
      const { artifactSha256, ...material } = artifact;
      validateMaterial(material, ctx);
      const parsed =
        GrandHallRegistrationSeedV1MaterialSchema.safeParse(material);
      if (!parsed.success) return;
      const expected = computeGrandHallRegistrationSeedV1Sha256(parsed.data);
      if (artifactSha256 !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifactSha256"],
          message:
            "registration seed self-digest does not match its canonical material",
        });
      }
    });
export type GrandHallRegistrationSeedV1 = z.infer<
  typeof GrandHallRegistrationSeedV1Schema
>;
