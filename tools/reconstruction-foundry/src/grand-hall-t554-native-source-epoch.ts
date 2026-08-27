import { createHash } from "node:crypto";

import {
  CanonicalJsonValueSchema,
  GrandHallPanoramaSourceJpgIdentityV2Schema,
  stableCanonicalJson,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { z } from "zod";

import {
  GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
} from "./grand-hall-t554-native-review-coverage.js";
import {
  __testOnlyGrandHallT554NativeMediaKernel,
  openGrandHallT554PinnedNativeSourceJpeg,
  type GrandHallT554NativeMediaKernelTestSeam,
  type GrandHallT554PinnedSourceJpeg,
  type GrandHallT554PinnedSourceJpegVerification,
} from "./grand-hall-t554-native-media-kernel.js";

export const GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH =
  GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX *
  GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX *
  3;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_EPOCH_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAXIMUM_BOUND_JSON_BYTES = 16 * 1_024 * 1_024;

const Sha256Schema = z.string().regex(SHA256_PATTERN);
const PositiveBoundedByteLengthSchema = z
  .number()
  .int()
  .positive()
  .max(MAXIMUM_BOUND_JSON_BYTES);

const ArtifactBindingSchema = z
  .object({
    semanticSha256: Sha256Schema,
    fileSha256: Sha256Schema,
    byteLength: PositiveBoundedByteLengthSchema,
  })
  .strict();

const SourceEpochNonceSchema = z
  .string()
  .regex(SOURCE_EPOCH_NONCE_PATTERN)
  .refine((value) => {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === value;
  }, "source epoch nonce must be one canonical 256-bit base64url token");

export const GrandHallT554NativeSourceEpochBindingsV1Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-source-epoch-bindings.v1",
    ),
    sourceEpochNonce: SourceEpochNonceSchema,
    renderGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    reviewPack: ArtifactBindingSchema,
    publicationReceipt: ArtifactBindingSchema,
    workbenchImplementationManifest: ArtifactBindingSchema,
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
  })
  .strict();

export type GrandHallT554NativeSourceEpochBindingsV1 = z.infer<
  typeof GrandHallT554NativeSourceEpochBindingsV1Schema
>;

const OpenSourceEpochInputSchema = z
  .object({
    sourceRoot: z.string().min(1),
    bindings: GrandHallT554NativeSourceEpochBindingsV1Schema,
  })
  .strict();

const TileRequestSchema = z
  .object({
    sourceEpochNonce: SourceEpochNonceSchema,
    renderGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    column: z.number().int().min(0).max(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT - 1),
    row: z.number().int().min(0).max(GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT - 1),
  })
  .strict();

export interface GrandHallT554NativeSourceTileRequestV1 {
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly column: number;
  readonly row: number;
}

export interface GrandHallT554NativeSourceEpochSnapshotV1 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-source-epoch.v1";
  readonly lifecycle: "active" | "closing" | "closed";
  readonly closedDisposition:
    | "finalized_stable"
    | "abandoned"
    | "finalization_failed"
    | null;
  readonly sourceEpochNonce: string;
  readonly sourceEpochNonceSha256: `sha256:${string}`;
  readonly renderGeneration: number;
  readonly epochBindingSha256: `sha256:${string}`;
  readonly reviewPack: GrandHallT554NativeSourceEpochBindingsV1["reviewPack"];
  readonly publicationReceipt:
    GrandHallT554NativeSourceEpochBindingsV1["publicationReceipt"];
  readonly workbenchImplementationManifest:
    GrandHallT554NativeSourceEpochBindingsV1["workbenchImplementationManifest"];
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly sourceVerification: GrandHallT554PinnedSourceJpegVerification;
  readonly tileGrid: {
    readonly widthPx: typeof GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX;
    readonly heightPx: typeof GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX;
    readonly columnCount: typeof GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT;
    readonly rowCount: typeof GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT;
    readonly channelCount: 3;
    readonly bytesPerTile: typeof GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH;
    readonly resampling: "none";
  };
}

