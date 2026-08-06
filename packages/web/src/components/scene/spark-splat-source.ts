import type { RuntimePackagePreviewVisualAsset } from "@omnitwin/types";

export interface SparkUrlSplatSource {
  readonly kind: "url";
  readonly id: string;
  readonly url: string;
}

export interface SparkPrivateStreamSplatSource {
  readonly kind: "private-stream";
  readonly id: string;
  readonly runtimePackageId: string;
  readonly asset: RuntimePackagePreviewVisualAsset;
}

/** A public/direct URL or one exact admin-authenticated byte stream. */
export type SparkSplatSource = SparkUrlSplatSource | SparkPrivateStreamSplatSource;
