import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, resolve, toNamespacedPath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHARP_VERSION = "0.35.3";
const LIBVIPS_VERSION = "8.18.3";
const PROBE_BYTE_LENGTH = 879;
const PROBE_SHA256 =
  "sha256:3d1e13e141be146ebaeac81e114e0609dfa6cfdc8516fe0adc039c4584c54078";
const PROBE_DECODED_RGB_SHA256 =
  "sha256:a288b3c068b98e427b04229ade2ebd0e0fd65106d8d1fc77e03794878cce90be";
const REVIEWED_NATIVE_MEMBER_SET_SHA256 =
  "sha256:fdc9e7a4870e09596b0d2f46094a1f7349c49476428f8da02927261e4c1e0d25";
const MAXIMUM_LOADED_MODULE_COUNT = 4_096;
const MAXIMUM_WINDOWS_PATH_CODE_UNITS = 32_767;
const WINDOWS_NAMESPACED_LOCAL_PATH_PATTERN = /^\\\\\?\\[A-Za-z]:\\/u;
const REVIEWED_NATIVE_MEMBERS = Object.freeze([
  "vendor/runtime-inspector/grand-hall-t554-runtime-inspector.node",
  "vendor/sharp/sharp-win32-x64-0.35.3.node",
  "vendor/libvips/libvips-42.dll",
  "vendor/libvips/libvips-cpp-8.18.3.dll",
] as const);

interface RuntimeInspector {
  addDllDirectory(directory: string): unknown;
  revalidateDllDirectory(handle: unknown): boolean;
  removeDllDirectory(handle: unknown): boolean;
  enumerateLoadedModules(): unknown;
}

interface SharpRuntime {
  readonly versions: Readonly<Record<string, string>>;
  (
    input: Buffer,
    options: { readonly failOn: "error"; readonly limitInputPixels: number },
  ): {
    metadata(): Promise<{
      readonly format?: string;
      readonly width?: number;
      readonly height?: number;
      readonly space?: string;
      readonly channels?: number;
      readonly depth?: string;
      readonly hasAlpha?: boolean;
      readonly orientation?: number;
      readonly exif?: Buffer;
    }>;
    raw(): {
      toBuffer(options: { readonly resolveWithObject: true }): Promise<{
        readonly data: Buffer;
        readonly info: {
          readonly width: number;
          readonly height: number;
          readonly channels: number;
          readonly depth: string;
          readonly hasAlpha: boolean;
          readonly size: number;
        };
      }>;
    };
  };
}

export interface GrandHallT554NativeReviewRuntimeBootstrapObservationV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-runtime-bootstrap-observation.v1";
  readonly sharpVersion: "0.35.3";
  readonly libvipsVersion: "8.18.3";
  readonly probe: {
    readonly byteLength: 879;
    readonly sha256: typeof PROBE_SHA256;
    readonly width: 3;
    readonly height: 2;
    readonly channels: 3;
    readonly decodedRgbByteLength: 18;
    readonly decodedRgbSha256: typeof PROBE_DECODED_RGB_SHA256;
  };
  readonly loadedModuleCount: number;
  readonly loadedReviewedNativeMembers: typeof REVIEWED_NATIVE_MEMBERS;
  readonly loadedReviewedNativeMemberSetSha256: typeof REVIEWED_NATIVE_MEMBER_SET_SHA256;
  readonly targetNativeModulesAbsentBeforeSharpImport: true;
  readonly exactReviewedNativeModuleMultiplicityVerified: true;
  readonly loadedModuleInventoryStableAcrossDecode: true;
  readonly loadedModuleInventoryStableAfterDllDirectoryRemoval: true;
  readonly dllDirectoryConfiguredBeforeSharpImport: true;
  readonly dllDirectoryRevalidatedBeforeSharpImport: true;
  readonly dllDirectoryRevalidatedAfterDecode: true;
  readonly dllDirectoryRemoved: true;
  readonly authority: "none";
}