export interface GrandHallT554FinalizedNativeSourceEpochV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-finalized-native-source-epoch.v1";
  readonly sourceEpochNonceSha256: `sha256:${string}`;
  readonly renderGeneration: number;
  readonly epochBindingSha256: `sha256:${string}`;
  readonly sourceVerification: GrandHallT554PinnedSourceJpegVerification;
  readonly disposition: "finalized_stable";
}

export class GrandHallT554NativeSourceEpochError extends Error {
  constructor(
    readonly code:
      | "ARGUMENT_INVALID"
      | "TILE_INVALID"
      | "EPOCH_STALE"
      | "EPOCH_CLOSED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeSourceEpochError";
  }
}

export interface GrandHallT554NativeSourceEpochV1 {
  readonly snapshot: () => GrandHallT554NativeSourceEpochSnapshotV1;
  readonly copyTile: (input: GrandHallT554NativeSourceTileRequestV1) => Buffer;
  readonly finalize: () => Promise<GrandHallT554FinalizedNativeSourceEpochV1>;
  readonly abandon: () => Promise<void>;
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function semanticSha256(domain: string, value: unknown): `sha256:${string}` {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256(Buffer.from(`${domain}\n${stableCanonicalJson(canonical)}`, "utf8"));
}

function epochBindingSha256(
  bindings: GrandHallT554NativeSourceEpochBindingsV1,
  sourceVerification: GrandHallT554PinnedSourceJpegVerification,
): `sha256:${string}` {
  return semanticSha256(
    "VENVIEWER_GRAND_HALL_T554_NATIVE_SOURCE_EPOCH_BINDING_V1",
    { bindings, sourceVerification },
  );
}

function assertVerificationMatchesSource(
  source: GrandHallPanoramaSourceJpgIdentityV2,
  verification: GrandHallT554PinnedSourceJpegVerification,
): void {
  if (
    verification.fileName !== source.fileName ||
    verification.sha256 !== source.sha256 ||
    verification.byteLength !== source.byteLength
  ) {
    throw new GrandHallT554NativeSourceEpochError(
      "ARGUMENT_INVALID",
      "Pinned native source verification does not match its exact v3 source row.",
    );
  }
}

class GrandHallT554NativeSourceEpochControllerV1 implements GrandHallT554NativeSourceEpochV1 {
  private lifecycle: "active" | "closing" | "closed" = "active";
  private closedDisposition:
    | "finalized_stable"
    | "abandoned"
    | "finalization_failed"
    | null = null;
  private readonly bindingSha256: `sha256:${string}`;
  private readonly sourceEpochNonceSha256: `sha256:${string}`;

  constructor(
    private readonly bindings: GrandHallT554NativeSourceEpochBindingsV1,
    private readonly pinnedSource: GrandHallT554PinnedSourceJpeg,
  ) {
    assertVerificationMatchesSource(bindings.source, pinnedSource.verification);
    this.bindingSha256 = epochBindingSha256(bindings, pinnedSource.verification);
    this.sourceEpochNonceSha256 = sha256(
      Buffer.from(bindings.sourceEpochNonce, "utf8"),
    );
  }

  snapshot(): GrandHallT554NativeSourceEpochSnapshotV1 {
    return structuredClone({
      schemaVersion: "venviewer.grand-hall-t554-native-source-epoch.v1",
      lifecycle: this.lifecycle,
      closedDisposition: this.closedDisposition,
      sourceEpochNonce: this.bindings.sourceEpochNonce,
      sourceEpochNonceSha256: this.sourceEpochNonceSha256,
      renderGeneration: this.bindings.renderGeneration,
      epochBindingSha256: this.bindingSha256,
      reviewPack: this.bindings.reviewPack,
      publicationReceipt: this.bindings.publicationReceipt,
      workbenchImplementationManifest:
        this.bindings.workbenchImplementationManifest,
      source: this.bindings.source,
      sourceVerification: this.pinnedSource.verification,
      tileGrid: {
        widthPx: GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
        heightPx: GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
        columnCount: GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
        rowCount: GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
        channelCount: 3,
        bytesPerTile: GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH,
        resampling: "none",
      },
    });
  }

