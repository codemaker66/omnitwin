import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  createLocalNativeIntakeControllerV0,
} from "./local-native-intake.js";
import {
  createLocalNativeCollectionAnalysisControllerV0,
} from "./local-native-collection-analysis.js";
import {
  startLocalNativeIntakeApp,
  type LocalNativeIntakeAppHandle,
} from "./local-native-intake-app.js";
import {
  StrictTrustedWindowsNativeSourceAdapterV1,
} from "./trusted-windows-native-source-adapter-v1.js";
import {
  launchTrustedWindowsNativeHelperProcessBridgeV1,
} from "./trusted-windows-native-source-helper-process-bridge.js";

const WINDOWS_HELPER_FILE_NAME = "venviewer-windows-source-helper.exe";

export interface StartConfiguredLocalNativeIntakeAppOptionsV0 {
  readonly port?: number;
  readonly sessionTtlMs?: number;
  /** Process configuration only. It is never accepted from the browser. */
  readonly helperExecutablePath?: string;
}

function moduleDirectory(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function helperCandidates(): readonly string[] {
  const sourceDirectory = moduleDirectory();
  return Object.freeze([
    resolve(sourceDirectory, "..", "native", "windows-source-helper", WINDOWS_HELPER_FILE_NAME),
    resolve(
      sourceDirectory,
      "..",
      "native",
      "windows-source-helper",
      "target",
      "x86_64-pc-windows-msvc",
      "release",
      WINDOWS_HELPER_FILE_NAME,
    ),
    resolve(
      sourceDirectory,
      "..",
      "native",
      "windows-source-helper",
      "target",
      "x86_64-pc-windows-msvc",
      "debug",
      WINDOWS_HELPER_FILE_NAME,
    ),
  ]);
}

async function usableHelperFile(path: string): Promise<boolean> {
  try {
    await access(path);
    const metadata = await stat(path);
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  }
}

export async function resolveLocalNativeIntakeHelperExecutableV0(
  configuredPath?: string,
): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("The Windows picker and drop-panel preview is available on Windows only.");
  }
  if (configuredPath !== undefined) {
    if (!isAbsolute(configuredPath)) {
      throw new Error("The configured Windows selection helper path must be absolute.");
    }
    const absolute = resolve(configuredPath);
    if (!(await usableHelperFile(absolute))) {
      throw new Error("The configured Windows selection helper is unavailable.");
    }
    return absolute;
  }
  for (const candidate of helperCandidates()) {
    if (await usableHelperFile(candidate)) return candidate;
  }
  throw new Error(
    "The local Windows selection helper is not built yet. Build the Windows source helper, then start the local app again.",
  );
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Ordinary local-preview composition: Windows picks or receives dropped items, then the Node
 * process reopens the chosen paths for receipt inspection and exact copying.
 * It does not claim retained-handle byte custody; the browser remains path-free.
 */
export async function startConfiguredLocalNativeIntakeApp(
  options: StartConfiguredLocalNativeIntakeAppOptionsV0,
): Promise<LocalNativeIntakeAppHandle> {
  const executablePath = await resolveLocalNativeIntakeHelperExecutableV0(
    options.helperExecutablePath,
  );
  const expectedExecutableSha256 = await sha256File(executablePath);
  const bridge = await launchTrustedWindowsNativeHelperProcessBridgeV1({
    executablePath,
    expectedExecutableSha256,
  });
  let controller: ReturnType<typeof createLocalNativeIntakeControllerV0> | null = null;
  let analysisController: ReturnType<
    typeof createLocalNativeCollectionAnalysisControllerV0
  > | null = null;
  try {
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(bridge);
    controller = createLocalNativeIntakeControllerV0({ adapter });
    analysisController = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => controller?.getCollectionAnalysisInputV0() ?? null,
    });
    return await startLocalNativeIntakeApp({
      controller,
      analysisController,
      port: options.port ?? 0,
      ...(options.sessionTtlMs === undefined ? {} : { sessionTtlMs: options.sessionTtlMs }),
    });
  } catch (error: unknown) {
    await analysisController?.close().catch(() => undefined);
    if (controller !== null) {
      await controller.close().catch(() => undefined);
    } else {
      await bridge.close_and_confirm_no_live_scopes().catch(() => undefined);
    }
    throw error;
  }
}