function sha256(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function requireInspector(value: unknown): RuntimeInspector {
  if (
    value === null ||
    typeof value !== "object" ||
    !("addDllDirectory" in value) ||
    typeof value.addDllDirectory !== "function" ||
    !("revalidateDllDirectory" in value) ||
    typeof value.revalidateDllDirectory !== "function" ||
    !("removeDllDirectory" in value) ||
    typeof value.removeDllDirectory !== "function" ||
    !("enumerateLoadedModules" in value) ||
    typeof value.enumerateLoadedModules !== "function"
  ) {
    throw new Error("runtime inspector exports are invalid");
  }
  return value as RuntimeInspector;
}

function requireSharp(value: unknown): SharpRuntime {
  if (
    typeof value !== "function" ||
    !("versions" in value) ||
    value.versions === null ||
    typeof value.versions !== "object"
  ) {
    throw new Error("Sharp runtime export is invalid");
  }
  return value as SharpRuntime;
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function requireExactNamespacedLocalPath(value: string): string {
  if (
    value.length < 8 ||
    value.length > MAXIMUM_WINDOWS_PATH_CODE_UNITS ||
    value.includes("\0") ||
    value.includes("/") ||
    !isWellFormedUtf16(value) ||
    !WINDOWS_NAMESPACED_LOCAL_PATH_PATTERN.test(value)
  ) {
    throw new Error("loaded-module path is not exact namespaced local UTF-16");
  }
  return value;
}

function expectedLoadedModulePath(canonicalPath: string): string {
  return requireExactNamespacedLocalPath(toNamespacedPath(canonicalPath));
}

function requireLoadedModules(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < REVIEWED_NATIVE_MEMBERS.length ||
    value.length > MAXIMUM_LOADED_MODULE_COUNT ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("loaded-module inventory is invalid");
  }
  const paths = (value as string[]).map(requireExactNamespacedLocalPath);
  for (let index = 1; index < paths.length; index += 1) {
    const previous = paths[index - 1];
    const current = paths[index];
    if (previous === undefined || current === undefined || previous >= current) {
      throw new Error(
        "loaded-module inventory is not exact raw-UTF-16 sorted and unique",
      );
    }
  }
  return Object.freeze(paths);
}

function foldAsciiUppercase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0x20),
  );
}

function assertExactLoadedModuleMultiplicity(
  loadedModules: readonly string[],
  expectedNamespacedPath: string,
  expectedCount: 0 | 1,
): void {
  const expectedBaseName = basename(expectedNamespacedPath);
  const foldedExpectedBaseName = foldAsciiUppercase(expectedBaseName);
  const exactMatches = loadedModules.filter(
    (candidate) => candidate === expectedNamespacedPath,
  );
  const basenameMatches = loadedModules.filter(
    (candidate) =>
      foldAsciiUppercase(basename(candidate)) === foldedExpectedBaseName,
  );
  if (exactMatches.length !== expectedCount || basenameMatches.length !== expectedCount) {
    throw new Error("reviewed native module exact-path multiplicity failed");
  }
}

function assertStableModuleInventories(
  reference: readonly string[],
  ...observations: readonly (readonly string[])[]
): void {
  for (const observation of observations) {
    if (
      observation.length !== reference.length ||
      observation.some((path, index) => path !== reference[index])
    ) {
      throw new Error("loaded-module inventory is not stable");
    }
  }
}

/**
 * Executes only inside the isolated attestor child. The inspector is loaded and
 * its exact libvips directory is installed before the Sharp loader is imported.
 */
