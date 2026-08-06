export const RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS: readonly string[];

export function receptionCaptureRuntimeBuildInputs(
  repositoryRoot: string,
): readonly string[];

export function assertReceptionCaptureRuntimeVersions(
  repositoryRoot: string,
): void;

export interface ReceptionCaptureRuntimeEnvironment {
  readonly mobileOrigin: string;
  readonly qualityOrigin: string;
}

export function receptionCaptureRuntimeEnvironment(
  environment?: Readonly<Record<string, string | undefined>>,
): ReceptionCaptureRuntimeEnvironment;

export function computeReceptionCaptureRuntimeEnvironmentDigest(
  environment?: Readonly<Record<string, string | undefined>>,
): string;

export function computeFileSetSha256(
  repositoryRoot: string,
  inputs: readonly string[],
): string;

export function computeReceptionCaptureRuntimeBuildDigest(repositoryRoot: string): string;