  copyTile(input: GrandHallT554NativeSourceTileRequestV1): Buffer {
    const request = TileRequestSchema.safeParse(input);
    if (!request.success) {
      throw new GrandHallT554NativeSourceEpochError(
        "TILE_INVALID",
        request.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    if (this.lifecycle !== "active") {
      throw new GrandHallT554NativeSourceEpochError(
        "EPOCH_CLOSED",
        "Native source epoch cannot serve tiles after close has begun.",
      );
    }
    if (
      request.data.sourceEpochNonce !== this.bindings.sourceEpochNonce ||
      request.data.renderGeneration !== this.bindings.renderGeneration
    ) {
      throw new GrandHallT554NativeSourceEpochError(
        "EPOCH_STALE",
        "Tile request is not bound to the active source epoch and render generation.",
      );
    }
    return this.pinnedSource.copyExactRgb8Region(
      request.data.column * GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
      request.data.row * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
      GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
      GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
    );
  }

  async finalize(): Promise<GrandHallT554FinalizedNativeSourceEpochV1> {
    if (this.lifecycle !== "active") {
      throw new GrandHallT554NativeSourceEpochError(
        "EPOCH_CLOSED",
        "Native source epoch was already closed or is closing.",
      );
    }
    this.lifecycle = "closing";
    try {
      const verification = await this.pinnedSource.finalize();
      this.closedDisposition = "finalized_stable";
      return {
        schemaVersion:
          "venviewer.grand-hall-t554-finalized-native-source-epoch.v1",
        sourceEpochNonceSha256: this.sourceEpochNonceSha256,
        renderGeneration: this.bindings.renderGeneration,
        epochBindingSha256: this.bindingSha256,
        sourceVerification: structuredClone(verification),
        disposition: "finalized_stable",
      };
    } catch (error) {
      this.closedDisposition = "finalization_failed";
      throw error;
    } finally {
      this.lifecycle = "closed";
    }
  }

  async abandon(): Promise<void> {
    if (this.lifecycle !== "active") {
      throw new GrandHallT554NativeSourceEpochError(
        "EPOCH_CLOSED",
        "Native source epoch was already closed or is closing.",
      );
    }
    this.lifecycle = "closing";
    try {
      await this.pinnedSource.abandon();
      this.closedDisposition = "abandoned";
    } finally {
      this.lifecycle = "closed";
    }
  }
}

async function openSourceEpoch(
  input: unknown,
  seam: GrandHallT554NativeMediaKernelTestSeam | undefined,
): Promise<GrandHallT554NativeSourceEpochV1> {
  const parsed = OpenSourceEpochInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new GrandHallT554NativeSourceEpochError(
      "ARGUMENT_INVALID",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  const mediaInput = {
    sourceRoot: parsed.data.sourceRoot,
    fileName: parsed.data.bindings.source.fileName,
    expectedSha256: parsed.data.bindings.source.sha256,
    expectedByteLength: parsed.data.bindings.source.byteLength,
  };
  const pinnedSource = seam === undefined
    ? await openGrandHallT554PinnedNativeSourceJpeg(mediaInput)
    : await __testOnlyGrandHallT554NativeMediaKernel.openPinnedSourceJpeg(
        mediaInput,
        seam,
      );
  try {
    return new GrandHallT554NativeSourceEpochControllerV1(
      parsed.data.bindings,
      pinnedSource,
    );
  } catch (error) {
    await pinnedSource.abandon();
    throw error;
  }
}

export function openGrandHallT554NativeSourceEpochV1(
  input: unknown,
): Promise<GrandHallT554NativeSourceEpochV1> {
  return openSourceEpoch(input, undefined);
}

export const __testOnlyGrandHallT554NativeSourceEpochV1 = Object.freeze({
  openSourceEpoch,
});