export async function runGrandHallT554NativeReviewRuntimeBootstrap(): Promise<GrandHallT554NativeReviewRuntimeBootstrapObservationV1> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("runtime bootstrap requires Windows x64");
  }
  const bootstrapPath = fileURLToPath(import.meta.url);
  const packRoot = resolve(dirname(bootstrapPath), "..");
  const absoluteByMember = new Map<string, string>();
  const expectedLoadedPathByMember = new Map<string, string>();
  for (const member of REVIEWED_NATIVE_MEMBERS) {
    const canonical = await realpath(resolve(packRoot, ...member.split("/")));
    absoluteByMember.set(member, canonical);
    expectedLoadedPathByMember.set(
      member,
      expectedLoadedModulePath(canonical),
    );
  }
  const probePath = await realpath(
    resolve(packRoot, "vendor", "runtime-attestation", "decoder-probe.jpg"),
  );
  const sharpLoaderPath = await realpath(
    resolve(packRoot, "vendor", "sharp", "loader.js"),
  );
  const libvipsDirectory = await realpath(resolve(packRoot, "vendor", "libvips"));
  const inspectorPath = absoluteByMember.get(REVIEWED_NATIVE_MEMBERS[0]);
  if (inspectorPath === undefined) throw new Error("runtime inspector path is missing");

  const require = createRequire(import.meta.url);
  const inspector = requireInspector(require(inspectorPath) as unknown);
  const baselineModules = requireLoadedModules(
    inspector.enumerateLoadedModules(),
  );
  const repeatedBaselineModules = requireLoadedModules(
    inspector.enumerateLoadedModules(),
  );
  assertStableModuleInventories(baselineModules, repeatedBaselineModules);
  for (const [index, member] of REVIEWED_NATIVE_MEMBERS.entries()) {
    const expected = expectedLoadedPathByMember.get(member);
    if (expected === undefined) {
      throw new Error("reviewed native member path is missing");
    }
    assertExactLoadedModuleMultiplicity(
      baselineModules,
      expected,
      index === 0 ? 1 : 0,
    );
  }

  let directoryHandle: unknown;
  let operationError: unknown;
  let verifiedLoadedModules: readonly string[] | undefined;
  try {
    directoryHandle = inspector.addDllDirectory(libvipsDirectory);
    if (!inspector.revalidateDllDirectory(directoryHandle)) {
      throw new Error(
        "runtime DLL directory changed before the Sharp import boundary",
      );
    }
    const sharpModule = (await import(pathToFileURL(sharpLoaderPath).href)) as {
      readonly default?: unknown;
    };
    const sharp = requireSharp(sharpModule.default);
    if (
      sharp.versions.sharp !== SHARP_VERSION ||
      sharp.versions.vips !== LIBVIPS_VERSION
    ) {
      throw new Error("Sharp or libvips runtime version is not exact");
    }

    const probeBytes = await readFile(probePath);
    let decodedBytes: Buffer | undefined;
    try {
      if (probeBytes.length !== PROBE_BYTE_LENGTH || sha256(probeBytes) !== PROBE_SHA256) {
        throw new Error("decoder probe bytes are not exact");
      }
      const options = { failOn: "error", limitInputPixels: 6 } as const;
      const metadata = await sharp(probeBytes, options).metadata();
      if (
        metadata.format !== "jpeg" ||
        metadata.width !== 3 ||
        metadata.height !== 2 ||
        metadata.space !== "srgb" ||
        metadata.channels !== 3 ||
        metadata.depth !== "uchar" ||
        metadata.hasAlpha === true ||
        metadata.orientation !== undefined ||
        metadata.exif !== undefined
      ) {
        throw new Error("decoder probe metadata is not exact");
      }
      const decoded = await sharp(probeBytes, options)
        .raw()
        .toBuffer({ resolveWithObject: true });
      decodedBytes = decoded.data;
      if (
        decoded.info.width !== 3 ||
        decoded.info.height !== 2 ||
        decoded.info.channels !== 3 ||
        decoded.info.depth !== "uchar" ||
        decoded.info.hasAlpha ||
        decoded.info.size !== 18 ||
        decodedBytes.length !== 18 ||
        sha256(decodedBytes) !== PROBE_DECODED_RGB_SHA256
      ) {
        throw new Error("decoder probe RGB result is not exact");
      }
    } finally {
      probeBytes.fill(0);
      decodedBytes?.fill(0);
    }

    const loadedModules = requireLoadedModules(
      inspector.enumerateLoadedModules(),
    );
    const repeatedLoadedModules = requireLoadedModules(
      inspector.enumerateLoadedModules(),
    );
    const finalLoadedModules = requireLoadedModules(
      inspector.enumerateLoadedModules(),
    );
    assertStableModuleInventories(
      loadedModules,
      repeatedLoadedModules,
      finalLoadedModules,
    );
    for (const member of REVIEWED_NATIVE_MEMBERS) {
      const expected = expectedLoadedPathByMember.get(member);
      if (expected === undefined) throw new Error("reviewed native member is missing");
      assertExactLoadedModuleMultiplicity(loadedModules, expected, 1);
    }
    if (!inspector.revalidateDllDirectory(directoryHandle)) {
      throw new Error(
        "runtime DLL directory changed after the decoder proof boundary",
      );
    }
    verifiedLoadedModules = loadedModules;
  } catch (error) {
    operationError = error;
  }

  let removalError: unknown;
  if (directoryHandle !== undefined) {
    try {
      if (!inspector.removeDllDirectory(directoryHandle)) {
        throw new Error("runtime DLL directory was not removed exactly once");
      }
    } catch (error) {
      removalError = error;
    }
  }
  if (removalError !== undefined) {
    throw new Error("runtime DLL-directory teardown failed", { cause: removalError });
  }
  if (operationError !== undefined) {
    if (operationError instanceof Error) throw operationError;
    throw new Error("runtime bootstrap operation failed");
  }
  if (verifiedLoadedModules === undefined || directoryHandle === undefined) {
    throw new Error("runtime bootstrap did not produce an observation");
  }
  const postRemovalModules = requireLoadedModules(
    inspector.enumerateLoadedModules(),
  );
  const repeatedPostRemovalModules = requireLoadedModules(
    inspector.enumerateLoadedModules(),
  );
  assertStableModuleInventories(
    verifiedLoadedModules,
    postRemovalModules,
    repeatedPostRemovalModules,
  );
  const computedMemberSetSha256 = sha256(
    `VENVIEWER_GRAND_HALL_T554_REVIEWED_NATIVE_MODULE_SET_V1\0${JSON.stringify(REVIEWED_NATIVE_MEMBERS)}`,
  );
  if (computedMemberSetSha256 !== REVIEWED_NATIVE_MEMBER_SET_SHA256) {
    throw new Error("reviewed native module-set digest is not exact");
  }
  return deepFreeze({
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-runtime-bootstrap-observation.v1" as const,
    sharpVersion: SHARP_VERSION,
    libvipsVersion: LIBVIPS_VERSION,
    probe: {
      byteLength: PROBE_BYTE_LENGTH,
      sha256: PROBE_SHA256,
      width: 3 as const,
      height: 2 as const,
      channels: 3 as const,
      decodedRgbByteLength: 18 as const,
      decodedRgbSha256: PROBE_DECODED_RGB_SHA256,
    },
    loadedModuleCount: verifiedLoadedModules.length,
    loadedReviewedNativeMembers: REVIEWED_NATIVE_MEMBERS,
    loadedReviewedNativeMemberSetSha256: REVIEWED_NATIVE_MEMBER_SET_SHA256,
    targetNativeModulesAbsentBeforeSharpImport: true as const,
    exactReviewedNativeModuleMultiplicityVerified: true as const,
    loadedModuleInventoryStableAcrossDecode: true as const,
    loadedModuleInventoryStableAfterDllDirectoryRemoval: true as const,
    dllDirectoryConfiguredBeforeSharpImport: true as const,
    dllDirectoryRevalidatedBeforeSharpImport: true as const,
    dllDirectoryRevalidatedAfterDecode: true as const,
    dllDirectoryRemoved: true as const,
    authority: "none" as const,
  });
}
